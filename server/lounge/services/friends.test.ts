/**
 * 라운지 친구(아이디로 요청 → 수락)와 밥약 "친구끼리만" 즉시 매칭 테스트 (PGlite 임시 DB).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Result } from '../../../shared/lounge/types.js';
import type { LoungeUser } from '../users.js';

vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

type Db = typeof import('../../db.js');
let tmpDir = '';
let db: Db;
let friends: typeof import('./friends.js');
let safety: typeof import('./safety.js');
let quick: typeof import('./quick.js');
let users: typeof import('../users.js');

beforeAll(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sangsang-friends-'));
  process.env.DATA_DIR = tmpDir;
  delete process.env.DATABASE_URL;
  db = await import('../../db.js');
  await db.ready();
  users = await import('../users.js');
  friends = await import('./friends.js');
  safety = await import('./safety.js');
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
  for (const t of ['lounge_friends', 'lounge_blocks', 'lounge_messages', 'lounge_gatherings', 'lounge_quick_requests', 'lounge_quick_rooms']) {
    await db.run(`DELETE FROM ${t}`);
  }
});

function must<T>(r: Result<T>): T {
  if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
  return r.value;
}
const codeOf = <T>(r: Result<T>) => (r.ok ? 'OK' : r.error.code);

let seq = 0;
async function makeUser(profileDone = true): Promise<LoungeUser & { username: string }> {
  seq += 1;
  const username = `friend_${seq}_${Date.now() % 100000}`;
  const id = await db.insert(
    `INSERT INTO users (email, username, name, password_hash, nickname, college, department, admission_year, avatar, avatar_color, profile_done)
     VALUES (?, ?, ?, 'x', ?, '', '컴퓨터공학부', 2022, 'turtle-smile', 'm1', ?) RETURNING id`,
    [`${username}@hansung.ac.kr`, username, `실명${seq}`, `닉${seq}`, profileDone],
  );
  return { ...((await users.findUser(id)) as LoungeUser), username };
}

const ids = (list: { id: string }[]) => list.map((u) => u.id).sort();

describe('친구 요청 · 수락', () => {
  it('아이디로 요청하면 상대에게 받은 요청으로, 수락하면 서로 친구가 된다', async () => {
    const [a, b] = [await makeUser(), await makeUser()];
    expect(must(await friends.requestFriend(a.id, b.username.toUpperCase()))).toBe('requested'); // 대소문자 무시

    expect(ids((await friends.myFriends(a.id)).outgoing)).toEqual([b.id]);
    expect(ids((await friends.myFriends(b.id)).incoming)).toEqual([a.id]);
    expect(codeOf(await friends.requestFriend(a.id, b.username))).toBe('ALREADY_JOINED'); // 같은 요청 두 번

    must(await friends.acceptFriend(b.id, a.id));
    const fa = await friends.myFriends(a.id);
    expect(ids(fa.friends)).toEqual([b.id]);
    expect(fa.outgoing).toHaveLength(0);
    expect(ids((await friends.myFriends(b.id)).friends)).toEqual([a.id]);
    expect(codeOf(await friends.requestFriend(b.id, a.username))).toBe('ALREADY_JOINED');
  });

  it('상대가 먼저 요청해 둔 상태에서 내가 요청하면 바로 친구가 된다', async () => {
    const [a, b] = [await makeUser(), await makeUser()];
    must(await friends.requestFriend(a.id, b.username));
    expect(must(await friends.requestFriend(b.id, a.username))).toBe('accepted');
    expect(ids((await friends.myFriends(a.id)).friends)).toEqual([b.id]);
  });

  it('없는 아이디 · 라운지 프로필이 없는 계정 · 나를 차단한 사람은 똑같이 찾을 수 없다', async () => {
    const [a, noProfile, blocker] = [await makeUser(), await makeUser(false), await makeUser()];
    must(await safety.blockUser(blocker.id, a.id));
    for (const name of ['nobody_here', noProfile.username, blocker.username]) {
      const r = await friends.requestFriend(a.id, name);
      expect(codeOf(r)).toBe('NOT_FOUND');
      if (!r.ok) expect(r.error.message).toContain('찾을 수 없어요');
    }
    expect(codeOf(await friends.requestFriend(a.id, a.username))).toBe('INVALID'); // 내 아이디
    expect(codeOf(await friends.requestFriend(a.id, "x'; DROP TABLE users;--"))).toBe('INVALID');
  });

  it('거절·취소·삭제는 관계를 지우고, 차단하면 친구도 끊긴다', async () => {
    const [a, b, c] = [await makeUser(), await makeUser(), await makeUser()];
    must(await friends.requestFriend(a.id, b.username));
    await friends.removeFriend(b.id, a.id); // 받은 쪽이 거절
    expect((await friends.myFriends(a.id)).outgoing).toHaveLength(0);
    expect(codeOf(await friends.acceptFriend(b.id, a.id))).toBe('NOT_FOUND');

    must(await friends.requestFriend(a.id, c.username));
    must(await friends.acceptFriend(c.id, a.id));
    must(await safety.blockUser(c.id, a.id));
    expect((await friends.myFriends(a.id)).friends).toHaveLength(0);
    expect((await friends.myFriends(c.id)).friends).toHaveLength(0);
  });
});

describe('친구 이름 · 밥 먹자 · 친구 시간표', () => {
  it('친구·받은 요청에는 실명, 보낸 요청에는 실명 대신 내가 적은 아이디가 보인다', async () => {
    const [a, b] = [await makeUser(), await makeUser()];
    must(await friends.requestFriend(a.id, b.username));
    expect((await friends.myFriends(b.id)).incoming[0].name).toBe(a.name); // 요청한 사람은 스스로 이름을 밝혔다
    const out = (await friends.myFriends(a.id)).outgoing[0];
    expect(out.username).toBe(b.username);
    expect(out).not.toHaveProperty('name'); // 아이디만 알아도 상대 실명이 새지 않게
    must(await friends.acceptFriend(b.id, a.id));
    expect((await friends.myFriends(b.id)).friends[0].name).toBe(a.name);
  });

  it('친구가 아니면 밥 먹자·시간표 보기가 안 된다', async () => {
    const [a, b] = [await makeUser(), await makeUser()];
    expect(codeOf(await friends.askMeal(a.id, b.id))).toBe('NOT_FOUND');
    expect(codeOf(await friends.friendTimetable(a.id, b.id, undefined))).toBe('NOT_FOUND');
  });

  it('친구의 그 주 시간표(매주 수업 + 그 주 하루 일정)만 보인다', async () => {
    const [a, b] = [await makeUser(), await makeUser()];
    must(await friends.requestFriend(a.id, b.username));
    must(await friends.acceptFriend(b.id, a.id));
    await db.run(
      `INSERT INTO timetable_entries (user_id, day, start_min, end_min, title, place, repeat_kind)
       VALUES (?, 0, 540, 660, '자료구조', '공학관', 'weekly')`,
      [Number(b.id)],
    );
    await db.run(
      `INSERT INTO timetable_entries (user_id, day, start_min, end_min, title, place, repeat_kind, date)
       VALUES (?, 2, 600, 660, '다른 주 일정', '', 'once', '2020-01-08')`,
      [Number(b.id)],
    );
    const r = must(await friends.friendTimetable(a.id, b.id, '2026-10-19'));
    expect(r.weekStart).toBe('2026-10-19');
    expect(r.entries.map((e) => e.title)).toEqual(['자료구조']);
    expect(must(await friends.askMeal(a.id, b.id))).toBe(true); // 알림 열쇠가 없으면 조용히 넘어간다
  });
});

describe('밥약 친구끼리만 찾기', () => {
  const HERE = { lat: 37.5826, lng: 127.0107 };
  const near = { lat: 37.5826 + 200 / 111_195, lng: 127.0107 };

  it('친구끼리만을 고르면 친구가 아닌 사람과는 짝이 되지 않고, 친구와는 짝이 된다', async () => {
    const [me, stranger, friend] = [await makeUser(), await makeUser(), await makeUser()];
    must(await friends.requestFriend(me.id, friend.username));
    must(await friends.acceptFriend(friend.id, me.id));

    const mine = must(await quick.requestQuickMatch(me, { ...HERE, friendsOnly: true }));
    expect(mine.request?.friendsOnly).toBe(true);
    expect(mine.request?.tags).toEqual([]); // 내부 표시는 태그로 새지 않는다

    const s1 = must(await quick.requestQuickMatch(stranger, near));
    expect(s1.room).toBeNull(); // 친구가 아니라 짝이 안 된다
    expect(s1.waitingCount).toBe(0); // 짝이 될 수 없는 사람은 대기 인원에도 세지 않는다

    const s2 = must(await quick.requestQuickMatch(friend, near));
    expect(s2.room?.memberIds.sort()).toEqual([me.id, friend.id].sort());
  });

  it('친구끼리만 값이 불린이 아니면 INVALID', async () => {
    const u = await makeUser();
    expect(codeOf(await quick.requestQuickMatch(u, { ...HERE, friendsOnly: 'yes' }))).toBe('INVALID');
  });
});
