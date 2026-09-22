/** 셔틀 API 클라이언트. (담당: 한승원) */
import type { BusSnapshot } from '@/features/bus/service';
import type { BusPosition, BusRoute, VacationPeriod } from '@/features/bus/types';
import { request } from './api';

export const fetchBus = () => request<BusSnapshot>('/api/bus');

export const fetchBusPositions = () =>
  request<{ positions: BusPosition[] }>('/api/bus/positions').then((d) => d.positions);

export const saveBusRoute = (route: BusRoute) =>
  request<{ route: BusRoute }>(`/api/admin/bus/routes/${encodeURIComponent(route.id)}`, {
    method: 'PUT',
    body: JSON.stringify(route),
  }).then((d) => d.route);

export const deleteBusRoute = (routeId: string) =>
  request<{ ok: true }>(`/api/admin/bus/routes/${encodeURIComponent(routeId)}`, { method: 'DELETE' });

export const saveBusCalendar = (calendar: { vacations: VacationPeriod[]; holidays: string[] }) =>
  request<{ ok: true }>('/api/admin/bus/calendar', { method: 'PUT', body: JSON.stringify(calendar) });
