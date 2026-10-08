import { Router } from 'express';
import { all, get, run, insert } from './db.js';
import { requireAuth, userId, wrap } from './auth.js';
import { OPEN_MIN, CLOSE_MIN, STEP_MIN, DAY_COUNT } from './constants.js';
import { parseDateStrict, resolveWeekStart, weekEndOf, weekdayOf } from './dates.js';

export const timetableRouter = Router();

timetableRouter.use(requireAuth);

export const ENTRY_COLUMNS =
  'id, day, start_min AS "startMin", end_min AS "endMin", title, place, ' +
  'repeat_kind AS "repeatKind", date';

/**
 * 한 주에 보일 일정만 고르는 조건.
 * 매주 반복은 항상 포함하고, 특정 날짜 일정은 그 주에 속할 때만 포함한다.
 * 호출하는 쪽에서 [weekStart, weekEnd] 두 값을 파라미터에 이어 붙여야 한다.
 */
export const WEEK_FILTER = `(repeat_kind = 'weekly' OR (date >= ? AND date <= ?))`;

timetableRouter.get(
  '/',
  wrap(async (req, res) => {
    const weekStart = resolveWeekStart(req.query.week);
    const rows = await all(
      `SELECT ${ENTRY_COLUMNS} FROM timetable_entries
        WHERE user_id = ? AND ${WEEK_FILTER}
        ORDER BY day, start_min`,
      [userId(res), weekStart, weekEndOf(weekStart)],
    );
    res.json(rows);
  }),
);

/** 분 단위 정수를 'HH:MM' 으로 */
function fmtHm(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
}

function isValidSlotTime(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value % STEP_MIN === 0 &&
    value >= OPEN_MIN &&
    value <= CLOSE_MIN
  );
}

timetableRouter.post(
  '/',
  wrap(async (req, res) => {
    const { startMin, endMin, title, place, repeatKind, date } = (req.body ?? {}) as Record<
      string,
      unknown
    >;

    // 'once' 는 날짜가 요일을 정하고, 'weekly' 는 요일을 직접 받는다.
    const once = repeatKind === 'once';
    let day: number;
    let entryDate: string | null = null;

    if (once) {
      const parsed = typeof date === 'string' ? parseDateStrict(date.trim()) : null;
      if (!parsed) {
        res.status(400).json({ error: '날짜를 올바르게 선택해 주세요.' });
        return;
      }
      day = weekdayOf(parsed);
      if (day >= DAY_COUNT) {
        res.status(400).json({ error: '주말은 시간표에 넣을 수 없습니다.' });
        return;
      }
      entryDate = date as string;
    } else {
      const raw = (req.body as Record<string, unknown>)?.day;
      if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 0 || raw >= DAY_COUNT) {
        res.status(400).json({ error: '요일은 월요일부터 금요일까지 선택할 수 있습니다.' });
        return;
      }
      day = raw;
    }

    if (!isValidSlotTime(startMin) || !isValidSlotTime(endMin) || startMin >= endMin) {
      res.status(400).json({
        error: `시간은 ${fmtHm(OPEN_MIN)}~${fmtHm(CLOSE_MIN)} 사이에서 30분 단위로, 종료가 시작보다 늦어야 합니다.`,
      });
      return;
    }
    if (typeof title !== 'string' || title.trim().length < 1 || title.trim().length > 30) {
      res.status(400).json({ error: '일정 이름은 1자 이상 30자 이하로 입력해 주세요.' });
      return;
    }
    const placeText = typeof place === 'string' ? place.trim().slice(0, 30) : '';

    // 겹침 판정: 매주 반복은 모든 주에 걸리므로 한쪽이라도 'weekly' 면 같은 요일끼리 겹친다.
    // 둘 다 특정 날짜면 날짜가 같을 때만 겹친다.
    const overlap = await get<{ c: number }>(
      `SELECT COUNT(*)::int AS c FROM timetable_entries
        WHERE user_id = ? AND day = ?
          AND NOT (end_min <= ? OR start_min >= ?)
          AND (? = 'weekly' OR repeat_kind = 'weekly' OR date = ?)`,
      [userId(res), day, startMin, endMin, once ? 'once' : 'weekly', entryDate],
    );
    if (overlap && Number(overlap.c) > 0) {
      res.status(409).json({ error: '해당 시간에 이미 다른 일정이 있습니다.' });
      return;
    }

    const id = await insert(
      `INSERT INTO timetable_entries
         (user_id, day, start_min, end_min, title, place, repeat_kind, date)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
      [
        userId(res),
        day,
        startMin,
        endMin,
        title.trim(),
        placeText,
        once ? 'once' : 'weekly',
        entryDate,
      ],
    );
    res.status(201).json({
      id,
      day,
      startMin,
      endMin,
      title: title.trim(),
      place: placeText,
      repeatKind: once ? 'once' : 'weekly',
      date: entryDate,
    });
  }),
);

timetableRouter.delete(
  '/:id',
  wrap(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(404).json({ error: '해당 일정을 찾을 수 없습니다.' });
      return;
    }
    const info = await run('DELETE FROM timetable_entries WHERE id = ? AND user_id = ?', [
      id,
      userId(res),
    ]);
    if (info.changes === 0) {
      res.status(404).json({ error: '해당 일정을 찾을 수 없습니다.' });
      return;
    }
    res.json({ ok: true });
  }),
);
