/**
 * 학교 연동 서비스 흐름 테스트 — 실제 DB(임시 PGlite)와 가짜 학교(testkit)만 쓴다. 실제 학교에는 접속하지 않는다.
 *
 * 증명하는 것
 *  - link / timetable import / reservations / book preview·submit 의 흐름과 DB 결과
 *  - 가드: 4회 실패까지 잠금 없음 → 5회째 30분 → 만료 뒤에도 횟수 유지 → 8회째 시간이 아니라 상태로 멈춤(몇 달이 지나도
 *    학교로 나가지 않음, 주인의 다시 연동 한 번만 예외) → 성공하면 초기화, 잠겨 있을 때는 학교에 요청이 0번 나간다
 *  - 자동 재시도 없음 (로그인·본 제출 횟수를 가짜 학교에서 센다)
 *  - 평문(학번·비밀번호)이 console·DB·응답 어디에도 없다
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import util from 'node:util';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { all, get, insert, ready, run } from '../db.js';
import { linkLimiter, schoolCallLimiter, studentHash, studentLinkHash } from './guard.js';
import { ApiInputError, SchoolAuthFailed, SchoolLocked, SchoolNotLinked, SchoolRejected, SchoolUnavailable } from './http.js';
import { createSchoolService } from './service.js';
import { createFakeSchool } from './testkit.js';
import type { FakeSchoolOptions } from './testkit.js';

// 임시 DB·고정 비밀. 개발 DB(DATABASE_URL)는 절대 쓰지 않는다.
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 's4-flow-'));
process.env.DATA_DIR = dataDir;
delete process.env.DATABASE_URL;
delete process.env.SCHOOL_MOCK_ORIGIN;
process.env.JWT_SECRET = 'test-secret-for-s4-flow-tests';

const STUDENT = '2021204044';
const PASSWORD = 'pw-SECRET-7f3a91';
const creds = { studentId: STUDENT, password: PASSWORD };

/** 2026-10-08(목) 10:00 KST. 예약은 2026-10-12(월) */
const NOW_BASE = Date.parse('2026-10-08T01:00:00Z');
const MIN = 60_000;
const DAY = 24 * 60 * MIN;
const RES_DATE = '2026-10-12';

let clock = NOW_BASE;
const now = (): number => clock;

const b64 = (n: number): string => Buffer.alloc(n, 7).toString('base64');
const cipher = { v: 2, iv: b64(12), ct: b64(32) };

let seq = 0;
async function makeUser(): Promise<number> {
  seq += 1;
  return insert("INSERT INTO users (email, name, password_hash) VALUES (?, ?, 'x') RETURNING id", [
    `flow${seq}-${Date.now()}@hansung.ac.kr`,
    `사용자${seq}`,
  ]);
}

async function makeReservation(
  uid: number,
  opts: { date?: string; startMin?: number; endMin?: number; campusName?: string; systemKey?: string; member?: boolean } = {},
): Promise<number> {
  const facility = await get<{ id: number }>('SELECT id FROM facilities WHERE system_key = ? AND campus_name = ?', [
    opts.systemKey ?? 'cncschool',
    opts.campusName ?? '소모임실 Challenge',
  ]);
  if (!facility) throw new Error('시설 시드가 없습니다.');
  const meeting = await insert('INSERT INTO meetings (name, code, owner_id) VALUES (?, ?, ?) RETURNING id', [
    '팀',
    String(1000 + (seq++ % 9000)),
    uid,
  ]);
  if (opts.member !== false) await run('INSERT INTO meeting_members (meeting_id, user_id) VALUES (?, ?)', [meeting, uid]);
  return insert(
    'INSERT INTO reservations (facility_id, meeting_id, user_id, date, start_min, end_min) VALUES (?, ?, ?, ?, ?, ?) RETURNING id',
    [facility.id, meeting, uid, opts.date ?? RES_DATE, opts.startMin ?? 600, opts.endMin ?? 720],
  );
}

function setup(opts: FakeSchoolOptions = {}) {
  const fake = createFakeSchool({ users: { [STUDENT]: PASSWORD }, names: { [STUDENT]: '박민재' }, ...opts });
  const svc = createSchoolService({ fetch: fake.fetch, now });
  return { fake, svc };
}

/** 사용자에게 학교 연동 상태를 만들어 준다 (link 를 거치지 않고 DB 에 직접) */
async function markLinked(uid: number, studentId = STUDENT): Promise<void> {
  await run("UPDATE users SET school_cipher = ?, school_hint = ?, school_student_hash = ?, school_linked_at = now() WHERE id = ?", [
    JSON.stringify(cipher),
    `${'*'.repeat(studentId.length - 3)}${studentId.slice(-3)}`,
    studentLinkHash(studentId),
    uid,
  ]);
}

function captureConsole() {
  const lines: string[] = [];
  const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) =>
    vi.spyOn(console, m).mockImplementation((...args: unknown[]) => {
      lines.push(args.map((a) => (typeof a === 'string' ? a : util.inspect(a, { depth: 6 }))).join(' '));
    }),
  );
  return {
    lines,
    restore: () => spies.forEach((s) => s.mockRestore()),
  };
}

const guardRow = (studentId = STUDENT) =>
  get<{ fails: number; lockedUntil: string | null }>(
    'SELECT fails, locked_until AS "lockedUntil" FROM school_login_guard WHERE student_hash = ?',
    [studentHash(studentId)],
  );

beforeAll(async () => {
  // 실수로 진짜 네트워크를 타면 바로 실패하게 한다
  vi.stubGlobal('fetch', () => {
    throw new Error('테스트에서 실제 네트워크는 쓸 수 없습니다.');
  });
  await ready();
}, 120_000);

afterAll(() => {
  vi.unstubAllGlobals();
  try {
    fs.rmSync(dataDir, { recursive: true, force: true });
  } catch {
    // Windows 에서 파일 잠금이 남아 있을 수 있다. 임시 폴더라 남겨 둬도 된다.
  }
});

let uid: number;
beforeEach(async () => {
  clock = NOW_BASE;
  await run('DELETE FROM school_login_guard');
  await run('DELETE FROM school_link_probe');
  // 학번 하나당 계정 하나(유니크 인덱스): 앞 테스트가 연동해 둔 학번을 풀어 줘서 테스트마다 같은 학번을 다시 연동할 수 있게 한다
  await run('UPDATE users SET school_student_hash = NULL, school_cipher = NULL, school_hint = NULL WHERE school_student_hash IS NOT NULL');
  uid = await makeUser();
  linkLimiter.clear(String(uid));
  schoolCallLimiter.clear(String(uid));
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ───────────────────────────────────────────────────────────────
describe('연동 (link)', () => {
  it('학교에 로그인을 1번만 하고 암호문·힌트·학과·입학년도만 저장한다', async () => {
    const { fake, svc } = setup();
    const res = await svc.link(uid, { creds, cipher });
    expect(res.linked).toBe(true);
    expect(res.hint).toBe('*******044');
    expect(res.profile).toMatchObject({ studentId: STUDENT, name: '박민재', department: 'AI응용학과', admissionYear: 2021 });
    expect(fake.state.infoLogins).toBe(1);
    expect(fake.state.resveLogins).toBe(0);

    const row = await get<Record<string, unknown>>('SELECT * FROM users WHERE id = ?', [uid]);
    expect(JSON.parse(row!.school_cipher as string)).toEqual(cipher);
    expect(row!.school_hint).toBe('*******044');
    expect(row!.school_student_hash).toBe(studentLinkHash(STUDENT)); // 학번 원문이 아니라 HMAC
    expect(row!.school_student_hash).not.toContain(STUDENT);
    expect(row!.school_department).toBe('AI응용학과');
    expect(row!.school_admission_year).toBe(2021);
    // 비밀번호는 어떤 열에도 없다
    expect(JSON.stringify(row)).not.toContain(PASSWORD);

    const status = await svc.getLink(uid);
    expect(status).toMatchObject({ linked: true, hint: '*******044', cipher, profileHint: { department: 'AI응용학과', admissionYear: 2021 } });
    expect(await guardRow()).toBeUndefined(); // 성공하면 가드 기록이 남지 않는다
  });

  it('연동 전에는 linked:false, 해제하면 서버의 암호문·힌트가 지워진다', async () => {
    const { svc } = setup();
    expect(await svc.getLink(uid)).toEqual({ linked: false, hint: null, linkedAt: null, cipher: null, profileHint: null });
    await svc.link(uid, { creds, cipher });
    expect((await svc.getLink(uid)).linked).toBe(true);
    expect(await svc.unlink(uid)).toEqual({ ok: true });
    const row = await get<Record<string, unknown>>('SELECT * FROM users WHERE id = ?', [uid]);
    expect(row).toMatchObject({ school_cipher: null, school_hint: null, school_student_hash: null, school_linked_at: null, school_department: null, school_admission_year: null });
    expect((await svc.getLink(uid)).linked).toBe(false);
  });

  it('비밀번호가 틀리면 AUTH_FAILED, 로그인은 딱 1번만 나가고 연동은 저장되지 않는다', async () => {
    const { fake, svc } = setup();
    await expect(svc.link(uid, { creds: { ...creds, password: 'wrong-pw-1' }, cipher })).rejects.toBeInstanceOf(SchoolAuthFailed);
    expect(fake.state.infoLogins).toBe(1); // 자동 재시도 없음
    expect((await svc.getLink(uid)).linked).toBe(false);
    expect((await guardRow())!.fails).toBe(1);
  });

  it('암호문 형식이 틀리면 학교에 요청하지 않는다', async () => {
    const { fake, svc } = setup();
    const bad = [
      { v: 1, iv: b64(12), ct: b64(32) },
      { v: 2, iv: b64(11), ct: b64(32) },
      { v: 2, iv: b64(12), ct: b64(16) },
      { v: 2, iv: b64(12), ct: b64(2049) },
      { v: 2, iv: 'not base64!', ct: b64(32) },
      null,
    ];
    for (const c of bad) {
      linkLimiter.clear(String(uid));
      await expect(svc.link(uid, { creds, cipher: c })).rejects.toBeInstanceOf(ApiInputError);
    }
    expect(fake.state.calls.length).toBe(0);
  });

  it('학번·비밀번호 형식이 틀리면 학교에 요청하지 않는다', async () => {
    const { fake, svc } = setup();
    for (const c of [
      { studentId: '12ab', password: 'x' },
      { studentId: STUDENT, password: '' },
      { studentId: STUDENT, password: 'x'.repeat(65) },
      { studentId: 20212040, password: 'x' },
      null,
    ]) {
      await expect(svc.link(uid, { creds: c, cipher })).rejects.toBeInstanceOf(ApiInputError);
    }
    expect(fake.state.calls.length).toBe(0);
  });

  it('연동은 사용자당 10분에 3번까지다', async () => {
    const { svc } = setup();
    for (let i = 0; i < 3; i++) await svc.link(uid, { creds, cipher });
    await expect(svc.link(uid, { creds, cipher })).rejects.toMatchObject({ code: 'RATE_LIMITED' });
  });

  it('학교가 점검 중이면 UNAVAILABLE 이고 실패로 세지 않는다', async () => {
    const { svc } = setup({ maintenance: true });
    await expect(svc.link(uid, { creds, cipher })).rejects.toBeInstanceOf(SchoolUnavailable);
    expect(await guardRow()).toBeUndefined();
  });

  it('네트워크가 끊겨도 재시도하지 않고 실패로 세지 않는다', async () => {
    const { fake, svc } = setup({ failNetwork: (r) => r.path.startsWith('/servlet/') });
    await expect(svc.link(uid, { creds, cipher })).rejects.toBeInstanceOf(SchoolUnavailable);
    expect(fake.state.calls.filter((c) => c.path.startsWith('/servlet/'))).toHaveLength(1);
    expect(await guardRow()).toBeUndefined();
  });
});

// ───────────────────────────────────────────────────────────────
describe('실패 가드 (5회 → 30분, 횟수 유지, 8회 → 시간이 아니라 상태로 멈춤)', () => {
  // 연동한 주인의 흐름이다 (아직 확인되지 않은 학번으로의 시도는 하루 상한이 따로 있다 — service.security.test.ts)
  beforeEach(async () => {
    await markLinked(uid);
  });

  it('4회 실패까지는 잠그지 않고, 5회째에 30분 잠그며, 잠금 중에는 학교에 요청이 0번 나간다', async () => {
    const { fake, svc } = setup();
    const wrong = { creds: { ...creds, password: 'wrong-pw-1' }, cipher };
    for (let i = 1; i <= 5; i++) {
      linkLimiter.clear(String(uid));
      await expect(svc.link(uid, wrong)).rejects.toBeInstanceOf(SchoolAuthFailed);
      expect((await guardRow())!.fails).toBe(i);
      expect(fake.state.infoLogins).toBe(i);
    }
    expect((await guardRow())!.lockedUntil).not.toBeNull();

    const before = fake.state.calls.length;
    for (let i = 0; i < 3; i++) {
      linkLimiter.clear(String(uid));
      // 비밀번호가 맞아도 잠금 중이면 학교에 가지 않는다
      await expect(svc.link(uid, { creds, cipher })).rejects.toBeInstanceOf(SchoolLocked);
    }
    expect(fake.state.calls.length).toBe(before);
    expect(fake.state.infoLogins).toBe(5);
  });

  it('잠금이 끝나도 횟수를 유지한다 (6번째 실패에 다시 30분), 8번째 실패에 시간이 아니라 상태로 멈춘다', async () => {
    const { fake, svc } = setup();
    const wrong = { creds: { ...creds, password: 'wrong-pw-1' }, cipher };
    for (let i = 1; i <= 5; i++) {
      linkLimiter.clear(String(uid));
      await expect(svc.link(uid, wrong)).rejects.toBeInstanceOf(SchoolAuthFailed);
    }
    clock += 31 * MIN; // 30분 잠금이 끝났다
    linkLimiter.clear(String(uid));
    await expect(svc.link(uid, wrong)).rejects.toBeInstanceOf(SchoolAuthFailed); // 6번째
    expect((await guardRow())!.fails).toBe(6); // 0 으로 돌아가지 않았다
    linkLimiter.clear(String(uid));
    await expect(svc.link(uid, wrong)).rejects.toBeInstanceOf(SchoolLocked); // 다시 잠김

    clock += 31 * MIN;
    linkLimiter.clear(String(uid));
    await expect(svc.link(uid, wrong)).rejects.toBeInstanceOf(SchoolAuthFailed); // 7번째
    clock += 31 * MIN;
    linkLimiter.clear(String(uid));
    await expect(svc.link(uid, wrong)).rejects.toBeInstanceOf(SchoolAuthFailed); // 8번째
    expect((await guardRow())!.fails).toBe(8);
    expect(fake.state.infoLogins).toBe(8); // 학교 한도(10회)에 닿기 전에 멈췄다

    // 저장된 비밀번호를 쓰는 모든 기능은 24시간·한 달·한 해가 지나도 학교로 나가지 않는다
    for (const later of [31 * MIN, 25 * 60 * MIN, 30 * DAY, 400 * DAY]) {
      clock += later;
      schoolCallLimiter.clear(String(uid));
      const err = await svc.timetablePreview(uid, creds).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(SchoolLocked);
      expect((err as SchoolLocked).long).toBe(true);
      expect((err as SchoolLocked).retryAfterSec).toBe(0);
      await expect(svc.myReservations(uid, creds)).rejects.toBeInstanceOf(SchoolLocked);
    }
    expect(fake.state.infoLogins).toBe(8);
    expect(fake.state.resveLogins).toBe(0);

    // 주인이 학교 포털에서 확인한 새 비밀번호로 다시 연동하면 딱 한 번 시도할 수 있고, 성공하면 모두 풀린다
    linkLimiter.clear(String(uid));
    await svc.link(uid, { creds, cipher });
    expect(fake.state.infoLogins).toBe(9);
    expect((await guardRow())!.fails).toBe(0);
    expect((await guardRow())!.lockedUntil).toBeNull();
    schoolCallLimiter.clear(String(uid));
    await expect(svc.timetablePreview(uid, creds)).resolves.toBeDefined();
  });

  it('주인의 다시 연동 한 번이 틀리면 완전 중단: 이후 어떤 요청도 학교로 나가지 않는다 (학교 실패는 우리가 만든 것만 9회)', async () => {
    const { fake, svc } = setup();
    const wrong = { creds: { ...creds, password: 'wrong-pw-1' }, cipher };
    for (let i = 1; i <= 8; i++) {
      linkLimiter.clear(String(uid));
      await expect(svc.link(uid, wrong)).rejects.toBeInstanceOf(SchoolAuthFailed);
      clock += 31 * MIN;
    }
    expect(fake.state.infoLogins).toBe(8);
    linkLimiter.clear(String(uid));
    await expect(svc.link(uid, wrong)).rejects.toBeInstanceOf(SchoolAuthFailed); // 다시 연동 한 번, 틀렸다
    expect(fake.state.infoLogins).toBe(9);
    expect((await guardRow())!.fails).toBe(9);

    clock += 100 * DAY;
    for (let i = 0; i < 3; i++) {
      linkLimiter.clear(String(uid));
      schoolCallLimiter.clear(String(uid));
      // 이번에는 맞는 비밀번호여도 열리지 않는다 — 운영자가 풀어 주어야 한다
      const err = await svc.link(uid, { creds, cipher }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(SchoolLocked);
      expect((err as SchoolLocked).needsRelink).toBe(false);
      await expect(svc.timetablePreview(uid, creds)).rejects.toBeInstanceOf(SchoolLocked);
    }
    expect(fake.state.infoLogins).toBe(9);
  });

  it('중간에 성공하면 연속 실패 횟수가 0 으로 돌아간다', async () => {
    const { svc } = setup();
    for (let i = 0; i < 3; i++) {
      linkLimiter.clear(String(uid));
      await expect(svc.link(uid, { creds: { ...creds, password: 'wrong-pw-1' }, cipher })).rejects.toBeInstanceOf(SchoolAuthFailed);
    }
    expect((await guardRow())!.fails).toBe(3);
    linkLimiter.clear(String(uid));
    await svc.link(uid, { creds, cipher });
    expect((await guardRow())!.fails).toBe(0);
  });

  it('DB 에는 학번 원문이 없다 (해시만)', async () => {
    const { svc } = setup();
    await expect(svc.link(uid, { creds: { ...creds, password: 'wrong-pw-1' }, cipher })).rejects.toBeInstanceOf(SchoolAuthFailed);
    const rows = await all('SELECT * FROM school_login_guard');
    expect(JSON.stringify(rows)).not.toContain(STUDENT);
    expect(JSON.stringify(await all('SELECT * FROM school_link_probe'))).not.toContain(STUDENT);
    expect(rows).toHaveLength(1);
    expect((rows[0] as { student_hash: string }).student_hash).toBe(studentHash(STUDENT));
    expect((rows[0] as { student_hash: string }).student_hash).toMatch(/^[0-9a-f]{64}$/);
  });
});

// ───────────────────────────────────────────────────────────────
describe('학교 시간표', () => {
  it('연동하지 않았거나 다른 학번이면 학교에 요청하지 않는다', async () => {
    const { fake, svc } = setup();
    await expect(svc.timetablePreview(uid, creds)).rejects.toBeInstanceOf(SchoolNotLinked);
    await markLinked(uid);
    await expect(svc.timetablePreview(uid, { studentId: '2022111055', password: 'x' })).rejects.toBeInstanceOf(SchoolNotLinked);
    expect(fake.state.calls.length).toBe(0);
  });

  it('미리보기: 중복 수업은 하나로, 주말은 건너뛰고, 30분 격자에 맞춘 수업 수를 알려 준다', async () => {
    const { fake, svc } = setup();
    await markLinked(uid);
    const p = await svc.timetablePreview(uid, creds);
    expect(p.profile).toMatchObject({ studentId: STUDENT, name: '박민재', department: 'AI응용학과' });
    expect(p.classes.map((c) => `${c.day} ${c.start}-${c.end} ${c.subject}`)).toEqual(['0 09:15-10:45 자료구조', '2 13:00-15:00 운영체제']);
    expect(p.adjusted).toBe(1); // 09:15~10:45 → 09:00~11:00
    expect(p.skipped.map((s) => s.subject)).toEqual(['주말특강']);
    expect(fake.state.infoLogins).toBe(1);
    // 미리보기는 저장하지 않는다
    expect(await all('SELECT 1 FROM timetable_entries WHERE user_id = ?', [uid])).toHaveLength(0);
  });

  it('가져오기: 이전에 가져온 일정만 바꾸고 직접 입력한 일정은 건드리지 않는다', async () => {
    const { svc } = setup();
    await markLinked(uid);
    await run("INSERT INTO timetable_entries (user_id, day, start_min, end_min, title, place) VALUES (?, 1, 600, 660, '알바', '편의점')", [uid]);

    const first = await svc.timetableImport(uid, creds);
    expect(first).toMatchObject({ imported: 2, replaced: 0, adjusted: 1 });
    let rows = await all<{ title: string; source: string; day: number; start_min: number; end_min: number; place: string; repeat_kind: string }>(
      'SELECT title, source, day, start_min, end_min, place, repeat_kind FROM timetable_entries WHERE user_id = ? ORDER BY day, start_min',
      [uid],
    );
    expect(rows.map((r) => `${r.source}:${r.title}`)).toEqual(['school:자료구조', 'manual:알바', 'school:운영체제']);
    expect(rows[0]).toMatchObject({ day: 0, start_min: 540, end_min: 660, place: '공학관 B101', repeat_kind: 'weekly' });

    const second = await svc.timetableImport(uid, creds);
    expect(second).toMatchObject({ imported: 2, replaced: 2 });
    rows = await all('SELECT title, source FROM timetable_entries WHERE user_id = ? ORDER BY day, start_min', [uid]);
    expect(rows).toHaveLength(3); // 교체이지 누적이 아니다
    expect(rows.filter((r) => r.source === 'school')).toHaveLength(2);
    expect(rows.filter((r) => r.source === 'manual')).toEqual([{ title: '알바', source: 'manual' }]);
    expect(await all("SELECT 1 FROM timetable_entries WHERE source LIKE 'school-new-%'")).toHaveLength(0); // 임시 표시가 남지 않는다
  });

  it('시간표를 받다가 실패하면 기존 가져온 일정이 그대로 남는다', async () => {
    const good = setup();
    await markLinked(uid);
    await good.svc.timetableImport(uid, creds);

    const bad = setup({ failNetwork: (r) => r.path.includes('dae_sigan_main_data') });
    await expect(bad.svc.timetableImport(uid, creds)).rejects.toBeInstanceOf(SchoolUnavailable);
    const rows = await all<{ source: string }>('SELECT source FROM timetable_entries WHERE user_id = ?', [uid]);
    expect(rows.map((r) => r.source)).toEqual(['school', 'school']);
    expect(bad.fake.state.infoLogins).toBe(1); // 실패해도 다시 로그인하지 않는다
  });

  it('다른 사용자의 일정은 건드리지 않는다', async () => {
    const { svc } = setup();
    await markLinked(uid);
    const other = await makeUser();
    await run("INSERT INTO timetable_entries (user_id, day, start_min, end_min, title, source) VALUES (?, 0, 540, 600, '남의 수업', 'school')", [other]);
    await svc.timetableImport(uid, creds);
    expect(await all('SELECT 1 FROM timetable_entries WHERE user_id = ?', [other])).toHaveLength(1);
  });
});

// ───────────────────────────────────────────────────────────────
describe('내 학교 예약 (reservations)', () => {
  it('사이트마다 로그인을 한 번씩만 하고 같은 사이트의 키는 로그인을 공유한다', async () => {
    const { fake, svc } = setup();
    await markLinked(uid);
    const res = await svc.myReservations(uid, creds);
    expect(res.failed).toEqual([]);
    // cncschool(6개 키) + onestop + hsel = 3개 사이트
    expect(fake.state.resveLogins).toBe(3);
    expect(fake.state.infoLogins).toBe(0);
    const mineCalls = fake.state.calls.filter((c) => c.path.endsWith('/artclView.do'));
    expect(mineCalls.length).toBe(8); // 키마다 신청내역 조회 1번(신청이 없으면 1쪽)
  });

  it('비밀번호가 틀리면 첫 로그인에서 멈춘다 (다른 사이트로 계속 두드리지 않는다)', async () => {
    const { fake, svc } = setup();
    await markLinked(uid);
    await expect(svc.myReservations(uid, { ...creds, password: 'wrong-pw-1' })).rejects.toBeInstanceOf(SchoolAuthFailed);
    expect(fake.state.resveLogins).toBe(1);
    expect((await guardRow())!.fails).toBe(1);
  });

  it('학교가 점검 중이면 시스템별로 failed 에 담고 실패로 세지 않는다', async () => {
    const { fake, svc } = setup({ maintenance: true });
    await markLinked(uid);
    const res = await svc.myReservations(uid, creds);
    expect(res.reservations).toEqual([]);
    expect(res.failed).toHaveLength(8);
    expect(res.failed[0].reason).toContain('학교');
    expect(fake.state.resveLogins).toBe(0);
    expect(await guardRow()).toBeUndefined();
  });

  it('신청 흐름이 확인되지 않은 사이트(hsel)의 로그인이 안 돼도 비밀번호 오류로 알리지 않고, 24시간 동안 다시 시도하지 않는다 (DB — 서버 인스턴스가 바뀌어도)', async () => {
    const S2 = '2018777888';
    const pw2 = 'pw-two-SECRET-55';
    const fake = createFakeSchool({ users: { [S2]: pw2 }, names: { [S2]: '김하나' } });
    let hselLogins = 0;
    const fetchWrapped = async (url: string, init: RequestInit): Promise<Response> => {
      if (url.includes('/hnuLogin/hsel/loginProcess.do')) {
        hselLogins += 1; // 이 사이트는 맞는 비밀번호에도 로그인 쿠키를 주지 않는다고 가정
        return new Response(null, { status: 302, headers: { location: '/hnuLogin/hsel/loginView.do' } });
      }
      return fake.fetch(url, init);
    };
    const svc = createSchoolService({ fetch: fetchWrapped, now });
    await markLinked(uid, S2);
    const c2 = { studentId: S2, password: pw2 };

    const first = await svc.myReservations(uid, c2);
    expect(first.failed.map((f) => f.facility)).toEqual(['hsel/14']);
    expect(first.failed[0].reason).toContain('확인되지 않아');
    expect(first.failed[0].reason).not.toContain('맞지 않아요'); // 비밀번호가 틀렸다고 알리지 않는다
    expect(hselLogins).toBe(1);
    expect(fake.state.resveLogins).toBe(2); // 확인된 사이트(cncschool, onestop)는 정상
    // hsel 의 실패는 이 학번의 공유 실패 횟수에 세지 않는다 (확인된 사이트의 성공이 0 으로 되돌리는 것과 상관없이)
    expect((await guardRow(S2))?.fails ?? 0).toBe(0);

    schoolCallLimiter.clear(String(uid));
    const second = await svc.myReservations(uid, c2);
    expect(second.failed.map((f) => f.facility)).toEqual(['hsel/14']);
    expect(hselLogins).toBe(1); // 건너뛰었다 — 학교로 로그인이 또 나가지 않았다

    // 서버리스처럼 새 인스턴스(메모리가 비어 있다)가 떠도 DB 의 기록 때문에 여전히 건너뛴다
    const svc2 = createSchoolService({ fetch: fetchWrapped, now });
    clock += 23 * 60 * MIN;
    schoolCallLimiter.clear(String(uid));
    const third = await svc2.myReservations(uid, c2);
    expect(third.failed.map((f) => f.facility)).toEqual(['hsel/14']);
    expect(hselLogins).toBe(1);

    clock += 2 * 60 * MIN; // 24시간이 지났다
    schoolCallLimiter.clear(String(uid));
    await svc2.myReservations(uid, c2);
    expect(hselLogins).toBe(2);
    expect((await guardRow(S2))?.fails ?? 0).toBe(0);
  });

  it('신청내역이 있으면 시스템 이름과 함께 돌려주고 이름·학번은 내보내지 않는다', async () => {
    const { fake, svc } = setup();
    await markLinked(uid);
    fake.state.mine.set('cncschool/2', new Map([[STUDENT, [['501', '소모임실 Challenge', RES_DATE, '10:00~12:00', '박민재', STUDENT, '2026-10-08', '승인대기']]]]));
    const res = await svc.myReservations(uid, creds);
    expect(res.reservations).toEqual([
      { facility: 'cncschool/2', facilityLabel: '상상파크 플러스 (공학관)', no: '501', space: '소모임실 Challenge', date: RES_DATE, time: '10:00~12:00', status: '승인대기', applied: '2026-10-08' },
    ]);
    expect(JSON.stringify(res)).not.toContain('박민재');
    expect(JSON.stringify(res)).not.toContain(STUDENT);
  });
});

// ───────────────────────────────────────────────────────────────
describe('바로 신청 — 미리보기', () => {
  it('신청할 수 있는 예약은 학교 신청 화면의 정보와 함께 canBook=true', async () => {
    const { fake, svc } = setup({ items: [{ itemNm: '소속', mustYn: 'Y' }, { itemNm: '사용 목적', mustYn: 'N' }] });
    await markLinked(uid);
    const rid = await makeReservation(uid);
    const p = await svc.bookPreview(uid, { creds, reservationId: rid });
    expect(p).toMatchObject({
      reservationId: rid,
      title: '상상파크 플러스 (공학관) · 소모임실 Challenge',
      when: '10월 12일 (월) 10:00~12:00 (60분 × 2칸)',
      applicant: { name: '박민재', studentId: STUDENT, tel: '010-1111-2222', email: 'a&b@hansung.ac.kr' },
      identities: ['학사(재학생)', '학사(졸업생)'],
      manager: '홍담당 02-760-4800',
      items: [{ name: '소속', required: true }, { name: '사용 목적', required: false }],
      canBook: true,
      reason: null,
      alreadySubmitted: false,
    });
    expect(fake.state.resveLogins).toBe(1); // 미리보기도 로그인은 한 번
    expect(fake.state.registPosts).toHaveLength(0); // 미리보기는 아무것도 제출하지 않는다
  });

  it('그 회의의 멤버가 아니면 거절, 없는 예약은 404', async () => {
    const { fake, svc } = setup();
    await markLinked(uid);
    const owner = await makeUser();
    const rid = await makeReservation(owner);
    await expect(svc.bookPreview(uid, { creds, reservationId: rid })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(svc.bookPreview(uid, { creds, reservationId: 99999999 })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(fake.state.calls.length).toBe(0);
  });

  it.each([
    ['학교 예약 시스템에 연결되지 않은 시설', async () => {
      const facility = await insert("INSERT INTO facilities (name, building, capacity, system_key, campus_name) VALUES ('임의 시설', '어딘가', 4, 'nowhere', '임의') RETURNING id");
      const meeting = await insert("INSERT INTO meetings (name, code, owner_id) VALUES ('팀', ?, ?) RETURNING id", [String(2000 + (seq++ % 7000)), uid]);
      await run('INSERT INTO meeting_members (meeting_id, user_id) VALUES (?, ?)', [meeting, uid]);
      return insert('INSERT INTO reservations (facility_id, meeting_id, user_id, date, start_min, end_min) VALUES (?, ?, ?, ?, 600, 720) RETURNING id', [facility, meeting, uid, RES_DATE]);
    }, '연결되어 있지 않'],
    ['이미 지난 날짜', () => makeReservation(uid, { date: '2026-10-01' }), '지난 날짜'],
    ['슬롯 단위에 안 맞는 길이', () => makeReservation(uid, { startMin: 600, endMin: 630 }), '60분 단위'],
    ['운영하지 않는 요일(토요일)', () => makeReservation(uid, { date: '2026-10-10' }), '신청할 수 없'],
  ])('canBook=false 이유: %s — 로그인하지 않는다', async (_name, create, reason) => {
    const { fake, svc } = setup();
    await markLinked(uid);
    const rid = await create();
    const p = await svc.bookPreview(uid, { creds, reservationId: rid });
    expect(p.canBook).toBe(false);
    expect(p.reason).toContain(reason);
    expect(fake.state.resveLogins).toBe(0);
  });

  it('학교에 이미 예약된 시간이 있으면 canBook=false', async () => {
    const { fake, svc } = setup({ booked: { [`cncschool/2|47|${RES_DATE}`]: ['11:00'] } });
    await markLinked(uid);
    const rid = await makeReservation(uid);
    const p = await svc.bookPreview(uid, { creds, reservationId: rid });
    expect(p.canBook).toBe(false);
    expect(p.reason).toContain('11:00');
    expect(p.reason).toContain('이미 예약');
    expect(fake.state.resveLogins).toBe(0);
  });
});

// ───────────────────────────────────────────────────────────────
describe('바로 신청 — 제출', () => {
  const items = { 소속: 'AI응용학과', '사용 목적': '팀 프로젝트' };
  const itemDefs = [{ itemNm: '소속', mustYn: 'Y' }, { itemNm: '사용 목적', mustYn: 'N' }];

  it('서버 검증 → 본 제출 → 내 신청내역에서 확인되면 confirmed 이고 우리 예약도 학교 확인됨', async () => {
    const { fake, svc } = setup({ items: itemDefs });
    await markLinked(uid);
    const rid = await makeReservation(uid);
    const res = await svc.bookSubmit(uid, { creds, reservationId: rid, items });
    expect(res.status).toBe('confirmed');
    expect(res.found).toHaveLength(1);
    expect(res.found[0]).toMatchObject({ facility: 'cncschool/2', space: '소모임실 Challenge', date: RES_DATE });
    expect(JSON.stringify(res)).not.toContain(PASSWORD);

    expect(fake.state.resveLogins).toBe(1);
    const posts = fake.state.registPosts;
    expect(posts.map((p) => p.ajax)).toEqual([true, false]); // 서버 검증 1번, 본 제출 1번
    expect(posts[0].pairs[0]).toEqual(['layout', '']); // 검증은 layout 을 비워 보낸다
    expect(posts[1].pairs[0]).toEqual(['layout', 'abc123']);
    // 필드 순서 (파이썬 build_payload 와 같다) · resveTm 반복 · 추가 항목
    expect(posts[1].pairs.map(([k]) => k)).toEqual([
      'layout', 'siteId', 'fnctNo', 'lmttYn', 'groupNm', 'spceNm', 'selDay', 'posblDay', 'posblTerm', 'posblBgnde', 'posblEndde',
      'resveGroupSeq', 'userNm', 'hakbun', 'addItemCnt', 'group', 'resveSpceSeq', 'mngr', 'mngrTelno', 'resveDeStr', 'identityCode',
      'resveTm', 'resveTm', 'telno', 'email', 'addItemMustYn1', 'addItem1', 'addItemMustYn2', 'addItem2',
    ]);
    const form = Object.fromEntries(posts[1].pairs.filter(([k]) => k !== 'resveTm'));
    expect(form).toMatchObject({ siteId: 'cncschool', fnctNo: '2', lmttYn: 'N', selDay: '월', resveSpceSeq: '47', resveDeStr: RES_DATE, addItem1: 'AI응용학과', addItem2: '팀 프로젝트', addItemMustYn1: 'Y' });
    expect(posts[1].pairs.filter(([k]) => k === 'resveTm').map(([, v]) => v)).toEqual(['10:00', '11:00']);
    expect(posts[0].referer).toContain('/resve/cncschool/2/artclRegistWrap.do'); // 리다이렉트를 따라간 최종 주소

    const booking = await get<{ status: string }>('SELECT status FROM school_bookings WHERE reservation_id = ?', [rid]);
    expect(booking!.status).toBe('confirmed');
    const r = await get<{ school_status: string }>('SELECT school_status FROM reservations WHERE id = ?', [rid]);
    expect(r!.school_status).toBe('confirmed');
  });

  it('같은 예약을 다시 제출하면 학교에 가지 않고 거절한다 (미리보기에도 alreadySubmitted)', async () => {
    const { fake, svc } = setup({ items: itemDefs });
    await markLinked(uid);
    const rid = await makeReservation(uid);
    await svc.bookSubmit(uid, { creds, reservationId: rid, items });
    const callsAfterFirst = fake.state.calls.length;

    await expect(svc.bookSubmit(uid, { creds, reservationId: rid, items })).rejects.toBeInstanceOf(SchoolRejected);
    const p = await svc.bookPreview(uid, { creds, reservationId: rid });
    expect(p).toMatchObject({ canBook: false, alreadySubmitted: true });
    expect(fake.state.calls.length).toBe(callsAfterFirst); // 학교로 나간 요청이 늘지 않았다
    expect(fake.state.registPosts.filter((p) => !p.ajax)).toHaveLength(1);
  });

  it('동시에 두 번 눌러도 학교에는 한 번만 보낸다', async () => {
    const { fake, svc } = setup({ items: itemDefs });
    await markLinked(uid);
    const rid = await makeReservation(uid);
    const results = await Promise.allSettled([
      svc.bookSubmit(uid, { creds, reservationId: rid, items }),
      svc.bookSubmit(uid, { creds, reservationId: rid, items }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(fake.state.registPosts.filter((p) => !p.ajax)).toHaveLength(1);
    expect(await all("SELECT 1 FROM school_bookings WHERE reservation_id = ? AND status IN ('submitted','confirmed','unknown')", [rid])).toHaveLength(1);
  });

  it('내 신청내역에서 확인하지 못하면 unknown 이고 자동으로 다시 보내지 않는다', async () => {
    const { fake, svc } = setup({ items: itemDefs, dropBooking: true });
    await markLinked(uid);
    const rid = await makeReservation(uid);
    const res = await svc.bookSubmit(uid, { creds, reservationId: rid, items });
    expect(res.status).toBe('unknown');
    expect(res.found).toEqual([]);
    expect(res.message).toContain('학교 사이트');
    expect(fake.state.registPosts.filter((p) => !p.ajax)).toHaveLength(1);
    expect((await get<{ status: string }>('SELECT status FROM school_bookings WHERE reservation_id = ?', [rid]))!.status).toBe('unknown');
    expect((await get<{ school_status: string }>('SELECT school_status FROM reservations WHERE id = ?', [rid]))!.school_status).toBe('planned');

    // unknown 인 예약은 다시 보내지 못한다
    await expect(svc.bookSubmit(uid, { creds, reservationId: rid, items })).rejects.toBeInstanceOf(SchoolRejected);
    expect(fake.state.registPosts.filter((p) => !p.ajax)).toHaveLength(1);
    expect(fake.state.resveLogins).toBe(1);
  });

  it('본 제출 요청이 네트워크 오류로 끊겨도 재전송하지 않고 unknown', async () => {
    const { fake, svc } = setup({
      items: itemDefs,
      failNetwork: (r) => r.method === 'POST' && r.path.endsWith('/artclRegist.do') && r.headers['x-requested-with'] !== 'XMLHttpRequest',
    });
    await markLinked(uid);
    const rid = await makeReservation(uid);
    const res = await svc.bookSubmit(uid, { creds, reservationId: rid, items });
    expect(res.status).toBe('unknown');
    const registerPosts = fake.state.calls.filter((c) => c.method === 'POST' && c.path.endsWith('/artclRegist.do'));
    expect(registerPosts).toHaveLength(2); // 서버 검증 1번 + 끊긴 본 제출 1번 — 그 뒤 재전송 없음
    expect((await get<{ status: string }>('SELECT status FROM school_bookings WHERE reservation_id = ?', [rid]))!.status).toBe('unknown');
  });

  it('서버 검증이 오류를 주면 SCHOOL_REJECTED + 학교 문장 그대로, 본 제출은 하지 않고 다시 시도할 수 있다', async () => {
    const { fake, svc } = setup({ items: itemDefs, validationBody: '[{"resveTm":"이미 예약된 시간입니다."},{"addItem1":"소속은 필수입니다."}]' });
    await markLinked(uid);
    const rid = await makeReservation(uid);
    const err = await svc.bookSubmit(uid, { creds, reservationId: rid, items }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SchoolRejected);
    expect((err as SchoolRejected).message).toBe('이미 예약된 시간입니다. / 소속은 필수입니다.');
    expect(fake.state.registPosts.filter((p) => !p.ajax)).toHaveLength(0);
    expect((await get<{ status: string }>('SELECT status FROM school_bookings WHERE reservation_id = ?', [rid]))!.status).toBe('failed');

    // 보내지 않았으므로 고쳐서 다시 신청할 수 있다
    fake.state.opts.validationBody = undefined;
    schoolCallLimiter.clear(String(uid));
    const retry = await svc.bookSubmit(uid, { creds, reservationId: rid, items });
    expect(retry.status).toBe('confirmed');
  });

  it('서버 검증 응답을 읽을 수 없으면 신청하지 않고 UNAVAILABLE', async () => {
    const { fake, svc } = setup({ items: itemDefs, validationBody: '<html>오류 페이지</html>' });
    await markLinked(uid);
    const rid = await makeReservation(uid);
    await expect(svc.bookSubmit(uid, { creds, reservationId: rid, items })).rejects.toBeInstanceOf(SchoolUnavailable);
    expect(fake.state.registPosts.filter((p) => !p.ajax)).toHaveLength(0);
  });

  it('필수 항목이 비어 있으면 학교에 로그인하기 전에 거절한다', async () => {
    const { fake, svc } = setup({ items: itemDefs });
    await markLinked(uid);
    const rid = await makeReservation(uid);
    await expect(svc.bookSubmit(uid, { creds, reservationId: rid, items: { '사용 목적': '팀 프로젝트' } })).rejects.toBeInstanceOf(ApiInputError);
    expect(fake.state.resveLogins).toBe(0);
    expect(await all('SELECT 1 FROM school_bookings WHERE reservation_id = ?', [rid])).toHaveLength(0);
  });

  it('입력 형식(추가 항목 길이·연락처·이메일)을 검사한다', async () => {
    const { fake, svc } = setup({ items: itemDefs });
    await markLinked(uid);
    const rid = await makeReservation(uid);
    for (const bad of [
      { items: { 소속: 'x'.repeat(201) } },
      { items: ['소속'] },
      { items: { 소속: 1 } },
      { items, tel: '010-abcd' },
      { items, email: 'not-an-email' },
      { items, reservationId: 0 },
      { items, reservationId: '1' },
    ]) {
      await expect(svc.bookSubmit(uid, { creds, reservationId: rid, ...bad })).rejects.toBeInstanceOf(ApiInputError);
    }
    expect(fake.state.calls.length).toBe(0);
  });

  it('로그인이 실패하면 보내지 않았으므로 failed 로 남기고 재시도하지 않는다', async () => {
    const { fake, svc } = setup({ items: itemDefs });
    await markLinked(uid);
    const rid = await makeReservation(uid);
    await expect(svc.bookSubmit(uid, { creds: { ...creds, password: 'wrong-pw-1' }, reservationId: rid, items })).rejects.toBeInstanceOf(SchoolAuthFailed);
    expect(fake.state.resveLogins).toBe(1);
    expect(fake.state.registPosts).toHaveLength(0);
    expect((await get<{ status: string }>('SELECT status FROM school_bookings WHERE reservation_id = ?', [rid]))!.status).toBe('failed');
  });

  it('이미 학교에서 확인된 예약은 다시 신청하지 않는다', async () => {
    const { fake, svc } = setup({ items: itemDefs });
    await markLinked(uid);
    const rid = await makeReservation(uid);
    await run("UPDATE reservations SET school_status = 'confirmed' WHERE id = ?", [rid]);
    const p = await svc.bookPreview(uid, { creds, reservationId: rid });
    expect(p.canBook).toBe(false);
    await expect(svc.bookSubmit(uid, { creds, reservationId: rid, items })).rejects.toBeInstanceOf(SchoolRejected);
    expect(fake.state.registPosts).toHaveLength(0);
  });
});

// ───────────────────────────────────────────────────────────────
describe('평문 누출 없음', () => {
  it('실패·성공 흐름을 돌려도 console·DB·응답 어디에도 비밀번호와 학번이 없다', async () => {
    const cap = captureConsole();
    const responses: unknown[] = [];
    const errors: unknown[] = [];
    try {
      const wrong = { ...creds, password: 'wrong-PW-leakcheck-1' };
      const items = { 소속: 'AI응용학과' };
      const itemDefs = [{ itemNm: '소속', mustYn: 'Y' }];
      const scenarios: { name: string; opts: FakeSchoolOptions; run: (svc: ReturnType<typeof createSchoolService>, rid: number) => Promise<unknown> }[] = [
        { name: 'link 성공', opts: {}, run: (s) => s.link(uid, { creds, cipher }) },
        { name: 'link 틀린 비밀번호', opts: {}, run: (s) => s.link(uid, { creds: wrong, cipher }) },
        { name: 'link 점검', opts: { maintenance: true }, run: (s) => s.link(uid, { creds, cipher }) },
        { name: 'link 네트워크 오류', opts: { failNetwork: () => true }, run: (s) => s.link(uid, { creds, cipher }) },
        { name: '시간표 가져오기', opts: {}, run: (s) => s.timetableImport(uid, creds) },
        { name: '시간표 틀린 비밀번호', opts: {}, run: (s) => s.timetablePreview(uid, { ...wrong, studentId: STUDENT }) },
        { name: '내 예약', opts: {}, run: (s) => s.myReservations(uid, creds) },
        { name: '내 예약 틀린 비밀번호', opts: {}, run: (s) => s.myReservations(uid, wrong) },
        { name: '내 예약 점검', opts: { maintenance: true }, run: (s) => s.myReservations(uid, creds) },
        { name: '신청 미리보기', opts: { items: itemDefs }, run: (s, rid) => s.bookPreview(uid, { creds, reservationId: rid }) },
        { name: '신청 검증 거절', opts: { items: itemDefs, validationBody: '[{"a":"거절됨"}]' }, run: (s, rid) => s.bookSubmit(uid, { creds, reservationId: rid, items }) },
        { name: '신청 성공', opts: { items: itemDefs }, run: (s, rid) => s.bookSubmit(uid, { creds, reservationId: rid, items }) },
        { name: '신청 틀린 비밀번호', opts: { items: itemDefs }, run: (s, rid) => s.bookSubmit(uid, { creds: wrong, reservationId: rid, items }) },
      ];
      await markLinked(uid);
      for (const sc of scenarios) {
        await run('DELETE FROM school_login_guard');
        linkLimiter.clear(String(uid));
        schoolCallLimiter.clear(String(uid));
        const rid = await makeReservation(uid);
        const { svc } = setup(sc.opts);
        try {
          responses.push(await sc.run(svc, rid));
        } catch (e) {
          errors.push(e);
          cap.lines.push(util.inspect(e, { depth: 6 })); // 전역 오류 처리기(console.error(err))가 찍을 내용과 같다
        }
      }
    } finally {
      cap.restore();
    }

    const secrets = [PASSWORD, 'wrong-PW-leakcheck-1', STUDENT];
    const haystacks: [string, string][] = [
      ['console', cap.lines.join('\n')],
      ['응답', JSON.stringify(responses)],
      ['오류 메시지', errors.map((e) => `${(e as Error).name} ${(e as Error).message}`).join('\n')],
      ['DB(users 외 학교 테이블)', JSON.stringify(await all('SELECT * FROM school_login_guard')) + JSON.stringify(await all('SELECT * FROM school_bookings'))],
      ['DB(users)', JSON.stringify(await all('SELECT * FROM users WHERE id = ?', [uid]))],
      ['DB(시간표·예약)', JSON.stringify(await all('SELECT * FROM timetable_entries WHERE user_id = ?', [uid])) + JSON.stringify(await all('SELECT * FROM reservations WHERE user_id = ?', [uid]))],
    ];
    expect(errors.length).toBeGreaterThan(5); // 실패 흐름이 실제로 돌았는지
    for (const [where, text] of haystacks) {
      for (const s of secrets) {
        // 학번은 응답(내 정보)과 users.school_hint 밖에서는 안 나와야 한다. 힌트(끝 3자리)만 허용.
        if (s === STUDENT && (where === '응답' || where === 'DB(users)')) continue;
        expect(text, `${where} 에 '${s === PASSWORD ? '비밀번호' : s === STUDENT ? '학번' : '틀린 비밀번호'}' 가 있습니다`).not.toContain(s);
      }
    }
    // 응답에는 암호문(cipher)도 없다 (GET /link 를 빼면)
    expect(JSON.stringify(responses)).not.toContain(cipher.ct);
    expect(JSON.stringify(responses)).not.toContain(cipher.iv);
  });
});
