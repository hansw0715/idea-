import type { Metadata } from 'next';
import { Geist } from 'next/font/google';
import './globals.css';
import { UserSwitcher } from '@/components/UserSwitcher';
import { Nav } from '@/components/Nav';

const geistSans = Geist({ variable: '--font-geist-sans', subsets: ['latin'] });

export const metadata: Metadata = {
  title: '상상BOOK-e | 한성대 캠퍼스 라이프',
  description: '미팅, 밥약, 팀빌딩, 시설예약을 한 곳에서. 한성대학교 학생 서비스',
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="ko" className={`${geistSans.variable} h-full antialiased`}>
      <body className="min-h-full">
        {/* 폰 화면 비율로 고정. 발표 때 화면을 띄워도 실제 앱처럼 보이게 하려는 것. */}
        <div className="mx-auto flex min-h-dvh max-w-lg flex-col border-x border-border bg-background">
          <header className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-border bg-surface/90 px-4 py-3 backdrop-blur">
            <div>
              <p className="text-base font-bold tracking-tight">
                상상<span className="text-brand">BOOK-e</span>
              </p>
              <p className="text-[11px] text-muted">한성대 캠퍼스 라이프</p>
            </div>
            <UserSwitcher />
          </header>

          <main className="flex-1 px-4 py-4">{children}</main>

          <Nav />
        </div>
      </body>
    </html>
  );
}
