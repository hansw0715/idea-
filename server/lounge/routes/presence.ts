import { Router } from 'express';
import { createRateLimiter } from '../../rateLimit.js';
import { handler, me as currentUser, sendResult } from '../http.js';
import { removePresence } from '../repo/presence.js';
import { readPresence, writePresence } from '../services/presence.js';

/**
 * 라운지 접속자 위치: GET/POST /presence  (프로필을 만든 사용자만 — requireProfile 뒤에 마운트)
 * 규칙: docs/lounge/01-contract.md §2
 */
export const presenceRouter = Router();

/** 위치 쓰기: 사용자당 분당 90회 (걷기 이동 + 20초 하트비트 + 이모트로 충분하고, 폭주하는 클라이언트는 막는다) */
const writeLimiter = createRateLimiter(90, 60_000);

// 3초마다 바뀌는 값이다. 어떤 캐시도 붙잡지 않게 한다.
presenceRouter.use('/presence', (_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});

presenceRouter.get(
  '/presence',
  handler(async (_req, res) => {
    res.json(await readPresence(currentUser(res)));
  }),
);

presenceRouter.post(
  '/presence',
  handler(async (req, res) => {
    const user = currentUser(res);
    if (!writeLimiter.hit(user.id)) {
      res.status(429).json({ error: '위치를 너무 자주 보내고 있어요. 잠시 후 다시 시도해 주세요.', code: 'RATE_LIMITED' });
      return;
    }
    sendResult(res, await writePresence(user, req.body), () => ({ ok: true }));
  }),
);

/** 라운지를 나갈 때: 접속자에서 바로 뺀다 (TTL 을 기다리지 않게) */
presenceRouter.delete(
  '/presence',
  handler(async (_req, res) => {
    await removePresence(currentUser(res).id);
    res.json({ ok: true });
  }),
);
