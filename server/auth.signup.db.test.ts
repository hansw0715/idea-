/**
 * 가입·로그인 HTTP 테스트 — 임시 PGlite + 가짜 학교(testkit). 실제 학교에는 절대 접속하지 않는다.
 *
 * 지키는 것
 *  - school-verify: 학교 로그인 한 번 → ticket. 틀리면 ticket 없음 + 학번 가드 횟수 증가, 5연속 실패 뒤엔 학교 호출 0회.
 *    이미 가입된 학번은 학교 인증에 성공한 뒤에만 409 (비밀번호가 틀리면 가입 여부를 알려 주지 않는다).
 *  - signup: ticket 검증(위조·만료·용도), 아이디 형식·중복, 동시 가입은 한 건만, 같은 ticket 으로 둘째 계정 불가.
 *  - 평문(학교·플랫폼 비밀번호)은 응답·DB·콘솔 어디에도 없다.
 *  - 로그인: 아이디 / 옛 email 필드 / 없는 아이디도 같은 문장.
 *  - 학교 메일 가입은 스위치가 꺼져 있으면 404 DISABLED (켜면 예전처럼 동작).
 *  - 팀원 목록에 email 이 없다.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import bcrypt from 'bcryptjs';
import cookieParser from 'cookie-parser';
import express from 'express';
import jwt from 'jsonwebtoken';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'auth-signup-'));
process.env.DATA_DIR = dataDir;
process.env.JWT_SECRET = 'auth-signup-test-secret-0123456789';
delete process.env.DATABASE_URL;
delete process.env.SCHOOL_MOCK_ORIGIN;
delete process.env.EMAIL_SIGNUP_ENABLED;

import { createApp, errorHandler } from './app.js';
import { createAuthRouter } from './auth.js';
import { all, get, insert, ready, run } from './db.js';
import { studentHash, studentLinkHash } from './school/guard.js';
import { SCHOOL_ORIGINS } from './school/http.js';
import { createSchoolService } from './school/service.js';
import { createFakeSchool } from './school/testkit.js';

const SCHOOL_PW = 'right-pass';
const PLATFORM_PW = 'Platform-PW-9x!';
const STUDENTS: Record<string, string> = {
  '2021204044': SCHOOL_PW,
  '2021204055': SCHOOL_PW,
  '2021204066': SCHOOL_PW,
  '2021204077': SCHOOL_PW,
  '2021204088': SCHOOL_PW,
};
const NAMES: Record<string, string> = {
  '2021204044': '박민재',
  '2021204055': '김하나',
  '2021204066': '이둘',
  '2021204077': '최셋',
  '2021204088': '정넷',
};
const SECRETS = [SCHOOL_PW, PLATFORM_PW];

let fake: ReturnType<typeof createFakeSchool>;
let server: Server;
let base = '';
let fullServer: Server;
let fullBase = '';

const sealed = () => ({ v: 2 as const, iv: crypto.randomBytes(12).toString('base64'), ct: crypto.randomBytes(40).toString('base64') });

async function listen(app: express.Express): Promise<{ server: Server; base: string }> {
  const s = await new Promise<Server>((resolve) => {
    const x = app.listen(0, '127.0.0.1', () => resolve(x));
  });
  return { server: s, base: `http://127.0.0.1:${(s.address() as AddressInfo).port}` };
}

/** 라우터를 새로 만든다 = 제한 장치(IP 기준)와 가짜 학교가 테스트마다 새것 */
async function startApp(opts: { emailSignupEnabled?: boolean } = {}): Promise<void> {
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  fake = createFakeSchool({ users: STUDENTS, names: NAMES });
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/auth', createAuthRouter({ school: createSchoolService({ fetch: fake.fetch, origins: () => SCHOOL_ORIGINS }), emailSignupEnabled: opts.emailSignupEnabled }));
  app.use(errorHandler);
  ({ server, base } = await listen(app));
}

type Res = { status: number; json: Record<string, unknown> | null; text: string; headers: Headers };

async function call(url: string, method: string, body?: unknown, cookie?: string, b = base): Promise<Res> {
  const res = await fetch(`${b}${url}`, {
    method,
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
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

const cookieOf = (r: Res): string => r.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');

const verify = (studentId = '2021204044', password = SCHOOL_PW) => call('/api/auth/school-verify', 'POST', { studentId, password });
async function ticketFor(studentId = '2021204044'): Promise<string> {
  const r = await verify(studentId);
  expect(r.status).toBe(200);
  return r.json!.ticket as string;
}
const signupBody = (ticket: string, over: Record<string, unknown> = {}) => ({
  ticket,
  username: 'minjae44',
  password: PLATFORM_PW,
  cipher: sealed(),
  ...over,
});
const signup = (body: unknown) => call('/api/auth/signup', 'POST', body);

let logs: string[] = [];
const spies = () =>
  (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) =>
    vi.spyOn(console, m).mockImplementation((...a: unknown[]) => {
      logs.push(a.map((v) => (typeof v === 'string' ? v : JSON.stringify(v))).join(' '));
    }),
  );

beforeAll(async () => {
  await ready();
  const s = await listen(createApp());
  fullServer = s.server;
  fullBase = s.base;
}, 180_000);

afterAll(async () => {
  await new Promise<void>((resolve) => server?.close(() => resolve()));
  await new Promise<void>((resolve) => fullServer?.close(() => resolve()));
  try {
    fs.rmSync(dataDir, { recursive: true, force: true });
  } catch {
    // 임시 폴더라 남겨 둬도 된다.
  }
});

beforeEach(async () => {
  logs = [];
  spies();
  await run('DELETE FROM users');
  await run('DELETE FROM school_login_guard');
  await run('DELETE FROM email_verifications');
  await startApp();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const noSecrets = (text: string) => {
  for (const s of SECRETS) expect(text, `평문 ${s.slice(0, 4)}… 이 보이면 안 된다`).not.toContain(s);
};

// ───────────────────────────────────────────────────────────────────

describe('POST /api/auth/school-verify — 가입 ① 학교 계정 학생 인증', () => {
  it('성공하면 ticket·힌트·프로필을 주고, 계정은 만들지 않으며, 평문은 어디에도 없다', async () => {
    const r = await verify();
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({
      hint: '*******044',
      profile: { studentId: '2021204044', name: '박민재', department: 'AI응용학과' },
    });
    expect(typeof r.json!.ticket).toBe('string');
    expect(fake.state.infoLogins).toBe(1);
    expect((await get<{ n: number }>('SELECT COUNT(*)::int AS n FROM users'))!.n).toBe(0);
    noSecrets(r.text);
    noSecrets(logs.join('\n'));
    // 성공하면 가드 기록은 남지 않는다
    expect(await get('SELECT 1 FROM school_login_guard')).toBeUndefined();
  });

  it('학교 비밀번호가 틀리면 422 SCHOOL_AUTH_FAILED, ticket 없음, 가드 실패 횟수가 늘고 학교 로그인은 1번만', async () => {
    const r = await verify('2021204044', 'wrong-pass-XYZ');
    expect(r.status).toBe(422);
    expect(r.json).toMatchObject({ code: 'SCHOOL_AUTH_FAILED' });
    expect(r.json).not.toHaveProperty('ticket');
    expect(fake.state.infoLogins).toBe(1);
    const g = await get<{ fails: number }>('SELECT fails FROM school_login_guard WHERE student_hash = ?', [studentHash('2021204044')]);
    expect(Number(g!.fails)).toBe(1);
    expect((await get<{ n: number }>('SELECT COUNT(*)::int AS n FROM users'))!.n).toBe(0);
    expect(r.text).not.toContain('wrong-pass-XYZ');
    expect(logs.join('\n')).not.toContain('wrong-pass-XYZ');
  });

  it('연속 5번 틀리면 30분 잠그고, 그 뒤에는 학교에 아무것도 나가지 않는다 (SCHOOL_LOCKED 429)', async () => {
    for (let i = 1; i <= 5; i++) {
      const r = await verify('2021204044', `wrong-${i}-pw`);
      expect(r.status, `${i}번째`).toBe(422);
    }
    const loginsBefore = fake.state.infoLogins;
    const callsBefore = fake.state.calls.length;
    expect(loginsBefore).toBe(5);
    // 맞는 비밀번호여도 잠겨 있으면 학교에 가지 않는다
    const locked = await verify('2021204044', SCHOOL_PW);
    expect(locked.status).toBe(429);
    expect(locked.json).toMatchObject({ code: 'SCHOOL_LOCKED', long: false });
    expect(Number(locked.json!.retryAfterSec)).toBeGreaterThan(0);
    expect(locked.headers.get('retry-after')).not.toBeNull();
    expect(fake.state.infoLogins).toBe(loginsBefore);
    expect(fake.state.calls.length).toBe(callsBefore);
  });

  it('이미 가입된 학번은 학교 인증에 성공한 뒤 409 SCHOOL_ALREADY_REGISTERED 이고 ticket 은 없다', async () => {
    await run("INSERT INTO users (username, name, password_hash, school_student_hash) VALUES ('owner01', '주인', 'x', ?)", [studentLinkHash('2021204044')]);
    const r = await verify('2021204044', SCHOOL_PW);
    expect(r.status).toBe(409);
    expect(r.json).toMatchObject({ code: 'SCHOOL_ALREADY_REGISTERED', error: '이미 가입된 학번이에요. 로그인해 주세요.' });
    expect(r.json).not.toHaveProperty('ticket');
    expect(fake.state.infoLogins).toBe(1); // 학교 인증을 거친 뒤에 알려 준다

    // 비밀번호를 모르는 사람에게는 가입 여부가 새지 않는다: 틀리면 그냥 학교 인증 실패
    const wrong = await verify('2021204044', 'not-the-password');
    expect(wrong.status).toBe(422);
    expect(wrong.json).toMatchObject({ code: 'SCHOOL_AUTH_FAILED' });
  });

  it('학번·비밀번호 형식이 틀리면 400 INVALID 이고 학교에 요청하지 않는다', async () => {
    for (const body of [{ studentId: '12ab', password: 'x' }, { studentId: '2021204044', password: '' }, {}, { studentId: 2021204044, password: 'x' }]) {
      const r = await call('/api/auth/school-verify', 'POST', body);
      expect(r.status).toBe(400);
      expect(r.json).toMatchObject({ code: 'INVALID' });
    }
    expect(fake.state.calls.length).toBe(0);
  });

  it('학교가 점검 중이면 502 SCHOOL_UNAVAILABLE 이고 실패로 세지 않는다', async () => {
    fake = createFakeSchool({ users: STUDENTS, names: NAMES, maintenance: true });
    await new Promise<void>((resolve) => server.close(() => resolve()));
    const app = express();
    app.use(express.json());
    app.use('/api/auth', createAuthRouter({ school: createSchoolService({ fetch: fake.fetch, origins: () => SCHOOL_ORIGINS }) }));
    app.use(errorHandler);
    ({ server, base } = await listen(app));
    const r = await verify();
    expect(r.status).toBe(502);
    expect(r.json).toMatchObject({ code: 'SCHOOL_UNAVAILABLE' });
    expect(await get('SELECT 1 FROM school_login_guard')).toBeUndefined();
  });

  it('같은 IP 는 10분에 10번까지 (11번째는 학교에 가기 전에 429 RATE_LIMITED)', async () => {
    for (let i = 0; i < 10; i++) expect((await verify()).status).toBe(200);
    const loginsBefore = fake.state.infoLogins;
    const r = await verify();
    expect(r.status).toBe(429);
    expect(r.json).toMatchObject({ code: 'RATE_LIMITED' });
    expect(fake.state.infoLogins).toBe(loginsBefore);
  });
});

describe('POST /api/auth/signup — 가입 ② 아이디·비밀번호 + 연동', () => {
  it('ticket 이 맞으면 계정·학교 연동이 한 번에 만들어지고 쿠키가 발급된다 (이름은 학교에서 읽은 이름)', async () => {
    const ticket = await ticketFor();
    const body = signupBody(ticket);
    const r = await signup(body);
    expect(r.status).toBe(201);
    expect(r.json).toMatchObject({
      username: 'minjae44',
      name: '박민재',
      isAdmin: false,
      email: null,
      school: { hint: '*******044', department: 'AI응용학과', admissionYear: 2021 },
    });
    expect(r.headers.getSetCookie().join(';')).toMatch(/token=.+HttpOnly/i);

    const row = await get<Record<string, unknown>>('SELECT * FROM users WHERE username = ?', ['minjae44']);
    expect(row).toMatchObject({
      name: '박민재',
      email: null,
      school_hint: '*******044',
      school_department: 'AI응용학과',
      school_admission_year: 2021,
      school_student_hash: studentLinkHash('2021204044'),
      // 라운지 프로필은 가입과 동시에 학교 계정 정보로 만들어진다
      nickname: '박○○',
      college: '',
      department: 'AI응용학과',
      admission_year: 2021,
      profile_done: true,
    });
    expect(row!.school_linked_at).toBeTruthy();
    expect(JSON.parse(row!.school_cipher as string)).toEqual({ v: 2, iv: body.cipher.iv, ct: body.cipher.ct });
    expect(bcrypt.getRounds(row!.password_hash as string)).toBe(12);
    expect(await bcrypt.compare(PLATFORM_PW, row!.password_hash as string)).toBe(true);

    // 평문은 응답·DB 행 전체·콘솔 어디에도 없다
    noSecrets(r.text);
    noSecrets(JSON.stringify(row));
    noSecrets(logs.join('\n'));
    expect(JSON.stringify(row)).not.toContain('2021204044');

    // 쿠키로 /me
    const me = await call('/api/auth/me', 'GET', undefined, cookieOf(r));
    expect(me.status).toBe(200);
    expect(me.json).toEqual({ id: r.json!.id, username: 'minjae44', name: '박민재', isAdmin: false, email: null });
  });

  it('가입 요청 한 번에는 학교 호출이 없다 (학교 인증은 school-verify 에서 이미 끝났다)', async () => {
    const ticket = await ticketFor();
    const before = fake.state.calls.length;
    expect((await signup(signupBody(ticket))).status).toBe(201);
    expect(fake.state.calls.length).toBe(before);
  });

  it('입력 형식: 아이디·비밀번호·암호문이 틀리면 400 INVALID + 항목(field) + 문장', async () => {
    const ticket = await ticketFor();
    const cases: [Record<string, unknown>, string][] = [
      [{ username: 'ab' }, 'username'],
      [{ username: 'Bad Name!' }, 'username'],
      [{ username: '' }, 'username'],
      [{ username: 'a'.repeat(21) }, 'username'],
      [{ password: 'short' }, 'password'],
      [{ password: 'x'.repeat(65) }, 'password'],
      [{ cipher: { v: 1, iv: sealed().iv, ct: sealed().ct } }, 'cipher'], // 옛 방식
      [{ cipher: { v: 2, iv: 'AAAA', ct: sealed().ct } }, 'cipher'],
      [{ cipher: { v: 2, iv: sealed().iv, ct: Buffer.alloc(16).toString('base64') } }, 'cipher'],
      [{ cipher: null }, 'cipher'],
      // 암호문 자리에 평문(눈에 보이는 글자뿐)이 들어옴
      [{ cipher: { v: 2, iv: sealed().iv, ct: Buffer.from('Platform-PW-9x!Platform-PW-9x!').toString('base64') } }, 'cipher'],
      // 플랫폼 비밀번호 바이트가 그대로 섞여 있음
      [{ cipher: { v: 2, iv: sealed().iv, ct: Buffer.concat([crypto.randomBytes(20), Buffer.from(PLATFORM_PW), Buffer.from([0x01, 0xff, 0x80])]).toString('base64') } }, 'cipher'],
    ];
    for (const [over, field] of cases) {
      const r = await signup(signupBody(ticket, over));
      expect(r.status, JSON.stringify(Object.keys(over))).toBe(400);
      expect(r.json).toMatchObject({ code: 'INVALID', field });
      expect(typeof r.json!.error).toBe('string');
    }
    expect((await get<{ n: number }>('SELECT COUNT(*)::int AS n FROM users'))!.n).toBe(0);
    // 대문자·학교 메일 꼴은 정규형으로 바뀌어 통과한다
    const ok = await signup(signupBody(ticket, { username: 'MinJae44@hansung.ac.kr' }));
    expect(ok.status).toBe(201);
    expect(ok.json!.username).toBe('minjae44');
  });

  it('ticket 이 없거나 위조·변조·다른 용도·만료면 400 TICKET_INVALID', async () => {
    const good = await ticketFor();
    const wrongSecret = jwt.sign({ purpose: 'school-signup', sh: 'a'.repeat(64), name: 'x', department: '', admissionYear: null, hint: '***' }, 'some-other-secret', { expiresIn: '15m' });
    const loginToken = jwt.sign({ uid: 1 }, process.env.JWT_SECRET!);
    const [h, p, s] = good.split('.');
    const tampered = `${h}.${p}.${s.slice(0, -2)}${s.endsWith('A') ? 'B' : 'A'}${s.slice(-1)}`;
    const forgedPayload = `${h}.${Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(p, 'base64url').toString()), name: '다른사람' })).toString('base64url')}.${s}`;
    for (const t of [undefined, '', 123, 'abc.def.ghi', wrongSecret, loginToken, tampered, forgedPayload]) {
      const r = await signup(signupBody(t as string, { username: `u${Math.floor(Math.random() * 1e6)}x` }));
      expect(r.status).toBe(400);
      expect(r.json).toMatchObject({ code: 'TICKET_INVALID', error: '학교 인증이 만료됐어요. 처음부터 다시 인증해 주세요.' });
    }
    expect((await get<{ n: number }>('SELECT COUNT(*)::int AS n FROM users'))!.n).toBe(0);

    // 만료: 15분이 지나면 쓸 수 없다
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 16 * 60 * 1000);
    const late = await signup(signupBody(good));
    vi.useRealTimers();
    expect(late.status).toBe(400);
    expect(late.json).toMatchObject({ code: 'TICKET_INVALID' });
    // 만료 직전에는 아직 쓸 수 있다
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 14 * 60 * 1000);
    const early = await signup(signupBody(good));
    vi.useRealTimers();
    expect(early.status).toBe(201);
  });

  it('ticket 을 로그인 쿠키 자리에 넣어도 로그인되지 않는다', async () => {
    const ticket = await ticketFor();
    const r = await call('/api/auth/me', 'GET', undefined, `token=${ticket}`);
    expect(r.status).toBe(401);
  });

  it('이미 쓰는 아이디는 409 USERNAME_TAKEN (옛 계정 아이디 포함, 대소문자 무시)', async () => {
    await run("INSERT INTO users (email, username, name, password_hash) VALUES ('admin1@hansung.ac.kr', 'admin1', '관리자1', 'x')");
    const ticket = await ticketFor();
    for (const username of ['admin1', 'ADMIN1']) {
      const r = await signup(signupBody(ticket, { username }));
      expect(r.status).toBe(409);
      expect(r.json).toMatchObject({ code: 'USERNAME_TAKEN', error: '이미 쓰고 있는 아이디예요.', field: 'username' });
    }
    // ticket 은 아직 살아 있다: 다른 아이디로 다시 가입할 수 있다
    expect((await signup(signupBody(ticket, { username: 'another44' }))).status).toBe(201);
  });

  it('같은 ticket 으로 둘째 계정은 만들 수 없다 (학번 하나에 계정 하나)', async () => {
    const ticket = await ticketFor();
    expect((await signup(signupBody(ticket, { username: 'first44' }))).status).toBe(201);
    const second = await signup(signupBody(ticket, { username: 'second44' }));
    expect(second.status).toBe(409);
    expect(second.json).toMatchObject({ code: 'SCHOOL_ALREADY_REGISTERED', error: '이미 가입된 학번이에요. 로그인해 주세요.' });
    expect((await get<{ n: number }>('SELECT COUNT(*)::int AS n FROM users'))!.n).toBe(1);
  });

  it('동시에 같은 아이디로 가입하면 한 건만 성공한다', async () => {
    const [t1, t2] = [await ticketFor('2021204044'), await ticketFor('2021204055')];
    const rs = await Promise.all([signup(signupBody(t1, { username: 'racer01' })), signup(signupBody(t2, { username: 'racer01' }))]);
    expect(rs.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(rs.find((r) => r.status === 409)!.json).toMatchObject({ code: 'USERNAME_TAKEN' });
    expect((await get<{ n: number }>("SELECT COUNT(*)::int AS n FROM users WHERE username = 'racer01'"))!.n).toBe(1);
  });

  it('같은 ticket 으로 서로 다른 아이디를 동시에 가입해도 한 건만 성공한다', async () => {
    const t = await ticketFor('2021204066');
    const rs = await Promise.all([signup(signupBody(t, { username: 'twin_a1' })), signup(signupBody(t, { username: 'twin_b1' }))]);
    expect(rs.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(rs.find((r) => r.status === 409)!.json).toMatchObject({ code: 'SCHOOL_ALREADY_REGISTERED' });
    expect((await get<{ n: number }>('SELECT COUNT(*)::int AS n FROM users WHERE school_student_hash = ?', [studentLinkHash('2021204066')]))!.n).toBe(1);
  });

  it('가입 뒤에는 같은 학번으로 school-verify 가 409 (이미 가입된 학번)', async () => {
    const ticket = await ticketFor();
    expect((await signup(signupBody(ticket))).status).toBe(201);
    const again = await verify();
    expect(again.status).toBe(409);
    expect(again.json).toMatchObject({ code: 'SCHOOL_ALREADY_REGISTERED' });
  });

  it('IP 기준 10분에 10번까지', async () => {
    const ticket = await ticketFor();
    for (let i = 0; i < 10; i++) {
      // 형식 검사는 통과하고 ticket 만 틀린 요청(bcrypt 를 돌리지 않아 빠르다)도 제한에 센다
      const r = await signup(signupBody('bad', { username: `rl${i}user` }));
      expect(r.status).toBe(400);
    }
    const r = await signup(signupBody(ticket, { username: 'rl_last' }));
    expect(r.status).toBe(429);
    expect(r.json).toMatchObject({ code: 'RATE_LIMITED' });
  });
});

describe('GET /api/auth/username-available', () => {
  it('쓸 수 있으면 available:true, 형식이 틀리거나 이미 있으면 false + 문장', async () => {
    await run("INSERT INTO users (username, name, password_hash) VALUES ('taken01', 't', 'x')");
    expect((await call('/api/auth/username-available?username=free_name1', 'GET')).json).toEqual({ available: true });
    expect((await call('/api/auth/username-available?username=taken01', 'GET')).json).toEqual({ available: false, reason: '이미 쓰고 있는 아이디예요.' });
    expect((await call('/api/auth/username-available?username=TAKEN01', 'GET')).json).toMatchObject({ available: false });
    const bad = await call('/api/auth/username-available?username=ab', 'GET');
    expect(bad.status).toBe(200);
    expect(bad.json).toMatchObject({ available: false });
    expect(typeof bad.json!.reason).toBe('string');
    expect((await call('/api/auth/username-available', 'GET')).json).toMatchObject({ available: false });
  });

  it('IP 기준 10분에 60번까지', async () => {
    for (let i = 0; i < 60; i++) expect((await call('/api/auth/username-available?username=free_name1', 'GET')).status).toBe(200);
    expect((await call('/api/auth/username-available?username=free_name1', 'GET')).status).toBe(429);
  });
});

describe('POST /api/auth/login', () => {
  const HASH = bcrypt.hashSync('Legacy-pw-1', 4);
  beforeEach(async () => {
    await run("INSERT INTO users (email, username, name, password_hash, is_admin) VALUES ('admin1@hansung.ac.kr', 'admin1', '관리자1', ?, TRUE)", [HASH]);
    await run("INSERT INTO users (username, name, password_hash) VALUES ('newbie01', '새사람', ?)", [bcrypt.hashSync('Legacy-pw-1', 4)]);
  });

  it('아이디로 로그인한다 → AuthUser, 이후 /me · 로그아웃', async () => {
    const r = await call('/api/auth/login', 'POST', { username: 'newbie01', password: 'Legacy-pw-1' });
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ id: expect.any(Number), username: 'newbie01', name: '새사람', isAdmin: false, email: null });
    expect((await call('/api/auth/me', 'GET', undefined, cookieOf(r))).json).toEqual(r.json);
    const out = await call('/api/auth/logout', 'POST');
    expect(out.status).toBe(200);
    expect(out.headers.getSetCookie().join(';')).toMatch(/token=;/);
  });

  it('옛 email 필드(학교 메일 꼴 또는 아이디만)도 받는다', async () => {
    for (const email of ['admin1@hansung.ac.kr', 'ADMIN1@Hansung.ac.kr', 'admin1']) {
      const r = await call('/api/auth/login', 'POST', { email, password: 'Legacy-pw-1' });
      expect(r.status, email).toBe(200);
      expect(r.json).toMatchObject({ username: 'admin1', email: 'admin1@hansung.ac.kr', isAdmin: true });
    }
  });

  it('틀린 비밀번호와 없는 아이디는 같은 문장의 401', async () => {
    const wrongPw = await call('/api/auth/login', 'POST', { username: 'newbie01', password: 'nope-nope-1' });
    const noUser = await call('/api/auth/login', 'POST', { username: 'ghost999', password: 'nope-nope-1' });
    expect(wrongPw.status).toBe(401);
    expect(noUser.status).toBe(401);
    expect(wrongPw.json).toEqual({ error: '아이디 또는 비밀번호가 올바르지 않습니다.' });
    expect(noUser.json).toEqual(wrongPw.json);
  });

  it('입력이 비면 400, 같은 IP+아이디로 10번 틀리면 429', async () => {
    expect((await call('/api/auth/login', 'POST', { username: '', password: 'x' })).status).toBe(400);
    expect((await call('/api/auth/login', 'POST', {})).status).toBe(400);
    for (let i = 0; i < 10; i++) expect((await call('/api/auth/login', 'POST', { username: 'newbie01', password: 'bad-bad-bad' })).status).toBe(401);
    expect((await call('/api/auth/login', 'POST', { username: 'newbie01', password: 'Legacy-pw-1' })).status).toBe(429);
  });
});

describe('학교 메일 가입 (EMAIL_SIGNUP_ENABLED)', () => {
  it('꺼져 있으면 /request-code 와 /signup-email 은 404 DISABLED', async () => {
    for (const url of ['/api/auth/request-code', '/api/auth/signup-email']) {
      const r = await call(url, 'POST', { email: 'a1@hansung.ac.kr', name: '홍길동', password: 'password1', code: '123456' });
      expect(r.status, url).toBe(404);
      expect(r.json).toEqual({ error: '학교 메일 가입은 지금 쓰지 않아요.', code: 'DISABLED' });
    }
    expect(await get('SELECT 1 FROM email_verifications')).toBeUndefined();
  });

  it('실제 앱(createApp)에서도 기본은 꺼져 있고 /api/auth 응답은 no-store 다', async () => {
    const r = await call('/api/auth/request-code', 'POST', { email: 'a1@hansung.ac.kr' }, undefined, fullBase);
    expect(r.status).toBe(404);
    expect(r.json).toMatchObject({ code: 'DISABLED' });
    expect(r.headers.get('cache-control')).toBe('no-store');
    const v = await call('/api/auth/username-available?username=abcd', 'GET', undefined, undefined, fullBase);
    expect(v.headers.get('cache-control')).toBe('no-store');
    expect(v.json).toEqual({ available: true });
  });

  it('켜면 예전처럼 코드로 가입하고, 아이디는 이메일 앞부분이며 겹치면 409', async () => {
    await startApp({ emailSignupEnabled: true });
    const code = async (email: string): Promise<string> => {
      logs = [];
      const r = await call('/api/auth/request-code', 'POST', { email });
      expect(r.status).toBe(200);
      const m = /인증코드: (\d{6})/.exec(logs.join('\n'));
      expect(m).not.toBeNull();
      return m![1];
    };
    const body = (email: string, c: string) => ({ email, name: '홍길동', password: 'password1', code: c });

    const email = 'gildong@hansung.ac.kr';
    const ok = await call('/api/auth/signup-email', 'POST', body(email, await code(email)));
    expect(ok.status).toBe(201);
    expect(ok.json).toMatchObject({ username: 'gildong', email, name: '홍길동', isAdmin: false });
    // 그 계정으로 아이디 로그인
    expect((await call('/api/auth/login', 'POST', { username: 'gildong', password: 'password1' })).status).toBe(200);

    // 같은 아이디(다른 사람이 아이디로 먼저 가입)면 409 — 코드를 쓰기 전에 거절
    await run("INSERT INTO users (username, name, password_hash) VALUES ('blocked1', 'b', 'x')");
    const email2 = 'blocked1@hansung.ac.kr';
    const c2 = await code(email2);
    const taken = await call('/api/auth/signup-email', 'POST', body(email2, c2));
    expect(taken.status).toBe(409);
    expect(taken.json).toMatchObject({ code: 'USERNAME_TAKEN' });

    // 탈퇴하면 이메일 인증 기록도 정리된다
    const cookie = cookieOf(ok);
    const del = await call('/api/auth/me', 'DELETE', { password: 'password1' }, cookie);
    expect(del.status).toBe(200);
  });
});

describe('탈퇴 (DELETE /api/auth/me)', () => {
  it('이메일이 없는 새 계정도 비밀번호 확인 뒤 탈퇴되고, 학번은 다시 가입할 수 있게 풀린다', async () => {
    const ticket = await ticketFor();
    const made = await signup(signupBody(ticket));
    expect(made.status).toBe(201);
    const cookie = cookieOf(made);
    expect((await call('/api/auth/me', 'DELETE', { password: 'wrong-wrong-1' }, cookie)).status).toBe(401);
    expect((await call('/api/auth/me', 'DELETE', { password: PLATFORM_PW }, cookie)).status).toBe(200);
    expect((await get<{ n: number }>('SELECT COUNT(*)::int AS n FROM users'))!.n).toBe(0);
    // 같은 학번으로 다시 인증·가입
    const again = await signup(signupBody(await ticketFor(), { username: 'minjae45' }));
    expect(again.status).toBe(201);
  });
});

describe('팀원 목록', () => {
  it('GET /api/meetings/:id 의 members 에 email 이 없다', async () => {
    const mk = (u: string, n: string) =>
      insert("INSERT INTO users (email, username, name, password_hash) VALUES (?, ?, ?, 'x') RETURNING id", [`${u}@hansung.ac.kr`, u, n]);
    const a = await mk('teamaa', '가나');
    const b = await mk('teambb', '다라');
    const meeting = await insert("INSERT INTO meetings (name, code, owner_id) VALUES ('팀', '4821', ?) RETURNING id", [a]);
    await run('INSERT INTO meeting_members (meeting_id, user_id) VALUES (?, ?), (?, ?)', [meeting, a, meeting, b]);
    const cookie = `token=${jwt.sign({ uid: a }, process.env.JWT_SECRET!)}`;
    const r = await call(`/api/meetings/${meeting}`, 'GET', undefined, cookie, fullBase);
    expect(r.status).toBe(200);
    const members = r.json!.members as Record<string, unknown>[];
    expect(members.map((m) => m.name).sort()).toEqual(['가나', '다라']);
    for (const m of members) {
      expect(Object.keys(m).sort()).toEqual(['id', 'isOwner', 'name']);
    }
    expect(r.text).not.toContain('hansung.ac.kr');
    expect(r.text).not.toContain('teamaa');
  });

  it('GET /api/dashboard 의 user 는 username 이 있고 email 은 null 일 수 있다', async () => {
    const id = await insert("INSERT INTO users (username, name, password_hash) VALUES ('dashuser', '대시', 'x') RETURNING id");
    const r = await call('/api/dashboard', 'GET', undefined, `token=${jwt.sign({ uid: id }, process.env.JWT_SECRET!)}`, fullBase);
    expect(r.status).toBe(200);
    expect(r.json!.user).toEqual({ id, username: 'dashuser', email: null, name: '대시', isAdmin: false });
  });
});

describe('학교 연동 (link) — v2 만, 학번 하나에 계정 하나', () => {
  const svc = () => createSchoolService({ fetch: fake.fetch, origins: () => SCHOOL_ORIGINS });
  const creds = { studentId: '2021204044', password: SCHOOL_PW };

  it('옛 v:1 요청은 400 INVALID(학교에 요청 안 함), 이미 저장된 v:1 행은 getLink 가 계속 돌려준다', async () => {
    const uid = await insert("INSERT INTO users (username, name, password_hash) VALUES ('linker01', 'l', 'x') RETURNING id");
    const v1 = { v: 1, iv: sealed().iv, ct: sealed().ct };
    await expect(svc().link(uid, { creds, cipher: v1 })).rejects.toMatchObject({ code: 'INVALID', message: '암호문 형식이 올바르지 않아요.' });
    expect(fake.state.calls.length).toBe(0);

    await run("UPDATE users SET school_cipher = ?, school_hint = '*******044', school_student_hash = ?, school_linked_at = now() WHERE id = ?", [JSON.stringify(v1), studentLinkHash('2021204044'), uid]);
    expect(await svc().getLink(uid)).toMatchObject({ linked: true, hint: '*******044', cipher: v1 });
  });

  it('다른 계정이 이미 연동한 학번으로 연동하면 학교 인증 뒤 409 SCHOOL_ALREADY_REGISTERED', async () => {
    const owner = await insert("INSERT INTO users (username, name, password_hash, school_student_hash) VALUES ('owner02', 'o', 'x', ?) RETURNING id", [studentLinkHash('2021204044')]);
    const other = await insert("INSERT INTO users (username, name, password_hash) VALUES ('other02', 'o', 'x') RETURNING id");
    await expect(svc().link(other, { creds, cipher: sealed() })).rejects.toMatchObject({ code: 'SCHOOL_ALREADY_REGISTERED', status: 409 });
    expect(fake.state.infoLogins).toBe(1);
    expect((await svc().getLink(other)).linked).toBe(false);
    // 주인은 다시 연동할 수 있다
    const c = sealed();
    expect((await svc().link(owner, { creds, cipher: c })).linked).toBe(true);
    expect((await svc().getLink(owner)).cipher).toEqual(c);
  });
});

describe('마이그레이션 결과 (새 DB)', () => {
  it('username 유니크 인덱스, 학번 부분 유니크 인덱스, email NULL 허용', async () => {
    const idx = (await all<{ indexname: string }>("SELECT indexname FROM pg_indexes WHERE tablename = 'users'")).map((r) => r.indexname);
    expect(idx).toContain('uq_users_username');
    expect(idx).toContain('uq_users_school_student_hash');
    await run("INSERT INTO users (username, name, password_hash) VALUES ('nullmail1', 'n', 'x'), ('nullmail2', 'n', 'x')"); // email NULL 둘
    await expect(run("INSERT INTO users (username, name, password_hash) VALUES ('nullmail1', 'n', 'x')")).rejects.toThrow(/duplicate|unique/i);
    await run("INSERT INTO users (username, name, password_hash, school_student_hash) VALUES ('h1', 'n', 'x', 'H')");
    await expect(run("INSERT INTO users (username, name, password_hash, school_student_hash) VALUES ('h2', 'n', 'x', 'H')")).rejects.toThrow(/duplicate|unique/i);
    await run("INSERT INTO users (username, name, password_hash) VALUES ('h3', 'n', 'x'), ('h4', 'n', 'x')"); // 해시 NULL 은 여럿
  });
});
