/**
 * 학교 계정 연동 공용 계약 — 서버(`server/school`)와 클라이언트(`client/src/school`)가 함께 쓴다.
 * 설계: docs/school/00-design.md
 *
 * 핵심 약속
 *  - 학교 아이디·비밀번호는 브라우저에서 AES-GCM 으로 봉인(SealedBox)되어 서버에는 **암호문만** 저장된다.
 *  - 복호화 키는 이 브라우저의 localStorage 에만 있다. 서버는 키를 모른다.
 *  - 학교 사이트와 상호작용이 필요할 때만 브라우저가 풀어서 그 요청 본문(SchoolCredentials)에 실어 보내고,
 *    서버는 그 요청 안에서만 쓰고 버린다. (저장·로그·캐시 금지)
 */

/** 브라우저가 만든 암호문 (AES-GCM 256). 서버는 형식만 검사하고 풀지 못한다. */
export type SealedBox = {
  /**
   * 형식 버전. 2 = 키를 플랫폼 아이디·비밀번호에서 브라우저가 만든다(여러 기기에서 같은 키).
   * 1 = 옛 방식(기기마다 무작위 키) — 이 암호문은 이 방식으로는 더 풀 수 없어 다시 연동해야 한다.
   */
  v: 1 | 2;
  /** base64, 12바이트 초기화 벡터 */
  iv: string;
  /** base64, 암호문+인증 태그 */
  ct: string;
};

/** 봉인 전/후의 평문. 요청 본문에 실릴 때만 존재한다. */
export type SchoolCredentials = {
  /** 학번 (숫자 6~10자리) */
  studentId: string;
  password: string;
};

/** `GET /api/school/link` */
export type LinkStatus = {
  linked: boolean;
  /** 학번 끝 3자리 등 화면 표시용 힌트 (예: "***044"). 연동 전이면 null */
  hint: string | null;
  linkedAt: string | null;
  /** 브라우저가 풀어 쓸 암호문. 연동 전이면 null */
  cipher: SealedBox | null;
  /** 연동할 때 읽은 학과·입학년도. 라운지 프로필 만들기에서 기본값으로 쓴다. (비밀이 아님) */
  profileHint: { department: string; admissionYear: number | null } | null;
};

/** 학교 포털에서 읽은 내 정보 */
export type SchoolProfile = {
  studentId: string;
  name: string;
  /** 소속 학과/전공 (포털 상단 표시). 못 읽으면 빈 문자열 */
  department: string;
  /** 학번 앞자리로 추정한 입학년도. 모르면 null */
  admissionYear: number | null;
  /** 포털 화면에 성별이 나와 있으면 그 값. 못 읽으면 null (그때는 내 정보에서 직접 고른다) */
  gender?: 'male' | 'female' | null;
};

/** `POST /api/school/link` 본문 — creds 로 학교에 한 번 로그인해 보고, 성공하면 cipher 를 저장한다 */
export type LinkRequest = {
  creds: SchoolCredentials;
  cipher: SealedBox;
};
export type LinkResponse = {
  linked: true;
  hint: string;
  profile: SchoolProfile;
};

/** 학교 개인시간표의 수업 한 칸 */
export type SchoolClass = {
  /** 0=월 ~ 4=금 */
  day: number;
  /** "HH:mm" */
  start: string;
  end: string;
  subject: string;
  /** 분반 (없으면 빈 문자열) */
  section: string;
  professor: string;
  room: string;
};

/** `POST /api/school/timetable/preview` */
export type TimetablePreview = {
  profile: SchoolProfile;
  classes: SchoolClass[];
  /** 30분 격자에 맞추려고 시간을 조정한 수업 수 */
  adjusted: number;
  /** 저장하지 않고 건너뛸 항목과 이유 (주말·운영시간 밖 등) */
  skipped: { subject: string; reason: string }[];
};

/** `POST /api/school/timetable/import` — 학교에서 가져온 기존 일정을 모두 바꿔 넣는다 */
export type TimetableImportResult = {
  imported: number;
  /** 이전에 가져왔던 일정을 지운 수 */
  replaced: number;
  adjusted: number;
  skipped: { subject: string; reason: string }[];
};

/** 학교 예약 시스템의 내 신청내역 한 줄 */
export type SchoolReservation = {
  /** 예약 시스템 키 "<사이트>/<기능번호>" 예: cncschool/2 */
  facility: string;
  facilityLabel: string;
  no: string;
  space: string;
  date: string;
  time: string;
  status: string;
  applied: string;
};

/** `POST /api/school/reservations` */
export type MyReservationsResult = {
  reservations: SchoolReservation[];
  /** 조회하지 못한 시스템(점검·구조 변경 등)과 이유 */
  failed: { facility: string; reason: string }[];
};

/** 학교 신청서의 추가 항목 (예: 소속, 사용 목적) */
export type BookItem = { name: string; required: boolean };

/** `POST /api/school/book/preview` — 우리 앱의 예약 계획(reservationId)을 학교에 신청하기 전 미리보기 */
export type BookPreview = {
  reservationId: number;
  /** 학교 시스템 이름 + 공간 */
  title: string;
  /** "10월 12일 (월) 10:00~12:00 (60분 × 2칸)" */
  when: string;
  applicant: { name: string; studentId: string; tel: string; email: string };
  /** 신청 대상 제한 (예: 학사(재학생)) */
  identities: string[];
  /** 학교 담당 */
  manager: string;
  /** 사용자가 채워야 할 추가 항목 */
  items: BookItem[];
  /** 지금 신청할 수 있는가. false 면 reason 을 그대로 보여 준다. */
  canBook: boolean;
  reason: string | null;
  /** 이미 이 계획으로 신청을 보낸 적이 있는가 (중복 제출 방지 안내) */
  alreadySubmitted: boolean;
};

/** `POST /api/school/book/submit` — 미리보기를 본 사용자가 명시적으로 누른 경우에만 */
export type BookSubmitRequest = {
  creds: SchoolCredentials;
  reservationId: number;
  /** 추가 항목 값 (항목 이름 → 값) */
  items: Record<string, string>;
  tel?: string;
  email?: string;
};

/**
 * 신청 결과. 학교 응답 코드만 믿지 않고 "내 신청내역"에서 다시 확인한 결과를 돌려준다.
 *  - confirmed : 신청내역에서 확인됨 (우리 앱 예약 상태도 학교 확인됨으로 바뀜)
 *  - unknown   : 보냈지만 신청내역에서 확인하지 못함 → 자동으로 다시 보내지 않고 학교 사이트에서 확인하게 한다
 */
export type BookResult = {
  status: 'confirmed' | 'unknown';
  message: string;
  found: SchoolReservation[];
};

/**
 * `POST /api/school/book/cancel` {creds, reservationId} — 학교에 보낸 신청을 학교 신청내역의 "취소"로 취소한다.
 *  - 'cancelled': 학교에서 취소된 것을 신청내역으로 확인했다.
 *  - 'nothing-to-cancel': 이 예약은 학교에 보낸 신청이 없거나 학교 신청내역에 이미 없다 (앱의 기록만 지우면 된다).
 * 앱이 쓸 수 있는 취소 방법을 못 찾거나 확인하지 못하면 502 SCHOOL_UNAVAILABLE 로 학교 사이트에서 직접 취소하라고 안내한다.
 */
export type BookCancelResult = { status: 'cancelled' | 'nothing-to-cancel'; message: string };

/** 서버가 돌려주는 학교 관련 오류 코드 (ApiError.code) */
export type SchoolErrorCode =
  | 'SCHOOL_NOT_LINKED' // 연동 안 됨
  | 'SCHOOL_AUTH_FAILED' // 학번/비밀번호가 맞지 않음 (재시도 전 확인 필요)
  | 'SCHOOL_LOCKED' // 실패가 쌓여 안전을 위해 잠시 멈춤
  | 'SCHOOL_UNAVAILABLE' // 학교 사이트 응답 없음·구조 변경
  | 'SCHOOL_REJECTED'; // 학교 서버 검증 실패 (필수 항목 누락, 이미 예약됨 등)

/** 학교 API 가 위 코드 말고도 돌려주는 일반 코드. 모르는 코드는 상태코드·메시지로 처리한다. */
export type SchoolGeneralErrorCode = 'INVALID' | 'NOT_FOUND' | 'FORBIDDEN' | 'RATE_LIMITED';

/**
 * SCHOOL_LOCKED 응답 본문의 추가 필드 (+ Retry-After 헤더).
 * long=true 는 24시간 안전선 잠금 — "학교 포털에서 직접 로그인해 비밀번호를 확인한 뒤 다시 연동" 안내가 필요하다.
 */
export interface SchoolLockedDetail {
  retryAfterSec: number;
  long: boolean;
}

export const SCHOOL_PASSWORD_WARNING =
  '학교 포털은 비밀번호를 10번 틀리면 계정이 잠겨요. 한 번 입력할 때 정확히 확인해 주세요.';

/** 학번 형식 검사 (숫자 6~10자리) */
export const isStudentId = (v: string): boolean => /^\d{6,10}$/.test(v);

/** 화면 표시용 학번 힌트: 끝 3자리만 보인다 */
export const studentIdHint = (id: string): string => `${'*'.repeat(Math.max(0, id.length - 3))}${id.slice(-3)}`;

/**
 * 가입 순서: ① 학교 계정(학번·포털 비밀번호)으로 학생 인증 → ② 플랫폼 아이디·비밀번호 입력 → ③ 연동 동의 → ④ 가입 완료.
 *
 * ① `POST /api/auth/school-verify` — 서버가 학교에 한 번 로그인해 보고(학생 인증), 성공하면 "인증 확인표(ticket)"를 준다.
 *    학교 계정 평문은 이 요청 본문에만 실리고 서버는 쓰고 버린다. ticket 은 서버가 서명한 15분짜리 증표다.
 */
export type SchoolVerifyRequest = SchoolCredentials;
export type SchoolVerifyResponse = {
  ticket: string;
  /** 학번 끝 3자리 힌트 (예: "***044") */
  hint: string;
  /** 학교에서 읽은 내 정보 — 확인 화면에 보여 주고, 가입하면 이름이 계정 이름이 된다 */
  profile: SchoolProfile;
};

/**
 * ③④ `POST /api/auth/signup` 본문 — ticket 이 유효하면 계정을 만들고 cipher 를 함께 저장한다(연동 완료).
 * cipher 는 브라우저가 "플랫폼 아이디+비밀번호에서 만든 키"로 봉인한 학교 계정(v: 2)이다. 서버는 풀지 못한다.
 * 학교 계정 평문은 이 요청에 없다(이미 ①에서 인증했다).
 */
export type SchoolSignupRequest = {
  ticket: string;
  username: string;
  password: string;
  cipher: SealedBox;
  /** 가입 때 고른 성별 (미팅 자리에 쓴다). 학교에서 읽은 값이 있으면 그쪽이 우선이다 */
  gender?: 'male' | 'female';
};
