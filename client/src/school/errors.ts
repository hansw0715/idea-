/**
 * 학교 연동 오류 → 한국어 문구. 서버 오류 코드(ApiError.code)로만 분기하고, 학번·비밀번호는 다루지 않는다.
 * 설계: docs/school/00-design.md §7, docs/school/tasks/C5-client.md "오류"
 *
 * react 를 불러오지 않는다 — vault/linkFlow 단위 테스트가 Node 에서 이 파일을 그대로 쓴다.
 */
import { ApiError } from '../api';

/** 저장소를 못 쓸 때의 안내. 어떻게 하면 되는지까지 말한다. */
export const STORAGE_UNAVAILABLE_MESSAGE =
  '이 브라우저는 저장소를 쓸 수 없어 학교 연동을 쓸 수 없어요. 사생활 보호(시크릿) 모드를 끄거나 사이트 데이터 차단을 풀고 다시 시도해 주세요.';

/** 암호화 기능(WebCrypto)이 없는 주소(보안 연결이 아닌 http 등)일 때의 안내 */
export const CRYPTO_UNAVAILABLE_MESSAGE =
  '이 주소에서는 암호화 기능을 쓸 수 없어 학교 연동을 쓸 수 없어요. 보안 연결(https) 주소로 접속해 주세요.';

/**
 * 이 기기에서 학교 계정 정보를 풀 수 없다. 키가 없거나, 키가 암호문과 맞지 않거나, 암호문이 변조되었거나,
 * 다른 계정의 암호문이어도 **모두 같은 문구**다 — 원인을 구분해 알려 주지 않는다(공격자에게 단서를 주지 않는다).
 */
export class SchoolKeyMissingError extends Error {
  constructor() {
    super('이 기기에서는 학교 계정 정보를 풀 수 없어요. 로그아웃한 뒤 다시 로그인하면 이 기기에서도 쓸 수 있어요. 그래도 안 되면 학교 계정을 다시 연동해 주세요.');
    this.name = 'SchoolKeyMissingError';
  }
}

/** localStorage 를 못 쓰거나(프라이빗 모드·차단) 암호화 기능이 없어 키를 만들거나 보관할 수 없다 */
export class SchoolStorageUnavailableError extends Error {
  constructor(message: string = STORAGE_UNAVAILABLE_MESSAGE) {
    super(message);
    this.name = 'SchoolStorageUnavailableError';
  }
}

export type SchoolFailureKind =
  | 'auth-failed' // 학번/비밀번호가 맞지 않음 — 다시 시도하기 전에 학교 포털에서 확인
  | 'locked' // 실패가 쌓여 잠시 멈춤 (시간이 지나면 풀림)
  | 'locked-long' // 안전선 멈춤 (시간이 아니라 새 비밀번호로 다시 연동해야 풀림)
  | 'unavailable' // 학교 사이트 응답 없음·구조 변경
  | 'rejected' // 학교 서버 검증 실패 (학교가 준 문장)
  | 'not-linked'
  | 'key-missing'
  | 'storage'
  | 'rate-limited'
  | 'invalid'
  | 'not-found'
  | 'forbidden'
  | 'network'
  | 'unknown';

const AUTH_FAILED_MESSAGE =
  '학번 또는 비밀번호가 맞지 않아요. 다시 시도하기 전에 학교 포털에서 먼저 로그인해 확인해 주세요. 10번 틀리면 계정이 잠겨요.';

const UNAVAILABLE_MESSAGE =
  '학교 사이트가 지금 응답하지 않거나 화면이 바뀌어 읽지 못했어요. 잠시 후 다시 시도해 주세요. 계속 안 되면 학교 사이트에서 직접 이용해 주세요.';

const LONG_LOCK_MESSAGE =
  '학교 계정이 잠기지 않도록 학교 로그인을 멈췄어요. 학교 포털에서 직접 로그인해 비밀번호를 확인한 뒤 다시 연동해 주세요.';

/** SCHOOL_LOCKED 본문의 추가 필드 (타입은 shared/school/types 의 SchoolLockedDetail). 없는 값은 비워 둔다 */
export function lockedDetail(err: unknown): { retryAfterSec?: number; long?: boolean } {
  if (!(err instanceof ApiError) || !err.data) return {};
  const { retryAfterSec, long } = err.data;
  return {
    retryAfterSec: typeof retryAfterSec === 'number' && Number.isFinite(retryAfterSec) ? retryAfterSec : undefined,
    long: typeof long === 'boolean' ? long : undefined,
  };
}

export function classifySchoolError(err: unknown): SchoolFailureKind {
  if (err instanceof SchoolKeyMissingError) return 'key-missing';
  if (err instanceof SchoolStorageUnavailableError) return 'storage';
  if (!(err instanceof ApiError)) return 'unknown';
  // 코드가 상태코드보다 정확하다 (SCHOOL_LOCKED 도 429 라서 RATE_LIMITED 와 구분해야 한다)
  switch (err.code) {
    case 'SCHOOL_AUTH_FAILED':
      return 'auth-failed';
    case 'SCHOOL_LOCKED':
      return lockedDetail(err).long ? 'locked-long' : 'locked';
    case 'SCHOOL_UNAVAILABLE':
      return 'unavailable';
    case 'SCHOOL_REJECTED':
      return 'rejected';
    case 'SCHOOL_NOT_LINKED':
      return 'not-linked';
    case 'RATE_LIMITED':
      return 'rate-limited';
    case 'INVALID':
      return 'invalid';
    case 'NOT_FOUND':
      return 'not-found';
    case 'FORBIDDEN':
      return 'forbidden';
  }
  if (err.status === 0) return 'network';
  if (err.status === 429) return 'rate-limited';
  if (err.status === 400) return 'invalid';
  if (err.status === 403) return 'forbidden';
  if (err.status === 404) return 'not-found';
  return 'unknown';
}

/** 30분처럼 사람이 읽는 대기 시간. 모르면 서버 기본 잠금(30분)으로 안내한다 */
function waitText(sec: number | undefined): string {
  const minutes = sec !== undefined && sec > 0 ? Math.max(1, Math.ceil(sec / 60)) : 30;
  if (minutes >= 120) return `${Math.ceil(minutes / 60)}시간`;
  return `${minutes}분`;
}

/** 화면에 그대로 보여 줄 문장 (무엇이 / 왜 / 어떻게). 학번·비밀번호는 들어 있지 않다 */
export function schoolErrorMessage(err: unknown): string {
  const kind = classifySchoolError(err);
  const raw = err instanceof Error ? err.message : '';
  switch (kind) {
    case 'key-missing':
    case 'storage':
      return raw;
    case 'auth-failed':
      return AUTH_FAILED_MESSAGE;
    case 'locked':
      return `학교 계정이 잠기지 않도록 학교 로그인을 잠시 멈췄어요. ${waitText(lockedDetail(err).retryAfterSec)} 뒤에 다시 시도할 수 있어요.`;
    case 'locked-long':
      // 서버가 "운영자에게 알려 주세요"처럼 상황에 맞는 문장을 줄 때는 그것을 쓴다
      return raw.includes('학교 포털') ? raw : LONG_LOCK_MESSAGE;
    case 'unavailable':
      return UNAVAILABLE_MESSAGE;
    case 'rejected':
      // 학교가 준 문장을 그대로 보여 준다 (필수 항목 누락, 이미 예약됨 등)
      return raw || '학교에서 요청을 받아들이지 않았어요. 입력한 내용을 확인한 뒤 다시 시도해 주세요.';
    case 'not-linked':
      return raw || '학교 계정이 연동되어 있지 않아요. 먼저 학교 계정을 연동해 주세요.';
    default:
      return raw || '요청을 처리하지 못했어요. 잠시 후 다시 시도해 주세요.';
  }
}

/**
 * 저장된 학교 계정 정보로는 더 진행할 수 없어 "다시 연동"이 필요한가.
 * (일시 잠금 `locked` 는 기다리면 풀리므로 포함하지 않는다)
 */
export function needsRelink(err: unknown): boolean {
  const kind = classifySchoolError(err);
  return kind === 'auth-failed' || kind === 'locked-long' || kind === 'not-linked' || kind === 'key-missing';
}

/** 사용자가 직접 "다시 시도하기"를 눌러 볼 만한 오류인가 (자동 재시도는 어떤 경우에도 하지 않는다) */
export function isRetryable(err: unknown): boolean {
  const kind = classifySchoolError(err);
  return kind === 'unavailable' || kind === 'network' || kind === 'unknown';
}

/** 로그인 계열 실패: 학교 쪽 실패 횟수가 쌓이는 오류. 상태를 다시 불러와 화면을 맞춘다 */
export function isCredentialFailure(err: unknown): boolean {
  const kind = classifySchoolError(err);
  return kind === 'auth-failed' || kind === 'locked' || kind === 'locked-long';
}

/**
 * 신청 제출 요청이 학교에 **갔는지 알 수 없는** 오류인가.
 * 연결이 끊기거나(상태 0) 서버가 코드 없는 5xx 를 준 경우다. 이때는 보냈을 수 있으므로 같은 신청을 다시 보내지 않는다.
 * 코드가 있는 오류(422 SCHOOL_REJECTED, 502 SCHOOL_UNAVAILABLE 등)는 서버가 제출 전에 멈춘 것이다.
 */
export function isAmbiguousSend(err: unknown): boolean {
  if (!(err instanceof ApiError)) return false;
  return err.status === 0 || (err.status >= 500 && !err.code);
}
