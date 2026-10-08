/**
 * 차단 · 신고 저장소 (Postgres). 규칙(누가 누구를 가리는지, 몇 명이면 자동 제한인지)은 domain/safety 가 정한다.
 * 여기는 읽고 쓰기만 한다.
 */
import { all, get, run } from '../../db.js';
import type { ISODateTime } from '../../../shared/lounge/types.js';
import type { Block, Report, ReportReason, ReportStatus } from '../domain/safety.js';

interface BlockRow {
  blocker_id: number;
  blocked_id: number;
  at: Date | string;
}

interface ReportRow {
  id: string;
  reporter_id: number;
  target_id: number;
  context: string;
  ref_id: string | null;
  reason: string;
  detail: string;
  status: string;
  created_at: Date | string;
  handled_at: Date | string | null;
  handled_by: number | null;
}

const iso = (v: Date | string) => new Date(v).toISOString();

const toBlock = (r: BlockRow): Block => ({
  blockerId: String(r.blocker_id),
  blockedId: String(r.blocked_id),
  at: iso(r.at),
});

const toReport = (r: ReportRow): Report => ({
  id: r.id,
  reporterId: String(r.reporter_id),
  targetId: String(r.target_id),
  context: r.context,
  refId: r.ref_id,
  reason: r.reason as ReportReason,
  detail: r.detail,
  status: r.status as ReportStatus,
  createdAt: iso(r.created_at),
  handledAt: r.handled_at === null ? null : iso(r.handled_at),
  handledBy: r.handled_by === null ? null : String(r.handled_by),
});

const REPORT_COLUMNS =
  'id, reporter_id, target_id, context, ref_id, reason, detail, status, created_at, handled_at, handled_by';

// ───────────── 차단 ─────────────

/** 나와 얽힌 차단 (내가 건 것 + 나를 건 것) */
export async function listBlocksInvolving(userId: string): Promise<Block[]> {
  const rows = await all<BlockRow>(
    'SELECT blocker_id, blocked_id, at FROM lounge_blocks WHERE blocker_id = ? OR blocked_id = ?',
    [Number(userId), Number(userId)],
  );
  return rows.map(toBlock);
}

/** 전체 차단 (빠른 매칭이 후보 사이를 한꺼번에 검사할 때) */
export async function listAllBlocks(): Promise<Block[]> {
  const rows = await all<BlockRow>('SELECT blocker_id, blocked_id, at FROM lounge_blocks');
  return rows.map(toBlock);
}

/** 내가 차단한 사람들, 최근에 건 순 */
export async function listBlockedBy(userId: string): Promise<string[]> {
  const rows = await all<{ blocked_id: number }>(
    'SELECT blocked_id FROM lounge_blocks WHERE blocker_id = ? ORDER BY at DESC, blocked_id',
    [Number(userId)],
  );
  return rows.map((r) => String(r.blocked_id));
}

/** 이미 막았으면 아무 일도 없다 (멱등) */
export async function insertBlock(blockerId: string, blockedId: string, at: ISODateTime): Promise<void> {
  await run(
    `INSERT INTO lounge_blocks (blocker_id, blocked_id, at) VALUES (?, ?, ?::timestamptz)
     ON CONFLICT (blocker_id, blocked_id) DO NOTHING`,
    [Number(blockerId), Number(blockedId), at],
  );
}

export async function deleteBlock(blockerId: string, blockedId: string): Promise<void> {
  await run('DELETE FROM lounge_blocks WHERE blocker_id = ? AND blocked_id = ?', [
    Number(blockerId),
    Number(blockedId),
  ]);
}

// ───────────── 신고 ─────────────

/**
 * 같은 (신고자, 대상, refId) 의 열린 신고가 없을 때만 넣는다. 넣었으면 true.
 * 확인과 저장을 한 문장으로 해서 "연타"가 두 건으로 저장되는 틈을 좁힌다.
 * (완전한 보장은 부분 유니크 인덱스가 필요하다 — 보고서의 foundationRequests 참고)
 */
export async function insertReportIfNew(r: Report): Promise<boolean> {
  const { changes } = await run(
    `INSERT INTO lounge_reports
       (id, reporter_id, target_id, context, ref_id, reason, detail, status, created_at)
     SELECT ?::text, ?::integer, ?::integer, ?::text, ?::text, ?::text, ?::text, 'open', ?::timestamptz
      WHERE NOT EXISTS (
        SELECT 1 FROM lounge_reports
         WHERE reporter_id = ? AND target_id = ? AND ref_id IS NOT DISTINCT FROM ?::text AND status = 'open')`,
    [
      r.id,
      Number(r.reporterId),
      Number(r.targetId),
      r.context,
      r.refId,
      r.reason,
      r.detail,
      r.createdAt,
      Number(r.reporterId),
      Number(r.targetId),
      r.refId,
    ],
  );
  return changes === 1;
}

/** 그 사람에 대한 처리 안 된 신고 (자동 제한 판단용) */
export async function listOpenReportsAgainst(targetId: string): Promise<Report[]> {
  const rows = await all<ReportRow>(
    `SELECT ${REPORT_COLUMNS} FROM lounge_reports WHERE target_id = ? AND status = 'open'`,
    [Number(targetId)],
  );
  return rows.map(toReport);
}

/** 관리자 목록: 최신순 */
export async function listReports(limit = 200): Promise<Report[]> {
  const rows = await all<ReportRow>(
    `SELECT ${REPORT_COLUMNS} FROM lounge_reports ORDER BY created_at DESC, id LIMIT ?`,
    [Math.min(500, Math.max(1, Math.trunc(limit)))],
  );
  return rows.map(toReport);
}

export async function findReport(id: string): Promise<Report | undefined> {
  const row = await get<ReportRow>(`SELECT ${REPORT_COLUMNS} FROM lounge_reports WHERE id = ?`, [id]);
  return row ? toReport(row) : undefined;
}

export async function updateReportStatus(
  id: string,
  status: ReportStatus,
  handledAt: ISODateTime,
  handledBy: string,
): Promise<void> {
  await run('UPDATE lounge_reports SET status = ?, handled_at = ?::timestamptz, handled_by = ? WHERE id = ?', [
    status,
    handledAt,
    Number(handledBy),
    id,
  ]);
}

/** 그 사람에 대한 열린 신고를 전부 닫는다. 닫은 건수를 돌려준다. */
export async function closeOpenReportsAgainst(
  targetId: string,
  status: ReportStatus,
  handledAt: ISODateTime,
  handledBy: string,
): Promise<number> {
  const { changes } = await run(
    `UPDATE lounge_reports SET status = ?, handled_at = ?::timestamptz, handled_by = ?
      WHERE target_id = ? AND status = 'open'`,
    [status, handledAt, Number(handledBy), Number(targetId)],
  );
  return changes;
}

/** 대상별 "서로 다른 신고자 수" (열린 신고만). 관리자 목록의 openCountForTarget 용. */
export async function openReporterCounts(): Promise<Map<string, number>> {
  const rows = await all<{ target_id: number; n: number }>(
    `SELECT target_id, COUNT(DISTINCT reporter_id)::int AS n
       FROM lounge_reports WHERE status = 'open' GROUP BY target_id`,
  );
  return new Map(rows.map((r) => [String(r.target_id), Number(r.n)]));
}
