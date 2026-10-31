/**
 * 관리자 도구: 대시보드 숫자, 사용자·모임·회의 목록과 조치, 운영 도구, 관리 기록.
 * 관리자가 코드나 DB 를 직접 만지지 않고 관리자 탭에서 문제를 풀 수 있게 하는 것이 목적이다.
 *
 * 개인정보: 실명·이메일·학과·학번은 내려보내지 않는다 (라운지 닉네임·로그인 아이디·매너온도·경고·정지만).
 * 모든 조치는 lounge_admin_log 에 남겨, 누가 언제 무엇을 했는지 대시보드에서 볼 수 있다.
 */
import { randomUUID } from 'node:crypto';
import { all, get, run } from '../../db.js';
import { fail, ok } from '../../../shared/lounge/types.js';
import type { Result } from '../../../shared/lounge/types.js';
import { DEFAULT_TEMPERATURE, PRESENCE_TTL_SEC } from '../../../shared/lounge/constants.js';
import type { Gathering, GatheringKind } from '../../../shared/lounge/gathering.js';
import type {
  AdminGatheringRow,
  AdminLogEntry,
  AdminMeetingRow,
  AdminOverview,
  AdminTool,
  AdminUserAction,
  AdminUserRow,
} from '../../../shared/lounge/view.js';
import { currentStatus, isFull, memberIds } from '../domain/gathering.js';
import { listAllGatherings, mutateGathering } from '../repo/gatherings.js';
import { insertMessage } from '../repo/messages.js';
import { loadUsers, setBanned, liftBanDb } from '../users.js';
import { pushOnly } from './push.js';
import { sweepLectureAlerts } from '../../lectureAlerts.js';
import { adminStats } from './stats.js';

const DAY = 86_400_000;
const nowISO = () => new Date().toISOString();
const kstDate = (ms: number) => new Date(ms + 9 * 3_600_000).toISOString().slice(0, 10);
const kindLabel = (g: Pick<Gathering, 'kind'>) => ({ meal: '밥약', meetup: '미팅', team: '팀' })[g.kind] ?? g.kind;

// ───────────── 관리 기록 ─────────────

export async function logAdmin(adminId: string, action: string, target: string, detail = ''): Promise<void> {
  const id = Number(adminId);
  await run('INSERT INTO lounge_admin_log (admin_id, action, target, detail) VALUES (?, ?, ?, ?)', [
    Number.isInteger(id) && id > 0 ? id : null,
    action,
    target.slice(0, 200),
    detail.slice(0, 500),
  ]);
}

export async function recentAdminLog(limit = 30): Promise<AdminLogEntry[]> {
  const rows = await all<{ id: number; adminId: number | null; action: string; target: string; detail: string; at: Date | string }>(
    `SELECT id, admin_id AS "adminId", action, target, detail, at FROM lounge_admin_log ORDER BY at DESC, id DESC LIMIT ?`,
    [limit],
  );
  // 관리자 이름: 라운지 닉네임, 없으면 로그인 아이디
  const ids = [...new Set(rows.flatMap((r) => (r.adminId ? [r.adminId] : [])))];
  const names = ids.length
    ? await all<{ id: number; nickname: string | null; username: string | null }>(
        'SELECT id, nickname, username FROM users WHERE id = ANY(?::int[])',
        [ids],
      )
    : [];
  const nameOf = new Map(names.map((n) => [n.id, n.nickname || n.username || '']));
  return rows.map((r) => ({
    id: r.id,
    admin: (r.adminId && nameOf.get(r.adminId)) || '관리자',
    action: r.action,
    target: r.target,
    detail: r.detail,
    at: new Date(r.at).toISOString(),
  }));
}

// ───────────── 대시보드 ─────────────

const KINDS: GatheringKind[] = ['meal', 'meetup', 'team'];

export async function adminOverview(now = Date.now()): Promise<AdminOverview> {
  const since7 = new Date(now - 7 * DAY).toISOString();
  const since14 = new Date(now - 14 * DAY).toISOString();
  const today = kstDate(now);
  // 부가 숫자(알림·매칭·강의 알림)는 하나가 실패해도 대시보드 전체가 깨지지 않게 0 으로 둔다
  const soft = <T,>(p: Promise<T>): Promise<T | undefined> => p.catch(() => undefined);
  const [users, online, reports, meetings, quick, push, lecture, signupRows, gatherings, log, stats] = await Promise.all([
    get<{ total: number; profiled: number; banned: number; warned: number; new7: number; admins: number }>(
      `SELECT COUNT(*)::int AS total,
              (COUNT(*) FILTER (WHERE profile_done))::int AS profiled,
              (COUNT(*) FILTER (WHERE banned))::int AS banned,
              (COUNT(*) FILTER (WHERE warnings > 0 AND NOT banned))::int AS warned,
              (COUNT(*) FILTER (WHERE created_at >= ?::timestamptz))::int AS new7,
              (COUNT(*) FILTER (WHERE is_admin))::int AS admins
         FROM users`,
      [since7],
    ),
    get<{ n: number }>(`SELECT COUNT(*)::int AS n FROM lounge_presence WHERE seen_at > ?::timestamptz`, [
      new Date(now - PRESENCE_TTL_SEC * 1000).toISOString(),
    ]),
    get<{ open: number; week: number }>(
      `SELECT (COUNT(*) FILTER (WHERE status = 'open'))::int AS open,
              (COUNT(*) FILTER (WHERE created_at >= ?::timestamptz))::int AS week
         FROM lounge_reports`,
      [since7],
    ),
    get<{ total: number; new7: number; upcoming: number }>(
      `SELECT (SELECT COUNT(*) FROM meetings)::int AS total,
              (SELECT COUNT(*) FROM meetings WHERE created_at >= ?::timestamptz)::int AS new7,
              (SELECT COUNT(*) FROM reservations WHERE date >= ?)::int AS upcoming`,
      [since7, today],
    ),
    soft(get<{ n: number }>(`SELECT COUNT(*)::int AS n FROM lounge_quick_requests WHERE status = 'waiting'`)),
    soft(
      get<{ n: number; devices: number }>(
        `SELECT COUNT(DISTINCT user_id)::int AS n, COUNT(*)::int AS devices FROM lounge_push_subscriptions`,
      ),
    ),
    soft(
      get<{ pending: number; sent7: number }>(
        `SELECT (COUNT(*) FILTER (WHERE sent_at IS NULL AND due_at > now()))::int AS pending,
                (COUNT(*) FILTER (WHERE sent_at >= ?::timestamptz))::int AS sent7
           FROM lecture_alerts`,
        [since7],
      ),
    ),
    all<{ d: string; n: number }>(
      `SELECT to_char(created_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD') AS d, COUNT(*)::int AS n
         FROM users WHERE created_at >= ?::timestamptz GROUP BY 1`,
      [since14],
    ),
    listAllGatherings(),
    soft(recentAdminLog(8)),
    soft(adminStats()),
  ]);

  const iso = new Date(now).toISOString();
  const byDay = new Map(signupRows.map((r) => [r.d, Number(r.n)]));
  const signups = Array.from({ length: 14 }, (_, i) => {
    const date = kstDate(now - (13 - i) * DAY);
    return { date, count: byDay.get(date) ?? 0 };
  });

  return {
    users: {
      total: Number(users?.total ?? 0),
      profiled: Number(users?.profiled ?? 0),
      banned: Number(users?.banned ?? 0),
      warned: Number(users?.warned ?? 0),
      newThisWeek: Number(users?.new7 ?? 0),
      admins: Number(users?.admins ?? 0),
    },
    onlineNow: Number(online?.n ?? 0),
    reports: { open: Number(reports?.open ?? 0), thisWeek: Number(reports?.week ?? 0) },
    gatherings: KINDS.map((kind) => {
      const list = gatherings.filter((g) => g.kind === kind);
      return {
        kind,
        live: list.filter((g) => ['open', 'full'].includes(currentStatus(g, iso))).length,
        today: list.filter((g) => kstDate(Date.parse(g.meetAt)) === today).length,
        doneThisWeek: list.filter((g) => currentStatus(g, iso) === 'done' && g.meetAt >= since7).length,
      };
    }),
    meetings: {
      total: Number(meetings?.total ?? 0),
      newThisWeek: Number(meetings?.new7 ?? 0),
      upcomingReservations: Number(meetings?.upcoming ?? 0),
    },
    quickWaiting: Number(quick?.n ?? 0),
    push: { users: Number(push?.n ?? 0), devices: Number(push?.devices ?? 0) },
    lectureAlerts: { pending: Number(lecture?.pending ?? 0), sentThisWeek: Number(lecture?.sent7 ?? 0) },
    signups,
    health: {
      averageTemperature: stats?.users.averageTemperature ?? 0,
      noshowRate: stats?.noshow.rate ?? 0,
      noshowConfirmed: stats?.noshow.confirmed ?? 0,
      finishedParticipants: stats?.noshow.participants ?? 0,
    },
    recentLog: log ?? [],
  };
}

// ───────────── 사용자 ─────────────

export type UserFilter = 'all' | 'banned' | 'warned' | 'reported' | 'admin';
export const USER_FILTERS: readonly UserFilter[] = ['all', 'banned', 'warned', 'reported', 'admin'];

export async function adminUsers(q: string, filter: UserFilter): Promise<AdminUserRow[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  const term = q.trim().toLowerCase().slice(0, 40);
  if (term) {
    where.push(`(lower(coalesce(u.username, '')) LIKE ? OR lower(coalesce(u.nickname, '')) LIKE ? OR u.id::text = ?)`);
    params.push(`%${term}%`, `%${term}%`, term);
  }
  if (filter === 'banned') where.push('u.banned');
  if (filter === 'warned') where.push('u.warnings > 0');
  if (filter === 'admin') where.push('u.is_admin');
  if (filter === 'reported') where.push(`EXISTS (SELECT 1 FROM lounge_reports r WHERE r.target_id = u.id AND r.status = 'open')`);
  const rows = await all<{
    id: number;
    username: string | null;
    nickname: string | null;
    temperature: number | null;
    warnings: number | null;
    banned: boolean | null;
    profileDone: boolean | null;
    isAdmin: boolean;
    createdAt: Date | string;
    openReports: number;
    pushDevices: number;
  }>(
    `SELECT u.id, u.username, u.nickname, u.temperature, u.warnings, u.banned, u.profile_done AS "profileDone",
            u.is_admin AS "isAdmin", u.created_at AS "createdAt",
            (SELECT COUNT(*) FROM lounge_reports r WHERE r.target_id = u.id AND r.status = 'open')::int AS "openReports",
            (SELECT COUNT(*) FROM lounge_push_subscriptions p WHERE p.user_id = u.id)::int AS "pushDevices"
       FROM users u
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY u.created_at DESC, u.id DESC
      LIMIT 100`,
    params,
  );
  return rows.map((r) => ({
    id: String(r.id),
    username: r.username ?? '',
    nickname: r.nickname ?? '',
    temperature: r.temperature == null ? DEFAULT_TEMPERATURE : Number(r.temperature),
    warnings: Number(r.warnings ?? 0),
    banned: Boolean(r.banned),
    profileDone: Boolean(r.profileDone),
    isAdmin: Boolean(r.isAdmin),
    createdAt: new Date(r.createdAt).toISOString(),
    openReports: Number(r.openReports),
    pushDevices: Number(r.pushDevices),
  }));
}

const USER_ACTION_LABEL: Record<AdminUserAction, string> = {
  ban: '이용 정지',
  unban: '정지 해제',
  clearWarnings: '경고 초기화',
  resetTemperature: '매너온도 초기화',
  clearPush: '폰 알림 등록 지우기',
  clearPresence: '라운지 접속 지우기',
  closeReports: '남은 신고 닫기',
};
export const USER_ACTIONS = Object.keys(USER_ACTION_LABEL) as AdminUserAction[];

export async function adminUserAction(adminId: string, userId: string, action: AdminUserAction): Promise<Result<true>> {
  const target = await get<{ id: number; username: string | null; nickname: string | null; isAdmin: boolean }>(
    'SELECT id, username, nickname, is_admin AS "isAdmin" FROM users WHERE id = ?',
    [Number(userId)],
  );
  if (!target) return fail('NOT_FOUND', '없는 사용자입니다.');
  if (action === 'ban' && target.isAdmin) return fail('INVALID', '관리자 계정은 정지할 수 없어요.');
  const id = Number(userId);
  switch (action) {
    case 'ban':
      await setBanned(userId, true);
      break;
    case 'unban':
      await liftBanDb(userId);
      break;
    case 'clearWarnings':
      await run('UPDATE users SET warnings = 0 WHERE id = ?', [id]);
      break;
    case 'resetTemperature':
      await run('UPDATE users SET temperature = ? WHERE id = ?', [DEFAULT_TEMPERATURE, id]);
      break;
    case 'clearPush':
      await run('DELETE FROM lounge_push_subscriptions WHERE user_id = ?', [id]);
      break;
    case 'clearPresence':
      await run('DELETE FROM lounge_presence WHERE user_id = ?', [id]);
      break;
    case 'closeReports':
      await run(
        `UPDATE lounge_reports SET status = 'dismissed', handled_at = now(), handled_by = ? WHERE target_id = ? AND status = 'open'`,
        [Number(adminId) || null, id],
      );
      break;
  }
  await logAdmin(adminId, USER_ACTION_LABEL[action], `${target.nickname || '(닉네임 없음)'} · ${target.username ?? ''}`);
  return ok(true);
}

// ───────────── 모임 (밥약·미팅·팀) ─────────────

export type GatheringStatusFilter = 'all' | 'live' | 'done' | 'cancelled';

export async function adminGatherings(kind: GatheringKind | 'all', status: GatheringStatusFilter): Promise<AdminGatheringRow[]> {
  const iso = nowISO();
  const list = (await listAllGatherings())
    .filter((g) => kind === 'all' || g.kind === kind)
    .filter((g) => {
      const s = currentStatus(g, iso);
      if (status === 'live') return s === 'open' || s === 'full';
      if (status === 'done') return s === 'done';
      if (status === 'cancelled') return s === 'cancelled';
      return true;
    })
    .sort((a, b) => b.meetAt.localeCompare(a.meetAt))
    .slice(0, 150);
  const ids = list.map((g) => g.id);
  const [users, reportRows, msgRows] = await Promise.all([
    loadUsers(list.flatMap((g) => [g.hostId, ...memberIds(g)])),
    ids.length
      ? all<{ ref: string; n: number }>(
          `SELECT ref_id AS ref, COUNT(*)::int AS n FROM lounge_reports WHERE ref_id = ANY(?::text[]) GROUP BY ref_id`,
          [ids],
        )
      : Promise.resolve([]),
    ids.length
      ? all<{ room: string; n: number }>(
          `SELECT room_id AS room, COUNT(*)::int AS n FROM lounge_messages WHERE room_id = ANY(?::text[]) AND kind = 'text' GROUP BY room_id`,
          [ids],
        )
      : Promise.resolve([]),
  ]);
  const reports = new Map(reportRows.map((r) => [r.ref, Number(r.n)]));
  const messages = new Map(msgRows.map((r) => [r.room, Number(r.n)]));
  return list.map((g) => ({
    id: g.id,
    kind: g.kind,
    title: g.title,
    place: g.place,
    meetAt: g.meetAt,
    createdAt: g.createdAt,
    status: currentStatus(g, iso),
    host: users.get(g.hostId)?.nickname ?? '(탈퇴)',
    members: memberIds(g).map((id) => ({ id, nickname: users.get(id)?.nickname ?? '(탈퇴)', host: id === g.hostId })),
    capacity: g.slots.reduce((sum, s) => sum + s.capacity, 0),
    applicants: g.applicants.length,
    reports: reports.get(g.id) ?? 0,
    messages: messages.get(g.id) ?? 0,
  }));
}

/** 관리자가 모임을 취소한다 (참여자 단톡방에 안내 한 줄) */
export async function adminCancelGathering(adminId: string, id: string, reason: string): Promise<Result<true>> {
  const result = await mutateGathering(id, (g) =>
    g.status === 'cancelled' ? fail('NOT_OPEN', '이미 취소된 모임이에요.') : ok({ ...g, status: 'cancelled' as const }),
  );
  if (!result.ok) return result;
  const why = reason.trim().slice(0, 100);
  await insertMessage({
    id: randomUUID(),
    roomId: id,
    userId: null,
    kind: 'system',
    text: `관리자가 이 모임을 취소했어요.${why ? ` (${why})` : ''}`,
    at: nowISO(),
  });
  await logAdmin(adminId, '모임 취소', `${kindLabel(result.value)} · ${result.value.title}`, why);
  return ok(true);
}

/** 관리자가 참여자 한 명을 모임에서 뺀다 (주최자는 뺄 수 없다) */
export async function adminKickMember(adminId: string, id: string, userId: string): Promise<Result<true>> {
  let title = '';
  const result = await mutateGathering(id, (g) => {
    title = `${kindLabel(g)} · ${g.title}`;
    if (g.hostId === userId) return fail('INVALID', '주최자는 뺄 수 없어요. 모임을 취소해 주세요.');
    if (!memberIds(g).includes(userId) && !g.applicants.some((a) => a.userId === userId)) {
      return fail('NOT_JOINED', '이 모임에 없는 사람이에요.');
    }
    const next: Gathering = {
      ...g,
      slots: g.slots.map((s) => ({ ...s, memberIds: s.memberIds.filter((m) => m !== userId) })),
      applicants: g.applicants.filter((a) => a.userId !== userId),
    };
    if (next.status === 'full' && !isFull(next)) next.status = 'open';
    return ok(next);
  });
  if (!result.ok) return result;
  const who = (await loadUsers([userId])).get(userId)?.nickname ?? userId;
  await logAdmin(adminId, '모임에서 빼기', title, who);
  return ok(true);
}

// ───────────── 회의 ─────────────

export async function adminMeetings(q: string): Promise<AdminMeetingRow[]> {
  const term = q.trim().toLowerCase().slice(0, 40);
  const today = kstDate(Date.now());
  const rows = await all<{
    id: number;
    name: string;
    code: string;
    ownerId: number;
    createdAt: Date | string;
    members: number;
    reservations: number;
    upcoming: number;
  }>(
    `SELECT m.id, m.name, m.code, m.owner_id AS "ownerId", m.created_at AS "createdAt",
            (SELECT COUNT(*) FROM meeting_members mm WHERE mm.meeting_id = m.id)::int AS members,
            (SELECT COUNT(*) FROM reservations r WHERE r.meeting_id = m.id)::int AS reservations,
            (SELECT COUNT(*) FROM reservations r WHERE r.meeting_id = m.id AND r.date >= ?)::int AS upcoming
       FROM meetings m
      ${term ? 'WHERE lower(m.name) LIKE ? OR lower(m.code) = ?' : ''}
      ORDER BY m.created_at DESC, m.id DESC
      LIMIT 150`,
    term ? [today, `%${term}%`, term] : [today],
  );
  const ownerIds = rows.map((r) => r.ownerId);
  const [owners, names] = await Promise.all([
    loadUsers(ownerIds.map(String)),
    ownerIds.length
      ? all<{ id: number; username: string | null }>('SELECT id, username FROM users WHERE id = ANY(?::int[])', [ownerIds])
      : Promise.resolve([]),
  ]);
  const usernames = new Map(names.map((r) => [r.id, r.username ?? '']));
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    code: r.code,
    owner: owners.get(String(r.ownerId))?.nickname || usernames.get(r.ownerId) || '(알 수 없음)',
    ownerUsername: usernames.get(r.ownerId) ?? '',
    createdAt: new Date(r.createdAt).toISOString(),
    members: Number(r.members),
    reservations: Number(r.reservations),
    upcomingReservations: Number(r.upcoming),
  }));
}

export async function adminDeleteMeeting(adminId: string, id: number): Promise<Result<true>> {
  const m = await get<{ name: string }>('SELECT name FROM meetings WHERE id = ?', [id]);
  if (!m) return fail('NOT_FOUND', '없는 회의예요.');
  await run('DELETE FROM meetings WHERE id = ?', [id]);
  await logAdmin(adminId, '회의 삭제', m.name);
  return ok(true);
}

// ───────────── 운영 도구 ─────────────

export const TOOLS: readonly AdminTool[] = ['clearQuickQueue', 'clearPresence', 'sweepLectureAlerts', 'closeOldReports'];

export async function adminRunTool(adminId: string, tool: AdminTool): Promise<Result<{ message: string }>> {
  let message = '';
  switch (tool) {
    case 'clearQuickQueue': {
      const r = await run(`UPDATE lounge_quick_requests SET status = 'cancelled' WHERE status = 'waiting'`);
      message = `밥약 빠른 매칭 대기 ${r.changes}건을 비웠어요.`;
      break;
    }
    case 'clearPresence': {
      const r = await run('DELETE FROM lounge_presence');
      message = `라운지 접속 기록 ${r.changes}건을 지웠어요. 지금 접속한 사람은 곧 다시 잡혀요.`;
      break;
    }
    case 'sweepLectureAlerts': {
      const n = await sweepLectureAlerts();
      message = n > 0 ? `마감 6시간 안의 미수강 강의 알림 ${n}건을 보냈어요.` : '지금 보낼 강의 알림이 없어요.';
      break;
    }
    case 'closeOldReports': {
      const r = await run(
        `UPDATE lounge_reports SET status = 'dismissed', handled_at = now(), handled_by = ?
          WHERE status = 'open' AND created_at < now() - interval '30 days'`,
        [Number(adminId) || null],
      );
      message = `30일 지난 미처리 신고 ${r.changes}건을 닫았어요.`;
      break;
    }
  }
  await logAdmin(adminId, '운영 도구', message);
  return ok({ message });
}

/** 전체 공지 알림: 폰 알림을 켠 모든 사람에게 보낸다 */
export async function adminBroadcast(adminId: string, title: string, body: string): Promise<Result<{ sent: number }>> {
  const t = title.trim().slice(0, 40);
  const b = body.trim().slice(0, 120);
  if (!t || !b) return fail('INVALID', '제목과 내용을 적어 주세요.');
  const rows = await all<{ userId: number }>('SELECT DISTINCT user_id AS "userId" FROM lounge_push_subscriptions');
  const tag = `notice-${Date.now()}`;
  for (const r of rows) await pushOnly(String(r.userId), { title: t, body: b, url: '/', tag });
  await logAdmin(adminId, '전체 공지 알림', t, `${b} (${rows.length}명)`);
  return ok({ sent: rows.length });
}
