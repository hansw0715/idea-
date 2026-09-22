import { describe, expect, it } from 'vitest';
import {
  arrivalsAt,
  dayTypeOf,
  formatMinutes,
  isFresh,
  nextArrivals,
  toKst,
  validateRoute,
} from './schedule';
import type { BusNetwork, BusRoute } from './types';

const route: BusRoute = {
  id: 'r1',
  name: '한성대입구역 ↔ 학교',
  color: '#1f4fd8',
  order: 0,
  stops: [
    { id: 's1', name: '역 출구', lat: 37.588, lng: 127.006, order: 0, offsetMin: 0 },
    { id: 's2', name: '삼선교', lat: 37.586, lng: 127.008, order: 1, offsetMin: 3 },
    { id: 's3', name: '정문', lat: 37.582, lng: 127.01, order: 2, offsetMin: 7 },
  ],
  timetables: {
    weekday: ['08:30', '08:00', '09:00'],
    weekend: ['10:00'],
    vacation: ['11:00'],
  },
};

const network: BusNetwork = {
  routes: [route],
  vacations: [{ id: 'v1', label: '겨울방학', start: '2026-12-22', end: '2027-02-28' }],
  holidays: ['2026-10-09'],
};

/** KST 시각을 받아 Date로. 서버가 UTC여도 같은 결과가 나오는지 보려고 일부러 +09:00을 붙인다. */
const kst = (s: string) => new Date(`${s}+09:00`);

describe('toKst', () => {
  it('UTC 기준으로 전날이어도 한국 날짜·시각으로 계산한다', () => {
    // UTC 2026-09-21 23:30 = KST 2026-09-22(화) 08:30
    expect(toKst(new Date('2026-09-21T23:30:00Z'))).toEqual({
      date: '2026-09-22',
      weekday: 2,
      minutes: 8 * 60 + 30,
    });
  });
});

describe('dayTypeOf', () => {
  it('평일', () => expect(dayTypeOf(network, kst('2026-09-22T12:00:00'))).toBe('weekday'));
  it('토요일은 주말', () => expect(dayTypeOf(network, kst('2026-09-26T12:00:00'))).toBe('weekend'));
  it('공휴일(평일)은 주말 시간표', () =>
    expect(dayTypeOf(network, kst('2026-10-09T12:00:00'))).toBe('weekend'));
  it('방학은 요일보다 우선', () => {
    expect(dayTypeOf(network, kst('2026-12-22T00:00:00'))).toBe('vacation'); // 시작일 포함
    expect(dayTypeOf(network, kst('2027-01-02T12:00:00'))).toBe('vacation'); // 토요일이어도
    expect(dayTypeOf(network, kst('2027-02-28T23:59:00'))).toBe('vacation'); // 종료일 포함
    expect(dayTypeOf(network, kst('2027-03-02T09:00:00'))).toBe('weekday');
  });
});

describe('arrivalsAt', () => {
  it('출발 시각 + 정류장 소요 분, 오름차순', () => {
    expect(arrivalsAt(route, 's3', 'weekday').map(formatMinutes)).toEqual(['08:07', '08:37', '09:07']);
  });
  it('없는 정류장이면 빈 배열', () => expect(arrivalsAt(route, 'nope', 'weekday')).toEqual([]));
});

describe('nextArrivals', () => {
  it('다음 버스까지 N분', () => {
    expect(nextArrivals(network, route, 's2', kst('2026-09-22T08:20:00'))).toEqual([
      { at: '08:33', inMinutes: 13 },
      { at: '09:03', inMinutes: 43 },
    ]);
  });
  it('딱 도착 시각이면 0분(곧 도착)', () => {
    expect(nextArrivals(network, route, 's2', kst('2026-09-22T08:03:30'), 1)).toEqual([
      { at: '08:03', inMinutes: 0 },
    ]);
  });
  it('막차 뒤면 빈 배열(오늘 운행 종료)', () => {
    expect(nextArrivals(network, route, 's3', kst('2026-09-22T09:08:00'))).toEqual([]);
  });
  it('주말엔 주말 시간표를 쓴다', () => {
    expect(nextArrivals(network, route, 's1', kst('2026-09-26T08:00:00'))).toEqual([
      { at: '10:00', inMinutes: 120 },
    ]);
  });
});

describe('isFresh', () => {
  const pos = { deviceId: 'd', routeId: 'r1', lat: 0, lng: 0, heading: null, speed: null, updatedAt: '2026-09-22T00:00:00Z' };
  it('90초 안이면 표시, 넘으면 숨김', () => {
    expect(isFresh(pos, new Date('2026-09-22T00:01:30Z'))).toBe(true);
    expect(isFresh(pos, new Date('2026-09-22T00:01:31Z'))).toBe(false);
  });
});

describe('validateRoute', () => {
  it('정상 노선은 순서를 다시 매기고 시간표를 정렬·중복 제거한다', () => {
    const r = validateRoute({ ...route, timetables: { ...route.timetables, weekday: ['09:00', '08:00', '09:00'] } });
    expect(r.ok && r.value.timetables.weekday).toEqual(['08:00', '09:00']);
    expect(r.ok && r.value.stops.map((s) => s.order)).toEqual([0, 1, 2]);
  });
  it('잘못된 시각', () => {
    const r = validateRoute({ ...route, timetables: { ...route.timetables, weekend: ['25:00'] } });
    expect(r.ok).toBe(false);
  });
  it('좌표 범위 밖', () => {
    const r = validateRoute({ ...route, stops: [{ ...route.stops[0], lat: 200 }, route.stops[1]] });
    expect(r.ok).toBe(false);
  });
  it('정류장 1개', () => {
    expect(validateRoute({ ...route, stops: [route.stops[0]] }).ok).toBe(false);
  });
  it('정류장 ID 중복', () => {
    expect(validateRoute({ ...route, stops: [route.stops[0], { ...route.stops[1], id: 's1' }] }).ok).toBe(false);
  });
});
