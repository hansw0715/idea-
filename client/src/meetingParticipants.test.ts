import { describe, expect, it } from 'vitest';
import { reconcileParticipants } from './meetingParticipants';

describe('meeting participant reconciliation', () => {
  it('initially selects the full roster', () => {
    expect(reconcileParticipants(null, [], [1, 2])).toEqual([1, 2]);
  });
  it('keeps an excluded member excluded when another member joins', () => {
    expect(reconcileParticipants([1], [1, 2], [1, 2, 3])).toEqual([1, 3]);
  });
  it('removes departed members and keeps current roster order', () => {
    expect(reconcileParticipants([3, 1], [1, 2, 3], [1, 2, 4])).toEqual([1, 4]);
  });
  it('preserves an empty selection during a roster refresh', () => {
    expect(reconcileParticipants([], [1, 2], [1, 2])).toEqual([]);
  });
  it('selects a returning member after their departure was observed', () => {
    expect(reconcileParticipants([1], [1], [1, 2])).toEqual([1, 2]);
  });
});
