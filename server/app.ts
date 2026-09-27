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
import { healthRouter } from './health.js';

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

export function createApp() {
  const app = express();

  // 리버스 프록시(Fly.io / Vercel / Netlify) 뒤에 놓이므로 X-Forwarded-* 를 신뢰해야
  // secure 쿠키와 req.ip(레이트리밋 키)가 올바르게 동작한다.
  app.set('trust proxy', 1);

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
  app.use('/api/health', healthRouter);

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

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    console.error(err);
    if (isDbConnectionError(err)) {
      res.status(503).json({
        error:
          '데이터베이스에 연결하지 못했습니다. DATABASE_URL 설정을 확인해 주세요. ' +
          '(Supabase는 Connect 화면의 Transaction pooler 문자열이어야 하고, 비밀번호에 특수문자가 있으면 URL 인코딩이 필요합니다)',
      });
      return;
    }
    res.status(500).json({ error: '서버 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.' });
  });

  return app;
}
