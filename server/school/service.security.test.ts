/**
 * 보안 회귀 테스트 — 리뷰에서 나온 문제들이 다시 생기지 않게 한다. 실제 DB(임시 PGlite)와 가짜 학교(testkit)만 쓴다.
 *
 *  1. 연동한 학번 비교는 "끝 3자리 힌트"가 아니라 학번 HMAC 의 정확한 비교다 (같은 끝자리의 다른 학번으로 학교 로그인을 시킬 수 없다)
 *  2. /link 는 사용자와 학번을 묶는다: 남의 학번에 틀린 비밀번호를 보내 그 학번의 공유 가드를 소진시키지 못한다
 *  3. 탈퇴한 사용자의 남은 토큰은 학교에 아무것도 보내지 못한다 (401)
 *  4. 암호문 자리에 평문이 들어오면 저장하지 않는다
 *  5. 예약 번호는 int4 범위 안에서만 DB 로 간다 (500 이 되지 않는다)
 *  6. 8회 실패 뒤에는 시간이 지나도 학교로 나가지 않는다 (service 수준; 규칙 자체는 guard.test.ts)
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { all, get, insert, ready, run } from '../db.js';
import {
  LINK_PROBE_MAX_FAILS,
  LINK_PROBE_MAX_FAILS_PER_ID,
  SCHOOL_LOCK_AFTER,
  assertNotLocked,
  linkLimiter,
  schoolCallLimiter,
  studentHash,
  studentLinkHash,
} from './guard.js';
import { ApiInputError, SchoolLocked, SchoolNotLinked, SchoolAuthFailed } from './http.js';
import { cipherLooksLikePlaintext, createSchoolService, parseReservationId } from './service.js';
import { createFakeSchool } from './testkit.js';
import type { FakeSchoolOptions } from './testkit.js';
import type { SealedBox } from '../../shared/school/types.js';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 's4-security-'));
process.env.DATA_DIR = dataDir;
delete process.env.DATABASE_URL;
delete process.env.SCHOOL_MOCK_ORIGIN;
process.env.JWT_SECRET = 'test-secret-for-s4-security-tests';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const NOW_BASE = Date.parse('2026-10-08T01:00:00Z');
let clock = NOW_BASE;
const now = (): number => clock;

const OWNER_ID = '2021204044';
const OWNER_PW = 'owner-PW-1a2b3c';
const GOOD = 'GoodPass1!';

const b64 = (n: number): string => Buffer.alloc(n, 7).toString('base64');
const cipher: SealedBox = { v: 2, iv: b64(12), ct: b64(40) };

let seq = 0;
async function makeUser(): Promise<number> {
  seq += 1;
  return insert("INSERT INTO users (email, name, password_hash) VALUES (?, ?, 'x') RETURNING id", [`sec${seq}-${Date.now()}@hansung.ac.kr`, `보안${seq}`]);
}

function setup(users: Record<string, string> = { [OWNER_ID]: OWNER_PW }, opts: FakeSchoolOptions = {}) {
  const fake = createFakeSchool({ users, ...opts });
  const svc = createSchoolService({ fetch: fake.fetch, now });
  return { fake, svc };
}

/** 모든 학교 호출이 막혔는지: 가짜 학교가 받은 요청이 하나도 없다 */
const noSchoolCalls = (fake: ReturnType<typeof createFakeSchool>): void => {
  expect(fake.state.calls).toHaveLength(0);
  expect(fake.loginCalls()).toBe(0);
};

const guardRow = (studentId: string) =>
  get<{ fails: number; lockedUntil: string | null }>('SELECT fails, locked_until AS "lockedUntil" FROM school_login_guard WHERE student_hash = ?', [studentHash(studentId)]);

const resetLimits = (uid: number): void => {
  linkLimiter.clear(String(uid));
  schoolCallLimiter.clear(String(uid));
};

beforeAll(async () => {
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

beforeEach(async () => {
  clock = NOW_BASE;
  await run('DELETE FROM school_login_guard');
  await run('DELETE FROM school_link_probe');
  // 학번 하나당 계정 하나(유니크 인덱스): 앞 테스트가 연동해 둔 학번을 풀어 줘서 테스트마다 같은 학번을 다시 연동할 수 있게 한다
  await run('UPDATE users SET school_student_hash = NULL, school_cipher = NULL, school_hint = NULL WHERE school_student_hash IS NOT NULL');
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** 사용자가 OWNER_ID 로 정식 연동(link)을 마친 상태를 만든다. 가짜 학교의 로그인 카운터는 0 으로 되돌린다. */
async function linkedOwner(users: Record<string, string> = { [OWNER_ID]: OWNER_PW }, opts: FakeSchoolOptions = {}) {
  const uid = await makeUser();
  const s = setup(users, opts);
  await s.svc.link(uid, { creds: { studentId: OWNER_ID, password: OWNER_PW }, cipher });
  resetLimits(uid);
  s.fake.state.calls.length = 0;
  s.fake.state.infoLogins = 0;
  s.fake.state.resveLogins = 0;
  return { uid, ...s };
}

// ───────────────────────────────────────────────────────────────
describe('1. 연동한 학번과의 비교는 정확한 HMAC 비교다 (끝 3자리 힌트 충돌 불가)', () => {
  // 연동한 학번 2021204044 와 길이·끝 3자리(044)가 같은 다른 학번들
  const COLLIDING = ['2019111044', '2022304044', '1999999044', '2021204044'.replace(/^2021/, '2020')];

  it.each(COLLIDING.filter((id) => id !== OWNER_ID))('학번 %s(끝 3자리·길이 동일)은 모든 학교 기능에서 SCHOOL_NOT_LINKED, 학교에는 아무것도 나가지 않는다', async (other) => {
    const { uid, fake, svc } = await linkedOwner({ [OWNER_ID]: OWNER_PW, [other]: 'victim-pw-9' });
    const bad = { studentId: other, password: 'guess-1' };
    const calls: [string, () => Promise<unknown>][] = [
      ['timetablePreview', () => svc.timetablePreview(uid, bad)],
      ['timetableImport', () => svc.timetableImport(uid, bad)],
      ['myReservations', () => svc.myReservations(uid, bad)],
      ['bookPreview', () => svc.bookPreview(uid, { creds: bad, reservationId: 1 })],
      ['bookSubmit', () => svc.bookSubmit(uid, { creds: bad, reservationId: 1, items: {} })],
    ];
    for (const [name, fn] of calls) {
      resetLimits(uid);
      const err = await fn().catch((e: unknown) => e);
      expect(err, name).toBeInstanceOf(SchoolNotLinked);
      expect((err as SchoolNotLinked).code, name).toBe('SCHOOL_NOT_LINKED');
    }
    noSchoolCalls(fake);
    // 그 학번의 공유 가드에도 흔적이 없다 (피해자의 연동·시간표 기능이 막히지 않는다)
    expect(await guardRow(other)).toBeUndefined();
    await expect(assertNotLocked(studentHash(other))).resolves.toBeUndefined();
  });

  it('같은 요청을 아홉 번 반복해도 학교 로그인은 0번이다 (예전에는 5번 나가고 잠겼다)', async () => {
    const { uid, fake, svc } = await linkedOwner({ [OWNER_ID]: OWNER_PW, '2022304044': 'victim-pw-9' });
    for (let i = 0; i < 9; i++) {
      resetLimits(uid);
      await expect(svc.timetablePreview(uid, { studentId: '2022304044', password: `guess-${i}` })).rejects.toBeInstanceOf(SchoolNotLinked);
    }
    noSchoolCalls(fake);
    expect(await all('SELECT 1 FROM school_login_guard')).toHaveLength(0);
  });

  it('연동한 학번 자신은 그대로 동작한다', async () => {
    const { uid, svc, fake } = await linkedOwner();
    resetLimits(uid);
    const p = await svc.timetablePreview(uid, { studentId: OWNER_ID, password: OWNER_PW });
    expect(p.profile.studentId).toBe(OWNER_ID);
    expect(fake.state.infoLogins).toBe(1);
  });

  it('다른 사용자는 남이 연동한 학번을 자기 것처럼 쓸 수 없다', async () => {
    const owner = await linkedOwner();
    const intruder = await makeUser();
    await expect(owner.svc.timetablePreview(intruder, { studentId: OWNER_ID, password: OWNER_PW })).rejects.toBeInstanceOf(SchoolNotLinked);
    noSchoolCalls(owner.fake);
  });

  it('해시가 없는 옛 연동(힌트만 있음)은 학번을 확인할 수 없으므로 다시 연동하게 한다: 학교 호출 0, 연동 상태는 linked:false', async () => {
    const uid = await makeUser();
    const { fake, svc } = setup();
    await run('UPDATE users SET school_cipher = ?, school_hint = ?, school_linked_at = now() WHERE id = ?', [JSON.stringify(cipher), '*******044', uid]);
    expect((await svc.getLink(uid)).linked).toBe(false);
    for (const id of [OWNER_ID, '2019111044']) {
      resetLimits(uid);
      const err = await svc.timetablePreview(uid, { studentId: id, password: OWNER_PW }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(SchoolNotLinked);
      expect((err as Error).message).toContain('다시 연동');
    }
    noSchoolCalls(fake);

    // 다시 연동하면 해시가 채워지고 이후 정상 동작한다
    await svc.link(uid, { creds: { studentId: OWNER_ID, password: OWNER_PW }, cipher });
    expect((await svc.getLink(uid)).linked).toBe(true);
    resetLimits(uid);
    await expect(svc.timetablePreview(uid, { studentId: OWNER_ID, password: OWNER_PW })).resolves.toBeDefined();
    expect((await get<{ h: string }>('SELECT school_student_hash AS h FROM users WHERE id = ?', [uid]))!.h).toBe(studentLinkHash(OWNER_ID));
  });

  it('연동을 해제하면 학번 해시도 지워져서 이후 기능은 SCHOOL_NOT_LINKED', async () => {
    const { uid, svc, fake } = await linkedOwner();
    await svc.unlink(uid);
    expect((await get<{ h: string | null }>('SELECT school_student_hash AS h FROM users WHERE id = ?', [uid]))!.h).toBeNull();
    resetLimits(uid);
    await expect(svc.timetablePreview(uid, { studentId: OWNER_ID, password: OWNER_PW })).rejects.toBeInstanceOf(SchoolNotLinked);
    noSchoolCalls(fake);
  });

  it('HMAC 은 서버 비밀에 묶여 있고 DB 에는 학번 원문이 없다', async () => {
    const { uid } = await linkedOwner();
    const row = await get<Record<string, unknown>>('SELECT * FROM users WHERE id = ?', [uid]);
    expect(row!.school_student_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(row)).not.toContain(OWNER_ID);
    expect(JSON.stringify(row)).not.toContain(OWNER_PW);
  });
});

// ───────────────────────────────────────────────────────────────
describe('2. /link 가 사용자와 학번을 묶는다 (남의 학번 가드 소진·비밀번호 대입 방지)', () => {
  const VICTIM = '1999000';
  const attackerLink = (svc: ReturnType<typeof setup>['svc'], uid: number, password: string) => {
    resetLimits(uid);
    return svc.link(uid, { creds: { studentId: VICTIM, password }, cipher });
  };

  it('한 사용자는 같은 (남의) 학번으로 하루 LINK_PROBE_MAX_FAILS 번까지만 학교에 틀린 비밀번호를 보낼 수 있다', async () => {
    const { fake, svc } = setup({ [VICTIM]: GOOD });
    const attacker = await makeUser();
    for (let i = 0; i < LINK_PROBE_MAX_FAILS; i++) {
      await expect(attackerLink(svc, attacker, `x${i}`)).rejects.toBeInstanceOf(SchoolAuthFailed);
    }
    const before = fake.state.calls.length;
    for (let i = 0; i < 5; i++) {
      const err = await attackerLink(svc, attacker, `y${i}`).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ApiInputError);
      expect((err as ApiInputError).code).toBe('RATE_LIMITED');
    }
    expect(fake.state.calls.length).toBe(before); // 상한 뒤에는 학교로 나가지 않는다
    expect(fake.state.infoLogins).toBe(LINK_PROBE_MAX_FAILS);
    expect((await guardRow(VICTIM))!.fails).toBe(LINK_PROBE_MAX_FAILS);
    expect(LINK_PROBE_MAX_FAILS).toBeLessThan(SCHOOL_LOCK_AFTER);
  });

  it('계정을 여러 개 만들어도 한 학번에 하루 LINK_PROBE_MAX_FAILS_PER_ID 번을 넘지 못해 피해자의 가드는 잠기지 않는다', async () => {
    const { fake, svc } = setup({ [VICTIM]: GOOD });
    const attackers = [await makeUser(), await makeUser(), await makeUser(), await makeUser()];
    let sent = 0;
    for (const a of attackers) {
      for (let i = 0; i < 3; i++) {
        const r = await attackerLink(svc, a, `z${i}`).then(() => 'ok', (e: unknown) => (e instanceof SchoolAuthFailed ? 'fail' : 'blocked'));
        if (r === 'fail') sent += 1;
      }
    }
    expect(sent).toBe(LINK_PROBE_MAX_FAILS_PER_ID);
    expect(fake.state.infoLogins).toBe(LINK_PROBE_MAX_FAILS_PER_ID);
    const g = await guardRow(VICTIM);
    expect(g!.fails).toBe(LINK_PROBE_MAX_FAILS_PER_ID);
    expect(g!.fails).toBeLessThan(SCHOOL_LOCK_AFTER);
    await expect(assertNotLocked(studentHash(VICTIM), clock)).resolves.toBeUndefined(); // 잠기지 않았다

    // 하루가 지나면 정당한 주인이 올바른 비밀번호로 연동할 수 있다
    clock += DAY + MIN;
    const owner = await makeUser();
    const res = await svc.link(owner, { creds: { studentId: VICTIM, password: GOOD }, cipher });
    expect(res.linked).toBe(true);
    expect((await guardRow(VICTIM))!.fails).toBe(0);
  });

  it('한 사용자가 하루에 건드릴 수 있는 서로 다른 (남의) 학번은 3개까지', async () => {
    const ids = ['1999000', '1999001', '1999002', '1999003'];
    const { fake, svc } = setup(Object.fromEntries(ids.map((i) => [i, GOOD])));
    const attacker = await makeUser();
    const results: string[] = [];
    for (const id of ids) {
      resetLimits(attacker);
      results.push(await svc.link(attacker, { creds: { studentId: id, password: 'nope' }, cipher }).then(() => 'ok', (e: unknown) => (e instanceof SchoolAuthFailed ? 'fail' : (e as ApiInputError).code)));
    }
    expect(results).toEqual(['fail', 'fail', 'fail', 'RATE_LIMITED']);
    expect(fake.state.infoLogins).toBe(3);
  });

  it('정당한 사용자가 자기 학번에 오타를 내도 괜찮다: 틀림 → 맞음이면 연동되고 기록이 지워진다', async () => {
    const { svc } = setup({ [VICTIM]: GOOD });
    const uid = await makeUser();
    await expect(attackerLink(svc, uid, 'typo')).rejects.toBeInstanceOf(SchoolAuthFailed);
    resetLimits(uid);
    const ok = await svc.link(uid, { creds: { studentId: VICTIM, password: GOOD }, cipher });
    expect(ok.linked).toBe(true);
    expect(await all('SELECT 1 FROM school_link_probe WHERE user_id = ?', [uid])).toHaveLength(0);
    expect((await guardRow(VICTIM))!.fails).toBe(0);
  });

  it('연동한 주인 자신의 틀린 비밀번호 재연동은 이 상한을 쓰지 않는다 (가드 5회/8회 규칙만 적용)', async () => {
    const { uid, svc } = await linkedOwner();
    for (let i = 0; i < 4; i++) {
      resetLimits(uid);
      await expect(svc.link(uid, { creds: { studentId: OWNER_ID, password: `wrong-${i}` }, cipher })).rejects.toBeInstanceOf(SchoolAuthFailed);
    }
    expect(await all('SELECT 1 FROM school_link_probe WHERE user_id = ?', [uid])).toHaveLength(0);
    expect((await guardRow(OWNER_ID))!.fails).toBe(4);
  });

  it('안전선(8회)에 걸려 멈춘 학번은 주인이 아닌 사용자가 건드릴 수 없다: 학교 호출 0, 시도 기록도 남기지 않는다', async () => {
    const { fake, svc } = setup({ [VICTIM]: GOOD });
    const h = studentHash(VICTIM);
    await run('INSERT INTO school_login_guard (student_hash, fails) VALUES (?, 8)', [h]);
    const stranger = await makeUser();
    const err = await attackerLink(svc, stranger, GOOD).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SchoolLocked);
    expect((err as SchoolLocked).long).toBe(true);
    noSchoolCalls(fake);
    expect((await guardRow(VICTIM))!.fails).toBe(8); // 시도가 하나도 소모되지 않았다
    expect(await all('SELECT 1 FROM school_link_probe WHERE user_id = ?', [stranger])).toHaveLength(0);
  });

  it('다른 학번에 연동한 사용자도 남의 멈춘 학번을 열 수 없다 (주인 판정은 그 학번의 HMAC 일치뿐)', async () => {
    const { uid, fake, svc } = await linkedOwner({ [OWNER_ID]: OWNER_PW, [VICTIM]: GOOD });
    await run('INSERT INTO school_login_guard (student_hash, fails) VALUES (?, 8)', [studentHash(VICTIM)]);
    resetLimits(uid);
    await expect(svc.link(uid, { creds: { studentId: VICTIM, password: GOOD }, cipher })).rejects.toBeInstanceOf(SchoolLocked);
    noSchoolCalls(fake);
  });

  it('요청 안의 평문 학번은 오류·DB 어디에도 남지 않는다', async () => {
    const { svc } = setup({ [VICTIM]: GOOD });
    const uid = await makeUser();
    const err = await attackerLink(svc, uid, 'secret-guess-123').catch((e: unknown) => e);
    expect(String((err as Error).message)).not.toContain(VICTIM);
    expect(JSON.stringify(await all('SELECT * FROM school_link_probe'))).not.toContain(VICTIM);
    expect(JSON.stringify(await all('SELECT * FROM school_login_guard'))).not.toContain(VICTIM);
  });
});

// ───────────────────────────────────────────────────────────────
describe('3. 탈퇴한 사용자의 남은 로그인 토큰은 서버를 학교 로그인 프록시로 쓰지 못한다', () => {
  async function deletedUser(): Promise<number> {
    const uid = await makeUser();
    await run('DELETE FROM users WHERE id = ?', [uid]);
    return uid;
  }

  it('link: 학교에 가기 전에 401 (FORBIDDEN 코드), 가짜 학교 호출 0, 아무것도 저장되지 않는다', async () => {
    const { fake, svc } = setup();
    const uid = await deletedUser();
    const err = await svc.link(uid, { creds: { studentId: OWNER_ID, password: OWNER_PW }, cipher }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiInputError);
    expect((err as ApiInputError).status).toBe(401);
    expect((err as ApiInputError).code).toBe('FORBIDDEN');
    noSchoolCalls(fake);
    expect(await all('SELECT 1 FROM school_login_guard')).toHaveLength(0);
    expect(await all('SELECT 1 FROM school_link_probe WHERE user_id = ?', [uid])).toHaveLength(0);
  });

  it('시간표·내 예약·바로 신청도 같다 (401, 학교 호출 0)', async () => {
    const { fake, svc } = setup();
    const uid = await deletedUser();
    const creds = { studentId: OWNER_ID, password: OWNER_PW };
    for (const fn of [
      () => svc.timetablePreview(uid, creds),
      () => svc.timetableImport(uid, creds),
      () => svc.myReservations(uid, creds),
      () => svc.bookPreview(uid, { creds, reservationId: 1 }),
      () => svc.bookSubmit(uid, { creds, reservationId: 1, items: {} }),
    ]) {
      resetLimits(uid);
      const err = await fn().catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ApiInputError);
      expect((err as ApiInputError).status).toBe(401);
    }
    noSchoolCalls(fake);
  });

  it('학교 로그인 도중에 계정이 지워지면 연동 성공이라고 알리지 않는다 (아무것도 저장되지 않는다)', async () => {
    const uid = await makeUser();
    const fake = createFakeSchool({ users: { [OWNER_ID]: OWNER_PW } });
    let deleted = false;
    const fetchWrapped = async (url: string, init: RequestInit): Promise<Response> => {
      const res = await fake.fetch(url, init);
      if (!deleted && url.includes('/jsp_21/index.jsp')) {
        deleted = true;
        await run('DELETE FROM users WHERE id = ?', [uid]); // 로그인은 이미 끝났고, 프로필을 읽는 사이에 탈퇴했다
      }
      return res;
    };
    const svc = createSchoolService({ fetch: fetchWrapped, now });
    const err = await svc.link(uid, { creds: { studentId: OWNER_ID, password: OWNER_PW }, cipher }).catch((e: unknown) => e);
    expect(deleted).toBe(true);
    expect(err).toBeInstanceOf(ApiInputError);
    expect((err as ApiInputError).status).toBe(401);
    expect(await get('SELECT 1 FROM users WHERE id = ?', [uid])).toBeUndefined();
  });
});

// ───────────────────────────────────────────────────────────────
describe('4. 암호문 자리에 평문이 들어오면 저장하지 않는다', () => {
  const creds = { studentId: '1999111', password: 'GoodPass2!' };
  const sealed = (ct: Buffer): SealedBox => ({ v: 2, iv: b64(12), ct: ct.toString('base64') });

  const plaintexts: [string, Buffer][] = [
    ['base64("학번:비밀번호")', Buffer.from(`${creds.studentId}:${creds.password}`, 'utf8')],
    ['JSON 평문', Buffer.from(JSON.stringify(creds), 'utf8')],
    ['비밀번호만 (UTF-8)', Buffer.concat([crypto.randomBytes(20).map((b) => b | 0x80) as Buffer, Buffer.from(creds.password, 'utf8'), crypto.randomBytes(8).map((b) => b | 0x80) as Buffer])],
    ['학번만 (UTF-16LE, 앞뒤에 무작위 바이트)', Buffer.concat([crypto.randomBytes(8), Buffer.from(creds.studentId, 'utf16le'), crypto.randomBytes(8)])],
    ['비밀번호 (UTF-16LE)', Buffer.concat([crypto.randomBytes(8), Buffer.from(creds.password, 'utf16le'), crypto.randomBytes(8)])],
    ['이중 base64', Buffer.from(Buffer.from(`${creds.studentId}:${creds.password}`).toString('base64'), 'utf8')],
    ['눈에 보이는 글자뿐인 임의 문장', Buffer.from('this is definitely not encrypted data at all', 'utf8')],
  ];

  it.each(plaintexts)('cipherLooksLikePlaintext: %s', (_name, bytes) => {
    expect(cipherLooksLikePlaintext(sealed(bytes), creds)).toBe(true);
  });

  it.each(plaintexts)('link: %s → 400, 학교 호출 0, 암호문이 저장되지 않는다', async (_name, bytes) => {
    const { fake, svc } = setup({ [creds.studentId]: creds.password });
    const uid = await makeUser();
    resetLimits(uid);
    const err = await svc.link(uid, { creds, cipher: sealed(bytes) }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiInputError);
    expect((err as ApiInputError).code).toBe('INVALID');
    expect((err as ApiInputError).message).not.toContain(creds.password);
    noSchoolCalls(fake);
    expect((await get<{ c: string | null }>('SELECT school_cipher AS c FROM users WHERE id = ?', [uid]))!.c).toBeNull();
  });

  it('진짜 AES-GCM 출력은 거절하지 않는다 (무작위 바이트 2000번 + 실제 암호화 500번)', () => {
    for (let i = 0; i < 2000; i++) {
      const n = 17 + Math.floor(Math.random() * 200);
      expect(cipherLooksLikePlaintext(sealed(crypto.randomBytes(n)), creds), `무작위 ${n}바이트`).toBe(false);
    }
    for (let i = 0; i < 500; i++) {
      const key = crypto.randomBytes(32);
      const iv = crypto.randomBytes(12);
      const c = crypto.createCipheriv('aes-256-gcm', key, iv);
      const ct = Buffer.concat([c.update(JSON.stringify(creds), 'utf8'), c.final(), c.getAuthTag()]);
      expect(cipherLooksLikePlaintext({ v: 2, iv: iv.toString('base64'), ct: ct.toString('base64') }, creds)).toBe(false);
    }
  });

  it('너무 짧은 비밀번호(4바이트 미만)는 무작위 바이트에도 우연히 들어 있을 수 있어 비교하지 않는다. 학번은 항상 비교한다', () => {
    const shortPw = { studentId: '1999111', password: 'ab' };
    const withAb = sealed(Buffer.concat([Buffer.from([0x80, 0x81]), Buffer.from('ab'), Buffer.from([0x90, 0x91, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9a, 0x9b, 0x9c, 0x9d])]));
    expect(cipherLooksLikePlaintext(withAb, shortPw)).toBe(false);
    const withId = sealed(Buffer.concat([crypto.randomBytes(8).map((b) => b | 0x80) as Buffer, Buffer.from(shortPw.studentId), crypto.randomBytes(8).map((b) => b | 0x80) as Buffer]));
    expect(cipherLooksLikePlaintext(withId, shortPw)).toBe(true);
  });

  it('형식이 맞는 정상 암호문은 연동된다', async () => {
    const { svc } = setup({ [creds.studentId]: creds.password });
    const uid = await makeUser();
    resetLimits(uid);
    const res = await svc.link(uid, { creds, cipher: { v: 2, iv: crypto.randomBytes(12).toString('base64'), ct: crypto.randomBytes(48).toString('base64') } });
    expect(res.linked).toBe(true);
  });
});

// ───────────────────────────────────────────────────────────────
describe('5. 예약 번호는 int4 범위 안에서만 DB 로 간다', () => {
  it('parseReservationId: 1 ~ 2147483647 만 허용', () => {
    expect(parseReservationId(1)).toBe(1);
    expect(parseReservationId(2147483647)).toBe(2147483647);
    for (const bad of [0, -1, 1.5, 2147483648, 2 ** 40, 9007199254740991, 9007199254740992, Number.NaN, Number.POSITIVE_INFINITY, '5', null, undefined]) {
      expect(() => parseReservationId(bad), String(bad)).toThrow(ApiInputError);
    }
  });

  it('미리보기·제출은 범위를 넘으면 400 INVALID 이고 DB·학교에 닿지 않는다 (예전에는 DB 22003 오류로 500)', async () => {
    const { uid, svc, fake } = await linkedOwner();
    const creds = { studentId: OWNER_ID, password: OWNER_PW };
    for (const rid of [2147483648, 9007199254740992, 2 ** 53]) {
      resetLimits(uid);
      for (const fn of [() => svc.bookPreview(uid, { creds, reservationId: rid }), () => svc.bookSubmit(uid, { creds, reservationId: rid, items: {} })]) {
        const err = await fn().catch((e: unknown) => e);
        expect(err, String(rid)).toBeInstanceOf(ApiInputError);
        expect((err as ApiInputError).code).toBe('INVALID');
        expect((err as ApiInputError).status).toBe(400);
      }
    }
    noSchoolCalls(fake);
  });

  it('상한 그대로(2147483647)는 검증을 통과해 NOT_FOUND(404) 가 된다 — DB 오류가 아니다', async () => {
    const { uid, svc } = await linkedOwner();
    resetLimits(uid);
    const err = await svc.bookPreview(uid, { creds: { studentId: OWNER_ID, password: OWNER_PW }, reservationId: 2147483647 }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiInputError);
    expect((err as ApiInputError).code).toBe('NOT_FOUND');
  });
});

// ───────────────────────────────────────────────────────────────
describe('6. 저장된 비밀번호가 틀어졌을 때 (학생이 학교 비밀번호를 바꿨다): 학교 계정이 잠기지 않는다', () => {
  it('시간표·내 예약을 계속 눌러도 학교로 나가는 로그인은 8번에서 멈추고 몇 달이 지나도 늘지 않는다', async () => {
    const { uid, svc, fake } = await linkedOwner();
    const stale = { studentId: OWNER_ID, password: 'OLD-password-1' }; // 학생이 학교에서 비밀번호를 바꿨는데 우리 쪽 암호문은 옛 것
    let sent = 0;
    for (let day = 0; day < 120; day++) {
      for (let k = 0; k < 3; k++) {
        resetLimits(uid);
        const before = fake.state.infoLogins;
        await (k === 0 ? svc.timetablePreview(uid, stale) : svc.timetableImport(uid, stale)).catch(() => undefined);
        sent += fake.state.infoLogins - before;
        clock += 31 * MIN; // 30분 잠금이 풀릴 만큼
      }
      clock += DAY;
    }
    expect(sent).toBe(8);
    expect(fake.state.infoLogins).toBe(8);
    expect(fake.state.infoLogins).toBeLessThan(10); // 학교의 계정 잠금 한도
  });
});
