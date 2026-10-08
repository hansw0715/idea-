/**
 * 라운지가 보는 사용자. 기존 users 테이블(로그인·이름·이메일)에 프로필·평판 컬럼이 붙은 것.
 * 실명(name)·이메일은 라운지 DTO 로 내려가지 않는다. 학과(department)는 서버 안에서만 비교한다.
 */
import { all, get, run } from '../db.js';
import {
  AVATARS,
  AVATAR_COLORS,
  BAN_NOTICE_GENERIC,
  DEFAULT_TEMPERATURE,
  GOOD_DELTA,
  MAX_TEMPERATURE,
  MIN_TEMPERATURE,
  NOSHOW_DELTA,
  WARNINGS_TO_BAN,
} from '../../shared/lounge/constants.js';
import type { AvatarColor, AvatarKey } from '../../shared/lounge/constants.js';
import type { Profile, PublicUser } from '../../shared/lounge/view.js';

export type LoungeUser = {
  id: string;
  /** 실명 — 라운지 화면으로 내려보내지 않는다 */
  name: string;
  nickname: string;
  college: string;
  department: string;
  admissionYear: number;
  avatar: AvatarKey;
  avatarColor: AvatarColor;
  temperature: number;
  warnings: number;
  banned: boolean;
  isAdmin: boolean;
  /** 프로필을 만들었는가. false 면 라운지 기능(모임·매칭·접속)을 쓸 수 없다. */
  profileDone: boolean;
};

interface UserRow {
  id: number;
  name: string;
  nickname: string | null;
  college: string | null;
  department: string | null;
  admission_year: number | null;
  avatar: string | null;
  avatar_color: string | null;
  temperature: number | null;
  warnings: number | null;
  banned: boolean | null;
  is_admin: boolean | null;
  profile_done: boolean | null;
}

const COLUMNS =
  'id, name, nickname, college, department, admission_year, avatar, avatar_color, temperature, warnings, banned, is_admin, profile_done';

const isAvatar = (v: string | null): v is AvatarKey => AVATARS.some((a) => a.key === v);
const isColor = (v: string | null): v is AvatarColor => (AVATAR_COLORS as readonly string[]).includes(v ?? '');

function fromRow(row: UserRow): LoungeUser {
  return {
    id: String(row.id),
    name: row.name,
    nickname: row.nickname ?? '',
    college: row.college ?? '',
    department: row.department ?? '',
    admissionYear: row.admission_year ?? 0,
    avatar: isAvatar(row.avatar) ? row.avatar : 'bear',
    avatarColor: isColor(row.avatar_color) ? row.avatar_color : 'm1',
    temperature: row.temperature ?? DEFAULT_TEMPERATURE,
    warnings: row.warnings ?? 0,
    banned: Boolean(row.banned),
    isAdmin: Boolean(row.is_admin),
    profileDone: Boolean(row.profile_done),
  };
}

export async function findUser(id: string | number): Promise<LoungeUser | undefined> {
  const n = Number(id);
  if (!Number.isInteger(n)) return undefined;
  const row = await get<UserRow>(`SELECT ${COLUMNS} FROM users WHERE id = ?`, [n]);
  return row ? fromRow(row) : undefined;
}

/** id 목록 → 사용자 맵. 없는(탈퇴한) id 는 맵에 없다. */
export async function loadUsers(ids: string[]): Promise<Map<string, LoungeUser>> {
  const nums = [...new Set(ids)].map(Number).filter((n) => Number.isInteger(n));
  if (nums.length === 0) return new Map();
  const rows = await all<UserRow>(`SELECT ${COLUMNS} FROM users WHERE id = ANY(?::int[])`, [nums]);
  return new Map(rows.map((r) => [String(r.id), fromRow(r)]));
}

/** 프로필을 만든 모든 사용자 (관리자 통계용) */
export async function listProfiledUsers(): Promise<LoungeUser[]> {
  const rows = await all<UserRow>(`SELECT ${COLUMNS} FROM users WHERE profile_done = TRUE`);
  return rows.map(fromRow);
}

export const toPublicUser = (u: LoungeUser): PublicUser => ({
  id: u.id,
  nickname: u.nickname,
  college: u.college,
  admissionYear: u.admissionYear,
  avatar: u.avatar,
  avatarColor: u.avatarColor,
  temperature: u.temperature,
});

/** 탈퇴했거나 없는 사용자 자리에 표시할 값 */
export const unknownUser = (id: string): PublicUser => ({
  id,
  nickname: '(탈퇴한 사용자)',
  college: '-',
  admissionYear: 0,
  avatar: 'bear',
  avatarColor: 'm8',
  temperature: 0,
});

/**
 * 정지 사유 문구 — 본인이 왜 막혔는지 알아야 하니까.
 * 노쇼 경고가 쌓인 경우(warnings ≥ 기준)만 사유를 단정할 수 있다. 그 밖의 정지는 신고 누적 자동 제한일 수도,
 * 관리자가 신고 없이 직접 정지한 것일 수도 있는데 사유를 저장하지 않으므로 BAN_NOTICE_GENERIC 으로 말한다.
 */
export function banReason(u: Pick<LoungeUser, 'banned' | 'warnings'>): string | null {
  if (!u.banned) return null;
  return u.warnings >= WARNINGS_TO_BAN ? `노쇼 경고 ${WARNINGS_TO_BAN}회로 이용이 정지됐어요.` : BAN_NOTICE_GENERIC;
}

export const toProfile = (u: LoungeUser): Profile => ({
  ...toPublicUser(u),
  department: u.department,
  warnings: u.warnings,
  banned: u.banned,
  banReason: banReason(u),
});

// ───────────── 평판 갱신 (원자적 SQL — 읽고 쓰기 사이에 다른 요청이 끼어도 값이 어긋나지 않는다) ─────────────

const CLAMP = `LEAST(${MAX_TEMPERATURE}, GREATEST(${MIN_TEMPERATURE}, ROUND((temperature + ?)::numeric, 1)))`;

/** 좋았어요 +0.4 / 취소 시 −0.4 처럼 온도만 더한다. */
export async function addTemperature(userId: string, delta: number): Promise<void> {
  await run(`UPDATE users SET temperature = ${CLAMP} WHERE id = ?`, [delta, Number(userId)]);
}

export const GOOD_REVIEW_DELTA = GOOD_DELTA;

/** 노쇼 확정: 온도 −5, 경고 +1, 경고가 기준에 닿으면 이용 정지 */
export async function confirmNoshowDb(userId: string): Promise<void> {
  await run(
    `UPDATE users
        SET temperature = ${CLAMP},
            warnings = warnings + 1,
            banned = banned OR (warnings + 1 >= ${WARNINGS_TO_BAN})
      WHERE id = ?`,
    [NOSHOW_DELTA, Number(userId)],
  );
}

export async function setBanned(userId: string, banned: boolean): Promise<void> {
  await run('UPDATE users SET banned = ? WHERE id = ?', [banned, Number(userId)]);
}

/** 관리자가 정지를 푼다. 억울한 노쇼였던 경우라 경고도 같이 지운다. */
export async function liftBanDb(userId: string): Promise<void> {
  await run('UPDATE users SET banned = FALSE, warnings = 0 WHERE id = ?', [Number(userId)]);
}
