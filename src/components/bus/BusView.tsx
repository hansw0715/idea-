'use client';

/**
 * 셔틀 노선도 화면. (담당: 한승원)
 *
 * 노선 칩 → 지도(경로·정류장·실시간 버스) → 정류장 목록(다음 버스 N분) → 정류장 누르면 전체 시간표.
 * "지금"은 30초마다 다시 읽어서 N분이 저절로 줄어들게 하고, 버스 위치는 5초마다 새로 받는다.
 */
import dynamic from 'next/dynamic';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Badge, Card, EmptyState, Modal, Tabs } from '@/components/ui';
import { fetchBus, fetchBusPositions } from '@/lib/bus-api';
import type { BusSnapshot } from '@/features/bus/service';
import { arrivalsAt, formatMinutes, nextArrivals, toKst, type NextArrival } from '@/features/bus/schedule';
import { DAY_TYPE_LABEL, DAY_TYPES, type BusPosition, type BusRoute, type BusStop, type DayType } from '@/features/bus/types';

const BusMap = dynamic(() => import('./BusMap'), {
  ssr: false,
  loading: () => <div className="h-full w-full animate-pulse bg-surface-muted" />,
});

const POSITION_POLL_MS = 5_000;
const CLOCK_TICK_MS = 30_000;

export function BusView() {
  const [snapshot, setSnapshot] = useState<BusSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [positions, setPositions] = useState<BusPosition[]>([]);
  const [routeId, setRouteId] = useState<string | null>(null);
  const [stopId, setStopId] = useState<string | null>(null);
  const [sheetStopId, setSheetStopId] = useState<string | null>(null);
  const now = useNow(CLOCK_TICK_MS);

  useEffect(() => {
    fetchBus()
      .then((s) => {
        setSnapshot(s);
        setPositions(s.positions);
        setRouteId((cur) => cur ?? s.network.routes[0]?.id ?? null);
      })
      .catch(() => setError('노선 정보를 불러오지 못했어요.'));
  }, []);

  useEffect(() => {
    const t = setInterval(() => {
      fetchBusPositions().then(setPositions).catch(() => {});
    }, POSITION_POLL_MS);
    return () => clearInterval(t);
  }, []);

  const route = snapshot?.network.routes.find((r) => r.id === routeId) ?? null;
  const routePositions = useMemo(() => positions.filter((p) => p.routeId === routeId), [positions, routeId]);

  const selectRoute = (id: string) => {
    setRouteId(id);
    setStopId(null);
  };

  const selectStop = useCallback((id: string) => {
    setStopId(id);
    setSheetStopId(id);
  }, []);

  if (error) return <EmptyState icon="⚠️" title={error}>잠시 후 다시 시도해 주세요.</EmptyState>;
  if (!snapshot || !now) return <div className="h-80 animate-pulse rounded-lg bg-surface-muted" />;

  const { network } = snapshot;
  const today = snapshot.today;

  if (network.routes.length === 0) {
    return <EmptyState icon="🚌" title="등록된 노선이 없어요">관리자 페이지에서 노선을 추가해 주세요.</EmptyState>;
  }

  const sheetStop = route?.stops.find((s) => s.id === sheetStopId) ?? null;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold">셔틀버스</h1>
        <Badge tone="brand">오늘 {DAY_TYPE_LABEL[today]} 시간표</Badge>
      </div>

      <Tabs
        items={network.routes.map((r) => ({ value: r.id, label: r.name }))}
        value={routeId ?? ''}
        onChange={selectRoute}
      />

      <div className="relative h-[45dvh] min-h-64 overflow-hidden rounded-lg border border-border">
        <BusMap route={route} positions={routePositions} selectedStopId={stopId} onSelectStop={selectStop} />
        <div className="pointer-events-none absolute left-2 top-2 z-[1000]">
          <Badge tone={routePositions.length ? 'success' : 'neutral'} className="shadow-card">
            {routePositions.length ? `● 실시간 운행 ${routePositions.length}대` : '실시간 위치 없음 · 시간표 기준'}
          </Badge>
        </div>
      </div>

      {route && (
        <Card className="p-0">
          <ol className="divide-y divide-border">
            {route.stops.map((s) => (
              <StopRow
                key={s.id}
                stop={s}
                color={route.color}
                selected={s.id === stopId}
                next={nextArrivals(network, route, s.id, now)}
                onClick={() => selectStop(s.id)}
              />
            ))}
          </ol>
        </Card>
      )}

      <p className="text-center text-[11px] text-muted">
        시간표 기준 예상 시각이에요. 교통 상황에 따라 달라질 수 있어요.
      </p>

      <Modal open={!!sheetStop} onClose={() => setSheetStopId(null)} title={sheetStop?.name ?? ''}>
        {route && sheetStop && <StopTimetable route={route} stop={sheetStop} today={today} now={now} network={snapshot.network} />}
      </Modal>
    </div>
  );
}

function StopRow({
  stop,
  color,
  selected,
  next,
  onClick,
}: {
  stop: BusStop;
  color: string;
  selected: boolean;
  next: NextArrival[];
  onClick: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className={`flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-surface-muted ${selected ? 'bg-brand-soft' : ''}`}
      >
        <span
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-pill text-[11px] font-bold text-white"
          style={{ background: color }}
        >
          {stop.order + 1}
        </span>
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{stop.name}</span>
        <NextLabel next={next} />
      </button>
    </li>
  );
}

function NextLabel({ next }: { next: NextArrival[] }) {
  if (next.length === 0) return <span className="text-xs text-muted">오늘 운행 종료</span>;
  const [first, second] = next;
  return (
    <span className="text-right">
      <span className={`block text-sm font-bold ${first.inMinutes <= 3 ? 'text-accent' : 'text-brand'}`}>
        {first.inMinutes === 0 ? '곧 도착' : `${first.inMinutes}분 후`}
      </span>
      <span className="block text-[11px] text-muted">
        {first.at}
        {second && ` · 다음 ${second.at}`}
      </span>
    </span>
  );
}

function StopTimetable({
  route,
  stop,
  today,
  now,
  network,
}: {
  route: BusRoute;
  stop: BusStop;
  today: DayType;
  now: Date;
  network: BusSnapshot['network'];
}) {
  const [dayType, setDayType] = useState<DayType>(today);
  const times = arrivalsAt(route, stop.id, dayType);
  const nowMin = toKst(now).minutes;
  // 오늘 시간표를 볼 때만 "다음 버스"를 강조한다.
  const nextIdx = dayType === today ? times.findIndex((t) => t >= nowMin) : -1;
  const next = nextArrivals(network, route, stop.id, now, 1)[0];

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted">
        {route.name} · {stop.order + 1}번째 정류장
      </p>
      {dayType === today && (
        <p className="rounded-md bg-brand-soft px-3 py-2 text-sm font-semibold text-brand">
          {next ? `다음 버스 ${next.at} (${next.inMinutes === 0 ? '곧 도착' : `${next.inMinutes}분 후`})` : '오늘 운행이 끝났어요'}
        </p>
      )}

      <Tabs
        items={DAY_TYPES.map((d) => ({ value: d, label: DAY_TYPE_LABEL[d], hint: d === today ? '오늘' : undefined }))}
        value={dayType}
        onChange={setDayType}
      />

      {times.length === 0 ? (
        <EmptyState icon="💤" title={`${DAY_TYPE_LABEL[dayType]}에는 운행하지 않아요`} />
      ) : (
        <ul className="grid grid-cols-4 gap-1.5">
          {times.map((t, i) => {
            const past = dayType === today && t < nowMin;
            const isNext = i === nextIdx;
            return (
              <li
                key={t}
                className={`rounded-sm py-1.5 text-center text-sm tabular-nums ${
                  isNext ? 'bg-brand font-bold text-white' : past ? 'text-muted line-through opacity-50' : 'bg-surface-muted'
                }`}
              >
                {formatMinutes(t)}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** 마운트 전엔 null — 서버/클라이언트 시각이 달라 hydration이 어긋나는 걸 막는다. */
function useNow(tickMs: number): Date | null {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    const tick = () => setNow(new Date());
    const first = setTimeout(tick, 0);
    const t = setInterval(tick, tickMs);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, [tickMs]);
  return now;
}
