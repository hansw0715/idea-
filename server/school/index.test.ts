/**
 * 학교 라우터(HTTP) 테스트 — 인증은 가짜 미들웨어(x-uid 헤더)로 대신하고, 학교는 가짜 학교(testkit)다. 실제 학교에는 접속하지 않는다.
 * 인증(requireAuth)과 no-store 는 app.ts 가 마운트하면서 건다. 여기서는 라우터가 하는 일만 본다:
 *  - 탈퇴한 사용자(토큰은 유효, users 행 없음)는 모든 경로에서 401
 *  - 오류 → 상태코드·본문 (입력 오류는 400/404/429, 예약 번호 범위 밖은 500 이 아니라 400)
 *  - SCHOOL_LOCKED 본문: 30분 잠금은 retryAfterSec + Retry-After, 상태 멈춤은 long/needsRelink 이고 시간으로 풀린다고 하지 않는다
 *  - 응답 어디에도 비밀번호가 없다
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import express from 'express';
import type { Server } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { all, insert, ready, run } from '../db.js';
import { linkLimiter, schoolCallLimiter, studentHash, studentLinkHash } from './guard.js';
import { createSchoolRouter } from './index.js';
import { createSchoolService } from './service.js';
import { createFakeSchool } from './testkit.js';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 's4-router-'));
process.env.DATA_DIR = dataDir;
delete process.env.DATABASE_URL;
delete process.env.SCHOOL_MOCK_ORIGIN;
process.env.JWT_SECRET = 'test-secret-for-s4-router-tests';

const STUDENT = '2021204044';
const PASSWORD = 'router-PW-4f2a9c';
const creds = { studentId: STUDENT, password: PASSWORD };
const b64 = (n: number): string => Buffer.alloc(n, 7).toString('base64');
const cipher = { v: 2, iv: b64(12), ct: b64(40) };

let clock = Date.parse('2026-10-08T01:00:00Z');
let server: Server;
let base = '';
let fake: ReturnType<typeof createFakeSchool>;

let seq = 0;
async function makeUser(): Promise<number> {
  seq += 1;
  return insert("INSERT INTO users (email, name, password_hash) VALUES (?, ?, 'x') RETURNING id", [`router${seq}-${Date.now()}@hansung.ac.kr`, `라우터${seq}`]);
}

async function call(uid: number, method: string, url: string, body?: unknown) {
  linkLimiter.clear(String(uid));
  schoolCallLimiter.clear(String(uid));
  const res = await fetch(`${base}/api/school${url}`, {
    method,
    headers: { 'content-type': 'application/json', 'x-uid': String(uid) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json: Record<string, unknown> | null = null;
  try {
    json = JSON.parse(text) as Record<string, unknown>;
  } catch {
    json = null;
  }
  return { status: res.status, json, text, headers: res.headers };
}

beforeAll(async () => {
  await ready();
  fake = createFakeSchool({ users: { [STUDENT]: PASSWORD } });
  const service = createSchoolService({ fetch: fake.fetch, now: () => clock });
  const app = express();
  app.use(express.json());
  // requireAuth 대신: 토큰이 유효하다고 가정하고 uid 만 싣는다
  app.use((req, res, next) => {
    res.locals.userId = Number(req.header('x-uid'));
    next();
  });
  app.use('/api/school', createSchoolRouter(service));
  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(500).json({ error: '서버 오류', name: (err as Error)?.name });
  });
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}, 120_000);

afterAll(async () => {
  await new Promise<void>((resolve) => server?.close(() => resolve()));
  try {
    fs.rmSync(dataDir, { recursive: true, force: true });
  } catch {
    // 임시 폴더라 남겨 둬도 된다.
  }
});

beforeEach(async () => {
  await run('DELETE FROM school_login_guard');
  await run('DELETE FROM school_link_probe');
  // 학번 하나당 계정 하나(유니크 인덱스): 앞 테스트가 연동해 둔 학번을 풀어 줘서 테스트마다 같은 학번을 다시 연동할 수 있게 한다
  await run('UPDATE users SET school_student_hash = NULL, school_cipher = NULL, school_hint = NULL WHERE school_student_hash IS NOT NULL');
  fake.state.calls.length = 0;
  fake.state.infoLogins = 0;
  fake.state.resveLogins = 0;
});

describe('탈퇴한 사용자의 남은 토큰', () => {
  it('모든 경로가 401 이고, 학교에는 아무것도 나가지 않는다', async () => {
    const uid = await makeUser();
    await run('DELETE FROM users WHERE id = ?', [uid]);
    const requests: [string, string, unknown?][] = [
      ['GET', '/link'],
      ['POST', '/link', { creds, cipher }],
      ['DELETE', '/link'],
      ['POST', '/timetable/preview', { creds }],
      ['POST', '/timetable/import', { creds }],
      ['POST', '/reservations', { creds }],
      ['POST', '/book/preview', { creds, reservationId: 1 }],
      ['POST', '/book/submit', { creds, reservationId: 1, items: {} }],
    ];
    for (const [method, url, body] of requests) {
      const r = await call(uid, method, url, body);
      expect(r.status, `${method} ${url}`).toBe(401);
      expect(r.json).toMatchObject({ code: 'FORBIDDEN' });
      expect(r.text).not.toContain(PASSWORD);
    }
    expect(fake.state.calls).toHaveLength(0);
    expect(await all('SELECT 1 FROM school_login_guard')).toHaveLength(0);
  });

  it('살아 있는 사용자는 같은 경로가 정상이다 (GET /link → linked:false)', async () => {
    const uid = await makeUser();
    const r = await call(uid, 'GET', '/link');
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ linked: false, hint: null, linkedAt: null, cipher: null, profileHint: null });
  });
});

describe('오류 응답', () => {
  it('예약 번호가 int4 범위를 넘으면 500 이 아니라 400 INVALID', async () => {
    const uid = await makeUser();
    expect((await call(uid, 'POST', '/link', { creds, cipher })).status).toBe(200);
    for (const rid of [2147483648, 9007199254740992]) {
      for (const url of ['/book/preview', '/book/submit']) {
        const r = await call(uid, 'POST', url, { creds, reservationId: rid, items: {} });
        expect(r.status, `${url} ${rid}`).toBe(400);
        expect(r.json).toMatchObject({ code: 'INVALID' });
        expect(r.text).not.toContain(PASSWORD);
      }
    }
    const missing = await call(uid, 'POST', '/book/preview', { creds, reservationId: 2147483647 });
    expect(missing.status).toBe(404);
  });

  it('평문이 든 암호문은 400 이고 저장되지 않는다', async () => {
    const uid = await makeUser();
    const ct = Buffer.from(`${STUDENT}:${PASSWORD}`, 'utf8').toString('base64');
    const r = await call(uid, 'POST', '/link', { creds, cipher: { v: 2, iv: b64(12), ct } });
    expect(r.status).toBe(400);
    expect(r.json).toMatchObject({ code: 'INVALID' });
    expect(r.text).not.toContain(PASSWORD);
    expect(fake.state.calls).toHaveLength(0);
    expect((await call(uid, 'GET', '/link')).json).toMatchObject({ linked: false });
  });

  it('같은 끝 3자리 다른 학번은 409 SCHOOL_NOT_LINKED 이고 학교에 나가지 않는다', async () => {
    const uid = await makeUser();
    expect((await call(uid, 'POST', '/link', { creds, cipher })).status).toBe(200);
    fake.state.calls.length = 0;
    const r = await call(uid, 'POST', '/timetable/preview', { creds: { studentId: '2019111044', password: 'guess' } });
    expect(r.status).toBe(409);
    expect(r.json).toMatchObject({ code: 'SCHOOL_NOT_LINKED' });
    expect(fake.state.calls).toHaveLength(0);
  });
});

describe('SCHOOL_LOCKED 본문', () => {
  it('30분 잠금: retryAfterSec + Retry-After 헤더, long=false', async () => {
    const uid = await makeUser();
    await call(uid, 'POST', '/link', { creds, cipher });
    const h = studentHash(STUDENT);
    await run('INSERT INTO school_login_guard (student_hash, fails, locked_until) VALUES (?, 5, ?::timestamptz) ON CONFLICT (student_hash) DO UPDATE SET fails = 5, locked_until = EXCLUDED.locked_until', [
      h,
      new Date(clock + 20 * 60_000).toISOString(),
    ]);
    const r = await call(uid, 'POST', '/timetable/preview', { creds });
    expect(r.status).toBe(429);
    expect(r.json).toMatchObject({ code: 'SCHOOL_LOCKED', retryAfterSec: 1200, long: false, needsRelink: false });
    expect(r.headers.get('retry-after')).toBe('1200');
    expect(String(r.json!.error)).toContain('20분'); // 남은 시간
  });

  it('8회 이상 상태 멈춤: long=true, retryAfterSec=0 (기다린다고 풀리지 않는다), 시간으로 풀린다는 문구가 없다', async () => {
    const uid = await makeUser();
    await call(uid, 'POST', '/link', { creds, cipher });
    const h = studentHash(STUDENT);
    await run('INSERT INTO school_login_guard (student_hash, fails) VALUES (?, 8) ON CONFLICT (student_hash) DO UPDATE SET fails = 8, locked_until = NULL', [h]);
    const loginsBefore = fake.state.infoLogins;
    clock += 400 * 24 * 60 * 60_000; // 1년이 넘게 지나도
    const r = await call(uid, 'POST', '/timetable/preview', { creds });
    expect(r.status).toBe(429);
    expect(r.json).toMatchObject({ code: 'SCHOOL_LOCKED', retryAfterSec: 0, long: true, needsRelink: true });
    expect(r.headers.get('retry-after')).toBeNull();
    expect(String(r.json!.error)).not.toContain('24시간');
    expect(String(r.json!.error)).toContain('다시 연동');
    expect(fake.state.infoLogins).toBe(loginsBefore); // 학교로 나가지 않았다

    // 주인이 새 비밀번호로 다시 연동하면 풀린다
    const relink = await call(uid, 'POST', '/link', { creds, cipher });
    expect(relink.status).toBe(200);
    expect((await call(uid, 'POST', '/timetable/preview', { creds })).status).toBe(200);
  });

  it('9회 이상 완전 중단: needsRelink=false', async () => {
    const uid = await makeUser();
    await call(uid, 'POST', '/link', { creds, cipher });
    await run('INSERT INTO school_login_guard (student_hash, fails) VALUES (?, 9) ON CONFLICT (student_hash) DO UPDATE SET fails = 9, locked_until = NULL', [studentHash(STUDENT)]);
    const r = await call(uid, 'POST', '/link', { creds, cipher });
    expect(r.status).toBe(429);
    expect(r.json).toMatchObject({ code: 'SCHOOL_LOCKED', long: true, needsRelink: false });
  });
});

describe('연동 상태', () => {
  it('연동 → GET /link 에 암호문이 있고 학번 해시·평문은 없다 → 해제하면 linked:false', async () => {
    const uid = await makeUser();
    const linked = await call(uid, 'POST', '/link', { creds, cipher });
    expect(linked.status).toBe(200);
    expect(linked.text).not.toContain(PASSWORD);
    const status = await call(uid, 'GET', '/link');
    expect(status.json).toMatchObject({ linked: true, hint: '*******044', cipher });
    expect(status.text).not.toContain(PASSWORD);
    expect(status.text).not.toContain(studentLinkHash(STUDENT)); // 서버 안에서만 쓰는 값이다
    expect((await call(uid, 'DELETE', '/link')).json).toEqual({ ok: true });
    expect((await call(uid, 'GET', '/link')).json).toMatchObject({ linked: false });
  });
});
