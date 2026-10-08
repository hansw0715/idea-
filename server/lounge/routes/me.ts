import { Router } from 'express';
import { createRateLimiter } from '../../rateLimit.js';
import { handler, me as currentUser, requireProfile, sendResult } from '../http.js';
import { getPublicUserFor, saveProfile, toMeResponse } from '../services/profile.js';

/**
 * 프로필·접속 정보: GET/PUT /me, GET /users/:id  (프로필 없이도 /me 는 열려 있다)
 * 규칙: docs/lounge/01-contract.md §1
 *
 * 이 라우터는 requireProfile 앞에 마운트된다(프로필을 만들러 오는 길이라서).
 * 그래서 다른 사람을 보는 `/users/:id` 에만 requireProfile 을 직접 건다.
 */
export const meRouter = Router();

/**
 * 프로필 저장: 사용자당 10분에 20번. 정상 사용(만들기·고치기·검증 오류 뒤 다시 저장)에는 충분하고,
 * 학과 같은 값을 계속 바꿔 보며 서버의 반응을 떠보는 시도는 값싸게 막는다.
 * (학과 자체의 변경 제한은 services/profile.ts 의 decideDepartmentChange 가 DB 기준으로 지킨다 — 이 제한은 인스턴스 메모리라 보조 수단이다)
 */
const saveLimiter = createRateLimiter(20, 10 * 60_000);

// 내 정보·남의 정보는 사람마다 다르다. 중간 캐시가 다른 사람에게 내 응답을 주지 않게 한다.
meRouter.use(['/me', '/users'], (_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});

meRouter.get(
  '/me',
  handler(async (_req, res) => {
    // withUser 가 요청 처음에 읽어 둔 사용자 — 추가 쿼리 없음
    res.json(toMeResponse(currentUser(res)));
  }),
);

meRouter.put(
  '/me',
  handler(async (req, res) => {
    const user = currentUser(res);
    if (!saveLimiter.hit(user.id)) {
      res.status(429).json({ error: '프로필을 너무 자주 저장하고 있어요. 잠시 후 다시 시도해 주세요.', code: 'RATE_LIMITED' });
      return;
    }
    sendResult(res, await saveProfile(user.id, req.body), (profile) => ({ profile }));
  }),
);

meRouter.get(
  '/users/:id',
  requireProfile,
  handler(async (req, res) => {
    const id = req.params.id;
    sendResult(res, await getPublicUserFor(currentUser(res).id, typeof id === 'string' ? id : ''), (user) => ({ user }));
  }),
);
