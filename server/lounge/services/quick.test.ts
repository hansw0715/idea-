/**
 * 빠른 매칭 서비스 — 경쟁 상황 테스트 (PGlite 임시 DB).
 *
 * 개발 서버의 DB 를 절대 건드리지 않는다: 임시 폴더를 DATA_DIR 로 잡고 DATABASE_URL 을 지운 뒤에야 db 를 불러온다
 * (그래서 서비스·db 모듈은 정적 import 가 아니라 beforeAll 안에서 동적으로 가져온다).
 * 날짜는 항상 "내일 이후"로 잡아 시간대가 지나가 버리는 일이 없게 하고, 시간이 중요한 테스트만 `now` 를 직접 넣는다.
 */
import fs from 'node:fs';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Result } from '../../../shared/lounge/types.js';
import type { Gathering } from '../../../shared/lounge/gathering.js';
import type { QuickState } from '../../../shared/lounge/view.js';
import { kstDate, meetAtOf } from '../domain/quickMatch.js';
import type { LoungeUser } from '../users.js';

vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

type Db = typeof import('../../db.js');
type Quick = typeof import('./quick.js');
type Users = typeof import('../users.js');

let tmpDir = '';
let db: Db;
let quick: Quick;
let users: Users;
let routes: typeof import('../routes/quick.js');

/** 실제 quickRouter 를 올린 작은 서버. 로그인·프로필 미들웨어 자리에는 `x-test-user` 헤더로 사용자를 꽂는다. */
let httpServer: Server | null = null;
let baseUrl = '';

beforeAll(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sangsang-quick-'));
  process.env.DATA_DIR = tmpDir;
  delete process.env.DATABASE_URL; // 실수로 원격 DB 를 건드리지 않게
  db = await import('../../db.js');
  if (db.isServerless) throw new Error('서버리스 환경 변수가 켜져 있어 테스트를 중단합니다.');
  expect(db.resolveDataDir()).toBe(tmpDir);
  await db.ready();
  users = await import('../users.js');
  quick = await import('./quick.js');
  routes = await import('../routes/quick.js');

  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    users
      .findUser(String(req.header('x-test-user')))
      .then((u) => {
        if (!u) {
          res.status(401).json({ error: '테스트 사용자가 없습니다.' });
          return;
        }
        res.locals.loungeUser = u;
        next();
      })
      .catch(next);
  });
  app.use(routes.quickRouter);
  // 운영의 전역 오류 처리기와 같은 모양: 처리 중 예외는 500 이다 (이 테스트들은 500 이 나오면 안 된다는 것을 확인한다)
  app.use((_err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  });
  await new Promise<void>((resolve) => {
    httpServer = app.listen(0, '127.0.0.1', () => resolve());
  });
  baseUrl = `http://127.0.0.1:${(httpServer!.address() as AddressInfo).port}`;
});

afterAll(async () => {
  const server = httpServer;
  if (server) {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections(); // fetch 의 keep-alive 연결이 남아 close 가 끝나지 않는 일을 막는다
    });
  }
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // Windows 에서 PGlite 파일이 아직 잡혀 있으면 지우지 못한다 — 임시 폴더라 남아도 상관없다.
  }
});

beforeEach(async () => {
  for (const t of ['lounge_messages', 'lounge_gatherings', 'lounge_quick_requests', 'lounge_quick_rooms', 'lounge_blocks']) {
    await db.run(`DELETE FROM ${t}`);
  }
});

// ───────────── 도우미 ─────────────

const DAY = 86_400_000;
/** 오늘(KST)로부터 `days`일 뒤의 날짜. 1 이상이면 모든 시간대가 아직 시작 전이다. */
const dateAfter = (days: number) => kstDate(new Date(Date.now() + days * DAY).toISOString());
const at = (date: string, band: string, minutes = 0) => new Date(Date.parse(meetAtOf(date, band)) + minutes * 60_000).toISOString();

const input = (date: string, over: Record<string, unknown> = {}) => ({
  date,
  placeType: '학식',
  size: 2,
  bands: ['b12', 'b13'],
  tags: [] as string[],
  ...over,
});

function must<T>(r: Result<T>): T {
  if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
  return r.value;
}
const codeOf = <T>(r: Result<T>) => (r.ok ? 'OK' : r.error.code);

let seq = 0;
async function makeUser(over: { department?: string; banned?: boolean } = {}): Promise<LoungeUser> {
  seq += 1;
  const id = await db.insert(
    `INSERT INTO users (email, name, password_hash, nickname, college, department, admission_year, avatar, avatar_color, profile_done, banned)
     VALUES (?, ?, 'x', ?, 'IT공과대학', ?, 2022, 'bear', 'm1', TRUE, ?) RETURNING id`,
    [`quick${seq}-${Date.now()}@hansung.ac.kr`, `실명${seq}`, `닉${seq}`, over.department ?? '컴퓨터공학부', over.banned ?? false],
  );
  const u = await users.findUser(id);
  if (!u) throw new Error('테스트 사용자를 만들지 못했습니다.');
  return u;
}
const makeUsers = async (n: number, over: { department?: string } = {}) =>
  Promise.all(Array.from({ length: n }, () => makeUser(over)));

const fresh = (id: string) => users.findUser(id) as Promise<LoungeUser>;

const q = <T>(sql: string, params: unknown[] = []) => db.all<T>(sql, params);
const tickets = (date: string) =>
  q<{ user_id: number; status: string; room_id: string | null }>(
    `SELECT user_id, status, room_id FROM lounge_quick_requests WHERE data->>'date' = ? ORDER BY user_id`,
    [date],
  );
const roomRows = (date: string) =>
  q<{ id: string; status: string }>(`SELECT id, status FROM lounge_quick_rooms WHERE data->>'date' = ?`, [date]);
const allGatherings = async () =>
  (await q<{ id: string; kind: string; data: Gathering }>('SELECT id, kind, data FROM lounge_gatherings')).map((r) => ({
    ...r,
    data: (typeof r.data === 'string' ? JSON.parse(r.data) : r.data) as Gathering,
  }));
const messages = (roomId: string) =>
  q<{ kind: string; text: string }>('SELECT kind, text FROM lounge_messages WHERE room_id = ?', [roomId]);
const block = (blocker: string, blocked: string) =>
  db.run('INSERT INTO lounge_blocks (blocker_id, blocked_id) VALUES (?, ?)', [Number(blocker), Number(blocked)]);
const stateOf = async (u: LoungeUser) => quick.quickState(u.id);
const roomIdOf = (s: QuickState) => {
  if (!s.room) throw new Error('후보 방이 없습니다.');
  return s.room.id;
};

/** 같은 조건으로 두 명이 신청해 방을 만든다 */
async function pairUp(date: string, over: Record<string, unknown> = {}) {
  const size = (over.size as number | undefined) ?? 2;
  const people = await makeUsers(size);
  let last: QuickState | null = null;
  for (const p of people) last = must(await quick.requestQuickMatch(p, input(date, over)));
  return { people, state: last as QuickState, roomId: roomIdOf(last as QuickState) };
}

// ───────────── 조건 일치 ─────────────

describe('조건 일치', () => {
  it('같은 조건 두 명이면 후보 방이 생기고, 먼저 기다린 사람에게도 보인다', async () => {
    const [a, b] = await makeUsers(2);
    const date = dateAfter(1);

    const first = must(await quick.requestQuickMatch(a, input(date)));
    expect(first.room).toBeNull();
    expect(first.request?.status).toBe('waiting');
    expect(first.waitingCount).toBe(1);
    expect(first.meId).toBe(a.id);

    const second = must(await quick.requestQuickMatch(b, input(date)));
    expect(second.request?.status).toBe('matched');
    expect(second.room?.status).toBe('pending');
    expect([...(second.room?.memberIds ?? [])].sort()).toEqual([a.id, b.id].sort());
    expect(second.room?.bands).toEqual(['b12', 'b13']);
    expect(Date.parse(second.room!.expiresAt) - Date.parse(second.room!.createdAt)).toBe(30 * 60_000);
    expect(second.members.map((m) => m.id).sort()).toEqual([a.id, b.id].sort());
    expect(second.waitingCount).toBe(0);
    expect(second.gatheringId).toBeNull();

    const aAgain = await stateOf(a);
    expect(aAgain.room?.id).toBe(second.room?.id);
    expect(aAgain.request?.status).toBe('matched');
    expect(aAgain.meId).toBe(a.id);
    expect(await roomRows(date)).toHaveLength(1);
  });

  it('응답에 실명·이메일·학과·내부 태그가 없고, 남의 대기표 내용도 없다', async () => {
    const [a, b, c] = await makeUsers(3);
    const date = dateAfter(2);
    must(await quick.requestQuickMatch(a, input(date, { bands: ['b11'], tags: ['같은 과만'] })));
    const aTicketId = await ticketId(Number(a.id));
    must(await quick.requestQuickMatch(b, input(date, { bands: ['b19'] })));

    // b 는 a 의 대기표(id·조건)를 볼 수 없다
    const stateB = await stateOf(b);
    expect(JSON.stringify(stateB)).not.toContain(aTicketId);
    expect(stateB.request?.bands).toEqual(['b19']);
    expect(stateB.waitingCount).toBe(2);

    must(await quick.requestQuickMatch(c, input(date, { bands: ['b19'] }))); // b 와 짝이 된다
    const stateA = await stateOf(a);
    const text = JSON.stringify([stateA, await stateOf(b), await stateOf(c)]);
    for (const secret of ['실명', '@hansung.ac.kr', '컴퓨터공학부', 'dept:', 'password']) expect(text).not.toContain(secret);
    expect(stateA.request?.tags).toEqual(['같은 과만']); // 내가 고른 태그는 보이되 내부 태그는 없다
    expect(stateA.request?.id).toBe(aTicketId);
    expect(stateA.room).toBeNull();
    expect((await stateOf(b)).members.map((m) => m.nickname).sort()).toEqual([b.nickname, c.nickname].sort());
  });

  it('조건이 하나라도 다르면 안 맞는다 (날짜·장소·인원·시간)', async () => {
    const date = dateAfter(3);
    const variants: Record<string, unknown>[] = [
      { date: dateAfter(4) },
      { placeType: '학교 주변' },
      { size: 3 },
      { bands: ['b18', 'b19'] },
    ];
    for (const variant of variants) {
      const [a, b] = await makeUsers(2);
      must(await quick.requestQuickMatch(a, input(date)));
      const s = must(await quick.requestQuickMatch(b, input(date, variant)));
      expect(s.room).toBeNull();
      expect(s.request?.status).toBe('waiting');
      await db.run('DELETE FROM lounge_quick_requests');
    }
    expect(await roomRows(date)).toHaveLength(0);
  });

  it('차단한 사이는 어느 쪽이 걸었든 안 맞는다', async () => {
    const date = dateAfter(5);
    for (const direction of ['a>b', 'b>a']) {
      const [a, b] = await makeUsers(2);
      await (direction === 'a>b' ? block(a.id, b.id) : block(b.id, a.id));
      must(await quick.requestQuickMatch(a, input(date)));
      const s = must(await quick.requestQuickMatch(b, input(date)));
      expect(s.room).toBeNull();
      expect((await tickets(date)).filter((t) => t.status === 'waiting').length).toBeGreaterThanOrEqual(2);
      await db.run('DELETE FROM lounge_quick_requests');
    }
    // 차단 관계가 없는 세 번째 사람은 둘 중 먼저 기다린 사람과 맞는다
    const [x, y, z] = await makeUsers(3);
    await block(x.id, y.id);
    must(await quick.requestQuickMatch(x, input(date)));
    must(await quick.requestQuickMatch(y, input(date)));
    const s = must(await quick.requestQuickMatch(z, input(date)));
    expect(s.room?.memberIds).toContain(x.id); // 가장 오래 기다린 x 가 먼저 채워진다
    expect(s.room?.memberIds).not.toContain(y.id);
  });

  it("'같은 과만': 학과가 다르면 안 맞고 같은 학과끼리만 맞는다", async () => {
    const date = dateAfter(6);
    const cs1 = await makeUser({ department: '컴퓨터공학부' });
    const fashion = await makeUser({ department: '패션디자인학과' });
    const cs2 = await makeUser({ department: '컴퓨터공학부' });

    must(await quick.requestQuickMatch(cs1, input(date, { tags: ['같은 과만'] })));
    expect(must(await quick.requestQuickMatch(fashion, input(date))).room).toBeNull(); // 상대가 같은 과만을 걸었다

    const s = must(await quick.requestQuickMatch(cs2, input(date))); // 한쪽만 걸어도 양쪽에 적용된다
    expect([...(s.room?.memberIds ?? [])].sort()).toEqual([cs1.id, cs2.id].sort());
    expect(s.request?.tags).toEqual([]); // 내부 태그는 화면에 안 나간다
    expect((await stateOf(fashion)).request?.status).toBe('waiting');
  });

  it('학과를 속인 태그(dept:)는 버려지고 서버가 자기 학과로 덮어쓴다', async () => {
    const date = dateAfter(8);
    const cs = await makeUser({ department: '컴퓨터공학부' });
    const forger = await makeUser({ department: '패션디자인학과' });

    must(await quick.requestQuickMatch(cs, input(date, { tags: ['같은 과만'] })));
    const s = must(await quick.requestQuickMatch(forger, input(date, { tags: ['dept:컴퓨터공학부'] })));
    expect(s.room).toBeNull(); // 컴공으로 속였어도 통과하지 못한다
    const stored = await q<{ tags: string[] }>(`SELECT data->'tags' AS tags FROM lounge_quick_requests WHERE user_id = ?`, [Number(forger.id)]);
    expect(stored[0].tags).toEqual(['dept:패션디자인학과']);
  });

  it('정지된 사용자의 대기표는 짝 후보와 대기 인원에서 빠진다', async () => {
    const date = dateAfter(7);
    const [a, b] = await makeUsers(2);
    must(await quick.requestQuickMatch(a, input(date)));
    await db.run('UPDATE users SET banned = TRUE WHERE id = ?', [Number(a.id)]);

    const s = must(await quick.requestQuickMatch(b, input(date)));
    expect(s.room).toBeNull();
    expect(s.waitingCount).toBe(1);
    // 정지된 사람의 대기표는 정리 때 닫힌다
    expect((await tickets(date)).find((t) => t.user_id === Number(a.id))?.status).toBe('cancelled');
  });
});

async function ticketId(userId: number): Promise<string> {
  const rows = await q<{ id: string }>('SELECT id FROM lounge_quick_requests WHERE user_id = ?', [userId]);
  return rows[0].id;
}

// ───────────── 동시에 신청 ─────────────

describe('동시 신청 (방 만들기 경쟁)', () => {
  it('3명이 인원 2 로 동시에 신청하면 방은 정확히 한 개, 한 명은 대기를 유지한다', async () => {
    for (let round = 0; round < 6; round++) {
      const date = dateAfter(10 + round);
      const people = await makeUsers(3);
      const results = await Promise.all(people.map((p) => quick.requestQuickMatch(p, input(date))));
      expect(results.every((r) => r.ok)).toBe(true);

      const rooms = await roomRows(date);
      expect(rooms).toHaveLength(1); // 선점에 진 요청의 방은 지워진다
      expect(rooms[0].status).toBe('pending');
      const t = await tickets(date);
      expect(t).toHaveLength(3); // 대기표 중복 없음
      const matched = t.filter((x) => x.status === 'matched');
      const waiting = t.filter((x) => x.status === 'waiting');
      expect(matched).toHaveLength(2);
      expect(waiting).toHaveLength(1);
      expect(matched.every((x) => x.room_id === rooms[0].id)).toBe(true);
      expect(waiting[0].room_id).toBeNull();
      // 방 문서의 멤버와 선점된 대기표 주인이 같다
      const room = (await stateOf(people.find((p) => matched.some((m) => m.user_id === Number(p.id)))!)).room!;
      expect([...room.memberIds].sort()).toEqual(matched.map((m) => String(m.user_id)).sort());
    }
  });

  it('여러 명이 동시에 신청해도 짝이 맞는 사람은 모두 방에 들어간다 (4명→2방, 6명→3방, 7명 인원3→2방+1대기)', async () => {
    const cases = [
      { n: 4, size: 2, rooms: 2, waiting: 0 },
      { n: 6, size: 2, rooms: 3, waiting: 0 },
      { n: 7, size: 3, rooms: 2, waiting: 1 },
      { n: 8, size: 4, rooms: 2, waiting: 0 },
    ];
    let day = 30;
    for (const c of cases) {
      const date = dateAfter(day++);
      const people = await makeUsers(c.n);
      const results = await Promise.all(people.map((p) => quick.requestQuickMatch(p, input(date, { size: c.size }))));
      expect(results.every((r) => r.ok)).toBe(true);

      const rooms = await roomRows(date);
      expect(rooms.filter((r) => r.status === 'pending')).toHaveLength(c.rooms);
      expect(rooms).toHaveLength(c.rooms);
      const t = await tickets(date);
      expect(t.filter((x) => x.status === 'matched')).toHaveLength(c.rooms * c.size);
      expect(t.filter((x) => x.status === 'waiting')).toHaveLength(c.waiting);
      // 한 사람이 두 방에 들어가거나 한 방이 정원을 넘지 않는다
      const perRoom = new Map<string, number>();
      for (const x of t.filter((y) => y.room_id)) perRoom.set(x.room_id!, (perRoom.get(x.room_id!) ?? 0) + 1);
      expect([...perRoom.values()].every((count) => count === c.size)).toBe(true);
    }
  });

  it('같은 사람이 동시에 두 번 눌러도 대기표는 하나다', async () => {
    const date = dateAfter(40);
    const [a] = await makeUsers(1);
    const results = await Promise.all([
      quick.requestQuickMatch(a, input(date)),
      quick.requestQuickMatch(a, input(date)),
      quick.requestQuickMatch(a, input(date)),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok).every((r) => codeOf(r) === 'ALREADY_JOINED')).toBe(true);
    expect(await tickets(date)).toHaveLength(1);
  });

  it('이미 대기 중이면 ALREADY_JOINED, 취소하면 다시 신청할 수 있다', async () => {
    const date = dateAfter(41);
    const [a] = await makeUsers(1);
    must(await quick.requestQuickMatch(a, input(date)));
    expect(codeOf(await quick.requestQuickMatch(a, input(date, { size: 3 })))).toBe('ALREADY_JOINED');
    must(await quick.cancelQuickMatch(a.id));
    must(await quick.requestQuickMatch(a, input(date, { size: 3 })));
  });
});

// ───────────── 투표 · 수락 · 확정 ─────────────

describe('확정 (전원 수락 → 밥약 한 개)', () => {
  it('전원이 수락하면 밥약이 한 개 만들어지고 참여자 전원이 앉고 방(단톡방)이 열린다', async () => {
    const date = dateAfter(50);
    const { people, roomId } = await pairUp(date, { size: 3 });
    const [a, b, c] = people;

    // 시간 투표: a, b 는 13시만, c 는 기본(12·13시) → 13시가 표를 가장 많이 받는다
    const voted = must(await quick.voteBands(a.id, roomId, ['b13']));
    expect(voted.room?.votes[a.id]).toEqual(['b13']);
    must(await quick.voteBands(b.id, roomId, ['b13']));

    expect(must(await quick.answerRoom(a.id, roomId, 'accepted')).room?.status).toBe('pending');
    expect(must(await quick.answerRoom(b.id, roomId, 'accepted')).room?.status).toBe('pending');
    expect(await allGatherings()).toHaveLength(0); // 아직 한 명이 안 눌렀다

    const done = must(await quick.answerRoom(c.id, roomId, 'accepted'));
    expect(done.room?.status).toBe('confirmed');
    expect(done.gatheringId).toBeTruthy();

    const gs = await allGatherings();
    expect(gs).toHaveLength(1);
    const g = gs[0].data;
    expect(g.id).toBe(done.gatheringId);
    expect(gs[0].kind).toBe('meal');
    expect(g.joinPolicy).toBe('auto');
    expect(g.title).toBe('학식에서 같이 밥 (빠른 매칭)');
    expect(g.place).toBe('학식');
    expect(g.meta).toEqual({ placeType: '학식', tags: ['빠른 매칭'] });
    expect(g.slots).toHaveLength(1);
    expect(g.slots[0].capacity).toBe(3);
    expect([...g.slots[0].memberIds].sort()).toEqual([a.id, b.id, c.id].sort());
    expect(g.status).toBe('full');
    expect(people.map((p) => p.id)).toContain(g.hostId);
    expect(g.meetAt).toBe(meetAtOf(date, 'b13'));
    expect(Date.parse(g.meetAt) - Date.parse(g.joinDeadline)).toBe(10 * 60_000);

    const chat = await messages(g.id);
    expect(chat).toHaveLength(1); // 방이 열렸다 (시스템 메시지 한 줄)
    expect(chat[0].kind).toBe('system');

    // 세 사람 모두 같은 모임 id 를 본다
    for (const p of people) expect((await stateOf(p)).gatheringId).toBe(g.id);
    expect(await allGatherings()).toHaveLength(1); // 여러 번 읽어도 늘지 않는다
  });

  it('두 명이 동시에 마지막 수락을 눌러도 밥약은 한 개다', async () => {
    for (let round = 0; round < 8; round++) {
      await db.run('DELETE FROM lounge_gatherings');
      const { people, roomId } = await pairUp(dateAfter(60 + round));
      const [a, b] = people;
      const results = await Promise.all([quick.answerRoom(a.id, roomId, 'accepted'), quick.answerRoom(b.id, roomId, 'accepted')]);
      expect(results.every((r) => r.ok)).toBe(true);

      const gs = await allGatherings();
      expect(gs).toHaveLength(1);
      expect([...gs[0].data.slots[0].memberIds].sort()).toEqual([a.id, b.id].sort());
      expect(await messages(gs[0].id)).toHaveLength(1);
      // 먼저 쓴 쪽의 응답은 확정 전 상태일 수 있다 — 끝난 뒤에는 둘 다 같은 모임을 본다
      const seen = results.map((r) => must(r).gatheringId).filter(Boolean);
      expect(seen.length).toBeGreaterThanOrEqual(1);
      expect(new Set(seen)).toEqual(new Set([gs[0].id]));
      expect((await stateOf(a)).gatheringId).toBe(gs[0].id);
      expect((await stateOf(b)).gatheringId).toBe(gs[0].id);
    }
  });

  it('네 명이 전부 동시에 수락해도, 한 사람이 연달아 눌러도 밥약은 한 개다', async () => {
    const { people, roomId } = await pairUp(dateAfter(70), { size: 4 });
    const results = await Promise.all([
      ...people.map((p) => quick.answerRoom(p.id, roomId, 'accepted')),
      quick.answerRoom(people[0].id, roomId, 'accepted'),
      quick.answerRoom(people[3].id, roomId, 'accepted'),
    ]);
    // 확정 뒤에 도착한 중복 수락은 "이미 끝난 매칭" 으로 거절될 수 있다 — 그래도 모임은 하나다.
    expect(results.filter((r) => r.ok).length).toBeGreaterThanOrEqual(4);
    expect(results.filter((r) => !r.ok).every((r) => codeOf(r) === 'NOT_OPEN')).toBe(true);

    const gs = await allGatherings();
    expect(gs).toHaveLength(1);
    expect([...gs[0].data.slots[0].memberIds].sort()).toEqual(people.map((p) => p.id).sort());
    expect(await messages(gs[0].id)).toHaveLength(1);
  });

  it('확정된 방에는 더 이상 투표·수락을 못 하고, 참여자가 아니면 FORBIDDEN', async () => {
    const { people, roomId } = await pairUp(dateAfter(75));
    for (const p of people) must(await quick.answerRoom(p.id, roomId, 'accepted'));
    expect(codeOf(await quick.answerRoom(people[0].id, roomId, 'declined'))).toBe('NOT_OPEN');
    expect(codeOf(await quick.voteBands(people[0].id, roomId, ['b12']))).toBe('NOT_OPEN');

    const [outsider] = await makeUsers(1);
    expect(codeOf(await quick.answerRoom(outsider.id, roomId, 'accepted'))).toBe('FORBIDDEN');
    expect(codeOf(await quick.voteBands(outsider.id, roomId, ['b12']))).toBe('FORBIDDEN');
    expect(codeOf(await quick.answerRoom(people[0].id, 'no-such-room', 'accepted'))).toBe('NOT_FOUND');
  });

  it('투표는 방의 시간대 안에서만, 하나 이상 골라야 한다', async () => {
    const { people, roomId } = await pairUp(dateAfter(76));
    expect(codeOf(await quick.voteBands(people[0].id, roomId, ['b19']))).toBe('INVALID');
    expect(codeOf(await quick.voteBands(people[0].id, roomId, []))).toBe('INVALID');
    const s = must(await quick.voteBands(people[0].id, roomId, ['b13', 'b19']));
    expect(s.room?.votes[people[0].id]).toEqual(['b13']);
  });

  it('확정 도중 서버가 멈춰 모임이 없어도, 다음에 읽을 때 같은 모임 id 로 다시 만든다', async () => {
    const { people, roomId } = await pairUp(dateAfter(77));
    for (const p of people) must(await quick.answerRoom(p.id, roomId, 'accepted'));
    const [original] = await allGatherings();

    // 모임 저장 직전에 죽은 상황을 흉내: 모임과 단톡방 메시지를 지운다
    await db.run('DELETE FROM lounge_messages');
    await db.run('DELETE FROM lounge_gatherings');
    const s = await stateOf(people[0]);
    const after = await allGatherings();
    expect(after).toHaveLength(1);
    expect(after[0].id).toBe(original.id);
    expect(s.gatheringId).toBe(original.id);
    // 동시에 여러 명이 읽어도 하나
    await db.run('DELETE FROM lounge_gatherings');
    await Promise.all(people.map((p) => stateOf(p)));
    expect(await allGatherings()).toHaveLength(1);
  });

  it('확정 직전에 서로 차단했다면 모임을 만들지 않고 방을 깬 뒤 대기열로 돌린다', async () => {
    const date = dateAfter(78);
    const { people, roomId } = await pairUp(date);
    await block(people[0].id, people[1].id);
    must(await quick.answerRoom(people[0].id, roomId, 'accepted'));
    const last = await quick.answerRoom(people[1].id, roomId, 'accepted');
    expect(codeOf(last)).toBe('NOT_OPEN');
    expect(await allGatherings()).toHaveLength(0);
    expect((await roomRows(date))[0].status).toBe('cancelled');
    const t = await tickets(date);
    expect(t.every((x) => x.status === 'waiting' && x.room_id === null)).toBe(true); // 차단 관계라 다시 묶이지도 않는다
  });

  it('확정 직전에 참여자가 정지되면 확정을 되돌리고, 정지된 사람의 대기표만 닫는다', async () => {
    const date = dateAfter(79);
    const { people, roomId } = await pairUp(date, { size: 3 });
    await db.run('UPDATE users SET banned = TRUE WHERE id = ?', [Number(people[2].id)]);
    must(await quick.answerRoom(people[0].id, roomId, 'accepted'));
    must(await quick.answerRoom(people[1].id, roomId, 'accepted'));
    const last = await quick.answerRoom(people[2].id, roomId, 'accepted');
    expect(codeOf(last)).toBe('NOT_OPEN');

    expect(await allGatherings()).toHaveLength(0);
    expect((await roomRows(date))[0].status).toBe('cancelled');
    const t = await tickets(date);
    expect(t.find((x) => x.user_id === Number(people[2].id))?.status).toBe('cancelled');
    expect(t.filter((x) => x.status === 'waiting')).toHaveLength(2);
  });
});

// ───────────── 거절 · 취소 · 만료 · 지난 시간 ─────────────

describe('거절 · 취소 · 만료', () => {
  it('한 명이 거절하면 방이 깨지고, 거절한 사람의 대기표는 취소·나머지는 대기로 돌아온다', async () => {
    const date = dateAfter(80);
    const { people, roomId } = await pairUp(date, { size: 3 });
    const [a, b, c] = people;

    must(await quick.answerRoom(a.id, roomId, 'accepted'));
    const after = must(await quick.answerRoom(b.id, roomId, 'declined'));
    expect(after.room).toBeNull();
    expect(after.request).toBeNull(); // 거절한 사람은 대기에서 빠진다

    expect((await roomRows(date))[0].status).toBe('cancelled');
    const t = await tickets(date);
    expect(t.find((x) => x.user_id === Number(b.id))?.status).toBe('cancelled');
    for (const p of [a, c]) {
      const row = t.find((x) => x.user_id === Number(p.id))!;
      expect(row.status).toBe('waiting');
      expect(row.room_id).toBeNull();
      const s = await stateOf(p);
      expect(s.request?.status).toBe('waiting');
      expect(s.room).toBeNull();
    }
    expect((await stateOf(a)).waitingCount).toBe(2);
    expect(await allGatherings()).toHaveLength(0);
    // 깨진 방에는 더 못 답한다
    expect(codeOf(await quick.answerRoom(c.id, roomId, 'accepted'))).toBe('NOT_OPEN');
    // 거절한 사람은 다시 신청할 수 있다
    must(await quick.requestQuickMatch(b, input(date, { size: 3 })));
  });

  it('돌아온 사람은 이미 기다리던 다른 사람과 바로 다시 짝이 된다', async () => {
    const date = dateAfter(81);
    const [a, b, c] = await makeUsers(3);
    must(await quick.requestQuickMatch(a, input(date)));
    const m = must(await quick.requestQuickMatch(b, input(date)));
    must(await quick.requestQuickMatch(c, input(date))); // 방이 가득 차서 c 는 대기
    expect((await stateOf(c)).request?.status).toBe('waiting');

    must(await quick.answerRoom(b.id, roomIdOf(m), 'declined'));
    const sa = await stateOf(a);
    expect(sa.room).not.toBeNull();
    expect([...sa.room!.memberIds].sort()).toEqual([a.id, c.id].sort());
    expect(sa.room!.id).not.toBe(roomIdOf(m));
    expect((await stateOf(c)).room?.id).toBe(sa.room!.id);
  });

  it('방이 만료되면 방이 취소되고 대기표는 대기로 돌아오며, 만료된 방에는 답할 수 없다', async () => {
    const date = dateAfter(82);
    const { people, roomId } = await pairUp(date);
    const later = new Date(Date.now() + 31 * 60_000).toISOString();

    const s = await quick.quickState(people[0].id, later);
    expect(s.room).toBeNull();
    expect(s.request?.status).toBe('waiting');
    expect((await roomRows(date))[0].status).toBe('cancelled');
    expect((await tickets(date)).every((x) => x.status === 'waiting' && x.room_id === null)).toBe(true);
    expect(codeOf(await quick.answerRoom(people[1].id, roomId, 'accepted', later))).toBe('NOT_OPEN');
    expect(await allGatherings()).toHaveLength(0);
  });

  it('정리가 아직 안 된 만료된 방에 답하면 DEADLINE_PASSED 를 주고 그 자리에서 방을 정리한다', async () => {
    const date = dateAfter(83);
    const { people, roomId } = await pairUp(date);
    const later = new Date(Date.now() + 31 * 60_000).toISOString();

    expect(codeOf(await quick.answerRoom(people[0].id, roomId, 'accepted', later))).toBe('DEADLINE_PASSED');
    expect(codeOf(await quick.voteBands(people[1].id, roomId, ['b12'], later))).toBe('NOT_OPEN'); // 이미 정리됨
    expect((await roomRows(date))[0].status).toBe('cancelled');
    expect((await tickets(date)).every((x) => x.status === 'waiting')).toBe(true);
  });

  it('대기 취소: 대기 중 / 방에 들어간 뒤 / 확정 뒤', async () => {
    const date = dateAfter(84);
    const [a, b, c] = await makeUsers(3);
    expect(codeOf(await quick.cancelQuickMatch(a.id))).toBe('NOT_FOUND');

    // ① 대기 중 취소
    must(await quick.requestQuickMatch(a, input(date, { size: 3 })));
    const cancelled = must(await quick.cancelQuickMatch(a.id));
    expect(cancelled.request).toBeNull();
    expect(cancelled.waitingCount).toBe(0);

    // ② 방에 들어간 뒤 취소 → 방이 깨지고 나머지는 대기
    must(await quick.requestQuickMatch(a, input(date, { size: 3 })));
    must(await quick.requestQuickMatch(b, input(date, { size: 3 })));
    const m = must(await quick.requestQuickMatch(c, input(date, { size: 3 })));
    must(await quick.cancelQuickMatch(c.id));
    expect((await roomRows(date)).filter((r) => r.status === 'pending')).toHaveLength(0);
    expect((await stateOf(a)).request?.status).toBe('waiting');
    expect((await stateOf(b)).room).toBeNull();
    expect(codeOf(await quick.answerRoom(a.id, roomIdOf(m), 'accepted'))).toBe('NOT_OPEN');

    // ③ 확정된 뒤 취소 → 대기표만 닫히고 밥약은 그대로
    const date2 = dateAfter(85);
    const { people, roomId } = await pairUp(date2);
    for (const p of people) must(await quick.answerRoom(p.id, roomId, 'accepted'));
    const closed = must(await quick.cancelQuickMatch(people[0].id));
    expect(closed.request).toBeNull();
    expect(await allGatherings()).toHaveLength(1);
    expect((await stateOf(people[1])).room?.status).toBe('confirmed');
  });

  it('확정된 약속이 끝나고 3시간이 지나면 다시 신청할 수 있다 (그 전에는 막힌다)', async () => {
    const date = dateAfter(86);
    const { people, roomId } = await pairUp(date);
    for (const p of people) must(await quick.answerRoom(p.id, roomId, 'accepted'));

    const blocked = await quick.requestQuickMatch(people[0], input(dateAfter(87)));
    expect(codeOf(blocked)).toBe('ALREADY_JOINED');

    const done = at(date, 'b12', 181); // 약속 12시(KST) + 3시간 1분
    const s = await quick.quickState(people[0].id, done);
    expect(s.request).toBeNull();
    must(await quick.requestQuickMatch(people[0], input(dateAfter(87)), done));
  });
});

describe('지난 시간대', () => {
  it('신청할 때 이미 시작한 시간대는 빼고, 전부 지났으면 INVALID', async () => {
    const date = dateAfter(90);
    const [a, b] = await makeUsers(2);
    const now = at(date, 'b12', 30); // date 12:30 (KST)

    expect(codeOf(await quick.requestQuickMatch(a, input(date, { bands: ['b11', 'b12'] }), now))).toBe('INVALID');
    expect((await tickets(date)).length).toBe(0);

    const s = must(await quick.requestQuickMatch(b, input(date, { bands: ['b11', 'b12', 'b13', 'b17'] }), now));
    expect(s.request?.bands).toEqual(['b13', 'b17']);
  });

  it('방이 열려 있는 동안 시간대가 지나가면 그 시간대는 빠지고, 남은 게 없으면 방이 깨진다', async () => {
    // 11:50 에 방이 만들어졌다 (TTL 30분 → 12:20 까지). 12:05 에는 12시 구간이 이미 시작했다.
    const date = dateAfter(91);
    const created = at(date, 'b12', -10);
    const midway = at(date, 'b12', 5);

    const [a, b] = await makeUsers(2);
    must(await quick.requestQuickMatch(a, input(date), created));
    const m = must(await quick.requestQuickMatch(b, input(date), created));
    const roomId = roomIdOf(m);

    // 12시는 빠지고 13시로만 확정된다
    const afterVote = must(await quick.voteBands(a.id, roomId, ['b12', 'b13'], midway));
    expect(afterVote.room?.bands).toEqual(['b13']);
    expect(afterVote.room?.votes[a.id]).toEqual(['b13']);
    expect(codeOf(await quick.voteBands(a.id, roomId, ['b12'], midway))).toBe('INVALID');

    must(await quick.answerRoom(a.id, roomId, 'accepted', midway));
    const done = must(await quick.answerRoom(b.id, roomId, 'accepted', midway));
    expect(done.room?.status).toBe('confirmed');
    const [g] = await allGatherings();
    expect(g.data.meetAt).toBe(meetAtOf(date, 'b13'));
  });

  it('남은 시간대가 없으면 수락해도 확정되지 않고 방이 깨진다 (과거 약속 방지)', async () => {
    const date = dateAfter(92);
    const created = at(date, 'b12', -10);
    const midway = at(date, 'b12', 5);
    const [a, b] = await makeUsers(2);
    must(await quick.requestQuickMatch(a, input(date, { bands: ['b12'] }), created));
    const roomId = roomIdOf(must(await quick.requestQuickMatch(b, input(date, { bands: ['b12'] }), created)));

    expect(codeOf(await quick.answerRoom(a.id, roomId, 'accepted', midway))).toBe('DEADLINE_PASSED');
    expect(await allGatherings()).toHaveLength(0);
    expect((await roomRows(date))[0].status).toBe('cancelled');
    // 두 사람의 대기표도 지난 시간대뿐이라 다음 읽기에서 닫힌다
    expect((await quick.quickState(a.id, midway)).request).toBeNull();
    expect((await quick.quickState(b.id, midway)).request).toBeNull();
  });
});

// ───────────── 입력 검증 ─────────────

describe('신청 검증', () => {
  it('잘못된 본문은 INVALID, 정지된 사용자는 BANNED', async () => {
    const [a] = await makeUsers(1);
    const date = dateAfter(95);
    const bad: unknown[] = [
      null,
      'x',
      input('2026-9-1'),
      input('2026-02-31'),
      input(date, { placeType: '우주' }),
      input(date, { size: 1 }),
      input(date, { size: 5 }),
      input(date, { size: '2' }),
      input(date, { bands: [] }),
      input(date, { bands: ['b99'] }),
      input(date, { tags: 'x' }),
    ];
    for (const raw of bad) expect(codeOf(await quick.requestQuickMatch(a, raw))).toBe('INVALID');
    expect(await tickets(date)).toHaveLength(0);

    const banned = await makeUser({ banned: true });
    expect(codeOf(await quick.requestQuickMatch(banned, input(date)))).toBe('BANNED');
    await db.run('UPDATE users SET banned = TRUE WHERE id = ?', [Number(a.id)]);
    expect(codeOf(await quick.requestQuickMatch(await fresh(a.id), input(date)))).toBe('BANNED');
  });

  it('GET 은 대기표가 없으면 빈 상태를 준다', async () => {
    const [a] = await makeUsers(1);
    const s = await stateOf(a);
    expect(s).toMatchObject({ request: null, room: null, members: [], gatheringId: null, waitingCount: 0, meId: a.id });
  });
});

describe('PATCH 본문 검증 (routes/quick.ts)', () => {
  it('roomId + (bands | answer) 중 정확히 하나', () => {
    const code = (raw: unknown) => {
      const r = routes.parsePatchBody(raw);
      return r.ok ? 'OK' : r.error.code;
    };
    expect(code({ roomId: 'r1', bands: ['b12'] })).toBe('OK');
    expect(code({ roomId: 'r1', answer: 'accepted' })).toBe('OK');
    expect(code({ roomId: 'r1', answer: 'declined' })).toBe('OK');
    expect(code(null)).toBe('INVALID');
    expect(code({ bands: ['b12'] })).toBe('INVALID');
    expect(code({ roomId: '', bands: ['b12'] })).toBe('INVALID');
    expect(code({ roomId: 'r1' })).toBe('INVALID');
    expect(code({ roomId: 'r1', bands: ['b12'], answer: 'accepted' })).toBe('INVALID');
    expect(code({ roomId: 'r1', answer: 'maybe' })).toBe('INVALID');
    expect(code({ roomId: 'r1', bands: 'b12' })).toBe('INVALID');
    expect(code({ roomId: 'r1', bands: [1] })).toBe('INVALID');
    expect(code({ roomId: 7, answer: 'accepted' })).toBe('INVALID');
  });

  it('roomId 는 영문·숫자·_- 1~64자만 — NUL 같은 글자가 SQL 까지 가서 500 이 되지 않게 입구에서 INVALID', () => {
    const code = (roomId: unknown) => {
      const r = routes.parsePatchBody({ roomId, answer: 'accepted' });
      return r.ok ? 'OK' : r.error.code;
    };
    expect(code('3f2c9d1e-aaaa-bbbb-cccc-0123456789ab')).toBe('OK');
    expect(code('room_1-A')).toBe('OK');
    expect(code('x'.repeat(64))).toBe('OK');
    for (const bad of ['a\u0000b', '\u0000', 'x\ud800', 'a/b', 'a b', '가나다', 'a\n', 'x'.repeat(65), '']) {
      expect(code(bad), JSON.stringify(bad)).toBe('INVALID');
    }
  });
});

// ───────────── 검증 → 속도 제한 → 저장 (prepareQuickMatch) ─────────────

describe('신청 검증과 저장의 분리 (prepareQuickMatch)', () => {
  it('검증만 하고 DB 에는 아무것도 남기지 않는다', async () => {
    const [a] = await makeUsers(1);
    const date = dateAfter(96);
    const prepared = must(quick.prepareQuickMatch(a, input(date, { bands: ['b13', 'b12', 'b13'], tags: [' 조용히 '] })));
    expect(prepared.input.bands).toEqual(['b13', 'b12']); // 중복은 합쳐진다
    expect(prepared.bands).toEqual(['b13', 'b12']);
    expect(prepared.input.tags).toEqual(['조용히']);
    expect(await tickets(date)).toHaveLength(0);

    // 저장은 submitQuickMatch 가 한다
    const state = must(await quick.submitQuickMatch(a, prepared));
    expect(state.request?.status).toBe('waiting');
    expect(await tickets(date)).toHaveLength(1);
  });

  it('잘못된 본문·정지·지난 시간은 검증 단계에서 걸러진다', async () => {
    const [a] = await makeUsers(1);
    const banned = await makeUser({ banned: true });
    const date = dateAfter(97);
    expect(codeOf(quick.prepareQuickMatch(a, null))).toBe('INVALID');
    expect(codeOf(quick.prepareQuickMatch(a, input(date, { tags: ['a\u0000b'] })))).toBe('INVALID');
    expect(codeOf(quick.prepareQuickMatch(banned, input(date)))).toBe('BANNED');
    expect(codeOf(quick.prepareQuickMatch(a, input('2020-01-01')))).toBe('INVALID'); // 이미 지난 시간
    expect(codeOf(quick.prepareQuickMatch(a, input(date)))).toBe('OK');
  });

  it('NUL·짝 없는 서로게이트가 든 태그는 INVALID 이고 대기표를 남기지 않는다 (예전에는 jsonb 오류로 500)', async () => {
    const [a] = await makeUsers(1);
    const date = dateAfter(98);
    for (const tag of ['a\u0000b', 'x\ud800', '\udc00y', 'a\u0001b']) {
      expect(codeOf(await quick.requestQuickMatch(a, input(date, { tags: [tag] }))), JSON.stringify(tag)).toBe('INVALID');
    }
    expect(await tickets(date)).toHaveLength(0);
    must(await quick.requestQuickMatch(a, input(date, { tags: ['😀 점심'] }))); // 정상 태그는 그대로 저장된다
    const stored = await q<{ tags: string[] }>(`SELECT data->'tags' AS tags FROM lounge_quick_requests WHERE user_id = ?`, [Number(a.id)]);
    expect(stored[0].tags).toEqual(['😀 점심', 'dept:컴퓨터공학부']);
  });
});

// ───────────── 실제 라우터 (HTTP) ─────────────

type Reply = { status: number; json: { error?: string; code?: string; state?: QuickState } | null; cache: string | null };

/** 실제 quickRouter 를 부른다. 본문은 JSON.stringify 로 보내므로 NUL·서로게이트도 그대로 서버에 닿는다. */
async function call(user: LoungeUser, method: 'GET' | 'POST' | 'PATCH' | 'DELETE', body?: unknown): Promise<Reply> {
  const res = await fetch(`${baseUrl}/meals/quick`, {
    method,
    headers: { 'x-test-user': user.id, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json: Reply['json'] = null;
  try {
    json = JSON.parse(text);
  } catch {
    // JSON 이 아닌 본문(예: 예상 못 한 HTML 오류 페이지) — json 이 null 이면 테스트가 실패한다
  }
  return { status: res.status, json, cache: res.headers.get('cache-control') };
}

describe('HTTP: 입력 오류는 500 이 아니라 INVALID', () => {
  it('POST: 위험한 글자가 든 태그는 400 INVALID 이고 대기표가 남지 않는다', async () => {
    const [a] = await makeUsers(1);
    const date = dateAfter(100);
    for (const tag of ['a\u0000b', 'x\ud800', '\udc00y', 'a\u0001b', 'a\nb']) {
      const r = await call(a, 'POST', input(date, { tags: [tag] }));
      expect([r.status, r.json?.code], JSON.stringify(tag)).toEqual([400, 'INVALID']);
    }
    expect(await tickets(date)).toHaveLength(0);
    expect((await call(a, 'POST', input(date, { tags: ['점심 간단히', '😀'] }))).status).toBe(200);
    expect(await tickets(date)).toHaveLength(1);
  });

  it('PATCH: NUL 이 든 roomId 는 수락·거절·투표 모두 400 INVALID', async () => {
    const [a] = await makeUsers(1);
    for (const patch of [{ answer: 'accepted' }, { answer: 'declined' }, { bands: ['b12'] }]) {
      const r = await call(a, 'PATCH', { roomId: 'a\u0000b', ...patch });
      expect([r.status, r.json?.code], JSON.stringify(patch)).toEqual([400, 'INVALID']);
    }
    // 모양이 올바른 없는 방은 예전처럼 404
    const missing = await call(a, 'PATCH', { roomId: 'no-such-room_1', answer: 'accepted' });
    expect([missing.status, missing.json?.code]).toEqual([404, 'NOT_FOUND']);
  });
});

describe('HTTP: Cache-Control', () => {
  it('성공·오류 응답 모두 GET·POST·PATCH·DELETE 가 no-store (사용자별 상태를 중간 캐시가 쥐지 않게)', async () => {
    const [a] = await makeUsers(1);
    const date = dateAfter(101);
    const replies = [
      await call(a, 'GET'),
      await call(a, 'POST', input(date)),
      await call(a, 'POST', { date: 'bad' }), // 400
      await call(a, 'PATCH', { roomId: 'zzz', answer: 'accepted' }), // 404
      await call(a, 'PATCH', { roomId: 7 }), // 400
      await call(a, 'DELETE'),
      await call(a, 'DELETE'), // 404
    ];
    expect(replies.map((r) => r.status)).toEqual([200, 200, 400, 404, 400, 200, 404]);
    for (const r of replies) expect(r.cache).toBe('no-store');
  });
});

describe('HTTP: 신청 속도 제한은 검증을 통과한 요청만 센다', () => {
  it('잘못된 본문·지난 시간·정지 때문에 되돌려받은 요청은 횟수를 깎지 않는다', async () => {
    const [a] = await makeUsers(1);
    const date = dateAfter(102);
    for (let i = 0; i < 15; i++) expect((await call(a, 'POST', { date: 'bad' })).status).toBe(400);
    for (let i = 0; i < 15; i++) expect((await call(a, 'POST', input('2020-01-01'))).status).toBe(400); // 이미 지난 시간
    for (let i = 0; i < 15; i++) expect((await call(a, 'POST', input(date, { tags: ['a\u0000b'] }))).status).toBe(400);

    // 그렇게 30번 틀리고도 정상 신청은 200, 곧바로 또 누르면 429 가 아니라 409
    expect((await call(a, 'POST', input(date))).status).toBe(200);
    const dup = await call(a, 'POST', input(date));
    expect([dup.status, dup.json?.code]).toEqual([409, 'ALREADY_JOINED']);

    const banned = await makeUser({ banned: true });
    for (let i = 0; i < 12; i++) {
      const r = await call(banned, 'POST', input(date));
      expect([r.status, r.json?.code]).toEqual([403, 'BANNED']); // 12번째에도 429 가 아니다
    }
  });

  it('검증을 통과한 요청은 10분에 10번까지, 11번째는 429 RATE_LIMITED', async () => {
    const [a] = await makeUsers(1);
    const date = dateAfter(103);
    expect((await call(a, 'POST', input(date))).status).toBe(200); // 1
    for (let i = 2; i <= 10; i++) expect((await call(a, 'POST', input(date))).status, `${i}번째`).toBe(409);
    const over = await call(a, 'POST', input(date));
    expect([over.status, over.json?.code]).toEqual([429, 'RATE_LIMITED']);
    // 제한은 신청에만 걸린다: 읽기·취소는 막히지 않는다
    expect((await call(a, 'GET')).status).toBe(200);
    expect((await call(a, 'DELETE')).status).toBe(200);
  });

  it('한 사람의 한도가 다른 사람의 신청을 막지 않는다', async () => {
    const [a, b] = await makeUsers(2);
    const date = dateAfter(104);
    for (let i = 0; i < 11; i++) await call(a, 'POST', input(date));
    expect((await call(a, 'POST', input(date))).status).toBe(429);
    expect((await call(b, 'POST', input(date))).status).toBe(200);
  });
});

// ───────────── 멤버가 사라진 후보 방 ─────────────

describe('후보 방의 멤버가 탈퇴하거나 정지되면', () => {
  /** 회원 탈퇴와 같은 효과: users 행을 지우면 대기표는 외래키로 함께 지워진다. */
  const removeUser = (u: LoungeUser) => db.run('DELETE FROM users WHERE id = ?', [Number(u.id)]);

  it('다음 읽기에서 방이 깨지고, 남은 사람은 만료(30분)를 기다리지 않고 대기로 돌아온다', async () => {
    const date = dateAfter(110);
    const { people, roomId } = await pairUp(date);
    const [a, b] = people;
    must(await quick.answerRoom(a.id, roomId, 'accepted')); // a 는 이미 수락하고 b 를 기다리는 중
    await removeUser(b);

    const s = await stateOf(a);
    expect(s.room).toBeNull();
    expect(s.request?.status).toBe('waiting');
    expect(s.waitingCount).toBe(1);
    expect((await roomRows(date))[0].status).toBe('cancelled');
    expect(codeOf(await quick.answerRoom(a.id, roomId, 'accepted'))).toBe('NOT_OPEN'); // 깨진 방에는 답할 수 없다
    expect(await allGatherings()).toHaveLength(0);
    // 대기표는 하나, 다시 신청하려고 하면 이미 대기 중이다
    expect(await tickets(date)).toHaveLength(1);
    expect(codeOf(await quick.requestQuickMatch(a, input(date)))).toBe('ALREADY_JOINED');
  });

  it('이미 기다리던 다른 사람이 있으면 바로 새 방에 묶인다 (탈퇴한 사람은 빠진다)', async () => {
    const date = dateAfter(111);
    const [a, b, c] = await makeUsers(3);
    must(await quick.requestQuickMatch(a, input(date)));
    const first = must(await quick.requestQuickMatch(b, input(date)));
    const oldRoom = roomIdOf(first);
    must(await quick.requestQuickMatch(c, input(date))); // 방이 차서 c 는 대기
    await removeUser(b);

    const s = await stateOf(a);
    expect(s.room?.id).not.toBe(oldRoom);
    expect([...(s.room?.memberIds ?? [])].sort()).toEqual([a.id, c.id].sort());
    expect(s.members.every((m) => m.nickname !== '(탈퇴한 사용자)')).toBe(true);
    expect((await stateOf(c)).room?.id).toBe(s.room?.id);
    expect((await roomRows(date)).filter((r) => r.status === 'pending')).toHaveLength(1);
  });

  it('세 명 방에서 한 명이 탈퇴하면 남은 둘은 대기로 돌아온다 (인원이 안 차 다시 묶이지 않는다)', async () => {
    const date = dateAfter(112);
    const { people } = await pairUp(date, { size: 3 });
    await removeUser(people[1]);
    for (const p of [people[0], people[2]]) {
      const s = await stateOf(p);
      expect(s.room).toBeNull();
      expect(s.request?.status).toBe('waiting');
    }
    expect((await stateOf(people[0])).waitingCount).toBe(2);
  });

  it('정지된 멤버가 있는 방도 깬다 — 정지된 사람의 대기표는 닫히고 나머지는 대기로', async () => {
    const date = dateAfter(113);
    const { people } = await pairUp(date);
    const [a, b] = people;
    await db.run('UPDATE users SET banned = TRUE WHERE id = ?', [Number(b.id)]);

    const s = await stateOf(a);
    expect(s.room).toBeNull();
    expect(s.request?.status).toBe('waiting');
    const t = await tickets(date);
    expect(t.find((x) => x.user_id === Number(b.id))?.status).toBe('cancelled');
    expect(t.find((x) => x.user_id === Number(a.id))?.status).toBe('waiting');
    expect((await roomRows(date))[0].status).toBe('cancelled');
  });

  it('여러 방을 한 번에 살핀다 — 멀쩡한 방은 그대로 두고 사라진 멤버가 있는 방만 깬다', async () => {
    const date = dateAfter(114);
    const one = await pairUp(date);
    const two = await pairUp(date);
    await removeUser(two.people[1]);

    expect((await stateOf(one.people[0])).room?.id).toBe(one.roomId); // 멀쩡한 방은 같은 방
    expect((await stateOf(one.people[1])).room?.status).toBe('pending');
    expect((await stateOf(two.people[0])).room).toBeNull();
    const rooms = await roomRows(date);
    expect(rooms.find((r) => r.id === one.roomId)?.status).toBe('pending');
    expect(rooms.find((r) => r.id === two.roomId)?.status).toBe('cancelled');
  });

  it('이미 확정된 방은 건드리지 않는다 (모임은 모임 쪽 규칙을 따른다)', async () => {
    const date = dateAfter(115);
    const { people, roomId } = await pairUp(date);
    for (const p of people) must(await quick.answerRoom(p.id, roomId, 'accepted'));
    const host = (await allGatherings())[0].data.hostId;
    const [stays, leaves] = people[0].id === host ? [people[0], people[1]] : [people[1], people[0]]; // 주최자가 아닌 쪽이 탈퇴
    await removeUser(leaves);

    const s = await stateOf(stays);
    expect(s.room?.status).toBe('confirmed');
    expect(s.gatheringId).toBeTruthy();
    expect(await allGatherings()).toHaveLength(1);
  });
});
