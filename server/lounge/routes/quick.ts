import { Router } from 'express';
import type { Request, Response } from 'express';
import { fail, ok } from '../../../shared/lounge/types.js';
import type { Result } from '../../../shared/lounge/types.js';
import { BAND_KEYS } from '../../../shared/lounge/constants.js';
import type { QuickPatchBody } from '../../../shared/lounge/view.js';
import { createRateLimiter } from '../../rateLimit.js';
import { handler, me, sendResult } from '../http.js';
import { answerRoom, cancelQuickMatch, prepareQuickMatch, quickState, startQuickNow, submitQuickMatch, voteBands } from '../services/quick.js';

/**
 * 밥약 빠른 매칭: GET/POST/PATCH/DELETE /meals/quick  →  항상 `{ state: QuickState }`
 * 라우트는 판단하지 않고 검증·변환만 한다. 규칙은 services/quick.ts, 도메인은 domain/quickMatch.ts.
 * 규칙 문서: docs/lounge/01-contract.md §4
 */
export const quickRouter = Router();

/**
 * 신청은 10분에 10번까지 (사용자 id 기준). 인스턴스 메모리라 서버리스에서는 약하지만 기능이 깨지지 않는다.
 * 검증(prepareQuickMatch)을 통과한 요청만 센다 — 입력을 잘못해 400 으로 돌려받은 요청이 한도를 깎아
 * 정상 신청이 429 가 되는 일이 없게 (모임 만들기와 같은 순서).
 */
const requestLimiter = createRateLimiter(10, 10 * 60_000);

/** 방 id 는 UUID(또는 테스트의 영문-숫자 이름)다. NUL 같은 글자가 SQL 까지 가면 DB 오류(500)가 되므로 입구에서 INVALID 로 돌린다. */
const ROOM_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/** 사람마다 다르고 폴링으로 자주 바뀌는 상태라 중간 캐시가 남에게 내 응답을 주지 않게 한다 (라운지의 다른 사용자별 응답과 같다). */
quickRouter.use('/meals', (_req: Request, res: Response, next: () => void) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});

/** PATCH 본문: roomId + (bands 또는 answer) 중 정확히 하나. */
export function parsePatchBody(raw: unknown): Result<QuickPatchBody> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return fail('INVALID', '요청 내용이 올바르지 않아요.');
  const body = raw as Record<string, unknown>;
  if (typeof body.roomId !== 'string' || !ROOM_ID_PATTERN.test(body.roomId)) {
    return fail('INVALID', '방 정보가 올바르지 않습니다.');
  }
  const hasBands = body.bands !== undefined;
  const hasAnswer = body.answer !== undefined;
  if (hasBands === hasAnswer) return fail('INVALID', '가능한 시간 또는 수락·거절 중 하나만 보내 주세요.');

  if (hasAnswer) {
    if (body.answer !== 'accepted' && body.answer !== 'declined') return fail('INVALID', '수락 또는 거절만 보낼 수 있어요.');
    return ok({ roomId: body.roomId, answer: body.answer });
  }
  if (
    !Array.isArray(body.bands) ||
    body.bands.length > BAND_KEYS.length ||
    body.bands.some((b) => typeof b !== 'string' || b.length > 16)
  ) {
    return fail('INVALID', '가능한 시간을 하나 이상 골라 주세요.');
  }
  return ok({ roomId: body.roomId, bands: body.bands as string[] });
}

quickRouter.get(
  '/meals/quick',
  handler(async (_req, res) => {
    res.json({ state: await quickState(me(res).id) });
  }),
);

quickRouter.post(
  '/meals/quick',
  handler(async (req, res) => {
    const user = me(res);
    // 검증 → 속도 제한 → 저장 순서. 검증은 동기라 제한을 세는 사이에 await 가 없다 (동시에 와도 제한을 피해 가지 못한다).
    const prepared = prepareQuickMatch(user, req.body);
    if (!prepared.ok) {
      sendResult(res, prepared);
      return;
    }
    if (!requestLimiter.hit(user.id)) {
      res.status(429).json({ error: '빠른 매칭 신청이 너무 잦아요. 잠시 후 다시 시도해 주세요.', code: 'RATE_LIMITED' });
      return;
    }
    sendResult(res, await submitQuickMatch(user, prepared.value), (state) => ({ state }));
  }),
);

/** 3·4명을 찾다가 지금 모인 사람(2명 이상)으로 바로 시작 */
quickRouter.post(
  '/meals/quick/start',
  handler(async (_req, res) => {
    sendResult(res, await startQuickNow(me(res).id), (state) => ({ state }));
  }),
);

quickRouter.patch(
  '/meals/quick',
  handler(async (req, res) => {
    const body = parsePatchBody(req.body);
    if (!body.ok) {
      sendResult(res, body);
      return;
    }
    const userId = me(res).id;
    const result =
      'answer' in body.value
        ? await answerRoom(userId, body.value.roomId, body.value.answer)
        : await voteBands(userId, body.value.roomId, body.value.bands);
    sendResult(res, result, (state) => ({ state }));
  }),
);

quickRouter.delete(
  '/meals/quick',
  handler(async (_req, res) => {
    sendResult(res, await cancelQuickMatch(me(res).id), (state) => ({ state }));
  }),
);
