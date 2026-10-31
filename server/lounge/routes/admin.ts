import { Router } from 'express';
import { fail } from '../../../shared/lounge/types.js';
import type { ReportAction } from '../../../shared/lounge/view.js';
import { handler, me, sendError } from '../http.js';
import { handleReport, listReportsForAdmin } from '../services/safety.js';
import { isSafeId } from '../domain/safety.js';
import { adminStats } from '../services/stats.js';
import { listWithdrawn, releaseWithdrawn } from '../../school/withdrawn.js';
import type { AdminTool, AdminUserAction } from '../../../shared/lounge/view.js';
import type { GatheringKind } from '../../../shared/lounge/gathering.js';
import {
  TOOLS,
  USER_ACTIONS,
  USER_FILTERS,
  adminBroadcast,
  adminCancelGathering,
  adminDeleteMeeting,
  adminGatherings,
  adminKickMember,
  adminMeetings,
  adminOverview,
  adminRunTool,
  adminUserAction,
  adminUsers,
  logAdmin,
  recentAdminLog,
} from '../services/admin.js';
import type { GatheringStatusFilter, UserFilter } from '../services/admin.js';
import { parseUserId } from './gatherings.js';

/**
 * 관리자: GET/POST /admin/reports, GET /admin/stats, GET /admin/withdrawn · POST /admin/withdrawn/release  (index.ts 가 requireAdmin 으로 보호한다)
 * 규칙: docs/lounge/01-contract.md §6
 * 닉네임·온도·경고·정지 여부만 보인다 — 실명·이메일·학과는 관리자 화면에도 내려가지 않는다.
 */
export const adminRouter = Router();

const ACTIONS: readonly ReportAction[] = ['resolve', 'dismiss', 'ban', 'unban'];

type Obj = Record<string, unknown>;
const bodyOf = (req: { body: unknown }): Obj => (typeof req.body === 'object' && req.body !== null ? (req.body as Obj) : {});
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const pick = <T extends string>(v: unknown, list: readonly T[], fallback: T): T =>
  typeof v === 'string' && (list as readonly string[]).includes(v) ? (v as T) : fallback;

// 관리자 화면은 늘 최신 값을 본다
adminRouter.use((_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});

adminRouter.get(
  '/reports',
  handler(async (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ reports: await listReportsForAdmin() });
  }),
);

adminRouter.post(
  '/reports',
  handler(async (req, res) => {
    const body = (typeof req.body === 'object' && req.body !== null ? req.body : {}) as Record<string, unknown>;
    const { reportId, action } = body;
    // 신고 id 는 UUID 다. 모양이 다르면(NUL 등) DB 에 닿기 전에 거른다 — 닿으면 Postgres 오류로 500 이 된다.
    if (!isSafeId(reportId)) {
      return sendError(res, fail('INVALID', '처리할 신고가 없습니다.').error);
    }
    if (typeof action !== 'string' || !(ACTIONS as readonly string[]).includes(action)) {
      return sendError(res, fail('INVALID', '처리 방법이 올바르지 않습니다.').error);
    }
    const result = await handleReport(me(res).id, reportId, action as ReportAction);
    if (!result.ok) return sendError(res, result.error);
    const label = { resolve: '신고 처리 완료', dismiss: '신고 기각', ban: '신고로 이용 정지', unban: '신고 대상 정지 해제' }[action as ReportAction];
    await logAdmin(me(res).id, label, `신고 ${reportId.slice(0, 8)}`);
    res.json({ ok: true });
  }),
);

adminRouter.get(
  '/stats',
  handler(async (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json(await adminStats());
  }),
);

/** 탈퇴한 학번 목록 (가린 학번·날짜만) — 재가입 허용은 학번을 직접 입력해서 한다 */
adminRouter.get(
  '/withdrawn',
  handler(async (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ items: await listWithdrawn() });
  }),
);

adminRouter.post(
  '/withdrawn/release',
  handler(async (req, res) => {
    const studentId = (typeof req.body === 'object' && req.body !== null ? (req.body as Record<string, unknown>).studentId : undefined);
    if (typeof studentId !== 'string' || !/^\d{6,12}$/.test(studentId.trim())) {
      return sendError(res, fail('INVALID', '학번을 숫자로 입력해 주세요.').error);
    }
    const released = await releaseWithdrawn(studentId.trim(), Number(me(res).id));
    if (!released) return sendError(res, fail('NOT_FOUND', '이 학번으로 막혀 있는 탈퇴 기록이 없어요.').error);
    res.json({ ok: true });
  }),
);

// ───────────── 대시보드 · 사용자 · 모임 · 회의 · 운영 도구 (services/admin.ts) ─────────────

adminRouter.get(
  '/overview',
  handler(async (_req, res) => {
    res.json(await adminOverview());
  }),
);

adminRouter.get(
  '/log',
  handler(async (_req, res) => {
    res.json({ items: await recentAdminLog(100) });
  }),
);

adminRouter.get(
  '/users',
  handler(async (req, res) => {
    const filter = pick<UserFilter>(req.query.filter, USER_FILTERS, 'all');
    res.json({ users: await adminUsers(str(req.query.q), filter) });
  }),
);

adminRouter.post(
  '/users/:id/action',
  handler(async (req, res) => {
    const target = parseUserId(req.params.id);
    const action = bodyOf(req).action;
    if (!target) return sendError(res, fail('INVALID', '사용자를 골라 주세요.').error);
    if (typeof action !== 'string' || !(USER_ACTIONS as readonly string[]).includes(action)) {
      return sendError(res, fail('INVALID', '처리 방법이 올바르지 않습니다.').error);
    }
    const result = await adminUserAction(me(res).id, target, action as AdminUserAction);
    if (!result.ok) return sendError(res, result.error);
    res.json({ ok: true });
  }),
);

const KIND_FILTERS = ['all', 'meal', 'meetup', 'team'] as const;
const STATUS_FILTERS: readonly GatheringStatusFilter[] = ['all', 'live', 'done', 'cancelled'];

adminRouter.get(
  '/gatherings',
  handler(async (req, res) => {
    const kind = pick<(typeof KIND_FILTERS)[number]>(req.query.kind, KIND_FILTERS, 'all');
    const status = pick<GatheringStatusFilter>(req.query.status, STATUS_FILTERS, 'all');
    res.json({ gatherings: await adminGatherings(kind as GatheringKind | 'all', status) });
  }),
);

adminRouter.post(
  '/gatherings/:id/cancel',
  handler(async (req, res) => {
    if (!isSafeId(req.params.id)) return sendError(res, fail('INVALID', '모임을 골라 주세요.').error);
    const result = await adminCancelGathering(me(res).id, req.params.id, str(bodyOf(req).reason));
    if (!result.ok) return sendError(res, result.error);
    res.json({ ok: true });
  }),
);

adminRouter.post(
  '/gatherings/:id/kick',
  handler(async (req, res) => {
    const target = parseUserId(bodyOf(req).userId);
    if (!isSafeId(req.params.id) || !target) return sendError(res, fail('INVALID', '뺄 사람을 골라 주세요.').error);
    const result = await adminKickMember(me(res).id, req.params.id, target);
    if (!result.ok) return sendError(res, result.error);
    res.json({ ok: true });
  }),
);

adminRouter.get(
  '/meetings',
  handler(async (req, res) => {
    res.json({ meetings: await adminMeetings(str(req.query.q)) });
  }),
);

adminRouter.delete(
  '/meetings/:id',
  handler(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return sendError(res, fail('INVALID', '회의를 골라 주세요.').error);
    const result = await adminDeleteMeeting(me(res).id, id);
    if (!result.ok) return sendError(res, result.error);
    res.json({ ok: true });
  }),
);

adminRouter.post(
  '/tools/:tool',
  handler(async (req, res) => {
    const tool = pick<AdminTool | ''>(req.params.tool, TOOLS, '');
    if (!tool) return sendError(res, fail('INVALID', '없는 도구예요.').error);
    const result = await adminRunTool(me(res).id, tool);
    if (!result.ok) return sendError(res, result.error);
    res.json(result.value);
  }),
);

adminRouter.post(
  '/broadcast',
  handler(async (req, res) => {
    const b = bodyOf(req);
    const result = await adminBroadcast(me(res).id, str(b.title), str(b.body));
    if (!result.ok) return sendError(res, result.error);
    res.json(result.value);
  }),
);
