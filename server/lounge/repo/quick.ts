/**
 * 빠른 매칭 저장소 — 대기표(`lounge_quick_requests`)와 후보 방(`lounge_quick_rooms`).
 * SQL 은 전부 여기에만 둔다. 규칙은 모르고, "누가 먼저 바꿨는가"만 정확히 가려 준다.
 *
 * 경쟁을 푸는 두 가지 장치
 *  - 대기표 선점: `UPDATE … SET status='matched', room_id=? WHERE id=? AND status='waiting'` — 영향 행이 1이면 내 것.
 *    같은 대기표를 두 요청이 동시에 노려도 DB 가 한 쪽만 통과시킨다.
 *  - 방 낙관적 잠금: `UPDATE … SET data=?, version=version+1 WHERE id=? AND version=?` — 0행이면 누가 먼저 바꾼 것.
 *
 * 대기표의 status·room_id·user_id 는 **컬럼이 진실**이다(위 UPDATE 가 컬럼만 바꾸므로).
 * data(JSONB)에는 바뀌지 않는 조건만 넣고, 읽을 때 컬럼 값을 합쳐서 돌려준다 — 두 군데가 어긋날 수 없다.
 * 방은 문서 전체를 매번 다시 쓰므로 data 안에 status 가 있고, 같은 UPDATE 에서 컬럼도 함께 맞춘다.
 *
 * 즉시 매칭의 위치(data.loc)는 대기 중에만 있다. 대기표가 waiting 을 벗어나는 모든 UPDATE 는
 * `data = data - 'loc'` 를 **같은 문장에서** 함께 해서, 위치가 남은 채로 matched·cancelled·expired 가 되는 순간이 없다.
 */
import { all, get, run } from '../../db.js';
import type { QuickLocation, QuickRequest, QuickRoom } from '../domain/quickMatch.js';

// ───────────── 행 ↔ 문서 ─────────────

type RequestDoc = Pick<QuickRequest, 'id' | 'date' | 'placeType' | 'size' | 'bands' | 'tags' | 'createdAt'> & {
  instant?: boolean;
  loc?: QuickLocation;
};

/** 위치를 지우는 SET 조각 (대기표가 waiting 을 벗어나는 UPDATE 마다 붙인다) */
const DROP_LOC = `data = data - 'loc'`;

interface RequestRow {
  id: string;
  user_id: number;
  data: RequestDoc | string;
  status: QuickRequest['status'];
  room_id: string | null;
}

interface RoomRow {
  id: string;
  data: QuickRoom | string;
  status: QuickRoom['status'];
  version: number;
}

/** pg 는 jsonb 를 객체로 주지만, 드라이버에 따라 문자열로 올 수 있어 둘 다 받는다. */
const parse = <T>(value: T | string): T => (typeof value === 'string' ? (JSON.parse(value) as T) : value);

const REQUEST_COLUMNS = 'id, user_id, data, status, room_id';

function requestFromRow(row: RequestRow): QuickRequest {
  return {
    ...parse(row.data),
    id: row.id,
    userId: String(row.user_id),
    status: row.status,
    roomId: row.room_id,
  };
}

function roomFromRow(row: RoomRow): { room: QuickRoom; version: number } {
  return { room: { ...parse(row.data), id: row.id, status: row.status }, version: Number(row.version) };
}

// ───────────── 대기표 ─────────────

export async function insertRequest(r: QuickRequest): Promise<void> {
  const doc: RequestDoc = {
    id: r.id,
    date: r.date,
    placeType: r.placeType,
    size: r.size,
    bands: r.bands,
    tags: r.tags,
    createdAt: r.createdAt,
    ...(r.instant ? { instant: true } : {}),
    ...(r.instant && r.loc ? { loc: r.loc } : {}),
  };
  await run(
    `INSERT INTO lounge_quick_requests (id, user_id, data, status, room_id, created_at)
     VALUES (?, ?, ?::jsonb, ?, ?, ?::timestamptz)`,
    [r.id, Number(r.userId), JSON.stringify(doc), r.status, r.roomId, r.createdAt],
  );
}

/** 이용이 정지된 사용자의 대기표는 짝 후보에서도, 대기 인원에서도 뺀다. */
const NOT_BANNED = 'user_id NOT IN (SELECT id FROM users WHERE banned)';

/** 기다리는 대기표 전부 (오래된 순). 매칭 후보 풀이다. */
export async function listWaiting(): Promise<QuickRequest[]> {
  const rows = await all<RequestRow>(
    `SELECT ${REQUEST_COLUMNS} FROM lounge_quick_requests
      WHERE status = 'waiting' AND ${NOT_BANNED} ORDER BY created_at, id`,
  );
  return rows.map(requestFromRow);
}

/** 옛 방식 대기 인원 (즉시 대기표는 위치 반경으로 따로 센다) */
export async function countWaiting(): Promise<number> {
  const row = await get<{ c: number }>(
    `SELECT COUNT(*)::int AS c FROM lounge_quick_requests
      WHERE status = 'waiting' AND data->>'instant' IS DISTINCT FROM 'true' AND ${NOT_BANNED}`,
  );
  return Number(row?.c ?? 0);
}

/** 한 사람의 취소되지 않은 대기표 (최신순). 정상이면 0~1개다. */
export async function listActiveByUser(userId: string): Promise<QuickRequest[]> {
  const rows = await all<RequestRow>(
    `SELECT ${REQUEST_COLUMNS} FROM lounge_quick_requests
      WHERE user_id = ? AND status <> 'cancelled'
      ORDER BY created_at DESC, id DESC`,
    [Number(userId)],
  );
  return rows.map(requestFromRow);
}

/**
 * 대기표 선점. 아직 waiting 일 때만 matched 로 바꾸고 방을 붙인다.
 * 돌려주는 값이 true 면 이 대기표는 내 것이다 (영향 행 1).
 */
export async function claimWaiting(requestId: string, roomId: string): Promise<boolean> {
  const { changes } = await run(
    `UPDATE lounge_quick_requests SET status = 'matched', room_id = ?, ${DROP_LOC} WHERE id = ? AND status = 'waiting'`,
    [roomId, requestId],
  );
  return changes === 1;
}

/**
 * 내가 선점했던 대기표만 waiting 으로 되돌린다 (다른 방에 붙은 것은 건드리지 않는다).
 * 즉시 대기표는 선점할 때 위치가 지워졌으므로, 호출한 쪽이 갖고 있던 위치(loc)를 함께 돌려놓는다.
 */
export async function releaseClaim(requestId: string, roomId: string, loc?: QuickLocation): Promise<void> {
  await run(
    `UPDATE lounge_quick_requests SET status = 'waiting', room_id = NULL${
      loc ? `, data = data || jsonb_build_object('loc', ?::jsonb)` : ''
    } WHERE id = ? AND room_id = ? AND status = 'matched'`,
    loc ? [JSON.stringify(loc), requestId, roomId] : [requestId, roomId],
  );
}

/**
 * 대기표를 취소한다. 돌려주는 값: 취소가 일어났으면 `{ roomId }`(취소 순간 붙어 있던 방, 없으면 null),
 * 이미 취소돼 있었으면 `null`.
 * room_id 는 지우지 않는다 — 취소와 동시에 선점이 일어나도 "어느 방에서 빠졌는지"를 놓치지 않으려는 것이다
 * (취소된 대기표는 어디서도 읽지 않으므로 남겨 둬도 해가 없다).
 */
export async function cancelRequest(requestId: string): Promise<{ roomId: string | null } | null> {
  const row = await get<{ room_id: string | null }>(
    `UPDATE lounge_quick_requests SET status = 'cancelled', ${DROP_LOC}
      WHERE id = ? AND status <> 'cancelled' RETURNING room_id`,
    [requestId],
  );
  return row ? { roomId: row.room_id } : null;
}

/** 정지된 사용자가 기다리고 있던 대기표를 닫는다. */
export async function cancelBannedWaiting(): Promise<void> {
  await run(
    `UPDATE lounge_quick_requests SET status = 'cancelled', ${DROP_LOC}
      WHERE status = 'waiting' AND user_id IN (SELECT id FROM users WHERE banned)`,
  );
}

/** 방에 붙어 있는 한 사람의 대기표만 닫는다 (확정 직전에 탈퇴·정지된 참여자 처리용). */
export async function cancelRoomTicket(roomId: string, userId: string): Promise<void> {
  await run(
    `UPDATE lounge_quick_requests SET status = 'cancelled', ${DROP_LOC} WHERE room_id = ? AND user_id = ? AND status = 'matched'`,
    [roomId, Number(userId)],
  );
}

/** 기다리는 대기표 여러 장을 취소한다 (지난 시간대 정리용). waiting 인 것만. */
export async function cancelWaiting(requestIds: string[]): Promise<void> {
  if (requestIds.length === 0) return;
  await run(
    `UPDATE lounge_quick_requests SET status = 'cancelled', ${DROP_LOC} WHERE id = ANY(?::text[]) AND status = 'waiting'`,
    [requestIds],
  );
}

/**
 * 즉시 매칭 대기표 중 `cutoff` 이전에 만들어졌는데 아직 waiting 인 것을 만료로 닫는다 (위치도 같은 UPDATE 에서 지운다).
 * 선점(claimWaiting)도 `status='waiting'` 일 때만 되므로, 만료와 선점이 겹쳐도 어느 한 쪽만 이긴다.
 */
export async function expireInstantWaiting(cutoff: string): Promise<void> {
  await run(
    `UPDATE lounge_quick_requests SET status = 'expired', ${DROP_LOC}
      WHERE status = 'waiting' AND data->>'instant' = 'true' AND created_at <= ?::timestamptz`,
    [cutoff],
  );
}

/**
 * 깨졌거나 사라진 방에 붙어 있는 대기표를 정리한다. (roomId 를 주면 그 방만)
 *  - 방에서 '거절'한 사람의 대기표는 cancelled (거절 = 이 매칭을 안 하겠다는 뜻)
 *  - 나머지는 waiting 으로 복귀 (다시 짝을 찾는다)
 *  - 단, 즉시 매칭 대기표는 위치가 이미 지워졌으니 다시 찾을 수 없다 → expired (클라이언트가 다시 위치를 보낸다)
 * 한 문장으로 끝나서 두 요청이 동시에 불러도 같은 결과가 된다. 돌려주는 값은 waiting 으로 돌아간 대기표 id.
 */
export async function releaseDeadRoomTickets(roomId?: string): Promise<string[]> {
  const instant = `(q.data->>'instant') = 'true'`;
  const declined = `(SELECT r.data->'answers'->>(q.user_id::text) FROM lounge_quick_rooms r WHERE r.id = q.room_id) = 'declined'`;
  const rows = await all<{ id: string; status: string }>(
    `UPDATE lounge_quick_requests q
        SET status = CASE WHEN ${declined} THEN 'cancelled' WHEN ${instant} THEN 'expired' ELSE 'waiting' END,
            room_id = CASE WHEN ${declined} THEN q.room_id ELSE NULL END,
            ${DROP_LOC}
      WHERE q.status = 'matched' AND q.room_id IS NOT NULL
        ${roomId ? 'AND q.room_id = ?' : ''}
        AND NOT EXISTS (SELECT 1 FROM lounge_quick_rooms r WHERE r.id = q.room_id AND r.status <> 'cancelled')
      RETURNING q.id AS id, q.status AS status`,
    roomId ? [roomId] : [],
  );
  return rows.filter((r) => r.status === 'waiting').map((r) => r.id);
}

// ───────────── 후보 방 ─────────────

export async function insertRoom(room: QuickRoom): Promise<void> {
  await run(
    `INSERT INTO lounge_quick_rooms (id, data, status, version, created_at) VALUES (?, ?::jsonb, ?, 1, ?::timestamptz)`,
    [room.id, JSON.stringify(room), room.status, room.createdAt],
  );
}

export async function deleteRoom(roomId: string): Promise<void> {
  await run('DELETE FROM lounge_quick_rooms WHERE id = ?', [roomId]);
}

export async function findRoom(roomId: string): Promise<{ room: QuickRoom; version: number } | undefined> {
  const row = await get<RoomRow>('SELECT id, data, status, version FROM lounge_quick_rooms WHERE id = ?', [roomId]);
  return row ? roomFromRow(row) : undefined;
}

/** 아직 확정·취소되지 않은 방 전부 (만료 정리용 — 오래 쌓이지 않는 작은 집합이다) */
export async function listPendingRooms(): Promise<{ room: QuickRoom; version: number }[]> {
  const rows = await all<RoomRow>(`SELECT id, data, status, version FROM lounge_quick_rooms WHERE status = 'pending'`);
  return rows.map(roomFromRow);
}

/**
 * 방 문서를 통째로 쓴다 — 내가 읽은 version 그대로일 때만. 돌려주는 값이 false 면 누가 먼저 바꾼 것이니
 * 호출한 쪽이 처음부터 다시 읽어야 한다.
 */
export async function updateRoom(room: QuickRoom, expectedVersion: number): Promise<boolean> {
  const { changes } = await run(
    `UPDATE lounge_quick_rooms SET data = ?::jsonb, status = ?, version = version + 1 WHERE id = ? AND version = ?`,
    [JSON.stringify(room), room.status, room.id, expectedVersion],
  );
  return changes === 1;
}
