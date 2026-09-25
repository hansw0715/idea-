import type { Metadata } from 'next';
import Link from 'next/link';
import { Geist } from 'next/font/google';
import './globals.css';
import { UserSwitcher } from '@/components/UserSwitcher';
import { Nav, SideNav } from '@/components/Nav';

const geistSans = Geist({ variable: '--font-geist-sans', subsets: ['latin'] });

export const metadata: Metadata = {
  title: '상상BOOK-e | 한성대 캠퍼스 라이프',
  description: '미팅, 밥약, 팀빌딩, 시설예약을 한 곳에서. 한성대학교 학생 서비스',
};

/**
 * 한 코드로 두 화면을 만든다.
 *  - 폰(기본): 폭을 좁게 고정하고 메뉴는 화면 아래 탭. 학생들은 대부분 폰으로 쓴다.
 *  - 데스크탑(md 이상): 왼쪽 사이드바 + 넓은 본문. 발표할 때 노트북을 띄우는 경우를 위해.
 */
export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="ko" className={`${geistSans.variable} h-full antialiased`}>
      <body className="min-h-full">
        <div className="mx-auto flex min-h-dvh w-full max-w-lg flex-col border-x border-border bg-background md:max-w-none md:flex-row md:border-x-0">
          {/* 데스크탑 사이드바 */}
          <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col gap-5 border-r border-border bg-surface px-4 py-5 md:flex">
            <Link href="/" className="block">
              <p className="text-lg font-bold tracking-tight">
                상상<span className="text-brand">BOOK-e</span>
              </p>
              <p className="text-[11px] text-muted">한성대 캠퍼스 라이프</p>
            </Link>

            <SideNav />

            <div className="mt-auto space-y-3">
              <UserSwitcher />
              <Link href="/blocks" className="block px-1 text-[11px] text-muted underline">
                차단 목록
              </Link>
            </div>
          </aside>

          <div className="flex min-w-0 flex-1 flex-col">
            {/* 폰 헤더 */}
            <header className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-border bg-surface/90 px-4 py-3 backdrop-blur md:hidden">
              <Link href="/">
                <p className="text-base font-bold tracking-tight">
                  상상<span className="text-brand">BOOK-e</span>
                </p>
                <p className="text-[11px] text-muted">한성대 캠퍼스 라이프</p>
              </Link>
              <UserSwitcher />
            </header>

            <main className="mx-auto w-full flex-1 px-4 py-4 md:max-w-5xl md:px-8 md:py-8">{children}</main>

            <Nav />
          </div>
        </div>
      </body>
    </html>
  );
}
