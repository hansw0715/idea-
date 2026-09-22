/**
 * 셔틀 서비스 계층. (담당: 한승원)
 * API 라우트는 이 파일만 부른다. 검증 규칙은 schedule.ts(순수 함수)에 있다.
 */
import { fail, ok, type Result } from '@/shared/types';
import { busRepo } from './repo';
import { dayTypeOf, isFresh, validateRoute } from './schedule';
import type { BusNetwork, BusPosition, BusRoute, DayType, VacationPeriod } from './types';

export type BusSnapshot = {
  network: BusNetwork;
  /** 오늘 적용되는 시간표 */
  today: DayType;
  positions: BusPosition[];
  /** 'memory'면 서버 재시작 시 관리자 수정이 사라진다 — 관리자 화면에 경고로 띄운다 */
  storage: 'supabase' | 'memory';
  serverNow: string;
};

export async function getSnapshot(now = new Date()): Promise<BusSnapshot> {
  const repo = busRepo();
  const [network, positions] = await Promise.all([repo.getNetwork(), repo.listPositions()]);
  return {
    network,
    today: dayTypeOf(network, now),
    positions: positions.filter((p) => isFresh(p, now)),
    storage: repo.kind,
    serverNow: now.toISOString(),
  };
}

export async function livePositions(now = new Date()): Promise<BusPosition[]> {
  return (await busRepo().listPositions()).filter((p) => isFresh(p, now));
}

export type PositionInput = {
  deviceId?: unknown;
  routeId?: unknown;
  lat?: unknown;
  lng?: unknown;
  heading?: unknown;
  speed?: unknown;
};

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** 기사 폰 / GPS 트래커가 보내는 위치 한 건 */
export async function reportPosition(input: PositionInput, now = new Date()): Promise<Result<BusPosition>> {
  const lat = num(input.lat);
  const lng = num(input.lng);
  if (typeof input.deviceId !== 'string' || !input.deviceId.trim()) return fail('INVALID', 'deviceId가 필요합니다.');
  if (typeof input.routeId !== 'string') return fail('INVALID', 'routeId가 필요합니다.');
  if (lat === null || lng === null || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return fail('INVALID', '좌표가 올바르지 않습니다.');
  }

  const repo = busRepo();
  const network = await repo.getNetwork();
  if (!network.routes.some((r) => r.id === input.routeId)) return fail('NOT_FOUND', '없는 노선입니다.');

  const position: BusPosition = {
    deviceId: input.deviceId.trim().slice(0, 64),
    routeId: input.routeId,
    lat,
    lng,
    heading: num(input.heading),
    speed: num(input.speed),
    updatedAt: now.toISOString(),
  };
  await repo.upsertPosition(position);
  return ok(position);
}

// ---------- 관리자 ----------

export async function saveRoute(route: BusRoute): Promise<Result<BusRoute>> {
  const valid = validateRoute(route);
  if (!valid.ok) return valid;
  await busRepo().saveRoute(valid.value);
  return valid;
}

export async function deleteRoute(routeId: string): Promise<Result<true>> {
  await busRepo().deleteRoute(routeId);
  return ok(true);
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export async function saveCalendar(input: {
  vacations: VacationPeriod[];
  holidays: string[];
}): Promise<Result<true>> {
  for (const v of input.vacations) {
    if (!v.label?.trim()) return fail('INVALID', '방학 이름을 입력해 주세요.');
    if (!DATE.test(v.start) || !DATE.test(v.end)) return fail('INVALID', '날짜는 YYYY-MM-DD 형식이어야 합니다.');
    if (v.start > v.end) return fail('INVALID', `${v.label}: 시작일이 종료일보다 늦습니다.`);
  }
  const bad = input.holidays.find((d) => !DATE.test(d));
  if (bad) return fail('INVALID', `공휴일 날짜 형식이 잘못됐습니다: ${bad}`);

  await busRepo().saveCalendar({
    vacations: input.vacations.map((v) => ({ ...v, label: v.label.trim() })),
    holidays: [...new Set(input.holidays)].sort(),
  });
  return ok(true);
}
