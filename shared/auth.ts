/**
 * 플랫폼 계정(아이디·비밀번호) 공용 규칙 — 서버(server/auth.ts)와 클라이언트(가입·로그인 화면, 키 만들기)가 함께 쓴다.
 * 규칙을 두 군데에 적으면 반드시 어긋나므로 한 곳에서만 정한다.
 */

export const USERNAME_MIN = 4;
export const USERNAME_MAX = 20;
/** 영문 소문자·숫자·밑줄(_)만, 4~20자. 가입 때만 검사한다(옛 계정의 아이디는 이 규칙과 달라도 로그인할 수 있다). */
export const USERNAME_RE = /^[a-z0-9_]{4,20}$/;

/** bcrypt 는 72바이트 뒤를 잘라 버리므로 한글(3바이트)을 섞어도 안전하도록 글자 수를 제한한다. */
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 64;

/** 아이디 비교·저장용 정규형: 앞뒤 공백 제거 + 소문자 + NFC. 학교 메일 꼴(`아이디@hansung.ac.kr`)로 적어도 앞부분만 쓴다. */
export function normalizeUsername(value: unknown): string {
  if (typeof value !== 'string') return '';
  let v = value.normalize('NFC').trim().toLowerCase();
  const at = v.indexOf('@');
  if (at > 0 && v.slice(at + 1) === 'hansung.ac.kr') v = v.slice(0, at);
  return v;
}

/**
 * 관리자 로그인 머리말. 지정한 관리자 아이디(예: dedea715)를 "admin_dedea715" 로, 비밀번호는 원래 것으로 로그인하면
 * 그 계정이 관리자 모드로 열린다 (server/auth.ts). 그래서 이 머리말로 시작하는 아이디는 새로 가입할 수 없다.
 */
export const ADMIN_LOGIN_PREFIX = 'admin_';

/** 가입 때의 아이디 검사. 문제가 없으면 null, 있으면 화면에 그대로 보여 줄 문장 */
export function usernameError(raw: unknown): string | null {
  const u = normalizeUsername(raw);
  if (u.length === 0) return '아이디를 입력해 주세요.';
  if (!USERNAME_RE.test(u)) return `아이디는 영문 소문자·숫자·밑줄(_)로 ${USERNAME_MIN}~${USERNAME_MAX}자여야 해요.`;
  if (u.startsWith(ADMIN_LOGIN_PREFIX)) return `'${ADMIN_LOGIN_PREFIX}'로 시작하는 아이디는 쓸 수 없어요.`;
  return null;
}

/** 가입 때의 비밀번호 검사 */
export function passwordError(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length === 0) return '비밀번호를 입력해 주세요.';
  if (raw.length < PASSWORD_MIN) return `비밀번호는 ${PASSWORD_MIN}자 이상이어야 해요.`;
  if (raw.length > PASSWORD_MAX) return `비밀번호는 ${PASSWORD_MAX}자 이하여야 해요.`;
  return null;
}

/** 클라이언트로 내보내는 로그인 사용자 정보 (비밀번호 해시는 절대 포함하지 않는다) */
export interface AuthUser {
  id: number;
  /** 로그인 아이디 */
  username: string;
  /** 이름. 학교 계정으로 인증한 사용자는 학교에서 확인한 이름 */
  name: string;
  isAdmin: boolean;
  /** 학교 메일로 가입한 옛 계정만 있다. 새 가입은 null */
  email: string | null;
}
