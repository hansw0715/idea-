/**
 * 학교 셔틀 노선도 모델. (담당: 한승원)
 *
 * 시간표는 "출발지 출발 시각 목록 + 정류장별 소요 분(offsetMin)"으로 들고 있다.
 * 정류장마다 시각을 따로 적으면 관리자가 출발 시각 하나 바꿀 때 정류장 수만큼 고쳐야 해서다.
 */

/** 평일 / 주말(공휴일 포함) / 방학 */
export type DayType = 'weekday' | 'weekend' | 'vacation';

export const DAY_TYPES: DayType[] = ['weekday', 'weekend', 'vacation'];

export const DAY_TYPE_LABEL: Record<DayType, string> = {
  weekday: '평일',
  weekend: '주말',
  vacation: '방학',
};

export type BusStop = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  /** 노선 안 순서 (0부터) */
  order: number;
  /** 출발지에서 이 정류장까지 걸리는 분 */
  offsetMin: number;
};

export type BusRoute = {
  id: string;
  name: string;
  /** 지도 경로선 색 */
  color: string;
  order: number;
  stops: BusStop[];
  /** 요일 유형별 출발지 출발 시각 "HH:mm". 비어 있으면 그날 운행 안 함. */
  timetables: Record<DayType, string[]>;
};

/** 방학 기간. 이 기간엔 요일과 상관없이 방학 시간표를 쓴다. (YYYY-MM-DD, 양 끝 포함) */
export type VacationPeriod = {
  id: string;
  label: string;
  start: string;
  end: string;
};

export type BusNetwork = {
  routes: BusRoute[];
  vacations: VacationPeriod[];
  /** 주말 시간표를 적용할 공휴일 (YYYY-MM-DD) */
  holidays: string[];
};

/** 버스 실시간 위치. 기기(기사 폰, GPS 트래커) 하나당 최신 값 하나만 둔다. */
export type BusPosition = {
  deviceId: string;
  routeId: string;
  lat: number;
  lng: number;
  /** 진행 방향(도), 모르면 null */
  heading: number | null;
  /** m/s, 모르면 null */
  speed: number | null;
  updatedAt: string;
};
