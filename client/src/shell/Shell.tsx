import { createContext, useContext, useEffect, useRef, useState } from 'react';
import type { CSSProperties, MouseEvent, ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Icon } from '../ui';
import type { IconName } from '../ui';
import { LOUNGE_ENABLED } from '../features';
import { useAuth } from '../auth';
import { useLoungeOptional } from '../lounge/LoungeContext';
import Avatar from '../lounge/parts/Avatar';
import { useNotifications } from '../notifications/Notifications';
import { scopeFor } from '../notifications/activity';

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
  if (pathname === '/lounge') return '라운지';
  if (pathname === '/admin') return '관리자';
  if (pathname === '/account') return '내 정보';
  if (pathname === '/account/friends') return '친구';
  if (pathname === '/campus') return '학사 알림';
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

/** 하단 탭 순서: 홈이 가운데 (라운지 · 시간표 · 홈 · 학사 알림 · 내 정보) */
const TABS: { to: string; label: string; icon: IconName; end?: boolean }[] = [
  ...(!LOUNGE_ENABLED ? [{ to: '/meetings', label: '회의', icon: 'users' as IconName }] : []),
  ...(LOUNGE_ENABLED ? [{ to: '/lounge', label: '라운지', icon: 'lounge' as IconName }] : []),
  { to: '/timetable', label: '시간표', icon: 'calendar' },
  { to: '/', label: '홈', icon: 'home', end: true },
  { to: '/campus', label: '학사 알림', icon: 'list' },
  { to: '/account', label: '내 정보', icon: 'user' },
];

/** 이 요소(또는 조상)가 가로로 스크롤되거나 끌기를 직접 다루면 화면 넘기기를 하지 않는다 */
function handlesHorizontalGesture(start: EventTarget | null): boolean {
  for (let el = start instanceof Element ? start : null; el && el !== document.body; el = el.parentElement) {
    if (el.matches('input, textarea, select, [contenteditable="true"], [data-no-swipe]')) return true;
    const style = getComputedStyle(el);
    if (/(auto|scroll)/.test(style.overflowX) && el.scrollWidth > el.clientWidth + 1) return true;
  }
  return false;
}

/**
 * 화면을 밀어서 옆 탭으로 갈 때: 지금 화면은 민 방향으로 나가고 새 화면은 반대쪽에서 들어온다 (refresh.css 의 view-transition).
 * 브라우저가 View Transitions 를 못 쓰거나 움직임 줄이기를 켰으면 그냥 바꾼다.
 */
function slideTo(go: () => void, direction: 'next' | 'prev') {
  const doc = document as Document & { startViewTransition?: (cb: () => void) => { finished: Promise<void> } };
  if (!doc.startViewTransition || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    go();
    return;
  }
  const root = document.documentElement;
  root.dataset.swipe = direction;
  const transition = doc.startViewTransition(() => flushSync(go));
  void transition.finished.finally(() => delete root.dataset.swipe);
}

/**
 * 작은 화면에서 좌우로 밀면 옆 탭으로 간다 (왼쪽으로 밀면 오른쪽 탭, 오른쪽으로 밀면 왼쪽 탭).
 * 탭 화면 자체에서만 동작하고, 화면 가장자리(휴대폰의 뒤로 가기 제스처)·가로 스크롤 영역·열린 창에서는 하지 않는다.
 * 시간표 격자 위에서는 빠르게 민 경우만 넘긴다: 길게 눌러(350ms) 범위를 고르는 동작과 겹치지 않게.
 */
function useTabSwipe(enabled: boolean) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  useEffect(() => {
    if (!enabled) return;
    const index = TABS.findIndex((t) => t.to === pathname);
    if (index < 0) return;
    let start: { x: number; y: number; t: number; grid: boolean } | null = null;
    const EDGE = 24;
    const onStart = (e: TouchEvent) => {
      start = null;
      if (e.touches.length !== 1 || window.innerWidth >= 768) return;
      const touch = e.touches[0];
      if (touch.clientX < EDGE || touch.clientX > window.innerWidth - EDGE) return;
      if (document.querySelector('[aria-modal="true"], dialog[open]')) return;
      if (handlesHorizontalGesture(e.target)) return;
      const grid = e.target instanceof Element && e.target.closest('.tt-grid') !== null;
      start = { x: touch.clientX, y: touch.clientY, t: Date.now(), grid };
    };
    const onEnd = (e: TouchEvent) => {
      if (!start) return;
      const touch = e.changedTouches[0];
      const dx = touch.clientX - start.x;
      const dy = touch.clientY - start.y;
      // 시간표 격자에서는 길게 누르기(350ms)보다 짧게 민 것만 스와이프로 본다
      const quick = Date.now() - start.t < (start.grid ? 350 : 700);
      start = null;
      // 충분히 길고, 세로보다 확실히 가로로 민 경우만
      if (!quick || Math.abs(dx) < 70 || Math.abs(dx) < Math.abs(dy) * 1.8) return;
      const next = TABS[index + (dx < 0 ? 1 : -1)];
      if (next) slideTo(() => navigate(next.to), dx < 0 ? 'next' : 'prev');
    };
    document.addEventListener('touchstart', onStart, { passive: true });
    document.addEventListener('touchend', onEnd, { passive: true });
    return () => {
      document.removeEventListener('touchstart', onStart);
      document.removeEventListener('touchend', onEnd);
    };
  }, [enabled, pathname, navigate]);
}

/** 지금 주소에 해당하는 탭 번호. 탭에 없는 화면(관리자 등)이면 -1 */
function activeTabIndex(pathname: string): number {
  if (LOUNGE_ENABLED && pathname.startsWith('/meetings')) return TABS.findIndex((t) => t.to === '/lounge');
  return TABS.findIndex((t) => (t.end ? pathname === t.to : pathname === t.to || pathname.startsWith(`${t.to}/`)));
}

/**
 * 지난 화면의 탭 번호. 탭바는 화면마다 새로 그려지므로(라우트마다 AppFrame), 여기 기억해 둔 자리에서
 * 새 자리로 둥근 네모(선택 표시)를 미끄러뜨린다.
 */
let lastTabIndex = -1;

export function TabBar() {
  const { unread } = useNotifications();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const target = activeTabIndex(pathname);
  // 탭을 눌러 옮길 때도 밀었을 때와 같이 옆으로 미끄러지게: 오른쪽 탭이면 새 화면이 오른쪽에서, 왼쪽 탭이면 왼쪽에서 들어온다
  const onTabClick = (event: MouseEvent<HTMLAnchorElement>, index: number, to: string) => {
    if (target < 0 || index === target || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    slideTo(() => navigate(to), index > target ? 'next' : 'prev');
  };
  // 처음에는 지난 자리에 그렸다가, 그려진 직후 새 자리로 옮겨 움직임이 보이게 한다
  const [shown, setShown] = useState(lastTabIndex >= 0 ? lastTabIndex : target);
  useEffect(() => {
    lastTabIndex = target;
    const timer = window.setTimeout(() => setShown(target), 16);
    return () => window.clearTimeout(timer);
  }, [target]);

  return (
    <nav className="tabbar" aria-label="주요 메뉴">
      <ul className="tabbar__list" style={{ '--tab-count': TABS.length } as CSSProperties}>
        {shown >= 0 && (
          <li className="tabbar__pill" role="presentation" aria-hidden="true" style={{ '--tab-index': shown } as CSSProperties} />
        )}
        {TABS.map((t, index) => (
          <li key={t.to} style={{ display: 'contents' }}>
            <Link
              to={t.to}
              aria-current={target === index ? 'page' : undefined}
              className="tabbar__item"
              onClick={(event) => onTabClick(event, index, t.to)}
            >
              <span className="nav-icon"><Icon name={t.icon} className="tabbar__icon" />{unread(scopeFor(t.to)!) && <span className="nav-dot" role="img" aria-label="새 알림" />}</span>
              <span>{t.label}</span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/**
 * 큰 화면(태블릿·PC, 768px 이상)의 위쪽 가로 메뉴: 로고 · 메뉴 · 프로필.
 * 큰 화면에서는 하단 탭바와 화면마다의 로고 머리글 대신 이것이 보인다 (작은 화면에서는 숨는다).
 */
function TopNav() {
  const { unread } = useNotifications();
  const { pathname } = useLocation();
  const target = activeTabIndex(pathname);
  const { user } = useAuth();
  const loungeProfile = useLoungeOptional()?.profile ?? null;
  return (
    <header className="topnav">
      <div className="topnav__inner">
        <Link to="/" className="topnav__brand" aria-label="상상Book-E 홈">
          <img className="topnav__mark" src="/brand/app-icon-64.png" alt="" width="40" height="40" />
          <span>상상Book-E<small className="topnav__scope">한성대학교 캠퍼스</small></span>
        </Link>
        <nav className="topnav__menu" aria-label="주요 메뉴">
          {TABS.map((t, index) => (
            <Link key={t.to} to={t.to} aria-current={target === index ? 'page' : undefined} className="topnav__item">
              <span className="nav-icon"><Icon name={t.icon} />{unread(scopeFor(t.to)!) && <span className="nav-dot" role="img" aria-label="새 알림" />}</span>
              {t.label}
            </Link>
          ))}
        </nav>
        {user && (
          <Link
            to="/account"
            className={`app-header__avatar${loungeProfile ? ' app-header__avatar--lounge' : ''}`}
            aria-label={`내 정보 (${user.name})`}
          >
            <span className="topnav__user-icon">{loungeProfile ? (
              <Avatar user={loungeProfile} size="md" />
            ) : (
              <span aria-hidden="true">{user.name.trim().charAt(0) || '나'}</span>
            )}</span>
            <span className="topnav__user-name">{user.name}<small>내 정보 · 계정 관리</small></span>
            <Icon name="chevron-right" className="topnav__user-arrow" />
          </Link>
        )}
      </div>
    </header>
  );
}

/** 로그인 후 화면의 공통 틀: 건너뛰기 링크 + 컬럼 프레임 + 하단 탭바 (큰 화면에서는 위쪽 가로 메뉴) */
export function AppFrame({ children, tabs = true }: { children: ReactNode; tabs?: boolean }) {
  const [hidden, setHidden] = useState(false);
  const showTabs = tabs && !hidden;
  useTabSwipe(showTabs);
  return (
    <ShellContext.Provider value={{ setTabBarHidden: setHidden }}>
      <a className="skip-link" href="#main">
        본문 바로가기
      </a>
      <ScrollToTop />
      {tabs && <TopNav />}
      <div className={`app-frame${tabs ? ' app-frame--app' : ''}${showTabs ? ' has-tabbar' : ''}`}>
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
  /** 서비스 이름 바로 아래 작은 줄 (홈의 오늘 날짜) */
  subtitle?: ReactNode;
  /** 서비스 이름·구분선 없이 설정 버튼만 (화면이 로고를 크게 보여 줄 때) */
  bare?: boolean;
}

export function AppHeader({ title, backTo, onBack, actions, subtitle, bare = false }: AppHeaderProps) {
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
            <img className="app-header__mark" src="/brand/app-icon-64.png" alt="" width="32" height="32" />
            <span className="app-header__name">
              <span>상상Book-E</span>
              {subtitle && <span className="app-header__date">{subtitle}</span>}
            </span>
          </Link>
          <span className="app-header__spacer" />
        </>
      )}
      <div className="app-header__actions">
        {actions}
      </div>
    </header>
  );
}
