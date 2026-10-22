import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AppHeader } from '../shell/Shell';
import { api } from '../api';
import { useAuth } from '../auth';
import { reservationStatus } from '../reservationStatus';
import { addDaysStr, fmtDate, fmtMin, nowMinutes, todayStr, weekdayOfDate } from '../time';
import { useWeek } from '../useWeek';
import { Alert, Button, Icon } from '../ui';
import { LOUNGE_ENABLED } from '../features';
import EclassHome from '../school/EclassHome';
import MyLoungeSection from '../lounge/home/MyLoungeSection';
import HomeNotices from './HomeNotices';
import type { Meeting, Reservation, TimetableEntry } from '../types';
import './home.css';

/** 오늘 날짜 글자 (한국 시간): "10월 22일 목요일" */
const TODAY_LABEL = () =>
  new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: 'long', day: 'numeric', weekday: 'long' }).format(
    new Date(),
  );

/** 회의 요약은 세 건까지만 표시한다. */
const LIST_LIMIT = 3;

interface DashboardData {
  timetable: TimetableEntry[];
  meetings: Meeting[];
  reservations: Reservation[];
}

/** 그 날짜에 열리는 수업 (매주 반복 + 그날만 있는 일정), 시작 시각 순 */
function classesOn(entries: TimetableEntry[], date: string): TimetableEntry[] {
  const day = weekdayOfDate(date);
  return entries
    .filter((e) => (e.repeatKind === 'once' ? e.date === date : e.day === day))
    .sort((a, b) => a.startMin - b.startMin);
}

/** 오늘 이후 처음으로 수업이 있는 날 (일주일 안). 없으면 null */
function nextClassDay(entries: TimetableEntry[], today: string): { date: string; classes: TimetableEntry[] } | null {
  for (let i = 1; i <= 7; i++) {
    const date = addDaysStr(today, i);
    const classes = classesOn(entries, date);
    if (classes.length) return { date, classes };
  }
  return null;
}

/** 제목 문장: 사람 이름 + 오늘 가장 먼저 챙길 사실 하나 */
function greetingFact(
  remaining: TimetableEntry[],
  todayReservation: Reservation | undefined,
  next: { date: string; classes: TimetableEntry[] } | null,
): string {
  if (remaining.length) return `다음 수업은 ${fmtMin(remaining[0].startMin)} ${remaining[0].title}`;
  if (todayReservation) return `오늘 ${fmtMin(todayReservation.startMin)} 예약이 있어요`;
  if (next) return `오늘은 남은 수업이 없어요`;
  return '이번 주 수업이 비어 있어요';
}

export default function Dashboard() {
  const { user } = useAuth();
  const { weekStart } = useWeek();
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [showReservations, setShowReservations] = useState(false);

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
  const today = todayStr();
  const now = nowMinutes();
  const todayClasses = classesOn(data?.timetable ?? [], today);
  const remaining = todayClasses.filter((c) => c.endMin > now);
  const nextDay = remaining.length ? null : nextClassDay(data?.timetable ?? [], today);
  const todayReservation = reservations.find((r) => r.date === today && r.endMin > now);
  // 오늘 칸에 보여 줄 줄: 남은 수업이 있으면 오늘 것, 없으면 다음 수업 날
  const dayRows = remaining.length ? todayClasses : (nextDay?.classes ?? []);
  const dayLabel = remaining.length ? '오늘' : nextDay ? fmtDate(nextDay.date) : '오늘';

  return (
    <>
      <AppHeader />
      <main id="main" className="app-main home-page">
        <header className="home-head">
          <div className="home-head__text">
            <h1 className="home-head__title">
              {user?.name ? `${user.name}님, ` : ''}
              {data ? greetingFact(remaining, todayReservation, nextDay) : '오늘 일정을 불러오는 중'}
            </h1>
            <p className="home-head__sub tabular">
              {TODAY_LABEL()}
              {data && ` · 수업 ${todayClasses.length}개 · 예약 ${reservations.length}건`}
            </p>
          </div>
          <nav className="home-head__actions" aria-label="빠른 시작">
            <Link to="/meetings" state={{ sheet: 'create' }} className="btn btn--primary btn--sm">
              회의 만들기
            </Link>
            <Link to="/timetable" className="btn btn--secondary btn--sm">
              시간표
            </Link>
          </nav>
        </header>

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
          // 중요도 순서: 미수강 강의 → 오늘 수업 → 다음 예약 → 회의 → 공지 → 라운지 약속.
          // 휴대폰은 이 순서로 한 열, 넓은 화면은 왼쪽(강의·회의) / 오른쪽(오늘·예약·라운지) 두 열로 따로 쌓는다.
          <div className="home-grid">
            <div className="home-col home-col--main">
              <div className="home-panel home-panel--eclass">
                <EclassHome />
              </div>

              {/* 회의·라운지는 접지 않고 처음부터 펼쳐 보여 준다 (한 번 더 누르는 수고를 없앤다) */}
              <section className="home-panel home-panel--meet" aria-labelledby="home-meet-title">
                <div className="home-panel__head">
                  <h2 className="home-panel__title" id="home-meet-title">
                    회의
                  </h2>
                  {data && meetings.length > 0 && (
                    <span className="home-panel__count tabular">{meetings.length}개</span>
                  )}
                </div>
                {!data ? (
                  <p className="home-panel__empty">불러오는 중</p>
                ) : meetings.length === 0 ? (
                  <p className="home-panel__empty">참여 중인 회의가 없어요.</p>
                ) : (
                  <>
                    <ul className="home-rows">
                      {meetings.slice(0, LIST_LIMIT).map((m) => (
                        <li key={m.id}>
                          <Link to={`/meetings/${m.id}`} className="home-row">
                            <span className="home-row__body">
                              <span className="home-row__main">{m.name}</span>
                              <span className="home-row__sub tabular">
                                {m.memberCount ?? 0}명 · 코드 {m.code}
                              </span>
                            </span>
                            <Icon name="chevron-right" className="home-row__chev" />
                          </Link>
                        </li>
                      ))}
                    </ul>
                    <Link to="/meetings" className="home-panel__more">
                      {meetings.length > LIST_LIMIT ? `회의 ${meetings.length}개 모두 보기` : '회의 관리'}
                    </Link>
                  </>
                )}
              </section>

              {/* 공지: 학교 공지 → 내 학과 공지 (최근 2주). 자기 데이터를 따로 불러온다 */}
              <HomeNotices />
            </div>

            <div className="home-col home-col--side">
              <section className="home-panel home-panel--today" aria-labelledby="home-today-title">
                <div className="home-panel__head">
                  <h2 className="home-panel__title" id="home-today-title">
                    {dayLabel} 수업
                  </h2>
                  <Link to="/timetable" className="home-panel__link">
                    시간표
                  </Link>
                </div>
                {!data ? (
                  <p className="home-panel__empty">불러오는 중</p>
                ) : dayRows.length === 0 ? (
                  <p className="home-panel__empty">일주일 안에 등록된 수업이 없어요.</p>
                ) : (
                  <ol className="home-day">
                    {dayRows.map((c) => {
                      const isToday = dayLabel === '오늘';
                      const done = isToday && c.endMin <= now;
                      const isNext = isToday && c === remaining[0];
                      return (
                        <li
                          key={c.id}
                          className={`home-day__row${done ? ' is-done' : ''}${isNext ? ' is-next' : ''}`}
                        >
                          <span className="home-day__time tabular">
                            {fmtMin(c.startMin)}
                            <span className="home-day__end">{fmtMin(c.endMin)}</span>
                          </span>
                          <span className="home-day__body">
                            <span className="home-day__title">{c.title}</span>
                            {c.place && <span className="home-day__place">{c.place}</span>}
                          </span>
                          {done && <span className="sr-only">(끝남)</span>}
                        </li>
                      );
                    })}
                  </ol>
                )}
              </section>

              <section className="home-panel home-panel--res" aria-labelledby="home-res-title">
                <div className="home-panel__head">
                  <h2 className="home-panel__title" id="home-res-title">
                    다음 예약
                  </h2>
                  {reservations.length > 0 && (
                    <span className="home-panel__count tabular">{reservations.length}건</span>
                  )}
                </div>
                {!data ? (
                  <p className="home-panel__empty">불러오는 중</p>
                ) : reservations.length === 0 ? (
                  <p className="home-panel__empty">예정된 예약이 없어요.</p>
                ) : (
                  <>
                    <ul className="home-rows">
                      {(showReservations ? reservations : reservations.slice(0, 1)).map((r, index) => {
                        const status = reservationStatus(r);
                        return (
                          <li key={r.id}>
                            <Link
                              to={`/meetings/${r.meetingId}`}
                              className={`home-row${index === 0 ? ' home-row--next' : ''}`}
                            >
                              <span className="home-row__body">
                                <span className="home-res__when tabular">
                                  <span className="home-res__date">{fmtDate(r.date)}</span>
                                  <span className="home-res__time">
                                    {fmtMin(r.startMin)}–{fmtMin(r.endMin)}
                                  </span>
                                </span>
                                <span className="home-row__main">
                                  {r.facilityName} · {r.building}
                                </span>
                                <span className="home-row__sub">{r.meetingName}</span>
                                <span className={`badge ${status.className} home-res__badge`}>{status.label}</span>
                              </span>
                              <Icon name="chevron-right" className="home-row__chev" />
                            </Link>
                          </li>
                        );
                      })}
                    </ul>
                    {reservations.length > 1 && (
                      <button
                        type="button"
                        className="home-panel__more"
                        aria-expanded={showReservations}
                        onClick={() => setShowReservations((v) => !v)}
                      >
                        {showReservations ? '접기' : `예약 ${reservations.length - 1}건 더 보기`}
                      </button>
                    )}
                  </>
                )}
              </section>

              {/* 라운지 약속은 가장 덜 급한 정보라 맨 아래. 각자 데이터를 불러와 예약 로딩과 독립적이다. */}
              {LOUNGE_ENABLED && (
                <div className="home-panel home-panel--lounge">
                  <MyLoungeSection />
                </div>
              )}
            </div>
          </div>
        )}
      </main>
    </>
  );
}
