import { Router } from 'express';
import { all, get, run, insert } from './db.js';
import { requireAuth, userId, wrap } from './auth.js';
import { parseMemberIds } from './meetings.js';
import { parseDateStrict, todayStr, nowMinutes, weekdayOf, addDaysStr } from './dates.js';
import { getCampusBusy, CAMPUS_SYSTEMS } from './campusSchedule.js';
import {
  OPEN_MIN,
  RESERVE_CLOSE_MIN,
  STEP_MIN,
  MAX_RESERVATION_MIN,
  MAX_DAYS_AHEAD,
} from './constants.js';

// 학교 예약 현황 조회에 쓸 최대 시간. 넘으면 이 확인만 건너뛴다. (학교 서버가 느릴 때가 있다)
const BUSY_CHECK_BUDGET_MS = 6_000;

// 회의당 동시에 유지할 수 있는 예약 계획 수
const MAX_ACTIVE_PER_MEETING = 10;

const RESERVATION_SELECT = `
  SELECT r.id, r.date, r.start_min AS "startMin", r.end_min AS "endMin",
         r.facility_id AS "facilityId", f.name AS "facilityName", f.building,
         r.meeting_id AS "meetingId", m.name AS "meetingName",
         r.user_id AS "userId", u.name AS "userName",
         r.school_status AS "schoolStatus",
         f.system_key AS "systemKey", f.campus_name AS "campusName"
  FROM reservations r
  JOIN facilities f ON f.id = r.facility_id
  JOIN meetings m ON m.id = r.meeting_id
  JOIN users u ON u.id = r.user_id
`;

/** 각 예약에 학교 예약 페이지 링크와 시스템 이름을 붙여 준다. */
function decorate(row: Record<string, unknown>) {
  const system = CAMPUS_SYSTEMS.find((s) => s.key === row.systemKey);
  return {
    ...row,
    // 아직 학교에서 확인되지 않은 계획은 'planned', 학교 현황에서 확인되면 'confirmed'.
    schoolStatus: row.schoolStatus === 'confirmed' ? 'confirmed' : 'planned',
    reserveUrl: system?.reserveUrl ?? null,
    systemLabel: system?.label ?? null,
    contact: system?.contact ?? null,
  };
}

/**
 * 학교 공개 예약 현황에서, 이 예약의 시간 전체가 '예약됨'으로 덮여 있으면 true.
 * 학교는 누가 예약했는지 알려 주지 않으므로 '그 시간이 학교에 잡혀 있다'까지만 확인한다.
 */
function coveredBySchool(
  blocks: Awaited<ReturnType<typeof getCampusBusy>>,
  systemKey: string,
  campusName: string,
  date: string,
  startMin: number,
  endMin: number,
): boolean {
  if (!blocks) return false;
  const mine = blocks.filter(
    (b) => b.reason === 'reserved' && b.systemKey === systemKey && b.campusName === campusName && b.date === date,
  );
  // 30분 칸마다 덮는 블록이 하나라도 있는지 확인한다.
  for (let m = startMin; m < endMin; m += STEP_MIN) {
    if (!mine.some((b) => b.startMin <= m && b.endMin >= m + STEP_MIN)) return false;
  }
  return true;
}

export const reservationsRouter = Router();

reservationsRouter.use(requireAuth);
reservationsRouter.use((_req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

reservationsRouter.post(
  '/',
  wrap(async (req, res) => {
    const { meetingId, facilityId, date, startMin, endMin } = (req.body ?? {}) as Record<
      string,
      unknown
    >;

    if (typeof meetingId !== 'number' || typeof facilityId !== 'number') {
      res.status(400).json({ error: '요청 형식이 올바르지 않습니다.' });
      return;
    }
    const member = await get(
      'SELECT 1 AS x FROM meeting_members WHERE meeting_id = ? AND user_id = ?',
      [meetingId, userId(res)],
    );
    if (!member) {
      res.status(403).json({ error: '이 회의의 멤버만 예약할 수 있습니다.' });
      return;
    }
    const facility = await get<{
      id: number;
      name: string;
      systemKey: string | null;
      campusName: string | null;
      minCapacity: number | null;
      capacity: number | null;
    }>(
      `SELECT id, name, system_key AS "systemKey", campus_name AS "campusName",
              min_capacity AS "minCapacity", capacity
       FROM facilities WHERE id = ?`,
      [facilityId],
    );
    if (!facility) {
      res.status(404).json({ error: '시설을 찾을 수 없습니다.' });
      return;
    }

    // 실제로 참여할 사람만 골라 보낼 수 있다. 보내지 않으면 회의 전원으로 본다.
    const requested = parseMemberIds((req.body as Record<string, unknown>)?.memberIds);
    const memberRows = await all<{ id: number }>(
      'SELECT user_id AS id FROM meeting_members WHERE meeting_id = ?',
      [meetingId],
    );
    const allIds = memberRows.map((r) => r.id);
    const participants = requested ? requested.filter((id) => allIds.includes(id)) : allIds;
    if (participants.length === 0) {
      res.status(400).json({ error: '참여할 팀원을 한 명 이상 선택해 주세요.' });
      return;
    }

    // 학교 규정의 최소·최대 이용 인원을 참여 인원 수로 검증한다.
    const people = participants.length;
    if (facility.minCapacity !== null && people < facility.minCapacity) {
      res.status(400).json({
        error: `${facility.name}은(는) ${facility.minCapacity}명 이상부터 이용할 수 있습니다. 현재 팀원은 ${people}명입니다.`,
      });
      return;
    }
    if (facility.capacity !== null && people > facility.capacity) {
      res.status(400).json({
        error: `${facility.name}의 최대 인원은 ${facility.capacity}명입니다. 현재 팀원은 ${people}명입니다.`,
      });
      return;
    }
    const parsedDate = typeof date === 'string' ? parseDateStrict(date) : null;
    if (typeof date !== 'string' || !parsedDate) {
      res.status(400).json({ error: '날짜 형식이 올바르지 않습니다.' });
      return;
    }
    const today = todayStr();
    if (date < today) {
      res.status(400).json({ error: '지난 날짜에는 예약할 수 없습니다.' });
      return;
    }
    if (date > addDaysStr(today, MAX_DAYS_AHEAD)) {
      res.status(400).json({
        error: `학교 규정상 이용일 ${MAX_DAYS_AHEAD}일 전부터 신청할 수 있습니다.`,
      });
      return;
    }
    const weekday = weekdayOf(parsedDate);
    if (weekday > 4) {
      res.status(400).json({ error: '시설은 평일(월~금)에만 예약할 수 있습니다.' });
      return;
    }
    if (
      typeof startMin !== 'number' ||
      typeof endMin !== 'number' ||
      !Number.isInteger(startMin) ||
      !Number.isInteger(endMin) ||
      startMin % STEP_MIN !== 0 ||
      endMin % STEP_MIN !== 0 ||
      startMin < OPEN_MIN ||
      endMin > RESERVE_CLOSE_MIN ||
      startMin >= endMin
    ) {
      res.status(400).json({ error: '예약 시간은 09:00~22:00 사이에서 30분 단위로 선택해 주세요.' });
      return;
    }
    if (endMin - startMin > MAX_RESERVATION_MIN) {
      res.status(400).json({
        error: `학교 규정상 하루 최대 ${MAX_RESERVATION_MIN / 60}시간까지 이용할 수 있습니다.`,
      });
      return;
    }
    if (date === today && startMin <= nowMinutes()) {
      res.status(400).json({ error: '이미 지난 시간에는 예약할 수 없습니다.' });
      return;
    }

    const activeCount = await get<{ c: number }>(
      'SELECT COUNT(*)::int AS c FROM reservations WHERE meeting_id = ? AND date >= ?',
      [meetingId, today],
    );
    if (activeCount && Number(activeCount.c) >= MAX_ACTIVE_PER_MEETING) {
      res.status(400).json({
        error: `한 회의당 예약은 최대 ${MAX_ACTIVE_PER_MEETING}건까지 유지할 수 있습니다. 기존 예약을 취소한 뒤 다시 시도해 주세요.`,
      });
      return;
    }

    // 참여자 시간표 재검증: 선택한 시간에 수업이 있는 사람이 있으면 거절
    const busyMember = await get<{ name: string }>(
      `SELECT u.name FROM timetable_entries te
       JOIN users u ON u.id = te.user_id
       WHERE te.user_id IN (${participants.map(() => '?').join(',')})
         AND (te.repeat_kind = 'weekly' OR te.date = ?)
         AND te.day = ? AND NOT (te.end_min <= ? OR te.start_min >= ?)
       LIMIT 1`,
      [...participants, date, weekday, startMin, endMin],
    );
    if (busyMember) {
      res.status(409).json({
        error: `선택한 시간에 수업이 있는 팀원(${busyMember.name})이 있습니다. 다른 시간을 선택해 주세요.`,
      });
      return;
    }

    const conflict = await get(
      `SELECT 1 AS x FROM reservations
       WHERE facility_id = ? AND date = ? AND NOT (end_min <= ? OR start_min >= ?)`,
      [facilityId, date, startMin, endMin],
    );
    if (conflict) {
      res
        .status(409)
        .json({ error: '해당 시간에 이미 우리 앱에서 잡아 둔 계획이 있습니다. 다른 시설이나 시간을 선택해 주세요.' });
      return;
    }

    // 학교 시스템에서 이미 찼거나 휴무인 시간대면 헛걸음이 되므로 미리 막는다.
    // 학교가 느리면 이 확인만 건너뛴다. (계획 저장은 그대로 진행)
    if (facility.systemKey && facility.campusName) {
      const campus = await Promise.race([
        getCampusBusy(parsedDate.getFullYear(), parsedDate.getMonth() + 1, [facility.systemKey]),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), BUSY_CHECK_BUDGET_MS)),
      ]);
      const blocked = campus?.find(
        (b) =>
          b.systemKey === facility.systemKey &&
          b.campusName === facility.campusName &&
          b.date === date &&
          !(b.endMin <= startMin || b.startMin >= endMin),
      );
      if (blocked) {
        res.status(409).json({
          error:
            blocked.reason === 'closed'
              ? '학교 시스템에서 해당 시간은 신청 불가(휴무·점검)로 표시되어 있습니다.'
              : '학교 시스템에서 이미 예약된 시간입니다. 다른 시간이나 시설을 선택해 주세요.',
        });
        return;
      }
    }

    const newId = await insert(
      `INSERT INTO reservations (facility_id, meeting_id, user_id, date, start_min, end_min, school_status)
       VALUES (?, ?, ?, ?, ?, ?, 'planned') RETURNING id`,
      [facilityId, meetingId, userId(res), date, startMin, endMin],
    );
    const created = await get<Record<string, unknown>>(`${RESERVATION_SELECT} WHERE r.id = ?`, [newId]);
    res.status(201).json(decorate(created!));
  }),
);

/**
 * 학교 예약이 실제로 잡혔는지 확인한다.
 * 학교 공개 예약 현황에서 이 시간이 '예약됨'으로 덮여 있으면 'confirmed'로 표시한다.
 * (학생이 학교 사이트에서 신청을 마친 뒤 누르는 확인 버튼용)
 */
reservationsRouter.post(
  '/:id/confirm-check',
  wrap(async (req, res) => {
    const id = Number(req.params.id);
    const row = Number.isInteger(id)
      ? await get<{
          meetingId: number;
          date: string;
          startMin: number;
          endMin: number;
          systemKey: string | null;
          campusName: string | null;
        }>(
          `SELECT r.meeting_id AS "meetingId", r.date, r.start_min AS "startMin", r.end_min AS "endMin",
                  f.system_key AS "systemKey", f.campus_name AS "campusName"
           FROM reservations r JOIN facilities f ON f.id = r.facility_id WHERE r.id = ?`,
          [id],
        )
      : undefined;
    if (!row) {
      res.status(404).json({ error: '예약을 찾을 수 없습니다.' });
      return;
    }
    const member = await get(
      'SELECT 1 AS x FROM meeting_members WHERE meeting_id = ? AND user_id = ?',
      [row.meetingId, userId(res)],
    );
    if (!member) {
      res.status(403).json({ error: '이 회의의 멤버만 확인할 수 있습니다.' });
      return;
    }
    if (!row.systemKey || !row.campusName) {
      res.status(422).json({ error: '학교 예약 시스템에 연결되지 않은 시설입니다.' });
      return;
    }
    const parsed = parseDateStrict(row.date);
    const blocks = parsed
      ? await Promise.race([
          getCampusBusy(parsed.getFullYear(), parsed.getMonth() + 1, [row.systemKey]),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), BUSY_CHECK_BUDGET_MS)),
        ])
      : null;
    if (blocks === null) {
      res.status(503).json({ error: '지금은 학교 예약 현황을 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.' });
      return;
    }
    const covered = coveredBySchool(blocks, row.systemKey, row.campusName, row.date, row.startMin, row.endMin);
    if (covered) {
      await run("UPDATE reservations SET school_status = 'confirmed' WHERE id = ?", [id]);
    }
    const updated = await get<Record<string, unknown>>(`${RESERVATION_SELECT} WHERE r.id = ?`, [id]);
    res.json({ confirmed: covered, reservation: decorate(updated!) });
  }),
);

reservationsRouter.get(
  '/mine',
  wrap(async (_req, res) => {
    const rows = await all<Record<string, unknown>>(
      `${RESERVATION_SELECT}
       JOIN meeting_members mm ON mm.meeting_id = r.meeting_id
       WHERE mm.user_id = ? AND r.date >= ?
       ORDER BY r.date, r.start_min`,
      [userId(res), todayStr()],
    );
    res.json(rows.map(decorate));
  }),
);

reservationsRouter.get(
  '/meeting/:id',
  wrap(async (req, res) => {
    const meetingId = Number(req.params.id);
    if (!Number.isInteger(meetingId)) {
      res.status(403).json({ error: '이 회의의 멤버가 아닙니다.' });
      return;
    }
    const member = await get(
      'SELECT 1 AS x FROM meeting_members WHERE meeting_id = ? AND user_id = ?',
      [meetingId, userId(res)],
    );
    if (!member) {
      res.status(403).json({ error: '이 회의의 멤버가 아닙니다.' });
      return;
    }
    const rows = await all<Record<string, unknown>>(
      `${RESERVATION_SELECT} WHERE r.meeting_id = ? ORDER BY r.date, r.start_min`,
      [meetingId],
    );
    res.json(rows.map(decorate));
  }),
);

reservationsRouter.delete(
  '/:id',
  wrap(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(404).json({ error: '예약을 찾을 수 없습니다.' });
      return;
    }
    const row = await get<{ meetingId: number }>(
      'SELECT meeting_id AS "meetingId" FROM reservations WHERE id = ?',
      [id],
    );
    if (!row) {
      res.status(404).json({ error: '예약을 찾을 수 없습니다.' });
      return;
    }
    const member = await get(
      'SELECT 1 AS x FROM meeting_members WHERE meeting_id = ? AND user_id = ?',
      [row.meetingId, userId(res)],
    );
    if (!member) {
      res.status(403).json({ error: '이 회의의 멤버만 예약을 취소할 수 있습니다.' });
      return;
    }
    // 앱에 잡아 둔 계획만 지운다. 학교에 이미 신청했다면 학교 사이트에서 따로 취소해야 한다.
    await run('DELETE FROM reservations WHERE id = ?', [id]);
    res.json({ ok: true });
  }),
);
