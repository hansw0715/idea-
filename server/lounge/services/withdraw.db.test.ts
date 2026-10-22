/**
 * 회원 탈퇴 때의 라운지 정리 — 임시 PGlite DB 에서 실제 SQL 과 실제 `DELETE /api/auth/me` 를 돌린다.
 *
 * 고치는 문제 (재현 방법은 아래 테스트가 그대로다)
 *  1) 주최자가 탈퇴하면 lounge_gatherings.host_id 의 ON DELETE CASCADE 로 모임이 통째로 지워져,
 *     이미 자리가 찬 다른 참여자의 약속과 단톡방이 아무 안내 없이 사라졌다 (조회 200 → 404).
 *  2) 그 방의 메시지 행은 room_id 에 FK 가 없어 고아로 영구히 남았고, 탈퇴한 사용자가 쓴 메시지는 본문이 그대로 남았다.
 *
 * 안전: 환경의 DATABASE_URL 을 지우고 임시 폴더만 쓴다. 개발 서버(3101)와 그 DB 는 건드리지 않는다.
 */
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { all, get, insert, ready, run } from '../../db.js';
import { MEAL_PRESET, MEAL_SLOT, MEETUP_PRESETS } from '../../../shared/lounge/constants.js';
import type { CreateGatheringBody, Gathering } from '../../../shared/lounge/gathering.js';
import type { Result } from '../../../shared/lounge/types.js';
import { createApp } from '../../app.js';
import { findGathering } from '../repo/gatherings.js';
import { findUser } from '../users.js';
import type { LoungeUser } from '../users.js';
import { roomView, sendMessage } from './chat.js';
import { applyToGathering, approveApplicant, createGathering, getGatheringView, joinGathering as joinRaw, mineViews } from './gathering.js';
import { WITHDRAWN_MESSAGE_TEXT, pickHeir, releaseLoungeForWithdrawal } from './withdraw.js';

/** 미팅 자리는 위(host) = 남자, 아래(guest) = 여자만 앉는다. 이 파일은 탈퇴 규칙을 보므로 자리에 맞는 성별을 붙여 앉힌다 */
const joinGathering: typeof joinRaw = (user, id, slotKey) =>
  joinRaw({ ...user, gender: slotKey === 'host' ? 'male' : slotKey === 'guest' ? 'female' : user.gender }, id, slotKey);

let tmp: string;
let server: Server;
let base: string;

beforeAll(async () => {
  delete process.env.DATABASE_URL;
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'withdraw-'));
  process.env.DATA_DIR = tmp;
  process.env.JWT_SECRET = 'test-jwt-secret-for-withdraw';
  process.env.ADMIN_PASSWORD = 'test-admin-password';
  await ready();
  server = createApp().listen(0);
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}, 180_000);

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  try {
    fs.rmSync(tmp, { recursive: true, force: true });
  } catch {
    /* Windows 에서는 PGlite 가 파일을 쥐고 있을 수 있다 — 임시 폴더라 무시한다. */
  }
});

// ───────────── 도우미 ─────────────

const PASSWORD = 'Demo1234!';
const HASH = bcrypt.hashSync(PASSWORD, 4);
let seq = 0;

async function makeUser(over: { banned?: boolean; admin?: boolean } = {}): Promise<LoungeUser & { email: string }> {
  seq += 1;
  const email = `wd${seq}-${randomUUID().slice(0, 6)}@hansung.ac.kr`;
  const id = await insert(
    `INSERT INTO users (email, username, name, password_hash, nickname, college, department, admission_year,
                        avatar, avatar_color, profile_done, banned, is_admin, gender)
     VALUES (?, ?, ?, ?, ?, 'IT공과대학', ?, 2024, 'turtle-smile', 'm1', TRUE, ?, ?, 'male') RETURNING id`,
    [email, email.split('@')[0], `실명${seq}`, HASH, `닉${seq}`, `학과${seq}`, over.banned ?? false, over.admin ?? false],
  );
  const user = await findUser(id);
  if (!user) throw new Error('사용자 생성 실패');
  return { ...user, email };
}

const inHours = (h: number) => new Date(Date.now() + h * 3600_000).toISOString();

const meetupBody = (): CreateGatheringBody => ({
  kind: 'meetup',
  title: '금요일 저녁 2:2',
  body: '',
  place: '삼선교',
  meetAt: inHours(72),
  joinDeadline: inHours(48),
  joinPolicy: 'auto',
  slots: MEETUP_PRESETS['2:2'].slots,
});

const mealBody = (capacity = 3): CreateGatheringBody => ({
  kind: 'meal',
  title: '학식 같이',
  body: '',
  place: '상상관',
  meetAt: inHours(30),
  joinDeadline: inHours(24),
  joinPolicy: 'approval',
  slots: MEAL_PRESET(capacity).slots,
});

function must<T>(r: Result<T>): T {
  if (!r.ok) throw new Error(`실패: ${r.error.code} ${r.error.message}`);
  return r.value;
}

/** 2:2 미팅을 만들어 주최자(우리 쪽) + 세 명을 앉혀 정원을 채운다 (방이 열린다). */
async function fullMeetup(host: LoungeUser, mates: LoungeUser[]): Promise<Gathering> {
  const g = must(await createGathering(host, meetupBody()));
  const [first, ...rest] = mates;
  must(await joinGathering(first, g.id, 'host'));
  for (const m of rest) must(await joinGathering(m, g.id, 'guest'));
  return (await findGathering(g.id))!;
}

async function withdraw(user: LoungeUser) {
  const report = await releaseLoungeForWithdrawal(user.id);
  await run('DELETE FROM users WHERE id = ?', [Number(user.id)]);
  return report;
}

type HostRow = { host_id: number; doc_host: string; version: number };
const hostRow = (id: string) =>
  get<HostRow>(`SELECT host_id, data->>'hostId' AS doc_host, version FROM lounge_gatherings WHERE id = ?`, [id]);

const orphanMessages = async () =>
  (await get<{ n: number }>('SELECT COUNT(*)::int AS n FROM lounge_messages WHERE room_id NOT IN (SELECT id FROM lounge_gatherings)'))!.n;

// ───────────── 순수 규칙 ─────────────

describe('pickHeir — 누가 주최를 이어받는가', () => {
  const g = (...memberIds: string[][]) => ({
    slots: memberIds.map((ids, i) => ({ key: `s${i}`, label: 's', capacity: 4, memberIds: ids })),
  });
  const alive = (...ids: [string, boolean?][]) => new Map(ids.map(([id, banned]) => [id, { banned: banned ?? false }]));

  it('탈퇴자를 뺀 가장 먼저 앉은 사람 (자리 목록 순서, 자리 안에서는 앉은 순서)', () => {
    expect(pickHeir(g(['1', '2'], ['3']), '1', alive(['2'], ['3']))).toBe('2');
    expect(pickHeir(g(['1'], ['3', '2']), '1', alive(['2'], ['3']))).toBe('3');
  });
  it('이미 탈퇴한(없는) 사람은 건너뛴다', () => {
    expect(pickHeir(g(['1', '2', '3']), '1', alive(['3']))).toBe('3');
  });
  it('정지 안 된 후보가 있으면 정지된 사람보다 먼저 (정지 사용자는 승인·취소를 못 한다)', () => {
    expect(pickHeir(g(['1', '2', '3']), '1', alive(['2', true], ['3']))).toBe('3');
  });
  it('정지된 사람뿐이면 그래도 그 사람에게 (모임을 지우는 것보다 낫다)', () => {
    expect(pickHeir(g(['1', '2']), '1', alive(['2', true]))).toBe('2');
  });
  it('앉은 사람이 없으면 null (모임을 지운다)', () => {
    expect(pickHeir(g(['1']), '1', alive())).toBeNull();
    expect(pickHeir(g([]), '1', alive(['9']))).toBeNull();
  });
});

// ───────────── 실제 DB ─────────────

describe('주최자 탈퇴 — 다른 참여자가 있는 모임', () => {
  it('주최를 가장 먼저 앉은 사람에게 넘기고, 모임·단톡방·내 약속이 다른 참여자에게 그대로 보인다', async () => {
    const [host, a, b, c] = [await makeUser(), await makeUser(), await makeUser(), await makeUser()];
    const g = await fullMeetup(host, [a, b, c]);
    must(await sendMessage(a, g.id, '안녕하세요'));
    must(await sendMessage(host, g.id, '주최자가 쓴 말'));
    const before = (await hostRow(g.id))!;

    const report = await withdraw(host);
    expect(report).toMatchObject({ transferred: 1, deleted: 0, messagesBlanked: 1 });

    // 문서의 hostId 와 인덱스용 host_id 열이 같이 바뀌었다 (하나만 바뀌면 어긋난 모임이 보인다).
    const row = (await hostRow(g.id))!;
    expect(row.doc_host).toBe(a.id);
    expect(String(row.host_id)).toBe(a.id);
    expect(row.version).toBeGreaterThan(before.version);

    // 다른 참여자는 계속 볼 수 있다 (예전에는 200 → 404).
    const view = must(await getGatheringView(b, g.id));
    expect(view.host.id).toBe(a.id);
    expect(view.status).toBe('full');
    expect(view.roomOpen).toBe(true);
    // 3명 이상 모임은 그대로 둔다: 탈퇴자의 자리는 unknownUser 로 남는다 (계약 §3.4).
    const names = view.slots.flatMap((s) => s.members.map((m) => m.nickname));
    expect(names).toContain('(탈퇴한 사용자)');
    expect((await mineViews(c)).map((v) => v.id)).toContain(g.id);

    // 단톡방은 열려 있고, 대화는 남되 탈퇴자가 쓴 본문은 남지 않는다.
    const room = must(await roomView(b, g.id));
    const texts = room.messages.map((m) => `${m.kind}:${m.text}`);
    expect(texts).toContain('text:안녕하세요');
    expect(texts).toContain(`system:${WITHDRAWN_MESSAGE_TEXT}`);
    expect(texts.join('\n')).not.toContain('주최자가 쓴 말');
    expect(await orphanMessages()).toBe(0);
  });

  it('두 번 불러도 (이미 정리된 것은) 다시 건드리지 않는다', async () => {
    const [host, a, b, c] = [await makeUser(), await makeUser(), await makeUser(), await makeUser()];
    const g = await fullMeetup(host, [a, b, c]);
    expect(await releaseLoungeForWithdrawal(host.id)).toMatchObject({ transferred: 1 });
    const v1 = (await hostRow(g.id))!.version;
    expect(await releaseLoungeForWithdrawal(host.id)).toEqual({
      transferred: 0,
      deleted: 0,
      applicationsDropped: 0,
      messagesBlanked: 0,
    });
    expect((await hostRow(g.id))!.version).toBe(v1);
    await run('DELETE FROM users WHERE id = ?', [Number(host.id)]);
  });

  it('정지된 사람보다 정지 안 된 사람을 먼저 승계자로 고른다', async () => {
    const host = await makeUser();
    const banned = await makeUser();
    const fine = await makeUser();
    const g = must(await createGathering(host, mealBody(3)));
    // 밥약은 승인제 — 신청 → 승인으로 앉힌다. 정지는 앉은 뒤에 걸린 것으로 한다.
    must(await applyToGathering(banned, g.id, MEAL_SLOT, ''));
    must(await applyToGathering(fine, g.id, MEAL_SLOT, ''));
    must(await approveApplicant(host, g.id, banned.id));
    must(await approveApplicant(host, g.id, fine.id));
    await run('UPDATE users SET banned = TRUE WHERE id = ?', [Number(banned.id)]);

    expect(await withdraw(host)).toMatchObject({ transferred: 1 });
    expect((await hostRow(g.id))!.doc_host).toBe(fine.id);
  });
});

describe('주최자 탈퇴 — 혼자인 모임', () => {
  it('모임을 지우고 그 방의 메시지도 같이 지운다 (고아 메시지가 없다)', async () => {
    const host = await makeUser();
    const g = must(await createGathering(host, meetupBody()));
    // 방이 열리기 전이라도 메시지 행이 있을 수 있다 (예: 이전에 열렸다 비어진 방). room_id 에는 FK 가 없다.
    await run(`INSERT INTO lounge_messages (id, room_id, user_id, kind, text) VALUES (?, ?, ?, 'text', '남은 말')`, [
      randomUUID(),
      g.id,
      Number(host.id),
    ]);

    expect(await withdraw(host)).toMatchObject({ transferred: 0, deleted: 1 });
    expect(await findGathering(g.id)).toBeUndefined();
    expect((await get<{ n: number }>('SELECT COUNT(*)::int AS n FROM lounge_messages WHERE room_id = ?', [g.id]))!.n).toBe(0);
    expect(await orphanMessages()).toBe(0);
  });
});

describe('일반 참여자·신청자 탈퇴', () => {
  it('참여자가 탈퇴하면 모임은 그대로, 쓴 말은 본문이 지워지고 user_id 도 비워진다', async () => {
    const [host, a, b, c] = [await makeUser(), await makeUser(), await makeUser(), await makeUser()];
    const g = await fullMeetup(host, [a, b, c]);
    must(await sendMessage(b, g.id, 'b 의 비밀 이야기'));

    expect(await withdraw(b)).toMatchObject({ transferred: 0, deleted: 0, messagesBlanked: 1 });
    expect((await hostRow(g.id))!.doc_host).toBe(host.id);
    const room = must(await roomView(c, g.id));
    expect(room.messages.map((m) => m.text).join('\n')).not.toContain('b 의 비밀 이야기');
    const leftover = await all<{ text: string; user_id: number | null; kind: string }>(
      `SELECT text, user_id, kind FROM lounge_messages WHERE room_id = ? AND text LIKE '%비밀%'`,
      [g.id],
    );
    expect(leftover).toEqual([]);
    const blanked = await all<{ kind: string; user_id: number | null }>(
      'SELECT kind, user_id FROM lounge_messages WHERE room_id = ? AND text = ?',
      [g.id, WITHDRAWN_MESSAGE_TEXT],
    );
    expect(blanked).toEqual([{ kind: 'system', user_id: null }]);
  });

  it('승인 대기 중이던 신청은 지워져 주최자가 탈퇴한 사람을 승인하는 일이 없다', async () => {
    const host = await makeUser();
    const applicant = await makeUser();
    const g = must(await createGathering(host, mealBody(3)));
    must(await applyToGathering(applicant, g.id, MEAL_SLOT, '같이 가요'));
    expect((await findGathering(g.id))!.applicants.map((x) => x.userId)).toEqual([applicant.id]);

    expect(await withdraw(applicant)).toMatchObject({ applicationsDropped: 1 });
    expect((await findGathering(g.id))!.applicants).toEqual([]);
    const r = await approveApplicant(host, g.id, applicant.id);
    expect(r.ok).toBe(false);
  });
});

describe('탈퇴와 동시에 누군가 그 모임에 앉는 경쟁', () => {
  it('혼자였던 모임에 탈퇴와 동시에 앉으면, 앉은 사람이 주최를 잇거나 (앉기가 졌다면) 모임이 지워진다 — 어긋나는 일은 없다', async () => {
    for (let i = 0; i < 8; i++) {
      const host = await makeUser();
      const joiner = await makeUser();
      const g = must(await createGathering(host, meetupBody()));

      const [joined, report] = await Promise.all([
        joinGathering(joiner, g.id, 'guest'),
        releaseLoungeForWithdrawal(host.id),
      ]);
      await run('DELETE FROM users WHERE id = ?', [Number(host.id)]);

      const row = await hostRow(g.id);
      if (joined.ok) {
        // 앉기가 먼저 반영됐다 → 승계: 문서와 열이 같이 joiner 를 가리킨다.
        expect(report.transferred, `반복 ${i}`).toBe(1);
        expect(row?.doc_host, `반복 ${i}`).toBe(joiner.id);
        expect(String(row?.host_id), `반복 ${i}`).toBe(joiner.id);
      } else {
        // 탈퇴 정리가 먼저 모임을 지웠다 → 앉기는 없는 모임으로 실패.
        expect(joined.error.code, `반복 ${i}`).toBe('NOT_FOUND');
        expect(row, `반복 ${i}`).toBeUndefined();
      }
      expect(await orphanMessages()).toBe(0);
    }
  });
});

describe('DELETE /api/auth/me — 실제 요청으로', () => {
  async function login(u: { email: string }): Promise<string> {
    const res = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: u.email, password: PASSWORD }),
    });
    expect(res.status).toBe(200);
    return res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  }
  const call = async (method: string, p: string, cookie: string, body?: unknown) => {
    const res = await fetch(`${base}${p}`, {
      method,
      headers: { cookie, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    return { status: res.status, text, json: text ? (JSON.parse(text) as Record<string, any>) : null };
  };

  it('주최자가 탈퇴해도 다른 참여자의 모임 조회·내 약속·단톡방이 200 으로 남는다 (예전에는 404)', async () => {
    const [host, a, b, c] = [await makeUser(), await makeUser(), await makeUser(), await makeUser()];
    const g = await fullMeetup(host, [a, b, c]);
    must(await sendMessage(a, g.id, 'hello'));
    must(await sendMessage(host, g.id, '주최자 비밀'));
    const cookie = await login(host);
    const cookieB = await login(b);

    // 비밀번호가 틀리면 아무것도 건드리지 않는다.
    const wrong = await call('DELETE', '/api/auth/me', cookie, { password: 'nope-nope' });
    expect(wrong.status).toBe(401);
    expect((await hostRow(g.id))!.doc_host).toBe(host.id);

    const done = await call('DELETE', '/api/auth/me', cookie, { password: PASSWORD });
    expect(done.status).toBe(200);
    expect(await findUser(host.id)).toBeUndefined();

    const detail = await call('GET', `/api/lounge/gatherings/${g.id}`, cookieB);
    expect(detail.status).toBe(200);
    expect(detail.json?.gathering.host.id).toBe(a.id);
    const mine = await call('GET', '/api/lounge/mine', cookieB);
    expect(mine.status).toBe(200);
    expect((mine.json?.gatherings as { id: string }[]).map((x) => x.id)).toContain(g.id);
    const room = await call('GET', `/api/lounge/gatherings/${g.id}/messages`, cookieB);
    expect(room.status).toBe(200);
    expect(room.text).toContain('hello');
    expect(room.text).not.toContain('주최자 비밀');
    expect(await orphanMessages()).toBe(0);
  });

  it('혼자인 주최자가 탈퇴하면 모임과 메시지가 함께 사라진다', async () => {
    const host = await makeUser();
    const g = must(await createGathering(host, meetupBody()));
    const cookie = await login(host);
    expect((await call('DELETE', '/api/auth/me', cookie, { password: PASSWORD })).status).toBe(200);
    expect(await findGathering(g.id)).toBeUndefined();
    expect(await orphanMessages()).toBe(0);
  });

  it('라운지 정리가 끝내 실패하면 탈퇴를 취소한다 — 사용자 행이 그대로 남아 다시 시도할 수 있다', async () => {
    const host = await makeUser();
    // 문서가 망가진 모임(slots 없음)을 심어 정리가 예외로 끝나게 한다.
    const brokenId = randomUUID();
    await run(
      `INSERT INTO lounge_gatherings (id, kind, host_id, meet_at, status, data) VALUES (?, 'meetup', ?, now() + interval '3 days', 'open', ?::jsonb)`,
      [brokenId, Number(host.id), JSON.stringify({ id: brokenId, hostId: host.id })],
    );
    const cookie = await login(host);
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const r = await call('DELETE', '/api/auth/me', cookie, { password: PASSWORD });
    errorLog.mockRestore();
    expect(r.status).toBe(500);
    expect(await findUser(host.id)).toBeDefined();
    // 망가진 모임을 치우면 같은 요청이 이번에는 통과한다.
    await run('DELETE FROM lounge_gatherings WHERE id = ?', [brokenId]);
    expect((await call('DELETE', '/api/auth/me', cookie, { password: PASSWORD })).status).toBe(200);
    expect(await findUser(host.id)).toBeUndefined();
  });

  it('관리자 계정은 탈퇴할 수 없다', async () => {
    const admin = await makeUser({ admin: true });
    const cookie = await login(admin);
    const r = await call('DELETE', '/api/auth/me', cookie, { password: PASSWORD });
    expect(r.status).toBe(403);
    expect(await findUser(admin.id)).toBeDefined();
  });
});
