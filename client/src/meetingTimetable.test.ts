import { describe, expect, it } from 'vitest';
import { mergeMeetingTimetable } from './meetingTimetable';
import type { GridEntry } from './components/TimetableGrid';

const course = (memberIndex: number, startMin: number, endMin: number, day = 1): GridEntry => ({
  id: memberIndex + 1, memberIndex, memberName: `팀원 ${memberIndex + 1}`,
  kind: 'class', title: `수업 ${memberIndex + 1}`, day, startMin, endMin,
});

describe('merged meeting timetable', () => {
  it('combines the whole connected interval without splitting changes in people', () => {
    const first = course(0, 540, 660);
    const second = course(1, 600, 720);
    const blocks = mergeMeetingTimetable([first, second]);
    expect(blocks.map(({ startMin, endMin, title }) => [startMin, endMin, title])).toEqual([
      [540, 720, '팀원 일정'],
    ]);
    expect(blocks[0].sourceEntries).toEqual([first, second]);
    expect(blocks.every((block) => block.memberIndex === undefined)).toBe(true);
  });

  it('combines touching intervals into one continuous gray block', () => {
    const blocks = mergeMeetingTimetable([course(0, 540, 600), course(1, 600, 660)]);
    expect(blocks).toHaveLength(1);
    expect([blocks[0].startMin, blocks[0].endMin]).toEqual([540, 660]);
  });

  it('keeps gaps and different weekdays separate', () => {
    expect(mergeMeetingTimetable([course(0, 540, 600), course(1, 660, 720), course(2, 540, 660, 2)]))
      .toHaveLength(3);
  });

  it('combines five schedules into one full-width overlap block', () => {
    const entries = Array.from({ length: 5 }, (_, index) => course(index, 600, 660));
    const blocks = mergeMeetingTimetable(entries);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].title).toBe('팀원 일정');
    expect(blocks[0].sourceEntries).toEqual(entries);
  });

  it('displays three overlapping schedules from 09:00 to 11:30 as one exact block', () => {
    const blocks = mergeMeetingTimetable([course(0, 540, 690), course(1, 540, 660), course(2, 600, 690)]);
    expect(blocks).toHaveLength(1);
    expect([blocks[0].startMin, blocks[0].endMin]).toEqual([540, 690]);
    expect(blocks[0].sourceEntries).toHaveLength(3);
  });

  it('preserves reservations without counting them as a person', () => {
    const reservation: GridEntry = { id: 1, kind: 'reservation', day: 1, startMin: 600, endMin: 660, title: '스터디룸' };
    const blocks = mergeMeetingTimetable([course(0, 540, 660), reservation]);
    expect(blocks).toHaveLength(2);
    expect(blocks[0].title).toBe('수업 1');
    expect(blocks[1]).toBe(reservation);
  });
});
