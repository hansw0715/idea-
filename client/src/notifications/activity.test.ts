import { describe, expect, it } from 'vitest';
import { activityDate, buildActivity, scopeFor } from './activity';
import type { Reservation } from '../types';
import type { EclassItem } from '../../../shared/school/eclass';

describe('통합 알림', () => {
  const reservation = { id: 1, date: '2026-10-26', startMin: 600, endMin: 660, meetingId: 2, meetingName: '캡스톤', facilityId: 3, facilityName: '스터디룸', schoolStatus: 'planned' } as Reservation;
  it('종료된 예약은 제외하고 예약 변경은 새 항목으로 구분한다', () => {
    const old = buildActivity({ reservations: [reservation] }, Date.parse('2026-10-26T11:01:00+09:00'));
    expect(old).toEqual([]);
    const before = buildActivity({ reservations: [reservation] }, 0)[0];
    const after = buildActivity({ reservations: [{ ...reservation, startMin: 630 }] }, 0)[0];
    expect(before.scopes).toEqual(['timetable', 'lounge']);
    expect(before.id).not.toBe(after.id);
  });
  it('같은 공지를 다시 조회해도 같은 알림이며 다른 계열로 섞이지 않는다', () => {
    const data = { notices: { school: { items: [{ id: '1', title: '장학 공지', date: '2026-10-25', url: 'https://example.org' }] } } };
    expect(buildActivity(data)).toEqual(buildActivity(data));
    expect(buildActivity(data)[0].scopes).toEqual(['campus']);
    expect(scopeFor('/account/friends')).toBe('account');
    expect(scopeFor('/meetings/2')).toBe('lounge');
  });
  it('알림에는 생성 시각 대신 실제 예약 일시와 종료 시각을 안내한다', () => {
    const items = buildActivity({ reservations: [reservation], meetings: [{ id: 2, name: '캡스톤', ownerId: 1, code: '1234', createdAt: '2026-10-01T00:00:00Z' }, { id: 3, name: '미정 회의', ownerId: 1, code: '2222', createdAt: '2026-10-01T00:00:00Z' }] }, 0);
    expect(items[0].when).toMatch(/10월 26일.*10:00–11:00/);
    expect(items[1].when).toBe(items[0].when);
    expect(items[2].when).toContain('일정 미정');
    expect(activityDate('2026-10-25T15:30:00Z')).toMatch(/10월 26일.*00:30/);
  });
  it('미수강 강의는 마감 6시간 안으로 들어올 때만 알림이 되고, 과제는 지금처럼 알린다', () => {
    const now = Date.parse('2026-11-02T12:00:00+09:00');
    const item = (id: string, kind: EclassItem['kind'], dueAt: string | null): EclassItem => ({ id, courseId: 'c', courseName: '자료구조', title: id, kind, url: '', completion: 'pending', attendance: 'unknown', dueAt, availableAt: null, progress: 0 });
    const learning = [
      item('3시간 남은 강의', 'lecture', '2026-11-02T15:00:00+09:00'),
      item('10시간 남은 강의', 'lecture', '2026-11-02T22:00:00+09:00'),
      item('마감 모르는 강의', 'lecture', null),
      item('사흘 남은 과제', 'assignment', '2026-11-05T12:00:00+09:00'),
    ];
    const titles = buildActivity({ learning }, now).map((a) => a.title);
    expect(titles).toEqual(['3시간 남은 강의', '사흘 남은 과제']);
    expect(buildActivity({ learning }, now)[0].body).toBe('자료구조 · 마감 3시간 전');
  });
});
