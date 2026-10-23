/**
 * 라운지 친구 — 아이디로 요청하고, 상대가 수락하면 친구가 된다.
 *
 * 규칙
 *  - 한 쌍에 한 줄만 둔다 (요청한 사람 → 받은 사람, status: pending | accepted).
 *  - 상대가 나에게 이미 요청을 보내 둔 상태에서 내가 요청하면 바로 친구가 된다 (서로 원한 것이므로).
 *  - 라운지 프로필이 없는 계정·서로 차단한 사람은 "찾을 수 없어요"로 같게 답한다 (있는지 드러내지 않는다).
 *  - 차단하면 친구 관계와 요청이 함께 지워진다 (services/safety.ts 의 blockUser).
 *  - 친구는 밥약 "친구끼리만" 매칭에 쓰인다 (friendChecker).
 */
import { all, get, run } from '../../db.js';
import { fail, ok } from '../../../shared/lounge/types.js';
import type { Result } from '../../../shared/lounge/types.js';
import type { FriendsView } from '../../../shared/lounge/view.js';
import { findUser, loadUsers, toPublicUser, toQuickMember } from '../users.js';
import { resolveWeekStart, weekEndOf } from '../../dates.js';
import { notify } from './push.js';
import { hiddenFor } from './safety.js';

interface FriendRow {
  requester_id: number;
  addressee_id: number;
  status: string;
}

const NOT_FOUND = '그 아이디의 사용자를 찾을 수 없어요. 아이디를 다시 확인해 주세요.';

/** 아이디 모양 (가입 규칙과 같은 글자만). 다른 글자가 SQL 까지 가지 않게 입구에서 거른다 */
export const USERNAME_PATTERN = /^[A-Za-z0-9._-]{1,40}$/;

async function rowsInvolving(userId: string): Promise<FriendRow[]> {
  return all<FriendRow>(
    'SELECT requester_id, addressee_id, status FROM lounge_friends WHERE requester_id = ? OR addressee_id = ?',
    [Number(userId), Number(userId)],
  );
}

async function rowBetween(a: string, b: string): Promise<FriendRow | undefined> {
  return get<FriendRow>(
    `SELECT requester_id, addressee_id, status FROM lounge_friends
      WHERE (requester_id = ? AND addressee_id = ?) OR (requester_id = ? AND addressee_id = ?)`,
    [Number(a), Number(b), Number(b), Number(a)],
  );
}

/** 내 친구 · 받은 요청 · 보낸 요청. 차단 관계이거나 라운지 프로필이 없는(탈퇴 등) 사람은 빠진다 */
export async function myFriends(me: string): Promise<FriendsView> {
  const [rows, hidden] = await Promise.all([rowsInvolving(me), hiddenFor(me)]);
  const other = (r: FriendRow) => String(r.requester_id === Number(me) ? r.addressee_id : r.requester_id);
  const users = await loadUsers(rows.map(other));
  const visible = (filter: (r: FriendRow) => boolean) =>
    rows.filter(filter).flatMap((r) => {
      const u = users.get(other(r));
      return u?.profileDone && !hidden.has(u.id) ? [u] : [];
    });
  const pick = (filter: (r: FriendRow) => boolean) => visible(filter).map(toPublicUser);
  return {
    // 친구끼리는 실명도 보여 준다 (요청 단계에서는 닉네임만)
    friends: visible((r) => r.status === 'accepted')
      .map(toQuickMember)
      .sort((a, b) => a.name.localeCompare(b.name, 'ko')),
    incoming: pick((r) => r.status === 'pending' && String(r.addressee_id) === me),
    outgoing: pick((r) => r.status === 'pending' && String(r.requester_id) === me),
  };
}

/** 아이디로 친구 요청. 상대가 이미 나에게 요청했으면 바로 친구가 된다 */
export async function requestFriend(me: string, username: string): Promise<Result<'requested' | 'accepted'>> {
  const name = username.trim();
  if (!USERNAME_PATTERN.test(name)) return fail('INVALID', '아이디를 정확히 적어 주세요.');
  const target = await get<{ id: number; profile_done: boolean | null }>(
    'SELECT id, profile_done FROM users WHERE lower(username) = lower(?)',
    [name],
  );
  if (!target || !target.profile_done) return fail('NOT_FOUND', NOT_FOUND);
  const targetId = String(target.id);
  if (targetId === me) return fail('INVALID', '내 아이디예요. 친구의 아이디를 적어 주세요.');
  if ((await hiddenFor(me)).has(targetId)) return fail('NOT_FOUND', NOT_FOUND);

  const existing = await rowBetween(me, targetId);
  if (existing?.status === 'accepted') return fail('ALREADY_JOINED', '이미 친구예요.');
  if (existing && String(existing.requester_id) === me) return fail('ALREADY_JOINED', '이미 친구 요청을 보냈어요. 상대가 수락하면 친구가 돼요.');
  if (existing) {
    // 상대가 먼저 보낸 요청이 있다 → 서로 원한 것이니 바로 친구
    await run(
      `UPDATE lounge_friends SET status = 'accepted', responded_at = now() WHERE requester_id = ? AND addressee_id = ?`,
      [Number(targetId), Number(me)],
    );
    await notifyAccepted(me, targetId);
    return ok('accepted');
  }
  await run('INSERT INTO lounge_friends (requester_id, addressee_id) VALUES (?, ?) ON CONFLICT DO NOTHING', [
    Number(me),
    Number(targetId),
  ]);
  // 아직 친구가 아니라 실명 대신 라운지 닉네임으로 알린다
  const sender = await findUser(me);
  await notify(targetId, {
    title: '친구 요청',
    body: `${sender?.nickname || '누군가'} 님이 친구 요청을 보냈어요.`,
    url: '/lounge',
    tag: `friend-request-${me}`,
  });
  return ok('requested');
}

/** 받은 요청 수락 */
export async function acceptFriend(me: string, requesterId: string): Promise<Result<true>> {
  const row = await rowBetween(me, requesterId);
  if (!row || row.status !== 'pending' || String(row.addressee_id) !== me) {
    return fail('NOT_FOUND', '받은 친구 요청이 없어요.');
  }
  if ((await hiddenFor(me)).has(requesterId)) return fail('NOT_FOUND', '받은 친구 요청이 없어요.');
  await run(
    `UPDATE lounge_friends SET status = 'accepted', responded_at = now() WHERE requester_id = ? AND addressee_id = ?`,
    [Number(requesterId), Number(me)],
  );
  await notifyAccepted(me, requesterId);
  return ok(true);
}

/** 친구가 됐다고 상대에게 알린다 (친구끼리는 실명) */
async function notifyAccepted(me: string, otherId: string): Promise<void> {
  const accepter = await findUser(me);
  await notify(otherId, {
    title: '친구가 됐어요',
    body: `${accepter?.name || accepter?.nickname || '친구'} 님과 친구가 됐어요.`,
    url: '/lounge',
    tag: `friend-accepted-${me}`,
  });
}

/** 두 사람이 지금 친구(서로 수락)인가 */
export async function areFriends(a: string, b: string): Promise<boolean> {
  const row = await rowBetween(a, b);
  return row?.status === 'accepted' && !(await hiddenFor(a)).has(b);
}

/** "밥 먹자" — 친구의 폰에 알림을 보낸다 */
export async function askMeal(me: string, friendId: string): Promise<Result<true>> {
  if (!(await areFriends(me, friendId))) return fail('NOT_FOUND', '친구만 밥 먹자고 할 수 있어요.');
  const sender = await findUser(me);
  await notify(friendId, {
    title: '밥 먹자!',
    body: `${sender?.name || sender?.nickname || '친구'} 님이 같이 밥 먹자고 해요.`,
    url: '/lounge',
    tag: `meal-${me}`,
  });
  return ok(true);
}

export type FriendTimetableEntry = {
  id: number;
  day: number;
  startMin: number;
  endMin: number;
  title: string;
  place: string | null;
  repeatKind: string;
  date: string | null;
};

/** 친구의 그 주 시간표(수업·일정). 예약은 넣지 않는다 */
export async function friendTimetable(
  me: string,
  friendId: string,
  week: unknown,
): Promise<Result<{ weekStart: string; entries: FriendTimetableEntry[] }>> {
  if (!(await areFriends(me, friendId))) return fail('NOT_FOUND', '친구의 시간표만 볼 수 있어요.');
  const weekStart = resolveWeekStart(week);
  const entries = await all<FriendTimetableEntry>(
    `SELECT id, day, start_min AS "startMin", end_min AS "endMin", title, place,
            repeat_kind AS "repeatKind", date
       FROM timetable_entries
      WHERE user_id = ? AND (repeat_kind = 'weekly' OR (date >= ? AND date <= ?))
      ORDER BY day, start_min`,
    [Number(friendId), weekStart, weekEndOf(weekStart)],
  );
  return ok({ weekStart, entries });
}

/** 관계 끊기 — 받은 요청 거절 · 보낸 요청 취소 · 친구 삭제 모두 같은 일이다 (상대에게 알리지 않는다) */
export async function removeFriend(me: string, otherId: string): Promise<void> {
  await run(
    `DELETE FROM lounge_friends
      WHERE (requester_id = ? AND addressee_id = ?) OR (requester_id = ? AND addressee_id = ?)`,
    [Number(me), Number(otherId), Number(otherId), Number(me)],
  );
}

/** 두 사람이 친구인지 (밥약 "친구끼리만" 매칭이 후보 여럿을 한꺼번에 검사할 때). 친구 목록을 한 번만 읽는다 */
export async function friendChecker(): Promise<(a: string, b: string) => boolean> {
  const rows = await all<FriendRow>(
    `SELECT requester_id, addressee_id, status FROM lounge_friends WHERE status = 'accepted'`,
  );
  const pairs = new Set(rows.map((r) => `${r.requester_id}>${r.addressee_id}`));
  return (a, b) => pairs.has(`${a}>${b}`) || pairs.has(`${b}>${a}`);
}
