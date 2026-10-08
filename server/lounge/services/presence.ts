/**
 * 라운지 접속자 — 내 위치 쓰기(POST /presence)와 지금 접속 중인 사람 읽기(GET /presence).
 * 3초마다 사람 수만큼 불리는 경로라서 읽기는 쿼리 2개(차단 목록 + 접속자·프로필 조인)로 끝낸다.
 * 규칙: docs/lounge/01-contract.md §2
 */
import { AVATARS, AVATAR_COLORS, EMOTES, EMOTE_TTL_MS, PRESENCE_TTL_SEC, ZONES } from '../../../shared/lounge/constants.js';
import type { AvatarColor, AvatarKey, EmoteKey } from '../../../shared/lounge/constants.js';
import { fail, ok } from '../../../shared/lounge/types.js';
import type { Result } from '../../../shared/lounge/types.js';
import type { PresenceInput, PresenceResponse, PresenceUser } from '../../../shared/lounge/view.js';
import * as repo from '../repo/presence.js';
import type { PresenceRow } from '../repo/presence.js';
import { banReason } from '../users.js';
import type { LoungeUser } from '../users.js';
import { hiddenFor } from './safety.js';

/** 한 번에 내려보내는 최대 접속자 수 (지도에 이보다 많은 아바타를 그릴 수 없다) */
export const PRESENCE_LIMIT = 200;
/** 이보다 오래 소식이 없는 행은 지운다 (TTL 45초와 별개의 "쓰레기 청소" 기준) */
export const PRESENCE_PURGE_AFTER_MS = 10 * 60_000;
/** 읽기 요청 이 횟수에 한 번 꼴로 청소한다 (+ 서버가 켜진 뒤 첫 요청) */
export const PURGE_EVERY = 100;

// ───────────── 입력 검증 (순수) ─────────────

const isUnit = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1;

/** `POST /presence` 본문. x,y ∈ [0,1] 숫자, zone ∈ ZONES, emote 는 생략하거나 EMOTES 의 key. */
export function validatePresenceInput(raw: unknown): Result<PresenceInput> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return fail('INVALID', '위치 정보가 올바르지 않아요.');
  }
  const b = raw as Record<string, unknown>;
  if (!isUnit(b.x) || !isUnit(b.y)) return fail('INVALID', '위치는 0과 1 사이의 숫자여야 해요.');
  const zone = ZONES.find((z) => z === b.zone);
  if (!zone) return fail('INVALID', '구역이 올바르지 않아요.');

  const input: PresenceInput = { x: b.x, y: b.y, zone };
  if (b.emote !== undefined && b.emote !== null) {
    const emote = EMOTES.find((e) => e.key === b.emote);
    if (!emote) return fail('INVALID', '이모트가 올바르지 않아요.');
    input.emote = emote.key;
  }
  return ok(input);
}

/** 내 위치를 쓴다. 이용이 정지된 사용자는 BANNED(403) — 정지된 사람이 지도에 계속 보이면 안 된다. */
export async function writePresence(user: LoungeUser, raw: unknown, now: Date = new Date()): Promise<Result<true>> {
  const input = validatePresenceInput(raw);
  if (!input.ok) return input;
  if (user.banned) return fail('BANNED', banReason(user) ?? undefined);
  await repo.upsertPresence(user.id, input.value, now);
  return ok(true);
}

// ───────────── 읽기 ─────────────

const isAvatar = (v: string | null): v is AvatarKey => AVATARS.some((a) => a.key === v);
const isColor = (v: string | null): v is AvatarColor => (AVATAR_COLORS as readonly string[]).includes(v ?? '');
const isEmote = (v: string | null): v is EmoteKey => EMOTES.some((e) => e.key === v);

/** 이모트는 보낸 지 EMOTE_TTL_MS 안일 때만 보인다 (하트비트는 이전 이모트를 지우지 않으므로 읽는 쪽이 감춘다). */
export function visibleEmote(row: Pick<PresenceRow, 'emote' | 'emoteAt'>, now: Date): EmoteKey | null {
  if (!row.emote || !row.emoteAt || !isEmote(row.emote)) return null;
  return now.getTime() - row.emoteAt.getTime() <= EMOTE_TTL_MS ? row.emote : null;
}

/** 저장소 행 → 화면 DTO. users.ts 의 fromRow 와 같은 대체값 규칙(알 수 없는 아바타·색은 기본값). */
export function toPresenceUser(row: PresenceRow, now: Date): PresenceUser {
  return {
    user: {
      id: row.userId,
      nickname: row.nickname,
      college: row.college,
      admissionYear: row.admissionYear,
      avatar: isAvatar(row.avatar) ? row.avatar : 'bear',
      avatarColor: isColor(row.avatarColor) ? row.avatarColor : 'm1',
      temperature: row.temperature,
    },
    x: row.x,
    y: row.y,
    zone: row.zone,
    emote: visibleEmote(row, now),
    seenAt: row.seenAt.toISOString(),
  };
}

let reads = 0;

/**
 * 지금 접속 중인 사람. 나는 빼고(내 위치는 내가 안다), 차단 관계는 서로 빼고, 프로필 있는 사람만.
 * `count` 는 나를 포함한 수라서 `users.length + 1`.
 */
export async function readPresence(
  user: LoungeUser,
  now: Date = new Date(),
  /** `purge` 로 청소 여부를 정한다 (테스트용). 생략하면 PURGE_EVERY 번에 한 번 꼴. */
  opts: { purge?: boolean } = {},
): Promise<PresenceResponse> {
  const hidden = await hiddenFor(user.id);
  const excludeIds = [user.id, ...hidden].map(Number).filter((n) => Number.isInteger(n));

  reads += 1;
  const purge = opts.purge ?? reads % PURGE_EVERY === 1;
  const rows = await repo.listPresent({
    since: new Date(now.getTime() - PRESENCE_TTL_SEC * 1000),
    excludeIds,
    limit: PRESENCE_LIMIT,
    purgeBefore: purge ? new Date(now.getTime() - PRESENCE_PURGE_AFTER_MS) : undefined,
  });

  const users = rows.map((r) => toPresenceUser(r, now));
  return { users, count: users.length + 1, serverNow: now.toISOString() };
}
