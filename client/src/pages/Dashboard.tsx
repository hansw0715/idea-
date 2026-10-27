import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import { Link } from "react-router-dom";
import { AppHeader } from "../shell/Shell";
import { useAuth } from "../auth";
import { api } from "../api";
import {
  DAY_NAMES,
  currentWeekStart,
  fmtDate,
  fmtRange,
  todayStr,
  weekDates,
  addDaysStr,
  fmtWeekLabel,
  visibleDayCount,
} from "../time";
import { useWeek } from "../useWeek";
import { homeWeekStart } from "../homeSchedule";
import { Alert, Button, Icon } from "../ui";
import EclassHomeCard from "../school/EclassHomeCard";
import HomeNotifications from "../notifications/HomeNotifications";
import HomeNotices from "./HomeNotices";
import Avatar from "../lounge/parts/Avatar";
import { useLoungeOptional } from "../lounge/LoungeContext";
import type { Meeting, Reservation, TimetableEntry } from "../types";
import "./home.css";

interface DashboardData {
  meetings: Meeting[];
  reservations: Reservation[];
  timetable: TimetableEntry[];
  weekReservations: Reservation[];
}

export default function Dashboard() {
  const { user } = useAuth();
  const profile = useLoungeOptional()?.profile;
  const { weekStart, prevWeek, nextWeek, goToday } = useWeek(
    homeWeekStart(todayStr()),
  );
  const currentWeek = currentWeekStart();
  const weekLabel =
    weekStart === currentWeek
      ? "이번 주 일정"
      : weekStart === addDaysStr(currentWeek, 7)
        ? "다음 주 일정"
        : "주간 일정";
  // 주말 일정이 있으면 토·일 칸까지 보이므로, 날짜는 일주일 전부 들고 있다
  const dates = weekDates(weekStart, DAY_NAMES.length);
  const today = todayStr();
  const [day, setDay] = useState(() => Math.max(0, dates.indexOf(today)));
  const [loaded, setLoaded] = useState<{
    week: string;
    data: DashboardData;
  } | null>(() => {
    const data = api.cached<DashboardData>(`/dashboard?week=${weekStart}`);
    return data ? { week: weekStart, data } : null;
  });
  const data = loaded?.week === weekStart ? loaded.data : null;
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    api
      .get<DashboardData>(`/dashboard?week=${weekStart}`)
      .then((d) => {
        if (!cancelled) setLoaded({ week: weekStart, data: d });
      })
      .catch((err: unknown) => {
        if (!cancelled)
          setError(
            err instanceof Error ? err.message : "홈을 불러오지 못했습니다.",
          );
      });
    return () => {
      cancelled = true;
    };
  }, [weekStart, attempt]);

  const changeWeek = (direction: "prev" | "next" | "today") => {
    setDay(0);
    if (direction === "prev") prevWeek();
    else if (direction === "next") nextWeek();
    else goToday();
  };

  const dayCount = visibleDayCount([
    ...(data?.timetable ?? [])
      .filter((e) => e.repeatKind !== "once" || dates.includes(e.date ?? ""))
      .map((e) => e.day),
    ...(data?.weekReservations ?? []).map((r) => dates.indexOf(r.date)),
  ]);
  // 고른 날이 보이는 칸 밖(주말 칸이 사라진 주)이면 월요일로
  useEffect(() => {
    if (day >= dayCount) setDay(0);
  }, [day, dayCount]);

  const classesFor = (index: number) =>
    (data?.timetable ?? []).filter(
      (e) =>
        e.day === index && (e.repeatKind !== "once" || e.date === dates[index]),
    );
  const bookedFor = (index: number) =>
    (data?.weekReservations ?? []).filter((r) => r.date === dates[index]);
  const agenda = [
    ...classesFor(day).map((e) => ({
      key: `class-${e.id}`,
      title: e.title,
      place: e.place,
      start: e.startMin,
      end: e.endMin,
      to: `/timetable?week=${weekStart}`,
      kind: "수업·일정",
    })),
    ...bookedFor(day).map((r) => ({
      key: `reservation-${r.id}`,
      title: r.meetingName,
      place: r.facilityName,
      start: r.startMin,
      end: r.endMin,
      to: `/meetings/${r.meetingId}`,
      kind: "시설 예약",
    })),
  ].sort((a, b) => a.start - b.start);

  return (
    <>
      <AppHeader />
      <main id="main" className="app-main home-page">
        <div className="home-heading">
          <div>
            <h1 className="page-title">{user?.name}님, 안녕하세요.</h1>
            <p className="page-lead">
              {new Intl.DateTimeFormat("ko-KR", {
                timeZone: "Asia/Seoul",
                month: "long",
                day: "numeric",
                weekday: "long",
              }).format(new Date())}{" "}
              · 한성대학교
            </p>
          </div>
          <Avatar user={profile ?? { avatarColor: 'm1' }} size="lg" className="home-profile" label={`${user?.name ?? '내'} 프로필 이미지`} />
        </div>
        {error && (
          <Alert
            tone="danger"
            title="일정을 불러오지 못했습니다."
            actions={
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setAttempt((n) => n + 1)}
              >
                다시 시도
              </Button>
            }
          >
            {error}
            {data ? " 마지막으로 불러온 내용을 보여드립니다." : ""}
          </Alert>
        )}
        <div className="dashboard-layout">
          <section
            className="home-panel"
            aria-labelledby="home-week-title"
            aria-busy={!data && !error}
          >
            <div className="home-sum__head">
              <h2 className="home-sum__title" id="home-week-title">
                {weekLabel}
              </h2>
              <Link
                to={`/timetable?week=${weekStart}`}
                className="home-sum__link"
              >
                전체 시간표
                <Icon name="chevron-right" />
              </Link>
            </div>
            <div
              className="home-week-nav"
              role="group"
              aria-label="주간 일정 이동"
            >
              <button
                type="button"
                className="btn btn--icon"
                aria-label="이전 주 일정"
                onClick={() => changeWeek("prev")}
              >
                <Icon name="chevron-left" />
              </button>
              <span className="home-week-nav__range tabular">
                {fmtWeekLabel(weekStart)}
                <small>
                  {Number(dates[0].slice(5, 7))}.{Number(dates[0].slice(8))} –{" "}
                  {Number(dates[4].slice(5, 7))}.{Number(dates[4].slice(8))}
                </small>
              </span>
              <button
                type="button"
                className="home-week-nav__today"
                onClick={() => changeWeek("today")}
              >
                이번 주
              </button>
              <button
                type="button"
                className="btn btn--icon"
                aria-label="다음 주 일정"
                onClick={() => changeWeek("next")}
              >
                <Icon name="chevron-right" />
              </button>
            </div>
            <div
              className={`home-week${dayCount > 5 ? " home-week--weekend" : ""}`}
              role="group"
              aria-label="일정을 볼 날짜"
              style={{ "--home-days": dayCount } as CSSProperties}
            >
              {DAY_NAMES.slice(0, dayCount).map((name, i) => (
                <button
                  key={name}
                  type="button"
                  className={`home-week__day${dates[i] === today ? " is-today" : ""}`}
                  aria-pressed={day === i}
                  onClick={() => setDay(i)}
                >
                  <span>{name}</span>
                  <strong className="tabular">
                    {Number(dates[i].slice(-2))}
                  </strong>
                  <span className="home-week__count">
                    {data
                      ? `${classesFor(i).length + bookedFor(i).length}개`
                      : "—"}
                  </span>
                  {dates[i] === today && <span className="sr-only">오늘</span>}
                </button>
              ))}
            </div>
            <div className="home-agenda" aria-live="polite">
              <h3 className="home-agenda__label">
                {fmtDate(dates[day])}
                {dates[day] === today ? " · 오늘" : ""}
              </h3>
              {!data ? (
                <p className="home-empty">
                  {error
                    ? "일정을 확인할 수 없습니다."
                    : "일정을 불러오는 중입니다."}
                </p>
              ) : agenda.length === 0 ? (
                <div className="home-empty">
                  <p>등록된 일정이 없습니다.</p>
                  <Link to={`/timetable?week=${weekStart}`}>
                    시간표에 일정 추가하기
                    <Icon name="plus" />
                  </Link>
                </div>
              ) : (
                <ul>
                  {agenda.slice(0, 4).map((item) => (
                    <li key={item.key}>
                      <Link to={item.to} className="home-agenda__row">
                        <span className="home-agenda__time tabular">
                          {fmtRange(item.start, item.end)}
                        </span>
                        <span className="home-agenda__body">
                          <strong>{item.title}</strong>
                          <span>{item.place || item.kind}</span>
                        </span>
                        <Icon name="chevron-right" />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
              {agenda.length > 4 && (
                <Link to={`/timetable?week=${weekStart}`} className="home-sum__link">
                  나머지 {agenda.length - 4}개 일정 보기
                  <Icon name="chevron-right" />
                </Link>
              )}
            </div>
          </section>
          <HomeNotifications />
          <EclassHomeCard />
          <HomeNotices compact />
        </div>
      </main>
    </>
  );
}
