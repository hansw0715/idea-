import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AppHeader } from '../shell/Shell';
import { api } from '../api';
import { reservationStatus } from '../reservationStatus';
import { fmtDate, fmtRange } from '../time';
import { useWeek } from '../useWeek';
import { Alert, Button, Icon } from '../ui';
import { LOUNGE_ENABLED } from '../features';
import EclassHome from '../school/EclassHome';
import MyLoungeSection from '../lounge/home/MyLoungeSection';
import type { Meeting, Reservation } from '../types';
import './home.css';

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
        {/* 왼쪽 위 "홈" 제목 + 오른쪽 오늘 날짜 */}
        <header className="home-hero">
          <div className="home-hero__who">
            <span className="home-hero__mark" aria-hidden="true">
              <Icon name="home" />
            </span>
            <h1 className="home-hero__title">홈</h1>
          </div>
          <p className="home-hero__date">{TODAY_LABEL()}</p>
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
          <>
            {/* 0. 미수강 강의 알림(e-class) — 홈 첫 화면 맨 위. 자기 데이터를 따로 불러와 아래 구역의 로딩·오류와 서로 막지 않는다 */}
            <EclassHome />

            {/* 1~3. 다가오는 예약 · 내 회의 · 내 라운지 약속 — 한 상자 안에서 위에서 아래로 */}
            <section className="section" aria-labelledby="home-sum-title">
              <h2 className="sr-only" id="home-sum-title">
                내 일정
              </h2>
              <div className="card home-card--rows home-sum">
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
                                    {fmtDate(r.date)} {fmtRange(r.startMin, r.endMin)} · {r.meetingName}
                                  </div>
                                </div>
                                <span className={`badge ${status.className} home-badge`}>{status.label}</span>
                                <Icon name="chevron-right" className="list__chev" />
                              </Link>
                            </li>
                          );
                        })}
                      </ul>
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
                      {meetings.length > LIST_LIMIT && (
                        <p className="home-sum__more">
                          회의 {meetings.length}개 중 {LIST_LIMIT}개를 표시했어요.
                        </p>
                      )}
                    </>
                  )}
                </section>

                {/* 라운지 약속은 자기 데이터를 따로 불러와서 위 묶음의 로딩·오류와 서로 막지 않는다 */}
                {LOUNGE_ENABLED && <MyLoungeSection />}
              </div>
            </section>
          </>
        )}
      </main>
    </>
  );
}
