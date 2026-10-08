/**
 * 단톡방 메시지 저장소. 방 id = 모임 id.
 * 시각은 항상 JS 의 `toISOString()` 으로 넣고 같은 형식으로 읽어, 도메인의 문자열 비교(`m.at > after`)가 맞게 한다.
 */
import { all, get, run } from '../../db.js';
import type { ISODateTime } from '../../../shared/lounge/types.js';
import type { Message } from '../domain/chat.js';

interface MessageRow {
  id: string;
  room_id: string;
  user_id: number | null;
  kind: string;
  text: string;
  at: Date | string;
}

const toMessage = (r: MessageRow): Message => ({
  id: r.id,
  roomId: r.room_id,
  userId: r.user_id === null ? null : String(r.user_id),
  kind: r.kind === 'system' ? 'system' : 'text',
  text: r.text,
  at: new Date(r.at).toISOString(),
});

export async function insertMessage(m: Message): Promise<void> {
  await run(
    `INSERT INTO lounge_messages (id, room_id, user_id, kind, text, at)
     VALUES (?, ?, ?, ?, ?, ?::timestamptz)`,
    [m.id, m.roomId, m.userId === null ? null : Number(m.userId), m.kind, m.text, m.at],
  );
}

/** 방의 메시지 중 최근 `limit`개를 오래된 것부터. `after` 가 있으면 그 이후(초과)만. */
export async function listMessages(
  roomId: string,
  opts: { after?: ISODateTime | null; limit?: number } = {},
): Promise<Message[]> {
  const params: unknown[] = [roomId];
  let afterClause = '';
  if (opts.after) {
    afterClause = 'AND at > ?::timestamptz';
    params.push(opts.after);
  }
  params.push(Math.min(500, Math.max(1, Math.trunc(opts.limit ?? 200))));
  const rows = await all<MessageRow>(
    `SELECT id, room_id, user_id, kind, text, at FROM lounge_messages
      WHERE room_id = ? ${afterClause}
      ORDER BY at DESC, id DESC
      LIMIT ?`,
    params,
  );
  return rows.map(toMessage).reverse();
}

export async function hasMessages(roomId: string): Promise<boolean> {
  const row = await get<{ one: number }>('SELECT 1 AS one FROM lounge_messages WHERE room_id = ? LIMIT 1', [roomId]);
  return Boolean(row);
}

/**
 * 방 열림 안내(시스템 메시지)의 고정 id — 같은 방에 두 번 들어가지 못하게 하는 마지막 안전장치.
 * `!` 로 시작하게 한 이유: 같은 밀리초에 첫 대화가 올라와도 id 순서에서 안내가 먼저 오게(UUID 는 숫자·영문으로 시작한다).
 */
export const openMessageId = (roomId: string) => `!open:${roomId}`;

/**
 * 방에 메시지가 하나도 없을 때만 안내 한 줄을 넣는다. 넣었으면 true.
 *
 * "있는지 보고 → 넣기" 를 두 문장으로 하면 동시에 두 요청이 둘 다 "없다"고 보고 두 줄을 넣을 수 있다.
 * 그래서 한 문장(INSERT … SELECT … WHERE NOT EXISTS)으로 하고, id 를 방마다 고정해 PK 충돌로도 한 번 더 막는다.
 */
export async function insertSystemMessageIfEmpty(roomId: string, text: string, at: ISODateTime): Promise<boolean> {
  const { changes } = await run(
    `INSERT INTO lounge_messages (id, room_id, user_id, kind, text, at)
     SELECT ?::text, ?::text, NULL::integer, 'system', ?::text, ?::timestamptz
      WHERE NOT EXISTS (SELECT 1 FROM lounge_messages WHERE room_id = ?)
     ON CONFLICT (id) DO NOTHING`,
    [openMessageId(roomId), roomId, text, at, roomId],
  );
  return changes === 1;
}
