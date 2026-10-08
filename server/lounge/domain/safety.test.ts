import { describe, expect, it } from 'vitest';
import {
  alreadyReported,
  AUTO_RESTRICT_REPORTS,
  excludeReporters,
  hiddenUserIds,
  isAutoRestricted,
  isBlocked,
  isSafeId,
  openReportCount,
  REPORT_REASONS,
  type Block,
  type Report,
} from './safety.js';

const u = (id: string) => id;
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

  it('서로 차단해도 한 번만 센다', () => {
    const both: Block[] = [
      { blockerId: u('a'), blockedId: u('b'), at: AT },
      { blockerId: u('b'), blockedId: u('a'), at: AT },
    ];
    expect(hiddenUserIds(both, u('a'))).toEqual(['b']);
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

  it('집계에서 뺀 신고자(정지된 사람)의 신고는 세지 않고, 원래 목록은 건드리지 않는다', () => {
    const reports = ['a', 'b', 'c'].map((r, i) => report(`r${i}`, r, 'x'));
    const counted = excludeReporters(reports, new Set([u('c')]));
    expect(counted.map((r) => r.reporterId)).toEqual(['a', 'b']);
    expect(isAutoRestricted(counted, u('x'))).toBe(false);
    expect(reports).toHaveLength(3); // 원본 그대로
    expect(isAutoRestricted(reports, u('x'))).toBe(true);

    // 빼지 않을 때는 같은 배열을 그대로 돌려준다 · 빼는 사람이 신고하지 않았다면 아무것도 달라지지 않는다
    expect(excludeReporters(reports, new Set())).toBe(reports);
    expect(excludeReporters(reports, new Set([u('zzz')]))).toEqual(reports);
    // 한 사람이 여러 건을 냈어도 그 사람 것은 전부 빠진다
    const twice = [...reports, report('r9', 'c', 'x', { refId: 'g9' })];
    expect(excludeReporters(twice, new Set([u('c')])).map((r) => r.id)).toEqual(['r0', 'r1']);
  });

  it('관리자가 처리한 신고는 세지 않는다', () => {
    const reports = ['a', 'b', 'c'].map((r, i) => report(`r${i}`, r, 'x', { status: 'dismissed' }));
    expect(isAutoRestricted(reports, u('x'))).toBe(false);
  });

  it('다른 사람에 대한 신고는 세지 않는다', () => {
    const reports = ['a', 'b', 'c'].map((r, i) => report(`r${i}`, r, 'y'));
    expect(openReportCount(reports, u('x'))).toBe(0);
  });

  it('같은 모임을 같은 사람이 또 신고하는 건 막는다', () => {
    const reports = [report('r1', 'a', 'x')];
    expect(alreadyReported(reports, u('a'), u('x'), 'g1')).toBe(true);
    expect(alreadyReported(reports, u('a'), u('x'), 'g2')).toBe(false);
    expect(alreadyReported(reports, u('b'), u('x'), 'g1')).toBe(false);
  });

  it('처리가 끝난 신고는 같은 건으로 다시 신고할 수 있다', () => {
    const reports = [report('r1', 'a', 'x', { status: 'resolved' })];
    expect(alreadyReported(reports, u('a'), u('x'), 'g1')).toBe(false);
  });

  it('refId 가 없는 신고(프로필)도 중복을 가린다', () => {
    const reports = [report('r1', 'a', 'x', { refId: null })];
    expect(alreadyReported(reports, u('a'), u('x'), null)).toBe(true);
    expect(alreadyReported(reports, u('a'), u('x'), 'g1')).toBe(false);
  });

  it('신고 사유는 정해진 목록뿐이다', () => {
    expect(REPORT_REASONS).toContain('약속 불이행(노쇼)');
    expect(REPORT_REASONS).toHaveLength(5);
  });
});

// 회귀: refId · reportId 에 NUL 이 있으면 SQL 에 닿아 Postgres 가 거절 → 500. 입구에서 모양을 고정한다.
describe('신고 id 모양 (isSafeId)', () => {
  it('UUID · 시드 이름 · 영문 숫자 _ - 80자까지는 받는다', () => {
    for (const ok of [
      '0b4f8c1e-9a3d-4e57-8b0a-6f3c2d1e9a77',
      'demo-meetup-open-b',
      'room_1',
      'A',
      'a'.repeat(80),
    ]) {
      expect(isSafeId(ok)).toBe(true);
    }
  });

  it('NUL · 짝 없는 서로게이트 · 공백 · 줄바꿈 · 제어문자 · 따옴표 · 빈 값 · 81자는 거절한다', () => {
    for (const bad of [
      'a\u0000b',
      '\u0000',
      'x\ud800y',
      'x\udc00',
      'a b',
      'a\nb',
      'a\tb',
      'a\u007fb',
      'a\n',
      "a'b",
      'a;b',
      '한글',
      '',
      'a'.repeat(81),
    ]) {
      expect(isSafeId(bad)).toBe(false);
    }
  });

  it('문자열이 아니면 거절한다', () => {
    for (const bad of [undefined, null, 5, {}, [], ['a'], true]) expect(isSafeId(bad)).toBe(false);
  });
});
