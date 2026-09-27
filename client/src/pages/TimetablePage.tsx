import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { api } from '../api';
import TimetableGrid from '../components/TimetableGrid';
import type { GridEntry, SelectedRange } from '../components/TimetableGrid';
import CourseSearch from '../components/CourseSearch';
import type { Course } from '../components/CourseSearch';
import {
  DAY_NAMES,
  OPEN_MIN,
  CLOSE_MIN,
  STEP_MIN,
  fmtMin,
  fmtDate,
  timeOptions,
  weekdayOfDate,
  weekDates,
  fmtDayHeader,
  fmtWeekLabel,
  isCurrentWeek,
} from '../time';
import { useWeek } from '../useWeek';
import type { Reservation, TimetableEntry } from '../types';

/** 확정된 예약을 요일 기준 시간표 블록으로 바꾼다. */
export function reservationsToEntries(reservations: Reservation[]): GridEntry[] {
  return reservations
    .map((r) => ({
      id: r.id,
      day: weekdayOfDate(r.date),
      startMin: r.startMin,
      endMin: r.endMin,
      title: r.meetingName,
      subtitle: `${fmtDate(r.date)} · ${r.facilityName}`,
      kind: 'reservation' as const,
    }))
    .filter((e) => e.day >= 0 && e.day < DAY_NAMES.length);
}

export default function TimetablePage() {
  const { weekStart, slide, prevWeek, nextWeek, goToday } = useWeek();
  const [entries, setEntries] = useState<TimetableEntry[]>([]);
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [range, setRange] = useState<SelectedRange | null>(null);
  const [title, setTitle] = useState('');
  const [place, setPlace] = useState('');
  // 'weekly' = 매주 반복, 'once' = 고른 그 날만
  const [repeatKind, setRepeatKind] = useState<'weekly' | 'once'>('weekly');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);

  function load() {
    // 시간표와 예약을 한 번의 요청으로 함께 받는다. 보고 있는 주만 받아 온다.
    api
      .get<{ timetable: TimetableEntry[]; weekReservations: Reservation[] }>(
        `/dashboard?week=${weekStart}`,
      )
      .then((d) => {
        setEntries(d.timetable);
        setReservations(d.weekReservations ?? []);
      })
      .catch(() => undefined);
  }

  useEffect(load, [weekStart]);

  const gridEntries: GridEntry[] = [
    ...entries.map((e) => ({
      ...e,
      kind: 'class' as const,
      // 그 주에만 있는 일정은 블록 안에서도 구분되게 한다.
      subtitle: e.repeatKind === 'once' ? `${fmtDayHeader(e.date ?? '')} 하루만` : undefined,
    })),
    ...reservationsToEntries(reservations),
  ];

  // 드래그로 고른 요일이 보고 있는 주에서 실제로 며칠인지.
  const rangeDate = range ? weekDates(weekStart)[range.day] : null;

  function selectRange(next: SelectedRange) {
    setRange(next);
    setError(null);
    // 시간을 잡자마자 바로 과목명을 칠 수 있게 한다.
    window.setTimeout(() => titleRef.current?.focus(), 0);
  }

  function cancelRange() {
    setRange(null);
    setTitle('');
    setPlace('');
    setRepeatKind('weekly');
    setError(null);
  }

  async function saveEntry(e: FormEvent) {
    e.preventDefault();
    if (!range) return;
    setError(null);
    setPending(true);
    try {
      await api.post('/timetable', {
        day: range.day,
        startMin: range.startMin,
        endMin: range.endMin,
        title,
        place,
        repeatKind,
        date: rangeDate,
      });
      cancelRange();
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : '일정을 추가하지 못했습니다.');
    } finally {
      setPending(false);
    }
  }

  /** 검색한 과목의 대면 시간대를 모두 시간표에 담는다. */
  async function addCourse(course: Course): Promise<string | null> {
    const failures: string[] = [];
    for (const slot of course.slots) {
      try {
        await api.post('/timetable', {
          day: slot.day,
          startMin: slot.startMin,
          endMin: slot.endMin,
          title: course.name,
          place: course.room,
        });
      } catch (err) {
        failures.push(err instanceof Error ? err.message : '추가 실패');
      }
    }
    load();
    if (failures.length === course.slots.length) {
      return `'${course.name}'을(를) 담지 못했습니다. ${failures[0]}`;
    }
    if (failures.length > 0) {
      return `'${course.name}'의 일부 시간만 담았습니다. ${failures[0]}`;
    }
    setError(null);
    return null;
  }

  async function removeEntry(entry: GridEntry) {
    if (entry.kind === 'reservation') {
      setError('회의 예약은 시간표에서 지울 수 없습니다. 해당 회의 화면에서 취소해 주세요.');
      return;
    }
    if (!window.confirm(`'${entry.title}' 일정을 삭제할까요?`)) return;
    try {
      await api.del(`/timetable/${entry.id}`);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : '일정을 삭제하지 못했습니다.');
    }
  }

  return (
    <main className="page">
      <h1 className="page-title">내 시간표</h1>
      <p className="page-sub">
        시간표 위에서 <strong>원하는 시간만큼 드래그</strong>하면 그 자리에 일정을 추가할 수 있습니다.
      </p>

      {error && <div className="alert alert-error">{error}</div>}

      <div className="week-bar">
        <span className="week-label">{fmtWeekLabel(weekStart)}</span>
        {!isCurrentWeek(weekStart) && (
          <button type="button" className="btn btn-outline btn-sm" onClick={goToday}>
            이번 주로
          </button>
        )}
      </div>

      <div className="legend">
        <span className="legend-item">
          <span className="legend-dot" style={{ background: 'var(--blue)' }} />내 수업·일정
        </span>
        <span className="legend-item">
          <span className="legend-dot" style={{ background: 'var(--success)' }} />
          확정된 회의 예약
        </span>
      </div>

      <div className="tt-layout">
        <div>
          <TimetableGrid
            entries={gridEntries}
            compact
            onEntryClick={removeEntry}
            selectable
            onSelectRange={selectRange}
            pendingRange={range}
            weekStart={weekStart}
            onPrevWeek={prevWeek}
            onNextWeek={nextWeek}
            slide={slide}
          />

          {range ? (
            <section className="card" style={{ marginTop: 20 }}>
          <h2 className="card-title">
            {rangeDate ? fmtDayHeader(rangeDate) : `${DAY_NAMES[range.day]}요일`}{' '}
            {fmtMin(range.startMin)}~{fmtMin(range.endMin)} 일정 추가
          </h2>
          <form onSubmit={saveEntry}>
            <div className="form-row">
              <div className="field">
                <label htmlFor="tt-title">일정</label>
                <input
                  id="tt-title"
                  ref={titleRef}
                  className="input"
                  type="text"
                  placeholder="예: 근로"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  required
                />
              </div>
              <div className="field">
                <label htmlFor="tt-place">장소 (선택)</label>
                <input
                  id="tt-place"
                  className="input"
                  type="text"
                  placeholder="예: 공학관 203"
                  value={place}
                  onChange={(e) => setPlace(e.target.value)}
                />
              </div>
            </div>

            <div className="field">
              <span className="field-label">반복</span>
              <div className="seg">
                <button
                  type="button"
                  className={`seg-btn${repeatKind === 'weekly' ? ' on' : ''}`}
                  onClick={() => setRepeatKind('weekly')}
                >
                  매주
                </button>
                <button
                  type="button"
                  className={`seg-btn${repeatKind === 'once' ? ' on' : ''}`}
                  onClick={() => setRepeatKind('once')}
                >
                  그 날만
                </button>
              </div>
              <p className="row-sub" style={{ marginTop: 6 }}>
                {repeatKind === 'weekly'
                  ? `매주 ${DAY_NAMES[range.day]}요일마다 표시됩니다.`
                  : `${rangeDate ? fmtDayHeader(rangeDate) : ''} 하루에만 표시됩니다.`}
              </p>
            </div>

            <details className="tt-adjust">
              <summary>시간 직접 고치기</summary>
              <div className="form-row" style={{ marginTop: 12 }}>
                <div className="field">
                  <label htmlFor="tt-day">요일</label>
                  <select
                    id="tt-day"
                    className="select"
                    value={range.day}
                    onChange={(e) => setRange({ ...range, day: Number(e.target.value) })}
                  >
                    {DAY_NAMES.map((d, i) => (
                      <option key={d} value={i}>
                        {d}요일
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="tt-start">시작</label>
                  <select
                    id="tt-start"
                    className="select"
                    value={range.startMin}
                    onChange={(e) => {
                      const startMin = Number(e.target.value);
                      setRange({
                        ...range,
                        startMin,
                        endMin: Math.max(range.endMin, startMin + STEP_MIN),
                      });
                    }}
                  >
                    {timeOptions(OPEN_MIN, CLOSE_MIN - STEP_MIN).map((m) => (
                      <option key={m} value={m}>
                        {fmtMin(m)}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="tt-end">종료</label>
                  <select
                    id="tt-end"
                    className="select"
                    value={range.endMin}
                    onChange={(e) => setRange({ ...range, endMin: Number(e.target.value) })}
                  >
                    {timeOptions(range.startMin + STEP_MIN, CLOSE_MIN).map((m) => (
                      <option key={m} value={m}>
                        {fmtMin(m)}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </details>

            <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
              <button type="submit" className="btn btn-primary" disabled={pending}>
                {pending ? '추가 중…' : '일정 추가'}
              </button>
              <button type="button" className="btn btn-secondary" onClick={cancelRange}>
                취소
              </button>
            </div>
          </form>
        </section>
      ) : (
            <p className="row-sub" style={{ marginTop: 12 }}>
              시간표를 드래그해 시간을 정하면 입력창이 나타납니다. 등록된 수업을 클릭하면 삭제됩니다.
            </p>
          )}
        </div>

        <CourseSearch onAdd={addCourse} />
      </div>
    </main>
  );
}
