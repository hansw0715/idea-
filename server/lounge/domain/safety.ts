/**
 * 차단 · 신고. (ZIP domain/safety 이식)
 *
 * 미팅과 밥약 둘 다 모르는 사람을 만나는 기능이라 안전장치가 서비스의 생명이다.
 * - 차단: 한쪽만 차단해도 **양쪽 모두** 서로의 글과 매칭에서 사라진다(차단한 걸 들키지 않게).
 * - 신고: 서로 다른 사람에게서 일정 건수가 쌓이면 관리자가 볼 때까지 자동으로 이용을 제한한다.
 *
 * 전부 순수 함수. 저장은 repo/safety 가 한다.
 * 신고 사유 목록·임계값은 shared/lounge/constants 가 한 곳에서 정한다.
 */
import type { ISODateTime, UserId } from '../../../shared/lounge/types.js';
import { AUTO_RESTRICT_REPORTS, REPORT_DETAIL_MAX, REPORT_REASONS } from '../../../shared/lounge/constants.js';
import type { ReportReason, ReportStatus } from '../../../shared/lounge/constants.js';

export { AUTO_RESTRICT_REPORTS, REPORT_DETAIL_MAX, REPORT_REASONS };
export type { ReportReason, ReportStatus };

export type Block = {
  blockerId: UserId;
  blockedId: UserId;
  at: ISODateTime;
};

export type Report = {
  id: string;
  reporterId: UserId;
  targetId: UserId;
  /** 어디서 신고했는지 (meal / meetup / profile / chat …) */
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

/**
 * 신고에 붙는 관련 id(모임 id 등)와 신고 id 의 모양. 영문·숫자·`_`·`-` 만, 1~80자.
 * 이 값들은 그대로 SQL 파라미터가 된다 — NUL(\u0000) 이 들어 있으면 Postgres 가 거절해 500 이 되고,
 * 짝 없는 서로게이트·줄바꿈 같은 글자는 관리자 화면을 깨뜨린다. 그래서 길이만 보지 않고 모양을 입구에서 고정한다.
 * (모임 id 는 UUID 이거나 시드의 영문-숫자 이름이다)
 */
export const SAFE_ID_PATTERN = /^[A-Za-z0-9_-]{1,80}$/;
export const isSafeId = (v: unknown): v is string => typeof v === 'string' && SAFE_ID_PATTERN.test(v);

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

/**
 * 자동 제한 집계에서 빼야 할 신고자(이용이 정지된 사람)의 신고를 걸러 낸다.
 *
 * 왜: 정지된 사용자도 신고는 할 수 있어야 한다(괴롭힘을 알릴 길을 막지 않는다) — 신고는 그대로 저장되고 관리자 화면에 보인다.
 * 다만 관리자가 확인하기 전에 사람을 자동으로 정지시키는 근거로 쓰기에는, 이미 제재를 받은 계정들이 서로 짜고 남을 정지시키는
 * 보복 경로가 될 수 있다. 그래서 "서로 다른 신고자 3명" 을 셀 때는 정지되지 않은 신고자만 센다.
 */
export const excludeReporters = (reports: Report[], excluded: ReadonlySet<UserId>): Report[] =>
  excluded.size === 0 ? reports : reports.filter((r) => !excluded.has(r.reporterId));

/** 같은 사람을 같은 모임으로 중복 신고했는지 (버튼 연타 방지) */
export const alreadyReported = (
  reports: Report[],
  reporterId: UserId,
  targetId: UserId,
  refId: string | null,
): boolean =>
  reports.some(
    (r) => r.reporterId === reporterId && r.targetId === targetId && r.refId === refId && r.status === 'open',
  );
