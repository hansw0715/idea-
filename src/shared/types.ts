/**
 * 공용 기본 타입. (담당: 공용 — 변경 시 팀 전체 공지)
 *
 * 이 파일과 shared/ 아래 파일들은 미팅/밥약(한승원), 팀빌딩/시설예약(담당자) 모두가
 * import 하는 계약(contract) 레이어다. 각자 기능 코드는 features/ 아래에서만 만들고
 * 여기는 합의 후에만 고친다. 그래야 나중에 머지할 때 충돌이 안 난다.
 */

/** ISO 8601 문자열. Date 객체 대신 문자열로 다뤄야 서버/클라이언트 직렬화가 안 깨진다. */
export type ISODateTime = string;

export type UserId = string & { readonly __brand: 'UserId' };
export type GatheringId = string & { readonly __brand: 'GatheringId' };

export const asUserId = (v: string) => v as UserId;
export const asGatheringId = (v: string) => v as GatheringId;

/**
 * 도메인 로직은 예외를 던지지 않고 Result를 돌려준다.
 * 이유: "정원이 찼다", "마감됐다" 같은 건 버그가 아니라 정상적인 실패라서
 * UI가 에러 코드별로 다른 문구를 보여줘야 하기 때문.
 */
export type Ok<T> = { ok: true; value: T };
export type Err<E = AppError> = { ok: false; error: E };
export type Result<T, E = AppError> = Ok<T> | Err<E>;

export const ok = <T>(value: T): Ok<T> => ({ ok: true, value });
export const err = <E>(error: E): Err<E> => ({ ok: false, error });

export type AppError = {
  code: ErrorCode;
  message: string;
};

export const ERROR_MESSAGES = {
  NOT_FOUND: '존재하지 않습니다.',
  FORBIDDEN: '권한이 없습니다.',
  NOT_OPEN: '지금은 참여할 수 없는 상태입니다.',
  DEADLINE_PASSED: '신청 마감 시간이 지났습니다.',
  ALREADY_JOINED: '이미 참여 중입니다.',
  NOT_JOINED: '참여하지 않은 모임입니다.',
  SLOT_NOT_FOUND: '그런 자리는 없습니다.',
  SLOT_FULL: '이미 다른 사람이 앉았습니다.',
  HOST_CANNOT_LEAVE: '주최자는 나갈 수 없습니다. 모임을 취소해 주세요.',
  NOT_APPLICANT: '신청자가 아닙니다.',
  TOO_EARLY: '아직 모임 시작 전입니다.',
  INVALID: '입력값이 올바르지 않습니다.',
  LOW_TRUST: '노쇼 기록이 많아 참여가 제한되었습니다.',
} as const;

export type ErrorCode = keyof typeof ERROR_MESSAGES;

export const fail = (code: ErrorCode, message?: string): Err<AppError> =>
  err({ code, message: message ?? ERROR_MESSAGES[code] });
