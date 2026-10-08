/**
 * 서비스 흐름 테스트 — 가짜 학교(testkit)와 임시 PGlite DB. 실제 학교에는 절대 접속하지 않는다.
 * 각 테스트는 자기 사용자·학번을 만들어 쓴다 (사용자 단위 호출 제한·학번 단위 가드가 서로 섞이지 않게).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'school-service-test-'));
process.env.DATA_DIR = dataDir;
process.env.JWT_SECRET = 'service-test-secret-0123456789abcdef';
delete process.env.DATABASE_URL;

import { all, get, insert, ready, run } from '../db.js';
import { studentIdHint } from '../../shared/school/types.js';
import type { BookPreview, BookResult } from '../../shared/school/types.js';
import { studentHash, studentLinkHash } from './guard.js';
import { SCHOOL_ORIGINS, SchoolAuthFailed, SchoolHttp, SchoolLocked, SchoolNotLinked, SchoolRejected, SchoolUnavailable, ApiInputError } from './http.js';
import { ResveClient } from './resve.js';
import { createSchoolService, parseBookSubmit, parseSealedBox } from './service.js';
import { createFakeSchool } from './testkit.js';
import type { FakeSchoolOptions } from './testkit.js';

const NOW = Date.UTC(2026, 9, 8, 3, 0, 0); // 2026-10-08(목) 12:00 KST
const PASSWORD = 'right-pass';
const WRONG = 'wrong-pass-XYZ-123';
const IV = Buffer.alloc(12, 7).toString('base64');
const CT = Buffer.alloc(40, 9).toString('base64');
const CIPHER = { v: 2 as const, iv: IV, ct: CT };

let seq = 0;
async function newUser(): Promise<{ uid: number; studentId: string }> {
  seq += 1;
  const uid = await insert('INSERT INTO users (email, name, password_hash) VALUES (?, ?, ?) RETURNING id', [
    `s4-user${seq}@hansung.ac.kr`,
    `테스터${seq}`,
    'x',
  ]);
  return { uid, studentId: `2021${String(200000 + seq)}` };
}

/** 연동을 거치지 않고 연동된 상태로 만든다 (학교 로그인 횟수를 세는 테스트에서 연동 로그인이 끼지 않게) */
async function linkDirect(uid: number, studentId: string): Promise<void> {
  await run(
    "UPDATE users SET school_cipher = ?, school_hint = ?, school_student_hash = ?, school_linked_at = now(), school_department = 'AI응용학과', school_admission_year = 2021 WHERE id = ?",
    [JSON.stringify(CIPHER), studentIdHint(studentId), studentLinkHash(studentId), uid],
  );
}

function setup(user: { studentId: string }, opts: FakeSchoolOptions = {}) {
  const fake = createFakeSchool({ users: { [user.studentId]: PASSWORD }, ...opts });
  const svc = createSchoolService({ fetch: fake.fetch, origins: () => SCHOOL_ORIGINS, now: () => NOW });
  return { fake, svc };
}

const creds = (u: { studentId: string }, password = PASSWORD) => ({ studentId: u.studentId, password });

async function reservationFor(uid: number, opts: { campusName?: string; date?: string; startMin?: number; endMin?: number; member?: boolean } = {}) {
  const f = await get<{ id: number }>('SELECT id FROM facilities WHERE campus_name = ?', [opts.campusName ?? '소모임실 Challenge']);
  const owner = opts.member === false ? await newUser() : { uid };
  const meetingId = await insert('INSERT INTO meetings (name, code, owner_id) VALUES (?, ?, ?) RETURNING id', [
    `회의${++seq}`,
    String(10000 + seq),
    owner.uid,
  ]);
  await run('INSERT INTO meeting_members (meeting_id, user_id) VALUES (?, ?)', [meetingId, owner.uid]);
  return insert(
    'INSERT INTO reservations (facility_id, meeting_id, user_id, date, start_min, end_min) VALUES (?, ?, ?, ?, ?, ?) RETURNING id',
    [f!.id, meetingId, owner.uid, opts.date ?? '2026-10-12', opts.startMin ?? 600, opts.endMin ?? 720],
  );
}

const bookingRows = (reservationId: number) =>
  all<{ status: string }>('SELECT status FROM school_bookings WHERE reservation_id = ? ORDER BY id', [reservationId]);

const finalPosts = (fake: ReturnType<typeof createFakeSchool>) => fake.state.registPosts.filter((p) => !p.ajax);

beforeAll(async () => {
  await ready();
}, 60_000);

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(() => {
  fs.rmSync(dataDir, { recursive: true, force: true });
});

describe('형식 검사', () => {
  it('암호문: v===1, iv 는 정확히 12바이트, ct 는 17~2048바이트 base64', () => {
    expect(parseSealedBox(CIPHER)).toEqual(CIPHER);
    expect(parseSealedBox({ ...CIPHER, v: 1 })).toBeNull();
    expect(parseSealedBox({ ...CIPHER, iv: Buffer.alloc(11).toString('base64') })).toBeNull();
    expect(parseSealedBox({ ...CIPHER, iv: Buffer.alloc(13).toString('base64') })).toBeNull();
    expect(parseSealedBox({ ...CIPHER, ct: Buffer.alloc(16).toString('base64') })).toBeNull(); // 태그뿐
    expect(parseSealedBox({ ...CIPHER, ct: Buffer.alloc(17).toString('base64') })).not.toBeNull();
    expect(parseSealedBox({ ...CIPHER, ct: Buffer.alloc(2048).toString('base64') })).not.toBeNull();
    expect(parseSealedBox({ ...CIPHER, ct: Buffer.alloc(2049).toString('base64') })).toBeNull();
    expect(parseSealedBox({ ...CIPHER, ct: '***not base64***' })).toBeNull();
    expect(parseSealedBox({ ...CIPHER, ct: 'AAAA=AAA' })).toBeNull();
    expect(parseSealedBox(null)).toBeNull();
    expect(parseSealedBox('x')).toBeNull();
  });

  it('제출 본문: 예약 번호·추가 항목·연락처·이메일을 검사한다', () => {
    const ok = { creds: { studentId: '2021204044', password: 'p' }, reservationId: 3, items: { 소속: 'AI' }, tel: '010-1111-2222', email: 'a@b.kr' };
    expect(parseBookSubmit(ok)).toMatchObject({ reservationId: 3, items: { 소속: 'AI' } });
    expect(parseBookSubmit({ ...ok, reservationId: 2147483647 }).reservationId).toBe(2147483647); // 상한 그대로는 허용
    for (const bad of [
      { ...ok, reservationId: '3' },
      { ...ok, reservationId: 0 },
      { ...ok, reservationId: -1 },
      { ...ok, reservationId: 1.5 },
      { ...ok, reservationId: 2 ** 31 }, // int4 상한(2147483647)을 넘는다 — DB 오류(500)가 되지 않게 400 으로
      { ...ok, reservationId: 9007199254740991 },
      { ...ok, reservationId: Number.POSITIVE_INFINITY },
      { ...ok, items: { a: 1 } },
      { ...ok, items: { a: 'x'.repeat(201) } },
      { ...ok, tel: 'abc' },
      { ...ok, email: 'not-an-email' },
      { ...ok, creds: { studentId: '12', password: 'p' } },
      { ...ok, creds: { studentId: '2021204044', password: '' } },
      { ...ok, creds: { studentId: '2021204044', password: 'x'.repeat(65) } },
    ]) {
      expect(() => parseBookSubmit(bad)).toThrow(ApiInputError);
    }
  });
});

describe('link', () => {
  it('성공: 학교에 1회 로그인하고 암호문·힌트·학과·입학년도만 저장한다', async () => {
    const user = await newUser();
    const { fake, svc } = setup(user);
    const res = await svc.link(user.uid, { creds: creds(user), cipher: CIPHER });
    expect(res).toEqual({
      linked: true,
      hint: studentIdHint(user.studentId),
      profile: { studentId: user.studentId, name: '홍길동', department: 'AI응용학과', admissionYear: 2021 },
    });
    expect(fake.state.infoLogins).toBe(1);

    const status = await svc.getLink(user.uid);
    expect(status).toMatchObject({
      linked: true,
      hint: studentIdHint(user.studentId),
      cipher: CIPHER,
      profileHint: { department: 'AI응용학과', admissionYear: 2021 },
    });
    expect(Number.isNaN(Date.parse(status.linkedAt!))).toBe(false);

    const stored = await get<{ h: string }>('SELECT school_student_hash AS h FROM users WHERE id = ?', [user.uid]);
    expect(stored!.h).toBe(studentLinkHash(user.studentId)); // 연동한 학번의 HMAC (이후 학번 비교의 기준)
    // 서버에 있는 건 암호문뿐이다: 평문 비밀번호·학번 원문이 어느 테이블에도 없다
    const dump = JSON.stringify([
      await all('SELECT * FROM users WHERE id = ?', [user.uid]),
      await all('SELECT * FROM school_login_guard'),
    ]);
    expect(dump).not.toContain(PASSWORD);
    expect(dump).not.toContain(user.studentId);
  });

  it('다시 연동하면 암호문을 바꾸고, 해제하면 모두 지운다', async () => {
    const user = await newUser();
    const { svc } = setup(user);
    await svc.link(user.uid, { creds: creds(user), cipher: CIPHER });
    const newer = { v: 2 as const, iv: IV, ct: Buffer.alloc(33, 1).toString('base64') };
    await svc.link(user.uid, { creds: creds(user), cipher: newer });
    expect((await svc.getLink(user.uid)).cipher).toEqual(newer);

    expect(await svc.unlink(user.uid)).toEqual({ ok: true });
    expect(await svc.getLink(user.uid)).toEqual({ linked: false, hint: null, linkedAt: null, cipher: null, profileHint: null });
  });

  it('연동 전에는 linked:false', async () => {
    const user = await newUser();
    const { svc } = setup(user);
    expect(await svc.getLink(user.uid)).toEqual({ linked: false, hint: null, linkedAt: null, cipher: null, profileHint: null });
  });

  it('비밀번호가 틀리면 SchoolAuthFailed — 학교 로그인은 정확히 1번, 재시도 없음, 아무것도 저장하지 않는다', async () => {
    const user = await newUser();
    const { fake, svc } = setup(user);
    await expect(svc.link(user.uid, { creds: creds(user, WRONG), cipher: CIPHER })).rejects.toBeInstanceOf(SchoolAuthFailed);
    expect(fake.state.infoLogins).toBe(1);
    expect(fake.state.calls.filter((c) => c.method === 'POST')).toHaveLength(1);
    expect((await svc.getLink(user.uid)).linked).toBe(false);
    const g = await get<{ fails: number }>('SELECT fails FROM school_login_guard WHERE student_hash = ?', [studentHash(user.studentId)]);
    expect(g!.fails).toBe(1);
  });

  it('입력이 잘못되면 학교에 아무 요청도 보내지 않는다', async () => {
    const user = await newUser();
    const { fake, svc } = setup(user);
    for (const body of [
      { creds: { studentId: 'abc', password: 'p' }, cipher: CIPHER },
      { creds: { studentId: user.studentId, password: '' }, cipher: CIPHER },
      { creds: creds(user), cipher: { ...CIPHER, iv: 'short' } },
      { creds: creds(user) },
      {},
    ]) {
      await expect(svc.link(user.uid, body)).rejects.toBeInstanceOf(ApiInputError);
    }
    expect(fake.state.calls).toHaveLength(0);
  });

  it('학교 점검(503)이면 SchoolUnavailable 이고 실패 횟수로 세지 않는다', async () => {
    const user = await newUser();
    const { fake, svc } = setup(user, { maintenance: true });
    await expect(svc.link(user.uid, { creds: creds(user), cipher: CIPHER })).rejects.toBeInstanceOf(SchoolUnavailable);
    expect(fake.state.infoLogins).toBe(0);
    expect(await get('SELECT 1 FROM school_login_guard WHERE student_hash = ?', [studentHash(user.studentId)])).toBeUndefined();
  });

  it('사용자당 10분에 3회까지만 연동을 시도할 수 있다', async () => {
    const user = await newUser();
    const { fake, svc } = setup(user);
    for (let i = 0; i < 3; i++) await svc.link(user.uid, { creds: creds(user), cipher: CIPHER });
    await expect(svc.link(user.uid, { creds: creds(user), cipher: CIPHER })).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    expect(fake.state.infoLogins).toBe(3);
  });

  it('연속 5회 틀리면 잠겨서 그다음에는 학교에 요청하지 않는다', async () => {
    const user = await newUser();
    const { fake, svc } = setup(user);
    // 사용자당 연동 호출 제한(10분 3회)을 피하려고 시간표 미리보기 등 다른 경로로 실패를 쌓는다
    await linkDirect(user.uid, user.studentId);
    const wrong = (i: number) => svc.timetablePreview(user.uid, creds(user, `${WRONG}${i}`));
    for (let i = 0; i < 5; i++) await expect(wrong(i)).rejects.toBeInstanceOf(SchoolAuthFailed);
    expect(fake.state.infoLogins).toBe(5);
    await expect(wrong(6)).rejects.toBeInstanceOf(SchoolLocked);
    await expect(svc.timetablePreview(user.uid, creds(user))).rejects.toBeInstanceOf(SchoolLocked); // 맞는 비밀번호여도
    expect(fake.state.infoLogins).toBe(5);
  });
});

describe('평문 누출 없음', () => {
  it('실패 흐름 전체에서 console 출력·오류·응답·DB 어디에도 비밀번호가 없다', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => undefined));
    const user = await newUser();
    await linkDirect(user.uid, user.studentId);
    const secret = 'LEAK-CANARY-pw-9f8e7d';

    const errors: unknown[] = [];

    // 1) 비밀번호 틀림 (정보 포털)
    let s = setup(user);
    errors.push(await s.svc.timetablePreview(user.uid, creds(user, secret)).catch((e: unknown) => e));
    // 2) 네트워크 오류
    s = setup(user, { failNetwork: (r) => r.method === 'POST' });
    errors.push(await s.svc.timetablePreview(user.uid, creds(user, secret)).catch((e: unknown) => e));
    // 3) 점검
    s = setup(user, { maintenance: true });
    errors.push(await s.svc.timetablePreview(user.uid, creds(user, secret)).catch((e: unknown) => e));
    // 4) 내 신청내역 (예약 사이트) 비밀번호 틀림
    s = setup(user);
    errors.push(await s.svc.myReservations(user.uid, creds(user, secret)).catch((e: unknown) => e));
    // 5) 연동 (유효성 검사 실패)
    errors.push(await s.svc.link(user.uid, { creds: creds(user, secret), cipher: { v: 2, iv: 'x', ct: 'y' } }).catch((e: unknown) => e));
    // 6) 잘못된 제출 본문
    errors.push(await s.svc.bookSubmit(user.uid, { creds: creds(user, secret), reservationId: 'x' }).catch((e: unknown) => e));

    for (const e of errors) expect(e).toBeInstanceOf(Error);
    const logged = JSON.stringify(spies.flatMap((spy) => spy.mock.calls.map((c) => c.map(String))));
    expect(logged).not.toContain(secret);
    for (const e of errors) {
      expect((e as Error).message).not.toContain(secret);
      expect(JSON.stringify(e)).not.toContain(secret);
      expect(String((e as Error).stack)).not.toContain(secret);
    }
    const dump = JSON.stringify([
      await all('SELECT * FROM users WHERE id = ?', [user.uid]),
      await all('SELECT * FROM school_login_guard'),
      await all('SELECT * FROM school_bookings'),
    ]);
    expect(dump).not.toContain(secret);
  });

  it('성공 응답에도 비밀번호가 없다', async () => {
    const user = await newUser();
    const { svc } = setup(user);
    const res = JSON.stringify(await svc.link(user.uid, { creds: creds(user), cipher: CIPHER }));
    expect(res).not.toContain(PASSWORD);
    await linkDirect(user.uid, user.studentId);
    expect(JSON.stringify(await svc.timetablePreview(user.uid, creds(user)))).not.toContain(PASSWORD);
  });
});

describe('시간표', () => {
  it('preview: 학교 수업을 읽어 격자 조정·건너뜀을 알려 주고 아무것도 저장하지 않는다', async () => {
    const user = await newUser();
    await linkDirect(user.uid, user.studentId);
    const { fake, svc } = setup(user);
    const res = await svc.timetablePreview(user.uid, creds(user));
    expect(res.profile).toMatchObject({ studentId: user.studentId, department: 'AI응용학과' });
    expect(res.classes.map((c) => c.subject)).toEqual(['자료구조', '운영체제']);
    expect(res.adjusted).toBe(1); // 09:15~10:45 → 09:00~11:00
    expect(res.skipped).toEqual([{ subject: '주말특강', reason: '주말 수업은 시간표에 넣을 수 없어요.' }]);
    expect(fake.state.infoLogins).toBe(1);
    expect(await all('SELECT 1 FROM timetable_entries WHERE user_id = ?', [user.uid])).toHaveLength(0);
  });

  it('import: source=school 로 넣고, 다시 가져오면 교체하되 직접 입력한 일정은 그대로다', async () => {
    const user = await newUser();
    await linkDirect(user.uid, user.studentId);
    const manualId = await insert(
      "INSERT INTO timetable_entries (user_id, day, start_min, end_min, title, place, repeat_kind, date) VALUES (?, 4, 600, 660, '동아리', '학생회관', 'weekly', NULL) RETURNING id",
      [user.uid],
    );
    const { svc } = setup(user);

    const first = await svc.timetableImport(user.uid, creds(user));
    expect(first).toMatchObject({ imported: 2, replaced: 0, adjusted: 1 });
    const rows = await all<{ title: string; source: string; day: number; start_min: number; end_min: number; place: string; repeat_kind: string }>(
      'SELECT title, source, day, start_min, end_min, place, repeat_kind FROM timetable_entries WHERE user_id = ? ORDER BY day, start_min',
      [user.uid],
    );
    expect(rows).toEqual([
      { title: '자료구조', source: 'school', day: 0, start_min: 540, end_min: 660, place: '공학관 B101', repeat_kind: 'weekly' },
      { title: '운영체제', source: 'school', day: 2, start_min: 780, end_min: 900, place: '상상관 201', repeat_kind: 'weekly' },
      { title: '동아리', source: 'manual', day: 4, start_min: 600, end_min: 660, place: '학생회관', repeat_kind: 'weekly' },
    ]);

    const second = await svc.timetableImport(user.uid, creds(user));
    expect(second).toMatchObject({ imported: 2, replaced: 2 });
    const after = await all<{ id: number; title: string; source: string }>(
      'SELECT id, title, source FROM timetable_entries WHERE user_id = ? ORDER BY day, start_min',
      [user.uid],
    );
    expect(after.map((r) => [r.title, r.source])).toEqual([['자료구조', 'school'], ['운영체제', 'school'], ['동아리', 'manual']]);
    expect(after.find((r) => r.title === '동아리')!.id).toBe(manualId);
    // 임시 표시가 남지 않는다
    expect(await all("SELECT 1 FROM timetable_entries WHERE source LIKE 'school-new%'")).toHaveLength(0);
  });

  it('학교 시간표가 비어 있으면 이전에 가져온 일정을 지우지 않는다', async () => {
    const user = await newUser();
    await linkDirect(user.uid, user.studentId);
    await setup(user).svc.timetableImport(user.uid, creds(user));
    const empty = await setup(user, { timetable: [] }).svc.timetableImport(user.uid, creds(user));
    expect(empty).toMatchObject({ imported: 0, replaced: 0 });
    expect(await all("SELECT 1 FROM timetable_entries WHERE user_id = ? AND source = 'school'", [user.uid])).toHaveLength(2);
  });

  it('연동하지 않았거나 연동한 학번과 다르면 SCHOOL_NOT_LINKED — 학교에 요청하지 않는다', async () => {
    const user = await newUser();
    const { fake, svc } = setup(user);
    await expect(svc.timetablePreview(user.uid, creds(user))).rejects.toBeInstanceOf(SchoolNotLinked);
    await linkDirect(user.uid, user.studentId);
    const other = { studentId: '2019100999' };
    await expect(svc.timetablePreview(user.uid, creds(other))).rejects.toBeInstanceOf(SchoolNotLinked);
    expect(fake.state.calls).toHaveLength(0);
  });

  it('시간표 응답 형식이 달라지면 SchoolUnavailable (조용히 빈 시간표로 지우지 않는다)', async () => {
    const user = await newUser();
    await linkDirect(user.uid, user.studentId);
    await setup(user).svc.timetableImport(user.uid, creds(user));
    const broken = setup(user, { timetable: [{ weird: true }] });
    await expect(broken.svc.timetableImport(user.uid, creds(user))).rejects.toBeInstanceOf(SchoolUnavailable);
    expect(await all("SELECT 1 FROM timetable_entries WHERE user_id = ? AND source = 'school'", [user.uid])).toHaveLength(2);
  });
});

describe('내 학교 예약', () => {
  it('사이트마다 로그인 1번 (같은 사이트의 시스템 키는 공유), 신청내역을 모은다', async () => {
    const user = await newUser();
    await linkDirect(user.uid, user.studentId);
    const { fake, svc } = setup(user);
    // 미리 신청내역을 하나 심어 둔다 (cncschool/2 와 onestop/16)
    fake.state.mine.set('cncschool/2', new Map([[user.studentId, [['5', '소모임실 Challenge', '2026-10-12', '10:00~12:00', '홍길동', user.studentId, '2026-10-08', '승인대기']]]]));
    fake.state.mine.set('onestop/16', new Map([[user.studentId, [['9', 'IB101', '2026-10-13', '13:00~14:00', '홍길동', user.studentId, '2026-10-08', '승인']]]]));
    // 로그인한 적 없는 상태에서 호출
    const res = await svc.myReservations(user.uid, creds(user));
    expect(fake.state.resveLogins).toBe(3); // cncschool, onestop, hsel — 사이트당 1번
    expect(res.failed).toEqual([]);
    expect(res.reservations.map((r) => [r.facility, r.no, r.space, r.status])).toEqual([
      ['cncschool/2', '5', '소모임실 Challenge', '승인대기'],
      ['onestop/16', '9', 'IB101', '승인'],
    ]);
    expect(res.reservations[0].facilityLabel).toBe('상상파크 플러스 (공학관)');
    expect(JSON.stringify(res)).not.toContain(user.studentId); // 신청자 학번·이름은 응답에 없다
  });

  it('비밀번호가 틀리면 첫 실패에서 중단한다 (다른 사이트로 계속 두드리지 않는다)', async () => {
    const user = await newUser();
    await linkDirect(user.uid, user.studentId);
    const { fake, svc } = setup(user);
    await expect(svc.myReservations(user.uid, creds(user, WRONG))).rejects.toBeInstanceOf(SchoolAuthFailed);
    expect(fake.state.resveLogins).toBe(1);
    const g = await get<{ fails: number }>('SELECT fails FROM school_login_guard WHERE student_hash = ?', [studentHash(user.studentId)]);
    expect(g!.fails).toBe(1);
  });

  it('한 사이트가 응답하지 않으면 그 사이트의 시스템만 failed 에 담는다', async () => {
    const user = await newUser();
    await linkDirect(user.uid, user.studentId);
    const { svc } = setup(user, { failNetwork: (r) => r.path.startsWith('/hnuLogin/onestop/') });
    const res = await svc.myReservations(user.uid, creds(user));
    expect(res.failed.map((f) => f.facility)).toEqual(['onestop/16']);
    expect(res.failed[0].reason).toContain('응답하지 않아요');
  });

  it('신청내역 표를 찾지 못하는 시스템은 "없음"이 아니라 failed 로 알린다', async () => {
    const user = await newUser();
    await linkDirect(user.uid, user.studentId);
    const fake = createFakeSchool({ users: { [user.studentId]: PASSWORD } });
    const base = fake.fetch;
    const svc = createSchoolService({
      origins: () => SCHOOL_ORIGINS,
      now: () => NOW,
      fetch: async (input, init) => (input.includes('/resve/cncschool/6/artclView.do') ? new Response('<html>점검</html>') : base(input, init)),
    });
    const res = await svc.myReservations(user.uid, creds(user));
    expect(res.failed.map((f) => f.facility)).toEqual(['cncschool/6']);
  });

  it('여러 쪽: 쪽마다 읽고 같은 쪽이 반복되면 멈춘다', async () => {
    const user = await newUser();
    await linkDirect(user.uid, user.studentId);
    const { fake, svc } = setup(user, { pageSize: 2 });
    const rows = [1, 2, 3, 4, 5].map((n) => [String(n), '소모임실 Challenge', '2026-10-12', '10:00~11:00', '홍길동', user.studentId, '2026-10-08', '승인']);
    fake.state.mine.set('cncschool/2', new Map([[user.studentId, rows]]));
    const res = await svc.myReservations(user.uid, creds(user));
    expect(res.reservations.filter((r) => r.facility === 'cncschool/2').map((r) => r.no)).toEqual(['1', '2', '3', '4', '5']);
  });
});

describe('ResveClient: 로그인 1번, 실패 뒤 재시도 없음', () => {
  it('실패한 사이트에 다시 login 을 불러도 학교에 요청하지 않고 같은 오류를 던진다', async () => {
    const fake = createFakeSchool({ users: { '2021999999': PASSWORD } });
    const client = new ResveClient(new SchoolHttp('resve', { fetch: fake.fetch, origins: SCHOOL_ORIGINS, now: () => NOW }));
    const bad = { studentId: '2021999999', password: WRONG };
    const first = await client.login('cncschool', bad).catch((e: unknown) => e);
    expect(first).toBeInstanceOf(SchoolAuthFailed);
    const callsAfterFirst = fake.state.calls.length;
    const second = await client.login('cncschool', { studentId: '2021999999', password: PASSWORD }).catch((e: unknown) => e);
    expect(second).toBe(first);
    expect(fake.state.calls).toHaveLength(callsAfterFirst);
    expect(fake.state.resveLogins).toBe(1);
    expect(client.loginRequests).toBe(1);
  });

  it('성공한 사이트에 다시 login 을 불러도 요청하지 않는다', async () => {
    const fake = createFakeSchool({ users: { '2021999998': PASSWORD } });
    const client = new ResveClient(new SchoolHttp('resve', { fetch: fake.fetch, origins: SCHOOL_ORIGINS, now: () => NOW }));
    await client.login('cncschool', { studentId: '2021999998', password: PASSWORD });
    await client.login('cncschool', { studentId: '2021999998', password: PASSWORD });
    expect(fake.state.resveLogins).toBe(1);
    expect(client.hasLoggedIn('cncschool')).toBe(true);
  });

  it('로그인하지 않고 신청내역·신청 화면을 부르면 학교에 요청하지 않는다', async () => {
    const fake = createFakeSchool();
    const client = new ResveClient(new SchoolHttp('resve', { fetch: fake.fetch, origins: SCHOOL_ORIGINS, now: () => NOW }));
    await expect(client.mine('cncschool/2')).rejects.toThrow();
    await expect(client.fetchRegistration('cncschool/2')).rejects.toThrow();
    expect(fake.state.calls).toHaveLength(0);
  });

  it('화이트리스트에 없는 예약 시스템·사이트는 요청하지 않는다', async () => {
    const fake = createFakeSchool();
    const client = new ResveClient(new SchoolHttp('resve', { fetch: fake.fetch, origins: SCHOOL_ORIGINS, now: () => NOW }));
    await expect(client.spaces('evil/1')).rejects.toThrow();
    await expect(client.spaces('cncschool/../../etc')).rejects.toThrow();
    await expect(client.login('evil', { studentId: '2021999997', password: 'x' })).rejects.toThrow();
    await expect(client.booked('cncschool/2', 47, '2026-13-45')).rejects.toThrow();
    await expect(client.setup('cncschool/2', -1)).rejects.toThrow();
    expect(fake.state.calls).toHaveLength(0);
  });
});

describe('바로 신청: 미리보기', () => {
  it('신청할 수 있으면 신청 화면의 프로필·신청 대상·담당·추가 항목을 보여 준다', async () => {
    const user = await newUser();
    await linkDirect(user.uid, user.studentId);
    const reservationId = await reservationFor(user.uid);
    const { fake, svc } = setup(user, { items: [{ itemNm: '소속', mustYn: 'Y' }, { itemNm: '사용 목적', mustYn: 'N' }] });
    const p = await svc.bookPreview(user.uid, { creds: creds(user), reservationId });
    expect(p).toEqual<BookPreview>({
      reservationId,
      title: '상상파크 플러스 (공학관) · 소모임실 Challenge',
      when: '10월 12일 (월) 10:00~12:00 (60분 × 2칸)',
      applicant: { name: '홍길동', studentId: user.studentId, tel: '010-1111-2222', email: 'a&b@hansung.ac.kr' },
      identities: ['학사(재학생)', '학사(졸업생)'],
      manager: '홍담당 02-760-4800',
      items: [{ name: '소속', required: true }, { name: '사용 목적', required: false }],
      canBook: true,
      reason: null,
      alreadySubmitted: false,
    });
    expect(fake.state.resveLogins).toBe(1);
    expect(fake.state.registPosts).toHaveLength(0); // 미리보기는 제출하지 않는다
  });

  it('회의 멤버가 아니면 403, 없는 예약은 404 — 학교에 요청하지 않는다', async () => {
    const user = await newUser();
    await linkDirect(user.uid, user.studentId);
    const foreign = await reservationFor(user.uid, { member: false });
    const { fake, svc } = setup(user);
    await expect(svc.bookPreview(user.uid, { creds: creds(user), reservationId: foreign })).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });
    await expect(svc.bookPreview(user.uid, { creds: creds(user), reservationId: 999999 })).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });
    expect(fake.state.calls).toHaveLength(0);
  });

  it('신청할 수 없는 이유를 문장으로 알려 주고, 그럴 땐 학교에 로그인하지 않는다', async () => {
    const user = await newUser();
    await linkDirect(user.uid, user.studentId);
    const { fake, svc } = setup(user, { booked: { 'cncschool/2|47|2026-10-12': ['11:00'] } });
    const preview = (reservationId: number) => svc.bookPreview(user.uid, { creds: creds(user), reservationId });

    const unit = await preview(await reservationFor(user.uid, { startMin: 600, endMin: 630 }));
    expect(unit).toMatchObject({ canBook: false, applicant: { name: '' } });
    expect(unit.reason).toContain('60분 단위');

    const booked = await preview(await reservationFor(user.uid)); // 10:00~12:00 중 11:00 이 이미 예약됨
    expect(booked.canBook).toBe(false);
    expect(booked.reason).toContain('11:00');
    expect(booked.reason).toContain('이미 예약');

    const past = await preview(await reservationFor(user.uid, { date: '2026-10-01' }));
    expect(past.reason).toContain('지난 날짜');

    const weekend = await preview(await reservationFor(user.uid, { date: '2026-10-17' }));
    expect(weekend.canBook).toBe(false);
    expect(weekend.reason).toContain('지금 신청할 수 없어요');

    const lead = await preview(await reservationFor(user.uid, { date: '2026-10-08', startMin: 780, endMin: 840 })); // 13:00 은 리드타임 1시간 이내가 아님 → 가능
    expect(lead.canBook).toBe(true);
    const tooSoon = await preview(await reservationFor(user.uid, { date: '2026-10-08', startMin: 720, endMin: 780 })); // 12:00 은 지금 + 1시간 이전
    expect(tooSoon.canBook).toBe(false);

    const noSpace = await preview(await reservationFor(user.uid, { campusName: '소모임실 Creativity' }));
    expect(noSpace.canBook).toBe(false);
    expect(noSpace.reason).toContain('Creativity');

    // 신청할 수 있던 한 건(lead)만 로그인했다. 나머지는 이유만 알려 주고 학교에 로그인하지 않았다
    expect(fake.state.resveLogins).toBe(1);
  });

  it('우리 시설이 학교 시스템에 연결되지 않았다면 이유를 알린다', async () => {
    const user = await newUser();
    await linkDirect(user.uid, user.studentId);
    const fid = await insert("INSERT INTO facilities (system_key, campus_name, name, building) VALUES ('unknown', NULL, '미연결 시설', '어딘가') RETURNING id");
    const meetingId = await insert('INSERT INTO meetings (name, code, owner_id) VALUES (?, ?, ?) RETURNING id', ['m', String(20000 + ++seq), user.uid]);
    await run('INSERT INTO meeting_members (meeting_id, user_id) VALUES (?, ?)', [meetingId, user.uid]);
    const rid = await insert(
      'INSERT INTO reservations (facility_id, meeting_id, user_id, date, start_min, end_min) VALUES (?, ?, ?, ?, ?, ?) RETURNING id',
      [fid, meetingId, user.uid, '2026-10-12', 600, 720],
    );
    const { fake, svc } = setup(user);
    const p = await svc.bookPreview(user.uid, { creds: creds(user), reservationId: rid });
    expect(p.canBook).toBe(false);
    expect(p.reason).toContain('연결되어 있지 않아요');
    expect(fake.state.calls).toHaveLength(0);
  });
});

describe('바로 신청: 제출', () => {
  const submit = (svc: ReturnType<typeof setup>['svc'], user: { uid: number; studentId: string }, reservationId: number, extra: Record<string, unknown> = {}) =>
    svc.bookSubmit(user.uid, { creds: creds(user), reservationId, items: {}, ...extra }) as Promise<BookResult>;

  it('성공: 서버 검증(AJAX) → 본 제출 → 내 신청내역에서 확인 → confirmed, 우리 예약도 학교 확인됨', async () => {
    const user = await newUser();
    await linkDirect(user.uid, user.studentId);
    const rid = await reservationFor(user.uid);
    const { fake, svc } = setup(user, { items: [{ itemNm: '소속', mustYn: 'Y' }] });

    const res = await submit(svc, user, rid, { items: { 소속: 'AI응용학과' } });
    expect(res.status).toBe('confirmed');
    expect(res.found).toHaveLength(1);
    expect(res.found[0]).toMatchObject({ facility: 'cncschool/2', space: '소모임실 Challenge', date: '2026-10-12', time: '10:00~12:00', status: '승인대기' });

    expect(fake.state.resveLogins).toBe(1); // 로그인은 한 번
    expect((await bookingRows(rid)).map((r) => r.status)).toEqual(['confirmed']);
    expect((await get<{ s: string }>('SELECT school_status AS s FROM reservations WHERE id = ?', [rid]))!.s).toBe('confirmed');

    // 검증(ajax) 1번 → 본 제출 1번, 필드 순서까지 같고 검증은 layout 만 비웠다
    expect(fake.state.registPosts.map((p) => p.ajax)).toEqual([true, false]);
    const [check, final] = fake.state.registPosts;
    expect(check.pairs[0]).toEqual(['layout', '']);
    expect(final.pairs[0]).toEqual(['layout', 'abc123']);
    expect(check.pairs.slice(1)).toEqual(final.pairs.slice(1));
    expect(final.pairs.map(([k]) => k)).toEqual([
      'layout', 'siteId', 'fnctNo', 'lmttYn', 'groupNm', 'spceNm', 'selDay', 'posblDay', 'posblTerm', 'posblBgnde', 'posblEndde',
      'resveGroupSeq', 'userNm', 'hakbun', 'addItemCnt', 'group', 'resveSpceSeq', 'mngr', 'mngrTelno', 'resveDeStr', 'identityCode',
      'resveTm', 'resveTm', 'telno', 'email', 'addItemMustYn1', 'addItem1',
    ]);
    expect(final.pairs.filter(([k]) => k === 'resveTm').map(([, v]) => v)).toEqual(['10:00', '11:00']);
    expect(Object.fromEntries(final.pairs)).toMatchObject({ siteId: 'cncschool', fnctNo: '2', resveSpceSeq: '47', resveDeStr: '2026-10-12', selDay: '월', addItem1: 'AI응용학과' });
    expect(final.referer).toContain('/resve/cncschool/2/artclRegistWrap.do');
  });

  it('같은 예약 계획을 두 번 보내지 않는다 (confirmed 뒤 재제출 거절, 학교 호출 없음, 미리보기는 alreadySubmitted)', async () => {
    const user = await newUser();
    await linkDirect(user.uid, user.studentId);
    const rid = await reservationFor(user.uid);
    const { fake, svc } = setup(user);
    await submit(svc, user, rid);
    const callsBefore = fake.state.calls.length;
    await expect(submit(svc, user, rid)).rejects.toBeInstanceOf(SchoolRejected);
    expect(fake.state.calls.length).toBe(callsBefore);
    expect(finalPosts(fake)).toHaveLength(1);
    const p = await svc.bookPreview(user.uid, { creds: creds(user), reservationId: rid });
    expect(p).toMatchObject({ canBook: false, alreadySubmitted: true });
  });

  it('동시에 두 번 눌러도 학교에는 한 번만 보낸다', async () => {
    const user = await newUser();
    await linkDirect(user.uid, user.studentId);
    const rid = await reservationFor(user.uid);
    const { fake, svc } = setup(user);
    const results = await Promise.allSettled([submit(svc, user, rid), submit(svc, user, rid)]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
    expect(finalPosts(fake)).toHaveLength(1);
    expect((await bookingRows(rid)).filter((r) => r.status !== 'failed')).toHaveLength(1);
  });

  it('보냈지만 내 신청내역에서 확인되지 않으면 unknown — 자동으로 다시 보내지 않는다', async () => {
    const user = await newUser();
    await linkDirect(user.uid, user.studentId);
    const rid = await reservationFor(user.uid);
    const { fake, svc } = setup(user, { dropBooking: true });
    const res = await submit(svc, user, rid);
    expect(res.status).toBe('unknown');
    expect(res.message).toContain('자동으로 다시 보내지 않아요');
    expect(res.found).toEqual([]);
    expect(finalPosts(fake)).toHaveLength(1);
    expect((await bookingRows(rid)).map((r) => r.status)).toEqual(['unknown']);
    expect((await get<{ s: string }>('SELECT school_status AS s FROM reservations WHERE id = ?', [rid]))!.s).toBe('planned');

    await expect(submit(svc, user, rid)).rejects.toBeInstanceOf(SchoolRejected); // unknown 도 중복 방지
    expect(finalPosts(fake)).toHaveLength(1);
  });

  it('이미 있던 같은 날짜·공간의 신청내역을 이번 신청의 확인으로 착각하지 않는다', async () => {
    const user = await newUser();
    await linkDirect(user.uid, user.studentId);
    const rid = await reservationFor(user.uid);
    const { fake, svc } = setup(user, { dropBooking: true });
    fake.state.mine.set('cncschool/2', new Map([[user.studentId, [['3', '소모임실 Challenge', '2026-10-12', '09:00~10:00', '홍길동', user.studentId, '2026-10-01', '승인']]]]));
    const res = await submit(svc, user, rid);
    expect(res.status).toBe('unknown');
  });

  it('본 제출이 네트워크 오류로 끊기면 unknown 이고 다시 보내지 않는다', async () => {
    const user = await newUser();
    await linkDirect(user.uid, user.studentId);
    const rid = await reservationFor(user.uid);
    const { fake, svc } = setup(user, {
      failNetwork: (r) => r.method === 'POST' && r.path.endsWith('/artclRegist.do') && r.headers['x-requested-with'] !== 'XMLHttpRequest',
    });
    const res = await submit(svc, user, rid);
    expect(res.status).toBe('unknown');
    expect(fake.state.calls.filter((c) => c.method === 'POST' && c.path.endsWith('/artclRegist.do'))).toHaveLength(2); // 검증 1 + 본 제출 시도 1
    expect((await bookingRows(rid)).map((r) => r.status)).toEqual(['unknown']);
  });

  it('학교 서버 검증이 오류를 주면 SCHOOL_REJECTED(학교 문장 그대로) — 본 제출은 하지 않고, 고친 뒤 다시 시도할 수 있다', async () => {
    const user = await newUser();
    await linkDirect(user.uid, user.studentId);
    const rid = await reservationFor(user.uid);
    const { fake, svc } = setup(user, { validationBody: '[{"msg":"연락처를 입력하세요."}]' });
    const err = await submit(svc, user, rid).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SchoolRejected);
    expect((err as SchoolRejected).code).toBe('SCHOOL_REJECTED');
    expect((err as Error).message).toBe('연락처를 입력하세요.');
    expect(finalPosts(fake)).toHaveLength(0);
    expect((await bookingRows(rid)).map((r) => r.status)).toEqual(['failed']);

    fake.state.opts.validationBody = '[]';
    const ok = await submit(svc, user, rid);
    expect(ok.status).toBe('confirmed');
    expect((await bookingRows(rid)).map((r) => r.status)).toEqual(['failed', 'confirmed']);
    expect(finalPosts(fake)).toHaveLength(1);
  });

  it('검증 응답을 읽을 수 없으면 제출하지 않는다 (SchoolUnavailable)', async () => {
    const user = await newUser();
    await linkDirect(user.uid, user.studentId);
    const rid = await reservationFor(user.uid);
    const { fake, svc } = setup(user, { validationBody: '<html>세션 만료</html>' });
    await expect(submit(svc, user, rid)).rejects.toBeInstanceOf(SchoolUnavailable);
    expect(finalPosts(fake)).toHaveLength(0);
    expect((await bookingRows(rid)).map((r) => r.status)).toEqual(['failed']);
  });

  it('필수 항목이 비어 있으면 INVALID — 기록도 로그인도 없다', async () => {
    const user = await newUser();
    await linkDirect(user.uid, user.studentId);
    const rid = await reservationFor(user.uid);
    const { fake, svc } = setup(user, { items: [{ itemNm: '소속', mustYn: 'Y' }] });
    await expect(submit(svc, user, rid, { items: { 소속: '   ' } })).rejects.toMatchObject({ code: 'INVALID' });
    expect(await bookingRows(rid)).toEqual([]);
    expect(fake.state.resveLogins).toBe(0);
  });

  it('제출 직전에 상태가 바뀌었으면(그 사이 예약됨) 미리보기와 상관없이 거절한다', async () => {
    const user = await newUser();
    await linkDirect(user.uid, user.studentId);
    const rid = await reservationFor(user.uid);
    const { fake, svc } = setup(user);
    expect((await svc.bookPreview(user.uid, { creds: creds(user), reservationId: rid })).canBook).toBe(true);
    fake.state.opts.booked = { 'cncschool/2|47|2026-10-12': ['10:00'] };
    await expect(submit(svc, user, rid)).rejects.toBeInstanceOf(SchoolRejected);
    expect(await bookingRows(rid)).toEqual([]);
    expect(finalPosts(fake)).toHaveLength(0);
  });

  it('로그인 실패(비밀번호 틀림)면 failed 로 두고 AUTH_FAILED — 학교 로그인은 1번, 재시도 없음', async () => {
    const user = await newUser();
    await linkDirect(user.uid, user.studentId);
    const rid = await reservationFor(user.uid);
    const { fake, svc } = setup(user);
    await expect(svc.bookSubmit(user.uid, { creds: creds(user, WRONG), reservationId: rid, items: {} })).rejects.toBeInstanceOf(SchoolAuthFailed);
    expect(fake.state.resveLogins).toBe(1);
    expect((await bookingRows(rid)).map((r) => r.status)).toEqual(['failed']);
    expect(finalPosts(fake)).toHaveLength(0);
  });

  it('회의 멤버가 아니면 제출할 수 없다', async () => {
    const user = await newUser();
    await linkDirect(user.uid, user.studentId);
    const foreign = await reservationFor(user.uid, { member: false });
    const { fake, svc } = setup(user);
    await expect(submit(svc, user, foreign)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(fake.state.calls).toHaveLength(0);
  });
});
