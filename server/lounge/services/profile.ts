/**
 * 라운지 프로필 — 학교 계정에서 읽어 온 사실(이름·학과·입학년도)로 자동으로 만들어진다 (services/schoolProfile.ts).
 * 사용자가 고칠 수 있는 것은 아바타 색뿐이다. 이름·학과·학번을 직접 적게 두면 거짓 프로필이 되고,
 * 학과는 "같은 학과 제외/만" 비교에 쓰이므로 학교가 확인한 값이어야 한다.
 *
 * 입력은 신뢰하지 않는다: JSON 본문이므로 어떤 필드든 문자열이 아닐 수 있고, 그런 값은 모두 INVALID 로 돌려보낸다.
 */
import { run } from '../../db.js';
import { AVATARS, AVATAR_COLORS, GENDERS } from '../../../shared/lounge/constants.js';
import type { Gender } from '../../../shared/lounge/gathering.js';
import { fail, ok } from '../../../shared/lounge/types.js';
import type { Result } from '../../../shared/lounge/types.js';
import type { MeResponse, Profile, PublicUser } from '../../../shared/lounge/view.js';
import { findUser, toProfile, toPublicUser } from '../users.js';
import type { LoungeUser } from '../users.js';
import { hiddenFor } from './safety.js';
import { ensureSchoolProfile } from './schoolProfile.js';

/** users.id 는 SERIAL(int4) — 이보다 큰 값은 DB 가 오류를 내므로 "없는 사용자"로 본다. */
const INT4_MAX = 2_147_483_647;

/** 올해(한국 시간). 서버가 UTC 여도 12월 31일 밤(KST 1월 1일)에 해가 바뀐 것으로 본다. */
export function currentYearKst(now: Date): number {
  return new Date(now.getTime() + 9 * 3600_000).getUTCFullYear();
}

/** 더 이상 받지 않는 프로필 필드 — 보내면 거절한다 */
const LOCKED_FIELDS = ['nickname', 'college', 'department', 'admissionYear'] as const;

export const PROFILE_LOCKED_MESSAGE = '이름·학과·학번은 학교 계정 정보로 자동으로 정해져요.';
export const PROFILE_NEEDS_SCHOOL_MESSAGE = '학교 계정을 연동하면 라운지를 쓸 수 있어요.';

export const GENDER_LOCKED_MESSAGE = '성별은 학교 계정 정보로 정해져서 바꿀 수 없어요.';

/** `PUT /me` 본문 검증: 표정(avatar)·색(avatarColor), 그리고 학교에서 못 읽었을 때의 성별(gender)만 받는다. */
export function validateProfileUpdate(
  raw: unknown,
): Result<{ avatarColor: (typeof AVATAR_COLORS)[number]; avatar?: (typeof AVATARS)[number]['key']; gender?: Gender }> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return fail('INVALID', '프로필 정보가 올바르지 않아요.');
  }
  const b = raw as Record<string, unknown>;
  if (LOCKED_FIELDS.some((k) => Object.hasOwn(b, k))) return fail('INVALID', PROFILE_LOCKED_MESSAGE);
  const avatarColor = AVATAR_COLORS.find((c) => c === b.avatarColor);
  if (typeof b.avatarColor !== 'string' || !avatarColor) return fail('INVALID', '아바타 색을 목록에서 골라 주세요.');
  // 성별은 보내지 않으면 그대로 둔다
  let gender: Gender | undefined;
  if (b.gender !== undefined) {
    gender = GENDERS.find((g) => g === b.gender);
    if (!gender) return fail('INVALID', '성별은 남 또는 여 중에서 골라 주세요.');
  }
  // 표정은 보내지 않으면 지금 것을 그대로 둔다
  if (b.avatar === undefined) return ok({ avatarColor, ...(gender ? { gender } : {}) });
  const face = AVATARS.find((a) => a.key === b.avatar);
  if (typeof b.avatar !== 'string' || !face) return fail('INVALID', '표정을 목록에서 골라 주세요.');
  return ok({ avatarColor, avatar: face.key, ...(gender ? { gender } : {}) });
}

/** `GET /me` 응답. 프로필을 만들기 전에는 `profile: null` + `needsProfile: true`. */
export function toMeResponse(u: LoungeUser): MeResponse {
  return {
    profile: u.profileDone ? toProfile(u) : null,
    needsProfile: !u.profileDone,
    isAdmin: u.isAdmin,
  };
}


/**
 * 프로필 고치기 = 아바타 색 바꾸기. 평판 컬럼(temperature·warnings·banned)과 학교에서 온 값은 SET 에 없으므로 바뀌지 않는다.
 * 학교 연동이 없는 사용자는 거절한다. 연동은 있는데 프로필이 아직 없는 옛 계정은 여기서 함께 채워진다.
 */
export async function updateProfile(userId: string, raw: unknown): Promise<Result<Profile>> {
  const valid = validateProfileUpdate(raw);
  if (!valid.ok) return valid;

  const uid = Number(userId);
  if (!Number.isInteger(uid)) return fail('NOT_FOUND');
  if (!(await ensureSchoolProfile(uid))) {
    // 학교 연동이 없어도 이미 프로필이 있는 계정(시연·운영용 계정)은 표정·색을 바꿀 수 있다. 프로필이 없으면 연동부터.
    const existing = await findUser(uid);
    if (!existing) return fail('NOT_FOUND');
    if (!existing.profileDone) return fail('INVALID', PROFILE_NEEDS_SCHOOL_MESSAGE);
  }
  if (valid.value.gender) {
    // 학교 계정에서 읽은 성별이 있으면 그대로 둔다 (거짓 성별로 미팅 자리를 고르지 못하게)
    const current = await findUser(uid);
    if (current?.genderFromSchool && current.gender !== valid.value.gender) return fail('INVALID', GENDER_LOCKED_MESSAGE);
  }
  await run('UPDATE users SET avatar_color = ?, avatar = COALESCE(?, avatar), gender = COALESCE(?, gender) WHERE id = ?', [
    valid.value.avatarColor,
    valid.value.avatar ?? null,
    valid.value.gender ?? null,
    uid,
  ]);
  const saved = await findUser(uid);
  return saved ? ok(toProfile(saved)) : fail('NOT_FOUND');
}

/**
 * 다른 사용자 카드. 없는 사용자·프로필을 아직 안 만든 사용자·차단 관계(서로)는 모두 같은 NOT_FOUND 다 —
 * 차단했다는 사실이 응답 차이로 드러나지 않게 한다.
 */
export async function getPublicUserFor(viewerId: string, targetId: string): Promise<Result<PublicUser>> {
  if (!/^[1-9]\d{0,9}$/.test(targetId) || Number(targetId) > INT4_MAX) return fail('NOT_FOUND');
  const [target, hidden] = await Promise.all([findUser(targetId), hiddenFor(viewerId)]);
  if (!target || !target.profileDone || hidden.has(target.id)) return fail('NOT_FOUND');
  return ok(toPublicUser(target));
}
