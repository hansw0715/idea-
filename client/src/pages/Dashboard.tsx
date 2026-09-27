import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import TimetableGrid from '../components/TimetableGrid';
import type { GridEntry } from '../components/TimetableGrid';
import { reservationsToEntries } from './TimetablePage';
import { fmtDate, fmtRange, fmtWeekLabel, fmtDayHeader, isCurrentWeek } from '../time';
import { useWeek } from '../useWeek';
import type { Meeting, Reservation, TimetableEntry } from '../types';

export default function Dashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { weekStart, slide, prevWeek, nextWeek, goToday } = useWeek();
  const [entries, setEntries] = useState<TimetableEntry[]>([]);
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [weekReservations, setWeekReservations] = useState<Reservation[]>([]);

  useEffect(() => {
    // 네 번 나눠 부르면 왕복 비용이 그만큼 쌓이므로 한 번에 받는다.
    api
      .get<{
        timetable: TimetableEntry[];
        meetings: Meeting[];
        reservations: Reservation[];
        weekReservations: Reservation[];
      }>(`/dashboard?week=${weekStart}`)
      .then((d) => {
        setEntries(d.timetable);
        setMeetings(d.meetings);
        setReservations(d.reservations);
        setWeekReservations(d.weekReservations ?? []);
      })
      .catch(() => undefined);
  }, [weekStart]);

  const gridEntries: GridEntry[] = [
    ...entries.map((e) => ({
      ...e,
      kind: 'class' as const,
      subtitle: e.repeatKind === 'once' ? `${fmtDayHeader(e.date ?? '')} 하루만` : undefined,
    })),
    ...reservationsToEntries(weekReservations),
  ];

  return (
    <main className="page">
      <h1 className="page-title">안녕하세요, {user?.name}님</h1>
      <p className="page-sub">시간표를 모으고, 함께 모일 시간과 공간을 찾아보세요.</p>

      <div className="grid-side">
        <section className="card">
          <div className="week-bar" style={{ marginBottom: 12 }}>
            <h2 className="card-title" style={{ margin: 0 }}>
              내 시간표
            </h2>
            <span className="week-label" style={{ fontSize: 14, color: 'var(--slate-3)' }}>
              {fmtWeekLabel(weekStart)}
            </span>
            {!isCurrentWeek(weekStart) && (
              <button type="button" className="btn btn-outline btn-sm" onClick={goToday}>
                이번 주로
              </button>
            )}
          </div>
          <TimetableGrid
            entries={gridEntries}
            compact
            weekStart={weekStart}
            onPrevWeek={prevWeek}
            onNextWeek={nextWeek}
            slide={slide}
          />
          <p style={{ marginTop: 16, marginBottom: 0 }}>
            <Link to="/timetable">시간표 편집하기</Link>
          </p>
        </section>

        <div>
          <section className="card">
            <h2 className="card-title">내 회의</h2>
            {meetings.length === 0 ? (
              <p className="empty-note">아직 참여 중인 회의가 없습니다.</p>
            ) : (
              <div className="row-list">
                {meetings.slice(0, 5).map((m) => (
                  <div
                    key={m.id}
                    className="row-item linkable"
                    onClick={() => navigate(`/meetings/${m.id}`)}
                  >
                    <div className="grow">
                      <div className="row-main">{m.name}</div>
                      <div className="row-sub">멤버 {m.memberCount}명</div>
                    </div>
                    <span className="badge badge-neutral code-badge">{m.code}</span>
                  </div>
                ))}
              </div>
            )}
            <p style={{ marginTop: 12, marginBottom: 0 }}>
              <Link to="/meetings">회의 관리하기</Link>
            </p>
          </section>

          <section className="card">
            <h2 className="card-title">다가오는 예약</h2>
            {reservations.length === 0 ? (
              <p className="empty-note">예약된 시설이 없습니다.</p>
            ) : (
              <div className="row-list">
                {reservations.slice(0, 5).map((r) => (
                  <div key={r.id} className="row-item">
                    <div className="grow">
                      <div className="row-main">
                        {r.facilityName} · {r.building}
                      </div>
                      <div className="row-sub">
                        {fmtDate(r.date)} {fmtRange(r.startMin, r.endMin)} · {r.meetingName}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}
