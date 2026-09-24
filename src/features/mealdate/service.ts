/**
 * 밥약 빠른 매칭 서비스. (담당: 한승원)
 * 순수 규칙은 quick-match.ts, 저장·시간·이벤트는 여기.
 */
import { asGatheringId, fail, ok, type Result, type UserId } from '@/shared/types';
import type { User } from '@/shared/user';
import * as G from '@/domain/gathering';
import type { Gathering } from '@/domain/gathering';
import { emit } from '@/shared/events';
import { blockChecker } from '@/server/safety-service';
import { gatheringRepo, quickMatchRepo, userRepo } from '@/server/repo/memory-repo';
import { MEAL_SLOT, PLACE_TYPES, type PlaceType } from './preset';
import {
  answer,
  BAND_KEYS,
  createRoom,
  decideBand,
  findGroup,
  isExpired,
  meetAtOf,
  vote,
  type Answer,
  type QuickRequest,
  type QuickRoom,
} from './quick-match';

const nowISO = () => new Date().toISOString();

export type QuickInput = {
  date: string;
  placeType: PlaceType;
  size: number;
  bands: string[];
  tags: string[];
};

export type QuickState = {
  request: QuickRequest | null;
  room: QuickRoom | null;
  /** 방 멤버 표시용 (닉네임/단과대까지만) */
  members: { id: string; nickname: string; college: string; temperature: number }[];
  /** 확정된 밥약 id */
  gatheringId: string | null;
  waitingCount: number;
};

// ---------- 조회 ----------

/** 만료된 방을 정리하고 대기표를 되돌린다. 읽을 때마다 한 번씩 해주면 별도 스케줄러가 필요 없다. */
async function sweep(): Promise<{ requests: QuickRequest[]; rooms: QuickRoom[] }> {
  const now = nowISO();
  const [requests, rooms] = await Promise.all([quickMatchRepo.listRequests(), quickMatchRepo.listRooms()]);

  for (const room of rooms) {
    if (!isExpired(room, now)) continue;
    await quickMatchRepo.saveRoom({ ...room, status: 'cancelled' });
  }
  for (const req of requests) {
    const room = rooms.find((r) => r.id === req.roomId);
    const dead = room && (isExpired(room, now) || room.status === 'cancelled');
    if (req.status === 'matched' && dead) {
      // 방이 깨졌으면 다시 대기열로 — 사람이 다시 신청하게 만들면 이탈한다.
      await quickMatchRepo.saveRequest({ ...req, status: 'waiting', roomId: null });
    }
  }
  return { requests: await quickMatchRepo.listRequests(), rooms: await quickMatchRepo.listRooms() };
}

export async function quickState(userId: UserId): Promise<QuickState> {
  const { requests, rooms } = await sweep();
  const mine = requests
    .filter((r) => r.userId === userId && r.status !== 'cancelled')
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null;
  const room = mine?.roomId ? (rooms.find((r) => r.id === mine.roomId) ?? null) : null;

  const users = room ? await userRepo.list() : [];
  return {
    request: mine,
    room,
    members: room
      ? room.memberIds.map((id) => {
          const u = users.find((x) => x.id === id);
          return {
            id,
            nickname: u?.nickname ?? '(탈퇴)',
            college: u?.college ?? '-',
            temperature: u?.temperature ?? 0,
          };
        })
      : [],
    gatheringId: room?.gatheringId ?? null,
    waitingCount: requests.filter((r) => r.status === 'waiting').length,
  };
}

// ---------- 신청 ----------

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export async function requestQuickMatch(user: User, input: QuickInput): Promise<Result<QuickState>> {
  if (!DATE.test(input.date)) return fail('INVALID', '날짜를 골라 주세요.');
  if (!PLACE_TYPES.includes(input.placeType)) return fail('INVALID', '장소를 골라 주세요.');
  if (input.size < 2 || input.size > 4) return fail('INVALID', '인원은 2~4명까지예요.');
  const bands = input.bands.filter((b) => BAND_KEYS.includes(b));
  if (bands.length === 0) return fail('INVALID', '가능한 시간을 하나 이상 골라 주세요.');
  if (user.banned) return fail('BANNED');
  if (!user.verified) return fail('FORBIDDEN', '학교 메일 인증 후 이용할 수 있습니다.');

  // 지난 시간대만 고른 경우를 막는다 (오늘 점심이 이미 지났는데 매칭되면 곤란하다)
  const now = nowISO();
  const future = bands.filter((b) => meetAtOf(input.date, b) > now);
  if (future.length === 0) return fail('INVALID', '이미 지난 시간이에요. 다른 시간을 골라 주세요.');

  const { requests } = await sweep();
  if (requests.some((r) => r.userId === user.id && r.status !== 'cancelled')) {
    return fail('ALREADY_JOINED', '이미 대기 중인 빠른 매칭이 있어요.');
  }

  const request: QuickRequest = {
    id: crypto.randomUUID(),
    userId: user.id,
    date: input.date,
    placeType: input.placeType,
    size: input.size,
    bands: future,
    // 학과는 화면에 안 보이지만 '같은 과만' 조건을 맞추려면 필요해서 태그로 넣어둔다.
    tags: [...input.tags, `dept:${user.department}`],
    status: 'waiting',
    roomId: null,
    createdAt: now,
  };
  await quickMatchRepo.saveRequest(request);

  const hidden = await blockChecker();
  const group = findGroup(
    (await quickMatchRepo.listRequests()).filter((r) => r.status === 'waiting'),
    request,
    hidden,
  );

  if (group) {
    const room = createRoom(crypto.randomUUID(), group, now);
    await quickMatchRepo.saveRoom(room);
    for (const r of group) await quickMatchRepo.saveRequest({ ...r, status: 'matched', roomId: room.id });
  }
  return ok(await quickState(user.id));
}

export async function cancelQuickMatch(userId: UserId): Promise<Result<QuickState>> {
  const { requests } = await sweep();
  const mine = requests.find((r) => r.userId === userId && r.status !== 'cancelled');
  if (!mine) return fail('NOT_FOUND', '대기 중인 매칭이 없어요.');

  await quickMatchRepo.saveRequest({ ...mine, status: 'cancelled', roomId: null });
  if (mine.roomId) {
    const room = await quickMatchRepo.findRoom(mine.roomId);
    // 한 명이 빠지면 인원이 안 맞으므로 방을 깨고 나머지는 대기열로 돌린다.
    if (room && room.status === 'pending') await quickMatchRepo.saveRoom({ ...room, status: 'cancelled' });
  }
  return ok(await quickState(userId));
}

// ---------- 후보 방 ----------

export async function voteBands(userId: UserId, roomId: string, bands: string[]): Promise<Result<QuickState>> {
  const room = await quickMatchRepo.findRoom(roomId);
  if (!room) return fail('NOT_FOUND', '없는 방입니다.');

  const result = vote(room, userId, bands, nowISO());
  if (!result.ok) return result;
  await quickMatchRepo.saveRoom(result.value);
  return ok(await quickState(userId));
}

export async function answerRoom(userId: UserId, roomId: string, value: Answer): Promise<Result<QuickState>> {
  const room = await quickMatchRepo.findRoom(roomId);
  if (!room) return fail('NOT_FOUND', '없는 방입니다.');

  const result = answer(room, userId, value, nowISO());
  if (!result.ok) return result;

  let next = result.value;
  if (next.status === 'confirmed' && !next.gatheringId) {
    const created = await materialize(next);
    if (!created.ok) return created;
    next = { ...next, gatheringId: created.value.id };
  }
  await quickMatchRepo.saveRoom(next);

  // 방이 깨졌으면 참여자들을 대기열로 돌려놓는다
  if (next.status === 'cancelled') {
    for (const req of await quickMatchRepo.listRequests()) {
      if (req.roomId !== next.id) continue;
      const back = req.userId === userId ? { status: 'cancelled' as const, roomId: null } : { status: 'waiting' as const, roomId: null };
      await quickMatchRepo.saveRequest({ ...req, ...back });
    }
  }
  return ok(await quickState(userId));
}

/** 확정된 방을 진짜 밥약(Gathering)으로 만든다 — 이후 취소·평가·노쇼는 기존 로직을 그대로 탄다. */
async function materialize(room: QuickRoom): Promise<Result<Gathering>> {
  const band = decideBand(room);
  if (!band) return fail('INVALID', '겹치는 시간이 없어요.');

  const meetAt = meetAtOf(room.date, band);
  const now = nowISO();
  // 확정 직후라 신청 마감은 의미가 없지만, 도메인이 요구하므로 약속 10분 전으로 둔다.
  const joinDeadline = new Date(Math.max(new Date(meetAt).getTime() - 10 * 60_000, Date.now() + 1000)).toISOString();

  const users = await userRepo.list();
  const members = room.memberIds.map((id) => users.find((u) => u.id === id)).filter((u): u is User => !!u);
  if (members.length !== room.memberIds.length) return fail('NOT_FOUND', '참여자 정보를 찾을 수 없어요.');

  const created = G.createGathering(
    {
      id: asGatheringId(crypto.randomUUID()),
      kind: 'meal',
      hostId: members[0].id,
      title: `${room.placeType}에서 같이 밥 (빠른 매칭)`,
      body: '빠른 매칭으로 잡힌 약속이에요. 시간·장소는 서로 확인해 주세요.',
      place: room.placeType,
      meetAt,
      joinDeadline,
      joinPolicy: 'auto',
      slots: [{ key: MEAL_SLOT, label: '같이 먹을 사람', capacity: room.size }],
      meta: { placeType: room.placeType, tags: ['빠른 매칭'] },
    },
    now,
  );
  if (!created.ok) return created;

  // 첫 사람은 createGathering이 이미 앉혔고, 나머지를 차례로 앉힌다.
  let gathering = created.value;
  for (const member of members.slice(1)) {
    const seated = G.join(gathering, member, MEAL_SLOT, now);
    if (!seated.ok) return seated;
    gathering = seated.value;
  }

  await gatheringRepo.save(gathering);
  emit({ type: 'gathering.created', gatheringId: gathering.id, hostId: gathering.hostId, kind: 'meal', at: now });
  emit({ type: 'gathering.filled', gatheringId: gathering.id, at: now });
  return ok(gathering);
}
