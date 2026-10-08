/**
 * 모임 서비스 통합 테스트 — 실제 Postgres 호환 DB(PGlite)를 임시 폴더에 만들어 돌린다.
 *
 * 순수 도메인 규칙은 domain/*.test.ts 가 DB 없이 검증한다. 여기서는 DB 가 끼어야만 생기는 문제를 본다.
 *   - 같은 자리에 동시에 앉기(낙관적 잠금) · 평판의 멱등 반영 · 단톡방 열기의 멱등
 *   - 차단 양방향 필터 · 신고 자동 제한 · 관리자 처리 · 내 모임 조회 · 입력 검증
 *
 * 안전: 개발 DB(DATA_DIR/DATABASE_URL)를 절대 건드리지 않도록 이 파일이 환경을 직접 정한다.
 * 임시 DB 는 `.tmp/s1-test-db` 에 만들고 시작할 때 비운다(PGlite 가 파일을 쥐고 있어 끝난 뒤 지우지 못할 수 있다).
 */
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import type http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import jwt from 'jsonwebtoken';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { get, insert, ready, run } from '../../db.js';
import { ok } from '../../../shared/lounge/types.js';
import type { Result } from '../../../shared/lounge/types.js';
import { MEAL_PRESET, MEAL_SLOT, MEETUP_PRESETS, SYSTEM_OPEN_MESSAGE } from '../../../shared/lounge/constants.js';
import type { CreateGatheringBody, Gathering } from '../../../shared/lounge/gathering.js';
import { confirmNoshowDb, findUser } from '../users.js';
import type { LoungeUser } from '../users.js';
import * as G from '../domain/gathering.js';
import { findGathering, insertGathering, listMine, mutateGathering } from '../repo/gatherings.js';
import { listMessages } from '../repo/messages.js';
import * as svc from './gathering.js';
import { openRoomIfNeeded, roomView, sendMessage } from './chat.js';
import { blockChecker, blockUser, handleReport, hiddenFor, listReportsForAdmin, myBlocks, reportUser, unblockUser } from './safety.js';
import { adminStats } from './stats.js';
import { sortMealFeed, toView } from './present.js';
import { parseActionBody, parseCreateBody, parseUserId } from '../routes/gatherings.js';

// 여러 작업자가 동시에 vitest 를 돌려도 서로의 DB 를 지우지 않도록 실행마다 다른 폴더를 쓴다.
const DB_DIR = path.join(process.cwd(), '.tmp', `s1-test-db-${process.pid}-${randomUUID().slice(0, 6)}`);

beforeAll(async () => {
  // 실수로라도 원격 DB 에 붙지 않게: 연결 문자열을 비우고, 임시 폴더를 쓰게 한다.
  delete process.env.DATABASE_URL;
  fs.rmSync(DB_DIR, { recursive: true, force: true });
  process.env.DATA_DIR = DB_DIR;
  expect(process.env.DATABASE_URL).toBeUndefined();
  await ready();
}, 180_000);

afterAll(() => {
  // Windows 에서는 PGlite 가 파일을 쥐고 있어 실패할 수 있다 — 다음 실행이 시작할 때 비우므로 무시한다.
  try {
    fs.rmSync(DB_DIR, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

// ───────────── 도우미 ─────────────

const created: LoungeUser[] = [];
let seq = 0;

async function makeUser(
  over: Partial<{ department: string; banned: boolean; warnings: number; temperature: number; profile: boolean }> = {},
): Promise<LoungeUser> {
  const n = ++seq;
  const id = await insert(
    `INSERT INTO users (email, name, password_hash, nickname, college, department, admission_year,
                        avatar, avatar_color, profile_done, banned, warnings, temperature)
     VALUES (?, ?, 'x', ?, 'IT공과대학', ?, 2024, 'turtle-smile', 'm1', ?, ?, ?, ?) RETURNING id`,
    [
      `t${n}-${randomUUID().slice(0, 6)}@hansung.ac.kr`,
      `실명${n}`,
      `닉${n}`,
      over.department ?? `학과${n}`,
      over.profile ?? true,
      over.banned ?? false,
      over.warnings ?? 0,
      over.temperature ?? 36.5,
    ],
  );
  const user = await findUser(id);
  if (!user) throw new Error('사용자 생성 실패');
  created.push(user);
  return user;
}

const inHours = (h: number) => new Date(Date.now() + h * 3600_000).toISOString();

const meetupBody = (over: Partial<CreateGatheringBody> = {}): CreateGatheringBody => ({
  kind: 'meetup',
  title: '금요일 저녁 2:2',
  body: '',
  place: '삼선교',
  meetAt: inHours(72),
  joinDeadline: inHours(48),
  joinPolicy: 'auto',
  slots: MEETUP_PRESETS['2:2'].slots,
  ...over,
});

const mealBody = (capacity = 2, over: Partial<CreateGatheringBody> = {}): CreateGatheringBody => ({
  kind: 'meal',
  title: '학식 같이',
  body: '',
  place: '상상관',
  meetAt: inHours(30),
  joinDeadline: inHours(24),
  joinPolicy: 'approval',
  slots: MEAL_PRESET(capacity).slots,
  ...over,
});

function must<T>(r: Result<T>): T {
  if (!r.ok) throw new Error(`실패: ${r.error.code} ${r.error.message}`);
  return r.value;
}

const makeMeetup = async (host: LoungeUser, over: Partial<CreateGatheringBody> = {}) =>
  must(await svc.createGathering(host, meetupBody(over)));
const makeMeal = async (host: LoungeUser, capacity = 2) => must(await svc.createGathering(host, mealBody(capacity)));

/** 이미 끝난 모임을 DB 에 직접 심는다 (도메인에 과거 시각을 넘겨 만들고 사람을 앉힌다). */
async function seedPast(hostId: string, guests: string[], kind: 'meetup' | 'meal' = 'meetup'): Promise<Gathering> {
  const past = (h: number) => new Date(Date.now() - h * 3600_000).toISOString();
  let g = must(
    G.createGathering(
      kind === 'meetup'
        ? {
            id: randomUUID(),
            kind,
            hostId,
            title: '지난 미팅',
            body: '',
            place: '삼선교',
            meetAt: past(24),
            joinDeadline: past(30),
            joinPolicy: 'auto',
            slots: MEETUP_PRESETS['4:4'].slots,
          }
        : {
            id: randomUUID(),
            kind,
            hostId,
            title: '지난 밥약',
            body: '',
            place: '상상관',
            meetAt: past(24),
            joinDeadline: past(30),
            joinPolicy: 'approval',
            slots: MEAL_PRESET(4).slots,
          },
      past(48),
    ),
  );
  for (const [i, id] of guests.entries()) {
    const slot = kind === 'meal' ? MEAL_SLOT : i % 2 === 0 ? 'guest' : 'host';
    g = must(G.join({ ...g, joinPolicy: 'auto' }, { id, banned: false, warnings: 0 }, slot, past(40)));
    g = { ...g, joinPolicy: kind === 'meal' ? 'approval' : 'auto' };
  }
  await insertGathering(g);
  return g;
}

const stat = async (userId: string) =>
  (await get<{ temperature: number; warnings: number; banned: boolean }>(
    'SELECT temperature, warnings, banned FROM users WHERE id = ?',
    [Number(userId)],
  ))!;

const messageCount = async (roomId: string) =>
  Number((await get<{ n: number }>('SELECT COUNT(*)::int AS n FROM lounge_messages WHERE room_id = ?', [roomId]))!.n);

const errCode = (r: Result<unknown>) => (r.ok ? 'OK' : r.error.code);

// ───────────── 동시성 ─────────────

describe('동시성 — 같은 자리에 동시에 앉기', () => {
  it('한 자리가 2개인 곳에 12명이 동시에 앉으면 정확히 2명만 성공하고 나머지는 SLOT_FULL', async () => {
    const host = await makeUser();
    const g = await makeMeetup(host);
    const users = await Promise.all(Array.from({ length: 12 }, () => makeUser()));

    const results = await Promise.all(users.map((u) => svc.joinGathering(u, g.id, 'guest')));

    expect(results.filter((r) => r.ok)).toHaveLength(2);
    expect(results.filter((r) => errCode(r) === 'SLOT_FULL')).toHaveLength(10);
    // 어느 요청도 CONFLICT(재시도 소진)로 끝나지 않았다
    expect(results.filter((r) => errCode(r) === 'CONFLICT')).toHaveLength(0);

    const stored = (await findGathering(g.id))!;
    const guest = stored.slots.find((s) => s.key === 'guest')!;
    expect(guest.memberIds).toHaveLength(2);
    expect(new Set(guest.memberIds).size).toBe(2); // 같은 사람이 두 번 앉지 않았다
    const winners = users.filter((_, i) => results[i].ok).map((u) => u.id);
    expect([...guest.memberIds].sort()).toEqual([...winners].sort());
    expect(stored.slots.find((s) => s.key === 'host')!.memberIds).toEqual([host.id]);
    expect(stored.status).toBe('open');
  });

  it('양쪽 자리 모두를 노려도 남은 자리 수(3)만큼만 앉고, 정원이 차면 문서가 full 이 되며 방 안내는 한 줄', async () => {
    const host = await makeUser();
    const g = await makeMeetup(host);
    const users = await Promise.all(Array.from({ length: 12 }, () => makeUser()));

    const results = await Promise.all(users.map((u, i) => svc.joinGathering(u, g.id, i % 2 === 0 ? 'host' : 'guest')));

    // host 쪽 1자리 + guest 쪽 2자리
    expect(results.filter((r) => r.ok)).toHaveLength(3);
    expect(results.filter((r) => errCode(r) === 'SLOT_FULL')).toHaveLength(9);

    const stored = (await findGathering(g.id))!;
    expect(G.isFull(stored)).toBe(true);
    expect(stored.status).toBe('full');
    const everyone = G.memberIds(stored);
    expect(everyone).toHaveLength(4);
    expect(new Set(everyone).size).toBe(4);

    // 마지막에 앉은 요청이 방을 열었고, 여러 요청이 겹쳐도 안내는 한 줄뿐이다
    expect(await messageCount(g.id)).toBe(1);
    const [only] = await listMessages(g.id);
    expect(only).toMatchObject({ kind: 'system', userId: null, text: SYSTEM_OPEN_MESSAGE });
  });

  it('같은 사람이 동시에 여러 번 눌러도 한 번만 앉는다', async () => {
    const host = await makeUser();
    const g = await makeMeetup(host);
    const user = await makeUser();

    const results = await Promise.all(Array.from({ length: 8 }, () => svc.joinGathering(user, g.id, 'guest')));

    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => errCode(r) === 'ALREADY_JOINED')).toHaveLength(7);
    expect((await findGathering(g.id))!.slots.find((s) => s.key === 'guest')!.memberIds).toEqual([user.id]);
  });

  it('밥약: 마지막 한 자리에 여러 신청을 동시에 승인해도 한 명만 앉는다', async () => {
    const host = await makeUser();
    const g = await makeMeal(host, 2); // 주최자 + 1자리
    const applicants = await Promise.all(Array.from({ length: 5 }, () => makeUser()));
    for (const a of applicants) must(await svc.applyToGathering(a, g.id, MEAL_SLOT, '같이 가요'));

    const results = await Promise.all(applicants.map((a) => svc.approveApplicant(host, g.id, a.id)));

    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => errCode(r) === 'SLOT_FULL')).toHaveLength(4);
    const stored = (await findGathering(g.id))!;
    expect(G.memberIds(stored)).toHaveLength(2);
    expect(await messageCount(g.id)).toBe(1); // 정원이 찬 순간 방이 열렸다
  });
});

describe('mutateGathering — 낙관적 잠금', () => {
  it('계속 지면 CONFLICT, 문서는 바뀌지 않는다', async () => {
    const host = await makeUser();
    const g = await makeMeetup(host);
    let calls = 0;

    const r = await mutateGathering(
      g.id,
      async (cur) => {
        calls++;
        // 내가 읽은 뒤 다른 요청이 먼저 저장한 상황을 매번 만든다
        await run('UPDATE lounge_gatherings SET version = version + 1 WHERE id = ?', [cur.id]);
        return ok({ ...cur, title: '바뀜' });
      },
      { retries: 2 },
    );

    expect(errCode(r)).toBe('CONFLICT');
    expect(calls).toBe(3); // 처음 + 다시 2번
    expect((await findGathering(g.id))!.title).toBe(g.title);
  });

  it('없는 모임은 NOT_FOUND, 도메인이 거절하면 저장 없이 그 오류를 돌려준다', async () => {
    expect(errCode(await mutateGathering(randomUUID(), (g) => ok(g)))).toBe('NOT_FOUND');

    const host = await makeUser();
    const g = await makeMeetup(host);
    const before = await get<{ version: number }>('SELECT version FROM lounge_gatherings WHERE id = ?', [g.id]);
    const r = await svc.joinGathering(host, g.id, 'guest'); // 주최자는 이미 참여 중
    expect(errCode(r)).toBe('ALREADY_JOINED');
    const after = await get<{ version: number }>('SELECT version FROM lounge_gatherings WHERE id = ?', [g.id]);
    expect(after!.version).toBe(before!.version);
  });

  it('성공하면 version 이 오르고 status · meet_at 사본이 문서와 같아진다', async () => {
    const host = await makeUser();
    const g = await makeMeetup(host);
    must(await svc.cancelGathering(host, g.id));
    const row = await get<{ status: string; version: number; meet_at: Date }>(
      'SELECT status, version, meet_at FROM lounge_gatherings WHERE id = ?',
      [g.id],
    );
    expect(row!.status).toBe('cancelled');
    expect(row!.version).toBe(2);
    expect(new Date(row!.meet_at).toISOString()).toBe(g.meetAt);
  });
});

// ───────────── 평판 ─────────────

describe('평판 — 멱등 반영', () => {
  it('좋았어요를 연타해도 온도는 +0.4 한 번만 오른다', async () => {
    const host = await makeUser();
    const a = await makeUser();
    const g = await seedPast(host.id, [a.id]);

    for (let i = 0; i < 5; i++) must(await svc.reviewParticipant(host, g.id, a.id, 'good'));

    expect((await stat(a.id)).temperature).toBeCloseTo(36.9, 5);
  });

  it('평가를 바꾸면 되돌아간다 (good → soso 는 −0.4, 다시 good 이면 +0.4)', async () => {
    const host = await makeUser();
    const a = await makeUser();
    // 셋이어야 한다: 노쇼 확정에는 그 사람을 뺀 참여자가 2명 이상 필요해서, 둘뿐이면 noshow 를 눌러도 (확정되지 않아) 이 흐름을 시험할 수 없다.
    const b = await makeUser();
    const g = await seedPast(host.id, [a.id, b.id]);

    must(await svc.reviewParticipant(host, g.id, a.id, 'good'));
    expect((await stat(a.id)).temperature).toBeCloseTo(36.9, 5);
    must(await svc.reviewParticipant(host, g.id, a.id, 'soso'));
    expect((await stat(a.id)).temperature).toBeCloseTo(36.5, 5);
    must(await svc.reviewParticipant(host, g.id, a.id, 'noshow'));
    expect((await stat(a.id)).temperature).toBeCloseTo(36.5, 5);
    must(await svc.reviewParticipant(host, g.id, a.id, 'good'));
    expect((await stat(a.id)).temperature).toBeCloseTo(36.9, 5);
  });

  it('서로 다른 두 사람이 좋았어요를 주면 +0.8', async () => {
    const host = await makeUser();
    const a = await makeUser();
    const b = await makeUser();
    const g = await seedPast(host.id, [a.id, b.id]);

    must(await svc.reviewParticipant(host, g.id, a.id, 'good'));
    must(await svc.reviewParticipant(b, g.id, a.id, 'good'));
    must(await svc.reviewParticipant(b, g.id, a.id, 'good'));

    expect((await stat(a.id)).temperature).toBeCloseTo(37.3, 5);
  });

  it('같은 평가 요청이 동시에 여러 번 와도 한 번만 반영된다', async () => {
    const host = await makeUser();
    const a = await makeUser();
    const g = await seedPast(host.id, [a.id]);

    const results = await Promise.all(Array.from({ length: 6 }, () => svc.reviewParticipant(host, g.id, a.id, 'good')));

    expect(results.every((r) => r.ok)).toBe(true);
    expect((await stat(a.id)).temperature).toBeCloseTo(36.9, 5);
  });

  it('노쇼는 나머지 전원이 눌러야 확정되고, 경고는 한 번만 쌓인다', async () => {
    const host = await makeUser();
    const a = await makeUser();
    const b = await makeUser();
    const g = await seedPast(host.id, [a.id, b.id]);

    must(await svc.reviewParticipant(host, g.id, a.id, 'noshow'));
    expect(await stat(a.id)).toMatchObject({ warnings: 0, banned: false }); // 한 명만 눌렀다

    must(await svc.reviewParticipant(b, g.id, a.id, 'noshow'));
    let s = await stat(a.id);
    expect(s.warnings).toBe(1);
    expect(s.temperature).toBeCloseTo(31.5, 5);
    expect(s.banned).toBe(false);

    // 다시 눌러도, 동시에 눌러도 경고는 늘지 않는다
    must(await svc.reviewParticipant(b, g.id, a.id, 'noshow'));
    await Promise.all([
      svc.reviewParticipant(host, g.id, a.id, 'noshow'),
      svc.reviewParticipant(host, g.id, a.id, 'noshow'),
      svc.reviewParticipant(b, g.id, a.id, 'noshow'),
    ]);
    s = await stat(a.id);
    expect(s.warnings).toBe(1);
    expect(s.temperature).toBeCloseTo(31.5, 5);
  });

  it('확정이 풀렸다 다시 확정돼도 같은 모임에서는 벌점을 또 주지 않는다', async () => {
    const host = await makeUser();
    const a = await makeUser();
    const b = await makeUser();
    const g = await seedPast(host.id, [a.id, b.id]); // 셋 — 나머지 둘(host, b)이 모두 눌러야 확정

    must(await svc.reviewParticipant(host, g.id, a.id, 'noshow'));
    must(await svc.reviewParticipant(b, g.id, a.id, 'noshow'));
    expect((await stat(a.id)).warnings).toBe(1);
    must(await svc.reviewParticipant(b, g.id, a.id, 'good')); // 풀림
    must(await svc.reviewParticipant(b, g.id, a.id, 'noshow')); // 다시 확정
    expect((await stat(a.id)).warnings).toBe(1);
  });

  it('좋았어요를 줬던 사람이 노쇼로 바꿔 확정시키면 −0.4 와 −5 가 한 번에 반영된다', async () => {
    const host = await makeUser();
    const [a, b] = await Promise.all([makeUser(), makeUser()]);
    const g = await seedPast(host.id, [a.id, b.id]);

    must(await svc.reviewParticipant(b, g.id, a.id, 'good'));
    expect((await stat(a.id)).temperature).toBeCloseTo(36.9, 5);
    must(await svc.reviewParticipant(host, g.id, a.id, 'noshow')); // 아직 b 가 좋았어요라 확정 아님
    expect(await stat(a.id)).toMatchObject({ warnings: 0, banned: false });
    must(await svc.reviewParticipant(b, g.id, a.id, 'noshow')); // good → noshow(−0.4) + 확정(−5)
    const s = await stat(a.id);
    expect(s.temperature).toBeCloseTo(31.5, 5);
    expect(s.warnings).toBe(1);
  });

  it('온도는 0 아래로 내려가지 않고, 정지 기준에 닿으면 같은 문장에서 정지된다 (users.ts 의 confirmNoshowDb 와 같은 결과)', async () => {
    const host = await makeUser();
    const b = await makeUser();
    // 같은 출발 상태의 두 사람: 한 명은 평가 경로(문서와 한 문장)로, 한 명은 confirmNoshowDb 로 확정시킨다.
    for (const start of [{ temperature: 40.2, warnings: 1 }, { temperature: 3, warnings: 0 }, { temperature: 3, warnings: 1 }]) {
      const viaReview = await makeUser(start);
      const direct = await makeUser(start);
      const g = await seedPast(host.id, [viaReview.id, b.id]);
      must(await svc.reviewParticipant(host, g.id, viaReview.id, 'noshow'));
      must(await svc.reviewParticipant(b, g.id, viaReview.id, 'noshow'));
      await confirmNoshowDb(direct.id);

      const left = await stat(viaReview.id);
      const right = await stat(direct.id);
      expect(left.warnings).toBe(start.warnings + 1);
      expect(left).toEqual(right);
      expect(left.banned).toBe(start.warnings + 1 >= 2);
      expect(left.temperature).toBeGreaterThanOrEqual(0);
    }
  });

  // 회귀(원자성): 예전에는 문서 저장(벌점을 줬다고 표시)과 users 갱신이 서로 다른 문장이라, 둘 사이에서 실패하면
  // 표시만 남고 벌점은 영영 들어가지 않았다. 이제 한 문장이라 users 갱신이 실패하면 문서 저장도 함께 취소된다.
  it('평판 갱신이 실패하면 평가 저장도 함께 취소되고, 다시 누르면 벌점이 정확히 한 번 들어간다', async () => {
    const host = await makeUser();
    const [a, b] = await Promise.all([makeUser(), makeUser()]);
    const g = await seedPast(host.id, [a.id, b.id]);
    must(await svc.reviewParticipant(host, g.id, a.id, 'noshow'));
    const before = (await findGathering(g.id))!;

    // a 의 users 행을 바꾸는 순간 오류를 내는 트리거 (이 사용자에게만 걸리고, 끝나면 지운다)
    await run(`CREATE OR REPLACE FUNCTION s1_test_fail_update() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'users 갱신 실패 (시험)'; END; $$ LANGUAGE plpgsql`);
    await run(
      `CREATE TRIGGER s1_test_fail_update BEFORE UPDATE ON users FOR EACH ROW WHEN (NEW.id = ${Number(a.id)}) EXECUTE FUNCTION s1_test_fail_update()`,
    );
    try {
      await expect(svc.reviewParticipant(b, g.id, a.id, 'noshow')).rejects.toThrow();
      const after = (await findGathering(g.id))!;
      expect(after).toEqual(before); // b 의 평가도, 벌점 표시도 남지 않았다
      expect((after as unknown as Record<string, unknown>).noshowPenalized).toBeUndefined();
      expect(G.reviewOf(after, b.id, a.id)).toBeUndefined();
      expect(await stat(a.id)).toMatchObject({ warnings: 0, banned: false });
    } finally {
      await run('DROP TRIGGER IF EXISTS s1_test_fail_update ON users');
    }

    must(await svc.reviewParticipant(b, g.id, a.id, 'noshow')); // 다시 누르면 반영된다
    must(await svc.reviewParticipant(b, g.id, a.id, 'noshow'));
    const s = await stat(a.id);
    expect(s.warnings).toBe(1);
    expect(s.temperature).toBeCloseTo(31.5, 5);
  });

  it('경고가 2번 쌓이면 이용이 정지된다', async () => {
    const host = await makeUser();
    const a = await makeUser();
    const b = await makeUser();
    const g1 = await seedPast(host.id, [a.id, b.id]);
    const g2 = await seedPast(host.id, [a.id, b.id]);

    must(await svc.reviewParticipant(host, g1.id, a.id, 'noshow'));
    must(await svc.reviewParticipant(b, g1.id, a.id, 'noshow'));
    expect(await stat(a.id)).toMatchObject({ warnings: 1, banned: false });
    must(await svc.reviewParticipant(host, g2.id, a.id, 'noshow'));
    must(await svc.reviewParticipant(b, g2.id, a.id, 'noshow'));
    const s = await stat(a.id);
    expect(s.warnings).toBe(2);
    expect(s.banned).toBe(true);
    expect(s.temperature).toBeCloseTo(26.5, 5);

    // 정지된 사람은 모임을 만들 수도, 참여할 수도 없다
    const banned = (await findUser(a.id))!;
    expect(errCode(await svc.createGathering(banned, meetupBody()))).toBe('BANNED');
    const open = await makeMeetup(host);
    expect(errCode(await svc.joinGathering(banned, open.id, 'guest'))).toBe('BANNED');
  });

  // 회귀(보안): 둘뿐인 모임에서 상대 한 명의 noshow 한 번으로 벌점이 확정되던 문제.
  // 악의적인 주최자가 1:1 미팅 2건을 만들고 상대를 노쇼로 찍으면 실제로 나왔어도 상대가 자동 정지(경고 2회)됐다.
  it('둘뿐인 모임(1:1 미팅 · 둘만 앉은 밥약)에서는 상대 한 명이 noshow 를 눌러도 벌점·정지가 없다', async () => {
    const host = await makeUser();
    const victim = await makeUser();
    const meetupPair = await seedPast(host.id, [victim.id]); // 호스트 + 한 명
    const mealPair = await seedPast(host.id, [victim.id], 'meal'); // 정원보다 적게 앉은 밥약도 앉은 사람 수로 센다
    const third = await seedPast(host.id, [victim.id]);

    for (const g of [meetupPair, mealPair, third]) {
      expect(errCode(await svc.reviewParticipant(host, g.id, victim.id, 'noshow'))).toBe('OK'); // 평가는 기록된다
    }
    expect(await stat(victim.id)).toMatchObject({ warnings: 0, banned: false });
    expect((await stat(victim.id)).temperature).toBeCloseTo(36.5, 5);

    // 화면에도 노쇼로 확정되지 않았다고 나온다. 벌점 표시용 내부 표식도 남지 않는다.
    const view = await svc.viewOf(host, (await findGathering(meetupPair.id))!);
    expect(view.noshowIds).toEqual([]);
    expect(view.myReviews).toEqual({ [victim.id]: 'noshow' });
    expect((await findGathering(meetupPair.id)) as unknown as Record<string, unknown>).not.toHaveProperty('noshowPenalized');

    // 반대 방향(피해자가 주최자를 찍는 경우)도 마찬가지
    expect(errCode(await svc.reviewParticipant(victim, meetupPair.id, host.id, 'noshow'))).toBe('OK');
    expect(await stat(host.id)).toMatchObject({ warnings: 0, banned: false });

    // 정지당하지 않았으니 정상적으로 모임을 만들 수 있다
    expect(errCode(await svc.createGathering((await findUser(victim.id))!, meetupBody()))).toBe('OK');
  });

  it('셋이 되면 다시 나머지 둘이 모두 눌러야 확정된다 (둘 중 한 명이 빠지면 안 된다)', async () => {
    const host = await makeUser();
    const a = await makeUser();
    const b = await makeUser();
    const g = await seedPast(host.id, [a.id, b.id]);

    must(await svc.reviewParticipant(host, g.id, a.id, 'noshow'));
    expect((await stat(a.id)).warnings).toBe(0);
    must(await svc.reviewParticipant(b, g.id, a.id, 'noshow'));
    expect(await stat(a.id)).toMatchObject({ warnings: 1, banned: false });
  });

  // 정책 고정: 이용 정지는 모임 만들기·참여·메시지·접속·빠른 매칭을 막는다(계약). 안전 도구(신고·차단)와 이미 다녀온 모임의 평가는 막지 않는다 —
  // 정지된 사람도 괴롭힘을 신고할 수 있어야 하고, 평가를 막으면 정지된 참여자 때문에 다른 사람들의 노쇼 확정(나머지 전원)이 영영 안 된다.
  // 악용 경로는 좁다: 정지 사용자 한 명은 신고자 한 명으로만 세어지고(서로 다른 3명 필요), 노쇼는 이제 평가자 둘 이상이 일치해야 확정된다.
  it('정지된 사용자도 신고·차단·평가는 할 수 있고, 모임 만들기·참여는 막힌다', async () => {
    const host = await makeUser();
    const [a, b] = await Promise.all([makeUser(), makeUser()]);
    const g = await seedPast(host.id, [a.id, b.id]);
    await run('UPDATE users SET banned = TRUE, warnings = 2 WHERE id = ?', [Number(a.id)]);
    const bannedA = (await findUser(a.id))!;

    expect(errCode(await svc.reviewParticipant(bannedA, g.id, b.id, 'good'))).toBe('OK');
    expect(errCode(await reportUser(a.id, { targetId: b.id, context: 'meetup', refId: g.id, reason: '기타', detail: '' }))).toBe('OK');
    expect(errCode(await blockUser(a.id, b.id))).toBe('OK');
    expect(errCode(await svc.createGathering(bannedA, meetupBody()))).toBe('BANNED');
    const open = await makeMeetup(host);
    expect(errCode(await svc.joinGathering(bannedA, open.id, 'guest'))).toBe('BANNED');

    // 정지 사용자 한 명의 신고만으로는 대상이 자동 정지되지 않는다 (서로 다른 3명 필요)
    expect((await stat(b.id)).banned).toBe(false);
  });

  it('모임 시각 전에는 평가할 수 없고, 참여자끼리만 평가한다', async () => {
    const host = await makeUser();
    const a = await makeUser();
    const outsider = await makeUser();
    const future = await makeMeetup(host);
    must(await svc.joinGathering(a, future.id, 'guest'));
    expect(errCode(await svc.reviewParticipant(host, future.id, a.id, 'good'))).toBe('TOO_EARLY');

    const past = await seedPast(host.id, [a.id]);
    expect(errCode(await svc.reviewParticipant(outsider, past.id, a.id, 'good'))).toBe('NOT_JOINED');
    expect(errCode(await svc.reviewParticipant(host, past.id, outsider.id, 'good'))).toBe('NOT_JOINED');
    expect(errCode(await svc.reviewParticipant(host, past.id, host.id, 'good'))).toBe('INVALID');
    expect((await stat(a.id)).temperature).toBeCloseTo(36.5, 5);
  });

  it('취소된 모임에서는 평가도 벌점도 없다', async () => {
    const host = await makeUser();
    const a = await makeUser();
    const past = await seedPast(host.id, [a.id]);
    must(await svc.cancelGathering(host, past.id));

    expect(errCode(await svc.reviewParticipant(host, past.id, a.id, 'noshow'))).toBe('NOT_OPEN');
    expect(await stat(a.id)).toMatchObject({ warnings: 0, banned: false });
    expect((await findGathering(past.id))!.status).toBe('cancelled'); // 되살아나지 않는다
  });

  it('평가 결과가 화면 DTO 에 반영된다 (myReviews · noshowIds · canReview)', async () => {
    const host = await makeUser();
    const a = await makeUser();
    const b = await makeUser();
    const past = await seedPast(host.id, [a.id, b.id]);
    must(await svc.reviewParticipant(b, past.id, a.id, 'noshow'));
    const after = must(await svc.reviewParticipant(host, past.id, a.id, 'noshow'));

    const view = await svc.viewOf(host, after);
    expect(view.myReviews).toEqual({ [a.id]: 'noshow' });
    expect(view.noshowIds).toEqual([a.id]);
    expect(view.viewer.canReview).toBe(true);
    expect(view.roomOpen).toBe(true); // 끝난 모임의 방은 열려 있다
    expect(view.status).toBe('done');
    // 벌점 표시용 내부 필드가 밖으로 새지 않는다
    expect(JSON.stringify(view)).not.toContain('noshowPenalized');
  });
});

// ───────────── 단톡방 ─────────────

describe('단톡방', () => {
  it('정원이 차면 안내가 한 줄만 생기고, 나갔다 다시 앉아도 늘지 않는다', async () => {
    const host = await makeUser();
    const [a, b, c] = await Promise.all([makeUser(), makeUser(), makeUser()]);
    const g = await makeMeetup(host);

    must(await svc.joinGathering(a, g.id, 'guest'));
    must(await svc.joinGathering(b, g.id, 'guest'));
    expect(await messageCount(g.id)).toBe(0); // 아직 자리가 남았다
    must(await svc.joinGathering(c, g.id, 'host'));
    expect(await messageCount(g.id)).toBe(1);

    must(await svc.leaveGathering(c, g.id));
    must(await svc.joinGathering(c, g.id, 'host'));
    expect(await messageCount(g.id)).toBe(1);

    // 방 열기를 직접 여러 번(동시에) 불러도 마찬가지
    await Promise.all(Array.from({ length: 5 }, () => openRoomIfNeeded(g.id)));
    expect(await messageCount(g.id)).toBe(1);
  });

  it('메시지가 이미 있는 방은 열기 안내를 더하지 않는다', async () => {
    const roomId = randomUUID();
    await openRoomIfNeeded(roomId);
    await openRoomIfNeeded(roomId);
    expect(await messageCount(roomId)).toBe(1);
  });

  it('열리지 않은 방 · 참여자가 아닌 사람 · 정지 사용자 · 읽기 전용을 구분한다', async () => {
    const host = await makeUser();
    const [a, b, c, outsider] = await Promise.all([makeUser(), makeUser(), makeUser(), makeUser()]);
    const g = await makeMeetup(host);
    must(await svc.joinGathering(a, g.id, 'guest'));

    // 자리가 남은 모임: 방이 없다
    expect(errCode(await roomView(host, g.id))).toBe('NOT_OPEN');
    expect(errCode(await sendMessage(host, g.id, '안녕'))).toBe('FORBIDDEN');

    must(await svc.joinGathering(b, g.id, 'guest'));
    must(await svc.joinGathering(c, g.id, 'host'));

    expect(errCode(await roomView(outsider, g.id))).toBe('FORBIDDEN');
    expect(errCode(await sendMessage(outsider, g.id, '안녕'))).toBe('FORBIDDEN');
    expect(errCode(await roomView(host, randomUUID()))).toBe('NOT_FOUND');

    // 정지 사용자: 읽을 수는 있어도 보낼 수 없다
    await run('UPDATE users SET banned = TRUE WHERE id = ?', [Number(a.id)]);
    const bannedA = (await findUser(a.id))!;
    expect(errCode(await sendMessage(bannedA, g.id, '안녕'))).toBe('BANNED');
    expect(errCode(await roomView(bannedA, g.id))).toBe('OK');

    // 빈 메시지 · 너무 긴 메시지
    expect(errCode(await sendMessage(host, g.id, '   '))).toBe('INVALID');
    expect(errCode(await sendMessage(host, g.id, 'ㅋ'.repeat(501)))).toBe('INVALID');

    // 취소하면 읽기 전용
    must(await svc.cancelGathering(host, g.id));
    expect(errCode(await sendMessage(host, g.id, '안녕'))).toBe('NOT_OPEN');
    const room = must(await roomView(host, g.id));
    expect(room.readOnly).toBe(true);
  });

  it('보낸 메시지가 보이고, after 로 새 메시지만 받으며, 보낸 사람 표시(mine)가 맞다', async () => {
    const host = await makeUser();
    const [a, b, c] = await Promise.all([makeUser(), makeUser(), makeUser()]);
    const g = await makeMeetup(host);
    for (const [u, slot] of [[a, 'guest'], [b, 'guest'], [c, 'host']] as const) must(await svc.joinGathering(u, g.id, slot));

    must(await sendMessage(host, g.id, '  안녕하세요  '));
    const first = must(await roomView(a, g.id));
    expect(first.messages.map((m) => [m.kind, m.text])).toEqual([
      ['system', SYSTEM_OPEN_MESSAGE],
      ['text', '안녕하세요'],
    ]);
    expect(first.messages[1]).toMatchObject({ nickname: host.nickname, mine: false, userId: host.id });
    expect(must(await roomView(host, g.id)).messages[1].mine).toBe(true);
    expect(first.members.map((m) => m.id).sort()).toEqual([host.id, a.id, b.id, c.id].sort());
    expect(JSON.stringify(first)).not.toContain('실명');

    const lastAt = first.messages[1].at;
    await new Promise((r) => setTimeout(r, 5));
    must(await sendMessage(a, g.id, '반가워요'));
    const polled = must(await roomView(host, g.id, lastAt));
    expect(polled.messages.map((m) => m.text)).toEqual(['반가워요']);
  });

  // 회귀: 탈퇴한 사용자의 글은 user_id 가 NULL 이 되는데(ON DELETE SET NULL), 이름 대체 분기가 user_id 가 있을 때만 타서
  // 'text' 말풍선인데 닉네임이 빈 문자열인 채 내려갔다. (계정 탈퇴 API 는 글을 안내(system)로 바꾸지만, 그 밖의 경로로 지워진 계정이 남긴 글도 같아야 한다)
  it('탈퇴한 사용자가 남긴 말풍선은 (탈퇴한 사용자)로 보이고, 시스템 안내·차단으로 가려진 말풍선은 이름이 없다', async () => {
    const host = await makeUser();
    const [a, b, c] = await Promise.all([makeUser(), makeUser(), makeUser()]);
    const g = await makeMeetup(host);
    for (const [u, slot] of [[a, 'guest'], [b, 'guest'], [c, 'host']] as const) must(await svc.joinGathering(u, g.id, slot));
    must(await sendMessage(a, g.id, 'a 말'));
    must(await sendMessage(b, g.id, 'b 말'));
    await run('DELETE FROM users WHERE id = ?', [Number(a.id)]);

    const room = must(await roomView(host, g.id));
    const ghost = room.messages.find((m) => m.text === 'a 말')!;
    expect(ghost).toMatchObject({ kind: 'text', userId: null, nickname: '(탈퇴한 사용자)', mine: false });
    expect(room.messages.find((m) => m.text === 'b 말')).toMatchObject({ nickname: b.nickname, userId: b.id });
    expect(room.messages.find((m) => m.kind === 'system')).toMatchObject({ nickname: '', userId: null });

    // 차단으로 가려진 말풍선은 여전히 정보가 비어 있다
    must(await blockUser(host.id, b.id));
    const masked = must(await roomView(host, g.id)).messages.find((m) => m.text === '차단한 사용자의 메시지예요.')!;
    expect(masked).toMatchObject({ kind: 'system', userId: null, nickname: '' });
  });

  it('차단한 사람의 메시지는 가려지고 누가 썼는지도 알 수 없다', async () => {
    const host = await makeUser();
    const [a, b, c] = await Promise.all([makeUser(), makeUser(), makeUser()]);
    const g = await makeMeetup(host);
    for (const [u, slot] of [[a, 'guest'], [b, 'guest'], [c, 'host']] as const) must(await svc.joinGathering(u, g.id, slot));
    must(await sendMessage(a, g.id, '비밀 이야기'));
    must(await sendMessage(b, g.id, '안녕'));

    must(await blockUser(host.id, a.id));
    const hostView = must(await roomView(host, g.id));
    const masked = hostView.messages.find((m) => m.text === '차단한 사용자의 메시지예요.')!;
    expect(masked).toMatchObject({ kind: 'system', userId: null, nickname: '', mine: false });
    expect(JSON.stringify(hostView)).not.toContain('비밀 이야기');
    expect(hostView.messages.some((m) => m.text === '안녕')).toBe(true);

    // 차단당한 쪽(a)도 호스트의 메시지가 아니라 서로 가려진다: 호스트가 쓴 글은 a 에게도 가려진다
    must(await sendMessage(host, g.id, '호스트 글'));
    const aView = must(await roomView(a, g.id));
    expect(aView.messages.some((m) => m.text === '호스트 글')).toBe(false);
    // 차단과 무관한 사람(c)은 모두 본다
    const cView = must(await roomView(c, g.id));
    expect(cView.messages.map((m) => m.text)).toEqual(expect.arrayContaining(['비밀 이야기', '안녕', '호스트 글']));
  });
});

// ───────────── 차단 · 신고 ─────────────

describe('차단', () => {
  it('한쪽만 차단해도 양쪽에서 서로의 모임이 목록에서 사라지고 상세는 404, 참여는 FORBIDDEN', async () => {
    const [a, b, c] = await Promise.all([makeUser(), makeUser(), makeUser()]);
    const ga = await makeMeetup(a, { title: 'A의 미팅' });
    const gb = await makeMeetup(b, { title: 'B의 미팅' });

    const ids = async (u: LoungeUser) => (await svc.listGatheringViews(u, 'meetup')).map((v) => v.id);
    expect(await ids(b)).toEqual(expect.arrayContaining([ga.id, gb.id]));

    must(await blockUser(b.id, a.id));

    expect(await ids(b)).not.toContain(ga.id); // 차단한 사람
    expect(await ids(a)).not.toContain(gb.id); // 차단당한 사람 — 서로 사라진다
    expect(await ids(c)).toEqual(expect.arrayContaining([ga.id, gb.id])); // 상관없는 사람은 그대로

    expect(errCode(await svc.getGatheringView(b, ga.id))).toBe('NOT_FOUND');
    expect(errCode(await svc.getGatheringView(a, gb.id))).toBe('NOT_FOUND');
    expect(errCode(await svc.getGatheringView(c, ga.id))).toBe('OK');

    // 내가 차단한 사람의 모임: 내가 한 일이라 사유를 말해 준다.
    const joined = await svc.joinGathering(b, ga.id, 'guest');
    expect(joined.ok).toBe(false);
    if (!joined.ok) expect(joined.error).toMatchObject({ code: 'FORBIDDEN', message: '차단한 사용자가 있는 모임이에요.' });
    // 나를 차단한 사람의 모임: 없는 모임과 똑같이 답한다 — 모임 id 를 아는 사람이 자기가 차단당했는지 알아낼 수 없어야 한다.
    expect(await svc.joinGathering(a, gb.id, 'guest')).toEqual(await svc.joinGathering(a, randomUUID(), 'guest'));
    expect(errCode(await svc.joinGathering(a, gb.id, 'guest'))).toBe('NOT_FOUND');

    // 해제하면 다시 보인다
    must(await unblockUser(b.id, a.id));
    expect(await ids(b)).toContain(ga.id);
    expect(errCode(await svc.joinGathering(b, ga.id, 'guest'))).toBe('OK');
  });

  // 회귀(프라이버시): 나를 차단한 사람이 주최한 밥약에 신청하면 403 '차단한 사용자가 있는 모임이에요.' 가 와서 차단당한 걸 알 수 있었다.
  it('나를 차단한 사람의 밥약에 신청해도 없는 모임과 같은 응답이고, 내가 차단한 사람의 밥약은 사유를 듣는다', async () => {
    const [host, blockedByHost, blocker, bystander] = await Promise.all([makeUser(), makeUser(), makeUser(), makeUser()]);
    const meal = await makeMeal(host, 3);
    must(await blockUser(host.id, blockedByHost.id)); // 주최자가 blockedByHost 를 차단 → blockedByHost 에게는 "나를 차단한 사람의 모임"
    must(await blockUser(blocker.id, host.id)); // blocker 가 주최자를 차단 → blocker 에게는 "내가 차단한 사람의 모임"

    // 나를 차단한 사람의 모임: 없는 모임과 똑같이 답한다 (차단당한 사실이 드러나지 않게)
    const ghost = await svc.applyToGathering(blockedByHost, randomUUID(), 'table', '');
    expect(errCode(ghost)).toBe('NOT_FOUND');
    expect(await svc.applyToGathering(blockedByHost, meal.id, 'table', '')).toEqual(ghost);

    // 내가 차단한 사람이 들어 있는 모임은 사유를 알려 준다 (내가 한 일이라 숨길 게 없다)
    for (const [who, gathering] of [[blocker, meal], [host, await makeMeal(blockedByHost, 3)]] as const) {
      const r = await svc.applyToGathering(who, gathering.id, 'table', '');
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toMatchObject({ code: 'FORBIDDEN', message: '차단한 사용자가 있는 모임이에요.' });
    }

    // 차단과 무관한 사람은 평소처럼 신청한다
    expect(errCode(await svc.applyToGathering(bystander, meal.id, 'table', ''))).toBe('OK');
  });

  it('이미 함께 앉은 모임은 차단해도 내 목록에서 사라지지 않는다 (나갈 방법이 있어야 한다)', async () => {
    const [a, b] = await Promise.all([makeUser(), makeUser()]);
    const g = await makeMeetup(a);
    must(await svc.joinGathering(b, g.id, 'guest'));
    must(await blockUser(b.id, a.id));

    expect((await svc.listGatheringViews(b)).map((v) => v.id)).toContain(g.id);
    expect(errCode(await svc.getGatheringView(b, g.id))).toBe('OK');
    expect(errCode(await svc.leaveGathering(b, g.id))).toBe('OK');
  });

  it('hiddenFor · blockChecker · 차단 목록', async () => {
    const [a, b, c] = await Promise.all([makeUser(), makeUser(), makeUser()]);
    must(await blockUser(a.id, b.id));
    must(await blockUser(a.id, b.id)); // 멱등
    must(await blockUser(c.id, a.id));

    expect([...(await hiddenFor(a.id))].sort()).toEqual([b.id, c.id].sort());
    expect([...(await hiddenFor(b.id))]).toEqual([a.id]); // 차단당한 쪽에도 보이지 않는다
    expect([...(await hiddenFor(c.id))]).toEqual([a.id]);

    const blocked = await blockChecker();
    expect(blocked(a.id, b.id)).toBe(true);
    expect(blocked(b.id, a.id)).toBe(true);
    expect(blocked(b.id, c.id)).toBe(false);

    // 내가 차단한 사람만 목록에 나오고, 공개 정보만 담긴다
    const list = await myBlocks(a.id);
    expect(list.map((u) => u.id)).toEqual([b.id]);
    expect(Object.keys(list[0]).sort()).toEqual(
      ['admissionYear', 'avatar', 'avatarColor', 'college', 'department', 'id', 'nickname', 'temperature'].sort(),
    );
    expect(await myBlocks(b.id)).toEqual([]); // 차단당한 사람의 목록에는 드러나지 않는다

    must(await unblockUser(a.id, b.id));
    must(await unblockUser(a.id, b.id)); // 멱등
    expect(await myBlocks(a.id)).toEqual([]);
  });

  it('자기 자신 · 없는 사용자 · 프로필 없는 계정은 차단할 수 없다', async () => {
    const a = await makeUser();
    const noProfile = await makeUser({ profile: false });
    expect(errCode(await blockUser(a.id, a.id))).toBe('INVALID');
    expect(errCode(await blockUser(a.id, '99999999'))).toBe('NOT_FOUND');
    expect(errCode(await blockUser(a.id, noProfile.id))).toBe('NOT_FOUND');
  });
});

describe('신고', () => {
  const report = (reporter: LoungeUser, target: LoungeUser, over: Partial<Parameters<typeof reportUser>[1]> = {}) =>
    reportUser(reporter.id, {
      targetId: target.id,
      context: 'meetup',
      refId: 'g-1',
      reason: '불쾌한 언행 · 성희롱',
      detail: '',
      ...over,
    });

  it('서로 다른 3명이 신고하면 자동으로 정지된다 (2명까지는 아니다)', async () => {
    const target = await makeUser();
    const [r1, r2, r3] = await Promise.all([makeUser(), makeUser(), makeUser()]);

    must(await report(r1, target));
    must(await report(r2, target));
    expect((await stat(target.id)).banned).toBe(false);
    must(await report(r3, target));
    expect((await stat(target.id)).banned).toBe(true);
  });

  it('같은 사람이 같은 건을 또 신고하면 거절하고, 다른 건은 받지만 한 명으로 센다', async () => {
    const target = await makeUser();
    const [r1, r2] = await Promise.all([makeUser(), makeUser()]);

    must(await report(r1, target));
    const dup = await report(r1, target);
    expect(dup.ok).toBe(false);
    if (!dup.ok) expect(dup.error).toMatchObject({ code: 'INVALID', message: '이미 신고한 건이에요. 관리자가 확인 중입니다.' });
    must(await report(r1, target, { refId: 'g-2' }));
    must(await report(r1, target, { refId: null }));
    must(await report(r2, target));
    expect((await stat(target.id)).banned).toBe(false); // r1 이 세 번 눌러도 1명, r2 와 합쳐 2명

    // 연타(동시에)도 한 건만 저장된다
    const r3 = await makeUser();
    const results = await Promise.all(Array.from({ length: 4 }, () => report(r3, target, { refId: 'burst' })));
    expect(results.filter((r) => r.ok)).toHaveLength(1);
  });

  // 정책: 정지된 사용자도 신고는 할 수 있다(괴롭힘을 알릴 길을 막지 않는다). 신고는 저장되고 관리자에게 보이지만,
  // 관리자가 보기 전에 사람을 자동으로 정지시키는 집계("서로 다른 3명")에는 세지 않는다 — 정지된 계정끼리 짜고 하는 보복을 막는다.
  it('정지된 신고자의 신고는 저장·표시되지만 자동 제한 집계에는 세지 않는다', async () => {
    const target = await makeUser();
    const [r1, r2, r3] = await Promise.all([makeUser(), makeUser(), makeUser()]);
    const bannedReporter = await makeUser({ banned: true, warnings: 2 });

    must(await report(r1, target));
    must(await report(r2, target));
    must(await report(bannedReporter, target)); // 서로 다른 3명이지만 한 명은 정지된 신고자
    expect((await stat(target.id)).banned).toBe(false);

    // 신고는 관리자 화면에 세 건 모두 있다
    const listed = (await listReportsForAdmin()).filter((x) => x.target.id === target.id);
    expect(listed).toHaveLength(3);
    expect(listed.every((x) => x.status === 'open')).toBe(true);

    must(await report(r3, target)); // 정지되지 않은 세 번째 신고자
    expect((await stat(target.id)).banned).toBe(true);
  });

  it('정지된 신고자 셋이 신고해도 자동으로 정지되지 않는다', async () => {
    const target = await makeUser();
    const ring = await Promise.all([1, 2, 3].map(() => makeUser({ banned: true, warnings: 2 })));
    for (const r of ring) must(await report(r, target));
    expect((await stat(target.id)).banned).toBe(false);
    expect((await listReportsForAdmin()).filter((x) => x.target.id === target.id)).toHaveLength(3);
  });

  it('입력 검증: 자기 자신 · 사유 · 길이 · 없는 사용자', async () => {
    const [a, b] = await Promise.all([makeUser(), makeUser()]);
    expect(errCode(await report(a, a))).toBe('INVALID');
    expect(errCode(await report(a, b, { reason: '없는 사유' }))).toBe('INVALID');
    expect(errCode(await report(a, b, { detail: 'ㅋ'.repeat(501) }))).toBe('INVALID');
    expect(errCode(await report(a, b, { detail: 'ㅋ'.repeat(500), refId: 'x1' }))).toBe('OK');
    expect(errCode(await reportUser(a.id, { targetId: '99999999', context: 'chat', refId: null, reason: '기타', detail: '' }))).toBe('NOT_FOUND');
  });
});

describe('관리자 처리', () => {
  async function reportedThrice() {
    const admin = await makeUser();
    const target = await makeUser();
    const reporters = await Promise.all([makeUser(), makeUser(), makeUser()]);
    for (const r of reporters) {
      must(await reportUser(r.id, { targetId: target.id, context: 'chat', refId: 'room', reason: '기타', detail: '증거' }));
    }
    return { admin, target, reporters };
  }

  it('목록: 최신순, 닉네임만 보이고 같은 대상의 열린 신고 수가 붙는다', async () => {
    const { target, reporters } = await reportedThrice();
    const list = (await listReportsForAdmin()).filter((r) => r.target.id === target.id);
    expect(list).toHaveLength(3);
    expect(list[0]).toMatchObject({
      status: 'open',
      handledAt: null,
      openCountForTarget: 3,
      target: { nickname: target.nickname, banned: true },
      reporter: { nickname: reporters[2].nickname },
    });
    expect(JSON.stringify(list)).not.toContain('실명');
    expect(JSON.stringify(list)).not.toContain('@hansung.ac.kr');
  });

  it('resolve · dismiss 는 그 신고만 바꾼다', async () => {
    const { admin, target } = await reportedThrice();
    const [first, second] = (await listReportsForAdmin()).filter((r) => r.target.id === target.id);

    must(await handleReport(admin.id, first.id, 'resolve'));
    must(await handleReport(admin.id, second.id, 'dismiss'));
    const after = (await listReportsForAdmin()).filter((r) => r.target.id === target.id);
    expect(after.find((r) => r.id === first.id)).toMatchObject({ status: 'resolved' });
    expect(after.find((r) => r.id === second.id)).toMatchObject({ status: 'dismissed' });
    expect(after.find((r) => r.id === first.id)!.handledAt).not.toBeNull();
    expect(after.filter((r) => r.status === 'open')).toHaveLength(1);
    expect(after[0].openCountForTarget).toBe(1);

    const handler = await get<{ handled_by: number }>('SELECT handled_by FROM lounge_reports WHERE id = ?', [first.id]);
    expect(String(handler!.handled_by)).toBe(admin.id);
    // 이미 정지된 대상의 정지는 그대로다
    expect((await stat(target.id)).banned).toBe(true);
  });

  it('ban 은 대상을 정지하고 그 신고를 처리 완료로 한다', async () => {
    const admin = await makeUser();
    const [target, reporter] = await Promise.all([makeUser(), makeUser()]);
    must(await reportUser(reporter.id, { targetId: target.id, context: 'profile', refId: null, reason: '기타', detail: '' }));
    const [rep] = (await listReportsForAdmin()).filter((r) => r.target.id === target.id);

    must(await handleReport(admin.id, rep.id, 'ban'));
    expect((await stat(target.id)).banned).toBe(true);
    expect((await listReportsForAdmin()).find((r) => r.id === rep.id)).toMatchObject({ status: 'resolved' });
  });

  it('unban 은 경고 0 · 정지 해제(온도는 그대로) + 그 사람에 대한 열린 신고를 전부 반려해 다시 걸리지 않게 한다', async () => {
    const { admin, target } = await reportedThrice();
    await run('UPDATE users SET warnings = 2, temperature = 21.5 WHERE id = ?', [Number(target.id)]);
    const [rep] = (await listReportsForAdmin()).filter((r) => r.target.id === target.id);

    must(await handleReport(admin.id, rep.id, 'unban'));

    expect(await stat(target.id)).toMatchObject({ banned: false, warnings: 0 });
    expect((await stat(target.id)).temperature).toBeCloseTo(21.5, 5);
    const after = (await listReportsForAdmin()).filter((r) => r.target.id === target.id);
    expect(after.every((r) => r.status === 'dismissed')).toBe(true);
    expect(after.every((r) => r.handledAt !== null)).toBe(true);
    expect(after[0].openCountForTarget).toBe(0);

    // 새 신고 한 건으로 곧바로 다시 정지되지 않는다
    const another = await makeUser();
    must(await reportUser(another.id, { targetId: target.id, context: 'chat', refId: 'x', reason: '기타', detail: '' }));
    expect((await stat(target.id)).banned).toBe(false);
  });

  it('없는 신고는 NOT_FOUND', async () => {
    const admin = await makeUser();
    expect(errCode(await handleReport(admin.id, randomUUID(), 'resolve'))).toBe('NOT_FOUND');
  });
});

describe('관리자 통계', () => {
  it('프로필 만든 수 · 정지 수 · 평균 온도와 모임 종류별 집계, 노쇼율', async () => {
    const before = await adminStats();
    const host = await makeUser();
    const [a, b] = await Promise.all([makeUser(), makeUser()]);
    const g = await seedPast(host.id, [a.id, b.id]); // 끝난 미팅, 참여자 3명
    must(await svc.reviewParticipant(host, g.id, b.id, 'noshow'));
    must(await svc.reviewParticipant(a, g.id, b.id, 'noshow')); // b 노쇼 확정
    const future = await makeMeetup(host); // 열린 미팅
    const cancelled = await makeMeal(host);
    must(await svc.cancelGathering(host, cancelled.id));
    await makeUser({ profile: false });

    const after = await adminStats();
    const meetup = (s: typeof after) => s.gatherings.find((x) => x.kind === 'meetup')!;
    const meal = (s: typeof after) => s.gatherings.find((x) => x.kind === 'meal')!;

    expect(after.users.total - before.users.total).toBe(4); // host, a, b, 프로필 없는 계정
    expect(after.users.profiled - before.users.profiled).toBe(3);
    expect(meetup(after).total - meetup(before).total).toBe(2);
    expect(meetup(after).done - meetup(before).done).toBe(1);
    expect(meetup(after).open - meetup(before).open).toBe(1);
    expect(meetup(after).participants - meetup(before).participants).toBe(3 + 1);
    expect(meal(after).cancelled - meal(before).cancelled).toBe(1);
    expect(after.noshow.confirmed - before.noshow.confirmed).toBe(1);
    expect(after.noshow.participants - before.noshow.participants).toBe(3);
    expect(after.gatherings.map((x) => x.kind)).toEqual(['meetup', 'meal', 'team']);

    // 절대값: 프로필 만든 사용자 기준 평균, 퍼센트 한 자리
    const avg = await get<{ avg: number; banned: number; profiled: number }>(
      `SELECT AVG(temperature) AS avg, COUNT(*) FILTER (WHERE banned)::int AS banned, COUNT(*)::int AS profiled
         FROM users WHERE profile_done`,
    );
    expect(after.users.averageTemperature).toBeCloseTo(Math.round(Number(avg!.avg) * 10) / 10, 5);
    expect(after.users.banned).toBe(Number(avg!.banned));
    expect(after.users.profiled).toBe(Number(avg!.profiled));
    expect(after.noshow.rate).toBeCloseTo(Math.round((after.noshow.confirmed / after.noshow.participants) * 1000) / 10, 5);
    expect(future.id).toBeTruthy();
  });
});

// ───────────── 참여 규칙 ─────────────

describe('참여 자격', () => {
  it('같은 학과 제외 미팅: 주최자나 참여자와 학과가 같으면 막고, 다르면 앉을 수 있다', async () => {
    const host = await makeUser({ department: '컴퓨터공학부' });
    const g = await makeMeetup(host, { meta: { excludeSameDept: true } });
    const sameDept = await makeUser({ department: '컴퓨터공학부' });
    const other = await makeUser({ department: '시각디자인전공' });
    const otherSameAsOther = await makeUser({ department: '시각디자인전공' });

    const blocked = await svc.joinGathering(sameDept, g.id, 'guest');
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.error).toMatchObject({ code: 'FORBIDDEN', message: '같은 학과는 참여할 수 없는 미팅이에요.' });

    must(await svc.joinGathering(other, g.id, 'guest'));
    // 이미 앉은 사람과 같은 학과도 막는다
    expect(errCode(await svc.joinGathering(otherSameAsOther, g.id, 'guest'))).toBe('FORBIDDEN');

    // 화면에서도 미리 알 수 있다 (버튼 옆 사유)
    const view = await svc.viewOf(sameDept, (await findGathering(g.id))!);
    expect(view.viewer.canJoin).toBe(false);
    expect(view.viewer.blockedReason).toBe('같은 학과는 참여할 수 없는 미팅이에요.');
    expect(view.host.department).toBe('컴퓨터공학부'); // 학과는 학교 계정에서 읽은 사실이라 상대에게 보인다
  });

  it('같은 과 제외가 아닌 미팅은 학과가 같아도 앉을 수 있다', async () => {
    const host = await makeUser({ department: '같은과' });
    const g = await makeMeetup(host);
    const same = await makeUser({ department: '같은과' });
    expect(errCode(await svc.joinGathering(same, g.id, 'guest'))).toBe('OK');
  });

  it('선착순 모임에 신청하거나 승인제 모임에 바로 앉을 수 없다', async () => {
    const host = await makeUser();
    const u = await makeUser();
    const meetup = await makeMeetup(host);
    const meal = await makeMeal(host);
    expect(errCode(await svc.applyToGathering(u, meetup.id, 'guest', ''))).toBe('FORBIDDEN');
    expect(errCode(await svc.joinGathering(u, meal.id, MEAL_SLOT))).toBe('FORBIDDEN');
    expect(errCode(await svc.joinGathering(u, randomUUID(), 'guest'))).toBe('NOT_FOUND');
    expect(errCode(await svc.joinGathering(u, meetup.id, 'balcony'))).toBe('SLOT_NOT_FOUND');
  });

  it('밥약: 신청 → 승인 → 앉음, 거절하면 사라진다. 승인 전에는 방이 없다', async () => {
    const host = await makeUser();
    const [a, b] = await Promise.all([makeUser(), makeUser()]);
    const g = await makeMeal(host, 3);

    must(await svc.applyToGathering(a, g.id, MEAL_SLOT, ' 같이 가요 '));
    must(await svc.applyToGathering(b, g.id, MEAL_SLOT, ''));
    expect(errCode(await svc.applyToGathering(a, g.id, MEAL_SLOT, ''))).toBe('ALREADY_JOINED');

    // 주최자에게만 신청자가 보인다
    const hostView = await svc.viewOf(host, (await findGathering(g.id))!);
    expect(hostView.applicants.map((x) => [x.user.id, x.message])).toEqual([[a.id, '같이 가요'], [b.id, '']]);
    const aView = await svc.viewOf(a, (await findGathering(g.id))!);
    expect(aView.applicants).toEqual([]);
    expect(aView.applicantCount).toBe(2);
    expect(aView.viewer).toMatchObject({ isApplicant: true, blockedReason: '승인 대기 중', canApply: false });

    expect(errCode(await svc.approveApplicant(a, g.id, b.id))).toBe('FORBIDDEN'); // 주최자가 아니다
    must(await svc.rejectApplicant(host, g.id, b.id));
    expect(errCode(await svc.approveApplicant(host, g.id, b.id))).toBe('NOT_APPLICANT');
    expect(await messageCount(g.id)).toBe(0);
    must(await svc.approveApplicant(host, g.id, a.id));
    expect(G.memberIds((await findGathering(g.id))!)).toEqual([host.id, a.id]);
    expect(await messageCount(g.id)).toBe(0); // 3명 정원 중 2명 — 아직 열리지 않는다
  });

  it('밥약 승인: 정지된 신청자 · 차단한 신청자 · 탈퇴한 신청자는 승인할 수 없다', async () => {
    const host = await makeUser();
    const [banned, blocked, gone] = await Promise.all([makeUser(), makeUser(), makeUser()]);
    const g = await makeMeal(host, 4);
    for (const u of [banned, blocked, gone]) must(await svc.applyToGathering(u, g.id, MEAL_SLOT, ''));

    await run('UPDATE users SET banned = TRUE WHERE id = ?', [Number(banned.id)]);
    must(await blockUser(host.id, blocked.id));
    await run('DELETE FROM users WHERE id = ?', [Number(gone.id)]);

    expect(errCode(await svc.approveApplicant(host, g.id, banned.id))).toBe('BANNED');
    expect(errCode(await svc.approveApplicant(host, g.id, blocked.id))).toBe('FORBIDDEN');
    expect(errCode(await svc.approveApplicant(host, g.id, gone.id))).toBe('NOT_APPLICANT');
    expect(G.memberIds((await findGathering(g.id))!)).toEqual([host.id]);

    // 차단한 신청자는 주최자의 신청자 목록에서도 보이지 않는다
    const view = await svc.viewOf(host, (await findGathering(g.id))!);
    expect(view.applicants.map((x) => x.user.id).sort()).toEqual([banned.id, gone.id].sort());
    expect(view.applicantCount).toBe(2);
  });

  it('참여 취소: 마감 전에는 되고 주최자는 못 한다. 취소·종료된 모임은 막힌다', async () => {
    const host = await makeUser();
    const a = await makeUser();
    const g = await makeMeetup(host);
    must(await svc.joinGathering(a, g.id, 'guest'));
    expect(errCode(await svc.leaveGathering(host, g.id))).toBe('HOST_CANNOT_LEAVE');
    expect(errCode(await svc.cancelGathering(a, g.id))).toBe('FORBIDDEN');
    must(await svc.leaveGathering(a, g.id));
    expect(errCode(await svc.leaveGathering(a, g.id))).toBe('NOT_JOINED');

    must(await svc.cancelGathering(host, g.id));
    expect(errCode(await svc.cancelGathering(host, g.id))).toBe('NOT_OPEN');
    expect(errCode(await svc.joinGathering(a, g.id, 'guest'))).toBe('NOT_OPEN');
  });
});

// ───────────── 화면 DTO ─────────────

describe('화면 DTO (toView)', () => {
  it('내 상태 · 참여 가능 여부 · 사유가 맞게 채워진다', async () => {
    const host = await makeUser();
    const [a, b] = await Promise.all([makeUser(), makeUser()]);
    const g = await makeMeetup(host);
    must(await svc.joinGathering(a, g.id, 'guest'));
    const stored = (await findGathering(g.id))!;

    const asHost = await svc.viewOf(host, stored);
    expect(asHost.viewer).toMatchObject({ isHost: true, isMember: true, mySlotKey: 'host', canJoin: false, canLeave: false, blockedReason: '이미 참여 중' });

    const asA = await svc.viewOf(a, stored);
    expect(asA.viewer).toMatchObject({ isHost: false, isMember: true, mySlotKey: 'guest', canLeave: true, canReview: false });

    const asB = await svc.viewOf(b, stored);
    expect(asB.viewer).toMatchObject({ isMember: false, mySlotKey: null, canJoin: true, canApply: false, blockedReason: null, timetableConflict: null });
    expect(asB.slots.find((s) => s.key === 'guest')).toMatchObject({ capacity: 2, seatsLeft: 1 });
    expect(asB.host).toMatchObject({ id: host.id, nickname: host.nickname });
    expect(asB.status).toBe('open');
    expect(asB.roomOpen).toBe(false);
  });

  it('정원이 차면 방이 열리고, 마감 전이면 나갈 수 있다 · 정지 사용자에게는 정지 사유가 보인다', async () => {
    const host = await makeUser();
    const [a, b, c] = await Promise.all([makeUser(), makeUser(), makeUser()]);
    const g = await makeMeetup(host);
    for (const [u, slot] of [[a, 'guest'], [b, 'guest'], [c, 'host']] as const) must(await svc.joinGathering(u, g.id, slot));
    const stored = (await findGathering(g.id))!;

    const asA = await svc.viewOf(a, stored);
    expect(asA.status).toBe('full');
    expect(asA.roomOpen).toBe(true);
    expect(asA.viewer.canLeave).toBe(true); // 정원이 차 있어도 마감 전이면 도메인이 허용한다

    const outsider = await makeUser({ banned: true, warnings: 2 });
    const asOutsider = await svc.viewOf((await findUser(outsider.id))!, stored);
    expect(asOutsider.viewer).toMatchObject({ canJoin: false, blockedReason: '마감 (정원 참)' });

    const bannedOnOpen = await svc.viewOf(
      (await findUser(outsider.id))!,
      (await findGathering((await makeMeetup(host)).id))!,
    );
    expect(bannedOnOpen.viewer.blockedReason).toBe('노쇼 경고 2회로 이용이 정지됐어요.');
  });

  it('내 수업과 겹치면 수업 이름이 채워진다 (시간표 연결 — 목록과 상세 모두)', async () => {
    // 사흘 뒤부터 처음 오는 평일 14:00 (KST). KST 벽시계는 UTC+9 이다.
    let meetAt = '';
    let timetableDay = 0;
    for (let ahead = 3; ahead < 12 && !meetAt; ahead++) {
      const kst = new Date(Date.now() + ahead * 24 * 3600_000 + 9 * 3600_000);
      kst.setUTCHours(14, 0, 0, 0);
      const weekday = kst.getUTCDay(); // 0=일
      if (weekday >= 1 && weekday <= 5) {
        meetAt = new Date(kst.getTime() - 9 * 3600_000).toISOString();
        timetableDay = (weekday + 6) % 7; // 0=월
      }
    }
    expect(meetAt).not.toBe('');

    const host = await makeUser();
    const [student, free] = await Promise.all([makeUser(), makeUser()]);
    await run(
      `INSERT INTO timetable_entries (user_id, day, start_min, end_min, title, place, repeat_kind)
       VALUES (?, ?, ?, ?, '자료구조', '', 'weekly')`,
      [Number(student.id), timetableDay, 13 * 60, 15 * 60],
    );
    const g = await makeMeetup(host, {
      meetAt,
      joinDeadline: new Date(Date.parse(meetAt) - 3600_000).toISOString(),
    });

    const conflictOf = async (u: LoungeUser) =>
      (await svc.listGatheringViews(u, 'meetup')).find((v) => v.id === g.id)?.viewer.timetableConflict;
    expect(await conflictOf(student)).toBe('자료구조');
    expect(await conflictOf(free)).toBeNull();
    // 참고용이라 참여를 막지는 않는다
    expect((await svc.getGatheringView(student, g.id)) as unknown).toMatchObject({ ok: true, value: { viewer: { timetableConflict: '자료구조', canJoin: true } } });
    expect(errCode(await svc.joinGathering(student, g.id, 'guest'))).toBe('OK');
  });

  // 시간표 겹침의 길이: 밥약은 60분, 미팅은 120분으로 본다 (계약 §3.4). 길이가 바뀌어도 통과하던 빈틈을 막는다.
  it('수업 직전 밥약은 겹치지 않지만 같은 시각의 미팅은 겹치고, 수업이 시작된 뒤 30분 안의 밥약은 겹친다', async () => {
    // 사흘 뒤부터 처음 오는 평일의 KST 시각 (KST 벽시계는 UTC+9)
    const atKst = (hour: number, minute: number) => {
      for (let ahead = 3; ahead < 12; ahead++) {
        const kst = new Date(Date.now() + ahead * 24 * 3600_000 + 9 * 3600_000);
        kst.setUTCHours(hour, minute, 0, 0);
        const weekday = kst.getUTCDay();
        if (weekday >= 1 && weekday <= 5) {
          return { iso: new Date(kst.getTime() - 9 * 3600_000).toISOString(), day: (weekday + 6) % 7 };
        }
      }
      throw new Error('평일을 찾지 못했습니다.');
    };
    const noon = atKst(12, 0); // 수업은 13:00~15:00
    const halfPast = atKst(12, 30);
    expect(halfPast.day).toBe(noon.day);

    const host = await makeUser();
    const student = await makeUser();
    await run(
      `INSERT INTO timetable_entries (user_id, day, start_min, end_min, title, place, repeat_kind)
       VALUES (?, ?, ?, ?, '운영체제', '', 'weekly')`,
      [Number(student.id), noon.day, 13 * 60, 15 * 60],
    );
    const before = (iso: string) => new Date(Date.parse(iso) - 3600_000).toISOString();
    const mealNoon = must(await svc.createGathering(host, mealBody(2, { meetAt: noon.iso, joinDeadline: before(noon.iso) })));
    const meetupNoon = await makeMeetup(host, { meetAt: noon.iso, joinDeadline: before(noon.iso) });
    const mealHalfPast = must(await svc.createGathering(host, mealBody(2, { meetAt: halfPast.iso, joinDeadline: before(halfPast.iso) })));

    const conflicts = async (kind: 'meal' | 'meetup') => {
      const views = await svc.listGatheringViews(student, kind);
      return new Map(views.map((v) => [v.id, v.viewer.timetableConflict]));
    };
    const meals = await conflicts('meal');
    const meetups = await conflicts('meetup');
    expect(meals.get(mealNoon.id)).toBeNull(); // 12:00~13:00 — 수업이 시작하는 순간 끝난다
    expect(meetups.get(meetupNoon.id)).toBe('운영체제'); // 12:00~14:00
    expect(meals.get(mealHalfPast.id)).toBe('운영체제'); // 12:30~13:30
  });

  it('탈퇴한 사용자 자리는 (탈퇴한 사용자)로 보인다', async () => {
    const host = await makeUser();
    const [a, b] = await Promise.all([makeUser(), makeUser()]);
    const g = await makeMeetup(host);
    must(await svc.joinGathering(a, g.id, 'guest'));
    await run('DELETE FROM users WHERE id = ?', [Number(a.id)]);

    const view = await svc.viewOf(b, (await findGathering(g.id))!);
    const ghost = view.slots.find((s) => s.key === 'guest')!.members[0];
    expect(ghost).toMatchObject({ id: a.id, nickname: '(탈퇴한 사용자)' });
    expect(JSON.stringify(view)).not.toContain('실명');
    expect(JSON.stringify(view)).not.toContain('@hansung.ac.kr');
  });

  it('상태별 사유: 취소 · 끝남 · 마감', async () => {
    const host = await makeUser();
    const u = await makeUser();
    const now = new Date().toISOString();
    const users = new Map([[host.id, host], [u.id, u]]);
    const base = must(
      G.createGathering(
        { id: 'x', kind: 'meetup', hostId: host.id, title: 't', body: '', place: 'p', meetAt: inHours(10), joinDeadline: inHours(5), joinPolicy: 'auto', slots: MEETUP_PRESETS['1:1'].slots },
        now,
      ),
    );
    const reason = (g: Gathering, at = now) => toView(g, { users }, u, at).viewer.blockedReason;
    expect(reason({ ...base, status: 'cancelled' })).toBe('취소된 모임');
    expect(reason({ ...base, status: 'done' })).toBe('끝난 모임');
    expect(reason(base, inHours(6))).toBe('신청 마감');
    expect(reason(base, inHours(11))).toBe('끝난 모임');
    expect(reason(base)).toBeNull();
  });

  it('밥약 피드는 곧 먹을 약속이 위로, 끝난 약속은 아래로', async () => {
    const host = await makeUser();
    const mk = (id: string, meetAt: string, status: Gathering['status']): Gathering => ({
      ...must(G.createGathering({ id, kind: 'meal', hostId: host.id, title: id, body: '', place: 'p', meetAt: inHours(100), joinDeadline: inHours(90), joinPolicy: 'approval', slots: MEAL_PRESET(2).slots }, new Date().toISOString())),
      meetAt,
      status,
    });
    const users = new Map([[host.id, host]]);
    const now = new Date().toISOString();
    const views = [
      mk('later', inHours(20), 'open'),
      mk('ended-old', inHours(-30), 'done'),
      mk('soon', inHours(3), 'open'),
      mk('ended-new', inHours(-2), 'done'),
      mk('cancelled', inHours(1), 'cancelled'),
    ].map((g) => toView(g, { users }, host, now));
    // 끝난 것들은 만나는 시각이 늦은 것부터 (취소된 약속도 아래로 내려간다)
    expect(sortMealFeed(views).map((v) => v.title)).toEqual(['soon', 'later', 'cancelled', 'ended-new', 'ended-old']);
  });
});

// ───────────── 목록 · 내 모임 ─────────────

describe('목록과 내 모임', () => {
  it('GET /gatherings: 종류별 필터, 24시간 전 이후만, 밥약은 가까운 순', async () => {
    const host = await makeUser();
    const viewer = await makeUser();
    const soon = await makeMeal(host);
    const later = must(await svc.createGathering(host, mealBody(2, { meetAt: inHours(60), joinDeadline: inHours(50) })));
    await new Promise((r) => setTimeout(r, 5)); // created_at 이 같은 밀리초가 되지 않게
    const meetup = await makeMeetup(host);
    // 하루 넘게 지난 모임은 목록에서 빠진다
    const oldDoc = await seedPast(host.id, []);
    await run("UPDATE lounge_gatherings SET meet_at = now() - interval '2 days' WHERE id = ?", [oldDoc.id]);

    const meals = await svc.listGatheringViews(viewer, 'meal');
    const ids = meals.map((v) => v.id);
    expect(ids.indexOf(soon.id)).toBeGreaterThanOrEqual(0);
    expect(ids.indexOf(soon.id)).toBeLessThan(ids.indexOf(later.id));
    expect(ids).not.toContain(meetup.id);
    expect(meals.every((v) => v.kind === 'meal')).toBe(true);

    const all = (await svc.listGatheringViews(viewer)).map((v) => v.id);
    expect(all).toEqual(expect.arrayContaining([soon.id, later.id, meetup.id]));
    expect(all).not.toContain(oldDoc.id);
    // 최신 글이 위로
    expect(all.indexOf(meetup.id)).toBeLessThan(all.indexOf(soon.id));
  });

  it('GET /mine: 주최·참여·신청 모두 포함, 취소·오래된 것은 제외, 만나는 시각 오름차순, id 부분 일치에 속지 않는다', async () => {
    // 숫자 id 가 다른 id 의 앞부분인 두 사용자("1" 과 "10" 처럼)를 찾는다
    const pair = (() => {
      for (const x of created) {
        const y = created.find((v) => v.id !== x.id && v.id.startsWith(x.id));
        if (y) return { short: x, long: y };
      }
      return null;
    })();
    expect(pair).not.toBeNull();
    const { short, long } = pair!;

    const other = await makeUser();
    const base = (over: Partial<Gathering>): Gathering => ({
      id: randomUUID(), kind: 'meetup', hostId: other.id, title: 't', body: '', place: 'p',
      meetAt: inHours(10), joinDeadline: inHours(5), joinPolicy: 'auto',
      slots: [
        { key: 'host', label: '우리 쪽', capacity: 2, memberIds: [other.id] },
        { key: 'guest', label: '상대 쪽', capacity: 2, memberIds: [] },
      ],
      applicants: [], status: 'open', reviews: [], meta: {}, createdAt: new Date().toISOString(), ...over,
    });
    const seated = (id: string, meetAt: string, over: Partial<Gathering> = {}) =>
      base({ id: randomUUID(), meetAt, joinDeadline: new Date(Date.parse(meetAt) - 3600_000).toISOString(),
        slots: [{ key: 'host', label: '우리 쪽', capacity: 2, memberIds: [other.id] }, { key: 'guest', label: '상대 쪽', capacity: 2, memberIds: [id] }], ...over });

    const hosted = base({ hostId: short.id, meetAt: inHours(30), joinDeadline: inHours(20),
      slots: [{ key: 'host', label: '우리 쪽', capacity: 2, memberIds: [short.id] }, { key: 'guest', label: '상대 쪽', capacity: 2, memberIds: [] }] });
    const joined = seated(short.id, inHours(5));
    const applied = base({ kind: 'meal', joinPolicy: 'approval', meetAt: inHours(12), joinDeadline: inHours(8),
      slots: [{ key: 'table', label: '같이 먹을 사람', capacity: 2, memberIds: [other.id] }],
      applicants: [{ userId: short.id, slotKey: 'table', message: '', appliedAt: new Date().toISOString() }] });
    const cancelled = seated(short.id, inHours(7), { status: 'cancelled' });
    const stale = seated(short.id, inHours(-24 * 8)); // 8일 전 — 7일 창 밖
    const recent = seated(short.id, inHours(-24 * 3)); // 3일 전 — 창 안
    const othersOnly = seated(long.id, inHours(9)); // short 의 id 를 앞부분으로 가진 다른 사람
    for (const g of [hosted, joined, applied, cancelled, stale, recent, othersOnly]) await insertGathering(g);

    const mine = await listMine(short.id, new Date(Date.now() - 7 * 24 * 3600_000).toISOString(), 50);
    const seeded = new Set([hosted, joined, applied, cancelled, stale, recent, othersOnly].map((g) => g.id));
    // 앞선 테스트에서 이 사용자가 얽힌 모임이 더 있을 수 있어 이번에 심은 것만 비교한다
    const ids = mine.map((g) => g.id).filter((id) => seeded.has(id));
    expect(ids).toEqual([recent.id, joined.id, applied.id, hosted.id]); // meetAt 오름차순
    expect(mine.map((g) => g.meetAt)).toEqual([...mine.map((g) => g.meetAt)].sort());

    const views = await svc.mineViews(short);
    expect(views.map((v) => v.id).filter((id) => seeded.has(id))).toEqual(ids);
    expect(views.find((v) => v.id === applied.id)!.viewer.isApplicant).toBe(true);
    expect(views.find((v) => v.id === hosted.id)!.viewer.isHost).toBe(true);
  });

  it('GET /mine 은 limit 을 지킨다', async () => {
    const host = await makeUser();
    for (let i = 0; i < 3; i++) await makeMeetup(host, { meetAt: inHours(100 + i), joinDeadline: inHours(90) });
    const limited = await listMine(host.id, new Date(Date.now() - 7 * 24 * 3600_000).toISOString(), 2);
    expect(limited).toHaveLength(2);
  });
});

// ───────────── 입력 검증 ─────────────

describe('모임 만들기 검증', () => {
  const rejects = async (host: LoungeUser, over: Partial<CreateGatheringBody>) =>
    errCode(await svc.createGathering(host, meetupBody(over)));

  it('주최자는 만들자마자 자기 자리에 앉고, 프리셋 자리가 만들어진다', async () => {
    const host = await makeUser();
    const g = await makeMeetup(host, { title: '  앞뒤 공백  ' });
    expect(g.title).toBe('앞뒤 공백');
    expect(g.joinPolicy).toBe('auto');
    expect(g.slots.map((s) => [s.key, s.label, s.capacity, s.memberIds])).toEqual([
      ['host', '우리 쪽', 2, [host.id]],
      ['guest', '상대 쪽', 2, []],
    ]);
    expect(await findGathering(g.id)).toEqual(g);

    const meal = await makeMeal(host, 4);
    expect(meal.joinPolicy).toBe('approval');
    expect(meal.slots).toEqual([{ key: 'table', label: '같이 먹을 사람', capacity: 4, memberIds: [host.id] }]);
  });

  it('제목 · 내용 · 장소 길이', async () => {
    const host = await makeUser();
    expect(await rejects(host, { title: '   ' })).toBe('INVALID');
    expect(await rejects(host, { title: '가'.repeat(61) })).toBe('INVALID');
    expect(await rejects(host, { title: '가'.repeat(60) })).toBe('OK');
    expect(await rejects(host, { body: '가'.repeat(301) })).toBe('INVALID');
    expect(await rejects(host, { body: '가'.repeat(300) })).toBe('OK');
    expect(await rejects(host, { place: '' })).toBe('INVALID');
    expect(await rejects(host, { place: '가'.repeat(41) })).toBe('INVALID');
    expect(await rejects(host, { title: '제목\u0000' })).toBe('INVALID'); // DB 가 거절하는 글자
    expect(await rejects(host, { title: '두 줄\n제목' })).toBe('INVALID');
  });

  it('시각: 미래여야 하고, 마감은 만나는 시각 이전이어야 한다', async () => {
    const host = await makeUser();
    expect(await rejects(host, { meetAt: inHours(-1), joinDeadline: inHours(-2) })).toBe('INVALID');
    expect(await rejects(host, { meetAt: inHours(10), joinDeadline: inHours(11) })).toBe('INVALID');
    expect(await rejects(host, { meetAt: inHours(24 * 400), joinDeadline: inHours(24 * 399) })).toBe('INVALID');
    const same = inHours(10);
    expect(await rejects(host, { meetAt: same, joinDeadline: same })).toBe('OK'); // 마감 = 만나는 시각은 허용
    expect(await rejects(host, { meetAt: '내일' })).toBe('INVALID');
  });

  // 회귀: 신청 마감이 이미 지났는데 만나는 시각만 미래이면 201 로 만들어져 처음부터 '신청 마감' 인, 아무도 참여할 수 없는 글이 목록에 올라갔다.
  it('신청 마감 시각이 이미 지났으면 만들 수 없다 (미팅 · 밥약 모두, 같은 순간도 마감이다)', async () => {
    const host = await makeUser();
    expect(await rejects(host, { meetAt: inHours(5), joinDeadline: inHours(-1) })).toBe('INVALID');
    expect(errCode(await svc.createGathering(host, mealBody(2, { meetAt: inHours(5), joinDeadline: inHours(-0.1) })))).toBe('INVALID');
    expect(await rejects(host, { meetAt: inHours(5), joinDeadline: inHours(0.5) })).toBe('OK');

    // 경계: 마감 = 지금 은 이미 마감이고, 1ms 뒤부터 열린다
    const now = '2030-05-01T03:00:00.000Z';
    const ms = (t: string, d: number) => new Date(Date.parse(t) + d).toISOString();
    const body = (deadline: string) => meetupBody({ meetAt: ms(now, 5 * 3600_000), joinDeadline: deadline });
    const atNow = svc.prepareGathering(host, body(now), now);
    expect(errCode(atNow)).toBe('INVALID');
    if (!atNow.ok) expect(atNow.error.message).toBe('신청 마감 시각은 지금 이후로 정해 주세요.');
    expect(errCode(svc.prepareGathering(host, body(ms(now, -1)), now))).toBe('INVALID');
    expect(errCode(svc.prepareGathering(host, body(ms(now, 1)), now))).toBe('OK');
  });

  it('자리 구성은 프리셋과 같을 때만 받고, 팀빌딩은 아직 못 만든다', async () => {
    const host = await makeUser();
    expect(await rejects(host, { slots: [{ key: 'host', label: '우리 쪽', capacity: 1 }, { key: 'guest', label: '상대 쪽', capacity: 9 }] })).toBe('INVALID');
    expect(await rejects(host, { slots: [{ key: 'host', label: '우리 쪽', capacity: 5 }, { key: 'guest', label: '상대 쪽', capacity: 5 }] })).toBe('INVALID');
    expect(await rejects(host, { slots: MEETUP_PRESETS['3:3'].slots })).toBe('OK');
    expect(await rejects(host, { joinPolicy: 'approval' })).toBe('INVALID');
    expect(await rejects(host, { hostSlotKey: 'nowhere' })).toBe('SLOT_NOT_FOUND');
    expect(await rejects(host, { hostSlotKey: 'guest' })).toBe('OK');
    expect(errCode(await svc.createGathering(host, mealBody(5)))).toBe('INVALID');
    expect(errCode(await svc.createGathering(host, mealBody(1)))).toBe('INVALID');
    expect(errCode(await svc.createGathering(host, mealBody(3, { joinPolicy: 'auto' })))).toBe('INVALID');
    expect(errCode(await svc.createGathering(host, { ...meetupBody(), kind: 'team' }))).toBe('INVALID');
    // 클라이언트가 라벨을 속여도 서버가 프리셋 라벨로 다시 만든다
    const sneaky = must(
      await svc.createGathering(host, meetupBody({ slots: [{ key: 'host', label: '<b>가짜</b>', capacity: 2 }, { key: 'guest', label: '아무거나', capacity: 2 }] })),
    );
    expect(sneaky.slots.map((s) => s.label)).toEqual(['우리 쪽', '상대 쪽']);
  });

  it('meta: 태그 개수·길이, 장소 종류, 메뉴, 같은 과 제외는 미팅에서만', async () => {
    const host = await makeUser();
    expect(await rejects(host, { meta: { tags: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] } })).toBe('INVALID');
    expect(await rejects(host, { meta: { tags: ['a', 'b', 'c', 'd', 'e', 'f'] } })).toBe('OK');
    expect(await rejects(host, { meta: { tags: ['가'.repeat(21)] } })).toBe('INVALID');
    expect(await rejects(host, { meta: { tags: ['  '] } })).toBe('INVALID');
    expect(await rejects(host, { meta: { placeType: '우주' } })).toBe('INVALID');
    expect(await rejects(host, { meta: { menu: '외계 음식' } })).toBe('INVALID');
    expect(await rejects(host, { meta: { placeType: '학식', menu: '한식', tags: ['조용히 먹기'] } })).toBe('OK');
    expect(errCode(await svc.createGathering(host, mealBody(2, { meta: { excludeSameDept: true } })))).toBe('INVALID');
    const kept = must(await svc.createGathering(host, meetupBody({ meta: { excludeSameDept: true, tags: ['  같은 태그 ', '같은 태그'] } })));
    expect(kept.meta).toEqual({ tags: ['같은 태그'], excludeSameDept: true });
  });

  it('정지된 계정은 만들 수 없다', async () => {
    const banned = await makeUser({ banned: true });
    expect(errCode(await svc.createGathering(banned, meetupBody()))).toBe('BANNED');
  });
});

describe('요청 본문 모양 확인 (라우트)', () => {
  const valid = () => ({ ...meetupBody(), hostSlotKey: undefined, unknownField: 'x' });

  it('올바른 본문은 정규화된 서비스 입력이 된다 (모르는 필드는 버린다)', () => {
    const r = parseCreateBody({ ...valid(), meetAt: '2030-01-02T03:04:05+09:00', joinDeadline: '2030-01-01T00:00:00Z' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.meetAt).toBe('2030-01-01T18:04:05.000Z'); // 같은 형식(Z · 밀리초)으로 맞춘다 — 도메인이 문자열로 비교한다
      expect(r.value.joinDeadline).toBe('2030-01-01T00:00:00.000Z');
      expect(r.value).not.toHaveProperty('unknownField');
    }
  });

  it('타입이 틀리면 INVALID', () => {
    for (const bad of [
      null, 'x', [], {},
      { ...valid(), kind: 'party' },
      { ...valid(), title: 5 },
      { ...valid(), body: 5 },
      { ...valid(), place: null },
      { ...valid(), meetAt: 'soon' },
      { ...valid(), joinDeadline: 12 },
      { ...valid(), joinPolicy: 'whatever' },
      { ...valid(), slots: 'abc' },
      { ...valid(), slots: [] },
      { ...valid(), slots: [{ key: 'a', label: 'b', capacity: '2' }] },
      { ...valid(), slots: [{ key: 'a', label: 'b', capacity: 1.5 }] },
      { ...valid(), hostSlotKey: 3 },
      { ...valid(), meta: 'x' },
      { ...valid(), meta: { tags: 'x' } },
      { ...valid(), meta: { tags: [1] } },
      { ...valid(), meta: { excludeSameDept: 'yes' } },
    ]) {
      expect(errCode(parseCreateBody(bad))).toBe('INVALID');
    }
  });

  it('동작별 본문: 자리 · 사람 · 평가', () => {
    expect(errCode(parseActionBody('join', {}))).toBe('INVALID');
    expect(parseActionBody('join', { slotKey: 'guest' })).toEqual(ok({ slotKey: 'guest' }));
    expect(parseActionBody('apply', { slotKey: 'table', message: '  안녕  ' })).toEqual(ok({ slotKey: 'table', message: '안녕' }));
    expect(parseActionBody('apply', { slotKey: 'table' })).toEqual(ok({ slotKey: 'table', message: '' }));
    expect(errCode(parseActionBody('apply', { slotKey: 'table', message: 'ㅋ'.repeat(201) }))).toBe('INVALID');
    expect(errCode(parseActionBody('apply', { slotKey: 'table', message: 5 }))).toBe('INVALID');
    expect(parseActionBody('approve', { userId: '007' })).toEqual(ok({ userId: '7' }));
    expect(errCode(parseActionBody('approve', { userId: 'abc' }))).toBe('INVALID');
    expect(errCode(parseActionBody('reject', {}))).toBe('INVALID');
    expect(parseActionBody('review', { userId: 3, mark: 'good' })).toEqual(ok({ userId: '3', mark: 'good' }));
    expect(errCode(parseActionBody('review', { userId: '3', mark: 'great' }))).toBe('INVALID');
    expect(errCode(parseActionBody('review', { mark: 'good' }))).toBe('INVALID');
    expect(parseActionBody('leave', undefined)).toEqual(ok({}));
    expect(parseActionBody('cancel', 'garbage')).toEqual(ok({}));
  });

  it('사용자 id 는 숫자 문자열만', () => {
    expect(parseUserId('12')).toBe('12');
    expect(parseUserId(12)).toBe('12');
    for (const bad of ['', '1 or 1=1', '-1', '1.5', 1.5, 0, null, undefined, {}, '123456789012']) {
      expect(parseUserId(bad)).toBeNull();
    }
  });
});

// ───────────── 실제 HTTP (진짜 앱 · 로그인 쿠키 · 라우터 체인 전체) ─────────────
// 서비스 함수만 부르는 위의 테스트가 놓치는 것: 입구(라우트)의 모양 검사, 권한 미들웨어, 오류 → 상태 코드 변환.
// 특히 보안 회귀(NUL 이 SQL 에 닿아 500 이 되던 것, 2인 모임 노쇼로 정지시키던 것, 차단 사실이 응답으로 새던 것)를 같은 경로로 고정한다.

describe('HTTP — 실제 라우터 체인', () => {
  const SECRET = 'test-secret-for-s1-http';
  let server: http.Server;
  let base = '';

  beforeAll(async () => {
    process.env.JWT_SECRET = SECRET; // auth.ts 가 첫 요청에서 읽는다
    const { createApp } = await import('../../app.js');
    server = createApp().listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => server.once('listening', () => resolve()));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/lounge`;
  }, 60_000);

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  type Reply = { status: number; json: { error?: string; code?: string; [k: string]: unknown } | null };
  async function call(u: LoungeUser, method: string, path: string, body?: unknown): Promise<Reply> {
    const token = jwt.sign({ uid: Number(u.id) }, SECRET, { expiresIn: '1h' });
    const res = await fetch(`${base}${path}`, {
      method,
      headers: { cookie: `token=${token}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let json: Reply['json'] = null;
    try {
      json = JSON.parse(text) as Reply['json'];
    } catch {
      /* JSON 이 아닌 응답 */
    }
    return { status: res.status, json };
  }

  const BAD_IDS: [string, string][] = [
    ['NUL', 'a\u0000b'],
    ['짝 없는 서로게이트', 'x\ud800y'],
    ['81자', 'a'.repeat(81)],
    ['공백', 'a b'],
    ['줄바꿈', 'a\nb'],
    ['따옴표', "a'b"],
  ];

  it('신고 refId · 관리자 reportId 의 모양이 틀리면 500 이 아니라 400 INVALID', async () => {
    const [reporter, target] = await Promise.all([makeUser(), makeUser()]);
    const admin = await makeUser();
    await run('UPDATE users SET is_admin = TRUE WHERE id = ?', [Number(admin.id)]);

    for (const [name, refId] of BAD_IDS) {
      const r = await call(reporter, 'POST', '/reports', { userId: target.id, context: 'etc', refId, reason: '기타', detail: '' });
      expect([name, r.status, r.json?.code]).toEqual([name, 400, 'INVALID']);
    }
    for (const [name, reportId] of BAD_IDS) {
      const r = await call(admin, 'POST', '/admin/reports', { reportId, action: 'dismiss' });
      expect([name, r.status, r.json?.code]).toEqual([name, 400, 'INVALID']);
    }

    // 정상 모양은 그대로 받는다: 모임 id 모양 · refId 없음 · 모양은 맞지만 없는 신고(404)
    expect((await call(reporter, 'POST', '/reports', { userId: target.id, context: 'meetup', refId: 'demo-meetup-open-b', reason: '기타', detail: '' })).status).toBe(200);
    expect((await call(reporter, 'POST', '/reports', { userId: target.id, context: 'profile', reason: '기타', detail: '' })).status).toBe(200);
    const missing = await call(admin, 'POST', '/admin/reports', { reportId: randomUUID(), action: 'dismiss' });
    expect([missing.status, missing.json?.code]).toEqual([404, 'NOT_FOUND']);
    // 관리자가 아니면 모양 검사 이전에 막힌다
    expect((await call(reporter, 'POST', '/admin/reports', { reportId: randomUUID(), action: 'dismiss' })).status).toBe(403);
  });

  it('모임 id 자리에 이상한 글자가 와도 500 이 아니라 404', async () => {
    const u = await makeUser();
    for (const path of ['/gatherings/a%00b', '/gatherings/a%00b/join', '/gatherings/a%00b/messages', `/gatherings/${'a'.repeat(100)}`]) {
      const r = await call(u, path.endsWith('/join') ? 'POST' : 'GET', path, path.endsWith('/join') ? { slotKey: 'guest' } : undefined);
      expect([path, r.status]).toEqual([path, 404]);
    }
  });

  it('노쇼(안 왔어요) 평가는 라우터에서 거절한다 — 약속을 어긴 사람은 신고로 알린다', async () => {
    const attacker = await makeUser();
    const victim = await makeUser();
    const g = await seedPast(attacker.id, [victim.id]);
    const r = await call(attacker, 'POST', `/gatherings/${g.id}/review`, { userId: victim.id, mark: 'noshow' });
    expect(r.status).toBe(400);
    const me = await call(victim, 'GET', '/me');
    expect((me.json as unknown as { profile: { warnings: number; temperature: number } }).profile).toMatchObject({ warnings: 0, temperature: 36.5 });
  });

  it('나를 차단한 사람의 모임은 없는 모임과 똑같이 404 이고, 내가 차단한 사람의 모임은 403 으로 사유를 듣는다', async () => {
    const [host, blockedByHost, blocker] = await Promise.all([makeUser(), makeUser(), makeUser()]);
    const meal = must(await svc.createGathering(host, mealBody(3)));
    const meetup = await makeMeetup(host);
    must(await blockUser(host.id, blockedByHost.id)); // 주최자가 blockedByHost 를 차단
    must(await blockUser(blocker.id, host.id)); // blocker 가 주최자를 차단

    // 나를 차단한 사람의 모임 (blockedByHost 입장): 없는 모임과 같은 404
    const ghost = await call(blockedByHost, 'POST', `/gatherings/${randomUUID()}/apply`, { slotKey: 'table' });
    expect([ghost.status, ghost.json?.code]).toEqual([404, 'NOT_FOUND']);
    expect(await call(blockedByHost, 'POST', `/gatherings/${meal.id}/apply`, { slotKey: 'table' })).toEqual(ghost);
    expect(await call(blockedByHost, 'POST', `/gatherings/${meetup.id}/join`, { slotKey: 'guest' })).toEqual(ghost);
    expect((await call(blockedByHost, 'GET', `/gatherings/${meal.id}`)).status).toBe(404);

    // 내가 차단한 사람의 모임 (blocker, host 입장): 사유를 듣는다
    const other = must(await svc.createGathering(blockedByHost, mealBody(3)));
    for (const [who, id] of [[blocker, meal.id], [host, other.id]] as const) {
      const r = await call(who, 'POST', `/gatherings/${id}/apply`, { slotKey: 'table' });
      expect([r.status, r.json?.code, r.json?.error]).toEqual([403, 'FORBIDDEN', '차단한 사용자가 있는 모임이에요.']);
    }
    // 목록·상세에서는 둘 다 서로의 모임이 사라진다
    expect((await call(blocker, 'GET', `/gatherings/${meal.id}`)).status).toBe(404);
  });

  it('신청 마감 시각이 이미 지난 모임은 400 INVALID, 아직 남았거나 만나는 시각과 같으면 201', async () => {
    const host = await makeUser();
    const past = await call(host, 'POST', '/gatherings', meetupBody({ meetAt: inHours(5), joinDeadline: inHours(-1) }));
    expect([past.status, past.json?.code, past.json?.error]).toEqual([400, 'INVALID', '신청 마감 시각은 지금 이후로 정해 주세요.']);
    const pastMeal = await call(host, 'POST', '/gatherings', mealBody(2, { meetAt: inHours(0.4), joinDeadline: inHours(-0.1) }));
    expect(pastMeal.status).toBe(400);
    expect((await call(host, 'POST', '/gatherings', meetupBody({ meetAt: inHours(5), joinDeadline: inHours(0.5) }))).status).toBe(201);
    const same = inHours(5);
    expect((await call(host, 'POST', '/gatherings', meetupBody({ meetAt: same, joinDeadline: same }))).status).toBe(201);
  });
});
