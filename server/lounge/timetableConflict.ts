/**
 * 모임 시각이 내 시간표(수업·일정)와 겹치는지 — 라운지와 시간표를 한 서비스로 잇는 연결점.
 * 참고용이라 모임 참여를 막지는 않는다. 화면에는 "수업과 겹쳐요: 자료구조" 배지로 보인다.
 *
 * 담당: 작업 S2. 규칙: docs/lounge/01-contract.md §8
 *  - 시간표는 한국 시간(KST) 기준이다. 서버가 UTC 여도 모임 시각을 KST 로 바꿔서 비교한다.
 *  - 사용자 일정은 한 번만 읽고(`loadEntries`), 겹침 계산(`computeConflicts`)은 순수 함수로 분리했다.
 */
import { all } from '../db.js';
import { toKst } from '../../shared/lounge/format.js';

export type ConflictQuery = {
  id: string;
  /** ISO 시각 */
  meetAt: string;
  /** 이 모임이 대략 걸리는 시간(분). 밥약 60, 미팅 120. */
  durationMin: number;
};

/** timetable_entries 한 줄 (겹침 계산에 필요한 것만) */
export type TimetableEntry = {
  /** 0=월 ~ 4=금 */
  day: number;
  startMin: number;
  endMin: number;
  title: string;
  repeatKind: 'weekly' | 'once';
  /** YYYY-MM-DD (once 일 때) */
  date: string | null;
};

const DAY_MIN = 24 * 60;
const INT4_MAX = 2_147_483_647;

/** KST 요일(0=일 ~ 6=토, toKst) → 시간표 요일(0=월 ~ 6=일) */
const toTimetableDay = (kstWeekday: number) => (kstWeekday + 6) % 7;

/** 'YYYY-MM-DD' 에 하루를 더한다 (UTC 달력 기준 — 서머타임이 없는 KST 에서 안전) */
function nextDate(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}

/** 한 날짜의 시간 구간 [from, to) (자정부터 분) */
type DaySegment = { date: string; weekday: number; from: number; to: number };

/**
 * 모임 `[meetAt, meetAt + durationMin)` 을 KST 날짜별 구간으로 나눈다.
 * 밤 11시 모임은 다음 날 새벽까지 이어질 수 있어서 자정을 넘으면 둘로 쪼갠다.
 * 시간이 올바르지 않으면 빈 배열(겹침 없음).
 */
export function daySegments(meetAt: string, durationMin: number): DaySegment[] {
  const at = new Date(meetAt);
  if (Number.isNaN(at.getTime()) || !Number.isFinite(durationMin) || durationMin < 0) return [];
  const start = toKst(at);
  const end = start.minutes + Math.floor(durationMin);
  const first: DaySegment = { date: start.date, weekday: start.weekday, from: start.minutes, to: Math.min(end, DAY_MIN) };
  if (end <= DAY_MIN) return [first];
  // 자정을 넘긴 나머지 (이틀 이상 걸리는 모임은 없다 — durationMin 은 하루 안쪽)
  return [first, { date: nextDate(start.date), weekday: (start.weekday + 1) % 7, from: 0, to: Math.min(end - DAY_MIN, DAY_MIN) }];
}

/**
 * 순수 계산: 일정 목록과 모임 목록 → 모임 id → 겹치는 일정 이름.
 * - weekly: 요일이 같으면 매주 해당, once: 그 날짜(KST)와 같을 때만.
 * - 겹침 = 일정.start < 모임.끝 && 일정.end > 모임.시작. 끝과 시작이 맞닿으면(예: 수업 14:00 끝, 모임 14:00 시작) 겹침이 아니다.
 * - 주말(토·일)은 시간표에 일정이 없으므로 겹침 없음.
 * - 겹치는 일정이 여럿이면 `entries` 의 순서상 첫 번째 (loadEntries 가 시작 시각순으로 준다).
 */
export function computeConflicts(entries: TimetableEntry[], items: ConflictQuery[]): Map<string, string> {
  const result = new Map<string, string>();
  for (const item of items) {
    for (const seg of daySegments(item.meetAt, item.durationMin)) {
      const day = toTimetableDay(seg.weekday);
      if (day >= 5) continue;
      const hit = entries.find(
        (e) =>
          (e.repeatKind === 'once' ? e.date === seg.date : e.day === day) && e.startMin < seg.to && e.endMin > seg.from,
      );
      if (hit) {
        result.set(item.id, hit.title);
        break;
      }
    }
  }
  return result;
}

interface EntryRow {
  day: number;
  start_min: number;
  end_min: number;
  title: string;
  repeat_kind: string;
  date: string | null;
}

/** 사용자 일정을 한 번에 읽는다. 매주 반복은 전부, 특정 날짜 일정은 필요한 날짜(모임이 걸치는 날)만. */
async function loadEntries(userId: number, dates: string[]): Promise<TimetableEntry[]> {
  const rows = await all<EntryRow>(
    `SELECT day, start_min, end_min, title, repeat_kind, date
       FROM timetable_entries
      WHERE user_id = ? AND (repeat_kind = 'weekly' OR date = ANY(?::text[]))
      ORDER BY start_min, id`,
    [userId, dates],
  );
  return rows.map((r) => ({
    day: Number(r.day),
    startMin: Number(r.start_min),
    endMin: Number(r.end_min),
    title: r.title,
    repeatKind: r.repeat_kind === 'once' ? 'once' : 'weekly',
    date: r.date,
  }));
}

/** 반환: 모임 id → 겹치는 수업 이름 (겹치지 않는 모임은 맵에 없다) */
export async function timetableConflicts(
  userId: string,
  items: ConflictQuery[],
): Promise<Map<string, string>> {
  // users.id 는 int4 — 형식이 이상하거나 범위를 넘는 값은 DB 오류(500)가 되므로 쿼리 전에 걸러낸다.
  if (!/^[1-9]\d{0,9}$/.test(userId) || Number(userId) > INT4_MAX || items.length === 0) return new Map();
  const uid = Number(userId);

  const dates = [...new Set(items.flatMap((i) => daySegments(i.meetAt, i.durationMin).map((s) => s.date)))];
  if (dates.length === 0) return new Map();

  return computeConflicts(await loadEntries(uid, dates), items);
}
