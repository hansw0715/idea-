'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cx } from './ui';

/**
 * 메뉴. 폰에서는 하단 탭, 데스크탑에서는 왼쪽 사이드바로 같은 목록을 쓴다.
 * 팀빌딩/시설예약 자리를 미리 잡아뒀다 — 친구가 /teams, /facilities 페이지만 만들면 ready만 켜면 된다.
 */
const TABS = [
  { href: '/', label: '홈', icon: '🏠', ready: true },
  { href: '/meetups', label: '미팅', icon: '💌', ready: true },
  { href: '/meals', label: '밥약', icon: '🍚', ready: true },
  { href: '/teams', label: '팀빌딩', icon: '🧩', ready: false },
  { href: '/facilities', label: '시설', icon: '📅', ready: false },
  { href: '/bus', label: '버스', icon: '🚌', ready: true },
];

const isActive = (pathname: string, href: string) =>
  href === '/' ? pathname === '/' : pathname.startsWith(href);

/** 폰: 화면 아래 고정 탭 */
export function Nav() {
  const pathname = usePathname();

  return (
    <nav className="sticky bottom-0 grid grid-cols-6 border-t border-border bg-surface/95 backdrop-blur md:hidden">
      {TABS.map((tab) => {
        const active = isActive(pathname, tab.href);
        const className = cx(
          'flex flex-col items-center gap-0.5 py-2.5 text-[11px]',
          active ? 'font-semibold text-brand' : 'text-muted',
        );

        if (!tab.ready) {
          return (
            <span key={tab.href} className={cx(className, 'opacity-40')} title="다른 팀원이 개발 중">
              <span className="text-lg">{tab.icon}</span>
              {tab.label}
            </span>
          );
        }

        return (
          <Link key={tab.href} href={tab.href} className={className}>
            <span className="text-lg">{tab.icon}</span>
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}

/** 데스크탑: 왼쪽 사이드바 */
export function SideNav() {
  const pathname = usePathname();

  return (
    <nav className="flex flex-col gap-1">
      {TABS.map((tab) => {
        const active = isActive(pathname, tab.href);
        const className = 'flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition';

        if (!tab.ready) {
          return (
            <span
              key={tab.href}
              className={cx(className, 'cursor-default text-muted opacity-50')}
              title="다른 팀원이 개발 중"
            >
              <span className="text-base">{tab.icon}</span>
              {tab.label}
              <span className="ml-auto text-[10px]">준비 중</span>
            </span>
          );
        }

        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={cx(
              className,
              active ? 'bg-brand-soft font-semibold text-brand' : 'text-foreground hover:bg-surface-muted',
            )}
          >
            <span className="text-base">{tab.icon}</span>
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
