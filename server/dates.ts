export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const SERVICE_TZ = 'Asia/Seoul';

/** 서비스 표준 시간대(KST) 기준 오늘 날짜 'YYYY-MM-DD'. */
export function todayStr(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: SERVICE_TZ }).format(new Date());
}

/** 서비스 표준 시간대(KST) 기준 현재 시각(자정 기준 분). */
export function nowMinutes(): number {
  const text = new Intl.DateTimeFormat('en-GB', {
    timeZone: SERVICE_TZ,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date());
  const [h, m] = text.split(':').map(Number);
  return h * 60 + m;
}

/**
 * 'YYYY-MM-DD'를 실존하는 달력 날짜로만 파싱한다.
 * (Date 생성자의 자동 이월 — 예: 2026-09-32 → 10-02 — 을 거부)
 */
export function parseDateStrict(s: string): Date | null {
  if (!DATE_RE.test(s)) return null;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d ? dt : null;
}

/** 요일 인덱스(0=월 ~ 6=일). */
export function weekdayOf(date: Date): number {
  return (date.getDay() + 6) % 7;
}

/** 'YYYY-MM-DD' 문자열에 days일을 더한 문자열. */
export function addDaysStr(base: string, days: number): string {
  const [y, m, d] = base.split('-').map(Number);
  const dt = new Date(y, m - 1, d + days);
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');
  return `${dt.getFullYear()}-${mm}-${dd}`;
}

/** 'YYYY-MM-DD' 가 속한 주의 월요일 날짜. */
export function weekStartOf(date: string): string {
  const dt = parseDateStrict(date);
  if (!dt) return currentWeekStart();
  return addDaysStr(date, -weekdayOf(dt));
}

/** 오늘이 속한 주의 월요일 날짜. */
export function currentWeekStart(): string {
  const today = todayStr();
  const dt = parseDateStrict(today);
  return dt ? addDaysStr(today, -weekdayOf(dt)) : today;
}

/**
 * 요청의 week 파라미터를 월요일 날짜로 정규화한다.
 * 값이 없거나 형식이 틀리면 이번 주로 본다.
 */
export function resolveWeekStart(raw: unknown): string {
  const text = String(raw ?? '').trim();
  return DATE_RE.test(text) ? weekStartOf(text) : currentWeekStart();
}

/** 해당 주의 월~금 마지막 날(금요일) 날짜. */
export function weekEndOf(weekStart: string): string {
  return addDaysStr(weekStart, 4);
}
