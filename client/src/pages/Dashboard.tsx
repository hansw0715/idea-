import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AppHeader } from '../shell/Shell';
import { api } from '../api';
import { fmtDate, fmtRange } from '../time';
import { useWeek } from '../useWeek';
import { Alert, Button, Icon } from '../ui';
import { LOUNGE_ENABLED } from '../features';
import EclassHome from '../school/EclassHome';
import MyLoungeSection from '../lounge/home/MyLoungeSection';
import { HomeTableRow } from './HomeTableRow';
import HomeNotices from './HomeNotices';
import type { Meeting, Reservation } from '../types';
import './home.css';

/** 오늘 날짜 글자 (한국 시간): "10월 11일 (일)" */
const TODAY_LABEL = () =>
  new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: 'long', day: 'numeric', weekday: 'short' }).format(
    new Date(),
  );


interface DashboardData {
  meetings: Meeting[];
  reservations: Reservation[];
}


export default function Dashboard() {
  const { weekStart } = useWeek();
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


  return (
    <>
      {/* 오늘 날짜는 헤더 오른쪽, 글자 설정(AA) 왼쪽에 작게 */}
      <AppHeader actions={<span className="app-header__date">{TODAY_LABEL()}</span>} />
      <main id="main" className="app-main home-page">
        {/* 학교 이름 + 오늘 날짜 */}
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


            {/* 3. 배너 — 라운지가 켜져 있을 때만 */}
            {LOUNGE_ENABLED && (
              <Link to="/lounge" className="home-banner">
                <span className="home-banner__text">
                  <strong>
                    공강에 같이 밥 먹을 사람,
                    <br />
                    라운지에서 바로 찾기!
                  </strong>
                </span>
                <span className="home-banner__art" aria-hidden="true">
                  <Icon name="utensils" />
                </span>
              </Link>
            )}

            {/* 공지: 학교 공지 → 내 학과 공지 (최근 2주). 자기 데이터를 따로 불러온다 */}
            <HomeNotices />

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

