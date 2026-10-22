import { useEffect, useState } from 'react';
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

/** 홈에 보여 주는 목록의 최대 개수 — 세 구역이 한 화면에 거의 다 들어오게 3건씩 */
const LIST_LIMIT = 3;

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

  return (
    <>
      <AppHeader />
      <main id="main" className="app-main home-page">
        <header className="home-hero">
          <p className="home-hero__date eyebrow">{TODAY_LABEL()}</p>
          <h1 className="home-hero__title">
            {data && meetings.length > 0 ? `참여 중인 회의 ${meetings.length}개` : '내 일정'}
          </h1>
          <p className="home-hero__intro">
            {data
              ? `다가오는 예약 ${reservations.length}건 · 수업은 내 시간표에서 확인하세요.`
              : '회의와 예약을 확인하고 내 시간표로 이동하세요.'}
          </p>
          <nav className="home-hero__actions" aria-label="빠른 시작">
            <Link to="/meetings" state={{ sheet: 'create' }} className="btn btn--primary">
              회의 만들기 <Icon name="chevron-right" />
            </Link>
            <Link to="/timetable" className="home-hero__secondary">내 시간표 보기</Link>
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
          <div className="home-workspace">
            <section className="section home-primary" aria-labelledby="home-sum-title">
              <h2 className="home-section-title" id="home-sum-title">
                예약과 회의
              </h2>
              <div className="home-sum">
                <section className="home-sum__group" aria-labelledby="home-res-title">
                  <div className="home-sum__head">
                    <h3 className="home-sum__title" id="home-res-title">
                      다가오는 예약
                    </h3>
                    <Link to="/meetings" className="home-sum__link">
                      회의 보기
                    </Link>
                  </div>
                  {!data ? (
                    <p className="home-sum__empty">불러오는 중이에요.</p>
                  ) : reservations.length === 0 ? (
                    <p className="home-sum__empty">아직 예정된 예약이 없어요.</p>
                  ) : (
                    <>
                      <StaggerList className="list home-ul home-reservations">
                        {reservations.slice(0, LIST_LIMIT).map((r, index) => {
                          const status = reservationStatus(r);
                          return (
                            <StaggerItem key={r.id} className={index === 0 ? 'home-reservation--next' : undefined}>
                              <Link to={`/meetings/${r.meetingId}`} className="list__item list__item--link">
                                <div className="list__body">
                                  {index === 0 && <span className="eyebrow home-next-label">다음 예약 · {fmtDate(r.date)}</span>}
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
                      {reservations.length > LIST_LIMIT && (
                        <p className="home-sum__more">
                          예약 {reservations.length}건 중 {LIST_LIMIT}건을 표시했어요.
                        </p>
                      )}
                    </>
                  )}
                </section>

                <section className="home-sum__group" aria-labelledby="home-meet-title">
                  <div className="home-sum__head">
                    <h3 className="home-sum__title" id="home-meet-title">
                      내 회의
                    </h3>
                    <Link to="/meetings" className="home-sum__link">
                      회의 관리하기
                    </Link>
                  </div>
                  {!data ? (
                    <p className="home-sum__empty">불러오는 중이에요.</p>
                  ) : meetings.length === 0 ? (
                    <p className="home-sum__empty">
                      아직 참여 중인 회의가 없어요.{' '}
                      <Link to="/meetings" state={{ sheet: 'create' }}>
                        회의 만들기
                      </Link>
                    </p>
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
                        <p className="home-sum__more">
                          회의 {meetings.length}개 중 {LIST_LIMIT}개를 표시했어요.
                        </p>
                      )}
                    </>
                  )}
                </section>

              </div>
            </section>
            <aside className="home-secondary" aria-label="라운지와 학습 알림">
              {/* 두 구역은 각각 데이터를 불러오므로 예약 로딩과 독립적으로 표시된다. */}
              {LOUNGE_ENABLED && (
                <div className="home-lounge">
                  <p className="home-section-title">함께하는 약속</p>
                  <MyLoungeSection />
                </div>
              )}
              <EclassHome />
            </aside>
          </div>
        )}
      </main>
    </>
  );
}
