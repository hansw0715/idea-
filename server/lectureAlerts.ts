/**
 * 미수강 강의 마감 알림(폰 푸시) — 앱이 닫혀 있어도 출석 인정 마감 30시간 전과 6시간 전, 두 번 알린다.
 *
 *  - 서버는 e-class 를 혼자 읽을 수 없다(학교 계정은 앱에서만 풀린다). 그래서 앱이 e-class 를 읽을 때마다
 *    아직 안 들은 강의의 마감을 PUT /api/lecture-alerts 로 알려 두고, 서버는 그 목록만 들고 있다.
 *  - 마감 30시간 안으로 들어오면 한 번(sent_30h_at), 6시간 안으로 들어오면 또 한 번(sent_at) 푸시한다.
 *    처음 알게 된 때가 이미 6시간 안이면 6시간 알림만 간다. 마감이 바뀌면 둘 다 다시 보낼 수 있다.
 *  - 보내는 시각은 정각으로 올린다: 11월 4일 23:59 마감이면 11월 3일 18:00, 11월 4일 18:00 에 간다.
 *  - 보내는 때: 어떤 요청이든 들어오면 1분에 한 번 훑는다(sweepSoon). 아무도 앱을 안 쓰는 때를 위해
 *    Supabase 예약 실행(pg_cron + pg_net)이 매시 정각 GET /api/lecture-alerts/sweep 을 부른다(Authorization: Bearer).
 *    이 예약은 운영 배포가 처음 요청을 받을 때 스스로 등록한다(ensureSweepSchedule).
 */
import crypto from 'node:crypto';
import { Router } from 'express';
import { all, run } from './db.js';
import { adminLoginUsernames, requireAuth, userId, wrap } from './auth.js';
import { pushOnly } from './lounge/services/push.js';

export const LECTURE_ALERT_MS = 6 * 3_600_000;
export const LECTURE_ALERT_FIRST_MS = 30 * 3_600_000;
const MAX_ITEMS = 60;
const SWEEP_EVERY_MS = 60_000;
const HOUR_MS = 3_600_000;
/** 지금 시각을 정각으로 내린다. 마감 - N시간을 정각으로 올린 때가 지났는지 = 마감 - N시간 <= 지금(정각 내림) */
const floorHour = (t: number) => Math.floor(t / HOUR_MS) * HOUR_MS;

type Input = { id: string; title: string; course: string; dueAt: string };

function parseItems(raw: unknown): Input[] | null {
  const list = (raw as { items?: unknown } | null)?.items;
  if (!Array.isArray(list) || list.length > MAX_ITEMS) return null;
  const out: Input[] = [];
  for (const v of list) {
    const o = v as Record<string, unknown>;
    if (typeof o?.id !== 'string' || typeof o.title !== 'string' || typeof o.course !== 'string' || typeof o.dueAt !== 'string') return null;
    if (!o.id || o.id.length > 200 || !Number.isFinite(Date.parse(o.dueAt))) return null;
    out.push({ id: o.id, title: o.title.slice(0, 120), course: o.course.slice(0, 120), dueAt: new Date(o.dueAt).toISOString() });
  }
  return out;
}

export const lectureAlertsRouter = Router();

type DueRow = { userId: number; itemId: string; title: string; course: string; dueAt: string | Date };

/** 알림 한 단계: 마감이 (정각+fromMs, 정각+toMs] 안이고 column 이 비어 있는 강의를 푸시한다 (fromMs 0 이면 아직 안 지난 것) */
async function sweepStage(now: number, column: 'sent_at' | 'sent_30h_at', fromMs: number, toMs: number): Promise<number> {
  // 30시간 알림은 6시간 알림을 이미 보낸 강의에는 보내지 않는다
  const extra = column === 'sent_30h_at' ? ' AND sent_at IS NULL' : '';
  const due = await all<DueRow>(
    `SELECT user_id AS "userId", item_id AS "itemId", title, course, due_at AS "dueAt"
       FROM lecture_alerts
      WHERE ${column} IS NULL${extra} AND due_at > ?::timestamptz AND due_at <= ?::timestamptz
      LIMIT 200`,
    [new Date(fromMs === 0 ? now : floorHour(now) + fromMs).toISOString(), new Date(floorHour(now) + toMs).toISOString()],
  );
  for (const a of due) {
    // 먼저 보냄으로 표시해 두 서버가 동시에 훑어도 한 번만 간다
    const claimed = await run(`UPDATE lecture_alerts SET ${column} = now() WHERE user_id = ? AND item_id = ? AND ${column} IS NULL`, [a.userId, a.itemId]);
    if (claimed.changes !== 1) continue;
    const h = Math.max(1, Math.ceil((new Date(a.dueAt).getTime() - now) / 3_600_000));
    await pushOnly(String(a.userId), {
      title: `미수강 강의 · ${a.title}`,
      body: `${a.course} · 마감 ${h}시간 전`,
      url: '/campus?tab=learning&kind=lecture',
      tag: `lecture-due:${a.itemId}`,
    });
  }
  return due.length;
}

/** 마감 30시간 전·6시간 전 알림을 아직 안 보낸 강의를 푸시한다 */
export async function sweepLectureAlerts(now = Date.now()): Promise<number> {
  const sent = (await sweepStage(now, 'sent_at', 0, LECTURE_ALERT_MS))
    + (await sweepStage(now, 'sent_30h_at', LECTURE_ALERT_MS, LECTURE_ALERT_FIRST_MS));
  // 마감이 하루 넘게 지난 줄은 치운다
  await run(`DELETE FROM lecture_alerts WHERE due_at < ?::timestamptz`, [new Date(now - 86_400_000).toISOString()]);
  return sent;
}

let lastSweep = 0;
let sweeping: Promise<unknown> | null = null;
/** 요청이 들어올 때마다 부른다. 1분에 한 번만 실제로 훑고, 요청은 기다리게 하지 않는다 */
export function sweepSoon(): void {
  const now = Date.now();
  if (sweeping || now - lastSweep < SWEEP_EVERY_MS) return;
  lastSweep = now;
  sweeping = sweepLectureAlerts(now)
    .catch(() => undefined)
    .finally(() => {
      sweeping = null;
    });
}

/** 예약 호출용 비밀값: CRON_SECRET, 없으면 JWT_SECRET 에서 만든다. 둘 다 없으면 '' (꺼짐) */
function cronSecret(): string {
  const explicit = process.env.CRON_SECRET?.trim();
  if (explicit) return explicit;
  const jwt = process.env.JWT_SECRET?.trim();
  return jwt ? crypto.createHmac('sha256', jwt).update('lecture-alerts-sweep').digest('hex') : '';
}

/** Supabase 예약(pg_cron) 목록: 이름, 일정(UTC), 부를 주소 */
const JOBS = [
  { name: 'lecture-alerts-sweep', schedule: '0 * * * *', path: '/api/lecture-alerts/sweep' },
  // 실험용: 매일 13:55(한국 시간 = 04:55 UTC)에 관리자에게 "테스트" 알림
  { name: 'lecture-alerts-test-push', schedule: '55 4 * * *', path: '/api/lecture-alerts/test-push' },
  // 실험용: 11월 3일 14:05(05:05 UTC) 한 번 더 — 날짜를 박아 두어 다른 날에는 돌지 않는다
  { name: 'lecture-alerts-test-push-1405', schedule: '5 5 3 11 *', path: '/api/lecture-alerts/test-push' },
];
let scheduleChecked = false;
/**
 * Supabase 에 예약(pg_cron + pg_net)을 둔다. 운영 배포(Vercel production)에서만,
 * 인스턴스마다 한 번 확인하고 내용이 같으면 건드리지 않는다. 실패해도 앱은 그대로 동작한다(요청 때 훑기는 남는다).
 */
export async function ensureSweepSchedule(): Promise<void> {
  if (scheduleChecked) return;
  scheduleChecked = true;
  if (process.env.VERCEL_ENV !== 'production' || !process.env.DATABASE_URL) return;
  const host = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim() || 'sangsang-booke.vercel.app';
  const secret = cronSecret();
  if (!/^[a-z0-9.-]+$/i.test(host) || !/^[\w.~+/=-]+$/.test(secret)) {
    console.warn('[lecture-alerts] 예약을 건너뛰었어요: 주소나 비밀값이 없어요.');
    return;
  }
  try {
    const existing = await all<{ jobname: string; schedule: string; command: string }>(`SELECT jobname, schedule, command FROM cron.job`).catch(() => []);
    let extensions = false;
    for (const job of JOBS) {
      const command = `select net.http_get(url := 'https://${host}${job.path}', headers := jsonb_build_object('Authorization', 'Bearer ${secret}'), timeout_milliseconds := 30000)`;
      if (existing.some((e) => e.jobname === job.name && e.schedule === job.schedule && e.command === command)) {
        console.info(`[lecture-alerts] 예약이 이미 있어요: ${job.name}`);
        continue;
      }
      if (!extensions) {
        await run('CREATE EXTENSION IF NOT EXISTS pg_cron');
        await run('CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions');
        extensions = true;
      }
      await run(`SELECT cron.schedule(?, ?, ?)`, [job.name, job.schedule, command]);
      console.info(`[lecture-alerts] 예약을 등록했어요: ${job.name} (${job.schedule} UTC)`);
    }
  } catch (err) {
    console.warn('[lecture-alerts] 알림 예약을 등록하지 못했어요:', err instanceof Error ? err.message : err);
  }
}

const cronAuthorized = (authorization: string | undefined) => {
  const secret = cronSecret();
  return !!secret && authorization === `Bearer ${secret}`;
};

/** 실험용 예약 호출: 관리자에게 "테스트" 푸시를 보낸다 */
lectureAlertsRouter.get(
  '/test-push',
  wrap(async (req, res) => {
    if (!cronAuthorized(req.get('authorization'))) {
      res.status(404).json({ error: '찾을 수 없습니다.' });
      return;
    }
    // 관리자 로그인(dedea715 등)은 DB 계정이 없는 세션이라, 같은 아이디의 학생 계정과 is_admin 계정에 보낸다
    const admins = await all<{ id: number }>(`SELECT id FROM users WHERE is_admin = TRUE OR username = ANY(?::text[])`, [adminLoginUsernames()]);
    for (const a of admins) await pushOnly(String(a.id), { title: '테스트', body: '예약 알림 실험이에요.', url: '/', tag: 'cron-test' });
    console.info(`[lecture-alerts] 테스트 알림을 관리자 ${admins.length}명에게 보냈어요.`);
    res.json({ sent: admins.length });
  }),
);

/** 예약 호출(크론)용. 비밀값이 없으면 꺼져 있다 */
lectureAlertsRouter.get(
  '/sweep',
  wrap(async (req, res) => {
    if (!cronAuthorized(req.get('authorization'))) {
      res.status(404).json({ error: '찾을 수 없습니다.' });
      return;
    }
    res.json({ sent: await sweepLectureAlerts() });
  }),
);

/** 앱이 e-class 를 읽을 때마다 아직 안 들은 강의 마감 목록을 통째로 보낸다 (목록에서 빠진 강의 = 들었거나 사라짐) */
lectureAlertsRouter.put(
  '/',
  requireAuth,
  wrap(async (req, res) => {
    const items = parseItems(req.body);
    if (!items) {
      res.status(400).json({ error: '강의 목록이 올바르지 않습니다.' });
      return;
    }
    const uid = userId(res);
    const ids = items.map((i) => i.id);
    await run(`DELETE FROM lecture_alerts WHERE user_id = ? AND NOT (item_id = ANY(?::text[]))`, [uid, ids]);
    for (const i of items) {
      // 마감이 바뀌면 다시 알릴 수 있게 sent_at·sent_30h_at 을 비운다
      await run(
        `INSERT INTO lecture_alerts (user_id, item_id, title, course, due_at)
         VALUES (?, ?, ?, ?, ?::timestamptz)
         ON CONFLICT (user_id, item_id) DO UPDATE SET
           title = EXCLUDED.title,
           course = EXCLUDED.course,
           sent_at = CASE WHEN lecture_alerts.due_at = EXCLUDED.due_at THEN lecture_alerts.sent_at ELSE NULL END,
           sent_30h_at = CASE WHEN lecture_alerts.due_at = EXCLUDED.due_at THEN lecture_alerts.sent_30h_at ELSE NULL END,
           due_at = EXCLUDED.due_at`,
        [uid, i.id, i.title, i.course, i.dueAt],
      );
    }
    sweepSoon();
    res.json({ ok: true });
  }),
);
