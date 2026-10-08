import { createContext, useContext, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { Icon } from '../ui';
import type { IconName } from '../ui';
import { useDisplay } from '../ui/Display';

/* ── 하단 탭바 숨김 제어 (전체 화면 흐름에서 사용) ─────────────── */
interface ShellApi {
  setTabBarHidden: (hidden: boolean) => void;
}
const ShellContext = createContext<ShellApi>({ setTabBarHidden: () => undefined });

/** 마운트되어 있는 동안 하단 탭바를 숨긴다. 예: 단계별 예약 흐름 */
export function useHideTabBar(hidden = true): void {
  const { setTabBarHidden } = useContext(ShellContext);
  useEffect(() => {
    setTabBarHidden(hidden);
    return () => setTabBarHidden(false);
  }, [hidden, setTabBarHidden]);
}

const SERVICE = '상상Book-E';

function routeTitle(pathname: string): string | null {
  if (pathname === '/login') return '로그인';
  if (pathname === '/signup') return '회원가입';
  if (pathname === '/') return '홈';
  if (pathname === '/timetable') return '내 시간표';
  if (pathname === '/meetings') return '회의';
  if (pathname === '/account') return '내 정보';
  return null; // 회의 상세 등: 화면 제목(h1)을 따라간다
}

/**
 * 라우트가 바뀌면 맨 위로 스크롤하고, 문서 제목을 화면 이름으로 바꾸고,
 * 화면 제목(h1)으로 포커스를 옮겨 화면 읽기 사용자에게 이동을 알린다.
 */
function ScrollToTop() {
  const { pathname } = useLocation();
  const first = useRef(true);

  useEffect(() => {
    window.scrollTo(0, 0);
    const fixed = routeTitle(pathname);
    const apply = () => {
      const h1 = document.querySelector('h1');
      const name = fixed ?? h1?.textContent?.trim();
      document.title = name ? `${name} - ${SERVICE}` : SERVICE;
    };
    apply();
    // 상세 화면처럼 제목이 데이터를 받은 뒤 정해지면 h1 변화를 따라간다.
    const observer = new MutationObserver(apply);
    const root = document.getElementById('root');
    if (fixed === null && root) observer.observe(root, { childList: true, subtree: true, characterData: true });

    if (first.current) {
      first.current = false;
    } else {
      const target = document.querySelector<HTMLElement>('h1') ?? document.getElementById('main');
      if (target) {
        target.setAttribute('tabindex', '-1');
        target.focus({ preventScroll: true });
      }
    }
    return () => observer.disconnect();
  }, [pathname]);
  return null;
}

const TABS: { to: string; label: string; icon: IconName; end?: boolean }[] = [
  { to: '/', label: '홈', icon: 'home', end: true },
  { to: '/timetable', label: '시간표', icon: 'calendar' },
  { to: '/meetings', label: '회의', icon: 'users' },
  { to: '/account', label: '내 정보', icon: 'user' },
];

export function TabBar() {
  return (
    <nav className="tabbar" aria-label="주요 메뉴">
      <ul className="tabbar__list">
        {TABS.map((t) => (
          <li key={t.to} style={{ display: 'contents' }}>
            <NavLink to={t.to} end={t.end} className="tabbar__item">
              <Icon name={t.icon} className="tabbar__icon" />
              <span>{t.label}</span>
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** 로그인 후 화면의 공통 틀: 건너뛰기 링크 + 컬럼 프레임 + 하단 탭바 */
export function AppFrame({ children, tabs = true }: { children: ReactNode; tabs?: boolean }) {
  const [hidden, setHidden] = useState(false);
  const showTabs = tabs && !hidden;
  return (
    <ShellContext.Provider value={{ setTabBarHidden: setHidden }}>
      <a className="skip-link" href="#main">
        본문 바로가기
      </a>
      <ScrollToTop />
      <div className={`app-frame${showTabs ? ' has-tabbar' : ''}`}>
        {children}
        {showTabs && <TabBar />}
      </div>
    </ShellContext.Provider>
  );
}

/* ── 상단 헤더 ─────────────────────────────────────────────── */
interface AppHeaderProps {
  /** 주면 뒤로가기 화살표 + 제목 형태. 없으면 서비스 이름(홈으로 가는 링크) */
  title?: string;
  /** 뒤로가기 이동 경로. 없으면 브라우저 기록으로 한 단계 뒤로 */
  backTo?: string;
  onBack?: () => void;
  /** 설정 버튼 왼쪽에 붙는 추가 행동 */
  actions?: ReactNode;
  /** 서비스 이름·구분선 없이 설정 버튼만 (화면이 로고를 크게 보여 줄 때) */
  bare?: boolean;
}

export function AppHeader({ title, backTo, onBack, actions, bare = false }: AppHeaderProps) {
  const { openSettings } = useDisplay();
  const hasBack = title !== undefined;

  return (
    <header className={`app-header${hasBack ? ' app-header--back' : ''}${bare ? ' app-header--bare' : ''}`}>
      {hasBack ? (
        <>
          {backTo ? (
            <Link to={backTo} className="btn btn--icon" aria-label="뒤로 가기">
              <Icon name="arrow-left" className="btn__icon" />
            </Link>
          ) : (
            <button
              type="button"
              className="btn btn--icon"
              aria-label="뒤로 가기"
              onClick={onBack ?? (() => window.history.back())}
            >
              <Icon name="arrow-left" className="btn__icon" />
            </button>
          )}
          <h1 className="app-header__title">{title}</h1>
        </>
      ) : bare ? (
        <span className="app-header__spacer" />
      ) : (
        <>
          <Link to="/" className="app-header__brand" aria-label="상상Book-E 홈">
            <img className="app-header__mark" src="/brand/mark.png" alt="" width="32" height="32" />
            <span>상상Book-E</span>
          </Link>
          <span className="app-header__spacer" />
        </>
      )}
      <div className="app-header__actions">
        {actions}
        <button
          type="button"
          className="btn btn--icon"
          onClick={openSettings}
          aria-label="글자·화면 설정"
        >
          <Icon name="text-size" className="btn__icon" />
        </button>
      </div>
    </header>
  );
}
