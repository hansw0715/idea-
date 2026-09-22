'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

/**
 * 하단 탭. 팀빌딩/시설예약 자리를 미리 잡아뒀다 —
 * 친구가 /teams, /facilities 페이지만 만들면 여기 disabled만 떼면 된다.
 */
const TABS = [
  { href: '/', label: '홈', icon: '🏠', ready: true },
  { href: '/meetups', label: '미팅', icon: '💌', ready: true },
  { href: '/meals', label: '밥약', icon: '🍚', ready: true },
  { href: '/teams', label: '팀빌딩', icon: '🧩', ready: false },
  { href: '/facilities', label: '시설', icon: '📅', ready: false },
  { href: '/bus', label: '버스', icon: '🚌', ready: true },
];

export function Nav() {
  const pathname = usePathname();

  return (
    <nav className="sticky bottom-0 grid grid-cols-6 border-t border-border bg-surface/95 backdrop-blur">
      {TABS.map((tab) => {
        const active = tab.href === '/' ? pathname === '/' : pathname.startsWith(tab.href);
        const className = `flex flex-col items-center gap-0.5 py-2.5 text-[11px] ${
          active ? 'text-brand font-semibold' : 'text-muted'
        }`;

        if (!tab.ready) {
          return (
            <span key={tab.href} className={`${className} opacity-40`} title="다른 팀원이 개발 중">
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
