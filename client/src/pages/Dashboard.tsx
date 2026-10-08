import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AppHeader } from '../shell/Shell';
import { api } from '../api';
import { useAuth } from '../auth';
import TimetableGrid, { WeekNav } from '../components/TimetableGrid';
import type { GridEntry } from '../components/TimetableGrid';
import { reservationsToEntries } from '../gridEntries';
import { reservationStatus } from '../reservationStatus';
import { fmtDate, fmtDayHeader, fmtRange, fmtWeekLabel, isCurrentWeek, weekDates } from '../time';
import { useWeek } from '../useWeek';
import { Alert, Button, EmptyState, Icon, LoadingBlock, btnClass } from '../ui';
import { LOUNGE_ENABLED } from '../features';
import MyLoungeSection from '../lounge/home/MyLoungeSection';
import type { Meeting, Reservation, TimetableEntry } from '../types';
import './home.css';

/** 홈에 보여 주는 목록의 최대 개수 */
const LIST_LIMIT = 5;

interface DashboardData {
  timetable: TimetableEntry[];
  meetings: Meeting[];
  reservations: Reservation[];
  weekReservations: Reservation[];
}

export default function Dashboard() {
  const { user } = useAuth();
  const { weekStart, slide, prevWeek, nextWeek, goToday } = useWeek();
  const [data, setData] = useState<DashboardData | null>(null);
  /** data 가 어느 주 기준으로 받은 것인지 (주가 바뀌면 다시 받는 동안 이전 주 일정이 섞여 보이지 않게 한다) */
  const [loadedWeek, setLoadedWeek] = useState<string | null>(null);
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
          timetable: d.timetable ?? [],
          meetings: d.meetings ?? [],
          reservations: d.reservations ?? [],
          weekReservations: d.weekReservations ?? [],
        });
        setLoadedWeek(weekStart);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : '요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.');
      });
    return () => {
      cancelled = true;
    };
  }, [weekStart, attempt]);

  const weekReady = loadedWeek === weekStart;
  const weekLoading = !error && !weekReady;

  const gridEntries = useMemo<GridEntry[]>(() => {
    if (!data || !weekReady) return [];
    return [
      ...data.timetable.map((e) => ({
        ...e,
        kind: 'class' as const,
        subtitle: e.repeatKind === 'once' ? `${fmtDayHeader(e.date ?? '')} 하루만` : undefined,
      })),
      ...reservationsToEntries(data.weekReservations),
    ];
  }, [data, weekReady]);

  const retry = () => setAttempt((n) => n + 1);

  const dates = weekDates(weekStart);
  const weekRange = `${fmtDayHeader(dates[0])} ~ ${fmtDayHeader(dates[dates.length - 1])}`;

  const meetings = data?.meetings ?? [];
  const reservations = data?.reservations ?? [];

  return (
    <>
      <AppHeader />
      <main id="main" className="app-main home-page">
        <div className="page-head">
          <h1 className="page-title">홈</h1>
          <p className="page-lead">
            {user?.name}님, 안녕하세요. 시간표를 모으고, 함께 모일 시간과 공간을 찾아보세요.
          </p>
        </div>

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
            {/* 1. 다가오는 예약 — 가장 급한 정보부터 */}
            <section className="section" aria-labelledby="home-res-title">
              <div className="section__head">
                <h2 className="section__title" id="home-res-title">
                  다가오는 예약
                </h2>
              </div>
              {!data ? (
                <div className="card">
                  <LoadingBlock>예약을 불러오는 중입니다.</LoadingBlock>
                </div>
              ) : reservations.length === 0 ? (
                <div className="card">
                  <EmptyState
                    icon="calendar"
                    title="아직 예정된 예약이 없습니다."
                    description="회의 화면에서 모일 시설을 정하면 이곳에 표시됩니다."
                    action={
                      <Link to="/meetings" className={btnClass({ variant: 'secondary' })}>
                        회의 보기
                      </Link>
                    }
                  />
                </div>
              ) : (
                <>
                  <div className="card home-card--rows">
                    <ul className="list home-ul">
                      {reservations.slice(0, LIST_LIMIT).map((r) => {
                        const status = reservationStatus(r);
                        return (
                          <li key={r.id}>
                            <Link to={`/meetings/${r.meetingId}`} className="list__item list__item--link">
                              <div className="list__body">
                                <div className="list__main">
                                  {r.facilityName} · {r.building}
                                </div>
                                <div className="list__sub tabular">
                                  {fmtDate(r.date)} {fmtRange(r.startMin, r.endMin)}
                                </div>
                                <div className="list__sub">{r.meetingName}</div>
                                <span className={`badge ${status.className} home-badge`}>{status.label}</span>
                              </div>
                              <Icon name="chevron-right" className="list__chev" />
                            </Link>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                  {reservations.length > LIST_LIMIT && (
                    <p className="home-more">
                      예약 {reservations.length}건 중 {LIST_LIMIT}건을 표시했습니다. 나머지는 각 회의 화면에서 확인해
                      주세요.
                    </p>
                  )}
                </>
              )}
            </section>

            {/* 2. 내 회의 */}
            <section className="section" aria-labelledby="home-meet-title">
              <div className="section__head">
                <h2 className="section__title" id="home-meet-title">
                  내 회의
                </h2>
                <Link to="/meetings" className={btnClass({ variant: 'text' })}>
                  회의 관리하기
                </Link>
              </div>
              {!data ? (
                <div className="card">
                  <LoadingBlock>회의를 불러오는 중입니다.</LoadingBlock>
                </div>
              ) : meetings.length === 0 ? (
                <div className="card">
                  <EmptyState
                    icon="users"
                    title="아직 참여 중인 회의가 없습니다."
                    description="회의를 만들거나, 받은 코드로 참가할 수 있습니다."
                    action={
                      <div className="home-empty-actions">
                        <Link
                          to="/meetings"
                          state={{ sheet: 'create' }}
                          className={btnClass({ variant: 'secondary' })}
                        >
                          회의 만들기
                        </Link>
                        <Link
                          to="/meetings"
                          state={{ sheet: 'join' }}
                          className={btnClass({ variant: 'tertiary' })}
                        >
                          코드로 참가하기
                        </Link>
                      </div>
                    }
                  />
                </div>
              ) : (
                <>
                  <div className="card home-card--rows">
                    <ul className="list home-ul">
                      {meetings.slice(0, LIST_LIMIT).map((m) => (
                        <li key={m.id}>
                          <Link to={`/meetings/${m.id}`} className="list__item list__item--link">
                            <div className="list__body">
                              <div className="list__main">{m.name}</div>
                              <div className="list__sub">멤버 {m.memberCount ?? 0}명</div>
                            </div>
                            <span className="badge badge--gray code-chip">
                              <span className="sr-only">회의 코드 </span>
                              {m.code}
                            </span>
                            <Icon name="chevron-right" className="list__chev" />
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </div>
                  {meetings.length > LIST_LIMIT && (
                    <p className="home-more">
                      회의 {meetings.length}개 중 {LIST_LIMIT}개를 표시했습니다. 전체 목록은 회의 관리하기에서 볼 수
                      있습니다.
                    </p>
                  )}
                </>
              )}
            </section>

            {/* 3. 내 라운지 약속 — 자기 데이터를 따로 불러와서 위 구역의 로딩·오류와 서로 막지 않는다 */}
            {LOUNGE_ENABLED && <MyLoungeSection />}

            {/* 4. 내 시간표 (미리보기) */}
            <section className="section" aria-labelledby="home-tt-title">
              <div className="section__head">
                <h2 className="section__title" id="home-tt-title">
                  내 시간표
                </h2>
                <Link to="/timetable" className={btnClass({ variant: 'text' })}>
                  시간표 편집하기
                </Link>
              </div>
              {!data && !error ? (
                <div className="card">
                  <LoadingBlock>시간표를 불러오는 중입니다.</LoadingBlock>
                </div>
              ) : (
                <div className="home-tt" aria-busy={weekLoading || undefined}>
                  <WeekNav
                    compact
                    label={fmtWeekLabel(weekStart)}
                    sub={weekRange}
                    onPrev={prevWeek}
                    onNext={nextWeek}
                    busy={weekLoading}
                  />
                  {!isCurrentWeek(weekStart) && (
                    <div className="home-today">
                      <Button variant="text" onClick={goToday}>
                        이번 주로
                      </Button>
                    </div>
                  )}
                  {error && (
                    <div className="home-grid-alert">
                      <Alert
                        tone="danger"
                        title="시간표를 불러오지 못했습니다."
                        actions={
                          <Button variant="secondary" onClick={retry}>
                            다시 시도하기
                          </Button>
                        }
                      >
                        {error}
                      </Alert>
                    </div>
                  )}
                  <TimetableGrid entries={gridEntries} compact weekStart={weekStart} slide={slide} />
                  <p className="home-more">수업이나 예약 블록을 누르면 자세한 내용을 볼 수 있습니다.</p>
                </div>
              )}
            </section>
          </>
        )}
      </main>
    </>
  );
}
