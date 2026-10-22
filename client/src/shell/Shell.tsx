import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode, RefObject } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Icon } from '../ui';
import type { IconName } from '../ui';
import { useDisplay } from '../ui/Display';
import { LOUNGE_ENABLED } from '../features';
import { useAuth } from '../auth';
import { useLoungeOptional } from '../lounge/LoungeContext';
import Avatar from '../lounge/parts/Avatar';

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
    let pendingFocus = !first.current;
    first.current = false;
    const apply = () => {
      const main = document.getElementById('main');
      const h1 = main?.querySelector<HTMLElement>('h1');
      const name = fixed ?? h1?.textContent?.trim();
      document.title = name ? `${name} - ${SERVICE}` : SERVICE;
      // Suspense and API loading can each finish after the route effect.
      // Wait for the actual content, rather than focusing the header or spinner.
      if (!pendingFocus || !main || main.querySelector('[aria-busy="true"]')) return;
      const target = h1 ?? main;
      pendingFocus = false;
      target.setAttribute('tabindex', '-1');
      target.focus({ preventScroll: true });
    };
    // Once someone starts interacting, late content must not steal focus.
    const cancelFocus = () => { pendingFocus = false; };
    document.addEventListener('pointerdown', cancelFocus, true);
    document.addEventListener('keydown', cancelFocus, true);
    apply();
    // 상세 화면처럼 제목이 데이터를 받은 뒤 정해지면 h1 변화를 따라간다.
    const observer = new MutationObserver(apply);
    const root = document.getElementById('root');
    if (root) observer.observe(root, { childList: true, subtree: true, characterData: true });
    return () => {
      observer.disconnect();
      document.removeEventListener('pointerdown', cancelFocus, true);
      document.removeEventListener('keydown', cancelFocus, true);
    };
  }, [pathname]);
  return null;
}

const TABS: { to: string; label: string; icon: IconName; end?: boolean }[] = [
  { to: '/', label: '홈', icon: 'home', end: true },
  { to: '/timetable', label: '시간표', icon: 'calendar' },
  { to: '/meetings', label: '회의', icon: 'users' },
  ...(LOUNGE_ENABLED ? [{ to: '/lounge', label: '라운지', icon: 'lounge' as IconName }] : []),
  { to: '/account', label: '내 정보', icon: 'user' },
];

/** 레일(데스크톱)인지: 표시줄이 움직이는 축이 가로(하단 탭바)에서 세로(레일)로 바뀐다 */
const RAIL_QUERY = '(min-width: 1024px)';

interface Mark {
  pos: number;
  size: number;
}

/**
 * 활성 탭 표시줄. layoutId(화면 전체 좌표로 재는 공유 레이아웃) 대신
 * 목록 안에서의 offset 값만 읽어 한 축으로만 움직인다.
 * 스크롤 위치와 무관해서, 스크롤한 뒤 탭을 바꿔도 아래에서 올라오지 않는다.
 */
function useActiveMark(listRef: RefObject<HTMLUListElement | null>): { mark: Mark | null; rail: boolean } {
  const { pathname } = useLocation();
  const [mark, setMark] = useState<Mark | null>(null);
  const [rail, setRail] = useState(() => window.matchMedia(RAIL_QUERY).matches);

  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const mq = window.matchMedia(RAIL_QUERY);
    const measure = () => {
      const isRail = mq.matches;
      setRail(isRail);
      const item = list.querySelector<HTMLElement>('.tabbar__item[aria-current="page"]');
      if (!item) return setMark(null);
      setMark(
        isRail
          ? { pos: item.offsetTop, size: item.offsetHeight }
          : // 하단 탭바: 칸 가운데 56% 폭의 선
            { pos: item.offsetLeft + item.offsetWidth * 0.22, size: item.offsetWidth * 0.56 },
      );
    };
    measure();
    // 글자 확대·좁은 폭 단계(활성 칸이 넓어짐)로 칸 크기가 바뀌면 다시 잰다
    const ro = new ResizeObserver(measure);
    ro.observe(list);
    mq.addEventListener('change', measure);
    return () => {
      ro.disconnect();
      mq.removeEventListener('change', measure);
    };
  }, [listRef, pathname]);

  return { mark, rail };
}

export function TabBar() {
  const listRef = useRef<HTMLUListElement>(null);
  const { mark, rail } = useActiveMark(listRef);
  const reduce = useReducedMotion();
  const first = useRef(true);
  // 첫 표시는 제자리에, 이후에는 같은 직선 위를 일정한 속도(linear)로 이동
  const markTransition = reduce || first.current ? { duration: 0 } : { duration: 0.2, ease: 'linear' as const };
  useEffect(() => {
    if (mark) first.current = false;
  }, [mark]);

  return (
    <motion.nav
      className="tabbar"
      aria-label="주요 메뉴"
      initial={false}
    >
      {/* 데스크톱 레일 머리의 로고타입 (모바일에서는 CSS로 숨김) */}
      <Link to="/" className="tabbar__brand" aria-label="상상Book-E 홈">
        <span>
          상상Book<i>-</i>E
        </span>
      </Link>
      <ul className="tabbar__list" ref={listRef}>
        {mark && (
          <motion.li
            aria-hidden="true"
            className="tabbar__pill"
            initial={false}
            // 하단 탭바는 가로(x)·폭만, 레일은 세로(y)·높이만 움직인다. 나머지 축은 CSS 가 고정한다
            animate={rail ? { x: 0, y: mark.pos, height: mark.size, width: '100%' } : { x: mark.pos, y: 0, width: mark.size }}
            transition={markTransition}
          />
        )}
        {TABS.map((t) => (
          <li key={t.to}>
            <NavLink to={t.to} end={t.end} className="tabbar__item">
              <Icon name={t.icon} className="tabbar__icon" />
              <span className="tabbar__label">{t.label}</span>
            </NavLink>
          </li>
        ))}
      </ul>
    </motion.nav>
  );
}

/** 화면이 바뀔 때마다 새 화면을 살짝 띄워 올린다 (경로가 키라서 같은 화면 안의 상태 변화에는 반응하지 않는다) */
function PageTransition({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  return (
    <div key={pathname} className="app-page">
      {children}
    </div>
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
        <PageTransition>{children}</PageTransition>
        <AnimatePresence>{showTabs && <TabBar key="tabbar" />}</AnimatePresence>
      </div>
    </ShellContext.Provider>
  );
}

/** 페이지가 조금이라도 스크롤되면 true — 헤더 아래 구분선을 그때만 보인다 */
function useScrolled(): boolean {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 4);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  return scrolled;
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
  const { user } = useAuth();
  // 라운지 프로필이 있으면 고른 캐릭터를, 없으면 이름 첫 글자를 보여 준다
  const loungeProfile = useLoungeOptional()?.profile ?? null;
  const hasBack = title !== undefined;
  const showAvatar = !hasBack && !bare && user;
  const scrolled = useScrolled();

  return (
    <header
      className={`app-header${hasBack ? ' app-header--back' : ''}${bare ? ' app-header--bare' : ''}${scrolled ? ' is-scrolled' : ''}`}
    >
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
            <span>
              상상Book<i>-</i>E
            </span>
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
        {showAvatar && (
          <Link
            to="/account"
            className={`app-header__avatar${loungeProfile ? ' app-header__avatar--lounge' : ''}`}
            aria-label={`내 정보 (${loungeProfile?.nickname ?? user.name})`}
          >
            {loungeProfile ? (
              <Avatar user={loungeProfile} size="md" />
            ) : (
              <span aria-hidden="true">{user.name.trim().charAt(0) || '나'}</span>
            )}
          </Link>
        )}
      </div>
    </header>
  );
}
