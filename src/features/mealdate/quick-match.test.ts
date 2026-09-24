import { describe, expect, it } from 'vitest';
import { asUserId } from '@/shared/types';
import {
  allAccepted,
  answer,
  commonBands,
  createRoom,
  decideBand,
  findGroup,
  isCompatible,
  isExpired,
  meetAtOf,
  vote,
  type QuickRequest,
  type QuickRoom,
} from './quick-match';

const NOW = '2026-09-22T01:00:00.000Z';
const never = () => false;

const req = (id: string, over: Partial<QuickRequest> = {}): QuickRequest => ({
  id,
  userId: asUserId(id),
  date: '2026-09-22',
  placeType: '학식',
  size: 2,
  bands: ['b12', 'b13'],
  tags: [],
  status: 'waiting',
  roomId: null,
  createdAt: NOW,
  ...over,
});

const unwrap = (r: ReturnType<typeof vote>): QuickRoom => {
  if (!r.ok) throw new Error(`${r.error.code} ${r.error.message}`);
  return r.value;
};

describe('짝 찾기', () => {
  it('날짜·장소·인원이 같고 시간대가 겹치면 맞는다', () => {
    expect(isCompatible(req('a'), req('b'), never)).toBe(true);
  });

  it('시간대가 하나도 안 겹치면 안 맞는다', () => {
    expect(isCompatible(req('a'), req('b', { bands: ['b18'] }), never)).toBe(false);
  });

  it('인원이 다르면 안 맞는다', () => {
    expect(isCompatible(req('a'), req('b', { size: 4 }), never)).toBe(false);
  });

  it('장소 종류가 다르면 안 맞는다', () => {
    expect(isCompatible(req('a'), req('b', { placeType: '학교 주변' }), never)).toBe(false);
  });

  it('차단한 사이면 안 맞는다', () => {
    expect(isCompatible(req('a'), req('b'), () => true)).toBe(false);
  });

  it("'같은 과만'을 건 쪽과는 학과가 같아야 한다", () => {
    const a = req('a', { tags: ['같은 과만', 'dept:컴공'] });
    expect(isCompatible(a, req('b', { tags: ['dept:컴공'] }), never)).toBe(true);
    expect(isCompatible(a, req('b', { tags: ['dept:패션'] }), never)).toBe(false);
  });

  it('인원이 다 차야 방이 생긴다', () => {
    const target = req('a', { size: 3 });
    const waiting = [req('b', { size: 3 })];
    expect(findGroup(waiting, target, never)).toBeNull();

    const full = findGroup([...waiting, req('c', { size: 3 })], target, never);
    expect(full?.map((r) => r.id)).toEqual(['a', 'b', 'c']);
  });

  it('오래 기다린 사람이 먼저 들어간다', () => {
    const target = req('a');
    const old = req('old', { createdAt: '2026-09-22T00:00:00.000Z' });
    const fresh = req('fresh', { createdAt: '2026-09-22T00:59:00.000Z' });
    expect(findGroup([fresh, old], target, never)?.map((r) => r.id)).toEqual(['a', 'old']);
  });

  it('셋이 모여도 공통 시간대가 없으면 방이 안 생긴다', () => {
    const target = req('a', { size: 3, bands: ['b12', 'b13'] });
    const group = findGroup(
      [req('b', { size: 3, bands: ['b12'] }), req('c', { size: 3, bands: ['b13'] })],
      target,
      never,
    );
    expect(group).toBeNull();
  });

  it('공통 시간대를 계산한다', () => {
    expect(commonBands([req('a', { bands: ['b12', 'b13'] }), req('b', { bands: ['b13', 'b17'] })])).toEqual(['b13']);
  });
});

describe('후보 방', () => {
  const room = () => createRoom('room1', [req('a'), req('b')], NOW);

  it('대기표에 적은 시간이 첫 투표로 들어간다', () => {
    const r = room();
    expect(r.bands).toEqual(['b12', 'b13']);
    expect(r.votes['a']).toEqual(['b12', 'b13']);
    expect(r.status).toBe('pending');
  });

  it('전원이 수락해야 확정된다', () => {
    let r = unwrap(answer(room(), asUserId('a'), 'accepted', NOW));
    expect(r.status).toBe('pending');
    expect(allAccepted(r)).toBe(false);

    r = unwrap(answer(r, asUserId('b'), 'accepted', NOW));
    expect(r.status).toBe('confirmed');
  });

  it('한 명이 거절하면 방이 깨진다', () => {
    let r = unwrap(answer(room(), asUserId('a'), 'accepted', NOW));
    r = unwrap(answer(r, asUserId('b'), 'declined', NOW));
    expect(r.status).toBe('cancelled');
  });

  it('참여자가 아니면 답할 수 없다', () => {
    const r = answer(room(), asUserId('stranger'), 'accepted', NOW);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('FORBIDDEN');
  });

  it('시간이 지나면 답할 수 없다', () => {
    const r = answer(room(), asUserId('a'), 'accepted', '2026-09-22T02:00:00.000Z');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('DEADLINE_PASSED');
    expect(isExpired(room(), '2026-09-22T02:00:00.000Z')).toBe(true);
  });

  it('방에 없는 시간대는 고를 수 없다', () => {
    const r = vote(room(), asUserId('a'), ['b19'], NOW);
    expect(r.ok).toBe(false);
  });
});

describe('시간 결정', () => {
  it('표를 많이 받은 시간대로 정한다', () => {
    let r = createRoom('room1', [req('a'), req('b'), req('c', { size: 3 })], NOW);
    r = unwrap(vote(r, asUserId('a'), ['b13'], NOW));
    r = unwrap(vote(r, asUserId('b'), ['b13'], NOW));
    expect(decideBand(r)).toBe('b13');
  });

  it('동점이면 이른 시간으로 정한다', () => {
    expect(decideBand(createRoom('room1', [req('a'), req('b')], NOW))).toBe('b12');
  });

  it('한국 시간 기준으로 약속 시각을 만든다', () => {
    // 2026-09-22 12:00 KST = 03:00 UTC
    expect(meetAtOf('2026-09-22', 'b12')).toBe('2026-09-22T03:00:00.000Z');
  });
});
