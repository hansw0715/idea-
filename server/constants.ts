// 시간은 자정 기준 '분' 단위 정수로 다룬다. (예: 09:00 = 540)
export const OPEN_MIN = 540; // 09:00
// 시간표에 적을 수 있는 범위. 야간 수업·아르바이트까지 담을 수 있게 24시까지 둔다.
export const CLOSE_MIN = 1440; // 24:00
// 시설 예약·공통 여유 시간도 같은 22시까지 다룬다.
export const RESERVE_CLOSE_MIN = 1320; // 22:00
export const STEP_MIN = 30; // 30분 단위
export const DAY_COUNT = 5; // 월~금 (0=월)
// 아래 값은 한성대 학술정보관 그룹스터디실 이용 규정을 따른다.
export const MAX_RESERVATION_MIN = 360; // 한 번에 잡을 수 있는 최대 시간 (시설마다 더 짧을 수 있다: facilities.max_minutes)
export const BOOKING_STEP_MIN = 60; // 학교 시설은 모두 1시간 단위(정각 시작)로 신청한다
export const MAX_DAYS_AHEAD = 7; // 이용일 1주일 전부터 신청 가능
