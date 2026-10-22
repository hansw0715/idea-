import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AppHeader } from '../shell/Shell';
import { api } from '../api';
import { fmtDate, fmtRange } from '../time';
import { useWeek } from '../useWeek';
import { Alert, Button, Icon } from '../ui';
import type { IconName } from '../ui';
import { useDisplay } from '../ui/Display';
import { LOUNGE_ENABLED } from '../features';
import EclassHome from '../school/EclassHome';
import { ECLASS_URL } from '../school/eclassLogic';
import MyLoungeSection from '../lounge/home/MyLoungeSection';
import { HomeTableRow } from './HomeTableRow';
import type { Meeting, Reservation } from '../types';
import './home.css';


interface DashboardData {
  meetings: Meeting[];
  reservations: Reservation[];
}

/** 바로가기 한 칸: 앱 안 경로(to) 또는 바깥 주소(href) 또는 동작(onClick) */
interface Shortcut {
  label: string;
  icon: IconName;
  to?: string;
  state?: unknown;
  href?: string;
  onClick?: () => void;
}

export default function Dashboard() {
  const { weekStart } = useWeek();
  const { openSettings } = useDisplay();
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    // 네 번 나눠 부르면 왕복 비용이 그만큼 쌓이므로 한 번에 받는다.
    let cancelled = false;
    setError(null);
    api
      .get<DashboardData>(`/dashboard?week=${weekStart}`)
      .then((d) => {
        if (cancelled) return;
        setData({
          meetings: d.meetings ?? [],
          reservations: d.reservations ?? [],
        });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : '요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.');
      });
    return () => {
      cancelled = true;
    };
  }, [weekStart, attempt]);

  const retry = () => setAttempt((n) => n + 1);

  const meetings = data?.meetings ?? [];
  const reservations = data?.reservations ?? [];
  const next = reservations[0];

  const shortcuts: Shortcut[] = [
    { label: '내 시간표', icon: 'calendar', to: '/timetable' },
    { label: '회의', icon: 'users', to: '/meetings' },
    { label: '회의 만들기', icon: 'plus', to: '/meetings', state: { sheet: 'create' } },
    ...(LOUNGE_ENABLED
      ? [
          { label: '밥약', icon: 'utensils' as IconName, to: '/lounge' },
          { label: '미팅', icon: 'heart' as IconName, to: '/lounge' },
        ]
      : []),
    { label: 'e-class', icon: 'external', href: ECLASS_URL },
    { label: '내 정보', icon: 'user', to: '/account' },
    { label: '화면 설정', icon: 'text-size', onClick: openSettings },
  ];

  return (
    <>
      <AppHeader />
      <main id="main" className="app-main home-page">
        {/* 화면 제목은 화면 읽기용으로만 둔다 (라우트 이동 때 포커스가 h1 로 간다) */}
        <h1 className="sr-only">홈</h1>

        {error && !data ? (
          <Alert
            tone="danger"
            title="홈 화면을 불러오지 못했습니다."
            actions={
              <Button variant="secondary" onClick={retry}>
                다시 시도하기
              </Button>
            }
          >
            {error}
          </Alert>
        ) : (
          <>
            {/* 1. 옆으로 넘기는 요약 카드: 다음 예약(강조) · 내 회의 */}
            <section className="home-cards" aria-label="오늘 요약">
              <div className="home-cards__track">
                <article className="home-card home-card--accent">
                  <h2 className="home-card__title">다음 예약</h2>
                  <p className="home-card__sub tabular">
                    {!data ? '불러오는 중이에요.' : next ? fmtDate(next.date) : '아직 예정된 예약이 없어요.'}
                  </p>
                  {next && (
                    <p className="home-card__sub tabular">
                      {fmtRange(next.startMin, next.endMin)} · {next.facilityName}
                    </p>
                  )}
                  <Link to="/timetable" className="home-card__more">
                    일정 더 보기
                    <Icon name="chevron-right" />
                  </Link>
                </article>

                <article className="home-card">
                  <h2 className="home-card__title">내 회의</h2>
                  <p className="home-card__sub">
                    {!data ? '불러오는 중이에요.' : meetings.length === 0 ? '참여 중인 회의가 없어요.' : `${meetings.length}개 참여 중`}
                  </p>
                  <div className="home-card__actions">
                    <Link to="/meetings" state={{ sheet: 'create' }} className="home-card__act">
                      <Icon name="plus" />
                      만들기
                    </Link>
                    <Link to="/meetings" className="home-card__act">
                      <Icon name="list" />
                      전체 보기
                    </Link>
                  </div>
                </article>
              </div>
            </section>

            {/* 2. 바로가기 아이콘 줄 */}
            <nav className="home-shortcuts" aria-label="바로가기">
              <ul className="home-shortcuts__list">
                {shortcuts.map((s) => (
                  <li key={s.label}>
                    <ShortcutItem item={s} />
                  </li>
                ))}
              </ul>
            </nav>

            {/* 3. 배너 — 라운지가 켜져 있을 때만 */}
            {LOUNGE_ENABLED && (
              <Link to="/lounge" className="home-banner">
                <span className="home-banner__text">
                  <strong>
                    공강에 같이 밥 먹을 사람,
                    <br />
                    라운지에서 바로 찾기!
                  </strong>
                  <span className="home-banner__sub">밥약 · 미팅 · 단톡방</span>
                </span>
                <span className="home-banner__art" aria-hidden="true">
                  <Icon name="utensils" />
                </span>
              </Link>
            )}

            {/* 4. 미수강 강의 알림(e-class) — 자기 데이터를 따로 불러와 아래 구역과 서로 막지 않는다 */}
            <EclassHome />

            {/* 5. 표: 이름 · 가장 가까운 항목 · 개수. 줄마다 눌러서 해당 화면으로 */}
            <section className="home-table" aria-labelledby="home-table-title">
              <div className="home-sum__head">
                <h2 className="home-sum__title" id="home-table-title">
                  내 일정
                </h2>
                <Link to="/timetable" className="home-sum__link">
                  더 보기
                  <Icon name="chevron-right" />
                </Link>
              </div>
              <ul className="home-table__box">
                <HomeTableRow
                  to={next ? `/meetings/${next.meetingId}` : '/meetings'}
                  label="다가오는 예약"
                  preview={
                    !data
                      ? '불러오는 중이에요.'
                      : next
                        ? `${next.facilityName} · ${fmtDate(next.date)} ${fmtRange(next.startMin, next.endMin)}`
                        : '아직 예정된 예약이 없어요.'
                  }
                  count={reservations.length}
                  countLabel={`예약 ${reservations.length}건`}
                />
                <HomeTableRow
                  to={meetings.length === 1 ? `/meetings/${meetings[0].id}` : '/meetings'}
                  state={data && meetings.length === 0 ? { sheet: 'create' } : undefined}
                  label="내 회의"
                  preview={
                    !data
                      ? '불러오는 중이에요.'
                      : meetings.length === 0
                        ? '참여 중인 회의가 없어요. 눌러서 만들기'
                        : meetings.map((m) => m.name).join(', ')
                  }
                  count={meetings.length}
                  countLabel={`회의 ${meetings.length}개`}
                />
                {/* 라운지 약속은 자기 데이터를 따로 불러와서 위 줄의 로딩·오류와 서로 막지 않는다 */}
                {LOUNGE_ENABLED && <MyLoungeSection />}
              </ul>
            </section>
          </>
        )}
      </main>
    </>
  );
}

function ShortcutItem({ item }: { item: Shortcut }) {
  const inner = (
    <>
      <span className="home-shortcuts__icon" aria-hidden="true">
        <Icon name={item.icon} />
      </span>
      <span className="home-shortcuts__label">{item.label}</span>
    </>
  );
  if (item.href) {
    return (
      <a href={item.href} target="_blank" rel="noreferrer" className="home-shortcuts__item">
        {inner}
      </a>
    );
  }
  if (item.onClick) {
    return (
      <button type="button" onClick={item.onClick} className="home-shortcuts__item">
        {inner}
      </button>
    );
  }
  return (
    <Link to={item.to ?? '/'} state={item.state} className="home-shortcuts__item">
      {inner}
    </Link>
  );
}
