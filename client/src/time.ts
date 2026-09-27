export const DAY_NAMES = ['월', '화', '수', '목', '금'];
export const OPEN_MIN = 540; // 09:00
// 시간표에 적을 수 있는 범위 (야간 수업·아르바이트까지)
export const CLOSE_MIN = 1320; // 22:00
// 시설 예약·공통 여유 시간도 같은 22시까지 다룬다
export const RESERVE_CLOSE_MIN = 1320; // 22:00
export const STEP_MIN = 30;

export function fmtMin(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function fmtRange(start: number, end: number): string {
  return `${fmtMin(start)}~${fmtMin(end)}`;
}

export function timeOptions(from = OPEN_MIN, to = CLOSE_MIN, step = STEP_MIN): number[] {
  const out: number[] = [];
  for (let m = from; m <= to; m += step) out.push(m);
  return out;
}

export function fmtDuration(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h === 0) return `${m}분`;
  if (m === 0) return `${h}시간`;
  return `${h}시간 ${m}분`;
}

function toYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** 학교 규정: 이용일 7일 전부터 신청 가능 */
export const MAX_DAYS_AHEAD = 7;

/** 오늘 날짜 'YYYY-MM-DD' */
export function todayStr(): string {
  return toYmd(new Date());
}

/** 지금 시각(자정 기준 분) */
export function nowMinutes(): number {
  const now = new Date();
  return now.getHours() * 60 + now.getMinutes();
}

/**
 * day(0=월)에 해당하면서 신청 가능한 날짜만 돌려준다.
 * 학교가 7일 전부터만 받으므로 그 뒤 날짜는 눌러도 거절당해 아예 보여주지 않는다.
 */
export function nextDatesForDay(day: number, maxDaysAhead = MAX_DAYS_AHEAD): string[] {
  const out: string[] = [];
  const now = new Date();
  for (let i = 0; i <= maxDaysAhead; i++) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
    if ((d.getDay() + 6) % 7 === day) out.push(toYmd(d));
  }
  return out;
}

/** 'YYYY-MM-DD' → 요일 인덱스(0=월 ~ 6=일). */
export function weekdayOfDate(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return (new Date(y, m - 1, d).getDay() + 6) % 7;
}

/** 'YYYY-MM-DD' → '9월 3일 (수)' */
export function fmtDate(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  const weekday = ['일', '월', '화', '수', '목', '금', '토'][dt.getDay()];
  return `${m}월 ${d}일 (${weekday})`;
}

/** 'YYYY-MM-DD' 에 days 일을 더한 문자열. */
export function addDaysStr(base: string, days: number): string {
  const [y, m, d] = base.split('-').map(Number);
  return toYmd(new Date(y, m - 1, d + days));
}

/** 'YYYY-MM-DD' 가 속한 주의 월요일. */
export function weekStartOf(date: string): string {
  return addDaysStr(date, -weekdayOfDate(date));
}

/** 오늘이 속한 주의 월요일. */
export function currentWeekStart(): string {
  return weekStartOf(todayStr());
}

/** 그 주의 월~금 날짜 5개. */
export function weekDates(weekStart: string): string[] {
  return Array.from({ length: DAY_NAMES.length }, (_, i) => addDaysStr(weekStart, i));
}

/** 'YYYY-MM-DD' → '9/18(목)' */
export function fmtDayHeader(date: string): string {
  const [, m, d] = date.split('-').map(Number);
  return `${m}/${d}(${DAY_NAMES[weekdayOfDate(date)] ?? ''})`;
}

/** 그 주가 몇 월인지 사람이 읽는 형태로. 주가 달을 걸치면 둘 다 적는다. */
export function fmtWeekLabel(weekStart: string): string {
  const [y1, m1] = weekStart.split('-').map(Number);
  const [, m2] = addDaysStr(weekStart, 4).split('-').map(Number);
  return m1 === m2 ? `${y1}년 ${m1}월` : `${y1}년 ${m1}~${m2}월`;
}

/** 오늘이 그 주에 속하는가. */
export function isCurrentWeek(weekStart: string): boolean {
  return weekStart === currentWeekStart();
}
