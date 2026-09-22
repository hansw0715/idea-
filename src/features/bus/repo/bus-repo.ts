/**
 * 셔틀 저장소 인터페이스. (담당: 한승원)
 *
 * 구현체는 두 개 — Supabase(env 있을 때)와 인메모리(seed.json, env 없을 때).
 * Supabase 프로젝트가 아직 없어도 로컬에서 바로 돌려볼 수 있게 하려는 것.
 */
import type { BusNetwork, BusPosition, BusRoute, VacationPeriod } from '../types';

export interface BusRepo {
  readonly kind: 'supabase' | 'memory';
  getNetwork(): Promise<BusNetwork>;
  saveRoute(route: BusRoute): Promise<void>;
  deleteRoute(routeId: string): Promise<void>;
  saveCalendar(calendar: { vacations: VacationPeriod[]; holidays: string[] }): Promise<void>;
  upsertPosition(position: BusPosition): Promise<void>;
  listPositions(): Promise<BusPosition[]>;
}
