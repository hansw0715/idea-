import { Router } from 'express';
import type { Response } from 'express';
import crypto from 'node:crypto';
import { all, get, run, insert } from './db.js';
import { requireAuth, userId, wrap } from './auth.js';
import { createRateLimiter } from './rateLimit.js';
import { freeWithin } from './freeTime.js';
import type { Interval } from './freeTime.js';
import { OPEN_MIN, CLOSE_MIN, RESERVE_CLOSE_MIN, STEP_MIN, DAY_COUNT } from './constants.js';
import { resolveWeekStart, weekEndOf } from './dates.js';

export const meetingsRouter = Router();

meetingsRouter.use(requireAuth);

// 숫자 4자리 코드. 앞자리 0도 유지되도록 문자열로 다룬다.
const CODE_LENGTH = 4;
const CODE_CHARS = '0123456789';

function generateCode(): string {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CODE_CHARS[crypto.randomInt(CODE_CHARS.length)];
  }
  return code;
}

/** 사용 중이지 않은 코드를 찾는다. 경우의 수가 1만 개뿐이라 시도 횟수를 제한한다. */
async function findUnusedCode(): Promise<string | null> {
  for (let attempt = 0; attempt < 50; attempt++) {
    const candidate = generateCode();
    const taken = await get('SELECT 1 AS x FROM meetings WHERE code = ?', [candidate]);
    if (!taken) return candidate;
  }
  return null;
}

interface MeetingRow {
  id: number;
  name: string;
  code: string;
  ownerId: number;
  createdAt: string;
}

const MEETING_SELECT =
  'SELECT id, name, code, owner_id AS "ownerId", created_at AS "createdAt" FROM meetings';

function getMeeting(id: number): Promise<MeetingRow | undefined> {
  return get<MeetingRow>(`${MEETING_SELECT} WHERE id = ?`, [id]);
}

async function isMember(meetingId: number, uid: number): Promise<boolean> {
  const row = await get('SELECT 1 AS x FROM meeting_members WHERE meeting_id = ? AND user_id = ?', [
    meetingId,
    uid,
  ]);
  return row !== undefined;
}

/** 회의 존재/멤버십을 확인하고, 문제가 있으면 응답을 보내고 undefined를 돌려준다. */
async function requireMemberMeeting(
  idParam: string,
  res: Response,
): Promise<MeetingRow | undefined> {
  const id = Number(idParam);
  const meeting = Number.isInteger(id) ? await getMeeting(id) : undefined;
  if (!meeting) {
    res.status(404).json({ error: '회의를 찾을 수 없습니다.' });
    return undefined;
  }
  if (!(await isMember(meeting.id, userId(res)))) {
    res.status(403).json({ error: '이 회의의 멤버가 아닙니다. 회의 코드로 먼저 참가해 주세요.' });
    return undefined;
  }
  return meeting;
}

meetingsRouter.post(
  '/',
  wrap(async (req, res) => {
    const { name } = (req.body ?? {}) as Record<string, unknown>;
    if (typeof name !== 'string' || name.trim().length < 1 || name.trim().length > 30) {
      res.status(400).json({ error: '회의 이름은 1자 이상 30자 이하로 입력해 주세요.' });
      return;
    }
    const code = await findUnusedCode();
    if (!code) {
      res.status(503).json({
        error: '지금은 사용 가능한 회의 코드를 찾지 못했습니다. 잠시 후 다시 시도해 주세요.',
      });
      return;
    }
    const meetingId = await insert(
      'INSERT INTO meetings (name, code, owner_id) VALUES (?, ?, ?) RETURNING id',
      [name.trim(), code, userId(res)],
    );
    await run('INSERT INTO meeting_members (meeting_id, user_id) VALUES (?, ?)', [
      meetingId,
      userId(res),
    ]);
    res.status(201).json(await getMeeting(meetingId));
  }),
);

// 회의 코드 무차별 대입 방지.
// 숫자 4자리는 경우의 수가 1만 개뿐이라 6자리 영숫자보다 추측이 쉬우므로 더 좁게 제한한다.
// (실제 사용자는 코드를 몇 번만 입력하므로 불편하지 않다)
const joinLimiter = createRateLimiter(8, 10 * 60 * 1000);

meetingsRouter.post(
  '/join',
  wrap(async (req, res) => {
    const { code } = (req.body ?? {}) as Record<string, unknown>;
    if (typeof code !== 'string' || code.trim().length === 0) {
      res.status(400).json({ error: '회의 코드를 입력해 주세요.' });
      return;
    }
    if (!joinLimiter.hit(String(userId(res)))) {
      res.status(429).json({ error: '참가 시도가 너무 많습니다. 잠시 후 다시 시도해 주세요.' });
      return;
    }
    const meeting = await get<MeetingRow>(`${MEETING_SELECT} WHERE code = ?`, [code.trim()]);
    if (!meeting) {
      res
        .status(404)
        .json({ error: '해당 코드의 회의를 찾을 수 없습니다. 코드를 다시 확인해 주세요.' });
      return;
    }
    // 이미 멤버인 사람이 코드를 넣으면 아무 일도 일어나지 않아 "참가했는데 안 보인다"고
    // 오해하기 쉽다. (특히 방장이 자기 코드를 입력한 경우)
    const already = await isMember(meeting.id, userId(res));
    if (!already) {
      await run('INSERT INTO meeting_members (meeting_id, user_id) VALUES (?, ?)', [
        meeting.id,
        userId(res),
      ]);
    }
    res.json({ ...meeting, alreadyMember: already, isOwner: meeting.ownerId === userId(res) });
  }),
);

meetingsRouter.get(
  '/',
  wrap(async (_req, res) => {
    const rows = await all(
      `SELECT m.id, m.name, m.code, m.owner_id AS "ownerId", m.created_at AS "createdAt",
              (SELECT COUNT(*) FROM meeting_members mm2 WHERE mm2.meeting_id = m.id)::int
                AS "memberCount"
       FROM meetings m
       JOIN meeting_members mm ON mm.meeting_id = m.id
       WHERE mm.user_id = ?
       ORDER BY m.created_at DESC`,
      [userId(res)],
    );
    res.json(rows);
  }),
);

meetingsRouter.get(
  '/:id',
  wrap(async (req, res) => {
    const meeting = await requireMemberMeeting(req.params.id, res);
    if (!meeting) return;
    const members = await all(
      `SELECT u.id, u.name, u.email,
              CASE WHEN u.id = m.owner_id THEN 1 ELSE 0 END AS "isOwner"
       FROM meeting_members mm
       JOIN users u ON u.id = mm.user_id
       JOIN meetings m ON m.id = mm.meeting_id
       WHERE mm.meeting_id = ?
       ORDER BY mm.joined_at`,
      [meeting.id],
    );
    res.json({ ...meeting, members });
  }),
);

meetingsRouter.get(
  '/:id/timetable',
  wrap(async (req, res) => {
    const meeting = await requireMemberMeeting(req.params.id, res);
    if (!meeting) return;
    const weekStart = resolveWeekStart(req.query.week);
    const rows = await all(
      `SELECT te.id, te.user_id AS "memberId", te.day, te.start_min AS "startMin",
              te.end_min AS "endMin", te.title, te.place,
              te.repeat_kind AS "repeatKind", te.date
       FROM timetable_entries te
       JOIN meeting_members mm ON mm.user_id = te.user_id
       WHERE mm.meeting_id = ?
         AND (te.repeat_kind = 'weekly' OR (te.date >= ? AND te.date <= ?))
       ORDER BY te.day, te.start_min`,
      [meeting.id, weekStart, weekEndOf(weekStart)],
    );
    res.json(rows);
  }),
);

/** 'members=3,7' → [3, 7]. 값이 없으면 null(=전원). */
export function parseMemberIds(raw: unknown): number[] | null {
  const text = String(raw ?? '').trim();
  if (!text) return null;
  const ids = text
    .split(',')
    .map((v) => Number(v.trim()))
    .filter((v) => Number.isInteger(v) && v > 0);
  return ids.length > 0 ? [...new Set(ids)] : null;
}

meetingsRouter.get(
  '/:id/free-slots',
  wrap(async (req, res) => {
    const meeting = await requireMemberMeeting(req.params.id, res);
    if (!meeting) return;
    const duration = Number(req.query.duration ?? 60);
    if (!Number.isInteger(duration) || duration < STEP_MIN || duration > CLOSE_MIN - OPEN_MIN) {
      res.status(400).json({ error: '회의 시간이 올바르지 않습니다.' });
      return;
    }

    // 참여할 사람만 골라 계산할 수 있다. (빠진 사람의 수업은 고려하지 않는다)
    const only = parseMemberIds(req.query.members);
    const filter = only ? ` AND te.user_id IN (${only.map(() => '?').join(',')})` : '';
    // 그 주에만 있는 일정도 바쁜 시간으로 쳐야 하므로 보고 있는 주를 함께 받는다.
    const weekStart = resolveWeekStart(req.query.week);
    const rows = await all<{ day: number; start: number; end: number }>(
      `SELECT te.day, te.start_min AS "start", te.end_min AS "end"
       FROM timetable_entries te
       JOIN meeting_members mm ON mm.user_id = te.user_id
       WHERE mm.meeting_id = ?
         AND (te.repeat_kind = 'weekly' OR (te.date >= ? AND te.date <= ?))${filter}`,
      only
        ? [meeting.id, weekStart, weekEndOf(weekStart), ...only]
        : [meeting.id, weekStart, weekEndOf(weekStart)],
    );

    const slots: Array<{ day: number; start: number; end: number }> = [];
    for (let day = 0; day < DAY_COUNT; day++) {
      const busy: Interval[] = rows
        .filter((r) => r.day === day)
        .map((r) => ({ start: r.start, end: r.end }));
      // 여유 시간은 실제로 예약 가능한 시간대(~21시) 안에서만 뽑는다.
      for (const iv of freeWithin(busy, OPEN_MIN, RESERVE_CLOSE_MIN)) {
        if (iv.end - iv.start >= duration) {
          slots.push({ day, start: iv.start, end: iv.end });
        }
      }
    }
    res.json(slots);
  }),
);

meetingsRouter.post(
  '/:id/leave',
  wrap(async (req, res) => {
    const meeting = await requireMemberMeeting(req.params.id, res);
    if (!meeting) return;
    if (meeting.ownerId === userId(res)) {
      res
        .status(400)
        .json({ error: '회의를 만든 사람은 나갈 수 없습니다. 대신 회의를 삭제할 수 있습니다.' });
      return;
    }
    await run('DELETE FROM meeting_members WHERE meeting_id = ? AND user_id = ?', [
      meeting.id,
      userId(res),
    ]);
    res.json({ ok: true });
  }),
);

meetingsRouter.delete(
  '/:id',
  wrap(async (req, res) => {
    const meeting = await requireMemberMeeting(req.params.id, res);
    if (!meeting) return;
    if (meeting.ownerId !== userId(res)) {
      res.status(403).json({ error: '회의를 만든 사람만 삭제할 수 있습니다.' });
      return;
    }
    // 예약·멤버 행은 ON DELETE CASCADE로 함께 정리된다.
    await run('DELETE FROM meetings WHERE id = ?', [meeting.id]);
    res.json({ ok: true });
  }),
);
