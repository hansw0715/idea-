export interface User {
  id: number;
  email: string;
  name: string;
  /** 운영용으로 미리 만들어 둔 계정. 탈퇴할 수 없다. */
  isAdmin?: boolean;
}

export interface TimetableEntry {
  id: number;
  day: number;
  startMin: number;
  endMin: number;
  title: string;
  place: string;
  /** 'weekly' = 매주 반복, 'once' = date 에 적힌 그 날만 */
  repeatKind?: 'weekly' | 'once';
  /** 'once' 일 때의 날짜 'YYYY-MM-DD' */
  date?: string | null;
}

export interface MemberTimetableEntry extends TimetableEntry {
  memberId: number;
}

export interface Meeting {
  id: number;
  name: string;
  code: string;
  ownerId: number;
  createdAt: string;
  memberCount?: number;
}

export interface Member {
  id: number;
  name: string;
  email: string;
  isOwner: number;
}

export interface MeetingDetailData extends Meeting {
  members: Member[];
}

export interface FreeSlot {
  day: number;
  start: number;
  end: number;
}

export interface Facility {
  id: number;
  name: string;
  building: string;
  /** 학교 안내에 인원 기준이 없는 시설은 null */
  minCapacity: number | null;
  capacity: number | null;
  description: string | null;
  /** 어느 예약 시스템 소속인지 (학술정보관 / 상상베이스 / 상상파크플러스) */
  systemLabel: string | null;
  reserveUrl: string | null;
  contact: string | null;
  available?: boolean;
  /** 우리 앱에서 이미 잡아 둔 계획인지 */
  plannedHere?: boolean;
  /** 학교 시스템 기준 상태 */
  campusState?: 'reserved' | 'closed' | null;
}

export interface FacilityResponse {
  facilities: Facility[];
  /** 참여 인원 조건에 안 맞아 목록에서 뺀 시설 수 */
  hiddenByCapacity?: number;
  /** 'ok' = 학교 현황 반영됨, 'unavailable' = 조회 실패, 'skipped' = 조회 안 함 */
  campusStatus: 'ok' | 'unavailable' | 'skipped';
}

export interface Reservation {
  id: number;
  date: string;
  startMin: number;
  endMin: number;
  facilityId: number;
  facilityName: string;
  building: string;
  meetingId: number;
  meetingName: string;
  userId: number;
  userName: string;
}
