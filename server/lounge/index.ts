/**
 * 라운지 API — `/api/lounge/*` (로그인 필요).
 *
 * 마운트 순서가 곧 권한이다.
 *   1) requireAuth + withUser          로그인 확인, 라운지 사용자 로드
 *   2) meRouter                        프로필 없이도 열려 있다 (프로필을 만들러 오는 길)
 *   3) adminRouter (requireAdmin)      관리자 (프로필 불필요)
 *   4) requireProfile                  이후는 프로필을 만든 사용자만 (아니면 428 PROFILE_REQUIRED)
 */
import { Router } from 'express';
import { requireAdmin, requireAuth, requireProfile, withUser } from './http.js';
import { meRouter } from './routes/me.js';
import { adminRouter } from './routes/admin.js';
import { presenceRouter } from './routes/presence.js';
import { gatheringsRouter } from './routes/gatherings.js';
import { quickRouter } from './routes/quick.js';
import { safetyRouter } from './routes/safety.js';
import { friendsRouter } from './routes/friends.js';
import { pushRouter } from './routes/push.js';
import { devRouter } from './routes/dev.js';

export const loungeRouter = Router();

// 개발용 시드: 마운트는 항상 하되, devRouter 가 요청마다 켜진 환경인지 다시 확인해 아니면 404 를 낸다.
// (마운트를 빼 버리면 로그인 확인이 먼저 응답해서 운영에서도 401/428 이 나와 "없는 경로"가 아니게 된다)
// 명시적으로 켠 로컬 개발(LOUNGE_DEV_SEED=1, 운영·서버리스 아님)에서만 동작한다.
loungeRouter.use('/dev', devRouter);

loungeRouter.use(requireAuth, withUser);
loungeRouter.use(meRouter);
loungeRouter.use(pushRouter);
loungeRouter.use('/admin', requireAdmin, adminRouter);
loungeRouter.use(requireProfile);
loungeRouter.use(presenceRouter);
loungeRouter.use(gatheringsRouter);
loungeRouter.use(quickRouter);
loungeRouter.use(safetyRouter);
loungeRouter.use(friendsRouter);

