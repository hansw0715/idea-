/**
 * 학교 로그인 실패 가드 + 사용자 호출 제한. 설계: docs/school/00-design.md §3
 *
 * 왜: 학교는 로그인을 10번 틀리면 계정을 **잠근다.** 학생이 비밀번호를 바꾼 뒤 우리 서버가 옛 비밀번호로
 * 자동으로 계속 두드리면 그 학생의 학교 계정이 잠긴다. 그래서 우리 쪽에서 먼저 멈춘다.
 *
 * 규칙 (연속 실패 횟수 fails 기준 — 성공하면 0)
 *  - 4회 실패까지는 잠금 없음.
 *  - 5~7회째 실패: 그때마다 30분 잠금. **잠금이 끝나도 fails 는 0 으로 돌리지 않는다** — 돌리면 5+5=10 이 되어 학교 계정이 잠긴다.
 *  - 8회째 실패(SCHOOL_HARD_LOCK_AFTER): **시간이 아니라 상태로 멈춘다.** 시간으로 풀면(예전: 24시간) 풀릴 때마다 한 번씩
 *    더 두드려 이틀 만에 학교의 10회 한도에 닿는다. 이 상태에서는 저장된 옛 비밀번호를 쓰는 어떤 요청도 학교로 나가지 않는다.
 *    딱 하나의 예외: 이 연동의 **주인**(학교 로그인으로 확인된 학번의 사용자)이 학교 포털에서 확인한 새 비밀번호로 다시 연동(/link)
 *    할 때 **한 번만** 시도를 허용한다 (fails 8 → 9). 그 시도가 성공하면 모두 초기화, 실패하면 fails=9 가 되어
 *  - 9회(SCHOOL_FINAL_STOP_AFTER) 이상: 완전 중단. 운영자가 풀어 주기 전까지 이 학번은 어떤 요청도 학교로 나가지 않는다.
 *    (학교 쪽 실패는 우리가 만든 것만 세면 최대 9회 — 한도 10회 앞에서 멈춘다.)
 *  - 잠겨 있으면 학교에 요청을 보내지 않고 SCHOOL_LOCKED.
 *  - 성공하면 모두 초기화.
 *
 * 학번 원문은 저장하지 않는다: student_hash = HMAC-SHA256(서버 비밀, 학번).
 *
 * 남의 학번을 두드려 이 가드를 소진시키는 일(DoS)을 막는 장치는 세 겹이다.
 *  1) service.requireLinked 가 연동한 학번과 정확히 같은 학번(HMAC 비교)만 통과시킨다 → 연동 뒤의 모든 기능은 자기 학번만 쓴다.
 *  2) /link 는 아직 확인되지 않은 학번이면 (사용자, 학번)별·사용자별·학번별 시도 상한(LINK_PROBE_*)을 둔다.
 *  3) 신청 흐름이 확인되지 않은 예약 사이트의 로그인 실패는 이 가드의 실패 횟수에 세지 않는다 (guardedLogin 의 verdict:false).
 *
 * 한계(숨기지 않는다): 학교는 로그인 시도가 어느 계정에서 왔는지 구분하지 못하므로, 아직 연동하지 않은 학번에 대한
 * "비밀번호를 아는 사람인지" 확인은 결국 학교 로그인 한 번이다. 상한은 그 시도를 하루 몇 번으로 묶을 뿐 없애지는 못한다.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { all, get, isServerless, resolveDataDir, run } from '../db.js';
import { createRateLimiter } from '../rateLimit.js';
import { ApiInputError, SchoolAuthFailed, SchoolLocked } from './http.js';

// ── 규칙 상수 (한 곳) ─────────────────────────────────────────────

/** 연속 이 횟수만큼 실패하면 잠근다 */
export const SCHOOL_LOCK_AFTER = 5;
/** 위 잠금의 길이 (분) */
export const SCHOOL_LOCK_MIN = 30;
/** 연속 이 횟수에 이르면 시간이 아니라 상태로 멈춘다 (학교의 10회 한도 앞 안전선) */
export const SCHOOL_HARD_LOCK_AFTER = 8;
/** 연속 이 횟수에 이르면 완전 중단 (주인이 새 비밀번호로 한 번 시도한 것까지 실패한 경우) */
export const SCHOOL_FINAL_STOP_AFTER = 9;

/** 확인되지 않은 학번 하나에 대해 한 사용자가 24시간 안에 만들 수 있는 실패 횟수 */
export const LINK_PROBE_MAX_FAILS = 3;
/** 한 사용자가 24시간 안에 실패를 만들 수 있는 서로 다른 확인되지 않은 학번의 수 */
export const LINK_PROBE_MAX_IDS = 3;
/**
 * 확인되지 않은 학번 하나에 대해 **모든 사용자를 합쳐** 24시간 안에 만들 수 있는 실패 횟수.
 * 계정을 여러 개 만들어도 한 학번의 공유 가드(SCHOOL_LOCK_AFTER=5)를 하루에 소진시키지 못하도록 그보다 작게 둔다.
 */
export const LINK_PROBE_MAX_FAILS_PER_ID = 4;
/** 신청 흐름이 확인되지 않은 예약 사이트에서 로그인이 안 된 뒤 다시 시도하지 않는 시간 */
export const UNVERIFIED_SITE_BACKOFF_HOURS = 24;

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const LINK_PROBE_WINDOW_MS = 24 * HOUR_MS;

/**
 * 순수 규칙: 연속 실패 횟수 → 시간 잠금 길이(ms). 잠글 필요가 없으면 0.
 * 8회 이상은 시간 잠금이 아니라 상태로 멈추므로 0 이다 (`lockStateOf` 참고).
 */
export function lockDurationMs(fails: number): number {
  if (fails >= SCHOOL_HARD_LOCK_AFTER) return 0;
  if (fails >= SCHOOL_LOCK_AFTER) return SCHOOL_LOCK_MIN * MINUTE_MS;
  return 0;
}

export type LockState =
  | { kind: 'open' }
  /** 5~7회째 실패 뒤의 쉬는 시간 */
  | { kind: 'timed'; untilMs: number }
  /** 8회 이상: 시간으로 풀리지 않는다. fails===8 이면 주인이 새 비밀번호로 한 번 시도할 수 있고, 9 이상이면 완전 중단 */
  | { kind: 'hard'; fails: number };

/** 순수 규칙: 저장된 (fails, locked_until) 과 지금 → 상태 */
export function lockStateOf(fails: number, lockedUntilMs: number | null, nowMs: number): LockState {
  if (fails >= SCHOOL_HARD_LOCK_AFTER) return { kind: 'hard', fails };
  if (lockedUntilMs !== null && lockedUntilMs > nowMs) return { kind: 'timed', untilMs: lockedUntilMs };
  return { kind: 'open' };
}

function lockedError(state: LockState, nowMs: number): SchoolLocked | null {
  if (state.kind === 'timed') return new SchoolLocked(Math.ceil((state.untilMs - nowMs) / 1000));
  if (state.kind === 'hard') return new SchoolLocked(0, true, state.fails >= SCHOOL_FINAL_STOP_AFTER);
  return null;
}

// ── 학번 해시 ─────────────────────────────────────────────────────

let cachedSecret: string | null = null;

/**
 * 서버 비밀값. 새 비밀을 만들지 않고 server/auth.ts 가 쓰는 JWT 비밀과 같은 것을 쓴다
 * (JWT_SECRET, 없으면 데이터 폴더의 jwt-secret 파일 — auth.ts 의 loadSecret 과 같은 규칙).
 * auth.ts 가 비밀을 내보내지 않아 같은 규칙으로 읽는다. (foundationRequests 참고)
 */
function serverSecret(): string {
  if (cachedSecret) return cachedSecret;
  if (process.env.JWT_SECRET) {
    cachedSecret = process.env.JWT_SECRET;
    return cachedSecret;
  }
  if (isServerless) {
    // auth.ts 와 같다: 서버리스에서는 인스턴스마다 파일이 달라 비밀이 어긋나므로 환경 변수를 강제한다.
    throw new Error('JWT_SECRET 환경 변수가 필요합니다.');
  }
  const file = path.join(resolveDataDir(), 'jwt-secret');
  if (fs.existsSync(file)) {
    cachedSecret = fs.readFileSync(file, 'utf8').trim();
    return cachedSecret;
  }
  // 서버리스에서는 JWT_SECRET 이 필수라 여기까지 오지 않는다. 로컬에서 아직 파일이 없으면 auth.ts 와 같이 만든다.
  fs.mkdirSync(path.dirname(file), { recursive: true });
  cachedSecret = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(file, cachedSecret);
  return cachedSecret;
}

/** 테스트용: 캐시한 비밀 지우기 */
export function resetGuardSecretCache(): void {
  cachedSecret = null;
}

/** 학번 → 가드 행의 키. 용도를 섞어 쓰지 않도록 접두어를 붙인다 */
export function studentHash(studentId: string): string {
  return crypto.createHmac('sha256', serverSecret()).update(`school-guard:${studentId}`).digest('hex');
}

/**
 * 학번 → users.school_student_hash / school_link_probe 의 키.
 * 가드 키와 접두어를 달리해, DB 만 보고는 사용자 행과 가드 행을 이을 수 없게 한다.
 */
export function studentLinkHash(studentId: string): string {
  return crypto.createHmac('sha256', serverSecret()).update(`school-link:${studentId}`).digest('hex');
}

// ── DB 가드 ───────────────────────────────────────────────────────

type GuardRow = { fails: number; lockedUntil: Date | string | null };

const toMs = (v: Date | string | null | undefined): number | null => (v ? new Date(v).getTime() : null);

/** 지금 이 학번이 잠겨 있는가 (읽기만 한다) */
export async function lockState(hash: string, nowMs: number = Date.now()): Promise<LockState> {
  const row = await get<GuardRow>(
    'SELECT fails, locked_until AS "lockedUntil" FROM school_login_guard WHERE student_hash = ?',
    [hash],
  );
  if (!row) return { kind: 'open' };
  return lockStateOf(Number(row.fails), toMs(row.lockedUntil), nowMs);
}

/**
 * 로그인 **직전**에 부른다. 잠겨 있으면 SchoolLocked 를 던진다 (학교에는 아무 요청도 가지 않는다).
 * 5~7회째 뒤의 쉬는 시간이 끝났다면 통과한다 — fails 는 그대로다. 8회 이상(상태 멈춤)은 시간이 지나도 항상 던진다.
 */
export async function assertNotLocked(hash: string, nowMs: number = Date.now()): Promise<void> {
  const err = lockedError(await lockState(hash, nowMs), nowMs);
  if (err) throw err;
}

/**
 * 비밀번호가 맞지 않았을 때 부른다. fails+1 을 **한 문장으로** 올리고(동시 요청이 와도 세어지는 횟수가 줄지 않는다)
 * 규칙에 따라 locked_until 을 정한다 (8회 이상은 시간 잠금이 아니라 fails 로 막으므로 NULL). 갱신된 값을 돌려준다.
 */
export async function recordFailure(
  hash: string,
  nowMs: number = Date.now(),
): Promise<{ fails: number; lockedUntil: Date | null }> {
  const iso = (ms: number): string => new Date(ms).toISOString();
  const first = lockDurationMs(1);
  const row = await get<{ fails: number; lockedUntil: Date | string | null }>(
    `INSERT INTO school_login_guard (student_hash, fails, first_fail_at, locked_until)
     VALUES (?, 1, ?::timestamptz, ?::timestamptz)
     ON CONFLICT (student_hash) DO UPDATE SET
       fails = school_login_guard.fails + 1,
       first_fail_at = CASE WHEN school_login_guard.fails = 0 OR school_login_guard.first_fail_at IS NULL
                            THEN EXCLUDED.first_fail_at ELSE school_login_guard.first_fail_at END,
       locked_until = CASE
         WHEN school_login_guard.fails + 1 >= ${SCHOOL_HARD_LOCK_AFTER} THEN NULL
         WHEN school_login_guard.fails + 1 >= ${SCHOOL_LOCK_AFTER} THEN ?::timestamptz
         ELSE NULL END
     RETURNING fails, locked_until AS "lockedUntil"`,
    [hash, iso(nowMs), first > 0 ? iso(nowMs + first) : null, iso(nowMs + SCHOOL_LOCK_MIN * MINUTE_MS)],
  );
  return {
    fails: Number(row?.fails ?? 0),
    lockedUntil: row?.lockedUntil ? new Date(row.lockedUntil) : null,
  };
}

/** 로그인에 성공했을 때 부른다. 연속 실패 횟수와 잠금을 모두 지운다 */
export async function recordSuccess(hash: string): Promise<void> {
  await run(
    'UPDATE school_login_guard SET fails = 0, first_fail_at = NULL, locked_until = NULL WHERE student_hash = ?',
    [hash],
  );
}

/**
 * 상태 멈춤(fails===8)에서 주인의 다시 연동 시도 **한 번**을 확보한다. 조건부 UPDATE 한 문장이라 동시에 두 요청이 와도
 * 하나만 true 를 받는다. 학교로 보내기 **전에** 이미 fails 를 9 로 올려 두므로, 요청 중 서버가 죽어도 시도가 공짜로 늘지 않는다.
 */
export async function claimRelinkAttempt(hash: string): Promise<boolean> {
  const res = await run(
    'UPDATE school_login_guard SET fails = ?, locked_until = NULL WHERE student_hash = ? AND fails = ?',
    [SCHOOL_FINAL_STOP_AFTER, hash, SCHOOL_HARD_LOCK_AFTER],
  );
  return res.changes === 1;
}

/** 확보한 시도가 비밀번호 판정 없이 끝났을 때(점검·타임아웃 등) 돌려놓는다 — 그 시도는 학교가 비밀번호를 판정하지 않았다 */
async function releaseRelinkAttempt(hash: string): Promise<void> {
  await run('UPDATE school_login_guard SET fails = ? WHERE student_hash = ? AND fails = ?', [
    SCHOOL_HARD_LOCK_AFTER,
    hash,
    SCHOOL_FINAL_STOP_AFTER,
  ]);
}

// ── 로그인 한 번을 가드로 감싸기 ─────────────────────────────────

/** 이 인스턴스에서 지금 학교 로그인을 진행 중인 학번 해시 (같은 학번의 동시 로그인 방지) */
const inFlight = new Set<string>();

export type GuardedLoginOptions = {
  /**
   * 이 연동의 주인이 새 비밀번호를 직접 입력해 다시 연동하는 요청인가 (service.link 만 true).
   * 상태 멈춤(fails===8)에서 이 경우에만 시도 한 번을 허용한다. 저장된 비밀번호를 쓰는 다른 흐름은 절대 true 가 아니다.
   */
  relink?: boolean;
  /**
   * 이 로그인의 성공·실패가 "비밀번호가 맞다/틀리다"는 판정인가 (기본 true).
   * 신청 흐름이 확인되지 않은 예약 사이트(hsel)는 false: 거기서 로그인이 안 돼도 비밀번호가 틀렸다는 뜻이 아니므로
   * 학번 하나에 공유되는 실패 횟수를 올리지도, 다른 사이트에서 쌓인 실패를 지우지도 않는다. (잠금 여부는 똑같이 확인한다.)
   */
  verdict?: boolean;
};

/**
 * 학교 로그인 한 번을 가드로 감싼다.
 *  1) 잠겨 있으면 학교에 요청하지 않고 SchoolLocked
 *  2) 같은 학번의 로그인이 이 인스턴스에서 이미 진행 중이면 거절 (더블 클릭이 실패를 두 번 세는 일을 막는다)
 *  3) login() 이 성공하면 recordSuccess, SchoolAuthFailed 면 recordFailure 후 그 오류를 그대로 던진다
 *     (점검·타임아웃 같은 SchoolUnavailable 은 비밀번호 판정이 아니므로 실패로 세지 않는다)
 * 실패해도 다시 시도하지 않는다.
 */
export async function guardedLogin<T>(
  studentId: string,
  login: () => Promise<T>,
  nowMs: () => number = Date.now,
  opts: GuardedLoginOptions = {},
): Promise<T> {
  const hash = studentHash(studentId);
  const verdict = opts.verdict !== false;
  const state = await lockState(hash, nowMs());
  const relink = opts.relink === true && state.kind === 'hard' && state.fails === SCHOOL_HARD_LOCK_AFTER;
  if (!relink) {
    const err = lockedError(state, nowMs());
    if (err) throw err;
  }
  if (inFlight.has(hash)) {
    throw new ApiInputError('RATE_LIMITED', '학교 로그인을 이미 처리하고 있어요. 잠시 후 다시 시도해 주세요.');
  }
  inFlight.add(hash);
  let claimed = false;
  try {
    if (relink) {
      claimed = await claimRelinkAttempt(hash);
      // 그 사이 다른 요청이 시도를 가져갔다 (다른 인스턴스의 동시 요청)
      if (!claimed) throw new SchoolLocked(0, true, true);
    }
    const result = await login();
    if (verdict) await recordSuccess(hash);
    return result;
  } catch (err) {
    if (err instanceof SchoolAuthFailed) {
      // 확보한 시도는 이미 fails 에 센 상태(9)다. 여기서 또 올리면 10 이 된다.
      if (verdict && !claimed) await recordFailure(hash, nowMs());
    } else if (claimed && !(err instanceof SchoolLocked)) {
      await releaseRelinkAttempt(hash).catch(() => undefined);
    }
    throw err;
  } finally {
    inFlight.delete(hash);
  }
}

// ── 신청 흐름이 확인되지 않은 예약 사이트 ─────────────────────────

/**
 * 신청 흐름이 확인되지 않은 사이트(hsel)에서 로그인이 안 됐을 때의 쉬는 시간을 DB 에 둔다.
 * 인스턴스 메모리에 두면 서버리스에서 인스턴스가 바뀔 때마다 사라져 같은 실패 로그인이 반복된다.
 * school_login_guard 에 "<학번해시>:<사이트>" 키로 locked_until 만 쓴다 (학번 가드의 fails 와 섞이지 않는다).
 */
const siteKey = (studentId: string, site: string): string => `${studentHash(studentId)}:${site}`;

export async function isSiteBackedOff(studentId: string, site: string, nowMs: number = Date.now()): Promise<boolean> {
  const row = await get<{ lockedUntil: Date | string | null }>(
    'SELECT locked_until AS "lockedUntil" FROM school_login_guard WHERE student_hash = ?',
    [siteKey(studentId, site)],
  );
  const until = toMs(row?.lockedUntil);
  return until !== null && until > nowMs;
}

export async function setSiteBackoff(studentId: string, site: string, nowMs: number = Date.now()): Promise<void> {
  const iso = (ms: number): string => new Date(ms).toISOString();
  await run(
    `INSERT INTO school_login_guard (student_hash, fails, first_fail_at, locked_until)
     VALUES (?, 1, ?::timestamptz, ?::timestamptz)
     ON CONFLICT (student_hash) DO UPDATE SET
       fails = school_login_guard.fails + 1, locked_until = EXCLUDED.locked_until`,
    [siteKey(studentId, site), iso(nowMs), iso(nowMs + UNVERIFIED_SITE_BACKOFF_HOURS * HOUR_MS)],
  );
}

// ── 확인되지 않은 학번으로의 연동 시도 상한 ───────────────────────

/**
 * `/link` 에서 내가 연동한(학교 로그인으로 확인된) 학번이 **아닌** 학번으로 시도할 때만 부른다.
 * 한 사용자가 24시간 안에 (학번 하나당) LINK_PROBE_MAX_FAILS 번, (서로 다른 학번) LINK_PROBE_MAX_IDS 개까지만
 * 실패를 만들 수 있다 — 남의 학번에 틀린 비밀번호를 보내 그 학번의 공유 가드를 소진시키는 일을 막는다.
 * 한도에 닿았으면 학교에 아무 요청도 보내기 전에 거절한다.
 */
export async function assertLinkProbeBudget(uid: number, linkHash: string, nowMs: number = Date.now()): Promise<void> {
  const cutoff = new Date(nowMs - LINK_PROBE_WINDOW_MS).toISOString();
  const tooMany = (): ApiInputError =>
    new ApiInputError(
      'RATE_LIMITED',
      '이 학번으로는 오늘 더 시도할 수 없어요. 학교 포털에서 먼저 로그인해 학번과 비밀번호를 확인한 뒤 내일 다시 연동해 주세요.',
    );
  const rows = await all<{ hash: string; fails: number }>(
    'SELECT student_hash AS hash, fails FROM school_link_probe WHERE user_id = ? AND first_fail_at > ?::timestamptz',
    [uid, cutoff],
  );
  const mine = rows.find((r) => r.hash === linkHash);
  if (mine && Number(mine.fails) >= LINK_PROBE_MAX_FAILS) throw tooMany();
  if (!mine && rows.length >= LINK_PROBE_MAX_IDS) {
    throw new ApiInputError('RATE_LIMITED', '오늘 시도할 수 있는 학번 수를 넘었어요. 학번을 확인한 뒤 내일 다시 연동해 주세요.');
  }
  // 계정을 여러 개 만들어 같은 학번을 두드리는 경우: 모든 사용자를 합친 실패 횟수도 본다
  const total = await get<{ n: number | string | null }>(
    'SELECT COALESCE(SUM(fails), 0) AS n FROM school_link_probe WHERE student_hash = ? AND first_fail_at > ?::timestamptz',
    [linkHash, cutoff],
  );
  if (Number(total?.n ?? 0) >= LINK_PROBE_MAX_FAILS_PER_ID) throw tooMany();
}

/** 연동에 성공했다 = 이 사용자가 그 학번의 주인이다. 앞서 쌓인 (오타였을) 실패 기록을 지운다 */
export async function clearLinkProbe(uid: number, linkHash: string): Promise<void> {
  await run('DELETE FROM school_link_probe WHERE user_id = ? AND student_hash = ?', [uid, linkHash]);
}

/**
 * 운영자용: 이 학번의 실패 횟수와 잠금을 지운다 (완전 중단 상태 풀기).
 * 학교 포털에서 직접 로그인해 계정이 잠기지 않았고 비밀번호가 맞는 것을 **확인한 뒤에만** 부른다.
 * (이 저장소에는 아직 운영자 화면이 없어, 필요할 때 이 함수로 풀거나 school_login_guard 행을 직접 지운다.)
 */
export async function resetStudentGuard(studentId: string): Promise<void> {
  await run('DELETE FROM school_login_guard WHERE student_hash = ?', [studentHash(studentId)]);
}

/** 위 시도가 비밀번호 틀림(SchoolAuthFailed)으로 끝났을 때 부른다. 윈도가 지난 옛 기록은 함께 치운다 */
export async function recordLinkProbeFailure(uid: number, linkHash: string, nowMs: number = Date.now()): Promise<void> {
  const iso = (ms: number): string => new Date(ms).toISOString();
  const cutoff = iso(nowMs - LINK_PROBE_WINDOW_MS);
  await run('DELETE FROM school_link_probe WHERE user_id = ? AND first_fail_at <= ?::timestamptz', [uid, cutoff]);
  await run(
    `INSERT INTO school_link_probe (user_id, student_hash, fails, first_fail_at)
     VALUES (?, ?, 1, ?::timestamptz)
     ON CONFLICT (user_id, student_hash) DO UPDATE SET fails = school_link_probe.fails + 1`,
    [uid, linkHash, iso(nowMs)],
  );
}

// ── 사용자 단위 호출 제한 ─────────────────────────────────────────

/** 연동(`/link`): 사용자당 10분에 3회 */
export const linkLimiter = createRateLimiter(3, 10 * MINUTE_MS);
/** 학교에 로그인하는 그 밖의 호출(시간표·내 신청내역·신청 미리보기/제출): 사용자당 10분에 20회 */
export const schoolCallLimiter = createRateLimiter(20, 10 * MINUTE_MS);

export function hitLimiter(limiter: { hit(key: string): boolean }, uid: number): void {
  if (!limiter.hit(String(uid))) {
    throw new ApiInputError('RATE_LIMITED', '학교 계정 요청이 너무 많아요. 잠시 후 다시 시도해 주세요.');
  }
}
