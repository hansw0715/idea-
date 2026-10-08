import { Router } from 'express';
import { fail } from '../../../shared/lounge/types.js';
import { createRateLimiter } from '../../rateLimit.js';
import { handler, me, sendError } from '../http.js';
import { blockUser, myBlocks, reportUser, unblockUser } from '../services/safety.js';
import { isSafeId } from '../domain/safety.js';
import { parseUserId } from './gatherings.js';

/**
 * 차단·신고: GET/POST/DELETE /blocks, POST /reports
 * 규칙: docs/lounge/01-contract.md §5
 * 차단하면 서로의 글·매칭·접속자에서 사라진다. 상대에게는 알리지 않는다 (응답에도 차단당한 사실이 드러나지 않는다).
 */
export const safetyRouter = Router();

const reportLimiter = createRateLimiter(20, 24 * 60 * 60 * 1000); // 신고: 하루(24시간 창) 20번

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

safetyRouter.get(
  '/blocks',
  handler(async (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ blocked: await myBlocks(me(res).id) });
  }),
);

safetyRouter.post(
  '/blocks',
  handler(async (req, res) => {
    const target = parseUserId(isObj(req.body) ? req.body.userId : undefined);
    if (!target) return sendError(res, fail('INVALID', '차단할 사람이 없습니다.').error);
    const result = await blockUser(me(res).id, target);
    if (!result.ok) return sendError(res, result.error);
    res.json({ ok: true });
  }),
);

safetyRouter.delete(
  '/blocks',
  handler(async (req, res) => {
    // DELETE 는 본문을 못 싣는 클라이언트도 있어서 쿼리(?userId=)도 받는다.
    const target = parseUserId(isObj(req.body) && req.body.userId !== undefined ? req.body.userId : req.query.userId);
    if (!target) return sendError(res, fail('INVALID', '해제할 사람이 없습니다.').error);
    await unblockUser(me(res).id, target);
    res.json({ ok: true });
  }),
);

safetyRouter.post(
  '/reports',
  handler(async (req, res) => {
    const viewer = me(res);
    const body: Obj = isObj(req.body) ? req.body : {};

    const target = parseUserId(body.userId);
    if (!target || typeof body.reason !== 'string') {
      return sendError(res, fail('INVALID', '신고 정보가 부족합니다.').error);
    }
    // context: 어디서 신고했는지(meetup · meal · profile · chat …). 키 모양만 확인한다.
    const contextRaw = body.context === undefined || body.context === null || body.context === '' ? 'etc' : body.context;
    if (typeof contextRaw !== 'string' || !/^[a-z0-9_-]{1,30}$/i.test(contextRaw)) {
      return sendError(res, fail('INVALID', '신고한 위치가 올바르지 않습니다.').error);
    }
    // refId: 관련 모임 id 같은 것. 길이만이 아니라 모양을 본다 — NUL 이 SQL 에 닿으면 Postgres 가 거절해 500 이 된다.
    const refRaw = body.refId === undefined || body.refId === null || body.refId === '' ? null : body.refId;
    if (refRaw !== null && !isSafeId(refRaw)) {
      return sendError(res, fail('INVALID', '신고한 대상이 올바르지 않습니다.').error);
    }
    const detail = body.detail === undefined || body.detail === null ? '' : body.detail;
    if (typeof detail !== 'string') return sendError(res, fail('INVALID', '자세한 내용이 올바르지 않습니다.').error);

    if (!reportLimiter.hit(viewer.id)) {
      res.status(429).json({ error: '신고는 하루에 20번까지 할 수 있어요. 내일 다시 시도해 주세요.', code: 'RATE_LIMITED' });
      return;
    }

    const result = await reportUser(viewer.id, {
      targetId: target,
      context: contextRaw,
      refId: refRaw,
      reason: body.reason,
      detail,
    });
    if (!result.ok) return sendError(res, result.error);
    res.json({ ok: true });
  }),
);
