import Link from 'next/link';
import { isAdmin } from '@/shared/user';
import { currentUser } from '@/server/session';

/**
 * 홈. 4개 기능을 한 서비스로 보여주는 화면.
 * 팀빌딩/시설예약 카드는 자리만 잡아둔 상태 — 담당 팀원이 페이지를 만들면 ready만 켜면 된다.
 */
const FEATURES = [
  {
    href: '/meetups',
    icon: '💌',
    title: '미팅',
    desc: '글 올리고 빈 자리에 선착순으로 앉기',
    why: '하고 싶어도 자리가 없어서 못 하던 미팅',
    ready: true,
  },
  {
    href: '/meals',
    icon: '🍚',
    title: '밥약',
    desc: '방을 열고 신청받아 수락하기',
    why: '혼밥하기 싫은 한 끼',
    ready: true,
  },
  {
    href: '/teams',
    icon: '🧩',
    title: '팀빌딩',
    desc: '대회·공모전 팀 구하기 · 노쇼 관리',
    why: '혼자서는 못 나가던 대회',
    ready: false,
  },
  {
    href: '/facilities',
    icon: '📅',
    title: '시설 예약',
    desc: '공강 시간표 자동 계산으로 빈 시간 찾기',
    why: '예약이 너무 불편해서',
    ready: false,
  },
  {
    href: '/bus',
    icon: '🚌',
    title: '셔틀버스',
    desc: '노선도 · 다음 버스까지 N분 · 실시간 위치',
    why: '학교 셔틀은 지도 앱에 안 나와서',
    ready: true,
  },
];

export default async function Home() {
  const admin = isAdmin(await currentUser());

  return (
    <div className="space-y-4">
      <section className="rounded-2xl bg-brand p-5 text-white md:p-8">
        <p className="text-[12px] opacity-80">한성대학교 학생 서비스</p>
        <h2 className="mt-1 text-xl font-bold leading-snug md:text-3xl">
          같이 할 사람이 없어서
          <br />
          못 했던 것들
        </h2>
        <p className="mt-2 text-[13px] opacity-90 md:text-base">
          미팅도, 밥도, 팀도, 공간도 — 상상BOOK-e에서 한 번에.
        </p>
      </section>

      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        {FEATURES.map((f) => {
          const inner = (
            <>
              <div className="flex items-center gap-2">
                <span className="text-2xl">{f.icon}</span>
                <div className="flex-1">
                  <p className="text-[15px] font-bold">
                    {f.title}
                    {!f.ready && (
                      <span className="ml-1.5 rounded-full bg-surface-muted px-2 py-0.5 text-[10px] font-semibold text-muted">
                        준비 중
                      </span>
                    )}
                  </p>
                  <p className="text-[12px] text-muted">{f.desc}</p>
                </div>
              </div>
              <p className="mt-2 rounded-lg bg-surface-muted px-2.5 py-1.5 text-[11px] text-muted">
                “{f.why}”
              </p>
            </>
          );

          const className = `rounded-2xl border border-border bg-surface p-4 ${
            f.ready ? '' : 'opacity-60'
          }`;

          return f.ready ? (
            <Link key={f.href} href={f.href} className={`${className} block`}>
              {inner}
            </Link>
          ) : (
            <div key={f.href} className={className}>
              {inner}
            </div>
          );
        })}
      </div>

      <div className="flex justify-center gap-3 text-xs text-muted">
        <Link href="/blocks" className="underline">
          차단 목록
        </Link>
        {admin && (
          <Link href="/admin" className="underline">
            관리자 페이지
          </Link>
        )}
      </div>
    </div>
  );
}
