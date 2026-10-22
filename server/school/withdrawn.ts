/**
 * 탈퇴한 학번 막기 — 탈퇴하면 그 학번(HMAC)을 남겨, 관리자가 풀어 주기 전까지 같은 학번으로 다시 가입·연동하지 못하게 한다.
 * 학번 원문·실명은 남기지 않는다. 관리자는 문의한 사람의 학번을 직접 입력해 풀어 준다 (서버가 같은 HMAC 으로 찾는다).
 */
import { all, get, run } from '../db.js';
import { ApiInputError } from './http.js';
import { studentLinkHash } from './guard.js';

export const WITHDRAWN_BLOCKED_MESSAGE = '탈퇴한 학번은 다시 가입할 수 없어요. 다시 쓰려면 관리자에게 문의해 주세요.';

/** 이 학번 HMAC 이 탈퇴 후 아직 풀리지 않았는가 */
export async function isWithdrawnBlocked(studentHash: string): Promise<boolean> {
  const row = await get<{ x: number }>(
    'SELECT 1 AS x FROM withdrawn_students WHERE student_hash = ? AND released_at IS NULL',
    [studentHash],
  );
  return !!row;
}

/** 막혀 있으면 403 으로 끝낸다. 학교 로그인에 성공한 뒤에만 부른다 — 남의 학번 탈퇴 여부를 캐내지 못하게 */
export async function assertNotWithdrawn(studentHash: string): Promise<void> {
  if (await isWithdrawnBlocked(studentHash)) throw new ApiInputError('FORBIDDEN', WITHDRAWN_BLOCKED_MESSAGE);
}

/** 탈퇴할 때: 연동한 학번이 있으면 남긴다 (다시 탈퇴하면 날짜를 새로 하고 다시 막는다) */
export async function recordWithdrawal(studentHash: string | null, hint: string | null): Promise<void> {
  if (!studentHash) return;
  await run(
    `INSERT INTO withdrawn_students (student_hash, hint) VALUES (?, ?)
     ON CONFLICT (student_hash) DO UPDATE SET hint = EXCLUDED.hint, withdrawn_at = now(), released_at = NULL, released_by = NULL`,
    [studentHash, hint],
  );
}

export type WithdrawnView = { hint: string; withdrawnAt: string; releasedAt: string | null };

/** 관리자 목록: 최근 탈퇴 순. 가린 학번과 날짜만 */
export async function listWithdrawn(): Promise<WithdrawnView[]> {
  const rows = await all<{ hint: string | null; withdrawn_at: Date | string; released_at: Date | string | null }>(
    'SELECT hint, withdrawn_at, released_at FROM withdrawn_students ORDER BY withdrawn_at DESC LIMIT 200',
  );
  const iso = (v: Date | string) => new Date(v).toISOString();
  return rows.map((r) => ({ hint: r.hint ?? '', withdrawnAt: iso(r.withdrawn_at), releasedAt: r.released_at ? iso(r.released_at) : null }));
}

/** 관리자가 학번을 입력해 재가입을 허용한다. 막힌 기록이 없으면 false */
export async function releaseWithdrawn(studentId: string, adminId: number): Promise<boolean> {
  const r = await run(
    'UPDATE withdrawn_students SET released_at = now(), released_by = ? WHERE student_hash = ? AND released_at IS NULL',
    [adminId, studentLinkHash(studentId)],
  );
  return r.changes > 0;
}
