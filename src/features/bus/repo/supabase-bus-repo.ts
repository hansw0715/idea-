/**
 * Supabase 셔틀 저장소. 스키마는 supabase/migrations/0001_bus.sql. (담당: 한승원)
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { DAY_TYPES, type BusNetwork, type BusRoute, type DayType } from '../types';
import type { BusRepo } from './bus-repo';

type RouteRow = { id: string; name: string; color: string; sort_order: number };
type StopRow = {
  id: string;
  route_id: string;
  name: string;
  lat: number;
  lng: number;
  sort_order: number;
  offset_min: number;
};
type TimetableRow = { route_id: string; day_type: DayType; departures: string[] };
type PositionRow = {
  device_id: string;
  route_id: string;
  lat: number;
  lng: number;
  heading: number | null;
  speed: number | null;
  updated_at: string;
};

/** supabase-js는 에러를 던지지 않고 돌려주므로, 여기서 던져서 API 라우트의 500 처리로 넘긴다. */
function must<T>(res: { data: T | null; error: { message: string } | null }, what: string): T {
  if (res.error) throw new Error(`[bus] ${what}: ${res.error.message}`);
  return res.data as T;
}

export function supabaseBusRepo(db: SupabaseClient): BusRepo {
  return {
    kind: 'supabase',

    async getNetwork(): Promise<BusNetwork> {
      const [routes, stops, timetables, vacations, holidays] = await Promise.all([
        db.from('bus_routes').select('id,name,color,sort_order').order('sort_order'),
        db.from('bus_stops').select('*').order('sort_order'),
        db.from('bus_timetables').select('*'),
        db.from('bus_vacations').select('*').order('start_date'),
        db.from('bus_holidays').select('day').order('day'),
      ]);
      const stopRows = must<StopRow[]>(stops, '정류장 조회');
      const ttRows = must<TimetableRow[]>(timetables, '시간표 조회');

      return {
        routes: must<RouteRow[]>(routes, '노선 조회').map(
          (r): BusRoute => ({
            id: r.id,
            name: r.name,
            color: r.color,
            order: r.sort_order,
            stops: stopRows
              .filter((s) => s.route_id === r.id)
              .map((s) => ({ id: s.id, name: s.name, lat: s.lat, lng: s.lng, order: s.sort_order, offsetMin: s.offset_min })),
            timetables: Object.fromEntries(
              DAY_TYPES.map((d) => [d, ttRows.find((t) => t.route_id === r.id && t.day_type === d)?.departures ?? []]),
            ) as Record<DayType, string[]>,
          }),
        ),
        vacations: must<{ id: string; label: string; start_date: string; end_date: string }[]>(vacations, '방학 조회').map(
          (v) => ({ id: v.id, label: v.label, start: v.start_date, end: v.end_date }),
        ),
        holidays: must<{ day: string }[]>(holidays, '공휴일 조회').map((h) => h.day),
      };
    },

    async saveRoute(route) {
      must(await db.rpc('bus_save_route', { route }), '노선 저장');
    },

    async deleteRoute(routeId) {
      must(await db.from('bus_routes').delete().eq('id', routeId), '노선 삭제');
    },

    async saveCalendar({ vacations, holidays }) {
      // 행 수가 몇 개 안 돼서 통째로 갈아끼운다.
      must(await db.from('bus_vacations').delete().neq('id', ''), '방학 초기화');
      if (vacations.length) {
        must(
          await db
            .from('bus_vacations')
            .insert(vacations.map((v) => ({ id: v.id, label: v.label, start_date: v.start, end_date: v.end }))),
          '방학 저장',
        );
      }
      must(await db.from('bus_holidays').delete().gte('day', '1900-01-01'), '공휴일 초기화');
      if (holidays.length) {
        must(await db.from('bus_holidays').insert(holidays.map((day) => ({ day }))), '공휴일 저장');
      }
    },

    async upsertPosition(p) {
      must(
        await db.from('bus_positions').upsert({
          device_id: p.deviceId,
          route_id: p.routeId,
          lat: p.lat,
          lng: p.lng,
          heading: p.heading,
          speed: p.speed,
          updated_at: p.updatedAt,
        }),
        '위치 저장',
      );
    },

    async listPositions() {
      const rows = must<PositionRow[]>(await db.from('bus_positions').select('*'), '위치 조회');
      return rows.map((r) => ({
        deviceId: r.device_id,
        routeId: r.route_id,
        lat: r.lat,
        lng: r.lng,
        heading: r.heading,
        speed: r.speed,
        updatedAt: r.updated_at,
      }));
    },
  };
}
