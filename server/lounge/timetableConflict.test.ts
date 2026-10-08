import { describe, expect, it } from 'vitest';
import { computeConflicts, daySegments } from './timetableConflict.js';
import type { ConflictQuery, TimetableEntry } from './timetableConflict.js';

/**
 * 2026-10-12 는 월요일, 10-10 토 · 10-11 일 · 10-09 금 (KST).
 * 시각은 KST 로 적고 `+09:00` 을 붙여 UTC 서버에서도 같은 결과가 나오는지 본다.
 */
const kst = (s: string) => new Date(`${s}+09:00`).toISOString();
const h = (hour: number, min = 0) => hour * 60 + min;

const weekly = (day: number, start: number, end: number, title: string): TimetableEntry => ({
  day,
  startMin: start,
  endMin: end,
  title,
  repeatKind: 'weekly',
  date: null,
});
const once = (date: string, day: number, start: number, end: number, title: string): TimetableEntry => ({
  day,
  startMin: start,
  endMin: end,
  title,
  repeatKind: 'once',
  date,
});
const q = (id: string, meetAt: string, durationMin = 60): ConflictQuery => ({ id, meetAt, durationMin });

describe('daySegments — KST 날짜별 구간', () => {
  it('UTC 로는 전날이어도 KST 날짜·요일로 계산한다', () => {
    // UTC 2026-10-11(일) 23:30 = KST 2026-10-12(월) 08:30
    expect(daySegments('2026-10-11T23:30:00Z', 60)).toEqual([
      { date: '2026-10-12', weekday: 1, from: h(8, 30), to: h(9, 30) },
    ]);
  });

  it('자정을 넘기면 다음 날 구간으로 나눈다', () => {
    expect(daySegments(kst('2026-10-11T23:30:00'), 120)).toEqual([
      { date: '2026-10-11', weekday: 0, from: h(23, 30), to: 1440 },
      { date: '2026-10-12', weekday: 1, from: 0, to: h(1, 30) },
    ]);
    // 딱 자정에 끝나면 둘로 나누지 않는다
    expect(daySegments(kst('2026-10-11T23:00:00'), 60)).toHaveLength(1);
  });

  it('올바르지 않은 시각·길이는 빈 배열', () => {
    expect(daySegments('not-a-date', 60)).toEqual([]);
    expect(daySegments(kst('2026-10-12T10:00:00'), Number.NaN)).toEqual([]);
    expect(daySegments(kst('2026-10-12T10:00:00'), -5)).toEqual([]);
  });
});

describe('computeConflicts', () => {
  const entries = [weekly(0, h(10), h(12), '자료구조'), weekly(2, h(13), h(15), '운영체제')];

  it('weekly: 같은 요일, 시간이 겹치면 그 수업 이름', () => {
    const r = computeConflicts(entries, [q('m1', kst('2026-10-12T11:00:00'))]); // 월 11:00~12:00
    expect(r.get('m1')).toBe('자료구조');
  });

  it('다른 요일이면 겹치지 않는다', () => {
    const r = computeConflicts(entries, [q('tue', kst('2026-10-13T11:00:00'))]); // 화
    expect(r.size).toBe(0);
  });

  it('경계: 끝과 시작이 맞닿으면 겹침이 아니다', () => {
    const r = computeConflicts(entries, [
      q('after', kst('2026-10-12T12:00:00')), // 수업 12:00 끝 = 모임 12:00 시작
      q('before', kst('2026-10-12T09:00:00'), 60), // 모임 09:00~10:00 = 수업 10:00 시작
      q('inside1', kst('2026-10-12T11:59:00')), // 1분 겹침
      q('inside2', kst('2026-10-12T09:01:00'), 60), // 09:01~10:01 → 1분 겹침
    ]);
    expect(r.has('after')).toBe(false);
    expect(r.has('before')).toBe(false);
    expect(r.get('inside1')).toBe('자료구조');
    expect(r.get('inside2')).toBe('자료구조');
  });

  it('모임이 수업을 통째로 덮어도, 수업 안에 쏙 들어가도 겹친다', () => {
    const cover = computeConflicts(entries, [q('cover', kst('2026-10-12T09:00:00'), 240)]); // 09~13
    expect(cover.get('cover')).toBe('자료구조');
    const within = computeConflicts(entries, [q('within', kst('2026-10-12T10:30:00'), 30)]);
    expect(within.get('within')).toBe('자료구조');
  });

  it('주말은 겹침 없음 (시간표에 일정이 없다 — weekly 항목이 있어도)', () => {
    const weird = [weekly(5, h(10), h(12), '토요 특강'), weekly(6, h(10), h(12), '일요 특강')];
    const r = computeConflicts([...entries, ...weird], [
      q('sat', kst('2026-10-10T11:00:00')),
      q('sun', kst('2026-10-11T11:00:00')),
    ]);
    expect(r.size).toBe(0);
  });

  it('once: 그 날짜(KST)와 같을 때만 겹친다', () => {
    const oneOff = [once('2026-10-14', 2, h(16), h(18), '보강')];
    const r = computeConflicts(oneOff, [
      q('same', kst('2026-10-14T17:00:00')),
      q('nextWeek', kst('2026-10-21T17:00:00')), // 같은 요일, 다른 주
    ]);
    expect(r.get('same')).toBe('보강');
    expect(r.has('nextWeek')).toBe(false);
  });

  it('여러 모임을 한 번에 계산하고, 겹치는 모임만 맵에 담는다', () => {
    const r = computeConflicts(entries, [
      q('a', kst('2026-10-12T10:00:00')),
      q('b', kst('2026-10-12T18:00:00')),
      q('c', kst('2026-10-14T14:00:00')), // 수 14:00 운영체제
    ]);
    expect([...r.entries()]).toEqual([
      ['a', '자료구조'],
      ['c', '운영체제'],
    ]);
  });

  it('겹치는 일정이 여럿이면 목록의 첫 번째', () => {
    const two = [weekly(0, h(10), h(11), '첫째'), weekly(0, h(11), h(12), '둘째')];
    expect(computeConflicts(two, [q('m', kst('2026-10-12T10:30:00'), 90)]).get('m')).toBe('첫째');
  });

  it('UTC 날짜가 달라도 KST 요일로 비교한다', () => {
    // UTC 2026-10-11(일) 23:30 = KST 월 08:30. 월 08:00~09:30 수업과 겹친다.
    const early = [weekly(0, h(8), h(9, 30), '1교시')];
    expect(computeConflicts(early, [q('m', '2026-10-11T23:30:00Z')]).get('m')).toBe('1교시');
    // 반대로 UTC 로는 월요일 15:30 이지만 KST 로는 화요일 00:30 → 월요일 수업과 겹치지 않는다
    expect(computeConflicts([weekly(0, 0, h(2), '심야')], [q('m', '2026-10-12T15:30:00Z')]).size).toBe(0);
  });

  it('일요일 밤 모임이 월요일 새벽까지 이어지면 월요일 일정과 겹친다', () => {
    const dawn = [weekly(0, 0, h(1), '새벽')];
    expect(computeConflicts(dawn, [q('late', kst('2026-10-11T23:30:00'), 120)]).get('late')).toBe('새벽');
  });

  it('올바르지 않은 시각의 모임은 건너뛰고 나머지를 계산한다', () => {
    const r = computeConflicts(entries, [q('bad', 'nope'), q('ok', kst('2026-10-12T10:30:00'))]);
    expect([...r.keys()]).toEqual(['ok']);
  });

  it('일정이 없거나 모임이 없으면 빈 맵', () => {
    expect(computeConflicts([], [q('x', kst('2026-10-12T10:00:00'))]).size).toBe(0);
    expect(computeConflicts(entries, []).size).toBe(0);
  });
});
