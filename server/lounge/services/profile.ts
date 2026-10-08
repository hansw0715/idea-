/**
 * 라운지 프로필 — 입력 검증, 저장, 다른 사용자 카드 조회.
 * 검증은 순수 함수(`validateProfileInput`)로 분리해 서버 없이 테스트한다. 규칙: docs/lounge/01-contract.md §1
 *
 * 입력은 신뢰하지 않는다: JSON 본문이므로 어떤 필드든 문자열이 아닐 수 있고(숫자·배열·객체·null),
 * 그런 값은 모두 INVALID 로 돌려보낸다. 학과·닉네임은 NFC 로 정규화해서 저장한다 —
 * 맥(NFD)에서 입력한 한글이 자모로 쪼개져 글자 수가 틀어지거나 "같은 학과" 비교가 어긋나는 걸 막는다.
 *
 * 학과는 비교 결과(참여 가능 여부)로 남의 학과를 떠보는 데 쓰일 수 있어서 마음대로 바꿀 수 없다 — 아래 "학과 변경 제한".
 */
import { get, run } from '../../db.js';
import {
  ADMISSION_YEAR_MIN,
  AVATARS,
  AVATAR_COLORS,
  COLLEGES,
  NICKNAME_MAX,
  NICKNAME_MIN,
} from '../../../shared/lounge/constants.js';
import { fail, ok } from '../../../shared/lounge/types.js';
import type { Result } from '../../../shared/lounge/types.js';
import type { MeResponse, Profile, ProfileInput, PublicUser } from '../../../shared/lounge/view.js';
import { findUser, toProfile, toPublicUser } from '../users.js';
import type { LoungeUser } from '../users.js';
import { hiddenFor } from './safety.js';

export const DEPARTMENT_MAX = 30;
/** 학과를 한 번 정하면 이 기간 동안은 바꿀 수 없다 (학교 계정으로 확인된 학과로 맞추는 경우는 예외). */
export const DEPARTMENT_CHANGE_COOLDOWN_DAYS = 30;
const DAY_MS = 86_400_000;
/** users.id 는 SERIAL(int4) — 이보다 큰 값은 DB 가 오류를 내므로 "없는 사용자"로 본다. */
const INT4_MAX = 2_147_483_647;

/** 올해(한국 시간). 서버가 UTC 여도 12월 31일 밤(KST 1월 1일)에 해가 바뀐 것으로 본다. */
export function currentYearKst(now: Date): number {
  return new Date(now.getTime() + 9 * 3600_000).getUTCFullYear();
}

const codePoints = (s: string): number => [...s].length;

/**
 * 보이지 않거나 화면을 흐트러뜨리는 문자: 제어 문자(탭·줄바꿈 포함), 제로폭·방향 제어 같은 서식 문자,
 * 줄/문단 구분자, 짝 없는 서로게이트, 사설 영역. 닉네임이 다른 사람과 똑같이 "보이게" 꾸미는 데 쓰인다.
 * 이모지를 이어 붙이는 ZWJ(U+200D)와 국기 태그 문자(U+E0020~E007F)는 허용한다.
 * (미할당 문자 Cn 은 막지 않는다: 새로 생긴 이모지가 이 Node 의 유니코드 표에 아직 없을 수 있어서 멀쩡한 닉네임이 거절된다.)
 */
const FORBIDDEN_CHARS = /(?![‍\u{E0020}-\u{E007F}])[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Zl}\p{Zp}]/u;
const MULTI_SPACE = /\s{2,}/u;

export function validateNickname(raw: unknown): Result<string> {
  if (typeof raw !== 'string') return fail('INVALID', '닉네임을 입력해 주세요.');
  const text = raw.normalize('NFC');
  if (FORBIDDEN_CHARS.test(text)) return fail('INVALID', '닉네임에는 줄바꿈·제어 문자나 보이지 않는 문자를 쓸 수 없어요.');
  const nickname = text.trim();
  // 전각 ＠ 도 막는다 (메일 주소처럼 보이게 꾸미는 데 쓰인다)
  if (/[@＠]/u.test(nickname)) return fail('INVALID', '닉네임에는 @를 쓸 수 없어요.');
  const length = codePoints(nickname);
  if (length < NICKNAME_MIN || length > NICKNAME_MAX) {
    return fail('INVALID', `닉네임은 ${NICKNAME_MIN}~${NICKNAME_MAX}자로 입력해 주세요.`);
  }
  if (MULTI_SPACE.test(nickname)) return fail('INVALID', '닉네임에는 공백을 연속해서 쓸 수 없어요.');
  return ok(nickname);
}

/** 비교·저장용 학과 문자열: NFC, 앞뒤 공백 제거, 안쪽 공백 연속은 하나로. 저장된 값과 새 값을 같은 기준으로 맞춘다. */
const tidyDepartment = (text: string): string => text.normalize('NFC').trim().replace(/\s+/gu, ' ');

export function validateDepartment(raw: unknown): Result<string> {
  if (typeof raw !== 'string') return fail('INVALID', '학과를 입력해 주세요.');
  const text = raw.normalize('NFC');
  if (FORBIDDEN_CHARS.test(text)) return fail('INVALID', '학과에는 줄바꿈·제어 문자나 보이지 않는 문자를 쓸 수 없어요.');
  // 학과는 "같은 학과 제외/만" 비교에 쓰이므로 공백 때문에 서로 다른 학과가 되지 않게 정리한다.
  const department = tidyDepartment(text);
  const length = codePoints(department);
  if (length < 1 || length > DEPARTMENT_MAX) return fail('INVALID', `학과는 1~${DEPARTMENT_MAX}자로 입력해 주세요.`);
  return ok(department);
}

/** 검증을 통과한 프로필(정규화된 값). 첫 번째로 틀린 항목을 문장으로 알려 준다. */
export function validateProfileInput(raw: unknown, now: Date = new Date()): Result<ProfileInput> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return fail('INVALID', '프로필 정보가 올바르지 않아요.');
  }
  const b = raw as Record<string, unknown>;

  const nickname = validateNickname(b.nickname);
  if (!nickname.ok) return nickname;

  if (typeof b.college !== 'string' || !(COLLEGES as readonly string[]).includes(b.college)) {
    return fail('INVALID', '단과대를 목록에서 골라 주세요.');
  }

  const department = validateDepartment(b.department);
  if (!department.ok) return department;

  const maxYear = currentYearKst(now);
  if (
    typeof b.admissionYear !== 'number' ||
    !Number.isInteger(b.admissionYear) ||
    b.admissionYear < ADMISSION_YEAR_MIN ||
    b.admissionYear > maxYear
  ) {
    return fail('INVALID', `입학년도는 ${ADMISSION_YEAR_MIN}년부터 ${maxYear}년 사이의 숫자로 입력해 주세요.`);
  }

  const avatar = AVATARS.find((a) => a.key === b.avatar);
  if (typeof b.avatar !== 'string' || !avatar) return fail('INVALID', '아바타를 목록에서 골라 주세요.');

  const avatarColor = AVATAR_COLORS.find((c) => c === b.avatarColor);
  if (typeof b.avatarColor !== 'string' || !avatarColor) return fail('INVALID', '아바타 색을 목록에서 골라 주세요.');

  return ok({
    nickname: nickname.value,
    college: b.college,
    department: department.value,
    admissionYear: b.admissionYear,
    avatar: avatar.key,
    avatarColor,
  });
}

/** `GET /me` 응답. 프로필을 만들기 전에는 `profile: null` + `needsProfile: true`. */
export function toMeResponse(u: LoungeUser): MeResponse {
  return {
    profile: u.profileDone ? toProfile(u) : null,
    needsProfile: !u.profileDone,
    isAdmin: u.isAdmin,
  };
}

// ───────────── 학과 변경 제한 ─────────────
//
// 왜 막나: 학과는 어떤 응답에도 나오지 않고 "같은 학과 제외" 미팅·빠른 매칭의 비교에만 쓰인다.
// 그런데 학과를 아무 때나 바꿀 수 있으면 후보 학과를 하나씩 넣어 보며 "같은 학과는 참여할 수 없는 미팅이에요"가
// 뜨는지 확인하는 것만으로 주최자·참여자의 학과를 알아낼 수 있다(비교 결과가 곧 정답 확인 도구가 된다).
// 그래서 ① 학교 계정으로 확인된 학과(users.school_department)가 있으면 그 값만 쓰게 하고(거짓말·탐색 불가),
// ② 없으면 한 번 정한 학과를 DEPARTMENT_CHANGE_COOLDOWN_DAYS 동안 바꾸지 못하게 한다.
// 거절된 시도는 아무것도 바꾸지 않고 본인 정보만 알려 주므로, 시도 횟수 자체는 정보가 되지 않는다.

export type DepartmentDecision =
  | { kind: 'unchanged' }
  /** why: first = 처음 정함 · school = 학교에서 확인된 학과로 맞춤 · unknown-age = 언제 정했는지 기록이 없는(제한 도입 전) 프로필 · cooldown-over = 기간이 지남 */
  | { kind: 'change'; why: 'first' | 'school' | 'unknown-age' | 'cooldown-over' }
  | { kind: 'must-match-school'; verified: string }
  | { kind: 'locked'; until: Date };

/**
 * 이번 저장에서 학과를 어떻게 다룰지 정하는 순수 함수 (DB·시계 의존 없음).
 *  - current: 저장된 학과(없으면 ''), changedAt: 마지막으로 바꾼 시각(기록이 없으면 null)
 *  - verified: 학교 계정으로 확인된 학과(연동하지 않았으면 null), requested: 검증을 통과한 새 학과
 */
export function decideDepartmentChange(input: {
  current: string;
  changedAt: Date | null;
  verified: string | null;
  requested: string;
  now: Date;
}): DepartmentDecision {
  const current = tidyDepartment(input.current);

  if (input.verified !== null) {
    // 연동한 사용자는 학교가 확인한 학과만 쓴다. 저장된 값이 이미 그것과 달라도(연동 전에 직접 적은 값) 이 값으로 바로잡을 수 있다.
    if (input.requested !== input.verified) return { kind: 'must-match-school', verified: input.verified };
    return current === input.requested ? { kind: 'unchanged' } : { kind: 'change', why: 'school' };
  }

  if (current === input.requested) return { kind: 'unchanged' };
  if (current === '') return { kind: 'change', why: 'first' };
  // 제한이 생기기 전에 만든 프로필은 정한 시점을 알 수 없다 — 한 번은 바꿀 수 있게 두고, 이 변경부터 시각을 남긴다.
  if (input.changedAt === null) return { kind: 'change', why: 'unknown-age' };

  const until = new Date(input.changedAt.getTime() + DEPARTMENT_CHANGE_COOLDOWN_DAYS * DAY_MS);
  return input.now.getTime() >= until.getTime() ? { kind: 'change', why: 'cooldown-over' } : { kind: 'locked', until };
}

/** "10월 8일" (한국 날짜) */
function koreanDate(d: Date): string {
  const kst = new Date(d.getTime() + 9 * 3600_000);
  return `${kst.getUTCMonth() + 1}월 ${kst.getUTCDate()}일`;
}

export const departmentLockedMessage = (until: Date): string =>
  `학과는 한 번 정하면 ${DEPARTMENT_CHANGE_COOLDOWN_DAYS}일 동안 바꿀 수 없어요. ${koreanDate(until)} 이후에 바꿀 수 있어요. ` +
  '학교 계정을 연동하면 학교에서 확인된 학과로 바로 맞출 수 있어요.';

export const departmentMustMatchSchoolMessage = (verified: string): string =>
  `학교 계정으로 확인된 학과(${verified})로만 정할 수 있어요.`;

/**
 * 학과 변경 기록 컬럼(마지막으로 바꾼 시각). 스키마 파일(server/lounge/schema.ts)은 이 작업의 소유가 아니라
 * 여기서 한 번 보장한다 — 멱등이고, 이미 있으면 확인 쿼리 한 번으로 끝난다. 스키마로 옮겨지면 이 함수는 지워도 된다.
 */
let departmentColumnReady: Promise<void> | null = null;
function ensureDepartmentColumn(): Promise<void> {
  if (!departmentColumnReady) {
    departmentColumnReady = (async () => {
      const found = await get<{ x: number }>(
        `SELECT 1 AS x FROM information_schema.columns
          WHERE table_schema = current_schema() AND table_name = 'users' AND column_name = 'department_changed_at'`,
      );
      if (!found) await run('ALTER TABLE users ADD COLUMN IF NOT EXISTS department_changed_at TIMESTAMPTZ');
    })().catch((err: unknown) => {
      departmentColumnReady = null; // 실패를 캐시하면 다음 요청도 영영 못 쓴다
      throw err;
    });
  }
  return departmentColumnReady;
}

type DepartmentState = { department: string; changedAt: Date | string | null; schoolDepartment: string | null };

/** 읽기 → 판단 → 조건부 UPDATE 를 이 횟수까지 반복한다 (그 사이 같은 사용자의 다른 요청이 학과를 바꿨을 때) */
const SAVE_ATTEMPTS = 3;

/**
 * 프로필 만들기·고치기. 평판 컬럼(temperature·warnings·banned)은 SET 에 없으므로 어떤 입력으로도 바뀌지 않는다.
 * 저장하며 profile_done = TRUE.
 *
 * 학과는 위의 규칙(decideDepartmentChange)을 따른다. 판단과 저장 사이에 같은 사용자의 요청이 끼어들어도
 * 제한이 뚫리지 않게 UPDATE 가 "내가 읽은 학과 그대로일 때만" 적용되고, 아니면 다시 읽어 판단한다.
 * (동시에 여러 학과를 보내 한 번에 여러 값을 시험해 보는 방법을 막는다)
 */
export async function saveProfile(userId: string, raw: unknown, now: Date = new Date()): Promise<Result<Profile>> {
  const valid = validateProfileInput(raw, now);
  if (!valid.ok) return valid;
  const p = valid.value;

  const uid = Number(userId);
  if (!Number.isInteger(uid)) return fail('NOT_FOUND');
  await ensureDepartmentColumn();

  for (let attempt = 0; attempt < SAVE_ATTEMPTS; attempt += 1) {
    const state = await get<DepartmentState>(
      `SELECT COALESCE(department, '') AS department, department_changed_at AS "changedAt",
              school_department AS "schoolDepartment"
         FROM users WHERE id = ?`,
      [uid],
    );
    if (!state) return fail('NOT_FOUND');

    // 학교가 준 학과도 우리 규칙(길이·문자)에 맞을 때만 "확인된 값"으로 쓴다. 맞지 않으면 없는 것으로 본다.
    const school = state.schoolDepartment ? validateDepartment(state.schoolDepartment) : null;
    const changedAt = state.changedAt === null ? null : new Date(state.changedAt);
    const decision = decideDepartmentChange({
      current: state.department,
      changedAt: changedAt !== null && Number.isNaN(changedAt.getTime()) ? null : changedAt,
      verified: school?.ok ? school.value : null,
      requested: p.department,
      now,
    });
    if (decision.kind === 'must-match-school') return fail('INVALID', departmentMustMatchSchoolMessage(decision.verified));
    if (decision.kind === 'locked') return fail('FORBIDDEN', departmentLockedMessage(decision.until));

    const { changes } = await run(
      `UPDATE users
          SET nickname = ?, college = ?, department = ?, admission_year = ?,
              avatar = ?, avatar_color = ?, profile_done = TRUE,
              department_changed_at = CASE WHEN ?::boolean THEN ?::timestamptz ELSE department_changed_at END
        WHERE id = ? AND COALESCE(department, '') = ?`,
      [
        p.nickname,
        p.college,
        p.department,
        p.admissionYear,
        p.avatar,
        p.avatarColor,
        decision.kind === 'change',
        now.toISOString(),
        uid,
        state.department,
      ],
    );
    if (changes > 0) {
      const saved = await findUser(uid);
      return saved ? ok(toProfile(saved)) : fail('NOT_FOUND');
    }
    // 0행: 읽은 뒤 학과가 바뀌었거나 계정이 사라졌다. 다시 읽어 새 상태로 판단한다.
  }
  return fail('CONFLICT');
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
