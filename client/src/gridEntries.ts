import type { GridEntry } from './components/TimetableGrid';
import { DAY_NAMES, fmtDate, weekdayOfDate } from './time';
import { reservationStatus } from './reservationStatus';
import type { Reservation } from './types';

/**
 * 예약과 계획을 시간표 블록으로 바꾼다. (홈·시간표 화면 공용)
 * 주말 예약도 그대로 두면 격자가 주말 칸을 연다.
 */
export function reservationsToEntries(reservations: Reservation[]): GridEntry[] {
  return reservations
    .map((r) => ({
      id: r.id,
      day: weekdayOfDate(r.date),
      startMin: r.startMin,
      endMin: r.endMin,
      title: r.meetingName,
      subtitle: `${fmtDate(r.date)} · ${r.facilityName} · ${reservationStatus(r).label}`,
      kind: 'reservation' as const,
    }))
    .filter((e) => e.day >= 0 && e.day < DAY_NAMES.length);
}
