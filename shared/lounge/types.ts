/**
 * 라운지 공용 기본 타입 — 서버(`server/lounge`)와 클라이언트(`client/src/lounge`)가 함께 쓰는 계약.
 * 이 폴더(shared/lounge)는 둘 다 import 하므로, 고칠 때는 양쪽이 같이 컴파일되는지 확인한다.
 *
 * 상대 import 는 NodeNext(서버)와 bundler(클라이언트) 양쪽에서 읽히도록 항상 `.js` 확장자를 붙인다.
 */

/** ISO 8601 문자열. Date 객체 대신 문자열로 다뤄야 서버/클라이언트 직렬화가 안 깨진다. */
export type ISODateTime = string;

/** 사용자 id. DB 의 users.id(정수)를 문자열로 쓴다. */
export type UserId = string;
export type GatheringId = string;

/**
 * 도메인 로직은 예외를 던지지 않고 Result 를 돌려준다.
 * "정원이 찼다", "마감됐다" 는 버그가 아니라 정상적인 실패라서 UI 가 코드별로 다른 문구를 보여 줘야 하기 때문.
 */
export type Ok<T> = { ok: true; value: T };
export type Err<E = AppError> = { ok: false; error: E };
export type Result<T, E = AppError> = Ok<T> | Err<E>;

export const ok = <T>(value: T): Ok<T> => ({ ok: true, value });
export const err = <E>(error: E): Err<E> => ({ ok: false, error });

export type AppError = { code: ErrorCode; message: string };

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
  BANNED: '노쇼 경고가 쌓여 이용이 정지된 계정입니다.',
  /** 라운지는 닉네임·학과 등 프로필을 만든 뒤에 쓸 수 있다. 클라이언트는 이 코드를 보면 프로필 시트를 연다. */
  PROFILE_REQUIRED: '라운지 프로필을 먼저 만들어 주세요.',
  /** 동시에 같은 모임을 고친 경우. 서버가 내부에서 다시 시도하고, 끝내 실패하면 이 코드를 돌려준다. */
  CONFLICT: '다른 사람이 먼저 바꿨어요. 잠시 후 다시 시도해 주세요.',
} as const;

export type ErrorCode = keyof typeof ERROR_MESSAGES;

export const fail = (code: ErrorCode, message?: string): Err<AppError> =>
  err({ code, message: message ?? ERROR_MESSAGES[code] });

/** HTTP 상태 코드 매핑 (서버 라우터가 사용) */
export const ERROR_STATUS: Record<ErrorCode, number> = {
  NOT_FOUND: 404,
  FORBIDDEN: 403,
  NOT_OPEN: 409,
  DEADLINE_PASSED: 409,
  ALREADY_JOINED: 409,
  NOT_JOINED: 409,
  SLOT_NOT_FOUND: 404,
  SLOT_FULL: 409,
  HOST_CANNOT_LEAVE: 409,
  NOT_APPLICANT: 409,
  TOO_EARLY: 409,
  INVALID: 400,
  BANNED: 403,
  PROFILE_REQUIRED: 428,
  CONFLICT: 409,
};
