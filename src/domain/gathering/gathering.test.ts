import { describe, expect, it } from 'vitest';
import { asGatheringId, asUserId } from '@/shared/types';
import type { User } from '@/shared/user';
import { MEETUP_PRESETS } from '@/features/meetup/preset';
import { MEAL_PRESET, MEAL_SLOT } from '@/features/mealdate/preset';
import {
  apply,
  approve,
  cancel,
  createGathering,
  currentStatus,
  isMember,
  join,
  leave,
  markAttendance,
  type Gathering,
} from './index';

const NOW = '2026-09-01T09:00:00.000Z';
const DEADLINE = '2026-09-02T09:00:00.000Z';
const MEET_AT = '2026-09-02T12:00:00.000Z';
const AFTER_MEET = '2026-09-02T13:00:00.000Z';

const user = (id: string, over: Partial<User> = {}): User => ({
  id: asUserId(id),
  nickname: id,
  college: 'IT공과대학',
  admissionYear: 2026,
  verified: true,
  trustScore: 100,
  createdAt: NOW,
  ...over,
});

const host = user('host');

function meetup(): Gathering {
  const created = createGathering(
    {
      id: asGatheringId('g'),
      kind: 'meetup',
      hostId: host.id,
      title: '2:2 미팅',
      body: '',
      place: '삼선교',
      meetAt: MEET_AT,
      joinDeadline: DEADLINE,
      joinPolicy: 'auto',
      slots: MEETUP_PRESETS['2:2'].slots,
    },
    NOW,
  );
  if (!created.ok) throw new Error(created.error.message);
  return created.value;
}

function meal(capacity = 2): Gathering {
  const created = createGathering(
    {
      id: asGatheringId('m'),
      kind: 'meal',
      hostId: host.id,
      title: '학식 같이',
      body: '',
      place: '상상관',
      meetAt: MEET_AT,
      joinDeadline: DEADLINE,
      joinPolicy: 'approval',
      slots: MEAL_PRESET(capacity).slots,
    },
    NOW,
  );
  if (!created.ok) throw new Error(created.error.message);
  return created.value;
}

/** 성공을 기대하는 곳에서 값만 꺼내는 헬퍼 */
function unwrap(r: ReturnType<typeof join>): Gathering {
  if (!r.ok) throw new Error(`실패: ${r.error.code} ${r.error.message}`);
  return r.value;
}

describe('생성', () => {
  it('주최자는 만들자마자 자기 자리에 앉는다', () => {
    const g = meetup();
    expect(isMember(g, host.id)).toBe(true);
    expect(g.slots[0].memberIds).toEqual([host.id]);
    expect(g.slots[1].memberIds).toEqual([]);
  });

  it('마감이 만나는 시각보다 늦으면 못 만든다', () => {
    const r = createGathering(
      {
        id: asGatheringId('x'),
        kind: 'meetup',
        hostId: host.id,
        title: 't',
        body: '',
        place: 'p',
        meetAt: DEADLINE,
        joinDeadline: MEET_AT,
        joinPolicy: 'auto',
        slots: MEETUP_PRESETS['1:1'].slots,
      },
      NOW,
    );
    expect(r.ok).toBe(false);
  });
});

describe('미팅 — 선착순 착석', () => {
  it('빈 자리에 앉으면 바로 확정된다', () => {
    const g = unwrap(join(meetup(), user('a'), 'guest', NOW));
    expect(isMember(g, asUserId('a'))).toBe(true);
  });

  it('같은 자리가 다 차면 다음 사람은 앉을 수 없다', () => {
    let g = unwrap(join(meetup(), user('a'), 'guest', NOW));
    g = unwrap(join(g, user('b'), 'guest', NOW));

    const third = join(g, user('c'), 'guest', NOW);
    expect(third.ok).toBe(false);
    if (!third.ok) expect(third.error.code).toBe('SLOT_FULL');
  });

  it('한쪽이 차도 반대쪽 자리는 남아 있다 (2:2 구성이 안 깨진다)', () => {
    let g = unwrap(join(meetup(), user('a'), 'guest', NOW));
    g = unwrap(join(g, user('b'), 'guest', NOW));
    expect(currentStatus(g, NOW)).toBe('open');

    g = unwrap(join(g, user('c'), 'host', NOW));
    expect(currentStatus(g, NOW)).toBe('full');
  });

  it('이미 참여한 사람은 또 못 앉는다', () => {
    const g = unwrap(join(meetup(), user('a'), 'guest', NOW));
    const again = join(g, user('a'), 'guest', NOW);
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.error.code).toBe('ALREADY_JOINED');
  });

  it('마감이 지나면 못 앉는다', () => {
    const r = join(meetup(), user('a'), 'guest', '2026-09-02T10:00:00.000Z');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('DEADLINE_PASSED');
  });

  it('학교 메일 인증을 안 했으면 못 앉는다', () => {
    const r = join(meetup(), user('a', { verified: false }), 'guest', NOW);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('FORBIDDEN');
  });

  it('노쇼로 신뢰도가 깎인 사람은 막힌다', () => {
    const r = join(meetup(), user('a', { trustScore: 20 }), 'guest', NOW);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('LOW_TRUST');
  });

  it('취소된 모임에는 못 들어간다', () => {
    const cancelled = unwrap(cancel(meetup(), host.id));
    const r = join(cancelled, user('a'), 'guest', NOW);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('NOT_OPEN');
  });
});

describe('밥약 — 주최자 승인', () => {
  it('승인제 모임에는 바로 앉을 수 없다', () => {
    const r = join(meal(), user('a'), MEAL_SLOT, NOW);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('FORBIDDEN');
  });

  it('신청만으로는 자리를 차지하지 않는다', () => {
    const g = unwrap(apply(meal(), user('a'), MEAL_SLOT, '같이 가요', NOW));
    expect(isMember(g, asUserId('a'))).toBe(false);
    expect(g.applicants).toHaveLength(1);
  });

  it('주최자가 승인하면 자리에 앉는다', () => {
    let g = unwrap(apply(meal(), user('a'), MEAL_SLOT, '', NOW));
    g = unwrap(approve(g, host.id, asUserId('a'), NOW));
    expect(isMember(g, asUserId('a'))).toBe(true);
    expect(g.applicants).toHaveLength(0);
  });

  it('주최자가 아니면 승인할 수 없다', () => {
    const g = unwrap(apply(meal(), user('a'), MEAL_SLOT, '', NOW));
    const r = approve(g, asUserId('someone'), asUserId('a'), NOW);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('FORBIDDEN');
  });

  it('정원이 찬 뒤에 남은 신청은 승인되지 않는다', () => {
    // 정원 2명 = 주최자 + 1명
    let g = meal(2);
    g = unwrap(apply(g, user('a'), MEAL_SLOT, '', NOW));
    g = unwrap(apply(g, user('b'), MEAL_SLOT, '', NOW));
    g = unwrap(approve(g, host.id, asUserId('a'), NOW));

    const r = approve(g, host.id, asUserId('b'), NOW);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('SLOT_FULL');
  });
});

describe('취소와 노쇼', () => {
  it('마감 전에는 참여를 취소할 수 있다', () => {
    let g = unwrap(join(meetup(), user('a'), 'guest', NOW));
    g = unwrap(leave(g, asUserId('a'), NOW));
    expect(isMember(g, asUserId('a'))).toBe(false);
  });

  it('마감 후에는 취소할 수 없다 (안 나오면 노쇼로 기록된다)', () => {
    const g = unwrap(join(meetup(), user('a'), 'guest', NOW));
    const r = leave(g, asUserId('a'), '2026-09-02T10:00:00.000Z');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('DEADLINE_PASSED');
  });

  it('주최자는 나갈 수 없다', () => {
    const r = leave(meetup(), host.id, NOW);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('HOST_CANNOT_LEAVE');
  });

  it('모임 시간 전에는 출결을 찍을 수 없다', () => {
    const g = unwrap(join(meetup(), user('a'), 'guest', NOW));
    const r = markAttendance(g, host.id, asUserId('a'), 'noshow', NOW);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('TOO_EARLY');
  });

  it('모임이 끝나면 주최자가 노쇼를 기록한다', () => {
    let g = unwrap(join(meetup(), user('a'), 'guest', NOW));
    g = unwrap(markAttendance(g, host.id, asUserId('a'), 'noshow', AFTER_MEET));
    expect(g.attendance['a']).toBe('noshow');
    expect(g.status).toBe('done');
  });
});
