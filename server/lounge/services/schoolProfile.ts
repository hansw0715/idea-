/**
 * 라운지 프로필 = 연동한 학교 계정에서 읽어 온 사실 (이름·학과·입학년도).
 * 사용자가 직접 입력하지 않는다. 가입·연동·`GET /me`(옛 계정)에서 이 모듈이 users 의 프로필 컬럼을 채운다.
 *
 *  - nickname        실명을 가린 표기: 첫·끝 글자를 남기고 가운데를 '○' ("박민재" → "박○재")
 *  - department      users.school_department (없으면 '')
 *  - admission_year  users.school_admission_year (없으면 NULL)
 *  - college         학교에서 읽을 수 없어 항상 ''
 *  - avatar·color    이미 있으면 그대로, 없으면 기본값
 *
 * auth.ts(가입)·school/service.ts(연동)가 불러 쓰므로 db.js 와 공유 상수 말고는 아무것도 가져오지 않는다 (순환 방지).
 */
import { get, run } from '../../db.js';
import { NICKNAME_MAX } from '../../../shared/lounge/constants.js';

/** 학과 문자열 길이 상한 (라운지 화면·비교용) */
export const DEPARTMENT_MAX = 30;
/** 이름을 읽을 수 없을 때(빈 이름)의 닉네임 */
const FALLBACK_NICKNAME = '학생';
const MASK = '○';

/** NFC, 앞뒤 공백 제거, 안쪽 공백 연속은 하나로 — "같은 학과" 비교가 공백·자모 분리 때문에 어긋나지 않게 */
export const tidyDepartment = (text: string): string => text.normalize('NFC').trim().replace(/\s+/gu, ' ');

/**
 * 실명을 가린 닉네임. 가운데 글자를 '○' 로 바꾸고 첫 글자와 끝 글자는 남긴다 (코드포인트 기준): "이윤수" → "이○수".
 * 두 글자는 "이○", 한 글자는 그대로, 8자를 넘으면 앞 8글자만 쓴다.
 */
export function maskName(name: string): string {
  const chars = [...name.normalize('NFC').trim()];
  if (chars.length === 0) return FALLBACK_NICKNAME;
  let masked: string;
  if (chars.length === 1) masked = chars[0]!;
  else if (chars.length === 2) masked = chars[0]! + MASK;
  else masked = chars[0]! + MASK.repeat(chars.length - 2) + chars[chars.length - 1]!;
  return [...masked].slice(0, NICKNAME_MAX).join('');
}

/** 학교 계정에서 온 값 → users 프로필 컬럼 값 */
export function schoolProfileValues(input: { name: string; department?: string | null; admissionYear?: number | null }): {
  nickname: string;
  department: string;
  admissionYear: number | null;
} {
  const department = [...tidyDepartment(input.department ?? '')].slice(0, DEPARTMENT_MAX).join('');
  const year = input.admissionYear;
  return {
    nickname: maskName(input.name),
    department,
    admissionYear: typeof year === 'number' && Number.isInteger(year) ? year : null,
  };
}

interface LinkedRow {
  name: string;
  school_department: string | null;
  school_admission_year: number | null;
  linked: boolean;
}

/**
 * 학교 연동이 있는 사용자의 라운지 프로필을 학교 계정 정보로 (다시) 채우고 profile_done = TRUE 로 둔다.
 * 연동이 없으면(school_cipher·school_student_hash 가 NULL) 아무것도 바꾸지 않고 false.
 * 멱등이다: 몇 번을 불러도 같은 결과이고, 재연동으로 학과·입학년도가 바뀌면 그 값으로 갱신된다.
 */
export async function ensureSchoolProfile(userId: string | number): Promise<boolean> {
  const uid = Number(userId);
  if (!Number.isInteger(uid)) return false;
  const row = await get<LinkedRow>(
    `SELECT name, school_department, school_admission_year,
            (school_cipher IS NOT NULL AND school_student_hash IS NOT NULL) AS linked
       FROM users WHERE id = ?`,
    [uid],
  );
  if (!row || !row.linked) return false;

  const v = schoolProfileValues({
    name: row.name,
    department: row.school_department,
    admissionYear: row.school_admission_year,
  });
  const { changes } = await run(
    `UPDATE users
        SET nickname = ?, department = ?, admission_year = ?, college = '',
            avatar = COALESCE(avatar, 'turtle-smile'), avatar_color = COALESCE(avatar_color, 'm1'),
            profile_done = TRUE
      WHERE id = ?`,
    [v.nickname, v.department, v.admissionYear, uid],
  );
  return changes > 0;
}
