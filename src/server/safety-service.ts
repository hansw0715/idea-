/**
 * 차단 · 신고 서비스. (담당: 한승원)
 * 미팅·밥약이 공통으로 쓰고, 관리자 대시보드에서 처리한다.
 */
import { fail, ok, type Result, type UserId } from '@/shared/types';
import type { User } from '@/shared/user';
import { liftBan } from '@/domain/reputation/reputation';
import {
  alreadyReported,
  hiddenUserIds,
  isAutoRestricted,
  isBlocked,
  openReportCount,
  REPORT_REASONS,
  type Block,
  type Report,
  type ReportReason,
} from '@/domain/safety/safety';
import { safetyRepo, userRepo } from './repo/memory-repo';

const nowISO = () => new Date().toISOString();

// ---------- 차단 ----------

export async function blockUser(me: UserId, targetId: UserId): Promise<Result<true>> {
  if (me === targetId) return fail('INVALID', '자기 자신은 차단할 수 없습니다.');
  const target = await userRepo.find(targetId);
  if (!target) return fail('NOT_FOUND', '없는 사용자입니다.');

  await safetyRepo.saveBlock({ blockerId: me, blockedId: targetId, at: nowISO() });
  return ok(true);
}

export async function unblockUser(me: UserId, targetId: UserId): Promise<Result<true>> {
  await safetyRepo.removeBlock(me, targetId);
  return ok(true);
}

/** 내가 차단했거나 나를 차단한 사람 — 목록·매칭에서 서로 감춘다 */
export async function hiddenFor(me: UserId | null): Promise<Set<string>> {
  if (!me) return new Set();
  return new Set(hiddenUserIds(await safetyRepo.listBlocks(), me));
}

/** 두 사람이 서로 가려진 사이인지 (빠른 매칭에서 씀) */
export async function blockChecker(): Promise<(a: UserId, b: UserId) => boolean> {
  const blocks: Block[] = await safetyRepo.listBlocks();
  return (a, b) => isBlocked(blocks, a, b);
}

/** 내가 차단한 사람들 (차단 목록 화면용) */
export async function myBlocks(me: UserId): Promise<UserId[]> {
  return (await safetyRepo.listBlocks()).filter((b) => b.blockerId === me).map((b) => b.blockedId);
}

// ---------- 신고 ----------

export type ReportInput = {
  targetId: UserId;
  context: string;
  refId: string | null;
  reason: ReportReason;
  detail: string;
};

export async function reportUser(me: UserId, input: ReportInput): Promise<Result<Report>> {
  if (me === input.targetId) return fail('INVALID', '자기 자신은 신고할 수 없습니다.');
  if (!REPORT_REASONS.includes(input.reason)) return fail('INVALID', '신고 사유를 골라 주세요.');

  const target = await userRepo.find(input.targetId);
  if (!target) return fail('NOT_FOUND', '없는 사용자입니다.');

  const reports = await safetyRepo.listReports();
  if (alreadyReported(reports, me, input.targetId, input.refId)) {
    return fail('INVALID', '이미 신고한 건이에요. 관리자가 확인 중입니다.');
  }

  const report: Report = {
    id: crypto.randomUUID(),
    reporterId: me,
    targetId: input.targetId,
    context: input.context,
    refId: input.refId,
    reason: input.reason,
    detail: input.detail.trim().slice(0, 500),
    status: 'open',
    createdAt: nowISO(),
    handledAt: null,
    handledBy: null,
  };
  await safetyRepo.saveReport(report);

  // 신고가 쌓이면 관리자가 확인할 때까지 자동으로 이용을 막는다.
  if (isAutoRestricted([...reports, report], input.targetId) && !target.banned) {
    await userRepo.save({ ...target, banned: true });
  }
  return ok(report);
}

/** 신고 누적이나 노쇼 경고로 지금 이용이 막혔는지 */
export async function usageBlocked(user: User): Promise<string | null> {
  if (user.banned) return '신고·노쇼 누적으로 이용이 제한된 계정이에요. 관리자 확인 후 풀립니다.';
  return null;
}

// ---------- 관리자 ----------

export type ReportView = Report & {
  reporter: { id: string; nickname: string };
  target: { id: string; nickname: string; temperature: number; warnings: number; banned: boolean };
  openCountForTarget: number;
};

export async function listReportsForAdmin(): Promise<ReportView[]> {
  const [reports, users] = await Promise.all([safetyRepo.listReports(), userRepo.list()]);
  const byId = new Map(users.map((u) => [u.id as string, u]));
  const unknown = { nickname: '(탈퇴)', temperature: 0, warnings: 0, banned: false };

  return reports.map((r) => {
    const reporter = byId.get(r.reporterId);
    const target = byId.get(r.targetId);
    return {
      ...r,
      reporter: { id: r.reporterId, nickname: reporter?.nickname ?? unknown.nickname },
      target: {
        id: r.targetId,
        nickname: target?.nickname ?? unknown.nickname,
        temperature: target?.temperature ?? 0,
        warnings: target?.warnings ?? 0,
        banned: target?.banned ?? false,
      },
      openCountForTarget: openReportCount(reports, r.targetId),
    };
  });
}

export type ReportAction = 'resolve' | 'dismiss' | 'ban' | 'unban';

export async function handleReport(admin: UserId, reportId: string, action: ReportAction): Promise<Result<true>> {
  const reports = await safetyRepo.listReports();
  const report = reports.find((r) => r.id === reportId);
  if (!report) return fail('NOT_FOUND', '없는 신고입니다.');

  const target = await userRepo.find(report.targetId);
  if (!target) return fail('NOT_FOUND', '없는 사용자입니다.');

  if (action === 'ban') await userRepo.save({ ...target, banned: true });
  if (action === 'unban') await userRepo.save({ ...target, ...liftBan(target) });

  // 정지 해제는 그 사람에 대한 열린 신고를 전부 정리한다 (다시 자동 제한에 걸리지 않게)
  const toClose = action === 'unban' ? reports.filter((r) => r.targetId === report.targetId && r.status === 'open') : [report];
  const status = action === 'dismiss' || action === 'unban' ? 'dismissed' : 'resolved';
  for (const r of toClose) {
    await safetyRepo.saveReport({ ...r, status, handledAt: nowISO(), handledBy: admin });
  }
  return ok(true);
}
