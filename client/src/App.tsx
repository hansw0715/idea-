import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import {
  BrowserRouter,
  Routes,
  Route,
  Navigate,
  Link,
  NavLink,
  useNavigate,
} from 'react-router-dom';
import { api, setOnUnauthorized } from './api';
import { AuthContext, useAuth } from './auth';
import type { User } from './types';
import Login from './pages/Login';
import Signup from './pages/Signup';
import Dashboard from './pages/Dashboard';
import TimetablePage from './pages/TimetablePage';
import Meetings from './pages/Meetings';
import MeetingDetail from './pages/MeetingDetail';
import Account from './pages/Account';

function TopNav() {
  const { user, setUser } = useAuth();
  const navigate = useNavigate();

  async function logout() {
    try {
      await api.post('/auth/logout');
    } catch {
      // 서버에 닿지 못해도 로컬 상태는 정리하고 로그인 화면으로 보낸다.
    }
    setUser(null);
    navigate('/login');
  }

  return (
    <header className="topnav">
      <div className="topnav-inner">
        <Link to="/" className="logo">
          <span className="logo-mark" />
          캠퍼스 스페이스
        </Link>
        <nav className="topnav-links">
          <NavLink to="/" end>
            대시보드
          </NavLink>
          <NavLink to="/timetable">시간표</NavLink>
          <NavLink to="/meetings">회의</NavLink>
        </nav>
        <div className="topnav-user">
          <Link to="/account" className="topnav-me">
            {user?.name}님
          </Link>
          <button type="button" className="btn btn-outline btn-sm" onClick={logout}>
            로그아웃
          </button>
        </div>
      </div>
    </header>
  );
}

function Protected({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  return (
    <>
      <TopNav />
      {children}
    </>
  );
}

/**
 * 로그인 여부는 httpOnly 쿠키에 있어 JS가 직접 읽을 수 없다.
 * 매번 서버에 물어보면 첫 화면이 그만큼 늦어지므로, 마지막 로그인 정보를
 * 브라우저에 남겨 두고 화면을 먼저 그린 뒤 뒤에서 검증한다.
 * 세션이 끊겼다면 API가 401을 돌려주고 그때 로그인 화면으로 보낸다.
 */
const CACHED_USER_KEY = 'campus-space-user';

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
      .catch(() => setUser(null))
      .finally(() => setBooting(false));
  }, []);

  if (booting) {
    return <div className="boot">불러오는 중…</div>;
  }

  return (
    <AuthContext.Provider value={{ user, setUser }}>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={user ? <Navigate to="/" replace /> : <Login />} />
          <Route path="/signup" element={user ? <Navigate to="/" replace /> : <Signup />} />
          <Route
            path="/"
            element={
              <Protected>
                <Dashboard />
              </Protected>
            }
          />
          <Route
            path="/timetable"
            element={
              <Protected>
                <TimetablePage />
              </Protected>
            }
          />
          <Route
            path="/meetings"
            element={
              <Protected>
                <Meetings />
              </Protected>
            }
          />
          <Route
            path="/meetings/:id"
            element={
              <Protected>
                <MeetingDetail />
              </Protected>
            }
          />
          <Route
            path="/account"
            element={
              <Protected>
                <Account />
              </Protected>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthContext.Provider>
  );
}
