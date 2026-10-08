import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// 임시 DB — 실행 중인 개발 DB 와 절대 겹치지 않게 import 전에 환경을 정한다
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'school-guard-test-'));
process.env.DATA_DIR = dataDir;
process.env.JWT_SECRET = 'guard-test-secret-0123456789abcdef';
delete process.env.DATABASE_URL;

import { all, get, insert, ready, run } from '../db.js';
import {
  LINK_PROBE_MAX_FAILS,
  LINK_PROBE_MAX_FAILS_PER_ID,
  LINK_PROBE_MAX_IDS,
  SCHOOL_FINAL_STOP_AFTER,
  SCHOOL_HARD_LOCK_AFTER,
  SCHOOL_LOCK_AFTER,
  SCHOOL_LOCK_MIN,
  UNVERIFIED_SITE_BACKOFF_HOURS,
  assertLinkProbeBudget,
  assertNotLocked,
  claimRelinkAttempt,
  clearLinkProbe,
  guardedLogin,
  isSiteBackedOff,
  lockDurationMs,
  lockStateOf,
  recordFailure,
  recordLinkProbeFailure,
  recordSuccess,
  resetGuardSecretCache,
  resetStudentGuard,
  setSiteBackoff,
  studentHash,
  studentLinkHash,
} from './guard.js';
import { ApiInputError, SchoolAuthFailed, SchoolLocked, SchoolUnavailable } from './http.js';

const T0 = Date.UTC(2026, 9, 8, 3, 0, 0);
const MIN = 60_000;
const HOUR = 60 * MIN;

beforeAll(async () => {
  await ready();
}, 60_000);

afterAll(() => {
  fs.rmSync(dataDir, { recursive: true, force: true });
});

const row = (hash: string) =>
  get<{ fails: number; lockedUntil: Date | null }>(
    'SELECT fails, locked_until AS "lockedUntil" FROM school_login_guard WHERE student_hash = ?',
    [hash],
  );

const locked = async (hash: string, at: number): Promise<SchoolLocked | null> => {
  try {
    await assertNotLocked(hash, at);
    return null;
  } catch (err) {
    if (err instanceof SchoolLocked) return err;
    throw err;
  }
};

describe('규칙 상수와 순수 규칙', () => {
  it('상수: 5회째 30분, 8회째 상태 멈춤, 9회째 완전 중단 (학교의 10회 한도 앞)', () => {
    expect([SCHOOL_LOCK_AFTER, SCHOOL_LOCK_MIN, SCHOOL_HARD_LOCK_AFTER, SCHOOL_FINAL_STOP_AFTER]).toEqual([5, 30, 8, 9]);
    expect(SCHOOL_FINAL_STOP_AFTER).toBeLessThan(10);
  });

  it('lockDurationMs: 4회까지 0, 5~7회 30분, 8회부터는 시간 잠금이 아니라 상태로 멈추므로 0', () => {
    expect([0, 1, 2, 3, 4].map(lockDurationMs)).toEqual([0, 0, 0, 0, 0]);
    expect([5, 6, 7].map(lockDurationMs)).toEqual([30 * MIN, 30 * MIN, 30 * MIN]);
    expect([8, 9, 12].map(lockDurationMs)).toEqual([0, 0, 0]);
  });

  it('lockStateOf: 8회 이상은 locked_until 이 없거나 지나도 항상 hard', () => {
    expect(lockStateOf(4, null, T0)).toEqual({ kind: 'open' });
    expect(lockStateOf(5, T0 + MIN, T0)).toEqual({ kind: 'timed', untilMs: T0 + MIN });
    expect(lockStateOf(5, T0 - MIN, T0)).toEqual({ kind: 'open' }); // 30분이 지났다 (횟수는 유지)
    expect(lockStateOf(8, null, T0)).toEqual({ kind: 'hard', fails: 8 });
    expect(lockStateOf(8, T0 - 5 * HOUR, T0 + 1000 * HOUR)).toEqual({ kind: 'hard', fails: 8 });
    expect(lockStateOf(9, null, T0)).toEqual({ kind: 'hard', fails: 9 });
  });
});

describe('studentHash', () => {
  it('학번 원문을 담지 않고, 같은 학번은 같은 값, 다른 학번은 다른 값', () => {
    const h = studentHash('2021204044');
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(h).not.toContain('2021204044');
    expect(studentHash('2021204044')).toBe(h);
    expect(studentHash('2021204045')).not.toBe(h);
  });

  it('서버 비밀이 달라지면 해시도 달라진다 (학번만으로 역산할 수 없다)', () => {
    const before = studentHash('2021204044');
    process.env.JWT_SECRET = 'another-secret-value-for-test-xxxxxxxx';
    resetGuardSecretCache();
    expect(studentHash('2021204044')).not.toBe(before);
    process.env.JWT_SECRET = 'guard-test-secret-0123456789abcdef';
    resetGuardSecretCache();
    expect(studentHash('2021204044')).toBe(before);
  });
});

describe('실패 가드 (연속 5회 → 30분, 8회 → 상태로 멈춤)', () => {
  it('4회 실패까지는 잠금 없음, 5회째 실패에서 30분 잠금', async () => {
    const h = studentHash('1000000001');
    for (let i = 1; i <= 4; i++) {
      const r = await recordFailure(h, T0 + i * 1000);
      expect(r.fails).toBe(i);
      expect(r.lockedUntil).toBeNull();
      expect(await locked(h, T0 + i * 1000)).toBeNull();
    }
    const fifth = await recordFailure(h, T0 + 5000);
    expect(fifth.fails).toBe(5);
    expect(fifth.lockedUntil!.getTime()).toBe(T0 + 5000 + 30 * MIN);

    const err = await locked(h, T0 + 6000);
    expect(err).toBeInstanceOf(SchoolLocked);
    expect(err!.long).toBe(false);
    expect(err!.code).toBe('SCHOOL_LOCKED');
    expect(err!.retryAfterSec).toBe(30 * 60 - 1);
  });

  it('SCHOOL_LOCKED 문구: 30분 잠금은 지시된 문장, "비밀번호 초기화" 표현이 없다', async () => {
    const h = studentHash('1000000002');
    for (let i = 0; i < 5; i++) await recordFailure(h, T0);
    const err = (await locked(h, T0))!;
    expect(err.message).toBe('학교 계정이 잠기지 않도록 학교 로그인을 잠시 멈췄어요. 30분 뒤에 다시 시도할 수 있어요.');
    expect(err.message).not.toContain('초기화');
    expect(new SchoolAuthFailed().message).toContain('10번 틀리면 계정이 잠겨요.');
    expect(new SchoolAuthFailed().message).not.toContain('초기화');
  });

  it('잠금이 끝나도 fails 는 0 으로 돌아가지 않고, 잠금 뒤 또 틀리면 6·7회째로 이어져 다시 30분 잠긴다', async () => {
    const h = studentHash('1000000003');
    for (let i = 0; i < 5; i++) await recordFailure(h, T0);
    expect(await locked(h, T0 + 29 * MIN)).toBeInstanceOf(SchoolLocked);

    // 잠금 만료 후: 통과하지만 횟수는 유지
    expect(await locked(h, T0 + 31 * MIN)).toBeNull();
    expect((await row(h))!.fails).toBe(5);

    const sixth = await recordFailure(h, T0 + 31 * MIN);
    expect(sixth.fails).toBe(6);
    expect(sixth.lockedUntil!.getTime()).toBe(T0 + 31 * MIN + 30 * MIN);
    expect(await locked(h, T0 + 32 * MIN)).toBeInstanceOf(SchoolLocked);

    const seventh = await recordFailure(h, T0 + 62 * MIN);
    expect(seventh.fails).toBe(7);
    expect(seventh.lockedUntil!.getTime()).toBe(T0 + 62 * MIN + 30 * MIN);
    expect((await locked(h, T0 + 63 * MIN))!.long).toBe(false);
  });

  it('8회째 실패에서 시간이 아니라 상태로 멈춘다: 얼마가 지나도 풀리지 않는다 (24시간 뒤에 한 번씩 다시 두드리지 않는다)', async () => {
    const h = studentHash('1000000004');
    for (let i = 0; i < 7; i++) await recordFailure(h, T0);
    const eighth = await recordFailure(h, T0 + 31 * MIN);
    expect(eighth.fails).toBe(8);
    expect(eighth.lockedUntil).toBeNull(); // 시간 잠금이 아니다

    for (const at of [31 * MIN + 29 * MIN, 60 * MIN, 31 * MIN + 24 * HOUR + 1000, 100 * 24 * HOUR]) {
      const err = (await locked(h, T0 + at))!;
      expect(err, `+${at}ms 에 풀렸다`).toBeInstanceOf(SchoolLocked);
      expect(err.long).toBe(true);
      expect(err.retryAfterSec).toBe(0); // 기다린다고 풀리지 않는다
      expect(err.needsRelink).toBe(true); // 주인이 새 비밀번호로 한 번 다시 연동할 수 있다
    }
    const err = (await locked(h, T0 + 60 * MIN))!;
    expect(err.message).not.toContain('24시간'); // 시간으로 풀린다고 안내하지 않는다
    expect(err.message).toContain('학교 포털에서 직접 로그인해 비밀번호를 확인한 뒤 다시 연동해 주세요');
    expect(err.message).not.toContain('초기화');
  });

  it('9회 이상이면 완전 중단: 다시 연동할 수도 없다고 알린다', async () => {
    const h = studentHash('1000000012');
    for (let i = 0; i < 9; i++) await recordFailure(h, T0);
    const err = (await locked(h, T0 + 1000 * HOUR))!;
    expect(err.long).toBe(true);
    expect(err.needsRelink).toBe(false);
    expect(err.message).toContain('운영자');
  });

  it('옛 규칙(8회째 24시간 잠금)으로 남은 행도 8회 이상이면 시간이 지나도 멈춰 있다', async () => {
    const h = studentHash('1000000013');
    await run('INSERT INTO school_login_guard (student_hash, fails, first_fail_at, locked_until) VALUES (?, 8, ?::timestamptz, ?::timestamptz)', [
      h,
      new Date(T0).toISOString(),
      new Date(T0 + 24 * HOUR).toISOString(),
    ]);
    expect(await locked(h, T0 + 25 * HOUR)).toBeInstanceOf(SchoolLocked);
    expect(await locked(h, T0 + 500 * HOUR)).toBeInstanceOf(SchoolLocked);
  });

  it('성공하면 횟수와 잠금이 모두 초기화되고, 다시 4회까지는 잠기지 않는다', async () => {
    const h = studentHash('1000000005');
    for (let i = 0; i < 5; i++) await recordFailure(h, T0);
    expect(await locked(h, T0 + MIN)).toBeInstanceOf(SchoolLocked);
    await recordSuccess(h);
    expect(await row(h)).toMatchObject({ fails: 0, lockedUntil: null });
    expect(await locked(h, T0 + MIN)).toBeNull();
    for (let i = 0; i < 4; i++) await recordFailure(h, T0 + 2 * MIN);
    expect(await locked(h, T0 + 2 * MIN)).toBeNull();
    expect((await row(h))!.fails).toBe(4);
  });

  it('동시에 들어온 실패도 하나도 빠지지 않고 센다', async () => {
    const h = studentHash('1000000006');
    await Promise.all([1, 2, 3, 4].map(() => recordFailure(h, T0)));
    expect((await row(h))!.fails).toBe(4);
  });
});

describe('guardedLogin', () => {
  it('잠금 중에는 login 을 한 번도 부르지 않는다 (학교 호출 0회)', async () => {
    const h = studentHash('1000000007');
    for (let i = 0; i < 5; i++) await recordFailure(h, Date.now());
    let calls = 0;
    await expect(
      guardedLogin('1000000007', async () => {
        calls += 1;
      }),
    ).rejects.toBeInstanceOf(SchoolLocked);
    expect(calls).toBe(0);
  });

  it('SchoolAuthFailed 는 실패로 세고 그대로 던진다 / 성공하면 초기화한다', async () => {
    const id = '1000000008';
    const h = studentHash(id);
    const fail = () => guardedLogin(id, async () => Promise.reject(new SchoolAuthFailed()));
    await expect(fail()).rejects.toBeInstanceOf(SchoolAuthFailed);
    await expect(fail()).rejects.toBeInstanceOf(SchoolAuthFailed);
    expect((await row(h))!.fails).toBe(2);
    await expect(guardedLogin(id, async () => 'ok')).resolves.toBe('ok');
    expect((await row(h))!.fails).toBe(0);
  });

  it('점검·타임아웃(SchoolUnavailable)은 비밀번호 판정이 아니므로 실패로 세지 않는다', async () => {
    const id = '1000000009';
    await expect(guardedLogin(id, async () => Promise.reject(new SchoolUnavailable()))).rejects.toBeInstanceOf(SchoolUnavailable);
    expect(await row(studentHash(id))).toBeUndefined();
  });

  it('5번째 AuthFailed 로 잠기면 그다음 호출은 학교에 가지 않는다', async () => {
    const id = '1000000010';
    let calls = 0;
    const attempt = () =>
      guardedLogin(id, async () => {
        calls += 1;
        throw new SchoolAuthFailed();
      });
    for (let i = 0; i < 5; i++) await expect(attempt()).rejects.toBeInstanceOf(SchoolAuthFailed);
    expect(calls).toBe(5);
    await expect(attempt()).rejects.toBeInstanceOf(SchoolLocked);
    await expect(attempt()).rejects.toBeInstanceOf(SchoolLocked);
    expect(calls).toBe(5);
  });

  it('같은 학번의 로그인이 진행 중이면 두 번째는 학교에 가지 않는다', async () => {
    const id = '1000000011';
    let calls = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const first = guardedLogin(id, async () => {
      calls += 1;
      await gate;
      return 1;
    });
    // 첫 번째가 assertNotLocked 를 마치고 로그인 중일 때까지 기다린다
    await new Promise((r) => setTimeout(r, 200));
    const second = guardedLogin(id, async () => {
      calls += 1;
      return 2;
    });
    await expect(second).rejects.toBeInstanceOf(ApiInputError);
    release();
    await expect(first).resolves.toBe(1);
    expect(calls).toBe(1);
  });
});

// ───────────────────────────────────────────────────────────────
describe('안전선: 8회 실패 뒤에는 시간이 지나도 학교로 나가지 않는다 (학교의 10회 한도에 닿지 않는다)', () => {
  /** 항상 틀리는 로그인을 시간을 건너뛰며 계속 시도했을 때 학교로 나간 요청 수 */
  async function simulate(id: string, steps: number, options: { relink?: boolean } = {}): Promise<{ calls: number }> {
    let t = T0;
    let calls = 0;
    for (let i = 0; i < steps; i++) {
      try {
        await guardedLogin(
          id,
          async () => {
            calls += 1;
            throw new SchoolAuthFailed();
          },
          () => t,
          options,
        );
      } catch (err) {
        if (err instanceof SchoolLocked) {
          t += err.long ? 25 * HOUR : (err.retryAfterSec + 1) * 1000; // 잠금이 풀릴 때(또는 하루 뒤)마다 다시 시도한다
          continue;
        }
      }
      t += 1000;
    }
    return { calls };
  }

  it('계속 틀리는 저장된 비밀번호: 학교로 나가는 요청은 정확히 8번에서 멈추고, 1년이 지나도 늘지 않는다', async () => {
    const id = '1000000020';
    const r = await simulate(id, 400); // 하루에 한 번꼴로 400번 → 1년 넘게
    expect(r.calls).toBe(SCHOOL_HARD_LOCK_AFTER);
    expect(r.calls).toBeLessThan(10);
    expect((await row(studentHash(id)))!.fails).toBe(8);
  });

  it('주인의 다시 연동(relink)은 시도 한 번만 허용하고, 그것도 실패하면 완전히 멈춘다', async () => {
    const id = '1000000021';
    const first = await simulate(id, 100);
    expect(first.calls).toBe(8);
    // 주인이 학교 포털에서 비밀번호를 확인하고 다시 연동했지만 틀렸다
    const afterRelink = await simulate(id, 100, { relink: true });
    expect(afterRelink.calls).toBe(1); // 딱 한 번
    expect((await row(studentHash(id)))!.fails).toBe(SCHOOL_FINAL_STOP_AFTER);
    // 학교의 실패 횟수는 우리가 만든 것만 세어도 9 — 한도 10 앞에서 멈췄다
    expect(first.calls + afterRelink.calls).toBeLessThan(10);
    const again = await simulate(id, 100, { relink: true });
    expect(again.calls).toBe(0); // 완전 중단 — relink 로도 열리지 않는다
  });

  it('주인의 다시 연동이 성공하면 횟수와 멈춤이 모두 풀린다', async () => {
    const id = '1000000022';
    await simulate(id, 100);
    const h = studentHash(id);
    expect((await row(h))!.fails).toBe(8);
    await expect(guardedLogin(id, async () => 'ok', () => T0 + 1000 * HOUR, { relink: true })).resolves.toBe('ok');
    expect(await row(h)).toMatchObject({ fails: 0, lockedUntil: null });
    // 풀린 뒤에는 다시 처음부터 (4회까지는 잠금 없음)
    expect(await locked(h, T0 + 1001 * HOUR)).toBeNull();
  });

  it('relink 가 아닌 호출(저장된 비밀번호를 쓰는 모든 기능)은 멈춘 학번에 학교 호출 0회', async () => {
    const id = '1000000023';
    await simulate(id, 100);
    let calls = 0;
    for (let i = 0; i < 5; i++) {
      await expect(
        guardedLogin(
          id,
          async () => {
            calls += 1;
          },
          () => T0 + (500 + i) * HOUR,
        ),
      ).rejects.toBeInstanceOf(SchoolLocked);
    }
    expect(calls).toBe(0);
    // 시도가 하나도 소모되지 않았다
    expect((await row(studentHash(id)))!.fails).toBe(8);
  });

  it('relink 는 8회에서 멈춘 상태에서만 열린다: 5~7회째 쉬는 시간 중이거나 아직 잠기지 않았다면 효과가 없다', async () => {
    const id = '1000000024';
    const h = studentHash(id);
    for (let i = 0; i < 6; i++) await recordFailure(h, T0); // 6회 → 30분 잠금 중
    let calls = 0;
    await expect(
      guardedLogin(
        id,
        async () => {
          calls += 1;
        },
        () => T0 + MIN,
        { relink: true },
      ),
    ).rejects.toBeInstanceOf(SchoolLocked);
    expect(calls).toBe(0);
    // 쉬는 시간이 끝나면 relink 와 상관없이 일반 규칙대로 통과하고, 실패는 평소처럼 센다 (relink 가 9 로 건너뛰지 않는다)
    await expect(
      guardedLogin(
        id,
        async () => {
          throw new SchoolAuthFailed();
        },
        () => T0 + 31 * MIN,
        { relink: true },
      ),
    ).rejects.toBeInstanceOf(SchoolAuthFailed);
    expect((await row(h))!.fails).toBe(7);
  });

  it('relink 시도가 비밀번호 판정 없이 끝나면(점검·타임아웃) 시도를 돌려받는다', async () => {
    const id = '1000000025';
    await simulate(id, 100);
    const h = studentHash(id);
    await expect(
      guardedLogin(
        id,
        async () => {
          throw new SchoolUnavailable();
        },
        () => T0 + 1000 * HOUR,
        { relink: true },
      ),
    ).rejects.toBeInstanceOf(SchoolUnavailable);
    expect((await row(h))!.fails).toBe(8); // 9 로 남지 않았다 — 주인은 아직 한 번 시도할 수 있다
    await expect(guardedLogin(id, async () => 'ok', () => T0 + 1001 * HOUR, { relink: true })).resolves.toBe('ok');
  });

  it('relink 시도는 학교로 보내기 전에 이미 횟수에 센다 (요청 중 서버가 죽어도 시도가 공짜로 늘지 않는다)', async () => {
    const id = '1000000026';
    await simulate(id, 100);
    const h = studentHash(id);
    let seenInside = -1;
    await guardedLogin(
      id,
      async () => {
        seenInside = (await row(h))!.fails;
        return 'ok';
      },
      () => T0 + 1000 * HOUR,
      { relink: true },
    );
    expect(seenInside).toBe(SCHOOL_FINAL_STOP_AFTER);
  });

  it('같은 학번의 relink 가 동시에 두 번 와도 학교에는 한 번만 나간다', async () => {
    const id = '1000000027';
    await simulate(id, 100);
    let calls = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const first = guardedLogin(
      id,
      async () => {
        calls += 1;
        await gate;
        return 1;
      },
      () => T0 + 1000 * HOUR,
      { relink: true },
    );
    await new Promise((r) => setTimeout(r, 200));
    const second = guardedLogin(
      id,
      async () => {
        calls += 1;
        return 2;
      },
      () => T0 + 1000 * HOUR,
      { relink: true },
    );
    await expect(second).rejects.toSatisfy((e: unknown) => e instanceof ApiInputError || e instanceof SchoolLocked);
    release();
    await expect(first).resolves.toBe(1);
    expect(calls).toBe(1);
  });

  it('claimRelinkAttempt: 동시에 여러 요청(다른 인스턴스 포함)이 와도 시도는 정확히 하나만 확보한다', async () => {
    const id = '1000000029';
    const h = studentHash(id);
    for (let i = 0; i < 8; i++) await recordFailure(h, T0);
    const results = await Promise.all([1, 2, 3, 4, 5].map(() => claimRelinkAttempt(h)));
    expect(results.filter(Boolean)).toHaveLength(1);
    expect((await row(h))!.fails).toBe(SCHOOL_FINAL_STOP_AFTER);
    expect(await claimRelinkAttempt(h)).toBe(false); // 이미 가져갔다
  });

  it('resetStudentGuard(운영자): 완전 중단을 풀어 처음 상태로 돌린다', async () => {
    const id = '1000000028';
    const h = studentHash(id);
    for (let i = 0; i < 9; i++) await recordFailure(h, T0);
    expect(await locked(h, T0)).toBeInstanceOf(SchoolLocked);
    await resetStudentGuard(id);
    expect(await locked(h, T0)).toBeNull();
    expect(await row(h)).toBeUndefined();
  });
});

describe('guardedLogin verdict:false (신청 흐름이 확인되지 않은 사이트)', () => {
  it('실패해도 공유 실패 횟수를 올리지 않고, 성공해도 다른 사이트에서 쌓인 실패를 지우지 않는다', async () => {
    const id = '1000000030';
    const h = studentHash(id);
    for (let i = 0; i < 2; i++) await recordFailure(h, T0);
    await expect(
      guardedLogin(
        id,
        async () => {
          throw new SchoolAuthFailed();
        },
        () => T0,
        { verdict: false },
      ),
    ).rejects.toBeInstanceOf(SchoolAuthFailed);
    expect((await row(h))!.fails).toBe(2);
    await expect(guardedLogin(id, async () => 'ok', () => T0, { verdict: false })).resolves.toBe('ok');
    expect((await row(h))!.fails).toBe(2);
  });

  it('잠겨 있으면 verdict:false 여도 학교로 나가지 않는다', async () => {
    const id = '1000000031';
    for (let i = 0; i < 5; i++) await recordFailure(studentHash(id), Date.now());
    let calls = 0;
    await expect(
      guardedLogin(
        id,
        async () => {
          calls += 1;
        },
        Date.now,
        { verdict: false },
      ),
    ).rejects.toBeInstanceOf(SchoolLocked);
    expect(calls).toBe(0);
  });
});

describe('확인되지 않은 예약 사이트(hsel)의 로그인 실패 후 쉬는 시간 — DB', () => {
  it('설정하면 24시간 동안 true, 그 뒤 false. 학번 가드의 fails 와 섞이지 않는다', async () => {
    const id = '1000000040';
    expect(await isSiteBackedOff(id, 'hsel', T0)).toBe(false);
    await setSiteBackoff(id, 'hsel', T0);
    expect(await isSiteBackedOff(id, 'hsel', T0 + (UNVERIFIED_SITE_BACKOFF_HOURS - 1) * HOUR)).toBe(true);
    expect(await isSiteBackedOff(id, 'hsel', T0 + (UNVERIFIED_SITE_BACKOFF_HOURS + 1) * HOUR)).toBe(false);
    expect(await isSiteBackedOff(id, 'onestop', T0)).toBe(false); // 다른 사이트는 영향 없음
    expect(await isSiteBackedOff('1000000041', 'hsel', T0)).toBe(false); // 다른 학번도 영향 없음
    expect(await row(studentHash(id))).toBeUndefined(); // 학번 가드 행은 건드리지 않았다
    await expect(assertNotLocked(studentHash(id), T0)).resolves.toBeUndefined();
  });

  it('상태는 DB 에만 있다 (다른 서버 인스턴스에서도 보인다)', async () => {
    const id = '1000000042';
    await setSiteBackoff(id, 'hsel', T0);
    const rows = await all<{ student_hash: string }>('SELECT student_hash FROM school_login_guard WHERE student_hash = ?', [`${studentHash(id)}:hsel`]);
    expect(rows).toHaveLength(1);
  });
});

describe('studentLinkHash', () => {
  it('결정적이고 64자 hex 이며 학번 원문을 담지 않고, 가드 키(studentHash)와 달라서 DB 만 보고는 이을 수 없다', () => {
    const h = studentLinkHash('2021204044');
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(h).not.toContain('2021204044');
    expect(studentLinkHash('2021204044')).toBe(h);
    expect(studentLinkHash('2021204045')).not.toBe(h);
    expect(h).not.toBe(studentHash('2021204044'));
  });
});

describe('확인되지 않은 학번으로의 연동 시도 상한 (남의 학번 가드 소진 방지)', () => {
  let n = 0;
  async function newUserId(): Promise<number> {
    n += 1;
    return insert("INSERT INTO users (email, name, password_hash) VALUES (?, ?, 'x') RETURNING id", [
      `probe${n}-${Date.now()}@hansung.ac.kr`,
      `p${n}`,
    ]);
  }
  const blocked = (p: Promise<void>) => p.then(() => false, (e: unknown) => e instanceof ApiInputError && e.code === 'RATE_LIMITED');

  it('한 사용자가 같은 학번으로 24시간에 LINK_PROBE_MAX_FAILS 번까지만 실패를 만들 수 있다', async () => {
    const uid = await newUserId();
    const h = studentLinkHash('1999000001');
    for (let i = 0; i < LINK_PROBE_MAX_FAILS; i++) {
      await assertLinkProbeBudget(uid, h, T0 + i * MIN);
      await recordLinkProbeFailure(uid, h, T0 + i * MIN);
    }
    expect(await blocked(assertLinkProbeBudget(uid, h, T0 + 10 * MIN))).toBe(true);
    // 24시간이 지나면 다시 열린다
    await expect(assertLinkProbeBudget(uid, h, T0 + 25 * HOUR)).resolves.toBeUndefined();
  });

  it('한 사용자가 24시간에 건드릴 수 있는 서로 다른 학번은 LINK_PROBE_MAX_IDS 개까지', async () => {
    const uid = await newUserId();
    for (let i = 0; i < LINK_PROBE_MAX_IDS; i++) {
      const h = studentLinkHash(`199900010${i}`);
      await assertLinkProbeBudget(uid, h, T0);
      await recordLinkProbeFailure(uid, h, T0);
    }
    expect(await blocked(assertLinkProbeBudget(uid, studentLinkHash('1999000199'), T0 + MIN))).toBe(true);
    // 이미 시도한 학번은 (자기 상한 안에서) 계속 쓸 수 있다
    await expect(assertLinkProbeBudget(uid, studentLinkHash('1999000100'), T0 + MIN)).resolves.toBeUndefined();
  });

  it('계정을 여러 개 만들어도 한 학번에 하루 LINK_PROBE_MAX_FAILS_PER_ID 번을 넘는 실패를 만들 수 없다 (공유 가드 5회 앞)', async () => {
    expect(LINK_PROBE_MAX_FAILS_PER_ID).toBeLessThan(SCHOOL_LOCK_AFTER);
    const h = studentLinkHash('1999000301');
    const users = [await newUserId(), await newUserId(), await newUserId()];
    let made = 0;
    for (const uid of users) {
      for (let i = 0; i < LINK_PROBE_MAX_FAILS; i++) {
        if (await blocked(assertLinkProbeBudget(uid, h, T0))) break;
        await recordLinkProbeFailure(uid, h, T0);
        made += 1;
      }
    }
    expect(made).toBe(LINK_PROBE_MAX_FAILS_PER_ID);
    expect(await blocked(assertLinkProbeBudget(await newUserId(), h, T0))).toBe(true); // 새 계정도 막힌다
    await expect(assertLinkProbeBudget(await newUserId(), h, T0 + 25 * HOUR)).resolves.toBeUndefined();
  });

  it('연동에 성공하면 그 사용자의 그 학번 실패 기록을 지운다', async () => {
    const uid = await newUserId();
    const h = studentLinkHash('1999000401');
    await recordLinkProbeFailure(uid, h, Date.now());
    await recordLinkProbeFailure(uid, h, Date.now());
    await clearLinkProbe(uid, h);
    expect(await all('SELECT 1 FROM school_link_probe WHERE user_id = ?', [uid])).toHaveLength(0);
  });

  it('사용자를 지우면 기록도 함께 지워지고, 기록에는 학번 원문이 없다', async () => {
    const uid = await newUserId();
    await recordLinkProbeFailure(uid, studentLinkHash('1999000501'), Date.now());
    expect(JSON.stringify(await all('SELECT * FROM school_link_probe WHERE user_id = ?', [uid]))).not.toContain('1999000501');
    await run('DELETE FROM users WHERE id = ?', [uid]);
    expect(await all('SELECT 1 FROM school_link_probe WHERE user_id = ?', [uid])).toHaveLength(0);
  });
});
