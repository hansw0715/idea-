/**
 * e-class 현황을 화면에 맞게 계산하는 순수 함수 (react 없이 단위 시험한다).
 * 원칙: 모르는 상태를 "완료"나 "0개"로 보여 주지 않는다 — "확인 필요"로 남긴다.
 */
import type { EclassItem } from '../../../shared/school/eclass';

export const ECLASS_URL = 'https://learn.hansung.ac.kr/';
/** 이보다 오래된 정보는 홈에 들어올 때 한 번 새로 확인한다 */
export const ECLASS_STALE_MS = 5 * 60 * 1000;

export type DeadlineTone = 'gray' | 'warning' | 'danger' | 'success';

export function ts(value: string | null): number | null {
  if (!value) return null;
  const t = Date.parse(value);
  return Number.isFinite(t) ? t : null;
}

/** 공개 전(아직 열리지 않은) 항목은 할 일에 세지 않는다 */
export function isAvailable(item: EclassItem, now: number): boolean {
  const at = ts(item.availableAt);
  return at === null || at <= now;
}

/** 아직 기한이 안 지났는가 (강의는 출석 인정 기간 끝, 과제는 마감). 기한을 모르면 열려 있는 것으로 본다 */
export function isOpen(item: EclassItem, now: number): boolean {
  const due = ts(item.dueAt);
  return isAvailable(item, now) && (due === null || due >= now);
}

/** 한국 시간 기준 이번 주(월요일 00:00 ~ 다음 월요일 00:00)의 시작·끝 */
export function thisWeekRange(now: number): { start: number; end: number } {
  const kst = new Date(now + 9 * 3_600_000);
  const sinceMonday = (kst.getUTCDay() + 6) % 7;
  const start = Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate() - sinceMonday) - 9 * 3_600_000;
  return { start, end: start + 7 * 86_400_000 };
}

/** 이번 주차 항목인가: 이번 주에 시작하거나(공개) 이번 주에 마감된다 */
export function isThisWeek(item: EclassItem, now: number): boolean {
  const { start, end } = thisWeekRange(now);
  const within = (value: string | null) => {
    const t = ts(value);
    return t !== null && t >= start && t < end;
  };
  return within(item.availableAt) || within(item.dueAt);
}

/** 지금 챙겨야 하는가: 기간이 열려 있는데 아직 수강·제출하지 않았다(완료 여부를 모르는 것 포함) */
export function needsAttention(item: EclassItem, now: number): boolean {
  return isOpen(item, now) && item.completion !== 'completed';
}

export function deadlineOf(item: EclassItem, now: number): { label: string; tone: DeadlineTone } {
  if (!isAvailable(item, now)) return { label: '공개 예정', tone: 'gray' };
  if (item.completion === 'completed') return { label: item.kind === 'lecture' ? '수강 완료' : '제출 완료', tone: 'success' };
  const due = ts(item.dueAt);
  if (due === null) return { label: '기한 확인 필요', tone: 'gray' };
  const left = due - now;
  if (left <= 0) return { label: '기한 지남', tone: 'danger' };
  if (left < 3_600_000) return { label: `${Math.max(1, Math.floor(left / 60_000))}분 남음`, tone: 'danger' };
  if (left < 86_400_000) return { label: `${Math.floor(left / 3_600_000)}시간 ${Math.floor((left % 3_600_000) / 60_000)}분 남음`, tone: 'warning' };
  const days = Math.floor(left / 86_400_000);
  return { label: `${days}일 ${Math.floor((left % 86_400_000) / 3_600_000)}시간 남음`, tone: days <= 2 ? 'warning' : 'gray' };
}

export function formatDue(value: string): string {
  const t = ts(value);
  if (t === null) return '날짜 확인 필요';
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    month: 'long',
    day: 'numeric',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(t);
}

/** e-class 안의 주소만 연다 — 응답에 다른 호스트가 섞여도 안전하게 e-class 첫 화면으로 */
export function safeEclassUrl(value: string): string {
  try {
    const u = new URL(value);
    if (u.origin === 'https://learn.hansung.ac.kr' && !u.username && !u.password) return u.href;
  } catch {
    /* 잘못된 주소는 아래 기본값 */
  }
  return ECLASS_URL;
}

/** 마감이 빠른 순(기한 없는 것은 뒤), 같으면 강좌·제목 순. 완료·공개 예정은 뒤로 */
export function sortItems(items: EclassItem[], now: number): EclassItem[] {
  const rank = (i: EclassItem) => (!isAvailable(i, now) ? 2 : i.completion === 'completed' ? 1 : 0);
  return [...items].sort(
    (a, b) =>
      rank(a) - rank(b) ||
      (ts(a.dueAt) ?? Infinity) - (ts(b.dueAt) ?? Infinity) ||
      a.courseName.localeCompare(b.courseName, 'ko-KR') ||
      a.title.localeCompare(b.title, 'ko-KR'),
  );
}

/** 화면에 숫자로 보여 주는 것은 미수강 강의와 미제출 과제뿐이다(출석은 따로 세지 않는다). */
export type EclassCounts = {
  pendingLectures: number;
  pendingAssignments: number;
  unknownCompletion: number;
};

export function countsOf(items: EclassItem[], now: number): EclassCounts {
  const active = items.filter((i) => isOpen(i, now));
  return {
    pendingLectures: active.filter((i) => i.kind === 'lecture' && i.completion === 'pending').length,
    pendingAssignments: active.filter((i) => i.kind === 'assignment' && i.completion === 'pending').length,
    unknownCompletion: active.filter((i) => i.completion === 'unknown').length,
  };
}
