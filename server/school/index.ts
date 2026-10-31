import { Router } from 'express';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { userId } from '../auth.js';
import { get } from '../db.js';
import { errorResponseOf, sessionGone } from './http.js';
import { createSchoolService, parseCredentials, parseSchoolClasses } from './service.js';
import type { SchoolService } from './service.js';

/**
 * 학교 계정 연동 API — `/api/school/*` (로그인 필요). 설계: docs/school/00-design.md §4
 * 인증(requireAuth)과 `Cache-Control: no-store` 는 app.ts 가 마운트하면서 이미 건다.
 *
 * 라우트는 판단하지 않고 검증·변환만 한다. 오류는 `{ error, code }`:
 *  - 학교 오류(SchoolErrorCode): AUTH_FAILED·REJECTED 422, LOCKED 429, UNAVAILABLE 502, NOT_LINKED 409.
 *    AUTH_FAILED 를 401 로 두면 앱 로그아웃(401 인터셉터)과 섞이므로 422 다.
 *  - 입력 오류: INVALID 400 / NOT_FOUND 404 / FORBIDDEN 403 / RATE_LIMITED 429.
 *  - 그 밖의 예외는 전역 오류 처리기로 간다 (500). 학교 오류 객체에는 평문·요청 본문이 들어 있지 않다.
 */
function route(fn: (req: Request, res: Response) => Promise<void>): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res).catch((err: unknown) => {
      const out = errorResponseOf(err);
      if (!out) {
        next(err);
        return;
      }
      if (out.retryAfter !== undefined) res.setHeader('Retry-After', String(out.retryAfter));
      res.status(out.status).json(out.body);
    });
  };
}

const bodyOf = (req: Request): Record<string, unknown> =>
  (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>;

/**
 * 로그인 토큰이 유효해도 users 행이 없으면(탈퇴한 사용자의 남은 토큰, 최대 7일) 401 로 돌려보낸다.
 * requireAuth 는 토큰만 보므로, 이 라우터가 직접 확인해 탈퇴한 사람이 서버를 학교 로그인 프록시로 쓰지 못하게 한다
 * (라운지의 withUser 와 같은 응답). 서비스 함수도 같은 확인을 하지만, 이쪽이 모든 경로에 일관되게 걸린다.
 */
export const requireExistingUser: RequestHandler = (_req, res, next) => {
  get('SELECT 1 AS x FROM users WHERE id = ?', [userId(res)]).then(
    (row) => {
      if (!row) {
        const e = sessionGone();
        res.status(e.status).json({ error: e.message, code: e.code });
        return;
      }
      next();
    },
    next,
  );
};

export function createSchoolRouter(service: SchoolService): Router {
  const router = Router();
  router.use(requireExistingUser);

  router.get('/link', route(async (_req, res) => { res.json(await service.getLink(userId(res))); }));
  router.post('/link', route(async (req, res) => { res.json(await service.link(userId(res), bodyOf(req))); }));
  router.delete('/link', route(async (_req, res) => { res.json(await service.unlink(userId(res))); }));

  router.post('/timetable/preview', route(async (req, res) => {
    res.json(await service.timetablePreview(userId(res), parseCredentials(bodyOf(req).creds)));
  }));
  router.post('/timetable/import', route(async (req, res) => {
    res.json(await service.timetableImport(userId(res), parseCredentials(bodyOf(req).creds)));
  }));
  // 미리보기에서 받은 수업을 저장만 (학교를 다시 읽지 않는다)
  router.post('/timetable/save', route(async (req, res) => {
    res.json(await service.timetableSave(userId(res), parseSchoolClasses(bodyOf(req))));
  }));

  router.post('/reservations', route(async (req, res) => {
    res.json(await service.myReservations(userId(res), parseCredentials(bodyOf(req).creds)));
  }));

  router.post('/book/preview', route(async (req, res) => { res.json(await service.bookPreview(userId(res), bodyOf(req))); }));
  router.post('/book/submit', route(async (req, res) => { res.json(await service.bookSubmit(userId(res), bodyOf(req))); }));
  router.post('/eclass', route(async (req, res) => { res.json(await service.eclassOverview(userId(res), bodyOf(req))); }));
  router.post('/book/cancel', route(async (req, res) => { res.json(await service.bookCancel(userId(res), bodyOf(req))); }));

  return router;
}

export const schoolRouter = createSchoolRouter(createSchoolService());
