import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { AppHeader } from '../shell/Shell';
import { api } from '../api';
import { reservationStatus } from '../reservationStatus';
import { fmtDate, fmtMin } from '../time';
import { useWeek } from '../useWeek';
import { Alert, Button, Icon } from '../ui';
import { LOUNGE_ENABLED } from '../features';
import EclassHome from '../school/EclassHome';
import MyLoungeSection from '../lounge/home/MyLoungeSection';
import type { Meeting, Reservation } from '../types';
import './home.css';
import { StaggerList, StaggerItem } from '../ui/motion';

/** 오늘 날짜 글자 (한국 시간): "10월 11일 (일)" */
const TODAY_LABEL = () =>
  new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: 'long', day: 'numeric', weekday: 'short' }).format(
    new Date(),
  );

/** 접어 둔 회의 요약은 세 건까지만 표시한다. */
const LIST_LIMIT = 3;

interface DashboardData {
  meetings: Meeting[];
  reservations: Reservation[];
}

export default function Dashboard() {
  const { weekStart } = useWeek();
  const mainRef = useRef<HTMLElement>(null);
  const [wide, setWide] = useState(false);
  const [meetingsOpen, setMeetingsOpen] = useState(false);
  const [loungeOpen, setLoungeOpen] = useState(false);

  useEffect(() => {
    const main = mainRef.current;
    if (!main) return;
    const observer = new ResizeObserver(([entry]) => {
      const rem = parseFloat(getComputedStyle(document.documentElement).fontSize);
      setWide(entry.contentRect.width >= 64 * rem);
    });
    observer.observe(main);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    setMeetingsOpen(wide);
    setLoungeOpen(false);
  }, [wide]);
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

  return (
    <>
      <AppHeader />
      <main ref={mainRef} id="main" className="app-main home-page">
        {/* 첫 화면은 날짜 한 줄 + 바로가기 두 개만. 설명 문장은 두지 않는다. */}
        <header className="home-hero">
          <h1 className="home-hero__title">{TODAY_LABEL()}</h1>
          <nav className="home-hero__actions" aria-label="빠른 시작">
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
          // 중요도 순서: 미수강 강의 → 다음 예약 → 내 회의 → 라운지 약속.
          // 좁은 화면은 이 순서대로 한 열, 넓은 화면은 grid-area로 두 열에 배치한다.
          <div className="home-workspace home-sum">
                <div className="home-area--eclass">
                  <EclassHome />
                </div>
                <div className="home-agenda">
                <section className="home-sum__group home-area--res" aria-labelledby="home-res-title">
                  <div className="home-sum__head">
                    <h2 className="home-sum__title" id="home-res-title">
                      다음 예약
                    </h2>
                  </div>
                  {!data ? (
                    <p className="home-sum__empty">불러오는 중</p>
                  ) : reservations.length === 0 ? (
                    <p className="home-sum__empty">예정된 예약 없음</p>
                  ) : (
                    <>
                      <StaggerList className="list home-ul home-reservations">
                        {(showReservations ? reservations : reservations.slice(0, 1)).map((r, index) => {
                          const status = reservationStatus(r);
                          return (
                            <StaggerItem key={r.id} className={index === 0 ? 'home-reservation--next' : undefined}>
                              <Link to={`/meetings/${r.meetingId}`} className="list__item list__item--link">
                                <div className="list__body">
                                  {index === 0 && <span className="eyebrow home-next-label">다음 · {fmtDate(r.date)}</span>}
                                  <div className="home-reservation__time mono">
                                    <span>{fmtMin(r.startMin)}</span><wbr /><span>~{fmtMin(r.endMin)}</span>
                                  </div>
                                  <div className="list__main">
                                    {r.facilityName} · {r.building}
                                  </div>
                                  <div className="list__sub tabular">
                                    {index !== 0 && `${fmtDate(r.date)} · `}{r.meetingName}
                                  </div>
                                </div>
                                <span className={`badge ${status.className} home-badge`}>{status.label}</span>
                                <Icon name="chevron-right" className="list__chev" />
                              </Link>
                            </StaggerItem>
                          );
                        })}
                      </StaggerList>
                      {reservations.length > 1 && (
                        <Button variant="text" block aria-expanded={showReservations} onClick={() => setShowReservations(v => !v)}>
                          {showReservations ? '예약 접기' : `예약 ${reservations.length - 1}건 더 보기`}
                        </Button>
                      )}
                    </>
                  )}
                </section>

                <details className="home-sum__group home-area--meet home-disclosure" open={meetingsOpen} onToggle={event => setMeetingsOpen(event.currentTarget.open)}>
                  <summary>회의 <span>{meetings.length}개</span></summary>
                <section aria-labelledby="home-meet-title">
                  <div className="home-sum__head">
                    <h2 className="home-sum__title" id="home-meet-title">
                      회의
                    </h2>
                    <Link to="/meetings" className="home-sum__link">
                      전체
                    </Link>
                  </div>
                  {!data ? (
                    <p className="home-sum__empty">불러오는 중</p>
                  ) : meetings.length === 0 ? (
                    <p className="home-sum__empty">참여 중인 회의 없음</p>
                  ) : (
                    <>
                      <StaggerList className="list home-ul">
                        {meetings.slice(0, LIST_LIMIT).map((m) => (
                          <StaggerItem key={m.id}>
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
                          </StaggerItem>
                        ))}
                      </StaggerList>
                      {meetings.length > LIST_LIMIT && (
                        <p className="home-sum__more">외 {meetings.length - LIST_LIMIT}개</p>
                      )}
                    </>
                  )}
                </section>
                </details>

                {/* 라운지 약속은 가장 덜 급한 정보라 맨 아래. 각자 데이터를 불러와 예약 로딩과 독립적이다. */}
                {LOUNGE_ENABLED && (
                  <details className="home-lounge home-area--lounge home-disclosure" open={loungeOpen} onToggle={event => setLoungeOpen(event.currentTarget.open)}>
                    <summary>라운지 약속</summary>
                    <MyLoungeSection />
                  </details>
                )}
                </div>
          </div>
        )}
      </main>
    </>
  );
}
