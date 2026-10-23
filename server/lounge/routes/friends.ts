import { Router } from 'express';
import { fail } from '../../../shared/lounge/types.js';
import { createRateLimiter } from '../../rateLimit.js';
import { handler, me, sendError } from '../http.js';
import { acceptFriend, askMeal, friendTimetable, myFriends, removeFriend, requestFriend } from '../services/friends.js';
import { parseUserId } from './gatherings.js';

/**
 * 라운지 친구: GET /friends · POST /friends(아이디로 요청) · POST /friends/accept · DELETE /friends
 * 규칙은 services/friends.ts.
 */
export const friendsRouter = Router();

/** 친구 요청은 1시간에 30번까지 — 아이디를 마구 넣어 보며 누가 있는지 알아내는 것을 늦춘다 */
const requestLimiter = createRateLimiter(30, 60 * 60_000);

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

friendsRouter.use('/friends', (_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});

friendsRouter.get(
  '/friends',
  handler(async (_req, res) => {
    res.json(await myFriends(me(res).id));
  }),
);

friendsRouter.post(
  '/friends',
  handler(async (req, res) => {
    const username = isObj(req.body) ? req.body.username : undefined;
    if (typeof username !== 'string' || !username.trim()) {
      return sendError(res, fail('INVALID', '친구의 아이디를 적어 주세요.').error);
    }
    const viewer = me(res);
    if (!requestLimiter.hit(viewer.id)) {
      res.status(429).json({ error: '친구 요청이 너무 잦아요. 잠시 후 다시 시도해 주세요.', code: 'RATE_LIMITED' });
      return;
    }
    const result = await requestFriend(viewer.id, username);
    if (!result.ok) return sendError(res, result.error);
    res.json({ result: result.value, ...(await myFriends(viewer.id)) });
  }),
);

friendsRouter.post(
  '/friends/accept',
  handler(async (req, res) => {
    const target = parseUserId(isObj(req.body) ? req.body.userId : undefined);
    if (!target) return sendError(res, fail('INVALID', '수락할 요청이 없습니다.').error);
    const viewer = me(res);
    const result = await acceptFriend(viewer.id, target);
    if (!result.ok) return sendError(res, result.error);
    res.json(await myFriends(viewer.id));
  }),
);

friendsRouter.delete(
  '/friends',
  handler(async (req, res) => {
    // DELETE 는 본문을 못 싣는 클라이언트도 있어서 쿼리(?userId=)도 받는다.
    const target = parseUserId(isObj(req.body) && req.body.userId !== undefined ? req.body.userId : req.query.userId);
    if (!target) return sendError(res, fail('INVALID', '대상이 없습니다.').error);
    const viewer = me(res);
    await removeFriend(viewer.id, target);
    res.json(await myFriends(viewer.id));
  }),
);

/** "밥 먹자"는 친구 한 명에게 10분에 한 번까지 — 알림이 쏟아지지 않게 */
const mealLimiter = createRateLimiter(1, 10 * 60_000);

friendsRouter.post(
  '/friends/meal',
  handler(async (req, res) => {
    const target = parseUserId(isObj(req.body) ? req.body.userId : undefined);
    if (!target) return sendError(res, fail('INVALID', '친구를 골라 주세요.').error);
    const viewer = me(res);
    if (!mealLimiter.hit(`${viewer.id}>${target}`)) {
      res.status(429).json({ error: '방금 밥 먹자고 했어요. 잠시 뒤에 다시 보내 주세요.', code: 'RATE_LIMITED' });
      return;
    }
    const result = await askMeal(viewer.id, target);
    if (!result.ok) return sendError(res, result.error);
    res.json({ ok: true });
  }),
);

friendsRouter.get(
  '/friends/:id/timetable',
  handler(async (req, res) => {
    const target = parseUserId(req.params.id);
    if (!target) return sendError(res, fail('INVALID', '친구를 골라 주세요.').error);
    const result = await friendTimetable(me(res).id, target, req.query.week);
    if (!result.ok) return sendError(res, result.error);
    res.json(result.value);
  }),
);
