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
}
