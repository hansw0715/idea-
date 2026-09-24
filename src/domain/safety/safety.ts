/**
 * 차단 · 신고. (담당: 한승원)
 *
 * 미팅과 밥약 둘 다 모르는 사람을 만나는 기능이라 안전장치가 서비스의 생명이다.
 * - 차단: 한쪽만 차단해도 **양쪽 모두** 서로의 글과 매칭에서 사라진다(차단한 걸 들키지 않게).
 * - 신고: 서로 다른 사람에게서 일정 건수가 쌓이면 관리자가 볼 때까지 자동으로 이용을 제한한다.
 *
 * 전부 순수 함수. 저장은 server/repo가 한다.
 */
import type { ISODateTime, UserId } from '@/shared/types';

export type Block = {
  blockerId: UserId;
  blockedId: UserId;
  at: ISODateTime;
};

export const REPORT_REASONS = [
  '약속 불이행(노쇼)',
  '불쾌한 언행 · 성희롱',
  '허위 정보 · 사칭',
  '외부 홍보 · 영업',
  '기타',
] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

export type ReportStatus = 'open' | 'resolved' | 'dismissed';

export type Report = {
  id: string;
  reporterId: UserId;
  targetId: UserId;
  /** 어디서 신고했는지 (meal / meetup / 사용자 프로필 등) */
  context: string;
  /** 관련 모임 id 같은 것. 없으면 null */
  refId: string | null;
  reason: ReportReason;
  detail: string;
  status: ReportStatus;
  createdAt: ISODateTime;
  handledAt: ISODateTime | null;
  handledBy: UserId | null;
};

/** 서로 다른 신고자가 이 수를 넘기면 관리자가 처리할 때까지 자동 제한 */
export const AUTO_RESTRICT_REPORTS = 3;

/** 한쪽이라도 차단했으면 서로 안 보인다 */
export const isBlocked = (blocks: Block[], a: UserId, b: UserId): boolean =>
  blocks.some(
    (x) => (x.blockerId === a && x.blockedId === b) || (x.blockerId === b && x.blockedId === a),
  );

/** 내가 차단했거나 나를 차단한 사람들 */
export const hiddenUserIds = (blocks: Block[], me: UserId): UserId[] => [
  ...new Set(
    blocks
      .filter((b) => b.blockerId === me || b.blockedId === me)
      .map((b) => (b.blockerId === me ? b.blockedId : b.blockerId)),
  ),
];

/** 처리되지 않은 신고를, 서로 다른 신고자 기준으로 센다 (한 명이 열 번 눌러도 1) */
export const openReportCount = (reports: Report[], targetId: UserId): number =>
  new Set(reports.filter((r) => r.targetId === targetId && r.status === 'open').map((r) => r.reporterId)).size;

/** 신고 누적으로 지금 이용을 막아야 하는가 */
export const isAutoRestricted = (reports: Report[], targetId: UserId): boolean =>
  openReportCount(reports, targetId) >= AUTO_RESTRICT_REPORTS;

/** 같은 사람을 같은 모임으로 중복 신고했는지 (버튼 연타 방지) */
export const alreadyReported = (reports: Report[], reporterId: UserId, targetId: UserId, refId: string | null): boolean =>
  reports.some(
    (r) => r.reporterId === reporterId && r.targetId === targetId && r.refId === refId && r.status === 'open',
  );
