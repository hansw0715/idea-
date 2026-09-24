/**
 * 밥약 빠른 매칭. (담당: 한승원)
 *
 * 흐름: 조건만 걸어두고 기다린다 → 조건이 맞는 사람이 인원수만큼 모이면 후보 방이 생긴다
 *     → 각자 가능한 시간대를 체크하고 수락한다 → **전원 수락**하면 밥약이 확정된다.
 *
 * 한 명이라도 거절하면 방은 깨지고 나머지는 다시 대기열로 돌아간다.
 * "전원 수락"으로 한 이유: 자동으로 잡힌 약속은 안 나올 확률이 높아서, 확정 전에 한 번 더 확인받는다.
 *
 * 전부 순수 함수 — 저장과 시간은 바깥(service)에서 넣어준다.
 */
import { fail, ok, type ISODateTime, type Result, type UserId } from '@/shared/types';
import { TIME_BANDS, timeBand, type PlaceType } from './preset';

export type QuickStatus = 'waiting' | 'matched' | 'cancelled';

/** 대기표 — "이 조건이면 아무나 좋아요" */
export type QuickRequest = {
  id: string;
  userId: UserId;
  /** YYYY-MM-DD (한국 날짜) */
  date: string;
  placeType: PlaceType;
  /** 같이 먹을 총 인원 (본인 포함) */
  size: number;
  /** 가능한 시간대 key */
  bands: string[];
  tags: string[];
  status: QuickStatus;
  roomId: string | null;
  createdAt: ISODateTime;
};

export type RoomStatus = 'pending' | 'confirmed' | 'cancelled';
export type Answer = 'accepted' | 'declined';

/** 후보 방 — 아직 확정 전 */
export type QuickRoom = {
  id: string;
  memberIds: UserId[];
  date: string;
  placeType: PlaceType;
  size: number;
  /** 모두에게 공통으로 가능한 시간대 */
  bands: string[];
  /** 누가 어떤 시간대를 고를 수 있다고 했는지 */
  votes: Record<string, string[]>;
  answers: Record<string, Answer>;
  status: RoomStatus;
  /** 확정되면 만들어진 밥약 id */
  gatheringId: string | null;
  createdAt: ISODateTime;
  /** 이 시각까지 전원이 답하지 않으면 깨진다 */
  expiresAt: ISODateTime;
};

/** 후보 방이 유지되는 시간 — 밥때를 놓치지 않게 짧게 잡는다 */
export const ROOM_TTL_MIN = 30;

export const intersect = (a: string[], b: string[]): string[] => a.filter((x) => b.includes(x));

/** 대기표끼리 짝이 될 수 있는가 (차단 여부는 hidden으로 받아 걸러낸다) */
export function isCompatible(a: QuickRequest, b: QuickRequest, hidden: (x: UserId, y: UserId) => boolean): boolean {
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
 * 학과 비교는 대기표에 없는 정보라 service가 태그로 미리 좁혀서 넣어준다.
 * 여기서는 "같은 과만"을 건 쪽끼리는 tags에 같은 학과 표시(dept:xxx)가 있어야 맞는 것으로 본다.
 */
const deptTag = (r: QuickRequest) => r.tags.find((t) => t.startsWith('dept:'));
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
    // 대기표에 적어둔 가능 시간을 그대로 첫 투표로 넣어준다 (아무것도 안 눌러도 약속이 잡히게)
    votes: Object.fromEntries(group.map((r) => [r.userId, intersect(r.bands, commonBands(group))])),
    answers: {},
    status: 'pending',
    gatheringId: null,
    createdAt: now,
    expiresAt: new Date(new Date(now).getTime() + ROOM_TTL_MIN * 60_000).toISOString(),
  };
}

const sortBands = (bands: string[]) =>
  [...bands].sort((a, b) => (timeBand(a)?.startMin ?? 0) - (timeBand(b)?.startMin ?? 0));

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
  const best = counted.filter((c) => c.count > 0).sort((a, b) => b.count - a.count || startMin(a.band) - startMin(b.band))[0];
  return best?.band ?? null;
}

const startMin = (band: string) => timeBand(band)?.startMin ?? 0;

/** 'YYYY-MM-DD' + 시간대 → ISO. 한국 시간 기준이라 9시간을 빼서 UTC로 만든다. */
export function meetAtOf(date: string, band: string): ISODateTime {
  const min = startMin(band);
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 0, min) - 9 * 3600_000).toISOString();
}

/** 만료된 방 정리용 */
export const isExpired = (room: QuickRoom, now: ISODateTime): boolean =>
  room.status === 'pending' && now >= room.expiresAt;

export const BAND_KEYS: string[] = TIME_BANDS.map((b) => b.key);
