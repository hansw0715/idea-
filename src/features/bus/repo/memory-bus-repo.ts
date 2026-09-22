/**
 * 인메모리 셔틀 저장소. seed.json으로 시작하고, 관리자 수정은 서버를 끄면 사라진다. (담당: 한승원)
 */
import seed from '../seed.json';
import type { BusNetwork, BusPosition, BusRoute } from '../types';
import type { BusRepo } from './bus-repo';

type Store = { network: BusNetwork; positions: Map<string, BusPosition> };

// dev 서버가 모듈을 다시 불러와도 데이터가 안 날아가게 globalThis에 둔다. (memory-repo.ts와 같은 이유)
const g = globalThis as unknown as { __bookeBus?: Store };

/** seed.json의 _todo 같은 메모 필드를 걸러서 도메인 타입으로 */
function fromSeed(): BusNetwork {
  return {
    routes: seed.routes.map(
      (r): BusRoute => ({
        id: r.id,
        name: r.name,
        color: r.color,
        order: r.order,
        stops: r.stops.map(({ id, name, lat, lng, order, offsetMin }) => ({ id, name, lat, lng, order, offsetMin })),
        timetables: r.timetables,
      }),
    ),
    vacations: seed.vacations.map(({ id, label, start, end }) => ({ id, label, start, end })),
    holidays: seed.holidays,
  };
}

function store(): Store {
  g.__bookeBus ??= { network: fromSeed(), positions: new Map() };
  return g.__bookeBus;
}

export const memoryBusRepo: BusRepo = {
  kind: 'memory',
  async getNetwork() {
    const { network } = store();
    return structuredClone({ ...network, routes: [...network.routes].sort((a, b) => a.order - b.order) });
  },
  async saveRoute(route) {
    const s = store();
    const rest = s.network.routes.filter((r) => r.id !== route.id);
    s.network = { ...s.network, routes: [...rest, structuredClone(route)] };
  },
  async deleteRoute(routeId) {
    const s = store();
    s.network = { ...s.network, routes: s.network.routes.filter((r) => r.id !== routeId) };
    for (const [id, p] of s.positions) if (p.routeId === routeId) s.positions.delete(id);
  },
  async saveCalendar({ vacations, holidays }) {
    const s = store();
    s.network = { ...s.network, vacations: structuredClone(vacations), holidays: [...holidays] };
  },
  async upsertPosition(position) {
    store().positions.set(position.deviceId, { ...position });
  },
  async listPositions() {
    return [...store().positions.values()];
  },
};
