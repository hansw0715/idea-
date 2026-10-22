/**
 * Gathering 도메인 로직. (ZIP domain/gathering 이식)
 *
 * 전부 순수 함수다. DB도 시간도 여기서 안 건드린다 — 시각은 `now` 인자로 받고, 저장·부수효과는 services 몫.
 * 이렇게 나눠야 규칙(정원, 마감, 중복 참여)을 DB 없이 테스트할 수 있다.
 *
 * ZIP 과 달라진 곳은 셋뿐이다.
 *   ① User.verified 개념 제거 — 우리는 가입 때 이미 학교 메일 인증을 마쳤다.
 *   ② id 는 그냥 string.
 *   ③ 에러 코드·문구는 shared/lounge/types 의 것을 쓴다.
 * 날짜 비교는 문자열 비교다 — `now`·`meetAt`·`joinDeadline` 은 항상 `toISOString()` 형식(같은 길이·Z 접미)이어야 한다.
 */
import { fail, ok } from '../../../shared/lounge/types.js';
import type { ISODateTime, Result, UserId } from '../../../shared/lounge/types.js';
import type {
  Gender,
  Applicant,
  CreateGatheringBody,
  Gathering,
  GatheringStatusView,
  Review,
  ReviewMark,
  Slot,
} from '../../../shared/lounge/gathering.js';
import { joinBlockReason } from './reputation.js';

export type { GatheringStatusView };

/** 모임 규칙이 보는 최소 사용자. 학과 비교·차단은 사람 사이의 관계라 서비스가 한다. */
export type GatherUser = { id: UserId; banned: boolean; warnings: number; gender?: Gender | null };

/** 성별이 정해진 자리(미팅의 남자 쪽/여자 쪽)에 이 사람이 앉을 수 있는가 */
export function genderSeatError(slot: { gender?: Gender; label: string }, user: { gender?: Gender | null }): string | null {
  if (!slot.gender) return null;
  if (!user.gender) return '성별을 먼저 정해 주세요. 내 정보에서 고를 수 있어요.';
  if (user.gender !== slot.gender) return `${slot.label} 자리에는 ${slot.gender === 'male' ? '남학생' : '여학생'}만 앉을 수 있어요.`;
  return null;
}

/** 만들기 입력 = API 본문 + 서버가 채우는 id · 주최자 */
export type CreateGatheringInput = CreateGatheringBody & { id: string; hostId: string; hostGender?: Gender | null };

// ---------- 조회 헬퍼 ----------

export const memberIds = (g: Gathering): UserId[] => g.slots.flatMap((s) => s.memberIds);

export const isMember = (g: Gathering, userId: UserId): boolean =>
  g.slots.some((s) => s.memberIds.includes(userId));

export const isApplicant = (g: Gathering, userId: UserId): boolean =>
  g.applicants.some((a) => a.userId === userId);

export const seatsLeft = (slot: Slot): number => slot.capacity - slot.memberIds.length;

export const totalSeatsLeft = (g: Gathering): number =>
  g.slots.reduce((sum, s) => sum + seatsLeft(s), 0);

export const isFull = (g: Gathering): boolean => totalSeatsLeft(g) === 0;

/**
 * 저장된 status 는 시간이 흘러도 안 바뀌므로, 마감 시각을 반영한 실제 상태를 계산해서 쓴다.
 * (상태를 갱신하는 배치/cron 없이도 목록이 정확하게 보이게 하려는 의도)
 */
export function currentStatus(g: Gathering, now: ISODateTime): GatheringStatusView {
  if (g.status === 'cancelled') return 'cancelled';
  if (g.status === 'done') return 'done';
  if (now >= g.meetAt) return 'done';
  if (isFull(g)) return 'full';
  if (now >= g.joinDeadline) return 'closed';
  return 'open';
}

export const canJoin = (g: Gathering, now: ISODateTime): boolean =>
  currentStatus(g, now) === 'open';

// ---------- 생성 ----------

export function createGathering(input: CreateGatheringInput, now: ISODateTime): Result<Gathering> {
  if (!input.title.trim()) return fail('INVALID', '제목을 입력해 주세요.');
  if (input.slots.length === 0) return fail('INVALID', '자리를 최소 1개 만들어 주세요.');
  if (input.slots.some((s) => s.capacity < 1))
    return fail('INVALID', '자리 정원은 1명 이상이어야 합니다.');
  if (input.joinDeadline > input.meetAt)
    return fail('INVALID', '신청 마감은 만나는 시각보다 앞이어야 합니다.');
  if (input.meetAt <= now) return fail('INVALID', '이미 지난 시각입니다.');

  // 성별 자리가 있는 모임(미팅)은 주최자가 자기 성별 쪽에 앉는다
  const ownSide = input.hostGender ? input.slots.find((s) => s.gender === input.hostGender) : undefined;
  const hostSlotKey = input.hostSlotKey ?? ownSide?.key ?? input.slots[0].key;
  const hostSlot = input.slots.find((s) => s.key === hostSlotKey);
  if (!hostSlot) {
    return fail('SLOT_NOT_FOUND', '주최자가 앉을 자리가 없습니다.');
  }
  const hostGenderError = genderSeatError(hostSlot, { gender: input.hostGender });
  if (hostGenderError) return fail('FORBIDDEN', hostGenderError);

  // 주최자는 만들자마자 자기 자리에 앉는다. 2:2 미팅이면 우리 팀 한 자리가 이미 찬 상태.
  const slots: Slot[] = input.slots.map((s) => ({
    key: s.key,
    label: s.label,
    capacity: s.capacity,
    memberIds: s.key === hostSlotKey ? [input.hostId] : [],
    ...(s.gender ? { gender: s.gender } : {}),
  }));

  return ok({
    id: input.id,
    kind: input.kind,
    hostId: input.hostId,
    title: input.title.trim(),
    body: input.body.trim(),
    place: input.place.trim(),
    meetAt: input.meetAt,
    joinDeadline: input.joinDeadline,
    joinPolicy: input.joinPolicy,
    slots,
    applicants: [],
    status: 'open',
    reviews: [],
    meta: input.meta ?? {},
    createdAt: now,
  });
}

// ---------- 참여 자격 ----------

function checkEligibility(g: Gathering, user: GatherUser, now: ISODateTime): Result<true> {
  const status = currentStatus(g, now);
  if (status === 'cancelled' || status === 'done') return fail('NOT_OPEN');
  if (status === 'closed') return fail('DEADLINE_PASSED');
  if (status === 'full') return fail('SLOT_FULL', '정원이 모두 찼습니다.');
  const blocked = joinBlockReason(user);
  if (blocked) return fail('BANNED', blocked);
  if (isMember(g, user.id)) return fail('ALREADY_JOINED');
  if (isApplicant(g, user.id)) return fail('ALREADY_JOINED', '이미 신청했습니다. 승인을 기다려 주세요.');
  return ok(true);
}

// ---------- 선착순 참여 (미팅) ----------

/**
 * 빈 자리에 바로 앉는다. joinPolicy 가 'auto' 일 때만.
 *
 * 동시성: 이 함수는 "읽은 문서" 위에서만 판단한다. 두 사람이 같은 자리를 노리면 둘 다 빈 자리를 보지만,
 * 저장은 repo/gatherings 의 mutateGathering 이 version 이 같을 때만 반영하고 진 쪽은 다시 읽어 이 함수를 또 돌려
 * SLOT_FULL 을 받는다. 그래서 여기에는 잠금 코드가 없다.
 */
export function join(g: Gathering, user: GatherUser, slotKey: string, now: ISODateTime): Result<Gathering> {
  if (g.joinPolicy !== 'auto') {
    return fail('FORBIDDEN', '이 모임은 주최자 승인이 필요합니다.');
  }
  const eligible = checkEligibility(g, user, now);
  if (!eligible.ok) return eligible;

  const slot = g.slots.find((s) => s.key === slotKey);
  if (!slot) return fail('SLOT_NOT_FOUND');
  if (seatsLeft(slot) <= 0) return fail('SLOT_FULL');
  const genderError = genderSeatError(slot, user);
  if (genderError) return fail('FORBIDDEN', genderError);

  return ok(withSlots(g, seat(g.slots, slotKey, user.id)));
}

// ---------- 승인제 참여 (밥약) ----------

/** 신청만 걸어둔다. 대기 중엔 자리를 차지하지 않아서 주최자가 골라 받을 수 있다. */
export function apply(
  g: Gathering,
  user: GatherUser,
  slotKey: string,
  message: string,
  now: ISODateTime,
): Result<Gathering> {
  if (g.joinPolicy !== 'approval') {
    return fail('FORBIDDEN', '이 모임은 선착순이라 신청 없이 바로 참여합니다.');
  }
  const eligible = checkEligibility(g, user, now);
  if (!eligible.ok) return eligible;
  const target = g.slots.find((s) => s.key === slotKey);
  if (!target) return fail('SLOT_NOT_FOUND');
  const genderError = genderSeatError(target, user);
  if (genderError) return fail('FORBIDDEN', genderError);

  const applicant: Applicant = { userId: user.id, slotKey, message: message.trim(), appliedAt: now };
  return ok({ ...g, applicants: [...g.applicants, applicant] });
}

export function approve(g: Gathering, hostId: UserId, userId: UserId, now: ISODateTime): Result<Gathering> {
  if (g.hostId !== hostId) return fail('FORBIDDEN', '주최자만 승인할 수 있습니다.');
  const status = currentStatus(g, now);
  if (status === 'cancelled' || status === 'done') return fail('NOT_OPEN');

  const applicant = g.applicants.find((a) => a.userId === userId);
  if (!applicant) return fail('NOT_APPLICANT');

  const slot = g.slots.find((s) => s.key === applicant.slotKey);
  if (!slot) return fail('SLOT_NOT_FOUND');
  if (seatsLeft(slot) <= 0) return fail('SLOT_FULL', '자리가 다 찼습니다.');

  return ok({
    ...withSlots(g, seat(g.slots, applicant.slotKey, userId)),
    applicants: g.applicants.filter((a) => a.userId !== userId),
  });
}

export function reject(g: Gathering, hostId: UserId, userId: UserId): Result<Gathering> {
  if (g.hostId !== hostId) return fail('FORBIDDEN', '주최자만 거절할 수 있습니다.');
  if (!isApplicant(g, userId)) return fail('NOT_APPLICANT');
  return ok({ ...g, applicants: g.applicants.filter((a) => a.userId !== userId) });
}

// ---------- 취소 ----------

/**
 * 참여자가 빠진다. 마감 후에는 못 빼는 게 핵심 —
 * 마감 직전 이탈이 곧 노쇼라서, 마감이 지난 뒤 안 나오면 그건 출결에서 노쇼로 기록된다.
 */
export function leave(g: Gathering, userId: UserId, now: ISODateTime): Result<Gathering> {
  if (g.hostId === userId) return fail('HOST_CANNOT_LEAVE');

  if (isApplicant(g, userId)) {
    return ok({ ...g, applicants: g.applicants.filter((a) => a.userId !== userId) });
  }
  if (!isMember(g, userId)) return fail('NOT_JOINED');

  const status = currentStatus(g, now);
  if (status === 'cancelled' || status === 'done') return fail('NOT_OPEN');
  if (now >= g.joinDeadline) return fail('DEADLINE_PASSED', '마감 후에는 취소할 수 없습니다.');

  return ok(
    withSlots(
      g,
      g.slots.map((s) => ({ ...s, memberIds: s.memberIds.filter((id) => id !== userId) })),
    ),
  );
}

/** 주최자가 모임 자체를 접는다. */
export function cancel(g: Gathering, hostId: UserId): Result<Gathering> {
  if (g.hostId !== hostId) return fail('FORBIDDEN', '주최자만 취소할 수 있습니다.');
  if (g.status === 'cancelled') return fail('NOT_OPEN', '이미 취소된 모임입니다.');
  return ok({ ...g, status: 'cancelled' });
}

// ---------- 모임 후 상호 평가 (노쇼 관리 연동 지점) ----------

/**
 * 모임 시각이 지난 뒤 참여자가 다른 참여자를 평가한다. 같은 사람을 다시 평가하면 덮어쓴다.
 * 여기서 확정된 노쇼는 services/gathering 이 감지해 온도/경고를 갱신한다.
 * 이 파일은 온도 계산 방식을 전혀 모른다.
 */
export function submitReview(
  g: Gathering,
  reviewerId: UserId,
  targetId: UserId,
  mark: ReviewMark,
  now: ISODateTime,
): Result<Gathering> {
  if (now < g.meetAt) return fail('TOO_EARLY');
  if (!isMember(g, reviewerId)) return fail('NOT_JOINED', '참여한 사람만 평가할 수 있습니다.');
  if (!isMember(g, targetId)) return fail('NOT_JOINED', '그 사람은 이 모임 참여자가 아닙니다.');
  if (reviewerId === targetId) return fail('INVALID', '자기 자신은 평가할 수 없습니다.');

  const review: Review = { by: reviewerId, target: targetId, mark, at: now };
  return ok({
    ...g,
    status: 'done',
    reviews: [...g.reviews.filter((r) => !(r.by === reviewerId && r.target === targetId)), review],
  });
}

/** 내가 이 사람에게 남긴 평가 */
export const reviewOf = (g: Gathering, by: UserId, target: UserId): Review | undefined =>
  g.reviews.find((r) => r.by === by && r.target === target);

/**
 * 노쇼를 확정하려면 그 사람을 뺀 참여자가 적어도 이만큼은 있어야 한다.
 *
 * 왜 2명인가: 둘뿐인 모임(1:1 미팅, 정원 2 밥약)에서는 "나머지 전원" 이 곧 상대 한 명이다. 그러면 한 사람의 주장
 * 하나로 벌점(온도 −5, 경고 +1)이 확정되고, 2건이면 실제로 나왔어도 자동 정지된다 — 주최자가 2인 모임을 만들어
 * 신청자를 노쇼로 찍는 식의 악용이 가능하다. "한 명의 오해로 경고가 찍히지 않게" 라는 규칙의 취지가
 * 서로 다른 평가자 둘 이상이 일치해야 성립하는 것이다. 둘뿐인 모임의 불참은 신고(POST /reports)로 다룬다.
 */
export const NOSHOW_MIN_REVIEWERS = 2;

/**
 * 노쇼 확정 여부 — 그 사람을 뺀 나머지 참여자가 `NOSHOW_MIN_REVIEWERS` 명 이상이고, 그 **전원**이 '안 왔어요'를
 * 눌렀을 때만 true. (참여자가 그 사람 혼자거나 상대가 한 명뿐이면 확정할 수 없으므로 false)
 */
export function isNoshowConfirmed(g: Gathering, targetId: UserId): boolean {
  const others = memberIds(g).filter((id) => id !== targetId);
  if (others.length < NOSHOW_MIN_REVIEWERS) return false;
  return others.every((id) => reviewOf(g, id, targetId)?.mark === 'noshow');
}

/** 이 모임에서 노쇼로 확정된 사람들 */
export const confirmedNoshows = (g: Gathering): UserId[] =>
  memberIds(g).filter((id) => isNoshowConfirmed(g, id));

// ---------- 내부 ----------

const seat = (slots: Slot[], slotKey: string, userId: UserId): Slot[] =>
  slots.map((s) => (s.key === slotKey ? { ...s, memberIds: [...s.memberIds, userId] } : s));

/** 자리가 바뀔 때마다 full 여부를 다시 계산해서 status 에 반영한다. */
function withSlots(g: Gathering, slots: Slot[]): Gathering {
  const next = { ...g, slots };
  if (g.status === 'cancelled' || g.status === 'done') return next;
  return { ...next, status: isFull(next) ? 'full' : 'open' };
}
