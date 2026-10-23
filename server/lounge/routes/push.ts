import { Router } from 'express';
import { fail } from '../../../shared/lounge/types.js';
import { handler, me, sendError } from '../http.js';
import { deleteSubscription, parseSubscription, publicKey, saveSubscription } from '../services/push.js';

/**
 * 폰 알림 구독: GET /push/key · POST /push/subscribe · DELETE /push/subscribe
 * 라운지 프로필이 없어도 구독할 수 있다 (회의 초대 알림은 라운지와 상관없이 온다).
 */
export const pushRouter = Router();

pushRouter.get(
  '/push/key',
  handler(async (_req, res) => {
    res.json({ key: publicKey() });
  }),
);

pushRouter.post(
  '/push/subscribe',
  handler(async (req, res) => {
    const sub = parseSubscription(req.body);
    if (!sub) return sendError(res, fail('INVALID', '알림 구독 정보가 올바르지 않습니다.').error);
    if (!publicKey()) return sendError(res, fail('NOT_OPEN', '지금은 알림을 보낼 수 없어요.').error);
    await saveSubscription(me(res).id, sub);
    res.json({ ok: true });
  }),
);

pushRouter.delete(
  '/push/subscribe',
  handler(async (req, res) => {
    const endpoint = (req.body ?? {}).endpoint;
    if (typeof endpoint === 'string') await deleteSubscription(me(res).id, endpoint);
    res.json({ ok: true });
  }),
);
