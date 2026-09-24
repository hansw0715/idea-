import { describe, expect, it } from 'vitest';
import { asUserId } from '@/shared/types';
import {
  alreadyReported,
  AUTO_RESTRICT_REPORTS,
  hiddenUserIds,
  isAutoRestricted,
  isBlocked,
  openReportCount,
  type Block,
  type Report,
} from './safety';

const u = (id: string) => asUserId(id);
const AT = '2026-09-22T00:00:00.000Z';

const report = (id: string, reporterId: string, targetId: string, over: Partial<Report> = {}): Report => ({
  id,
  reporterId: u(reporterId),
  targetId: u(targetId),
  context: 'meal',
  refId: 'g1',
  reason: '기타',
  detail: '',
  status: 'open',
  createdAt: AT,
  handledAt: null,
  handledBy: null,
  ...over,
});

describe('차단', () => {
  const blocks: Block[] = [{ blockerId: u('a'), blockedId: u('b'), at: AT }];

  it('차단하면 양쪽 모두에게 안 보인다', () => {
    expect(isBlocked(blocks, u('a'), u('b'))).toBe(true);
    expect(isBlocked(blocks, u('b'), u('a'))).toBe(true);
  });

  it('상관없는 사람은 보인다', () => {
    expect(isBlocked(blocks, u('a'), u('c'))).toBe(false);
  });

  it('가려야 할 사람 목록을 모은다', () => {
    const more: Block[] = [...blocks, { blockerId: u('c'), blockedId: u('a'), at: AT }];
    expect(hiddenUserIds(more, u('a')).sort()).toEqual(['b', 'c']);
    expect(hiddenUserIds(more, u('d'))).toEqual([]);
  });
});

describe('신고', () => {
  it('같은 사람이 여러 번 신고해도 1명으로 센다', () => {
    const reports = [report('r1', 'a', 'x'), report('r2', 'a', 'x', { refId: 'g2' })];
    expect(openReportCount(reports, u('x'))).toBe(1);
    expect(isAutoRestricted(reports, u('x'))).toBe(false);
  });

  it(`서로 다른 ${AUTO_RESTRICT_REPORTS}명이 신고하면 자동 제한된다`, () => {
    const reports = ['a', 'b', 'c'].map((r, i) => report(`r${i}`, r, 'x'));
    expect(openReportCount(reports, u('x'))).toBe(AUTO_RESTRICT_REPORTS);
    expect(isAutoRestricted(reports, u('x'))).toBe(true);
  });

  it('관리자가 처리한 신고는 세지 않는다', () => {
    const reports = ['a', 'b', 'c'].map((r, i) => report(`r${i}`, r, 'x', { status: 'dismissed' }));
    expect(isAutoRestricted(reports, u('x'))).toBe(false);
  });

  it('같은 모임을 같은 사람이 또 신고하는 건 막는다', () => {
    const reports = [report('r1', 'a', 'x')];
    expect(alreadyReported(reports, u('a'), u('x'), 'g1')).toBe(true);
    expect(alreadyReported(reports, u('a'), u('x'), 'g2')).toBe(false);
    expect(alreadyReported(reports, u('b'), u('x'), 'g1')).toBe(false);
  });
});
