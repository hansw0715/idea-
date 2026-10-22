import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import cookieParser from 'cookie-parser';
import fs from 'node:fs';
import path from 'node:path';
import { ready } from './db.js';
import { authRouter } from './auth.js';
import { timetableRouter } from './timetable.js';
import { meetingsRouter } from './meetings.js';
import { facilitiesRouter } from './facilities.js';
import { reservationsRouter } from './reservations.js';
import { coursesRouter } from './coursesRouter.js';
import { dashboardRouter } from './dashboard.js';
import { noticesRouter } from './notices.js';
import { healthRouter } from './health.js';
import { loungeRouter } from './lounge/index.js';
import { schoolRouter } from './school/index.js';
import { requireAuth } from './auth.js';

/** DB에 닿지 못한 경우인지 구분한다. 설정 실수와 앱 버그를 헷갈리지 않게 하려는 목적. */
function isDbConnectionError(err: unknown): boolean {
  const code = (err as { code?: string } | null)?.code ?? '';
  const message = String((err as Error | null)?.message ?? '');
  const codes = [
    'ENOTFOUND', 'ECONNREFUSED', 'ETIMEDOUT', 'EAI_AGAIN', 'ECONNRESET',
    '28P01', // 잘못된 비밀번호
    '28000', // 인증 실패
    '3D000', // 없는 데이터베이스
    '08006', '08001', // 연결 실패
  ];
  if (codes.includes(code)) return true;
  // Supabase 풀러는 연결 실패를 XX000으로 감싸 보내므로 메시지로도 판별한다.
  // 예: "(ENOTFOUND) tenant/user postgres.xxxx not found"
  return /ENOTFOUND|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|tenant|password authentication|SASL|certificate|Connection terminated|timeout expired|DATABASE_URL/i.test(
    message,
  );
}

/** Express/body-parser 가 오류에 달아 보내는 상태 코드(status 또는 statusCode)가 4xx 이면 그 값, 아니면 null. */
function clientErrorStatus(err: unknown): number | null {
  const e = err as { status?: unknown; statusCode?: unknown } | null;
  const status = typeof e?.status === 'number' ? e.status : e?.statusCode;
  return typeof status === 'number' && Number.isInteger(status) && status >= 400 && status < 500 ? status : null;
}

/** body-parser 의 오류인가 (type 이 'entity.*' · 'charset.*' · 'encoding.*' · 'request.*' · 'stream.*' 같은 점으로 구분된 문자열). */
function isBodyParserError(err: unknown): boolean {
  const type = (err as { type?: unknown } | null)?.type;
  return typeof type === 'string' && /^(entity|charset|encoding|request|stream|parameters)\./.test(type);
}

/** 4xx 별 고정 문장. 오류 객체의 메시지는 내부 정보나 요청 원문을 담을 수 있어 절대 그대로 내보내지 않는다. */
function clientErrorMessage(status: number, err: unknown): string {
  if (status === 413) return '요청 본문이 너무 큽니다.';
  if (status === 415) return '지원하지 않는 요청 형식입니다.';
  if (status === 400) {
    if (isBodyParserError(err)) return '요청 본문 형식이 올바르지 않습니다.';
    if (err instanceof URIError) return '요청 주소가 올바르지 않습니다.';
    return '요청 형식이 올바르지 않습니다.';
  }
  return '요청을 처리할 수 없습니다.';
}

/**
 * 전역 오류 처리기. 테스트가 직접 부를 수 있게 따로 내보낸다 (server/app.errors.test.ts 가 단위로 시험한다).
 *
 * 규칙: 응답에는 고정 문장만 쓰고 오류 객체의 message·stack 을 내보내지 않는다. 로그에도 요청 원문이 새지 않게 한다.
 */
export function errorHandler(err: unknown, _req: Request, res: Response, next: NextFunction): void {
  // 이미 응답을 보내기 시작했으면 Express 기본 처리에 맡긴다 (연결을 닫는다). 여기서 또 쓰면 오류 위에 오류가 난다.
  if (res.headersSent) {
    next(err);
    return;
  }
  // 클라이언트 잘못(깨진 JSON, 너무 큰 본문, 지원하지 않는 charset·encoding, 깨진 퍼센트 인코딩 주소 …)은
  // Express/body-parser 가 오류에 4xx 상태를 달아 보낸다. 서버 오류(500)로 바꾸지 않고 그 상태 그대로, 고정 문장으로 돌려준다.
  // body-parser 오류 객체에는 요청 원문(`body`)이 실려 있어 학교 비밀번호 같은 평문이 로그에 남을 수 있으므로,
  // 이 경우에는 오류 객체를 절대 출력하지 않는다 (로그도 남기지 않는다 — 클라이언트가 만든 오류라 서버가 알 일이 아니다).
  const status = clientErrorStatus(err);
  if (status !== null) {
    res.status(status).json({ error: clientErrorMessage(status, err), code: 'INVALID' });
    return;
  }
  // 4xx 가 아니어도 body-parser 가 만든 오류(예: stream.encoding.set)는 같은 원문을 들고 있다 — 이름·종류만 남긴다.
  if (isBodyParserError(err)) {
    const e = err as { name?: unknown; type?: unknown };
    console.error('[app] 요청 본문 처리 오류:', String(e.name), String(e.type));
  } else {
    console.error(err);
  }
  if (isDbConnectionError(err)) {
    res.status(503).json({
      error:
        '데이터베이스에 연결하지 못했습니다. DATABASE_URL 설정을 확인해 주세요. ' +
        '(Supabase는 Connect 화면의 Transaction pooler 문자열이어야 하고, 비밀번호에 특수문자가 있으면 URL 인코딩이 필요합니다)',
    });
    return;
  }
  res.status(500).json({ error: '서버 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.' });
}

export function createApp() {
  const app = express();

  // 리버스 프록시(Fly.io / Vercel / Netlify) 뒤에 놓이므로 X-Forwarded-* 를 신뢰해야
  // secure 쿠키와 req.ip(레이트리밋 키)가 올바르게 동작한다.
  app.set('trust proxy', 1);

  // 학교 계정 정보가 오가는 경로의 응답은 절대 캐시하지 않는다. 본문 해석(express.json)보다 **앞**에 두어야
  // 깨진 JSON(400)·너무 큰 본문(413) 같은 해석 단계의 오류 응답에도 이 헤더가 붙는다.
  app.use('/api/school', (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  // 로그인·가입 응답(내 정보, 학교 인증 확인표, 아이디 확인)도 캐시하지 않는다. 같은 이유로 본문 해석보다 앞에 둔다.
  app.use('/api/auth', (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  app.use(express.json());
  app.use(cookieParser());

  // 첫 요청에서 스키마 준비가 끝나기를 기다린다. (이후 요청은 캐시된 Promise를 즉시 통과)
  app.use('/api', (_req, res, next) => {
    ready().then(() => next(), next);
  });

  app.use('/api/auth', authRouter);
  app.use('/api/timetable', timetableRouter);
  app.use('/api/meetings', meetingsRouter);
  app.use('/api/facilities', facilitiesRouter);
  app.use('/api/reservations', reservationsRouter);
  app.use('/api/courses', coursesRouter);
  app.use('/api/dashboard', dashboardRouter);
  app.use('/api/notices', noticesRouter);
  app.use('/api/health', healthRouter);
  app.use('/api/lounge', loungeRouter);
  // 학교 계정 정보가 오가는 경로: 로그인 필수 (no-store 는 위에서 본문 해석보다 먼저 건다).
  app.use('/api/school', requireAuth, schoolRouter);

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: '요청한 API를 찾을 수 없습니다.' });
  });

  // 단일 서버로 운영할 때(로컬 프로덕션, Fly.io)는 빌드된 클라이언트도 함께 서빙한다.
  // Vercel/Netlify에서는 정적 파일을 플랫폼이 직접 서빙하므로 이 블록은 건너뛴다.
  const distDir = path.join(process.cwd(), 'client', 'dist');
  if (fs.existsSync(distDir)) {
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.use(errorHandler);
  return app;
}
