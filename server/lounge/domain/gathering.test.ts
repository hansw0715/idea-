import { describe, expect, it } from 'vitest';
import { MEAL_PRESET, MEAL_SLOT, MEETUP_PRESETS } from '../../../shared/lounge/constants.js';
import type { Gathering } from '../../../shared/lounge/gathering.js';
import {
  apply,
  approve,
  cancel,
  confirmedNoshows,
  createGathering,
  currentStatus,
  isFull,
  isMember,
  isNoshowConfirmed,
  join,
  leave,
  memberIds,
  NOSHOW_MIN_REVIEWERS,
  reject,
  submitReview,
  type GatherUser,
} from './gathering.js';

const NOW = '2026-09-01T09:00:00.000Z';
const DEADLINE = '2026-09-02T09:00:00.000Z';
const MEET_AT = '2026-09-02T12:00:00.000Z';
const AFTER_MEET = '2026-09-02T13:00:00.000Z';

const user = (id: string, over: Partial<GatherUser> = {}): GatherUser => ({
  id,
  banned: false,
  warnings: 0,
  ...over,
});

const host = user('host');

function meetup(): Gathering {
  const created = createGathering(
    {
      id: 'g',
      kind: 'meetup',
      hostId: host.id,
      title: '2:2 미팅',
      body: '',
      place: '삼선교',
      meetAt: MEET_AT,
      joinDeadline: DEADLINE,
      joinPolicy: 'auto',
      // 이 파일의 시험은 정원·마감·평가 규칙을 본다. 성별 자리 규칙은 아래 '미팅 성별 자리'에서 따로 본다.
      slots: MEETUP_PRESETS['2:2'].slots.map(({ gender: _gender, ...slot }) => slot),
    },
    NOW,
  );
  if (!created.ok) throw new Error(created.error.message);
  return created.value;
}

function meal(capacity = 2): Gathering {
  const created = createGathering(
    {
      id: 'm',
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
        id: 'x',
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

  it('이미 지난 시각으로는 못 만든다', () => {
    const r = createGathering(
      {
        id: 'x',
        kind: 'meal',
        hostId: host.id,
        title: 't',
        body: '',
        place: 'p',
        meetAt: NOW,
        joinDeadline: NOW,
        joinPolicy: 'approval',
        slots: MEAL_PRESET(2).slots,
      },
      NOW,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('INVALID');
  });

  it('주최자가 앉을 자리를 고를 수 있고, 없는 자리는 거절한다', () => {
    const base = {
      id: 'x',
      kind: 'meetup' as const,
      hostId: host.id,
      title: 't',
      body: '',
      place: 'p',
      meetAt: MEET_AT,
      joinDeadline: DEADLINE,
      joinPolicy: 'auto' as const,
      slots: MEETUP_PRESETS['2:2'].slots,
    };
    const guestSide = createGathering({ ...base, hostSlotKey: 'guest', hostGender: 'female' }, NOW);
    expect(guestSide.ok && guestSide.value.slots[1].memberIds).toEqual([host.id]);
    const nowhere = createGathering({ ...base, hostSlotKey: 'nope' }, NOW);
    expect(nowhere.ok).toBe(false);
    if (!nowhere.ok) expect(nowhere.error.code).toBe('SLOT_NOT_FOUND');
  });
});

describe('미팅 — 선착순 착석', () => {
  it('빈 자리에 앉으면 바로 확정된다', () => {
    const g = unwrap(join(meetup(), user('a'), 'guest', NOW));
    expect(isMember(g, 'a')).toBe(true);
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
    expect(isFull(g)).toBe(true);
    expect(memberIds(g)).toHaveLength(4);
  });

  it('이미 참여한 사람은 또 못 앉는다', () => {
    const g = unwrap(join(meetup(), user('a'), 'guest', NOW));
    const again = join(g, user('a'), 'guest', NOW);
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.error.code).toBe('ALREADY_JOINED');
  });

  it('없는 자리에는 앉을 수 없다', () => {
    const r = join(meetup(), user('a'), 'balcony', NOW);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('SLOT_NOT_FOUND');
  });

  it('마감이 지나면 못 앉는다', () => {
    const r = join(meetup(), user('a'), 'guest', '2026-09-02T10:00:00.000Z');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('DEADLINE_PASSED');
  });

  it('노쇼 경고로 정지된 사람은 막힌다', () => {
    const r = join(meetup(), user('a', { banned: true, warnings: 2 }), 'guest', NOW);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('BANNED');
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

  it('선착순 모임에는 신청이 아니라 바로 앉는다', () => {
    const r = apply(meetup(), user('a'), 'guest', '', NOW);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('FORBIDDEN');
  });

  it('신청만으로는 자리를 차지하지 않는다', () => {
    const g = unwrap(apply(meal(), user('a'), MEAL_SLOT, '같이 가요', NOW));
    expect(isMember(g, 'a')).toBe(false);
    expect(g.applicants).toHaveLength(1);
  });

  it('같은 사람이 또 신청하면 거절한다', () => {
    const g = unwrap(apply(meal(), user('a'), MEAL_SLOT, '', NOW));
    const again = apply(g, user('a'), MEAL_SLOT, '', NOW);
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.error.code).toBe('ALREADY_JOINED');
  });

  it('주최자가 승인하면 자리에 앉는다', () => {
    let g = unwrap(apply(meal(), user('a'), MEAL_SLOT, '', NOW));
    g = unwrap(approve(g, host.id, 'a', NOW));
    expect(isMember(g, 'a')).toBe(true);
    expect(g.applicants).toHaveLength(0);
  });

  it('주최자가 아니면 승인할 수 없다', () => {
    const g = unwrap(apply(meal(), user('a'), MEAL_SLOT, '', NOW));
    const r = approve(g, 'someone', 'a', NOW);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('FORBIDDEN');
  });

  it('주최자가 거절하면 신청이 사라지고 자리는 그대로다', () => {
    let g = unwrap(apply(meal(), user('a'), MEAL_SLOT, '', NOW));
    g = unwrap(reject(g, host.id, 'a'));
    expect(g.applicants).toHaveLength(0);
    expect(isMember(g, 'a')).toBe(false);
  });

  it('신청하지 않은 사람은 승인·거절할 수 없다', () => {
    const approved = approve(meal(), host.id, 'ghost', NOW);
    expect(approved.ok).toBe(false);
    if (!approved.ok) expect(approved.error.code).toBe('NOT_APPLICANT');
    const rejected = reject(meal(), host.id, 'ghost');
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) expect(rejected.error.code).toBe('NOT_APPLICANT');
  });

  it('정원이 찬 뒤에 남은 신청은 승인되지 않는다', () => {
    // 정원 2명 = 주최자 + 1명
    let g = meal(2);
    g = unwrap(apply(g, user('a'), MEAL_SLOT, '', NOW));
    g = unwrap(apply(g, user('b'), MEAL_SLOT, '', NOW));
    g = unwrap(approve(g, host.id, 'a', NOW));

    const r = approve(g, host.id, 'b', NOW);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('SLOT_FULL');
  });
});

describe('취소와 노쇼', () => {
  it('마감 전에는 참여를 취소할 수 있다', () => {
    let g = unwrap(join(meetup(), user('a'), 'guest', NOW));
    g = unwrap(leave(g, 'a', NOW));
    expect(isMember(g, 'a')).toBe(false);
  });

  it('승인 대기 중인 신청도 취소할 수 있다', () => {
    let g = unwrap(apply(meal(), user('a'), MEAL_SLOT, '', NOW));
    g = unwrap(leave(g, 'a', NOW));
    expect(g.applicants).toHaveLength(0);
  });

  it('마감 후에는 취소할 수 없다 (안 나오면 노쇼로 기록된다)', () => {
    const g = unwrap(join(meetup(), user('a'), 'guest', NOW));
    const r = leave(g, 'a', '2026-09-02T10:00:00.000Z');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('DEADLINE_PASSED');
  });

  it('주최자는 나갈 수 없다', () => {
    const r = leave(meetup(), host.id, NOW);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('HOST_CANNOT_LEAVE');
  });

  it('참여하지 않은 사람은 나갈 수 없다', () => {
    const r = leave(meetup(), 'stranger', NOW);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('NOT_JOINED');
  });

  it('주최자만 모임을 취소할 수 있다', () => {
    const r = cancel(meetup(), 'a');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('FORBIDDEN');
    const g = unwrap(cancel(meetup(), host.id));
    expect(currentStatus(g, NOW)).toBe('cancelled');
  });

  it('모임 시간 전에는 평가할 수 없다', () => {
    const g = unwrap(join(meetup(), user('a'), 'guest', NOW));
    const r = submitReview(g, host.id, 'a', 'noshow', NOW);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('TOO_EARLY');
  });
});

describe('모임 후 상호 평가', () => {
  /** host + a + b 가 참여한 끝난 미팅 */
  function met(): Gathering {
    let g = unwrap(join(meetup(), user('a'), 'guest', NOW));
    g = unwrap(join(g, user('b'), 'guest', NOW));
    return g;
  }

  it('참여자가 서로를 평가하면 기록되고 모임이 종료 상태가 된다', () => {
    const g = unwrap(submitReview(met(), host.id, 'a', 'good', AFTER_MEET));
    expect(g.reviews).toHaveLength(1);
    expect(g.status).toBe('done');
  });

  it('같은 사람을 다시 평가하면 덮어쓴다', () => {
    let g = unwrap(submitReview(met(), host.id, 'a', 'noshow', AFTER_MEET));
    g = unwrap(submitReview(g, host.id, 'a', 'good', AFTER_MEET));
    expect(g.reviews).toHaveLength(1);
    expect(g.reviews[0].mark).toBe('good');
  });

  it('자기 자신은 평가할 수 없다', () => {
    const r = submitReview(met(), host.id, host.id, 'good', AFTER_MEET);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('INVALID');
  });

  it('참여하지 않은 사람은 평가할 수 없다', () => {
    const r = submitReview(met(), 'stranger', 'a', 'noshow', AFTER_MEET);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('NOT_JOINED');
  });

  it('참여자가 아닌 사람을 평가할 수 없다', () => {
    const r = submitReview(met(), host.id, 'stranger', 'good', AFTER_MEET);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('NOT_JOINED');
  });

  it('한 명만 눌러서는 노쇼가 확정되지 않는다', () => {
    const g = unwrap(submitReview(met(), host.id, 'a', 'noshow', AFTER_MEET));
    expect(isNoshowConfirmed(g, 'a')).toBe(false);
  });

  it('나머지 전원이 눌러야 노쇼가 확정된다', () => {
    let g = unwrap(submitReview(met(), host.id, 'a', 'noshow', AFTER_MEET));
    g = unwrap(submitReview(g, 'b', 'a', 'noshow', AFTER_MEET));
    expect(isNoshowConfirmed(g, 'a')).toBe(true);
    expect(confirmedNoshows(g)).toEqual(['a']);
  });

  it('한 명이라도 다르게 평가하면 확정이 풀린다', () => {
    let g = unwrap(submitReview(met(), host.id, 'a', 'noshow', AFTER_MEET));
    g = unwrap(submitReview(g, 'b', 'a', 'noshow', AFTER_MEET));
    g = unwrap(submitReview(g, 'b', 'a', 'good', AFTER_MEET));
    expect(isNoshowConfirmed(g, 'a')).toBe(false);
  });

  // 회귀: 둘뿐인 모임에서는 "나머지 전원" 이 곧 상대 한 명이라 그 한 명의 주장만으로 벌점이 확정됐다.
  // 악의적인 주최자가 1:1 미팅(또는 정원 2 밥약)을 만들어 신청자를 노쇼로 찍으면 실제로 나왔어도 경고가 쌓이고 2건이면 정지됐다.
  it('둘뿐인 모임에서는 상대 한 명이 눌러도 노쇼가 확정되지 않는다 (어느 쪽이 눌러도)', () => {
    const g1 = unwrap(join(meetup(), user('a'), 'guest', NOW));
    const byHost = unwrap(submitReview(g1, host.id, 'a', 'noshow', AFTER_MEET));
    expect(isNoshowConfirmed(byHost, 'a')).toBe(false);
    expect(confirmedNoshows(byHost)).toEqual([]);

    const byGuest = unwrap(submitReview(g1, 'a', host.id, 'noshow', AFTER_MEET));
    expect(isNoshowConfirmed(byGuest, host.id)).toBe(false);

    // 서로 상대를 노쇼로 찍어도 마찬가지 — 평가자가 한 명뿐이다
    const both = unwrap(submitReview(byHost, 'a', host.id, 'noshow', AFTER_MEET));
    expect(confirmedNoshows(both)).toEqual([]);
  });

  it('정원 2 밥약도 마찬가지다', () => {
    let g = unwrap(apply(meal(2), user('a'), MEAL_SLOT, '', NOW));
    g = unwrap(approve(g, host.id, 'a', NOW));
    g = unwrap(submitReview(g, host.id, 'a', 'noshow', AFTER_MEET));
    expect(memberIds(g)).toHaveLength(2);
    expect(isNoshowConfirmed(g, 'a')).toBe(false);
  });

  it(`확정에는 그 사람을 뺀 참여자가 ${NOSHOW_MIN_REVIEWERS}명 이상 필요하다 — 경계는 정확히 ${NOSHOW_MIN_REVIEWERS}명이다`, () => {
    expect(NOSHOW_MIN_REVIEWERS).toBe(2);
    // 나머지 2명(host, b)이 모두 누르면 확정 — 3인 모임의 가장 작은 경우
    let g = unwrap(submitReview(met(), host.id, 'a', 'noshow', AFTER_MEET));
    g = unwrap(submitReview(g, 'b', 'a', 'noshow', AFTER_MEET));
    expect(isNoshowConfirmed(g, 'a')).toBe(true);
  });

  it('4인 모임에서는 나머지 3명이 모두 눌러야 한다', () => {
    let g = unwrap(join(meetup(), user('a'), 'guest', NOW));
    g = unwrap(join(g, user('b'), 'guest', NOW));
    g = unwrap(join(g, user('c'), 'host', NOW));
    g = unwrap(submitReview(g, host.id, 'a', 'noshow', AFTER_MEET));
    g = unwrap(submitReview(g, 'b', 'a', 'noshow', AFTER_MEET));
    expect(isNoshowConfirmed(g, 'a')).toBe(false); // c 가 아직
    g = unwrap(submitReview(g, 'c', 'a', 'noshow', AFTER_MEET));
    expect(isNoshowConfirmed(g, 'a')).toBe(true);
  });

  it('혼자뿐인 모임에서는 확정할 사람이 없다', () => {
    expect(isNoshowConfirmed(meetup(), host.id)).toBe(false);
  });
});

// 시각 경계: 마감·만남 시각과 "같은 순간" 이 어느 쪽으로 판정되는지 고정한다.
// (비교가 >= 에서 > 로 바뀌어도 통과하던 빈틈을 막는다 — 마감 순간에 취소가 되거나 만남 순간에 평가가 안 되면 규칙이 어긋난다)
describe('시각 경계', () => {
  const shift = (iso: string, ms: number) => new Date(Date.parse(iso) + ms).toISOString();
  const BEFORE_DEADLINE = shift(DEADLINE, -1);
  const BEFORE_MEET = shift(MEET_AT, -1);

  it('마감 시각 1ms 전은 open, 마감 순간부터 closed, 만나는 순간부터 done', () => {
    const g = meetup();
    expect(currentStatus(g, BEFORE_DEADLINE)).toBe('open');
    expect(currentStatus(g, DEADLINE)).toBe('closed');
    expect(currentStatus(g, BEFORE_MEET)).toBe('closed');
    expect(currentStatus(g, MEET_AT)).toBe('done');
  });

  it('정원이 차 있으면 마감 순간에도 full, 만나는 순간에는 done', () => {
    let g = unwrap(join(meetup(), user('a'), 'guest', NOW));
    g = unwrap(join(g, user('b'), 'guest', NOW));
    g = unwrap(join(g, user('c'), 'host', NOW));
    expect(currentStatus(g, DEADLINE)).toBe('full');
    expect(currentStatus(g, MEET_AT)).toBe('done');
  });

  it('참여·신청은 마감 1ms 전까지 되고 마감 순간에는 안 된다', () => {
    expect(join(meetup(), user('a'), 'guest', BEFORE_DEADLINE).ok).toBe(true);
    const joinAtDeadline = join(meetup(), user('a'), 'guest', DEADLINE);
    expect(joinAtDeadline.ok).toBe(false);
    if (!joinAtDeadline.ok) expect(joinAtDeadline.error.code).toBe('DEADLINE_PASSED');

    expect(apply(meal(), user('a'), MEAL_SLOT, '', BEFORE_DEADLINE).ok).toBe(true);
    const applyAtDeadline = apply(meal(), user('a'), MEAL_SLOT, '', DEADLINE);
    expect(applyAtDeadline.ok).toBe(false);
    if (!applyAtDeadline.ok) expect(applyAtDeadline.error.code).toBe('DEADLINE_PASSED');
  });

  it('참여 취소는 마감 1ms 전까지 되고 마감 순간에는 안 된다', () => {
    const g = unwrap(join(meetup(), user('a'), 'guest', NOW));
    expect(leave(g, 'a', BEFORE_DEADLINE).ok).toBe(true);
    const atDeadline = leave(g, 'a', DEADLINE);
    expect(atDeadline.ok).toBe(false);
    if (!atDeadline.ok) expect(atDeadline.error.code).toBe('DEADLINE_PASSED');
  });

  it('평가는 만나는 시각 1ms 전에는 안 되고 만나는 순간부터 된다', () => {
    const g = unwrap(join(meetup(), user('a'), 'guest', NOW));
    const early = submitReview(g, host.id, 'a', 'good', BEFORE_MEET);
    expect(early.ok).toBe(false);
    if (!early.ok) expect(early.error.code).toBe('TOO_EARLY');
    expect(submitReview(g, host.id, 'a', 'good', MEET_AT).ok).toBe(true);
  });

  it('만들 때: 만나는 시각이 지금과 같으면 안 되고, 마감 = 만나는 시각은 된다', () => {
    const base = {
      id: 'b',
      kind: 'meetup' as const,
      hostId: host.id,
      title: 't',
      body: '',
      place: 'p',
      joinPolicy: 'auto' as const,
      slots: MEETUP_PRESETS['1:1'].slots,
      hostGender: 'male' as const,
    };
    const atNow = createGathering({ ...base, meetAt: NOW, joinDeadline: NOW }, NOW);
    expect(atNow.ok).toBe(false);
    if (!atNow.ok) expect(atNow.error.code).toBe('INVALID');
    expect(createGathering({ ...base, meetAt: shift(NOW, 1), joinDeadline: shift(NOW, 1) }, NOW).ok).toBe(true);
    expect(createGathering({ ...base, meetAt: MEET_AT, joinDeadline: shift(MEET_AT, 1) }, NOW).ok).toBe(false);
  });
});

describe('상태', () => {
  it('정원이 차면 full, 마감이 지나면 closed, 만나는 시각이 지나면 done', () => {
    let g = meetup();
    expect(currentStatus(g, NOW)).toBe('open');
    expect(currentStatus(g, '2026-09-02T10:00:00.000Z')).toBe('closed');
    expect(currentStatus(g, AFTER_MEET)).toBe('done');

    g = unwrap(join(g, user('a'), 'guest', NOW));
    g = unwrap(join(g, user('b'), 'guest', NOW));
    g = unwrap(join(g, user('c'), 'host', NOW));
    expect(currentStatus(g, NOW)).toBe('full');
    // 정원이 차 있으면 마감이 지나도 full 로 보인다 (자리가 없다는 게 더 중요한 정보)
    expect(currentStatus(g, '2026-09-02T10:00:00.000Z')).toBe('full');
  });
});

describe('미팅 성별 자리 (위 = 남자, 아래 = 여자)', () => {
  const base = {
    id: 'gx',
    kind: 'meetup' as const,
    hostId: host.id,
    title: '2:2',
    body: '',
    place: 'p',
    meetAt: MEET_AT,
    joinDeadline: DEADLINE,
    joinPolicy: 'auto' as const,
    slots: MEETUP_PRESETS['2:2'].slots,
  };

  it('프리셋은 위가 남자, 아래가 여자 자리다', () => {
    expect(MEETUP_PRESETS['2:2'].slots.map((s) => [s.label, s.gender])).toEqual([
      ['남자', 'male'],
      ['여자', 'female'],
    ]);
  });

  it('주최자는 자기 성별 쪽에 앉고, 성별을 모르면 만들 수 없다', () => {
    const byWoman = createGathering({ ...base, hostGender: 'female' }, NOW);
    expect(byWoman.ok && byWoman.value.slots.map((s) => s.memberIds)).toEqual([[], [host.id]]);
    const byMan = createGathering({ ...base, hostGender: 'male' }, NOW);
    expect(byMan.ok && byMan.value.slots.map((s) => s.memberIds)).toEqual([[host.id], []]);
    const unknown = createGathering(base, NOW);
    expect(unknown.ok).toBe(false);
    const wrongSide = createGathering({ ...base, hostGender: 'male', hostSlotKey: 'guest' }, NOW);
    expect(wrongSide.ok).toBe(false);
  });

  it('남자 자리에는 남학생만, 여자 자리에는 여학생만 앉는다', () => {
    const created = createGathering({ ...base, hostGender: 'male' }, NOW);
    if (!created.ok) throw new Error(created.error.message);
    const g = created.value;
    expect(join(g, user('m', { gender: 'male' }), 'host', NOW).ok).toBe(true);
    expect(join(g, user('f', { gender: 'female' }), 'guest', NOW).ok).toBe(true);
    const manDown = join(g, user('m2', { gender: 'male' }), 'guest', NOW);
    expect(manDown.ok).toBe(false);
    if (!manDown.ok) expect(manDown.error.code).toBe('FORBIDDEN');
    expect(join(g, user('f2', { gender: 'female' }), 'host', NOW).ok).toBe(false);
    expect(join(g, user('x'), 'guest', NOW).ok).toBe(false); // 성별을 모르면 못 앉는다
  });
});
