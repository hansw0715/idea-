/**
 * 택시식 즉시 매칭(위치만 보냄) — 핵심 동작 테스트 (PGlite 임시 DB).
 * 거리 계산·가장 가까운 사람 고르기·만료·위치 삭제·확정·개인정보(좌표가 어디에도 새지 않음)를 본다.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Result } from '../../../shared/lounge/types.js';
import type { QuickState } from '../../../shared/lounge/view.js';
import { haversineM, roundUpDistance } from '../domain/quickMatch.js';
import type { LoungeUser } from '../users.js';

vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

type Db = typeof import('../../db.js');
let tmpDir = '';
let db: Db;
let quick: typeof import('./quick.js');
let users: typeof import('../users.js');

beforeAll(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sangsang-instant-'));
  process.env.DATA_DIR = tmpDir;
  delete process.env.DATABASE_URL;
  db = await import('../../db.js');
  await db.ready();
  users = await import('../users.js');
  quick = await import('./quick.js');
});

afterAll(() => {
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // Windows 에서 PGlite 파일이 잡혀 있으면 지우지 못한다 — 임시 폴더라 상관없다.
  }
});

beforeEach(async () => {
  for (const t of ['lounge_messages', 'lounge_gatherings', 'lounge_quick_requests', 'lounge_quick_rooms', 'lounge_blocks']) {
    await db.run(`DELETE FROM ${t}`);
  }
});

// ───────────── 도우미 ─────────────

function must<T>(r: Result<T>): T {
  if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
  return r.value;
}
const codeOf = <T>(r: Result<T>) => (r.ok ? 'OK' : r.error.code);

let seq = 0;
async function makeUser(banned = false): Promise<LoungeUser> {
  seq += 1;
  const id = await db.insert(
    `INSERT INTO users (email, name, password_hash, nickname, college, department, admission_year, avatar, avatar_color, profile_done, banned)
     VALUES (?, ?, 'x', ?, 'IT공과대학', '컴퓨터공학부', 2022, 'turtle-smile', 'm1', TRUE, ?) RETURNING id`,
    [`instant${seq}-${Date.now()}@hansung.ac.kr`, `실명${seq}`, `닉${seq}`, banned],
  );
  return (await users.findUser(id)) as LoungeUser;
}

/** 한성대 근처 기준점에서 북쪽으로 meters 만큼 떨어진 좌표 (위도 1도 ≈ 111,195m) */
const BASE = { lat: 37.5826, lng: 127.0107 };
const north = (meters: number) => ({ lat: BASE.lat + meters / 111_195, lng: BASE.lng });
const south = (meters: number) => north(-meters);
const east = (meters: number) => ({ lat: BASE.lat, lng: BASE.lng + meters / (111_195 * Math.cos((BASE.lat * Math.PI) / 180)) });

const go = (u: LoungeUser, loc: { lat: number; lng: number }, now?: string): Promise<Result<QuickState>> =>
  quick.requestQuickMatch(u, loc, now);

const rows = () =>
  db.all<{ user_id: number; status: string; data: Record<string, unknown> }>(
    'SELECT user_id, status, data FROM lounge_quick_requests ORDER BY user_id',
  );

// ───────────── 거리 ─────────────

describe('거리 계산', () => {
  it('하버사인은 300m 를 300m 근처로 계산하고, 표시 거리는 50m 단위로 올린다', () => {
    const d = haversineM(BASE, north(300));
    expect(d).toBeGreaterThan(299);
    expect(d).toBeLessThan(301);
    expect(roundUpDistance(d)).toBe(300);
    expect(roundUpDistance(301)).toBe(350);
    expect(roundUpDistance(3)).toBe(50);
  });
});

// ───────────── 신청 검증 ─────────────

describe('즉시 신청 검증', () => {
  it('위도·경도가 숫자가 아니거나 범위를 벗어나면 INVALID 이고, 오류 문장에 좌표가 없다', async () => {
    const u = await makeUser();
    for (const bad of [{ lat: 91, lng: 0 }, { lat: 0, lng: 181 }, { lat: '37.5', lng: 127 }, { lat: 37.5 }, { lat: NaN, lng: 1 }]) {
      const r = await quick.requestQuickMatch(u, bad);
      expect(codeOf(r)).toBe('INVALID');
      if (!r.ok) expect(r.error.message).not.toMatch(/9[01]|181|37\.5/);
    }
    expect(await rows()).toHaveLength(0);
  });
});

// ───────────── 매칭 ─────────────

describe('가까우면 즉시 방, 멀면 대기', () => {
  it('300m 떨어진 두 명은 바로 방이 생기고, 5km 떨어진 사람은 대기한다', async () => {
    const [a, b, far] = [await makeUser(), await makeUser(), await makeUser()];

    const first = must(await go(a, BASE));
    expect(first.request?.status).toBe('waiting');
    expect(first.room).toBeNull();

    const farState = must(await go(far, north(5000)));
    expect(farState.room).toBeNull();
    expect(farState.request?.status).toBe('waiting');
    expect(farState.waitingCount).toBe(0); // 반경 안에 다른 대기자가 없다

    const second = must(await go(b, north(300)));
    expect(second.request?.status).toBe('matched');
    expect(second.room).toMatchObject({ instant: true, distanceM: 300, status: 'pending', size: 2, bands: [] });
    expect([...(second.room?.memberIds ?? [])].sort()).toEqual([a.id, b.id].sort());
    expect(Date.parse(second.room!.expiresAt) - Date.parse(second.room!.createdAt)).toBe(5 * 60_000);

    // 먼저 기다린 사람에게도 같은 방이 보인다. 멀리 있는 사람은 그대로 대기.
    expect((await quick.quickState(a.id)).room?.id).toBe(second.room?.id);
    expect((await quick.quickState(far.id)).request?.status).toBe('waiting');
  });

  it('여러 명이 기다리면 가장 가까운 한 명과 짝이 된다', async () => {
    const [near, mid, out, me] = [await makeUser(), await makeUser(), await makeUser(), await makeUser()];
    // 기다리는 세 명은 서로 1.5km 넘게 떨어져 있어 자기들끼리는 짝이 되지 않는다
    must(await go(mid, south(1400)));
    must(await go(near, north(1000)));
    must(await go(out, east(1600))); // 내 위치(BASE)에서 1600m — 반경 밖
    expect((await quick.quickState(mid.id)).room).toBeNull();
    const s = must(await go(me, BASE));
    expect(s.room?.memberIds.sort()).toEqual([me.id, near.id].sort());
    expect(s.room?.distanceM).toBe(1000);
    expect(s.waitingCount).toBe(0); // 짝이 된 뒤라 내 대기가 아니다
    // 선점 안 된 사람은 그대로 대기
    expect((await quick.quickState(mid.id)).request?.status).toBe('waiting');
  });

  it('서로 차단한 사람과는 가까워도 짝이 되지 않고, 정지 사용자도 제외된다', async () => {
    const [a, b, banned, c] = [await makeUser(), await makeUser(), await makeUser(), await makeUser()];
    await db.run('INSERT INTO lounge_blocks (blocker_id, blocked_id) VALUES (?, ?)', [Number(a.id), Number(b.id)]);
    must(await go(banned, north(100)));
    await db.run('UPDATE users SET banned = TRUE WHERE id = ?', [Number(banned.id)]);
    expect((await go(a, BASE).then(must)).room).toBeNull(); // 정지된 사람이 가장 가까워도 짝이 되지 않는다
    const s = must(await go(b, north(50)));
    expect(s.room).toBeNull(); // a 는 차단, banned 는 정지
    const t = must(await go(c, north(50)));
    // c 는 먼저 생긴 무리(a)에 들어가 짝이 된다 — b 는 a 와 차단 관계라 a 의 무리에 못 들어가 혼자 기다린다
    expect(t.room?.memberIds.sort()).toEqual([a.id, c.id].sort());
    expect((await quick.quickState(b.id)).request?.status).toBe('waiting');
  });
});

// ───────────── 만료 ─────────────

describe('대기 만료', () => {
  it('QUICK_WAIT_MIN(10분) 안에 짝이 없으면 expired 가 되고 위치가 지워지며, 다시 신청할 수 있다', async () => {
    const a = await makeUser();
    const t0 = new Date().toISOString();
    must(await go(a, BASE, t0));
    expect(JSON.stringify((await rows())[0].data)).toContain('loc');

    const at9 = new Date(Date.parse(t0) + 9 * 60_000).toISOString();
    expect((await quick.quickState(a.id, at9)).request?.status).toBe('waiting');

    const at10 = new Date(Date.parse(t0) + 10 * 60_000).toISOString();
    const expired = await quick.quickState(a.id, at10);
    expect(expired.request?.status).toBe('expired');
    expect(expired.waitingCount).toBe(0);
    const row = (await rows())[0];
    expect(row.status).toBe('expired');
    expect(row.data).not.toHaveProperty('loc');

    // 만료된 표는 새 신청을 막지 않는다
    const again = must(await go(a, BASE, at10));
    expect(again.request?.status).toBe('waiting');
    expect((await rows()).filter((r) => r.status === 'expired')).toHaveLength(0);
  });
});

// ───────────── 확정 ─────────────

describe('수락 → 밥약 확정', () => {
  it('시간 투표는 막히고, 둘 다 수락하면 지금+20분 약속의 "바로 밥약"이 생기며 단톡방이 열린다', async () => {
    const [a, b] = [await makeUser(), await makeUser()];
    must(await go(a, BASE));
    const room = must(await go(b, north(120))).room!;

    expect(codeOf(await quick.voteBands(a.id, room.id, ['b12']))).toBe('INVALID');

    const one = must(await quick.answerRoom(a.id, room.id, 'accepted'));
    expect(one.room?.status).toBe('pending');
    const before = Date.now();
    const done = must(await quick.answerRoom(b.id, room.id, 'accepted'));
    expect(done.room?.status).toBe('confirmed');
    expect(done.gatheringId).toBeTruthy();

    const g = (await db.all<{ data: { title: string; place: string; meetAt: string; slots: { capacity: number; memberIds: string[] }[]; kind: string } }>(
      'SELECT data FROM lounge_gatherings WHERE id = ?',
      [done.gatheringId],
    ))[0].data;
    expect(g).toMatchObject({ kind: 'meal', title: '바로 밥약', place: '학식(만나서 정해요)' });
    expect(g.slots[0].capacity).toBe(2);
    expect(g.slots[0].memberIds.sort()).toEqual([a.id, b.id].sort());
    const meetMs = Date.parse(g.meetAt);
    expect(meetMs).toBeGreaterThan(before + 19 * 60_000);
    expect(meetMs).toBeLessThan(Date.now() + 21 * 60_000);
    const chat = await db.all('SELECT 1 FROM lounge_messages WHERE room_id = ?', [done.gatheringId]);
    expect(chat.length).toBeGreaterThan(0);
  });

  it('거절하면 거절한 사람은 취소, 상대는 expired(위치 없음)로 닫힌다', async () => {
    const [a, b] = [await makeUser(), await makeUser()];
    must(await go(a, BASE));
    const room = must(await go(b, north(120))).room!;
    must(await quick.answerRoom(a.id, room.id, 'declined'));
    expect((await quick.quickState(b.id)).request?.status).toBe('expired');
    expect((await quick.quickState(a.id)).request).toBeNull();
    for (const r of await rows()) expect(r.data).not.toHaveProperty('loc');
  });

  it('수락 제한 5분이 지나면 방이 깨지고 둘 다 expired 가 된다', async () => {
    const [a, b] = [await makeUser(), await makeUser()];
    must(await go(a, BASE));
    const room = must(await go(b, north(120))).room!;
    const later = new Date(Date.parse(room.createdAt) + 5 * 60_000).toISOString();
    const s = await quick.quickState(a.id, later);
    expect(s.room).toBeNull();
    expect(s.request?.status).toBe('expired');
  });
});

// ───────────── 위치 개인정보 ─────────────

describe('위치 개인정보', () => {
  it('좌표는 matched·cancelled 가 되는 순간 지워지고, 로그·응답 어디에도 나오지 않는다', async () => {
    const [a, b, c] = [await makeUser(), await makeUser(), await makeUser()];
    const logged: string[] = [];
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((k) =>
      vi.spyOn(console, k).mockImplementation((...args: unknown[]) => void logged.push(args.map(String).join(' '))),
    );
    const secrets = ['37.58', '127.01']; // 위도·경도의 앞부분 — 응답/로그 문자열에 있으면 안 된다
    const seen: string[] = [];
    try {
      const sa = must(await go(a, { lat: 37.58261234, lng: 127.01071234 }));
      seen.push(JSON.stringify(sa));
      // 대기 중에는 DB 에만 있다
      expect((await rows())[0].data).toHaveProperty('loc');

      const sb = must(await go(b, { lat: 37.58361234, lng: 127.01071234 }));
      seen.push(JSON.stringify(sb), JSON.stringify(await quick.quickState(a.id)));
      // 선점된 두 표 모두 위치가 사라졌다
      for (const r of await rows()) expect(r.data).not.toHaveProperty('loc');

      // 취소 경로: c 는 따로 대기하다 취소
      must(await go(c, { lat: 36, lng: 126 }));
      expect((await rows()).find((r) => r.user_id === Number(c.id))?.data).toHaveProperty('loc');
      seen.push(JSON.stringify(must(await quick.cancelQuickMatch(c.id))));
      for (const r of await rows()) expect(r.data).not.toHaveProperty('loc');
    } finally {
      spies.forEach((s) => s.mockRestore());
    }
    for (const text of [...seen, ...logged]) for (const secret of secrets) expect(text).not.toContain(secret);
    expect(logged.join('\n')).not.toMatch(/\b3[67]\.\d{3,}|\b12[67]\.\d{3,}/);
  });
});

// ───────────── 인원 고르기 (2~4명) ─────────────

describe('인원을 고른 즉시 매칭', () => {
  const goSize = (u: LoungeUser, loc: { lat: number; lng: number }, size: number) =>
    quick.requestQuickMatch(u, { ...loc, size });

  it('인원은 2~4 정수만 받고, 없으면 2명이다', async () => {
    const a = await makeUser();
    for (const size of [1, 5, 2.5, '3']) {
      const r = await quick.requestQuickMatch(a, { ...BASE, size });
      expect(r.ok).toBe(false);
    }
    expect(must(await go(a, BASE)).request?.size).toBe(2);
  });

  it('3명을 고르면 3명을 고른 사람끼리만 모이고, 모이는 동안 누가 모였는지 보인다', async () => {
    const [a, b, c, d] = [await makeUser(), await makeUser(), await makeUser(), await makeUser()];

    const sa = must(await goSize(a, BASE, 3));
    expect(sa.room).toBeNull();
    expect(sa.forming.map((u) => u.id)).toEqual([a.id]);

    const sb = must(await goSize(b, north(100), 3));
    expect(sb.room).toBeNull(); // 아직 2명
    expect(sb.forming.map((u) => u.id)).toEqual([a.id, b.id]);
    expect((await quick.quickState(a.id)).forming.map((u) => u.id)).toEqual([a.id, b.id]);

    // 2명을 고른 사람은 3명 무리에 끼지 않는다
    const sc = must(await goSize(c, north(50), 2));
    expect(sc.room).toBeNull();
    expect(sc.forming.map((u) => u.id)).toEqual([c.id]);
    expect((await quick.quickState(a.id)).forming).toHaveLength(2);

    // 세 번째 사람이 오면 바로 3명짜리 후보 방
    const sd = must(await goSize(d, north(150), 3));
    expect(sd.room?.memberIds.sort()).toEqual([a.id, b.id, d.id].sort());
    expect(sd.room?.size).toBe(3);
    expect(sd.members).toHaveLength(3);
    expect(sd.forming).toEqual([]);
    expect((await quick.quickState(c.id)).request?.status).toBe('waiting');
  });

  it('3명 방은 셋 다 수락해야 확정되고, 정원 3명짜리 밥약이 생긴다', async () => {
    const [a, b, d] = [await makeUser(), await makeUser(), await makeUser()];
    must(await goSize(a, BASE, 3));
    must(await goSize(b, north(100), 3));
    const room = must(await goSize(d, north(150), 3)).room!;

    expect(must(await quick.answerRoom(a.id, room.id, 'accepted')).gatheringId).toBeNull();
    expect(must(await quick.answerRoom(b.id, room.id, 'accepted')).gatheringId).toBeNull();
    const done = must(await quick.answerRoom(d.id, room.id, 'accepted'));
    expect(done.gatheringId).not.toBeNull();
    expect(done.room?.status).toBe('confirmed');
  });

  it('밥약 매칭에서는 모인 사람과 방 멤버의 실명이 보인다', async () => {
    const [a, b] = [await makeUser(), await makeUser()];
    must(await goSize(a, BASE, 3));
    const sb = must(await goSize(b, north(100), 3));
    expect(sb.forming.map((u) => u.name)).toEqual([a.name, b.name]);
    const room = must(await quick.startQuickNow(b.id));
    expect(room.members.map((u) => u.name).sort()).toEqual([a.name, b.name].sort());
  });

  it('3명을 찾다가 한 명 이상 모이면 지금 인원으로 바로 시작하고, 둘 다 수락하면 2명 밥약이 된다', async () => {
    const [a, b, c] = [await makeUser(), await makeUser(), await makeUser()];
    must(await goSize(a, BASE, 3));
    // 혼자일 때는 바로 시작할 수 없다
    const alone = await quick.startQuickNow(a.id);
    expect(alone.ok).toBe(false);

    must(await goSize(b, north(100), 3));
    const started = must(await quick.startQuickNow(a.id));
    expect(started.room?.memberIds.sort()).toEqual([a.id, b.id].sort());
    expect(started.room?.size).toBe(2);
    expect(started.room?.status).toBe('pending');

    // 이미 방이 생긴 뒤에 온 3명 희망자는 그 방에 끼지 않는다
    const sc = must(await goSize(c, north(50), 3));
    expect(sc.room).toBeNull();
    expect(sc.forming.map((u) => u.id)).toEqual([c.id]);

    must(await quick.answerRoom(a.id, started.room!.id, 'accepted'));
    const done = must(await quick.answerRoom(b.id, started.room!.id, 'accepted'));
    expect(done.gatheringId).not.toBeNull();
  });

  it('찾는 중이 아니면 바로 시작할 수 없다', async () => {
    const a = await makeUser();
    expect((await quick.startQuickNow(a.id)).ok).toBe(false);
  });

  it('모이던 중 한 명이 그만두면 남은 사람의 무리에서 빠진다', async () => {
    const [a, b] = [await makeUser(), await makeUser()];
    must(await goSize(a, BASE, 3));
    must(await goSize(b, north(100), 3));
    must(await quick.cancelQuickMatch(b.id));
    expect((await quick.quickState(a.id)).forming.map((u) => u.id)).toEqual([a.id]);
  });
});
