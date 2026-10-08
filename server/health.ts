import { Router } from 'express';
import { get } from './db.js';
import { wrap } from './auth.js';
import { verifyMailConnection } from './mailer.js';

export const healthRouter = Router();

/**
 * 실행 위치와 DB 왕복 시간을 확인한다.
 * 어디서 지연이 생기는지(함수 위치 vs DB 거리) 판단하는 데 쓴다.
 */
healthRouter.get(
  '/',
  wrap(async (_req, res) => {
    const started = Date.now();
    let dbMs: number | null = null;
    try {
      await get('SELECT 1 AS ok');
      dbMs = Date.now() - started;
    } catch {
      dbMs = null;
    }
    res.json({
      ok: dbMs !== null,
      // 서버리스 런타임이 알려주는 실행 리전
      region: process.env.AWS_REGION ?? process.env.NETLIFY_REGION ?? null,
      dbRoundTripMs: dbMs,
    });
  }),
);

/** 메일 발송 설정이 살아 있는지 확인한다. (실제로 보내지는 않는다) */
healthRouter.get(
  '/mail',
  wrap(async (_req, res) => {
    res.json(await verifyMailConnection());
  }),
);
