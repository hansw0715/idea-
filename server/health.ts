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

/** 메일 점검 결과를 이만큼 재사용한다 — 로그인 없이 부를 수 있으므로 요청마다 메일 서버에 로그인하지 않는다 */
export const MAIL_CHECK_CACHE_MS = 5 * 60 * 1000;
let mailCheck: { at: number; result: Promise<{ configured: boolean; ok: boolean }> } | null = null;

/** 시험용: 캐시를 비운다 */
export function resetMailCheckCache(): void {
  mailCheck = null;
}

/**
 * 메일 발송 설정이 살아 있는지 확인한다. (실제로 보내지는 않는다)
 * 로그인 없이 열린 주소이므로 메일 서버의 오류 문구·코드는 응답에 넣지 않고 서버 로그에만 남긴다.
 */
healthRouter.get(
  '/mail',
  wrap(async (_req, res) => {
    const now = Date.now();
    if (!mailCheck || now - mailCheck.at > MAIL_CHECK_CACHE_MS) {
      mailCheck = {
        at: now,
        result: verifyMailConnection().then((r) => {
          if (r.configured && !r.ok) console.warn('[health] 메일 서버 점검 실패:', 'code' in r ? r.code : undefined);
          return { configured: r.configured, ok: r.ok };
        }),
      };
    }
    res.json(await mailCheck.result);
  }),
);
