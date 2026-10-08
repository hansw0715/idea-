/**
 * 라운지 라우터 공용 도구.
 *
 * 응답 오류 형식: `{ "error": "사람이 읽는 문장", "code": "SLOT_FULL" }`
 * — 기존 클라이언트 api.ts 가 `error` 문자열을 그대로 보여 주고, 라운지 화면은 `code` 로 분기한다.
 */
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { ERROR_STATUS, fail } from '../../shared/lounge/types.js';
import type { AppError, Result } from '../../shared/lounge/types.js';
import { requireAuth, userId } from '../auth.js';
import { findUser } from './users.js';
import type { LoungeUser } from './users.js';

export { requireAuth };

export function sendError(res: Response, error: AppError): void {
  res.status(ERROR_STATUS[error.code] ?? 400).json({ error: error.message, code: error.code });
}

/** Result 를 HTTP 응답으로. 성공이면 map(value) 을 JSON 으로 보낸다. */
export function sendResult<T>(
  res: Response,
  result: Result<T>,
  map: (value: T) => unknown = (v) => v,
  status = 200,
): void {
  if (!result.ok) {
    sendError(res, result.error);
    return;
  }
  res.status(status).json(map(result.value));
}

/** async 핸들러의 거부(rejection)를 Express 에러 처리로 넘긴다. (auth.ts 의 wrap 과 같다) */
export function handler(fn: (req: Request, res: Response) => Promise<void>): RequestHandler {
  return (req, res, next) => {
    fn(req, res).catch(next);
  };
}

/** 로그인한 사용자(JWT)의 라운지 정보. 요청마다 한 번만 읽어 res.locals 에 둔다. */
export const withUser: RequestHandler = (req: Request, res: Response, next: NextFunction) => {
  findUser(userId(res))
    .then((u) => {
      if (!u) {
        res.status(401).json({ error: '세션이 만료되었습니다. 다시 로그인해 주세요.', code: 'FORBIDDEN' });
        return;
      }
      res.locals.loungeUser = u;
      next();
    })
    .catch(next);
};

/** 라운지 프로필을 만든 사용자만 통과. 아니면 428 PROFILE_REQUIRED (클라이언트가 프로필 시트를 연다). */
export const requireProfile: RequestHandler = (req, res, next) => {
  const u = res.locals.loungeUser as LoungeUser | undefined;
  if (!u) {
    next(new Error('requireProfile 은 withUser 뒤에 와야 합니다.'));
    return;
  }
  if (!u.profileDone) {
    sendError(res, fail('PROFILE_REQUIRED').error);
    return;
  }
  next();
};

export const requireAdmin: RequestHandler = (req, res, next) => {
  const u = res.locals.loungeUser as LoungeUser | undefined;
  if (!u?.isAdmin) {
    sendError(res, fail('FORBIDDEN', '관리자만 할 수 있습니다.').error);
    return;
  }
  next();
};

/** 핸들러 안에서 현재 라운지 사용자 꺼내기 */
export const me = (res: Response): LoungeUser => res.locals.loungeUser as LoungeUser;
