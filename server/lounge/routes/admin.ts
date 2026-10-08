import { Router } from 'express';
import { fail } from '../../../shared/lounge/types.js';
import type { ReportAction } from '../../../shared/lounge/view.js';
import { handler, me, sendError } from '../http.js';
import { handleReport, listReportsForAdmin } from '../services/safety.js';
import { isSafeId } from '../domain/safety.js';
import { adminStats } from '../services/stats.js';

/**
 * 관리자: GET/POST /admin/reports, GET /admin/stats  (index.ts 가 requireAdmin 으로 보호한다)
 * 규칙: docs/lounge/01-contract.md §6
 * 닉네임·온도·경고·정지 여부만 보인다 — 실명·이메일·학과는 관리자 화면에도 내려가지 않는다.
 */
export const adminRouter = Router();

const ACTIONS: readonly ReportAction[] = ['resolve', 'dismiss', 'ban', 'unban'];

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
