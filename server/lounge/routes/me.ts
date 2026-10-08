import { Router } from 'express';
import { createRateLimiter } from '../../rateLimit.js';
import { handler, me as currentUser, requireProfile, sendResult } from '../http.js';
import { getPublicUserFor, toMeResponse, updateProfile } from '../services/profile.js';
import { ensureSchoolProfile } from '../services/schoolProfile.js';
import { findUser } from '../users.js';

/**
 * 프로필·접속 정보: GET/PUT /me, GET /users/:id  (프로필 없이도 /me 는 열려 있다)
 * 프로필은 학교 계정 정보로 자동 생성된다. PUT /me 는 아바타 색만 바꾼다.
 * 규칙: docs/lounge/01-contract.md §1
 *
 * 이 라우터는 requireProfile 앞에 마운트된다(프로필을 만들러 오는 길이라서).
 * 그래서 다른 사람을 보는 `/users/:id` 에만 requireProfile 을 직접 건다.
 */
export const meRouter = Router();

/** 프로필 저장(아바타 색): 사용자당 10분에 20번 */
const saveLimiter = createRateLimiter(20, 10 * 60_000);

// 내 정보·남의 정보는 사람마다 다르다. 중간 캐시가 다른 사람에게 내 응답을 주지 않게 한다.
meRouter.use(['/me', '/users'], (_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});

meRouter.get(
  '/me',
  handler(async (_req, res) => {
    // withUser 가 요청 처음에 읽어 둔 사용자 — 프로필이 있으면 추가 쿼리 없음
    let user = currentUser(res);
    if (!user.profileDone && (await ensureSchoolProfile(user.id))) {
      // 학교 연동은 있는데 프로필이 없는 옛 계정: 학교 계정 정보로 한 번 채운다
      user = (await findUser(user.id)) ?? user;
    }
    res.json(toMeResponse(user));
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
    sendResult(res, await updateProfile(user.id, req.body), (profile) => ({ profile }));
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
