/**
 * 셔틀 시간표 계산. (담당: 한승원)
 *
 * 전부 순수 함수다. "지금"은 인자로 받는다 — 그래야 서버(UTC)와 폰(KST)에서 결과가 같고 테스트가 된다.
 * 시각은 항상 한국 시간(KST, UTC+9, 서머타임 없음) 기준으로 계산한다.
 */
import { fail, ok, type Result } from '@/shared/types';
import { DAY_TYPE_LABEL, type BusNetwork, type BusPosition, type BusRoute, type DayType } from './types';

const KST_OFFSET_MS = 9 * 3600_000;

export type KstParts = {
  /** YYYY-MM-DD */
  date: string;
  /** 0=일 ~ 6=토 */
  weekday: number;
  /** 자정부터 지난 분 */
  minutes: number;
};

export function toKst(now: Date): KstParts {
  const k = new Date(now.getTime() + KST_OFFSET_MS);
  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    date: `${k.getUTCFullYear()}-${pad(k.getUTCMonth() + 1)}-${pad(k.getUTCDate())}`,
    weekday: k.getUTCDay(),
    minutes: k.getUTCHours() * 60 + k.getUTCMinutes(),
  };
}

/** 방학 > 공휴일·주말 > 평일 순으로 판정 */
export function dayTypeOf(network: Pick<BusNetwork, 'vacations' | 'holidays'>, now: Date): DayType {
  const { date, weekday } = toKst(now);
  if (network.vacations.some((v) => v.start <= date && date <= v.end)) return 'vacation';
  if (weekday === 0 || weekday === 6 || network.holidays.includes(date)) return 'weekend';
  return 'weekday';
}

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

export const isHHmm = (v: string) => HHMM.test(v);

export function parseHHmm(v: string): number {
  const m = HHMM.exec(v);
  if (!m) throw new Error(`시각 형식이 아닙니다: ${v}`);
  return Number(m[1]) * 60 + Number(m[2]);
}

/** 자정 넘는 값(예: 23:50 출발 + 15분)도 24시간 안으로 접어서 보여준다. */
export function formatMinutes(total: number): string {
  const m = ((total % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** 이 정류장에 버스가 서는 시각들(자정부터 분), 오름차순 */
export function arrivalsAt(route: BusRoute, stopId: string, dayType: DayType): number[] {
  const stop = route.stops.find((s) => s.id === stopId);
  if (!stop) return [];
  return route.timetables[dayType]
    .filter(isHHmm)
    .map((t) => parseHHmm(t) + stop.offsetMin)
    .sort((a, b) => a - b);
}

export type NextArrival = {
  /** "HH:mm" */
  at: string;
  /** 지금부터 몇 분 뒤. 0이면 "곧 도착" */
  inMinutes: number;
};

/**
 * 지금 이후 들어오는 버스 몇 대. 오늘 막차가 지났으면 빈 배열 → 화면에서 "오늘 운행 종료".
 * 분 단위로 자르기 때문에 12:00:40에 12:00 버스는 이미 지나간 것으로 본다.
 */
export function nextArrivals(
  network: BusNetwork,
  route: BusRoute,
  stopId: string,
  now: Date,
  count = 2,
): NextArrival[] {
  const { minutes } = toKst(now);
  const dayType = dayTypeOf(network, now);
  return arrivalsAt(route, stopId, dayType)
    .filter((t) => t >= minutes)
    .slice(0, count)
    .map((t) => ({ at: formatMinutes(t), inMinutes: t - minutes }));
}

/** 이 시간 동안 새 위치가 안 오면 지도에서 버스를 지운다(운행 종료/기기 꺼짐으로 본다). */
export const POSITION_STALE_SEC = 90;

export const isFresh = (p: BusPosition, now: Date, maxAgeSec = POSITION_STALE_SEC) =>
  now.getTime() - new Date(p.updatedAt).getTime() <= maxAgeSec * 1000;

// ---------- 관리자 편집 검증 ----------

export function validateRoute(route: BusRoute): Result<BusRoute> {
  if (!route.id.trim()) return fail('INVALID', '노선 ID가 비었습니다.');
  if (!route.name.trim()) return fail('INVALID', '노선 이름을 입력해 주세요.');
  if (route.stops.length < 2) return fail('INVALID', '정류장은 2개 이상이어야 합니다.');

  const ids = new Set<string>();
  for (const s of route.stops) {
    if (!s.name.trim()) return fail('INVALID', '이름이 빈 정류장이 있습니다.');
    if (ids.has(s.id)) return fail('INVALID', `정류장 ID가 겹칩니다: ${s.id}`);
    ids.add(s.id);
    if (!(s.lat >= -90 && s.lat <= 90 && s.lng >= -180 && s.lng <= 180)) {
      return fail('INVALID', `${s.name}: 좌표가 올바르지 않습니다.`);
    }
    if (!Number.isInteger(s.offsetMin) || s.offsetMin < 0) {
      return fail('INVALID', `${s.name}: 소요 시간은 0 이상의 정수(분)여야 합니다.`);
    }
  }

  for (const [dayType, times] of Object.entries(route.timetables)) {
    const bad = times.find((t) => !isHHmm(t));
    if (bad) return fail('INVALID', `${DAY_TYPE_LABEL[dayType as DayType] ?? dayType} 시간표에 잘못된 시각이 있습니다: ${bad}`);
  }

  // 순서는 배열 순서로 다시 매기고, 출발 시각은 정렬·중복 제거해서 저장한다.
  const stops = route.stops.map((s, i) => ({ ...s, name: s.name.trim(), order: i }));
  const timetables = Object.fromEntries(
    Object.entries(route.timetables).map(([k, v]) => [k, [...new Set(v)].sort()]),
  ) as BusRoute['timetables'];

  return ok({ ...route, name: route.name.trim(), stops, timetables });
}
