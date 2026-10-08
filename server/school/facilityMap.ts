/**
 * 우리 시설(facilities.system_key + campus_name) ↔ 학교 예약 시스템·공간 매핑, 지원하는 예약 시스템 목록.
 * 설계: docs/school/00-design.md §2.2 · §4
 *
 * 예약 시스템 키는 `<사이트>/<기능번호>` 이고 서버가 학교에 보내는 경로(`/resve/<사이트>/<기능>/…`)에 쓰이므로
 * 여기 적힌 것만 허용한다 (사용자 입력이 경로가 되지 않게 — SSRF 방지).
 */
import { normalizeName } from './parse.js';
import type { Space } from './parse.js';

export type ReserveSystem = {
  /** "<사이트>/<기능번호>" */
  key: string;
  site: string;
  fn: string;
  label: string;
  /** 실제 학교에서 신청 흐름까지 확인된 곳인가. false 면 화면이 "검증되지 않음"으로 표시한다 */
  verified: boolean;
};

const sys = (key: string, label: string, verified = true): ReserveSystem => {
  const [site, fn] = key.split('/');
  return { key, site, fn, label, verified };
};

/** hansung_facility.py 의 FACILITIES 7곳 + 학술정보관(hsel/14, 신청 흐름이 같은 모듈인지 미검증) */
export const RESERVE_SYSTEMS: ReserveSystem[] = [
  sys('cncschool/1', '상상파크 (연구관)'),
  sys('cncschool/2', '상상파크 플러스 (공학관)'),
  sys('cncschool/4', '디지털 스튜디오 (미래관)'),
  sys('cncschool/5', '실기 수업 콘텐츠 제작실 (미래관)'),
  sys('cncschool/6', '미디어 콘텐츠 제작실 (미래관)'),
  sys('cncschool/7', '코딩라운지 세미나실'),
  sys('onestop/16', '상상베이스 세미나실/그룹스터디룸 (상상관 B2)'),
  sys('hsel/14', '학술정보관 그룹스터디실', false),
];

const BY_KEY = new Map(RESERVE_SYSTEMS.map((s) => [s.key, s]));

export function systemByKey(key: string): ReserveSystem | null {
  return BY_KEY.get(key) ?? null;
}

/** facilities.system_key → 예약 시스템 키 (설계 §4) */
const FACILITY_SYSTEM: Record<string, string> = {
  hsel: 'hsel/14',
  onestop: 'onestop/16',
  cncschool: 'cncschool/2',
  codinglounge: 'cncschool/7',
};

/** 우리 시설의 system_key 로 학교 예약 시스템을 찾는다. 연결되지 않은 시설이면 null */
export function systemForFacility(facilitySystemKey: string | null): ReserveSystem | null {
  const key = facilitySystemKey ? FACILITY_SYSTEM[facilitySystemKey] : undefined;
  return key ? systemByKey(key) : null;
}

/** 학교 공간 목록에서 우리 시설의 campus_name 과 이름이 같은 공간 (공백 정리 후 비교) */
export function findSpace(spaces: Space[], campusName: string | null): Space | null {
  if (!campusName) return null;
  const want = normalizeName(campusName);
  return spaces.find((s) => normalizeName(s.name) === want) ?? null;
}

/** 지원하는 예약 시스템들의 사이트 목록 (로그인은 사이트마다 한 번) */
export function sitesOf(systems: ReserveSystem[]): string[] {
  return [...new Set(systems.map((s) => s.site))];
}
