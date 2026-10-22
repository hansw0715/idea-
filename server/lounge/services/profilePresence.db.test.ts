/**
 * 프로필·접속자 DB 통합 테스트 — 임시 PGlite DB 에서 실제 SQL 을 돌린다.
 * 개발 서버(3101)의 DB 와 절대 겹치지 않는다: DATABASE_URL 을 지우고 DATA_DIR 을 임시 폴더로 바꾼 뒤에만 DB 를 연다.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// db.ts 의 쿼리 헬퍼를 감싸서 "쿼리가 몇 번 나갔는지" 센다 (실제 호출은 그대로 한다).
const counter = vi.hoisted(() => ({ calls: [] as string[] }));
vi.mock('../../db.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../db.js')>();
  return {
    ...actual,
    all: (sql: string, params?: unknown[]) => {
      counter.calls.push(sql);
      return actual.all(sql, params);
    },
    get: (sql: string, params?: unknown[]) => {
      counter.calls.push(sql);
      return actual.get(sql, params);
    },
    run: (sql: string, params?: unknown[]) => {
      counter.calls.push(sql);
      return actual.run(sql, params);
    },
  };
});

import { all, get, ready, run } from '../../db.js';
import { findUser } from '../users.js';
import type { LoungeUser } from '../users.js';
import { getPublicUserFor, toMeResponse, updateProfile } from './profile.js';
import { maskName } from './schoolProfile.js';
import { PRESENCE_LIMIT, readPresence, writePresence } from './presence.js';
import { hiddenFor } from './safety.js';

let tmp: string;

beforeAll(async () => {
  // 원격 DB 로 새지 않게: 환경에 DATABASE_URL 이 있어도 지우고 임시 PGlite 만 쓴다.
  delete process.env.DATABASE_URL;
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 's2-profile-presence-'));
  process.env.DATA_DIR = tmp;
  process.env.ADMIN_PASSWORD = 'test-admin-password';
  await ready();
}, 120_000);

afterAll(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

let seq = 0;
type NewUser = { profile?: boolean; banned?: boolean; temperature?: number; warnings?: number; isAdmin?: boolean };

/** 이메일 인증 없이 users 에 바로 넣는다 (가입 API 는 메일 코드가 필요하다) */
async function addUser(opts: NewUser = {}): Promise<LoungeUser> {
  seq += 1;
  const profile = opts.profile ?? true;
  const row = await get<{ id: number }>(
    `INSERT INTO users (email, name, password_hash, is_admin, nickname, college, department, admission_year,
                        avatar, avatar_color, temperature, warnings, banned, profile_done)
     VALUES (?, ?, 'x', ?, ?, ?, ?, ?, 'cat-think', 'm2', ?, ?, ?, ?) RETURNING id`,
    [
      `t${seq}@hansung.ac.kr`,
      `실명${seq}`,
      opts.isAdmin ?? false,
      profile ? `닉${seq}` : null,
      profile ? 'IT공과대학' : null,
      profile ? `학과${seq}` : null,
      profile ? 2024 : null,
      opts.temperature ?? 36.5,
      opts.warnings ?? 0,
      opts.banned ?? false,
      profile,
    ],
  );
  const u = await findUser(row!.id);
  if (!u) throw new Error('사용자를 만들지 못했습니다.');
  return u;
}

const block = (blocker: LoungeUser, blocked: LoungeUser) =>
  run('INSERT INTO lounge_blocks (blocker_id, blocked_id) VALUES (?, ?) ON CONFLICT DO NOTHING', [blocker.id, blocked.id]);

const NOW = new Date('2026-10-08T05:00:00Z');
const at = (sec: number) => new Date(NOW.getTime() + sec * 1000);
const pos = { x: 0.4, y: 0.6, zone: 'plaza' };

/** 학교 연동이 있는 것으로 만든다 (users.school_* 를 직접 채움) */
const linkSchool = (id: string, department = '컴퓨터공학부', year: number | null = 2024) =>
  run(
    "UPDATE users SET school_cipher = 'x', school_hint = '***', school_student_hash = ?, school_department = ?, school_admission_year = ? WHERE id = ?",
    [`hash-${id}`, department, year, Number(id)],
  );

describe('프로필 고치기 (PUT /me) — 아바타 색만', () => {
  it('학교 연동이 없으면 INVALID, 아무것도 저장하지 않는다', async () => {
    const u = await addUser({ profile: false });
    expect(toMeResponse(u)).toEqual({ profile: null, needsProfile: true, isAdmin: false });
    const r = await updateProfile(u.id, { avatarColor: 'm5' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatchObject({ code: 'INVALID', message: '학교 계정을 연동하면 라운지를 쓸 수 있어요.' });
    expect((await findUser(u.id))!.profileDone).toBe(false);
  });

  it('연동이 있으면 색이 바뀌고 평판·계정 정보는 그대로다 (프로필이 없던 옛 계정은 함께 만들어진다)', async () => {
    const u = await addUser({ profile: false, temperature: 31.2, warnings: 1, banned: true });
    await linkSchool(u.id, '컴퓨터공학부', 2022);
    const before = await get<Record<string, unknown>>('SELECT * FROM users WHERE id = ?', [u.id]);

    const saved = await updateProfile(u.id, { avatarColor: 'm5', temperature: 99, warnings: 0, banned: false, isAdmin: true });
    expect(saved.ok).toBe(true);
    if (saved.ok) {
      expect(saved.value).toMatchObject({ avatarColor: 'm5', department: '컴퓨터공학부', admissionYear: 2022, temperature: 31.2, warnings: 1, banned: true });
      expect(saved.value.nickname).toBe(maskName(u.name)); // '실명12' → '실○○2'
    }

    const after = await get<Record<string, unknown>>('SELECT * FROM users WHERE id = ?', [u.id]);
    for (const col of ['temperature', 'warnings', 'banned', 'is_admin', 'email', 'name', 'password_hash', 'created_at']) {
      expect(after![col], col).toEqual(before![col]);
    }
    expect(after!.avatar_color).toBe('m5');
    expect(after!.profile_done).toBe(true);
    expect(toMeResponse((await findUser(u.id))!).needsProfile).toBe(false);
  });

  it('이름·학과·학번을 보내면 INVALID 이고 DB 를 건드리지 않는다', async () => {
    const u = await addUser({ profile: false });
    await linkSchool(u.id);
    const bad = await updateProfile(u.id, { avatarColor: 'm2', nickname: '하늘' });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error.code).toBe('INVALID');
    expect((await findUser(u.id))!.profileDone).toBe(false);
  });

  it('없는 사용자 id 는 NOT_FOUND', async () => {
    const r = await updateProfile('2000000000', { avatarColor: 'm1' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('NOT_FOUND');
  });
});

describe('다른 사용자 카드 (GET /users/:id)', () => {
  it('프로필이 있는 사용자는 공개 필드(학과·입학년도 포함)만 보인다', async () => {
    const me = await addUser();
    const other = await addUser({ temperature: 40 });
    const r = await getPublicUserFor(me.id, other.id);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toEqual({
      id: other.id,
      nickname: other.nickname,
      college: 'IT공과대학',
      department: other.department, // 학교 계정에서 읽은 학과 — 상대에게 보인다
      admissionYear: 2024,
      gender: null,
      avatar: 'cat-think',
      avatarColor: 'm2',
      temperature: 40,
    });
    const json = JSON.stringify(r.value);
    expect(json).not.toContain(other.name); // 실명
    expect(json).not.toContain('hansung.ac.kr'); // 이메일
  });

  it('나 자신도 볼 수 있다', async () => {
    const me = await addUser();
    expect((await getPublicUserFor(me.id, me.id)).ok).toBe(true);
  });

  it('없는 사용자·프로필 미완성·이상한 id 는 모두 NOT_FOUND', async () => {
    const me = await addUser();
    const noProfile = await addUser({ profile: false });
    const ids = [noProfile.id, '999999', '0', '-1', 'abc', '1e3', '1.5', ' 1', '', '2147483648', '99999999999999999999', '007'];
    for (const id of ids) {
      const r = await getPublicUserFor(me.id, id);
      expect(r.ok, id).toBe(false);
      if (!r.ok) expect(r.error.code, id).toBe('NOT_FOUND');
    }
  });

  it('차단 관계는 어느 쪽이 걸었든 NOT_FOUND 이고 풀면 다시 보인다 (응답으로 차단 사실이 드러나지 않는다)', async () => {
    const a = await addUser();
    const b = await addUser();
    const c = await addUser();
    const missing = await getPublicUserFor(a.id, '999999');

    await block(a, b); // a 가 b 를 차단
    const aSeesB = await getPublicUserFor(a.id, b.id);
    const bSeesA = await getPublicUserFor(b.id, a.id);
    expect(aSeesB.ok).toBe(false);
    expect(bSeesA.ok).toBe(false);
    // 없는 사용자와 응답이 똑같다
    expect(aSeesB).toEqual(missing);
    expect(bSeesA).toEqual(missing);
    // 제 3자는 그대로 본다
    expect((await getPublicUserFor(c.id, a.id)).ok).toBe(true);
    expect((await getPublicUserFor(c.id, b.id)).ok).toBe(true);

    await run('DELETE FROM lounge_blocks WHERE blocker_id = ? AND blocked_id = ?', [a.id, b.id]);
    expect((await getPublicUserFor(a.id, b.id)).ok).toBe(true);
  });
});

describe('접속자 쓰기 (POST /presence)', () => {
  it('한 사용자 한 줄: 다시 쓰면 같은 줄이 갱신된다', async () => {
    const u = await addUser();
    expect((await writePresence(u, { x: 0.1, y: 0.2, zone: 'plaza' }, NOW)).ok).toBe(true);
    expect((await writePresence(u, { x: 0.8, y: 0.9, zone: 'meal' }, at(5))).ok).toBe(true);
    const rows = await all<{ x: number; y: number; zone: string; seen_at: Date }>(
      'SELECT x, y, zone, seen_at FROM lounge_presence WHERE user_id = ?',
      [u.id],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].zone).toBe('meal');
    expect(rows[0].x).toBeCloseTo(0.8, 5);
    expect(rows[0].y).toBeCloseTo(0.9, 5);
    expect(rows[0].seen_at.toISOString()).toBe(at(5).toISOString());
  });

  it('이용이 정지된 사용자는 BANNED 이고 아무것도 저장하지 않는다', async () => {
    const banned = await addUser({ banned: true, warnings: 2 });
    const r = await writePresence(banned, pos, NOW);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('BANNED');
      expect(r.error.message).toContain('정지');
    }
    const rows = await all('SELECT 1 FROM lounge_presence WHERE user_id = ?', [banned.id]);
    expect(rows).toHaveLength(0);
  });

  it('잘못된 본문은 INVALID 이고 저장하지 않는다 (정지 여부보다 먼저 본문을 본다)', async () => {
    const u = await addUser();
    const bad = await writePresence(u, { x: 2, y: 0, zone: 'plaza' }, NOW);
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error.code).toBe('INVALID');
    expect(await all('SELECT 1 FROM lounge_presence WHERE user_id = ?', [u.id])).toHaveLength(0);

    const banned = await addUser({ banned: true });
    const r = await writePresence(banned, { x: 2, y: 0, zone: 'plaza' }, NOW);
    if (!r.ok) expect(r.error.code).toBe('INVALID');
  });
});

describe('접속자 읽기 (GET /presence)', () => {
  it('서로 보이고, 나는 목록에서 빠지며, count 는 나를 포함한다', async () => {
    const a = await addUser();
    const b = await addUser();
    await writePresence(a, { x: 0.1, y: 0.2, zone: 'plaza' }, NOW);
    await writePresence(b, { x: 0.3, y: 0.4, zone: 'meetup' }, NOW);

    const forA = await readPresence(a, at(1));
    const mine = forA.users.find((p) => p.user.id === a.id);
    expect(mine).toBeUndefined();
    const seenB = forA.users.find((p) => p.user.id === b.id);
    expect(seenB).toMatchObject({ zone: 'meetup', emote: null });
    expect(seenB!.x).toBeCloseTo(0.3, 5);
    expect(seenB!.user.nickname).toBe(b.nickname);
    expect(seenB!.seenAt).toBe(NOW.toISOString());
    expect(forA.count).toBe(forA.users.length + 1);
    expect(forA.serverNow).toBe(at(1).toISOString());

    const forB = await readPresence(b, at(1));
    expect(forB.users.some((p) => p.user.id === a.id)).toBe(true);
    expect(forB.users.some((p) => p.user.id === b.id)).toBe(false);
  });

  it('응답에 실명·이메일·경고가 들어가지 않는다 (학과는 공개 사실)', async () => {
    const a = await addUser();
    const b = await addUser({ warnings: 1 });
    await writePresence(b, pos, NOW);
    const res = await readPresence(a, at(1));
    const text = JSON.stringify(res);
    expect(text).not.toContain(b.name);
    expect(text).not.toContain('hansung.ac.kr');
    expect(text).toContain(b.department);
    expect(text).not.toContain('warnings');
    expect(text).not.toContain('banned');
  });

  it('TTL(45초)이 지난 사람은 사라진다 — 경계는 포함하지 않는다', async () => {
    const viewer = await addUser();
    const fresh = await addUser();
    const stale = await addUser();
    await writePresence(fresh, pos, at(-44));
    await writePresence(stale, pos, at(-46));
    const ids = (await readPresence(viewer, NOW)).users.map((p) => p.user.id);
    expect(ids).toContain(fresh.id);
    expect(ids).not.toContain(stale.id);
  });

  it('프로필 없는 사용자는 행이 있어도 보이지 않는다', async () => {
    const viewer = await addUser();
    const ghost = await addUser({ profile: false });
    await run(`INSERT INTO lounge_presence (user_id, x, y, zone, seen_at) VALUES (?, 0.5, 0.5, 'plaza', ?::timestamptz)`, [
      ghost.id,
      NOW.toISOString(),
    ]);
    const ids = (await readPresence(viewer, at(1))).users.map((p) => p.user.id);
    expect(ids).not.toContain(ghost.id);
  });

  it('차단 관계는 서로 보이지 않는다 (내가 걸었든 상대가 걸었든), 제 3자에겐 보인다', async () => {
    const a = await addUser();
    const b = await addUser();
    const c = await addUser();
    const d = await addUser();
    for (const u of [a, b, c, d]) await writePresence(u, pos, NOW);

    await block(a, b); // a → b
    await block(c, a); // c → a

    const ids = async (u: LoungeUser) => (await readPresence(u, at(1))).users.map((p) => p.user.id);
    const forA = await ids(a);
    expect(forA).not.toContain(b.id); // 내가 걸었다
    expect(forA).not.toContain(c.id); // 상대가 걸었다
    expect(forA).toContain(d.id);

    const forB = await ids(b);
    expect(forB).not.toContain(a.id);
    expect(forB).toContain(c.id);

    const forC = await ids(c);
    expect(forC).not.toContain(a.id);

    const forD = await ids(d);
    for (const x of [a, b, c]) expect(forD).toContain(x.id);

    // S1 의 hiddenFor 와 같은 결과를 쓰고 있는지 (차단 규칙을 두 번 구현하지 않았다)
    const hidden = await hiddenFor(a.id);
    expect([...hidden].sort()).toEqual([b.id, c.id].sort());
  });

  it('이모트는 보낸 지 5초 안에서만 보인다', async () => {
    const viewer = await addUser();
    const sender = await addUser();
    await writePresence(sender, { ...pos, emote: 'wave' }, NOW);

    const emoteOf = async (t: Date) => (await readPresence(viewer, t)).users.find((p) => p.user.id === sender.id)?.emote;
    expect(await emoteOf(at(0))).toBe('wave');
    expect(await emoteOf(at(5))).toBe('wave'); // 경계 포함
    expect(await emoteOf(at(5.001))).toBeNull();

    // 하트비트(이모트 없음)는 이전 이모트를 지우지 않지만, 시각은 그대로라 계속 감춰진다
    await writePresence(sender, pos, at(10));
    expect(await emoteOf(at(11))).toBeNull();
    const stored = await get<{ emote: string; emote_at: Date }>('SELECT emote, emote_at FROM lounge_presence WHERE user_id = ?', [sender.id]);
    expect(stored?.emote).toBe('wave');
    expect(stored?.emote_at.toISOString()).toBe(NOW.toISOString());

    // 새 이모트는 시각이 갱신된다 (같은 이모트를 또 눌러도 다시 보인다)
    await writePresence(sender, { ...pos, emote: 'wave' }, at(20));
    expect(await emoteOf(at(21))).toBe('wave');
    await writePresence(sender, { ...pos, emote: 'heart' }, at(30));
    expect(await emoteOf(at(31))).toBe('heart');
  });

  it('쿼리는 2개 이내다 (차단 목록 + 접속자·프로필 조인), 청소가 붙어도 늘지 않는다', async () => {
    const a = await addUser();
    const b = await addUser();
    await writePresence(a, pos, NOW);
    await writePresence(b, pos, NOW);

    for (const purge of [false, true, undefined]) {
      counter.calls.length = 0;
      await readPresence(a, at(1), { purge });
      // 차단 목록 1 + 접속자·프로필 조인 1 (청소는 같은 문장 안의 CTE 라서 따로 세지 않는다)
      expect(counter.calls.length, `purge=${String(purge)}`).toBe(2);
    }
    // 쓰기는 쿼리 한 번 (upsert)
    counter.calls.length = 0;
    await writePresence(a, pos, at(2));
    expect(counter.calls.length).toBe(1);
  });

  it('오래된 행(10분 초과)은 청소 때 지워진다 — 청소가 아닐 때는 남아 있다', async () => {
    const viewer = await addUser();
    const old = await addUser();
    const recent = await addUser();
    await writePresence(old, pos, at(-11 * 60));
    await writePresence(recent, pos, at(-9 * 60)); // TTL 은 지났지만 청소 기준(10분)은 아직 안 됨

    const exists = async (u: LoungeUser) => (await all('SELECT 1 FROM lounge_presence WHERE user_id = ?', [u.id])).length;

    await readPresence(viewer, NOW, { purge: false });
    expect(await exists(old)).toBe(1);

    const res = await readPresence(viewer, NOW, { purge: true });
    expect(await exists(old)).toBe(0);
    expect(await exists(recent)).toBe(1);
    // 청소가 응답 내용을 바꾸지는 않는다
    expect(res.users.map((p) => p.user.id)).not.toContain(old.id);
    expect(res.users.map((p) => p.user.id)).not.toContain(recent.id);
  });

  it('최대 200명까지만 내려보내고, 차단한 사람은 한도에서 빠진다', async () => {
    const viewer = await addUser();
    const blockedOne = await addUser();
    await run(
      `INSERT INTO users (email, name, password_hash, nickname, college, department, admission_year, profile_done)
       SELECT 'bulk' || g || '@hansung.ac.kr', 'bulk' || g, 'x', 'bulk' || g, 'IT공과대학', '학과', 2024, TRUE
         FROM generate_series(1, ?::int) g`,
      [PRESENCE_LIMIT + 10],
    );
    // 차단한 사람이 가장 최근에 접속했다: 한도를 먼저 자르고 나서 걸렀다면 199명만 나왔을 것이다
    await run(
      `INSERT INTO lounge_presence (user_id, x, y, zone, seen_at)
       SELECT id, 0.5, 0.5, 'plaza', ?::timestamptz - (id * interval '1 millisecond') FROM users WHERE email LIKE 'bulk%'`,
      [NOW.toISOString()],
    );
    await writePresence(blockedOne, pos, at(1));
    await block(viewer, blockedOne);

    const res = await readPresence(viewer, at(2));
    expect(res.users).toHaveLength(PRESENCE_LIMIT);
    expect(res.count).toBe(PRESENCE_LIMIT + 1);
    expect(res.users.map((p) => p.user.id)).not.toContain(blockedOne.id);
    // 최근 접속한 순서
    const seen = res.users.map((p) => p.seenAt);
    expect([...seen].sort().reverse()).toEqual(seen);

    await run(`DELETE FROM users WHERE email LIKE 'bulk%'`);
  });
});
