import { lazy, Suspense, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { MotionConfig } from 'motion/react';
import { api, ApiError, setOnUnauthorized } from './api';
import { AuthContext, useAuth } from './auth';
import type { User } from './types';
import { ConfirmProvider, DisplayProvider, Spinner, ToastProvider, useToast } from './ui';
import { AppFrame } from './shell/Shell';
import { ErrorBoundary } from './shell/ErrorScreen';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import TimetablePage from './pages/TimetablePage';
import Meetings from './pages/Meetings';
import { LoungeProvider } from './lounge/LoungeContext';
import { LOUNGE_ENABLED } from './features';
import { SchoolProvider } from './school/SchoolContext';

// 매일 여는 화면(로그인·홈·시간표·회의 목록)은 첫 묶음에 두고, 가끔 여는 화면은 열 때 불러온다.
const Signup = lazy(() => import('./pages/Signup'));
const MeetingDetail = lazy(() => import('./pages/MeetingDetail'));
const Account = lazy(() => import('./pages/Account'));
const LoungePage = lazy(() => import('./lounge/LoungePage'));
const MeetupPage = lazy(() => import('./lounge/MeetupPage'));
const ChatRoomPage = lazy(() => import('./lounge/ChatRoomPage'));
const AdminPage = lazy(() => import('./lounge/AdminPage'));

/**
 * 나눠 불러오는 화면을 기다리는 동안: 헤더·탭바는 그대로 두고 본문 자리만 높이를 지켜
 * 화면이 위아래로 튀지 않게 한다. 짧은 로딩에서 깜빡이지 않도록 스피너는 늦게 보인다.
 */
function RouteFallback() {
  return (
    <div className="route-fallback" role="status" aria-busy="true">
      <Spinner />
      <span className="sr-only">화면을 불러오는 중입니다.</span>
    </div>
  );
}

/** 로그인 후 화면: 로그인이 안 되어 있으면 로그인으로 보낸다. 헤더·탭바는 AppFrame 이 맡는다. */
function Protected({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  return (
    <AppFrame>
      <Suspense fallback={<RouteFallback />}>{children}</Suspense>
    </AppFrame>
  );
}

/** 로그인·가입 화면: 하단 탭바 없이 같은 컬럼 프레임만 쓴다. */
function Public({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  if (user) return <Navigate to="/" replace />;
  return (
    <AppFrame tabs={false}>
      <Suspense fallback={<RouteFallback />}>{children}</Suspense>
    </AppFrame>
  );
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
      {/* OS "동작 줄이기"가 켜져 있으면 모든 motion 애니메이션의 이동·크기 변화를 끈다 */}
      <MotionConfig reducedMotion="user">
      <DisplayProvider>
        <ToastProvider>
          <ConfirmProvider>
            <AuthContext.Provider value={{ user, setUser }}>
              <SessionWatcher onExpired={() => setUser(null)} />
              <BrowserRouter>
              <MaybeLounge>
              <SchoolProvider>
                <Routes>
                  <Route path="/login" element={<Public><Login /></Public>} />
                  <Route path="/signup" element={<Public><Signup /></Public>} />
                  <Route path="/" element={<Protected><Dashboard /></Protected>} />
                  <Route path="/timetable" element={<Protected><TimetablePage /></Protected>} />
                  <Route path="/meetings" element={<Protected><Meetings /></Protected>} />
                  <Route path="/meetings/:id" element={<Protected><MeetingDetail /></Protected>} />
                  <Route path="/account" element={<Protected><Account /></Protected>} />
                  {LOUNGE_ENABLED && (
                    <>
                      <Route path="/lounge" element={<Protected><LoungePage /></Protected>} />
                      <Route path="/lounge/meetup" element={<Protected><MeetupPage /></Protected>} />
                      <Route path="/lounge/rooms/:id" element={<Protected><ChatRoomPage /></Protected>} />
                      <Route path="/admin" element={<Protected><AdminPage /></Protected>} />
                    </>
                  )}
                  <Route path="*" element={<Navigate to="/" replace />} />
                </Routes>
              </SchoolProvider>
              </MaybeLounge>
              </BrowserRouter>
            </AuthContext.Provider>
          </ConfirmProvider>
        </ToastProvider>
      </DisplayProvider>
      </MotionConfig>
    </ErrorBoundary>
  );
}
