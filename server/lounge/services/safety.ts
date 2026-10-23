/**
 * 차단 · 신고 서비스. 미팅·밥약·빠른 매칭·접속자가 공통으로 쓰고, 관리자 화면에서 처리한다.
 * 규칙은 domain/safety · domain/reputation, 저장은 repo/safety · users.ts. 여기서는 둘을 이어 붙인다.
 */
import { randomUUID } from 'node:crypto';
import { run } from '../../db.js';
import { fail, ok } from '../../../shared/lounge/types.js';
import type { Result } from '../../../shared/lounge/types.js';
import type { PublicUser, ReportView } from '../../../shared/lounge/view.js';
import type { ReportAction } from '../../../shared/lounge/view.js';
import { findUser, liftBanDb, loadUsers, setBanned, toPublicUser } from '../users.js';
import type { LoungeUser } from '../users.js';
import { REPORT_DETAIL_MAX, REPORT_REASONS, excludeReporters, hiddenUserIds, isAutoRestricted } from '../domain/safety.js';
import type { Report, ReportReason } from '../domain/safety.js';
import { hasUnsafeChars } from '../domain/chat.js';
import {
  closeOpenReportsAgainst,
  deleteBlock,
  findReport,
  insertBlock,
  insertReportIfNew,
  listAllBlocks,
  listBlockedBy,
  listBlocksInvolving,
  listOpenReportsAgainst,
  listReports,
  openReporterCounts,
  updateReportStatus,
} from '../repo/safety.js';

const nowISO = () => new Date().toISOString();

// ───────────── 차단 ─────────────

/**
 * 내가 차단했거나 나를 차단한 사람의 id — 목록·접속자·매칭·사용자 조회에서 서로 감춘다.
 * (차단은 한쪽만 걸어도 양쪽에 적용된다. 상대에게는 알리지 않는다)
 */
export async function hiddenFor(userId: string): Promise<Set<string>> {
  return new Set(hiddenUserIds(await listBlocksInvolving(userId), userId));
}

/**
 * 차단 관계를 **방향까지** 알려 준다. `hidden` 은 `hiddenFor` 와 같고, `byMe` 는 그중 내가 차단한 사람이다.
 *
 * 왜 나누나: 내가 건 차단은 내가 아는 일이라 사유를 말해 줘도 되지만, 나를 차단한 사람은 응답 차이로
 * 드러나면 안 된다("상대에게 알리지 않는다"). 참여·승인 검사가 이 둘을 다르게 답하는 데 쓴다.
 */
export type BlockRelations = { hidden: Set<string>; byMe: Set<string> };

export async function blockRelations(userId: string): Promise<BlockRelations> {
  const blocks = await listBlocksInvolving(userId);
  return {
    hidden: new Set(hiddenUserIds(blocks, userId)),
    byMe: new Set(blocks.filter((b) => b.blockerId === userId).map((b) => b.blockedId)),
  };
}

/**
 * 두 사람이 서로 가려진 사이인지 (빠른 매칭이 후보 여럿을 한꺼번에 검사할 때).
 * 차단 목록을 한 번만 읽어 쌍을 집합으로 만들어 두므로 호출이 많아도 가볍다. 규칙은 domain/safety 의 isBlocked 와 같다.
 */
export async function blockChecker(): Promise<(a: string, b: string) => boolean> {
  const pairs = new Set((await listAllBlocks()).map((b) => `${b.blockerId}>${b.blockedId}`));
  return (a, b) => pairs.has(`${a}>${b}`) || pairs.has(`${b}>${a}`);
}

/** 라운지 프로필이 있는 사용자만 "있는 사용자" 로 본다 (프로필 없는 계정의 존재를 드러내지 않는다) */
async function findVisibleUser(id: string): Promise<LoungeUser | undefined> {
  const u = await findUser(id);
  return u?.profileDone ? u : undefined;
}

export async function blockUser(me: string, targetId: string): Promise<Result<true>> {
  if (me === targetId) return fail('INVALID', '자기 자신은 차단할 수 없습니다.');
  if (!(await findVisibleUser(targetId))) return fail('NOT_FOUND', '없는 사용자입니다.');
  await insertBlock(me, targetId, nowISO());
  // 차단하면 친구 관계와 오가던 친구 요청도 함께 지운다 (services/friends.ts)
  await run(
    `DELETE FROM lounge_friends
      WHERE (requester_id = ? AND addressee_id = ?) OR (requester_id = ? AND addressee_id = ?)`,
    [Number(me), Number(targetId), Number(targetId), Number(me)],
  );
  return ok(true);
}

export async function unblockUser(me: string, targetId: string): Promise<Result<true>> {
  await deleteBlock(me, targetId);
  return ok(true);
}

/** 내가 차단한 사람들 (차단 목록 화면용). 탈퇴한 사람은 빠진다. */
export async function myBlocks(me: string): Promise<PublicUser[]> {
  const ids = await listBlockedBy(me);
  const users = await loadUsers(ids);
  return ids.flatMap((id) => {
    const u = users.get(id);
    return u?.profileDone ? [toPublicUser(u)] : [];
  });
}

// ───────────── 신고 ─────────────

export type ReportRequest = {
  targetId: string;
  context: string;
  refId: string | null;
  reason: string;
  detail: string;
};

/**
 * 신고 접수. 서로 다른 신고자(이용이 정지되지 않은 사람)의 열린 신고가 AUTO_RESTRICT_REPORTS 이상이면
 * 관리자가 볼 때까지 대상 이용을 정지한다. 정지된 사람의 신고도 받아 저장하지만 이 집계에는 세지 않는다.
 * 정지는 같은 요청 안에서 끝낸다(응답 뒤로 미루지 않는다).
 */
export async function reportUser(me: string, input: ReportRequest): Promise<Result<Report>> {
  if (me === input.targetId) return fail('INVALID', '자기 자신은 신고할 수 없습니다.');
  if (!(REPORT_REASONS as readonly string[]).includes(input.reason)) {
    return fail('INVALID', '신고 사유를 골라 주세요.');
  }
  const detail = input.detail.trim();
  if (detail.length > REPORT_DETAIL_MAX) {
    return fail('INVALID', `자세한 내용은 ${REPORT_DETAIL_MAX}자까지 쓸 수 있어요.`);
  }
  if (hasUnsafeChars(detail)) return fail('INVALID', '보낼 수 없는 글자가 들어 있어요.');

  const target = await findVisibleUser(input.targetId);
  if (!target) return fail('NOT_FOUND', '없는 사용자입니다.');

  const report: Report = {
    id: randomUUID(),
    reporterId: me,
    targetId: input.targetId,
    context: input.context,
    refId: input.refId,
    reason: input.reason as ReportReason,
    detail,
    status: 'open',
    createdAt: nowISO(),
    handledAt: null,
    handledBy: null,
  };
  if (!(await insertReportIfNew(report))) {
    return fail('INVALID', '이미 신고한 건이에요. 관리자가 확인 중입니다.');
  }

  // 방금 저장한 신고까지 포함해서 센다. 단, 이용이 정지된 신고자의 신고는 세지 않는다 (domain/safety.excludeReporters 설명).
  if (!target.banned) {
    const open = await listOpenReportsAgainst(target.id);
    const reporters = await loadUsers(open.map((r) => r.reporterId));
    const bannedReporters = new Set([...reporters.values()].filter((u) => u.banned).map((u) => u.id));
    if (isAutoRestricted(excludeReporters(open, bannedReporters), target.id)) {
      await setBanned(target.id, true);
    }
  }
  return ok(report);
}

// ───────────── 관리자 ─────────────

const UNKNOWN = '(탈퇴)';

/** 신고 목록 (최신순 200). 닉네임만 보인다 — 실명·이메일·학과는 관리자 화면에도 내려가지 않는다. */
export async function listReportsForAdmin(): Promise<ReportView[]> {
  const reports = await listReports(200);
  const [users, openCounts] = await Promise.all([
    loadUsers(reports.flatMap((r) => [r.reporterId, r.targetId])),
    openReporterCounts(),
  ]);

  return reports.map((r) => {
    const reporter = users.get(r.reporterId);
    const target = users.get(r.targetId);
    return {
      id: r.id,
      context: r.context,
      refId: r.refId,
      reason: r.reason,
      detail: r.detail,
      status: r.status,
      createdAt: r.createdAt,
      handledAt: r.handledAt,
      reporter: { id: r.reporterId, nickname: reporter?.nickname || UNKNOWN },
      target: {
        id: r.targetId,
        nickname: target?.nickname || UNKNOWN,
        temperature: target?.temperature ?? 0,
        warnings: target?.warnings ?? 0,
        banned: target?.banned ?? false,
      },
      openCountForTarget: openCounts.get(r.targetId) ?? 0,
    };
  });
}

/**
 * 관리자 처리.
 *   resolve  조치 완료 — 이 신고만 resolved
 *   dismiss  반려 — 이 신고만 dismissed
 *   ban      정지 — 대상 banned=true, 이 신고 resolved
 *   unban    정지 해제 — 대상 경고 0 · banned=false (온도는 기록이라 그대로),
 *            그 사람에 대한 **열린 신고 전부** dismissed (그대로 두면 다음 신고 한 건에 곧바로 다시 자동 제한된다)
 * 모든 처리에 처리자·시각을 남긴다.
 */
export async function handleReport(adminId: string, reportId: string, action: ReportAction): Promise<Result<true>> {
  const report = await findReport(reportId);
  if (!report) return fail('NOT_FOUND', '없는 신고입니다.');

  const target = await findUser(report.targetId);
  if (!target) return fail('NOT_FOUND', '없는 사용자입니다.');

  const at = nowISO();
  switch (action) {
    case 'resolve':
      await updateReportStatus(report.id, 'resolved', at, adminId);
      break;
    case 'dismiss':
      await updateReportStatus(report.id, 'dismissed', at, adminId);
      break;
    case 'ban':
      await setBanned(target.id, true);
      await updateReportStatus(report.id, 'resolved', at, adminId);
      break;
    case 'unban':
      await liftBanDb(target.id);
      await closeOpenReportsAgainst(target.id, 'dismissed', at, adminId);
      break;
  }
  return ok(true);
}
