import { Router } from 'express';
import { get } from './db.js';
import { requireAuth, userId, wrap } from './auth.js';
import { todayStr, resolveWeekStart, weekEndOf } from './dates.js';

export const dashboardRouter = Router();

dashboardRouter.use(requireAuth);

/**
 * 화면 하나를 그리는 데 필요한 데이터를 한 번에 돌려준다.
 * 서버리스에서는 요청 왕복 비용이 커서, 네 번 부르는 것보다 한 번에 받는 편이 훨씬 빠르다.
 */
dashboardRouter.get(
  '/',
  wrap(async (req, res) => {
    const uid = userId(res);
    const today = todayStr();
    // 시간표 격자는 '보고 있는 주'를, 목록은 '앞으로 다가올 예약'을 보여 준다.
    const weekStart = resolveWeekStart(req.query.week);
    const weekEnd = weekEndOf(weekStart);

    // 네 덩어리를 각각 질의하면 왕복이 네 번 든다. Postgres가 한 번에 묶어 주도록
    // JSON으로 합쳐 한 번의 왕복으로 끝낸다.
    const row = await get<{
      user: { id: number; email: string; name: string; isAdmin: boolean } | null;
      timetable: unknown[];
      meetings: unknown[];
      reservations: unknown[];
      weekReservations: unknown[];
    }>(
      `SELECT
         (SELECT to_jsonb(u) FROM (
            SELECT id, email, name, is_admin AS "isAdmin" FROM users WHERE id = ?
          ) u) AS "user",

         (SELECT coalesce(jsonb_agg(t ORDER BY t.day, t."startMin"), '[]'::jsonb) FROM (
            SELECT id, day, start_min AS "startMin", end_min AS "endMin", title, place,
                   repeat_kind AS "repeatKind", date
            FROM timetable_entries
            WHERE user_id = ?
              AND (repeat_kind = 'weekly' OR (date >= ? AND date <= ?))
          ) t) AS timetable,

         (SELECT coalesce(jsonb_agg(m ORDER BY m."createdAt" DESC), '[]'::jsonb) FROM (
            SELECT mt.id, mt.name, mt.code, mt.owner_id AS "ownerId",
                   mt.created_at AS "createdAt",
                   (SELECT COUNT(*) FROM meeting_members mm2
                     WHERE mm2.meeting_id = mt.id)::int AS "memberCount"
            FROM meetings mt
            JOIN meeting_members mm ON mm.meeting_id = mt.id
            WHERE mm.user_id = ?
          ) m) AS meetings,

         (SELECT coalesce(jsonb_agg(r ORDER BY r.date, r."startMin"), '[]'::jsonb) FROM (
            SELECT rv.id, rv.date, rv.start_min AS "startMin", rv.end_min AS "endMin",
                   rv.facility_id AS "facilityId", f.name AS "facilityName", f.building,
                   rv.meeting_id AS "meetingId", mt.name AS "meetingName",
                   rv.user_id AS "userId", u2.name AS "userName"
            FROM reservations rv
            JOIN facilities f ON f.id = rv.facility_id
            JOIN meetings mt ON mt.id = rv.meeting_id
            JOIN users u2 ON u2.id = rv.user_id
            JOIN meeting_members mm ON mm.meeting_id = rv.meeting_id
            WHERE mm.user_id = ? AND rv.date >= ?
          ) r) AS reservations,

         (SELECT coalesce(jsonb_agg(w ORDER BY w.date, w."startMin"), '[]'::jsonb) FROM (
            SELECT rv.id, rv.date, rv.start_min AS "startMin", rv.end_min AS "endMin",
                   rv.facility_id AS "facilityId", f.name AS "facilityName", f.building,
                   rv.meeting_id AS "meetingId", mt.name AS "meetingName",
                   rv.user_id AS "userId", u2.name AS "userName"
            FROM reservations rv
            JOIN facilities f ON f.id = rv.facility_id
            JOIN meetings mt ON mt.id = rv.meeting_id
            JOIN users u2 ON u2.id = rv.user_id
            JOIN meeting_members mm ON mm.meeting_id = rv.meeting_id
            WHERE mm.user_id = ? AND rv.date >= ? AND rv.date <= ?
          ) w) AS "weekReservations"`,
      [uid, uid, weekStart, weekEnd, uid, uid, today, uid, weekStart, weekEnd],
    );

    if (!row || !row.user) {
      res.status(401).json({ error: '로그인이 필요합니다.' });
      return;
    }
    res.json({
      user: row.user,
      timetable: row.timetable ?? [],
      meetings: row.meetings ?? [],
      reservations: row.reservations ?? [],
      weekReservations: row.weekReservations ?? [],
      weekStart,
    });
  }),
);
