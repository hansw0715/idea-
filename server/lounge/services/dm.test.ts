import { describe, expect, it } from 'vitest';
import { dmMembers, dmRoomId, isDmRoom } from './dm.js';

describe('1:1 방 id', () => {
  it('두 사람 순서와 상관없이 같은 방', () => {
    expect(dmRoomId('12', '3')).toBe('dm-3-12');
    expect(dmRoomId('3', '12')).toBe('dm-3-12');
    expect(isDmRoom('dm-3-12')).toBe(true);
    expect(isDmRoom('demo-meal-a')).toBe(false);
  });
  it('모양이 틀린 방 id 는 두 사람을 돌려주지 않는다', () => {
    expect(dmMembers('dm-3-12')).toEqual(['3', '12']);
    expect(dmMembers('dm-12-3')).toBeNull();
    expect(dmMembers('dm-3-3')).toBeNull();
    expect(dmMembers('dm-a-b')).toBeNull();
  });
});
