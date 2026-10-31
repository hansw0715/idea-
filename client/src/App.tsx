import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { api, ApiError, clearCachedResponses, setOnUnauthorized } from './api';
import { AuthContext, useAuth } from './auth';
import type { User } from './types';
import { ConfirmProvider, DisplayProvider, Spinner, ToastProvider, useToast } from './ui';
import { AppFrame, TabPagesContext } from './shell/Shell';
import { ErrorBoundary } from './shell/ErrorScreen';
import Login from './pages/Login';
import Signup from './pages/Signup';
import Dashboard from './pages/Dashboard';
import Campus from './pages/Campus';
import Friends from './pages/Friends';
import TimetablePage from './pages/TimetablePage';
import Meetings from './pages/Meetings';
import MeetingDetail from './pages/MeetingDetail';
import Account from './pages/Account';
import { LoungeProvider } from './lounge/LoungeContext';
import { LOUNGE_ENABLED } from './features';
import { SchoolProvider } from './school/SchoolContext';
import LoungePage from './lounge/LoungePage';
import MeetupPage from './lounge/MeetupPage';
import MealPage from './lounge/MealPage';
import GatheringPage from './lounge/GatheringPage';
import ChatRoomPage from './lounge/ChatRoomPage';
import MeetupLoungePage from './lounge/MeetupLoungePage';
import { NotificationsProvider } from './notifications/Notifications';
import AdminPage from './lounge/AdminPage';
import { hideSplash } from './shell/splash';

/** 로그인 후 화면: 로그인이 안 되어 있으면 로그인으로 보낸다. 헤더·탭바는 AppFrame 이 맡는다. */
function MeetingsEntry() {
  const location = useLocation();
  return LOUNGE_ENABLED ? <Navigate to="/lounge/meetings" state={location.state} replace /> : <Meetings />;
}

function Protected({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  // 관리자 모드(admin_아이디)는 관리자 화면만 쓴다
  if (user.adminSession) return <Navigate to="/admin" replace />;
  return <AppFrame>{children}</AppFrame>;
}

/** 관리자 화면: 관리자 모드 세션이면 탭바 없이 이 화면만, 아니면 일반 화면처럼 */
function AdminRoute() {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  return (
    <AppFrame tabs={!user.adminSession}>
      <AdminPage />
    </AppFrame>
  );
}

/** 로그인·가입 화면: 하단 탭바 없이 같은 컬럼 프레임만 쓴다. */
function Public({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  if (user) return <Navigate to="/" replace />;
  return <AppFrame tabs={false}>{children}</AppFrame>;
}

/**
 * 로그인 여부는 httpOnly 쿠키에 있어 JS가 직접 읽을 수 없다.
 * 매번 서버에 물어보면 첫 화면이 그만큼 늦어지므로, 마지막 로그인 정보를
 * 브라우저에 남겨 두고 화면을 먼저 그린 뒤 뒤에서 검증한다.
 * 세션이 끊겼다면 API가 401을 돌려주고 그때 로그인 화면으로 보낸다.
 */
const CACHED_USER_KEY = 'sangsang-booke-user';

function readCachedUser(): User | null {
  try {
    const raw = localStorage.getItem(CACHED_USER_KEY);
    return raw ? (JSON.parse(raw) as User) : null;
  } catch {
    return null;
  }
}

function writeCachedUser(user: User | null): void {
  try {
    if (user) localStorage.setItem(CACHED_USER_KEY, JSON.stringify(user));
    else localStorage.removeItem(CACHED_USER_KEY);
  } catch {
    /* 저장이 막힌 브라우저에서는 그냥 매번 서버에 묻는다 */
  }
}

/** 작업 중 세션이 끝나면(401) 로그인 화면으로 보내면서 이유를 알린다. */
function SessionWatcher({ onExpired }: { onExpired: () => void }) {
  const toast = useToast();
  useEffect(() => {
    setOnUnauthorized(() => {
      onExpired();
      toast('로그인 시간이 지났습니다. 다시 로그인해 주세요.');
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toast]);
  return null;
}

/** 하단 탭 화면들: 화면을 밀 때 옆 탭을 미리 그리는 데 쓴다 (Shell.tsx 의 useTabSwipe) */
const TAB_PAGES: Record<string, ReactNode> = {
  '/': <Dashboard />,
  '/timetable': <TimetablePage />,
  '/campus': <Campus />,
  '/meetings': <MeetingsEntry />,
  '/lounge': <LoungePage />,
  '/account': <Account />,
};

/** 라운지가 꺼져 있으면 프로필을 불러오지도, 프로필 시트를 띄우지도 않는다. */
function MaybeLounge({ children }: { children: ReactNode }) {
  return LOUNGE_ENABLED ? <LoungeProvider>{children}</LoungeProvider> : <>{children}</>;
}

export default function App() {
  const cached = readCachedUser();
  const [user, setUserState] = useState<User | null>(cached);
  // 저장된 정보가 있으면 기다리지 않고 바로 그린다.
  const [booting, setBooting] = useState(cached === null);

  const setUser = (next: User | null) => {
    // 로그아웃하거나 다른 계정으로 바뀌면 지난 화면 내용을 지운다 (다른 사람 정보가 보이지 않게)
    if (!next || readCachedUser()?.id !== next.id) clearCachedResponses();
    writeCachedUser(next);
    setUserState(next);
  };

  useEffect(() => {
    setOnUnauthorized(() => setUser(null));
    api
      .get<User>('/auth/me')
      .then(setUser)
      .catch((err) => {
        // 세션이 끝난 경우(401)에만 로그아웃 처리한다. 연결 오류·서버 오류에는 저장된 사용자를 유지하고
        // 각 화면의 오류 안내와 다시 시도 버튼에 맡긴다.
        if (err instanceof ApiError && err.status === 401) setUser(null);
        else if (cached === null) setUser(null);
      })
      .finally(() => setBooting(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 로그인 확인이 끝나 첫 화면을 그릴 수 있으면 로딩 화면을 걷는다
  useEffect(() => {
    if (!booting) hideSplash();
  }, [booting]);

  if (booting) {
    return (
      <div className="boot" role="status" aria-busy="true">
        <Spinner large />
        <p>불러오는 중입니다.</p>
      </div>
    );
  }

  return (
    <ErrorBoundary>
      <DisplayProvider>
        <ToastProvider>
          <ConfirmProvider>
            <AuthContext.Provider value={{ user, setUser }}>
              <SessionWatcher onExpired={() => setUser(null)} />
              {/* 라우터를 라운지보다 바깥에 둔다: 라운지 프로필 창(ProfileSheet)의 링크가 라우터 안에 있어야 한다 */}
              <BrowserRouter>
              <MaybeLounge>
              <SchoolProvider>
                <NotificationsProvider key={user?.id ?? 'guest'}>
                <TabPagesContext.Provider value={TAB_PAGES}>
                <Routes>
                  <Route path="/login" element={<Public><Login /></Public>} />
                  <Route path="/signup" element={<Public><Signup /></Public>} />
                  <Route path="/" element={<Protected><Dashboard /></Protected>} />
                  <Route path="/timetable" element={<Protected><TimetablePage /></Protected>} />
                  <Route path="/meetings" element={<Protected><MeetingsEntry /></Protected>} />
                  <Route path="/meetings/:id" element={<Protected><MeetingDetail /></Protected>} />
                  <Route path="/account" element={<Protected><Account /></Protected>} />
                  <Route path="/campus" element={<Protected><Campus /></Protected>} />
                  {LOUNGE_ENABLED && (
                    <>
                      <Route path="/account/friends" element={<Protected><Friends /></Protected>} />
                      <Route path="/lounge" element={<Protected><LoungePage /></Protected>} />
                      <Route path="/lounge/meetings" element={<Protected><Meetings /></Protected>} />
                      <Route path="/lounge/campus" element={<Protected><MeetupLoungePage /></Protected>} />
                      <Route path="/lounge/meetup" element={<Protected><MeetupPage /></Protected>} />
                      <Route path="/lounge/meal" element={<Protected><MealPage /></Protected>} />
                      <Route path="/lounge/gatherings/:id" element={<Protected><GatheringPage /></Protected>} />
                      <Route path="/lounge/rooms/:id" element={<Protected><ChatRoomPage /></Protected>} />
                      <Route path="/admin" element={<AdminRoute />} />
                    </>
                  )}
                  <Route path="*" element={<Navigate to="/" replace />} />
                </Routes>
                </TabPagesContext.Provider>
                </NotificationsProvider>
              </SchoolProvider>
              </MaybeLounge>
              </BrowserRouter>
            </AuthContext.Provider>
          </ConfirmProvider>
        </ToastProvider>
      </DisplayProvider>
    </ErrorBoundary>
  );
}
