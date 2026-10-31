/**
 * 1:1 대화방. 라운지에서 상대 프로필을 눌러 연다. 방 id = "dm-작은id-큰id" (두 사람 사이에 하나뿐).
 * 메시지·나가기는 단톡방과 같은 표(lounge_messages·lounge_room_leaves)를 쓰고, 방 목록은 lounge_dm_rooms 에 둔다.
 * 차단 관계가 되면 목록에서 사라지고 더는 보낼 수 없다.
 */
import { all, get, run } from '../../db.js';
import { fail, ok } from '../../../shared/lounge/types.js';
import type { Result } from '../../../shared/lounge/types.js';
import type { RoomSummary } from '../../../shared/lounge/view.js';
import { findUser, loadUsers } from '../users.js';
import type { LoungeUser } from '../users.js';
import { insertSystemMessageIfEmpty, leftRoomIds } from '../repo/messages.js';
import { hiddenFor } from './safety.js';

const PREFIX = 'dm-';
export const DM_OPEN_MESSAGE = '1:1 대화를 시작했어요. 서로 예의를 지켜 주세요.';

export const isDmRoom = (roomId: string): boolean => roomId.startsWith(PREFIX);

export function dmRoomId(a: string, b: string): string {
  const [x, y] = [Number(a), Number(b)].sort((p, q) => p - q);
  return `${PREFIX}${x}-${y}`;
}

/** 방 id 에서 두 사람. 모양이 틀리면 null */
export function dmMembers(roomId: string): [string, string] | null {
  const m = /^dm-(\d+)-(\d+)$/.exec(roomId);
  if (!m || Number(m[1]) >= Number(m[2])) return null;
  return [m[1], m[2]];
}

/** 방이 만들어진 때 (목록의 날짜로 쓴다). 아직 없으면 null */
export async function dmCreatedAt(roomId: string): Promise<string | null> {
  const row = await get<{ at: Date | string }>('SELECT created_at AS at FROM lounge_dm_rooms WHERE room_id = ?', [roomId]);
  return row ? new Date(row.at).toISOString() : null;
}

/** 상대와의 1:1 방을 연다 (이미 있으면 그 방). 나간 방이면 다시 들어온다 */
export async function startDm(viewer: LoungeUser, targetId: string): Promise<Result<{ roomId: string }>> {
  if (targetId === viewer.id) return fail('INVALID', '나와는 대화할 수 없어요.');
  if (viewer.banned) return fail('BANNED', '이용이 정지된 계정은 대화를 시작할 수 없어요.');
  const target = await findUser(targetId);
  if (!target || !target.profileDone) return fail('NOT_FOUND', '사용자를 찾을 수 없어요.');
  if ((await hiddenFor(viewer.id)).has(targetId)) return fail('NOT_FOUND', '사용자를 찾을 수 없어요.');

  const roomId = dmRoomId(viewer.id, targetId);
  const [a, b] = dmMembers(roomId)!;
  await run(
    `INSERT INTO lounge_dm_rooms (room_id, user_a, user_b) VALUES (?, ?, ?) ON CONFLICT (room_id) DO NOTHING`,
    [roomId, Number(a), Number(b)],
  );
  // 내가 예전에 나갔던 방이면 다시 들어온다
  await run('DELETE FROM lounge_room_leaves WHERE user_id = ? AND room_id = ?', [Number(viewer.id), roomId]);
  await insertSystemMessageIfEmpty(roomId, DM_OPEN_MESSAGE, new Date().toISOString());
  return ok({ roomId });
}

/** 내 1:1 방 목록 (채팅 목록에 단톡방과 함께 보인다) */
export async function dmSummaries(viewer: LoungeUser): Promise<RoomSummary[]> {
  const me = Number(viewer.id);
  const rows = await all<{ roomId: string; a: number; b: number; createdAt: Date | string }>(
    `SELECT room_id AS "roomId", user_a AS a, user_b AS b, created_at AS "createdAt"
       FROM lounge_dm_rooms WHERE user_a = ? OR user_b = ?`,
    [me, me],
  );
  if (rows.length === 0) return [];
  const [left, hidden] = await Promise.all([leftRoomIds(viewer.id), hiddenFor(viewer.id)]);
  const others = rows.map((r) => String(r.a === me ? r.b : r.a));
  const users = await loadUsers(others);
  // 상대가 보낸 마지막 말 (안 읽은 표시에 쓴다)
  const activity = await all<{ roomId: string; at: Date | string }>(
    `SELECT room_id AS "roomId", MAX(at) AS at FROM lounge_messages
      WHERE room_id = ANY(?::text[]) AND (user_id IS NULL OR user_id <> ?) GROUP BY room_id`,
    [rows.map((r) => r.roomId), me],
  );
  const lastAt = new Map(activity.map((x) => [x.roomId, new Date(x.at).toISOString()]));
  return rows.flatMap((r, i) => {
    const other = others[i];
    const u = users.get(other);
    if (left.has(r.roomId) || hidden.has(other) || !u) return [];
    return [
      {
        id: r.roomId,
        title: u.nickname,
        kind: 'dm' as const,
        meetAt: new Date(r.createdAt).toISOString(),
        place: '',
        lastActivityAt: lastAt.get(r.roomId) ?? null,
        memberCount: 2,
        readOnly: false,
      },
    ];
  });
}
