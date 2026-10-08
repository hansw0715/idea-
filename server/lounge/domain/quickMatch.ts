/**
 * 밥약 빠른 매칭 — 순수 규칙. (ZIP `features/mealdate/quick-match.ts` 이식)
 *
 * 흐름: 조건만 걸어두고 기다린다 → 조건이 맞는 사람이 인원수만큼 모이면 후보 방이 생긴다
 *     → 각자 가능한 시간대를 체크하고 수락한다 → **전원 수락**하면 밥약이 확정된다.
 *
 * 한 명이라도 거절하면 방은 깨지고 나머지는 다시 대기열로 돌아간다.
 * "전원 수락"으로 한 이유: 자동으로 잡힌 약속은 안 나올 확률이 높아서, 확정 전에 한 번 더 확인받는다.
 *
 * 전부 순수 함수 — 저장·시간·랜덤은 바깥(service)에서 넣어 준다. 예외는 던지지 않고 Result 를 돌려준다.
 * ZIP 과 달라진 곳은 맨 아래 "ZIP 에 없던 보강" 구역에만 있다 (기존 함수의 동작은 그대로).
 */
import { fail, ok } from '../../../shared/lounge/types.js';
import type { ISODateTime, Result, UserId } from '../../../shared/lounge/types.js';
import { BAND_KEYS, PLACE_TYPES, QUICK_ROOM_TTL_MIN, timeBand } from '../../../shared/lounge/constants.js';
import type { PlaceType } from '../../../shared/lounge/constants.js';
import type { QuickInput, QuickRequestView, QuickRoomView } from '../../../shared/lounge/view.js';
import { hasUnsafeChars } from './chat.js';

export type QuickStatus = 'waiting' | 'matched' | 'cancelled';

/** 대기표 — "이 조건이면 아무나 좋아요". 화면용 `QuickRequestView` 에 주인(userId)만 더한 모양. */
export type QuickRequest = QuickRequestView & { userId: UserId };

export type RoomStatus = QuickRoomView['status'];
export type Answer = 'accepted' | 'declined';

/** 후보 방 — 확정 전. 화면용 `QuickRoomView` 와 같은 모양이다. */
export type QuickRoom = QuickRoomView;

/** 학과 비교용 내부 태그의 접두어. 화면에는 내려보내지 않는다. */
export const DEPT_TAG_PREFIX = 'dept:';
/** 태그 하나의 최대 길이 / 최대 개수 (모임 만들기 규칙 `meta.tags` 와 같다) */
export const TAG_MAX_LENGTH = 20;
export const TAG_MAX_COUNT = 6;

export const intersect = (a: string[], b: string[]): string[] => a.filter((x) => b.includes(x));

/** 대기표끼리 짝이 될 수 있는가 (차단 여부는 hidden 으로 받아 걸러낸다) */
export function isCompatible(
  a: QuickRequest,
  b: QuickRequest,
  hidden: (x: UserId, y: UserId) => boolean,
): boolean {
  if (a.userId === b.userId) return false;
  if (a.status !== 'waiting' || b.status !== 'waiting') return false;
  if (a.date !== b.date || a.placeType !== b.placeType || a.size !== b.size) return false;
  if (intersect(a.bands, b.bands).length === 0) return false;
  // '같은 과만' 태그는 한쪽만 걸어도 양쪽에 적용한다 (안 맞으면 서로 불편하니까)
  if (a.tags.includes('같은 과만') || b.tags.includes('같은 과만')) {
    if (!sameDepartmentPossible(a, b)) return false;
  }
  return !hidden(a.userId, b.userId);
}

/**
 * 학과 비교는 대기표에 없는 정보라 service 가 태그(dept:학과)로 미리 넣어 준다.
 * 여기서는 "같은 과만"을 건 쪽끼리는 같은 학과 표시가 있어야 맞는 것으로 본다.
 */
const deptTag = (r: QuickRequest) => r.tags.find((t) => t.startsWith(DEPT_TAG_PREFIX));
const sameDepartmentPossible = (a: QuickRequest, b: QuickRequest) => deptTag(a) === deptTag(b);

/**
 * 새 대기표를 기준으로 짝을 찾는다. 오래 기다린 사람부터 채워서 무한정 대기하는 사람이 없게 한다.
 * size명을 못 채우면 null (계속 대기).
 */
export function findGroup(
  waiting: QuickRequest[],
  target: QuickRequest,
  hidden: (x: UserId, y: UserId) => boolean,
): QuickRequest[] | null {
  const pool = waiting
    .filter((r) => r.id !== target.id && isCompatible(target, r, hidden))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  const group = [target];
  for (const candidate of pool) {
    if (group.length >= target.size) break;
    // 새로 넣을 사람은 이미 모인 사람 **모두**와 맞아야 한다 (한 명만 안 맞아도 방이 깨진다)
    if (group.every((g) => isCompatible(g, candidate, hidden))) group.push(candidate);
  }
  if (group.length < target.size) return null;
  // 공통 시간대가 남아 있어야 약속을 잡을 수 있다
  return commonBands(group).length > 0 ? group : null;
}

export const commonBands = (group: QuickRequest[]): string[] =>
  group.reduce<string[]>((acc, r, i) => (i === 0 ? r.bands : intersect(acc, r.bands)), []);

export function createRoom(id: string, group: QuickRequest[], now: ISODateTime): QuickRoom {
  return {
    id,
    memberIds: group.map((r) => r.userId),
    date: group[0].date,
    placeType: group[0].placeType,
    size: group[0].size,
    bands: sortBands(commonBands(group)),
    // 대기표에 적어 둔 가능 시간을 그대로 첫 투표로 넣어 준다 (아무것도 안 눌러도 약속이 잡히게)
    votes: Object.fromEntries(group.map((r) => [r.userId, intersect(r.bands, commonBands(group))])),
    answers: {},
    status: 'pending',
    gatheringId: null,
    createdAt: now,
    expiresAt: new Date(new Date(now).getTime() + QUICK_ROOM_TTL_MIN * 60_000).toISOString(),
  };
}

const sortBands = (bands: string[]) => [...bands].sort((a, b) => startMin(a) - startMin(b));

export function vote(room: QuickRoom, userId: UserId, bands: string[], now: ISODateTime): Result<QuickRoom> {
  const guard = editable(room, userId, now);
  if (!guard.ok) return guard;
  const picked = intersect(bands, room.bands);
  if (picked.length === 0) return fail('INVALID', '가능한 시간을 하나 이상 골라 주세요.');
  return ok({ ...room, votes: { ...room.votes, [userId]: picked } });
}

export function answer(room: QuickRoom, userId: UserId, value: Answer, now: ISODateTime): Result<QuickRoom> {
  const guard = editable(room, userId, now);
  if (!guard.ok) return guard;

  const answers = { ...room.answers, [userId]: value };
  if (value === 'declined') return ok({ ...room, answers, status: 'cancelled' });

  const next = { ...room, answers };
  return ok(allAccepted(next) && decideBand(next) ? { ...next, status: 'confirmed' } : next);
}

function editable(room: QuickRoom, userId: UserId, now: ISODateTime): Result<true> {
  if (!room.memberIds.includes(userId)) return fail('FORBIDDEN', '이 방의 참여자가 아닙니다.');
  if (room.status !== 'pending') return fail('NOT_OPEN', '이미 끝난 매칭입니다.');
  if (now >= room.expiresAt) return fail('DEADLINE_PASSED', '시간이 지나 매칭이 취소됐어요.');
  return ok(true);
}

export const allAccepted = (room: QuickRoom): boolean =>
  room.memberIds.every((id) => room.answers[id] === 'accepted');

/** 표를 가장 많이 받은 시간대. 동점이면 이른 시간. 아무에게도 표가 없으면 null. */
export function decideBand(room: QuickRoom): string | null {
  const counted = room.bands.map((band) => ({
    band,
    count: room.memberIds.filter((id) => (room.votes[id] ?? []).includes(band)).length,
  }));
  const best = counted
    .filter((c) => c.count > 0)
    .sort((a, b) => b.count - a.count || startMin(a.band) - startMin(b.band))[0];
  return best?.band ?? null;
}

const startMin = (band: string) => timeBand(band)?.startMin ?? 0;

/** 'YYYY-MM-DD' + 시간대 → ISO. 한국 시간 기준이라 9시간을 빼서 UTC 로 만든다. */
export function meetAtOf(date: string, band: string): ISODateTime {
  const min = startMin(band);
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 0, min) - 9 * 3600_000).toISOString();
}

/** 만료된 방 정리용 */
export const isExpired = (room: QuickRoom, now: ISODateTime): boolean =>
  room.status === 'pending' && now >= room.expiresAt;

// ───────────────────────── ZIP 에 없던 보강 ─────────────────────────
// 위의 함수들은 ZIP 과 동작이 같다. 아래는 저장소(DB)와 시간 때문에 새로 필요해진 순수 규칙이다.

/** 한국 날짜(YYYY-MM-DD). 서버는 UTC 로 돌아가므로 +9시간을 해서 날짜를 자른다. */
export const kstDate = (now: ISODateTime): string =>
  new Date(new Date(now).getTime() + 9 * 3600_000).toISOString().slice(0, 10);

/** 형식뿐 아니라 실제 달력에 있는 날짜인가 (2026-02-31 같은 값을 거른다) */
export function isRealDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

/** 아직 시작 전인 시간대만 남긴다. 이미 시작한 시간대로는 약속을 만들 수 없다(과거 약속 방지). */
export const futureBands = (date: string, bands: string[], now: ISODateTime): string[] =>
  bands.filter((b) => meetAtOf(date, b) > now);

/**
 * 후보 방에서 이미 시작한 시간대를 뺀다. 방은 30분 동안 열려 있어서, 그 사이 "12시" 구간이 지나갈 수 있다.
 * 남은 시간대가 없으면 null — 약속을 잡을 수 없는 방이니 깨야 한다.
 * 어떤 사람이 투표한 시간대가 전부 지나갔으면 남은 시간대 전부에 표를 준다
 * (방의 시간대는 모두의 대기표 교집합이라, 그 사람은 남은 시간대에도 원래 가능하다고 한 사람이다).
 */
export function dropPastBands(room: QuickRoom, now: ISODateTime): QuickRoom | null {
  const bands = room.bands.filter((b) => meetAtOf(room.date, b) > now);
  if (bands.length === 0) return null;
  if (bands.length === room.bands.length) return room;
  const votes = Object.fromEntries(
    room.memberIds.map((id) => {
      const kept = intersect(room.votes[id] ?? [], bands);
      return [id, kept.length > 0 ? kept : bands];
    }),
  );
  return { ...room, bands, votes };
}

/** 방 안에 서로 차단 관계인 두 사람이 있는가 (확정 직전에 한 번 더 본다) */
export function hasBlockedPair(room: QuickRoom, hidden: (x: UserId, y: UserId) => boolean): boolean {
  const ids = room.memberIds;
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) if (hidden(ids[i], ids[j])) return true;
  }
  return false;
}

/** 확정된 방의 약속 시각. 결정할 수 없으면 null. */
export function confirmedMeetAt(room: QuickRoom): ISODateTime | null {
  const band = decideBand(room);
  return band ? meetAtOf(room.date, band) : null;
}

/** 대기표가 오래 남지 않도록: 확정된 약속이 이 시간(분)을 지나면 그 대기표는 끝난 것으로 본다. */
export const TICKET_DONE_AFTER_MIN = 180;

export const isFinishedRoom = (room: QuickRoom, now: ISODateTime): boolean => {
  if (room.status !== 'confirmed') return false;
  const meetAt = confirmedMeetAt(room);
  return meetAt !== null && new Date(now).getTime() >= new Date(meetAt).getTime() + TICKET_DONE_AFTER_MIN * 60_000;
};

/** 화면에 내려보내는 대기표: 내부 태그(dept:학과)와 주인 id 를 뺀다. */
export const toRequestView = (r: QuickRequest): QuickRequestView => ({
  id: r.id,
  date: r.date,
  placeType: r.placeType,
  size: r.size,
  bands: r.bands,
  tags: r.tags.filter((t) => !t.startsWith(DEPT_TAG_PREFIX)),
  status: r.status,
  roomId: r.roomId,
  createdAt: r.createdAt,
});

/**
 * 신청 본문 검증. 모르는 값(unknown)을 받아 정리된 QuickInput 으로 돌려준다.
 *  - 날짜: 실제 달력에 있는 YYYY-MM-DD / 장소: PLACE_TYPES / 인원: 2~4 정수
 *  - bands: 문자열 배열, 전부 BAND_KEYS 안에 있어야 하고 최소 1개 (중복은 합친다)
 *  - tags: 문자열 배열(최대 6개·각 20자). 내부 태그(dept:)는 사용자가 못 넣는다 — 학과를 속여
 *    '같은 과만' 매칭을 통과하려는 시도를 막으려고, 들어와도 조용히 버린다. 서버가 따로 붙인다.
 *    NUL·짝 없는 서로게이트·제어문자가 든 태그는 INVALID — jsonb 저장 때 DB 오류(500)가 되기 때문이다.
 *    (모임 태그의 `checkLine` 과 같은 기준: 한 줄 글이라 줄바꿈·탭도 막는다)
 */
export function parseQuickInput(raw: unknown): Result<QuickInput> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return fail('INVALID', '신청 내용이 올바르지 않아요.');
  }
  const body = raw as Record<string, unknown>;

  if (typeof body.date !== 'string' || !isRealDate(body.date)) {
    return fail('INVALID', '날짜를 골라 주세요.');
  }
  if (typeof body.placeType !== 'string' || !(PLACE_TYPES as readonly string[]).includes(body.placeType)) {
    return fail('INVALID', '장소를 골라 주세요.');
  }
  if (typeof body.size !== 'number' || !Number.isInteger(body.size) || body.size < 2 || body.size > 4) {
    return fail('INVALID', '인원은 2~4명까지예요.');
  }
  if (!Array.isArray(body.bands) || body.bands.some((b) => typeof b !== 'string')) {
    return fail('INVALID', '가능한 시간을 하나 이상 골라 주세요.');
  }
  const bands = [...new Set(body.bands as string[])];
  if (bands.length === 0) return fail('INVALID', '가능한 시간을 하나 이상 골라 주세요.');
  if (bands.some((b) => !BAND_KEYS.includes(b))) return fail('INVALID', '고를 수 없는 시간이 있어요.');

  const rawTags = body.tags === undefined ? [] : body.tags;
  if (!Array.isArray(rawTags) || rawTags.some((t) => typeof t !== 'string')) {
    return fail('INVALID', '태그가 올바르지 않아요.');
  }
  const trimmed = (rawTags as string[]).map((t) => t.trim());
  if (trimmed.some((t) => hasUnsafeChars(t, false))) return fail('INVALID', '태그에 쓸 수 없는 글자가 들어 있어요.');
  const tags = [...new Set(trimmed.filter((t) => t && !t.startsWith(DEPT_TAG_PREFIX)))];
  if (tags.length > TAG_MAX_COUNT || tags.some((t) => [...t].length > TAG_MAX_LENGTH)) {
    return fail('INVALID', `태그는 ${TAG_MAX_COUNT}개까지, 각각 ${TAG_MAX_LENGTH}자 이하로 적어 주세요.`);
  }

  return ok({ date: body.date, placeType: body.placeType as PlaceType, size: body.size, bands, tags });
}
