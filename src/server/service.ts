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
import type { AttendanceMark, Gathering, GatheringKind, SlotSpec } from '@/domain/gathering';
import { gatheringRepo, userRepo } from './repo/memory-repo';
import './bootstrap';

const nowISO = () => new Date().toISOString();

async function load(id: GatheringId): Promise<Result<Gathering>> {
  const g = await gatheringRepo.find(id);
  return g ? ok(g) : fail('NOT_FOUND', '모임을 찾을 수 없습니다.');
}

async function loadUser(id: UserId): Promise<Result<User>> {
  const u = await userRepo.find(id);
  return u ? ok(u) : fail('NOT_FOUND', '사용자를 찾을 수 없습니다.');
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
};

export async function createGathering(
  hostId: UserId,
  input: CreateInput,
): Promise<Result<Gathering>> {
  const host = await loadUser(hostId);
  if (!host.ok) return host;
  if (!host.value.verified) return fail('FORBIDDEN', '학교 메일 인증 후 모임을 만들 수 있습니다.');

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

/** 출결 기록 — 노쇼 관리 모듈로 이벤트가 나가는 지점 */
export async function markAttendance(
  id: GatheringId,
  hostId: UserId,
  userId: UserId,
  mark: AttendanceMark,
): Promise<Result<Gathering>> {
  const g = await load(id);
  if (!g.ok) return g;

  const now = nowISO();
  return commit(G.markAttendance(g.value, hostId, userId, mark, now), (next) =>
    emit({
      type: mark === 'noshow' ? 'participant.noshow' : 'participant.attended',
      gatheringId: next.id,
      userId,
      at: now,
    }),
  );
}
