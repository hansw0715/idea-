/**
 * 밥약 빠른 매칭 서비스 — 순수 규칙(domain/quickMatch)과 저장소(repo/quick)를 잇고 부수효과를 **await** 한다.
 * (ZIP `features/mealdate/service.ts` 이식 + 경쟁 처리 보강. 규칙: docs/lounge/01-contract.md §4)
 *
 * 이 파일이 지키는 약속
 *  1) 한 대기표는 한 방에만 들어간다. 선점은 `UPDATE … WHERE status='waiting'` 영향 행 수로 가른다.
 *     여러 요청이 같은 대기표를 노려도 항상 같은 순서(오래된 순)로 선점하므로, 서로 반쪽씩 쥐고 놓치는 일(교착)이 없다.
 *  2) 한 방에서 밥약은 **최대 한 번** 만들어진다. 방 문서의 `gatheringId` 를 낙관적 잠금(version)으로 먼저
 *     확정한 요청만 모임을 만든다. 재시도·동시 수락에도 모임 id 는 하나다.
 *  3) 모든 부수효과(모임 저장, 단톡방 열기, 대기표 복귀, 재매칭)는 요청 안에서 끝낸다 — 서버리스는 응답 뒤에 멈출 수 있다.
 *  4) 읽을 때마다 `sweep` 이 만료된 방을 정리한다 (별도 스케줄러 없음).
 */
import { randomUUID } from 'node:crypto';
import { MEAL_SLOT } from '../../../shared/lounge/constants.js';
import { fail, ok } from '../../../shared/lounge/types.js';
import type { ISODateTime, Result } from '../../../shared/lounge/types.js';
import type { QuickInput, QuickState } from '../../../shared/lounge/view.js';
import { createGathering, isFull, join } from '../domain/gathering.js';
import {
  DEPT_TAG_PREFIX,
  answer,
  confirmedMeetAt,
  createRoom,
  dropPastBands,
  findGroup,
  futureBands,
  hasBlockedPair,
  isExpired,
  isFinishedRoom,
  parseQuickInput,
  toRequestView,
  vote,
} from '../domain/quickMatch.js';
import type { Answer, QuickRequest, QuickRoom } from '../domain/quickMatch.js';
import { findGathering, insertGathering } from '../repo/gatherings.js';
import * as repo from '../repo/quick.js';
import { banReason, loadUsers, toPublicUser, unknownUser } from '../users.js';
import type { LoungeUser } from '../users.js';
import { openRoomIfNeeded } from './chat.js';
import { blockChecker } from './safety.js';

const nowISO = (): ISODateTime => new Date().toISOString();

/** 방·대기표를 고칠 때 충돌하면 처음부터 다시 읽는 최대 횟수와 대기 시간(ms) */
const RETRIES = 6;
const backoff = () => new Promise<void>((resolve) => setTimeout(resolve, 10 + Math.random() * 30));

/** 한 요청이 대기표 선점에 지고 남은 대기표로 다시 짝을 찾는 최대 횟수 */
const MATCH_ATTEMPTS = 8;

const ROOM_BROKEN_BY_TIME = '시간이 지나 매칭이 취소됐어요.';

// ───────────── 같은 사람의 요청 직렬화 ─────────────

/**
 * 같은 사용자의 신청을 한 줄로 세운다. 더블 클릭으로 요청 두 개가 동시에 들어와도 두 번째는
 * 첫 번째가 끝난 뒤에 "이미 대기 중"을 보게 된다. (인스턴스 안에서만 유효 — 여러 인스턴스 사이는
 * 신청 직후의 중복 검사가 마지막 안전장치다. DB 유니크 인덱스가 있으면 그게 가장 확실하다.)
 */
const userLocks = new Map<string, Promise<unknown>>();
async function withUserLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const previous = userLocks.get(key) ?? Promise.resolve();
  const current = previous.then(fn, fn);
  const tail = current.catch(() => undefined);
  userLocks.set(key, tail);
  try {
    return await current;
  } finally {
    if (userLocks.get(key) === tail) userLocks.delete(key);
  }
}

const isUniqueViolation = (e: unknown): boolean => (e as { code?: string } | null)?.code === '23505';

// ───────────── 조회 · 정리 ─────────────

/**
 * 만료된 방을 정리하고 대기표를 되돌린다. 읽을 때마다 한 번씩 하면 별도 스케줄러가 필요 없다.
 *  1) 시간이 다 됐거나 남은 시간대가 없는 후보 방을 깬다
 *  2) 멤버가 탈퇴했거나 정지된 후보 방을 깬다 — 그 사람은 영영 수락할 수 없어서, 남은 사람이 만료(30분)까지
 *     오지 않을 수락을 기다리게 된다. 이쪽은 사람이 사라진 경우라 남은 사람을 바로 다시 짝지어 준다.
 *  3) 깨진 방에 붙어 있던 대기표를 waiting 으로 돌린다 (그 방에서 거절한 사람의 것은 cancelled)
 *  4) 정지된 사용자·지난 시간대만 남은 대기표는 닫는다
 *
 * 만료로 깨진 방(1)은 일부러 "돌아온 대기표를 바로 다시 짝지어 주지" 않는다. 만료는 아무도 응답하지 않은 경우가 많아서,
 * 바로 같은 사람들을 새 방에 넣으면 자리를 비운 사람과 끝없이 방이 만들어졌다 깨지기 때문이다.
 * (거절·취소·탈퇴처럼 사람이 직접 한 행동 뒤에는 releaseAndRematch 가 바로 다시 짝을 찾아 준다.)
 */
export async function sweep(now: ISODateTime = nowISO()): Promise<void> {
  const alive: QuickRoom[] = [];
  for (const { room } of await repo.listPendingRooms()) {
    if (isExpired(room, now) || dropPastBands(room, now) === null) await cancelPendingRoom(room.id);
    else alive.push(room);
  }
  for (const roomId of await roomsWithGoneMember(alive)) await breakRoom(roomId, now);
  await repo.releaseDeadRoomTickets();

  await repo.cancelBannedWaiting();
  const stale = (await repo.listWaiting()).filter((r) => futureBands(r.date, r.bands, now).length === 0);
  await repo.cancelWaiting(stale.map((r) => r.id));
}

/**
 * 멤버 중에 탈퇴했거나(users 행이 없음) 정지된 사람이 있는 방의 id.
 * 후보 방은 한 번에 소수라서 멤버를 모아 한 번에 읽는다 — 방마다 따로 읽으면 폴링 한 번이 쿼리 N 개가 된다.
 */
async function roomsWithGoneMember(rooms: QuickRoom[]): Promise<string[]> {
  if (rooms.length === 0) return [];
  const users = await loadUsers(rooms.flatMap((r) => r.memberIds));
  const gone = (id: string) => {
    const u = users.get(id);
    return !u || u.banned;
  };
  return rooms.filter((r) => r.memberIds.some(gone)).map((r) => r.id);
}

type Ticket = { request: QuickRequest; room: QuickRoom | null };

/**
 * 내 현재 대기표(취소되지 않은 가장 최근 것)와 붙어 있는 방.
 * 확정된 약속이 이미 끝났으면 그 대기표를 닫아서, 한 번 매칭된 사람이 영영 새로 신청하지 못하는 일이 없게 한다.
 */
async function currentTicket(userId: string, now: ISODateTime): Promise<Ticket | null> {
  for (const request of await repo.listActiveByUser(userId)) {
    const found = request.roomId ? await repo.findRoom(request.roomId) : undefined;
    const room = found?.room ?? null;
    if (room && isFinishedRoom(room, now)) {
      await repo.cancelRequest(request.id);
      continue;
    }
    return { request, room };
  }
  return null;
}

/** 내 상태. 다른 사람의 대기표 내용은 내려보내지 않는다 (같은 방 사람의 이름표·투표·수락만 보인다). */
export async function quickState(userId: string, now: ISODateTime = nowISO()): Promise<QuickState> {
  await sweep(now);
  return buildState(userId, now);
}

async function buildState(userId: string, now: ISODateTime): Promise<QuickState> {
  const ticket = await currentTicket(userId, now);
  const room = ticket?.room && ticket.room.status !== 'cancelled' ? ticket.room : null;
  if (room?.status === 'confirmed') await repairGathering(room, now);

  const users = room ? await loadUsers(room.memberIds) : new Map<string, LoungeUser>();
  return {
    request: ticket ? toRequestView(ticket.request) : null,
    room,
    members: room
      ? room.memberIds.map((id) => {
          const u = users.get(id);
          return u ? toPublicUser(u) : unknownUser(id);
        })
      : [],
    gatheringId: room?.gatheringId ?? null,
    waitingCount: await repo.countWaiting(),
    meId: userId,
  };
}

// ───────────── 신청 ─────────────

/** 검증을 통과한 신청. `bands` 는 이미 시작한 시간대를 뺀 것이고, `now` 는 검증한 시각이다. */
export type PreparedQuickMatch = { input: QuickInput; bands: string[]; now: ISODateTime };

/**
 * 신청 검증만 한다 (DB 를 건드리지 않는 동기 함수). `raw` 는 요청 본문 그대로(unknown).
 * 라우트가 속도 제한을 세기 전에 부른다 — 잘못 입력해 되돌려받은 요청이 10분 10번 한도를 깎지 않게.
 * (모임 만들기의 prepareGathering 과 같은 역할)
 */
export function prepareQuickMatch(
  user: LoungeUser,
  raw: unknown,
  now: ISODateTime = nowISO(),
): Result<PreparedQuickMatch> {
  const parsed = parseQuickInput(raw);
  if (!parsed.ok) return parsed;
  if (user.banned) return fail('BANNED', banReason(user) ?? undefined);

  // 지난 시간대만 고른 경우를 막는다 (오늘 점심이 이미 지났는데 매칭되면 곤란하다)
  const bands = futureBands(parsed.value.date, parsed.value.bands, now);
  if (bands.length === 0) return fail('INVALID', '이미 지난 시간이에요. 다른 시간을 골라 주세요.');
  return ok({ input: parsed.value, bands, now });
}

/**
 * 빠른 매칭 신청 = 검증(prepareQuickMatch) + 저장·짝 찾기(submitQuickMatch).
 * 속도 제한이 필요 없는 호출(테스트·내부)용이다. 라우트는 둘을 나눠 불러 그 사이에 제한을 센다.
 */
export async function requestQuickMatch(
  user: LoungeUser,
  raw: unknown,
  now: ISODateTime = nowISO(),
): Promise<Result<QuickState>> {
  const prepared = prepareQuickMatch(user, raw, now);
  return prepared.ok ? submitQuickMatch(user, prepared.value) : prepared;
}

/**
 * 검증을 통과한 신청을 저장하고 짝을 찾는다.
 * 학과는 화면에 안 보이지만 '같은 과만' 조건을 맞추려면 필요해서 대기표 태그(dept:학과)로 넣는다.
 */
export async function submitQuickMatch(user: LoungeUser, prepared: PreparedQuickMatch): Promise<Result<QuickState>> {
  const { input, now } = prepared;
  const future = prepared.bands;
  return withUserLock(user.id, async () => {
    await sweep(now);
    const existing = await currentTicket(user.id, now);
    if (existing) return fail('ALREADY_JOINED', alreadyMessage(existing));

    const request: QuickRequest = {
      id: randomUUID(),
      userId: user.id,
      date: input.date,
      placeType: input.placeType,
      size: input.size,
      bands: future,
      tags: [...input.tags, `${DEPT_TAG_PREFIX}${user.department}`],
      status: 'waiting',
      roomId: null,
      createdAt: now,
    };
    try {
      await repo.insertRequest(request);
    } catch (e) {
      if (isUniqueViolation(e)) return fail('ALREADY_JOINED', alreadyMessage(null));
      throw e;
    }

    // 다른 인스턴스에서 거의 동시에 신청이 들어와 대기표가 둘 생겼다면, 먼저 만든 쪽만 남긴다.
    const mine = await repo.listActiveByUser(user.id);
    if (mine.length > 1) {
      const first = [...mine].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))[0];
      if (first.id !== request.id) {
        await repo.cancelRequest(request.id);
        return fail('ALREADY_JOINED', alreadyMessage(null));
      }
    }

    await tryMatch(request.id, now);
    return ok(await buildState(user.id, now));
  });
}

const alreadyMessage = (ticket: Ticket | null): string =>
  ticket?.room?.status === 'confirmed'
    ? '이미 확정된 빠른 매칭이 있어요. 새로 신청하려면 먼저 그 매칭을 닫아 주세요.'
    : '이미 대기 중인 빠른 매칭이 있어요.';

export async function cancelQuickMatch(userId: string, now: ISODateTime = nowISO()): Promise<Result<QuickState>> {
  await sweep(now);
  const ticket = await currentTicket(userId, now);
  if (!ticket) return fail('NOT_FOUND', '대기 중인 매칭이 없어요.');

  const cancelled = await repo.cancelRequest(ticket.request.id);
  // 한 명이 빠지면 인원이 안 맞으므로 방을 깨고 나머지는 대기열로 돌린다. (이미 확정된 방은 그대로 둔다)
  if (cancelled?.roomId) await breakRoom(cancelled.roomId, now);
  return ok(await buildState(userId, now));
}

// ───────────── 짝 찾기 ─────────────

/**
 * 이 대기표를 기준으로 짝을 찾아 방을 만든다. 만들었으면 true.
 *
 * 순서가 중요하다: ① 방을 먼저 저장 → ② 대기표를 **오래된 순**으로 하나씩 선점 → ③ 하나라도 놓치면
 * 선점한 것을 되돌리고 방을 지운 뒤 처음부터 다시.
 *  - 방을 먼저 저장하는 이유: 대기표가 가리키는 방이 없는 순간이 생기면 sweep 이 "깨진 방"으로 오해해 대기표를 풀어 버린다.
 *  - 항상 같은 순서로 선점하는 이유: 두 요청이 서로 다른 순서로 선점하면 각자 하나씩 쥐고 서로 실패해
 *    (교착) 아무도 방을 못 만든다. 같은 순서면 첫 대기표에서 한 요청만 이기고 나머지는 빈손으로 물러난다.
 *  - 다시 읽는 이유: 진 요청의 대기표들이 서로 맞는 짝일 수 있어, 남은 대기표로 한 번 더 찾아 준다.
 */
async function tryMatch(requestId: string, now: ISODateTime): Promise<boolean> {
  const hidden = await blockChecker();
  for (let attempt = 0; attempt < MATCH_ATTEMPTS; attempt++) {
    // 이미 시작한 시간대는 빼고 비교한다 — 안 그러면 과거 시각으로 방이 만들어질 수 있다.
    const waiting = (await repo.listWaiting())
      .map((r) => ({ ...r, bands: futureBands(r.date, r.bands, now) }))
      .filter((r) => r.bands.length > 0);
    const target = waiting.find((r) => r.id === requestId);
    if (!target) return false; // 다른 방에 들어갔거나 취소됐다
    const group = findGroup(waiting, target, hidden);
    if (!group) return false;

    const room = createRoom(randomUUID(), group, now);
    await repo.insertRoom(room);

    const claimed: string[] = [];
    let won = true;
    for (const r of [...group].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))) {
      if (await repo.claimWaiting(r.id, room.id)) claimed.push(r.id);
      else {
        won = false;
        break;
      }
    }
    if (won) return true;

    for (const id of claimed) await repo.releaseClaim(id, room.id);
    await repo.deleteRoom(room.id);
  }
  return false;
}

// ───────────── 후보 방 ─────────────

/** 방 문서를 "읽고 → 고치고 → version 이 같을 때만 저장"한다. 충돌하면 처음부터 다시 (최대 RETRIES 회). */
async function mutateRoom(
  roomId: string,
  change: (room: QuickRoom) => Result<QuickRoom>,
): Promise<Result<{ before: QuickRoom; after: QuickRoom }>> {
  for (let attempt = 0; attempt < RETRIES; attempt++) {
    const found = await repo.findRoom(roomId);
    if (!found) return fail('NOT_FOUND', '없는 방입니다.');
    const next = change(found.room);
    if (!next.ok) return next;
    if (await repo.updateRoom(next.value, found.version)) return ok({ before: found.room, after: next.value });
    await backoff();
  }
  return fail('CONFLICT');
}

/** 아직 pending 인 방만 취소한다. 이미 확정·취소된 방은 건드리지 않는다. */
async function cancelPendingRoom(roomId: string): Promise<void> {
  for (let attempt = 0; attempt < RETRIES; attempt++) {
    const found = await repo.findRoom(roomId);
    if (!found || found.room.status !== 'pending') return;
    if (await repo.updateRoom({ ...found.room, status: 'cancelled' }, found.version)) return;
    await backoff();
  }
}

/** 깨진 방의 대기표를 돌려놓고, 돌아온 대기표들이 다른 대기표와 다시 짝을 찾게 한다. (사람이 거절·취소한 경우) */
async function releaseAndRematch(roomId: string, now: ISODateTime): Promise<void> {
  for (const id of await repo.releaseDeadRoomTickets(roomId)) await tryMatch(id, now);
}

/**
 * 시간이 다 돼서(만료·시간대 소진) 깨진 방을 정리한다: 방을 취소하고 대기표만 되돌린다.
 * 다시 짝을 지어 주지는 않는다 — 아무도 응답하지 않은 방이 같은 사람들로 끝없이 다시 만들어지지 않게 하려는 것이다.
 */
async function expireRoom(roomId: string): Promise<void> {
  await cancelPendingRoom(roomId);
  await repo.releaseDeadRoomTickets(roomId);
}

/** 한 명이 빠져서(취소) 깨진 방을 정리하고 나머지를 다시 짝지어 준다. 이미 확정된 방은 건드리지 않는다. */
async function breakRoom(roomId: string, now: ISODateTime): Promise<void> {
  await cancelPendingRoom(roomId);
  await releaseAndRematch(roomId, now);
}

/** 가능한 시간 수정. 이미 시작한 시간대는 고를 수 없고, 남은 시간대가 없으면 방이 깨진다. */
export async function voteBands(
  userId: string,
  roomId: string,
  bands: string[],
  now: ISODateTime = nowISO(),
): Promise<Result<QuickState>> {
  const result = await mutateRoom(roomId, (room) => {
    const guard = vote(room, userId, bands, now); // 참여자·상태·만료 검사
    if (!guard.ok) return guard;
    const live = dropPastBands(room, now);
    if (!live) return fail('DEADLINE_PASSED', ROOM_BROKEN_BY_TIME);
    return vote(live, userId, bands, now);
  });
  if (!result.ok) {
    if (result.error.code === 'DEADLINE_PASSED') await expireRoom(roomId);
    return result;
  }
  return ok(await buildState(userId, now));
}

/**
 * 수락·거절. 거절하면 방이 깨지고 거절한 사람의 대기표는 cancelled, 나머지는 waiting.
 * 전원 수락이면 확정 — 그 순간 방 문서에 모임 id 를 **같은 잠금(version)으로** 적어 두므로,
 * 마지막 수락이 동시에 들어와도 확정을 쓴 요청은 정확히 하나이고 그 요청만 모임을 만든다.
 */
export async function answerRoom(
  userId: string,
  roomId: string,
  value: Answer,
  now: ISODateTime = nowISO(),
): Promise<Result<QuickState>> {
  const hidden = value === 'accepted' ? await blockChecker() : () => false;

  const result = await mutateRoom(roomId, (room) => {
    const guard = answer(room, userId, value, now); // 참여자·상태·만료 검사
    if (!guard.ok) return guard;
    if (value === 'declined') return guard;

    const live = dropPastBands(room, now);
    if (!live) return fail('DEADLINE_PASSED', ROOM_BROKEN_BY_TIME);
    const accepted = answer(live, userId, 'accepted', now);
    if (!accepted.ok || accepted.value.status !== 'confirmed') return accepted;

    // 확정 직전에 한 번 더: 매칭된 뒤에 서로 차단했다면 그 자리를 억지로 만들지 않는다.
    if (hasBlockedPair(accepted.value, hidden)) return ok({ ...accepted.value, status: 'cancelled' });
    return ok({ ...accepted.value, gatheringId: randomUUID() });
  });

  if (!result.ok) {
    if (result.error.code === 'DEADLINE_PASSED') await expireRoom(roomId);
    return result;
  }

  const { before, after } = result.value;
  if (before.status === 'pending' && after.status === 'cancelled') {
    await releaseAndRematch(roomId, now);
    if (value === 'accepted') return fail('NOT_OPEN', MATCH_NOT_CONFIRMED);
  } else if (before.status === 'pending' && after.status === 'confirmed') {
    const made = await materialize(after, now);
    if (!made.ok) return fail('NOT_OPEN', MATCH_NOT_CONFIRMED);
  }
  return ok(await buildState(userId, now));
}

const MATCH_NOT_CONFIRMED = '매칭을 확정하지 못했어요. 다시 짝을 찾고 있어요.';

// ───────────── 확정 → 진짜 밥약 ─────────────

/** 확정된 방의 모임을 만든다. 만들 수 없는 사정이 생겼으면 확정을 되돌리고 나머지를 대기열로 돌린다. */
async function materialize(room: QuickRoom, now: ISODateTime): Promise<Result<true>> {
  const made = await ensureGathering(room, now);
  if (made.ok) return made;

  const gatheringId = room.gatheringId;
  if (gatheringId && (await findGathering(gatheringId))) return ok(true); // 그 사이 다른 요청이 만들었다
  await revertConfirmedRoom(room.id);
  // 탈퇴했거나 정지된 사람의 대기표는 닫고, 나머지는 다시 대기열로
  const users = await loadUsers(room.memberIds);
  for (const id of room.memberIds) {
    const u = users.get(id);
    if (!u || u.banned) await repo.cancelRoomTicket(room.id, id);
  }
  await releaseAndRematch(room.id, now);
  return made;
}

async function revertConfirmedRoom(roomId: string): Promise<void> {
  for (let attempt = 0; attempt < RETRIES; attempt++) {
    const found = await repo.findRoom(roomId);
    if (!found || found.room.status !== 'confirmed') return;
    if (await repo.updateRoom({ ...found.room, status: 'cancelled', gatheringId: null }, found.version)) return;
    await backoff();
  }
}

/**
 * 방에 적힌 모임 id 로 밥약(Gathering)을 만든다 — 이미 있으면 아무것도 하지 않는다(멱등).
 * 이후 취소·평가·노쇼는 기존 모임 로직을 그대로 탄다.
 */
async function ensureGathering(room: QuickRoom, now: ISODateTime): Promise<Result<true>> {
  const gatheringId = room.gatheringId;
  if (!gatheringId) return fail('INVALID', '모임 번호가 없는 방이에요.');
  if (await findGathering(gatheringId)) return ok(true);

  const meetAt = confirmedMeetAt(room);
  if (!meetAt) return fail('INVALID', '겹치는 시간이 없어요.');

  const users = await loadUsers(room.memberIds);
  const members: LoungeUser[] = [];
  for (const id of room.memberIds) {
    const u = users.get(id);
    if (!u) return fail('NOT_FOUND', '참여자 정보를 찾을 수 없어요.');
    members.push(u);
  }
  const bannedMember = members.find((m) => m.banned);
  if (bannedMember) return fail('BANNED', '이용이 제한된 참여자가 있어요.');

  // 확정 직후라 신청 마감은 의미가 없지만, 도메인이 요구하므로 약속 10분 전(이미 지났으면 지금+1초)으로 둔다. 약속 시각은 넘지 않는다.
  const meetMs = Date.parse(meetAt);
  const joinDeadline = new Date(Math.min(meetMs, Math.max(meetMs - 10 * 60_000, Date.parse(now) + 1000))).toISOString();

  const created = createGathering(
    {
      id: gatheringId,
      kind: 'meal',
      hostId: members[0].id,
      title: `${room.placeType}에서 같이 밥 (빠른 매칭)`,
      body: '빠른 매칭으로 잡힌 약속이에요. 시간·장소는 서로 확인해 주세요.',
      place: room.placeType,
      meetAt,
      joinDeadline,
      joinPolicy: 'auto',
      slots: [{ key: MEAL_SLOT, label: '같이 먹을 사람', capacity: members.length }],
      meta: { placeType: room.placeType, tags: ['빠른 매칭'] },
    },
    now,
  );
  if (!created.ok) return created;

  // 첫 사람은 createGathering 이 이미 앉혔고, 나머지를 차례로 앉힌다.
  let gathering = created.value;
  for (const member of members.slice(1)) {
    const seated = join(gathering, member, MEAL_SLOT, now);
    if (!seated.ok) return seated;
    gathering = seated.value;
  }

  try {
    await insertGathering(gathering);
  } catch (e) {
    // 같은 id 로 동시에 만들려던 다른 요청이 먼저 저장했다면 그것으로 충분하다.
    if (!(await findGathering(gatheringId))) throw e;
  }
  // 단톡방 열기는 멱등이라, 저장을 누가 했든 한 번 더 불러도 안전하다 (저장 직후 멈춘 경우도 메운다).
  if (isFull(gathering)) await openRoomIfNeeded(gatheringId);
  return ok(true);
}

/**
 * 확정된 방인데 모임이 없다면(만드는 도중 서버가 멈추거나, 만드는 요청이 아직 저장 전인 짧은 틈) 지금 만든다.
 * 같은 id 로 만들므로 그 요청과 겹쳐도 모임은 하나다. 이미 지난 약속은 다시 만들지 않는다.
 */
async function repairGathering(room: QuickRoom, now: ISODateTime): Promise<void> {
  if (!room.gatheringId) return;
  const meetAt = confirmedMeetAt(room);
  if (!meetAt || meetAt <= now) return;
  if (await findGathering(room.gatheringId)) return;
  await materialize(room, now);
}
