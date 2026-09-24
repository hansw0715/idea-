/**
 * 서비스 계층. (담당: 한승원)
 *
 * 순수 도메인 함수(domain/gathering)와 바깥 세계(저장소, 이벤트)를 이어 붙이는 곳.
 * 모든 함수가 "불러오기 → 도메인 함수 → 저장 → 이벤트 발행" 한 흐름으로만 돼 있다.
 * API 라우트는 이 파일만 부르고, 규칙 판단은 절대 하지 않는다.
 */
import { asGatheringId, fail, ok, type GatheringId, type Result, type UserId } from '@/shared/types';
import { emit } from '@/shared/events';
import type { User } from '@/shared/user';
import * as G from '@/domain/gathering';
import type { Gathering, GatheringKind, GatheringMeta, ReviewMark, SlotSpec } from '@/domain/gathering';
import { gatheringRepo, userRepo } from './repo/memory-repo';
import { hiddenFor } from './safety-service';
import './reputation';
import './rooms';

const nowISO = () => new Date().toISOString();

async function load(id: GatheringId): Promise<Result<Gathering>> {
  const g = await gatheringRepo.find(id);
  return g ? ok(g) : fail('NOT_FOUND', '모임을 찾을 수 없습니다.');
}

async function loadUser(id: UserId): Promise<Result<User>> {
  const u = await userRepo.find(id);
  return u ? ok(u) : fail('NOT_FOUND', '사용자를 찾을 수 없습니다.');
}

/**
 * 차단한 사람이 있는 모임에는 들어가지 않는다. 차단은 한쪽만 걸어도 양쪽에 적용된다.
 * (도메인은 차단을 모른다 — 사람 사이의 관계라 저장소가 필요해서 서비스에서 막는다)
 */
async function checkNotBlocked(g: Gathering, userId: UserId): Promise<Result<true>> {
  const hidden = await hiddenFor(userId);
  const people = [g.hostId, ...G.memberIds(g)];
  return people.some((id) => hidden.has(id))
    ? fail('FORBIDDEN', '차단한 사용자가 있는 모임이에요.')
    : ok(true);
}

/**
 * '같은 과 빼고' 미팅에 같은 학과 사람이 들어오는 걸 막는다.
 * 학과는 화면에 안 보이는 정보라 도메인이 아니라 여기서 검사한다.
 */
async function checkDepartment(g: Gathering, user: User): Promise<Result<true>> {
  if (!g.meta.excludeSameDept) return ok(true);

  const people = await Promise.all([g.hostId, ...G.memberIds(g)].map((id) => userRepo.find(id)));
  return people.some((m) => m && m.id !== user.id && m.department === user.department)
    ? fail('FORBIDDEN', '같은 학과는 참여할 수 없는 미팅이에요.')
    : ok(true);
}

/** 도메인 함수가 성공했을 때만 저장하고 이벤트를 내보내는 공통 처리 */
async function commit(
  result: Result<Gathering>,
  events: (g: Gathering) => void = () => {},
): Promise<Result<Gathering>> {
  if (!result.ok) return result;
  await gatheringRepo.save(result.value);
  events(result.value);
  return result;
}

// ---------- 조회 ----------

export const listGatherings = (kind?: GatheringKind) => gatheringRepo.list(kind);
export const findGathering = (id: GatheringId) => gatheringRepo.find(id);
export const listUsers = () => userRepo.list();
export const findUser = (id: UserId) => userRepo.find(id);
export const listMyGatherings = (userId: UserId) => gatheringRepo.listByUser(userId);

// ---------- 명령 ----------

export type CreateInput = {
  kind: GatheringKind;
  title: string;
  body: string;
  place: string;
  meetAt: string;
  joinDeadline: string;
  joinPolicy: 'auto' | 'approval';
  slots: SlotSpec[];
  meta?: GatheringMeta;
};

export async function createGathering(
  hostId: UserId,
  input: CreateInput,
): Promise<Result<Gathering>> {
  const host = await loadUser(hostId);
  if (!host.ok) return host;
  if (!host.value.verified) return fail('FORBIDDEN', '학교 메일 인증 후 모임을 만들 수 있습니다.');
  if (host.value.banned) return fail('BANNED', '이용이 제한된 계정은 모임을 만들 수 없습니다.');

  const now = nowISO();
  const created = G.createGathering(
    { id: asGatheringId(crypto.randomUUID()), hostId, ...input },
    now,
  );

  return commit(created, (g) =>
    emit({ type: 'gathering.created', gatheringId: g.id, hostId, kind: g.kind, at: now }),
  );
}

export async function joinGathering(
  id: GatheringId,
  userId: UserId,
  slotKey: string,
): Promise<Result<Gathering>> {
  const [g, user] = await Promise.all([load(id), loadUser(userId)]);
  if (!g.ok) return g;
  if (!user.ok) return user;

  const allowed = await checkNotBlocked(g.value, userId);
  if (!allowed.ok) return allowed;
  const sameDept = await checkDepartment(g.value, user.value);
  if (!sameDept.ok) return sameDept;

  const now = nowISO();
  return commit(G.join(g.value, user.value, slotKey, now), (next) => {
    emit({ type: 'gathering.joined', gatheringId: next.id, userId, at: now });
    if (G.isFull(next)) emit({ type: 'gathering.filled', gatheringId: next.id, at: now });
  });
}

export async function applyToGathering(
  id: GatheringId,
  userId: UserId,
  slotKey: string,
  message: string,
): Promise<Result<Gathering>> {
  const [g, user] = await Promise.all([load(id), loadUser(userId)]);
  if (!g.ok) return g;
  if (!user.ok) return user;

  const allowed = await checkNotBlocked(g.value, userId);
  if (!allowed.ok) return allowed;
  const sameDept = await checkDepartment(g.value, user.value);
  if (!sameDept.ok) return sameDept;

  return commit(G.apply(g.value, user.value, slotKey, message, nowISO()));
}

export async function approveApplicant(
  id: GatheringId,
  hostId: UserId,
  userId: UserId,
): Promise<Result<Gathering>> {
  const g = await load(id);
  if (!g.ok) return g;

  const now = nowISO();
  return commit(G.approve(g.value, hostId, userId, now), (next) => {
    emit({ type: 'gathering.joined', gatheringId: next.id, userId, at: now });
    if (G.isFull(next)) emit({ type: 'gathering.filled', gatheringId: next.id, at: now });
  });
}

export async function rejectApplicant(
  id: GatheringId,
  hostId: UserId,
  userId: UserId,
): Promise<Result<Gathering>> {
  const g = await load(id);
  if (!g.ok) return g;
  return commit(G.reject(g.value, hostId, userId));
}

export async function leaveGathering(
  id: GatheringId,
  userId: UserId,
): Promise<Result<Gathering>> {
  const g = await load(id);
  if (!g.ok) return g;

  const now = nowISO();
  return commit(G.leave(g.value, userId, now), (next) =>
    emit({ type: 'gathering.left', gatheringId: next.id, userId, at: now }),
  );
}

export async function cancelGathering(
  id: GatheringId,
  hostId: UserId,
): Promise<Result<Gathering>> {
  const g = await load(id);
  if (!g.ok) return g;

  const now = nowISO();
  return commit(G.cancel(g.value, hostId), (next) =>
    emit({ type: 'gathering.cancelled', gatheringId: next.id, at: now }),
  );
}

/**
 * 모임 후 상호 평가 — 온도/경고 모듈로 이벤트가 나가는 지점.
 * 노쇼 이벤트는 "이번 평가로 처음 확정됐을 때" 한 번만 내보낸다(중복 경고 방지).
 */
export async function reviewParticipant(
  id: GatheringId,
  reviewerId: UserId,
  targetId: UserId,
  mark: ReviewMark,
): Promise<Result<Gathering>> {
  const g = await load(id);
  if (!g.ok) return g;

  const wasConfirmed = G.isNoshowConfirmed(g.value, targetId);
  const now = nowISO();
  return commit(G.submitReview(g.value, reviewerId, targetId, mark, now), (next) => {
    emit({ type: 'participant.reviewed', gatheringId: next.id, userId: targetId, mark, at: now });
    if (!wasConfirmed && G.isNoshowConfirmed(next, targetId)) {
      emit({ type: 'participant.noshow', gatheringId: next.id, userId: targetId, at: now });
    }
  });
}
