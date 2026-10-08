/**
 * 접속자 위치 저장소 — lounge_presence (사용자당 한 줄). SQL 만 안다.
 * 시각은 전부 호출하는 쪽이 주는 값(`now`)을 쓴다: 읽기·쓰기 모두 같은 시계라서 TTL 판정이 어긋나지 않고 테스트도 쉽다.
 */
import { all, run } from '../../db.js';
import type { EmoteKey, Zone } from '../../../shared/lounge/constants.js';

export type PresenceRow = {
  userId: string;
  x: number;
  y: number;
  zone: Zone;
  emote: string | null;
  emoteAt: Date | null;
  seenAt: Date;
  // 사용자 조인 (공개 필드만 — 실명·이메일·학과는 읽지도 않는다)
  nickname: string;
  college: string;
  admissionYear: number;
  avatar: string | null;
  avatarColor: string | null;
  temperature: number;
};

interface RawRow {
  user_id: number;
  x: number;
  y: number;
  zone: string;
  emote: string | null;
  emote_at: Date | string | null;
  seen_at: Date | string;
  nickname: string | null;
  college: string | null;
  admission_year: number | null;
  avatar: string | null;
  avatar_color: string | null;
  temperature: number | null;
}

const toDate = (v: Date | string): Date => (v instanceof Date ? v : new Date(v));

/**
 * 내 위치를 쓴다. 한 사용자 한 줄(upsert).
 * 이모트가 오면 emote/emote_at 을 새로 쓰고, 안 오면(하트비트) 이전 값을 그대로 둔다 —
 * 이모트는 읽는 쪽이 emote_at 으로 5초 지났는지 판단해서 감춘다.
 */
export async function upsertPresence(
  userId: string,
  p: { x: number; y: number; zone: Zone; emote?: EmoteKey },
  now: Date,
): Promise<void> {
  const at = now.toISOString();
  await run(
    `INSERT INTO lounge_presence (user_id, x, y, zone, emote, emote_at, seen_at)
     VALUES (?, ?, ?, ?, ?, ?::timestamptz, ?::timestamptz)
     ON CONFLICT (user_id) DO UPDATE SET
       x = EXCLUDED.x,
       y = EXCLUDED.y,
       zone = EXCLUDED.zone,
       seen_at = EXCLUDED.seen_at,
       emote = COALESCE(EXCLUDED.emote, lounge_presence.emote),
       emote_at = CASE WHEN EXCLUDED.emote IS NOT NULL THEN EXCLUDED.emote_at ELSE lounge_presence.emote_at END`,
    [Number(userId), p.x, p.y, p.zone, p.emote ?? null, p.emote ? at : null, at],
  );
}

/**
 * 지금 접속 중인 사람(= seen_at 이 `since` 이후) + 공개 프로필, 최근 순 최대 `limit` 명.
 * 쿼리 한 번: 프로필 있는 사람만(`profile_done`), `excludeIds`(나 + 차단 관계)는 SQL 에서 빼므로
 * 제한(LIMIT)이 걸린 뒤에 걸러져 200명이 모자라는 일이 없다. `seen_at` 인덱스로 범위를 찾는다.
 *
 * `purgeBefore` 가 있으면 같은 문장 안에서 그보다 오래된 행도 지운다(데이터 변경 CTE) —
 * 정리를 위해 왕복을 한 번 더 쓰지 않으려는 것이다. 지워지는 행은 어차피 TTL 밖이라 결과에는 영향이 없다.
 */
export async function listPresent(opts: {
  since: Date;
  excludeIds: number[];
  limit: number;
  purgeBefore?: Date;
}): Promise<PresenceRow[]> {
  const purge = opts.purgeBefore
    ? `WITH purged AS (DELETE FROM lounge_presence WHERE seen_at < ?::timestamptz RETURNING user_id)`
    : '';
  const params: unknown[] = opts.purgeBefore ? [opts.purgeBefore.toISOString()] : [];
  params.push(opts.since.toISOString(), opts.excludeIds, opts.limit);

  const rows = await all<RawRow>(
    `${purge}
     SELECT p.user_id, p.x, p.y, p.zone, p.emote, p.emote_at, p.seen_at,
            u.nickname, u.college, u.admission_year, u.avatar, u.avatar_color, u.temperature
       FROM lounge_presence p
       JOIN users u ON u.id = p.user_id
      WHERE p.seen_at > ?::timestamptz
        AND u.profile_done = TRUE
        AND p.user_id <> ALL(?::int[])
      ORDER BY p.seen_at DESC, p.user_id
      LIMIT ?`,
    params,
  );

  return rows.map((r) => ({
    userId: String(r.user_id),
    x: Number(r.x),
    y: Number(r.y),
    zone: r.zone as Zone,
    emote: r.emote,
    emoteAt: r.emote_at === null ? null : toDate(r.emote_at),
    seenAt: toDate(r.seen_at),
    nickname: r.nickname ?? '',
    college: r.college ?? '',
    admissionYear: r.admission_year ?? 0,
    avatar: r.avatar,
    avatarColor: r.avatar_color,
    temperature: r.temperature ?? 0,
  }));
}
