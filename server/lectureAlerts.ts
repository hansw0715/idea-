/**
 * 미수강 강의 마감 알림(폰 푸시) — 앱이 닫혀 있어도 출석 인정 마감 6시간 전에 알린다.
 *
 *  - 서버는 e-class 를 혼자 읽을 수 없다(학교 계정은 앱에서만 풀린다). 그래서 앱이 e-class 를 읽을 때마다
 *    아직 안 들은 강의의 마감을 PUT /api/lecture-alerts 로 알려 두고, 서버는 그 목록만 들고 있다.
 *  - 마감 6시간 안으로 들어온 강의는 한 번만 푸시한다(sent_at). 마감이 바뀌면 다시 보낼 수 있다.
 *  - 보내는 때: 어떤 요청이든 들어오면 1분에 한 번 훑는다(sweepSoon). 외부 예약 호출용으로
 *    GET /api/lecture-alerts/sweep 도 있다(CRON_SECRET 이 있을 때만, Authorization: Bearer).
 */
import { Router } from 'express';
import { all, run } from './db.js';
import { requireAuth, userId, wrap } from './auth.js';
import { pushOnly } from './lounge/services/push.js';

export const LECTURE_ALERT_MS = 6 * 3_600_000;
const MAX_ITEMS = 60;
const SWEEP_EVERY_MS = 60_000;

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

/** 마감 6시간 안으로 들어왔는데 아직 안 보낸 강의를 푸시한다 */
export async function sweepLectureAlerts(now = Date.now()): Promise<number> {
  const due = await all<{ userId: number; itemId: string; title: string; course: string; dueAt: string | Date }>(
    `SELECT user_id AS "userId", item_id AS "itemId", title, course, due_at AS "dueAt"
       FROM lecture_alerts
      WHERE sent_at IS NULL AND due_at > ?::timestamptz AND due_at <= ?::timestamptz
      LIMIT 200`,
    [new Date(now).toISOString(), new Date(now + LECTURE_ALERT_MS).toISOString()],
  );
  for (const a of due) {
    // 먼저 보냄으로 표시해 두 서버가 동시에 훑어도 한 번만 간다
    const claimed = await run(`UPDATE lecture_alerts SET sent_at = now() WHERE user_id = ? AND item_id = ? AND sent_at IS NULL`, [a.userId, a.itemId]);
    if (claimed.changes !== 1) continue;
    const h = Math.max(1, Math.ceil((new Date(a.dueAt).getTime() - now) / 3_600_000));
    await pushOnly(String(a.userId), {
      title: `미수강 강의 · ${a.title}`,
      body: `${a.course} · 마감 ${h}시간 전`,
      url: '/campus?tab=learning&kind=lecture',
      tag: `lecture-due:${a.itemId}`,
    });
  }
  // 마감이 하루 넘게 지난 줄은 치운다
  await run(`DELETE FROM lecture_alerts WHERE due_at < ?::timestamptz`, [new Date(now - 86_400_000).toISOString()]);
  return due.length;
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

/** 외부 예약 호출(크론)용. CRON_SECRET 이 없으면 꺼져 있다 */
lectureAlertsRouter.get(
  '/sweep',
  wrap(async (req, res) => {
    const secret = process.env.CRON_SECRET?.trim();
    if (!secret || req.get('authorization') !== `Bearer ${secret}`) {
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
      // 마감이 바뀌면 다시 알릴 수 있게 sent_at 을 비운다
      await run(
        `INSERT INTO lecture_alerts (user_id, item_id, title, course, due_at)
         VALUES (?, ?, ?, ?, ?::timestamptz)
         ON CONFLICT (user_id, item_id) DO UPDATE SET
           title = EXCLUDED.title,
           course = EXCLUDED.course,
           sent_at = CASE WHEN lecture_alerts.due_at = EXCLUDED.due_at THEN lecture_alerts.sent_at ELSE NULL END,
           due_at = EXCLUDED.due_at`,
        [uid, i.id, i.title, i.course, i.dueAt],
      );
    }
    sweepSoon();
    res.json({ ok: true });
  }),
);
