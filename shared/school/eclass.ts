/**
 * e-class(학교 학습관리) 조회 결과 — 읽기 전용. 서버(server/school/eclass*.ts)와 클라이언트가 함께 쓴다.
 * 규칙: 모르는 상태를 "완료"로 취급하지 않는다(unknown 은 화면에 "확인 필요"로 보인다).
 */
export type EclassItemKind = 'lecture' | 'assignment';
export type EclassCompletion = 'pending' | 'completed' | 'unknown';
export type EclassAttendance = 'present' | 'absent' | 'late' | 'unknown' | 'not_applicable';

export interface EclassItem {
  id: string;
  courseId: string;
  courseName: string;
  title: string;
  kind: EclassItemKind;
  /** e-class 안의 주소(https://learn.hansung.ac.kr/…). 화면은 이 호스트인지 다시 확인하고 연다 */
  url: string;
  completion: EclassCompletion;
  attendance: EclassAttendance;
  /** ISO. 마감 시각을 정확히 읽을 수 있을 때만 (날짜만 있으면 null) */
  dueAt: string | null;
  availableAt: string | null;
  /** 진도율 0~100 */
  progress: number | null;
}

export interface EclassSnapshot {
  items: EclassItem[];
  courseCount: number;
  syncedAt: string;
  /** 일부만 확인했거나 형식을 못 읽은 이유 (화면에 그대로 안내한다) */
  warnings: string[];
  /** 원격수업 본인 인증(7일마다)에 막혀 읽지 못한 강좌가 있을 때만. 화면이 카카오 알림톡 인증을 대신 진행한다 */
  verification?: EclassVerification | null;
}

/**
 * e-class 원격수업 본인 인증(코스모스 ruauth) 화면에서 읽은 값. 인증 화면이 브라우저에서 하는 일을 앱이 그대로 한다:
 * ruauth 서버에 소켓으로 붙으면 알림톡이 가고, 받은 코드를 넣거나 링크를 누르면 'authorized' 가 온다.
 * token 에는 본인의 학교 사용자 번호·전화번호·이메일이 들어 있다 — 로그·기기 저장소에 남기지 않는다.
 */
export interface EclassVerification {
  token: string;
  organizationCode: string;
  /** 예: COURSE-48668 (인증 완료를 e-class 에 알릴 때 같이 보낸다) */
  ruauthData: string;
  /** 인증에 막혀 읽지 못한 강좌 이름 */
  courses: string[];
}
