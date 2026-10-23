/**
 * 실제 Express 앱(createApp)을 임시 PGlite DB 위에서 HTTP 로 부르는 시험.
 *
 * 지키는 것
 *  - /api/school/* 의 모든 응답(401·본문 해석 오류 400/413/415 포함)은 Cache-Control: no-store.
 *    본문 해석(express.json)이 no-store 설정보다 먼저 돌면 해석 단계의 오류 응답에는 헤더가 없다.
 *  - 본문 해석 오류에도 요청 원문(학교 비밀번호)이 응답·로그 어디에도 나가지 않는다.
 *  - 깨진 퍼센트 인코딩 주소는 500 이 아니라 400.
 *  - GET /api/timetable · /api/dashboard 의 시간표 항목에 source('manual' | 'school') 가 있다.
 *  - 접속자 읽기는 HTTP 요청 하나에 쿼리 3개 이하 (withUser 1 + 차단 목록 1 + 접속자·프로필 조인 1) — 계약 §2.
 *
 * 안전: 환경에서 DATABASE_URL 을 지우고 임시 폴더만 쓴다. 개발 서버(3101)와 그 DB 는 건드리지 않는다.
 */
import fs from 'node:fs';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import jwt from 'jsonwebtoken';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MockInstance } from 'vitest';

// db.js 의 헬퍼 호출만 센다 (동작은 그대로 위임). 센 SQL 은 "쿼리 몇 개" 시험에서만 본다.
const counted = vi.hoisted(() => ({ sql: [] as string[] }));
vi.mock('./db.js', async (importOriginal) => {
  const orig = await importOriginal<typeof import('./db.js')>();
  return {
    ...orig,
    all: ((sql: string, params?: unknown[]) => {
      counted.sql.push(sql);
      return orig.all(sql, params);
    }) as typeof orig.all,
    get: ((sql: string, params?: unknown[]) => {
      counted.sql.push(sql);
      return orig.get(sql, params);
    }) as typeof orig.get,
    run: ((sql: string, params?: unknown[]) => {
      counted.sql.push(sql);
      return orig.run(sql, params);
    }) as typeof orig.run,
    insert: ((sql: string, params?: unknown[]) => {
      counted.sql.push(sql);
      return orig.insert(sql, params);
    }) as typeof orig.insert,
  };
});

import { createApp } from './app.js';
import { insert, ready, run } from './db.js';

const SECRET = 'LEAKME-pw-123!';
const STUDENT = '2021204044';
const JWT_SECRET = 'test-jwt-secret-for-app-http';

let tmp: string;
let server: Server;
let base: string;

beforeAll(async () => {
  delete process.env.DATABASE_URL;
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'app-http-'));
  process.env.DATA_DIR = tmp;
  process.env.JWT_SECRET = JWT_SECRET;
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

let logSpies: MockInstance<typeof console.error>[] = [];
beforeEach(() => {
  logSpies = [
    vi.spyOn(console, 'error').mockImplementation(() => undefined),
    vi.spyOn(console, 'warn').mockImplementation(() => undefined),
    vi.spyOn(console, 'log').mockImplementation(() => undefined),
  ] as MockInstance<typeof console.error>[];
});
afterEach(() => {
  vi.restoreAllMocks();
});

const everythingLogged = () =>
  logSpies
    .flatMap((s) => s.mock.calls.flat())
    .map((v) => (v instanceof Error ? `${v.stack}\n${JSON.stringify(v)}` : typeof v === 'string' ? v : JSON.stringify(v)))
    .join('\n');

let seq = 0;
async function addUser(over: { profile?: boolean } = {}): Promise<{ id: number; cookie: string }> {
  seq += 1;
  const id = await insert(
    `INSERT INTO users (email, name, password_hash, nickname, college, department, admission_year,
                        avatar, avatar_color, profile_done)
     VALUES (?, ?, 'x', ?, 'IT공과대학', '컴퓨터공학부', 2024, 'cat', 'm2', ?) RETURNING id`,
    [`http${seq}@hansung.ac.kr`, `실명${seq}`, `닉${seq}`, over.profile ?? true],
  );
  return { id, cookie: `token=${jwt.sign({ uid: id }, JWT_SECRET)}` };
}

async function call(method: string, p: string, opts: { cookie?: string; body?: string; headers?: Record<string, string> } = {}) {
  const res = await fetch(`${base}${p}`, {
    method,
    headers: { ...(opts.cookie ? { cookie: opts.cookie } : {}), ...(opts.headers ?? {}) },
    body: opts.body,
  });
  const text = await res.text();
  let json: Record<string, unknown> | null = null;
  try {
    json = JSON.parse(text) as Record<string, unknown>;
  } catch {
    /* JSON 이 아닌 응답 */
  }
  return { status: res.status, text, json, cacheControl: res.headers.get('cache-control') };
}

const JSON_TYPE = { 'content-type': 'application/json' };
const brokenCreds = `{"creds":{"studentId":"${STUDENT}","password":"${SECRET}"`; // 닫히지 않은 JSON

describe('/api/school/* 응답은 오류든 아니든 no-store', () => {
  it('로그인 안 한 요청(401)에도 no-store', async () => {
    const r = await call('GET', '/api/school/link');
    expect(r.status).toBe(401);
    expect(r.cacheControl).toBe('no-store');
  });

  it('로그인한 정상 요청에도 no-store', async () => {
    const u = await addUser();
    const r = await call('GET', '/api/school/link', { cookie: u.cookie });
    expect(r.status).toBe(200);
    expect(r.cacheControl).toBe('no-store');
  });

  it('깨진 JSON(400)에도 no-store — 비밀번호는 응답과 로그에 없다', async () => {
    const u = await addUser();
    const r = await call('POST', '/api/school/link', { cookie: u.cookie, headers: JSON_TYPE, body: brokenCreds });
    expect(r.status).toBe(400);
    expect(r.cacheControl).toBe('no-store');
    expect(r.json).toMatchObject({ code: 'INVALID' });
    expect(r.text).not.toContain(SECRET);
    expect(r.text).not.toContain(STUDENT);
    expect(everythingLogged()).not.toContain(SECRET);
    expect(everythingLogged()).not.toContain(STUDENT);
  });

  it('로그인하지 않았어도 본문 해석 오류가 먼저 나면 400 + no-store (인증보다 앞 단계)', async () => {
    const r = await call('POST', '/api/school/link', { headers: JSON_TYPE, body: brokenCreds });
    expect(r.status).toBe(400);
    expect(r.cacheControl).toBe('no-store');
    expect(r.text).not.toContain(SECRET);
  });

  it('너무 큰 본문(413)에도 no-store', async () => {
    const u = await addUser();
    const r = await call('POST', '/api/school/link', {
      cookie: u.cookie,
      headers: JSON_TYPE,
      body: JSON.stringify({ creds: { studentId: STUDENT, password: SECRET }, pad: 'x'.repeat(200_000) }),
    });
    expect(r.status).toBe(413);
    expect(r.cacheControl).toBe('no-store');
    expect(r.text).not.toContain(SECRET);
    expect(everythingLogged()).not.toContain(SECRET);
  });

  it('지원하지 않는 charset·content-encoding 은 5xx 가 아니라 4xx + no-store, 로그에 스택이 없다', async () => {
    const u = await addUser();
    const charset = await call('POST', '/api/school/link', {
      cookie: u.cookie,
      headers: { 'content-type': 'application/json; charset=foo' },
      body: `{"creds":{"password":"${SECRET}"}}`,
    });
    expect(charset.status).toBeGreaterThanOrEqual(400);
    expect(charset.status).toBeLessThan(500);
    expect(charset.cacheControl).toBe('no-store');

    const encoding = await call('POST', '/api/school/link', {
      cookie: u.cookie,
      headers: { ...JSON_TYPE, 'content-encoding': 'foo' },
      body: `{"creds":{"password":"${SECRET}"}}`,
    });
    expect(encoding.status).toBeGreaterThanOrEqual(400);
    expect(encoding.status).toBeLessThan(500);
    expect(encoding.cacheControl).toBe('no-store');

    for (const r of [charset, encoding]) {
      expect(r.text).not.toContain(SECRET);
      expect(r.json).toMatchObject({ code: 'INVALID' });
    }
    expect(logSpies[0]).not.toHaveBeenCalled(); // 클라이언트 잘못은 서버 오류 로그를 남기지 않는다
    expect(everythingLogged()).not.toContain(SECRET);
  });

  it('학교 경로가 아닌 곳의 깨진 JSON 도 400 (비밀번호 로그인 본문이 로그에 남지 않는다)', async () => {
    const r = await call('POST', '/api/auth/login', {
      headers: JSON_TYPE,
      body: `{"email":"a@hansung.ac.kr","password":"${SECRET}"`,
    });
    expect(r.status).toBe(400);
    expect(r.text).not.toContain(SECRET);
    expect(everythingLogged()).not.toContain(SECRET);
  });
});

describe('깨진 퍼센트 인코딩 주소', () => {
  it('라운지 경로 매개변수는 500 이 아니라 400', async () => {
    const u = await addUser();
    for (const p of ['/api/lounge/gatherings/%E0%A4%A', '/api/lounge/users/%E0%A4%A']) {
      const r = await call('GET', p, { cookie: u.cookie });
      expect(r.status, p).toBe(400);
      expect(r.json, p).toMatchObject({ code: 'INVALID' });
      expect(r.text, p).not.toMatch(/URIError|decode|at /);
    }
    expect(logSpies[0]).not.toHaveBeenCalled();
  });

  it('없는 API 경로는 그대로 404', async () => {
    const r = await call('GET', '/api/nope');
    expect(r.status).toBe(404);
  });
});

describe('시간표 응답의 source', () => {
  it('GET /api/timetable · /api/dashboard 항목에 manual / school 이 구분되어 내려온다', async () => {
    const u = await addUser();
    await run(
      `INSERT INTO timetable_entries (user_id, day, start_min, end_min, title, place, repeat_kind, source)
       VALUES (?, 0, 540, 600, '학교 과목', 'A101', 'weekly', 'school')`,
      [u.id],
    );
    // 직접 입력은 API 로 만든다 — 만들어진 항목의 응답에도 source 가 있어야 한다.
    const created = await call('POST', '/api/timetable', {
      cookie: u.cookie,
      headers: JSON_TYPE,
      body: JSON.stringify({ day: 1, startMin: 600, endMin: 660, title: '스터디', place: '도서관', repeatKind: 'weekly' }),
    });
    expect(created.status).toBe(201);
    expect(created.json).toMatchObject({ source: 'manual' });

    const list = await call('GET', '/api/timetable', { cookie: u.cookie });
    const entries = JSON.parse(list.text) as { title: string; source?: string }[];
    expect(entries.map((e) => [e.title, e.source])).toEqual([
      ['학교 과목', 'school'],
      ['스터디', 'manual'],
    ]);

    const dash = await call('GET', '/api/dashboard', { cookie: u.cookie });
    const timetable = (dash.json?.timetable ?? []) as { title: string; source?: string }[];
    expect(timetable.length).toBeGreaterThan(0);
    expect(timetable.every((e) => e.source === 'school' || e.source === 'manual')).toBe(true);
  });
});

describe('접속자 읽기의 쿼리 수 (계약 §2)', () => {
  it('HTTP 요청 하나가 3쿼리 이하 — withUser 1 + 차단 목록 1 + 접속자·프로필 조인 1', async () => {
    const me = await addUser();
    const other = await addUser();
    await call('POST', '/api/lounge/presence', {
      cookie: other.cookie,
      headers: JSON_TYPE,
      body: JSON.stringify({ x: 0.4, y: 0.4, zone: 'plaza' }),
    });
    await call('GET', '/api/lounge/presence', { cookie: me.cookie }); // 첫 읽기는 오래된 행 정리(DELETE)가 끼므로 건너뛴다

    counted.sql.length = 0;
    const r = await call('GET', '/api/lounge/presence', { cookie: me.cookie });
    expect(r.status).toBe(200);
    expect((r.json?.users as unknown[]).length).toBe(1);
    expect(counted.sql.length, counted.sql.join('\n---\n')).toBeLessThanOrEqual(3);
    // 나머지는 깨뜨리지 않으면서, 사용자 조회(withUser)가 요청마다 한 번 들어 있다는 사실도 고정한다.
    expect(counted.sql.some((s) => /FROM users WHERE id = \?/.test(s))).toBe(true);
  });
});

describe('관리자 로그인: admin_아이디 + 원래 비밀번호', () => {
  async function addLoginUser(username: string, password: string): Promise<number> {
    const bcrypt = (await import('bcryptjs')).default;
    return insert(
      `INSERT INTO users (email, username, name, password_hash) VALUES (NULL, ?, '관리자후보', ?) RETURNING id`,
      [username, bcrypt.hashSync(password, 4)],
    );
  }
  const login = (username: string, password: string) =>
    fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: JSON_TYPE,
      body: JSON.stringify({ username, password }),
    }).then(async (r) => ({ status: r.status, json: (await r.json()) as Record<string, unknown>, cookie: (r.headers.get('set-cookie') ?? '').split(';')[0] }));

  it('지정한 아이디(dedea715)를 admin_dedea715 로 로그인하면 관리자 모드, 그냥 로그인하면 일반', async () => {
    await addLoginUser('dedea715', 'Pw-1234!');
    const normal = await login('dedea715', 'Pw-1234!');
    expect(normal.status).toBe(200);
    expect(normal.json.isAdmin).toBe(false);
    expect((await call('GET', '/api/lounge/admin/stats', { cookie: normal.cookie })).status).toBe(403);

    const admin = await login('admin_dedea715', 'Pw-1234!');
    expect(admin.status).toBe(200);
    expect(admin.json).toMatchObject({ username: 'dedea715', isAdmin: true });
    expect((await call('GET', '/api/auth/me', { cookie: admin.cookie })).json?.isAdmin).toBe(true);
    expect((await call('GET', '/api/lounge/admin/stats', { cookie: admin.cookie })).status).toBe(200);

    expect((await login('admin_dedea715', 'wrong-pw')).status).toBe(401);
  });

  it('지정하지 않은 아이디는 admin_ 로 들어올 수 없고, admin_ 으로 시작하는 아이디는 가입할 수 없다', async () => {
    await addLoginUser('plainuser1', 'Pw-1234!');
    expect((await login('admin_plainuser1', 'Pw-1234!')).status).toBe(401);
    const { usernameError } = await import('../shared/auth.js');
    expect(usernameError('admin_newbie')).toContain('쓸 수 없어요');
  });
});
