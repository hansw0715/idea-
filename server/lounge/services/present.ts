/**
 * 도메인 모델(Gathering) → 화면 DTO(GatheringView). (ZIP shared/view.ts + server/present.ts 이식)
 *
 * Gathering 은 userId 만 들고 있어서 화면에 그대로 못 쓴다. 여기서 닉네임·아바타를 붙이고,
 * "내가 지금 참여할 수 있나?" 같은 판단까지 서버에서 끝내서 클라이언트가 규칙을 다시 구현하지 않게 한다.
 * (규칙이 두 군데 있으면 반드시 어긋난다)
 *
 * DB 를 읽지 않는 순수 변환이다 — 사용자 맵·차단 집합·시간표 겹침은 호출한 서비스가 미리 모아 넘긴다.
 * 실명·이메일은 절대 내려가지 않는다. 학과는 "같은 학과 제외 미팅이라 못 들어온다" 는 결과(문장)로만 드러난다.
 */
import type { ISODateTime } from '../../../shared/lounge/types.js';
import type { Gathering, GatheringStatusView, ReviewMark } from '../../../shared/lounge/gathering.js';
import type {
  ApplicantView,
  GatheringView,
  PublicUser,
  SlotView,
  ViewerState,
} from '../../../shared/lounge/view.js';
import { banReason, toPublicUser, unknownUser } from '../users.js';
import type { LoungeUser } from '../users.js';
import {
  currentStatus,
  isApplicant,
  isFull,
  isMember,
  isNoshowConfirmed,
  memberIds,
  reviewOf,
  seatsLeft,
} from '../domain/gathering.js';

export type ViewContext = {
  /** 모임에 나오는 사람들 (없는 id 는 탈퇴한 사용자) */
  users: Map<string, LoungeUser>;
  /** 내가 차단했거나 나를 차단한 사람 — 주최자에게 보이는 신청자 목록에서 뺀다 */
  hidden?: Set<string>;
};

/** 이 모임을 화면에 그리는 데 필요한 모든 사용자 id (주최자 · 앉은 사람 · 신청자) */
export function userIdsOf(g: Gathering): string[] {
  return [g.hostId, ...memberIds(g), ...g.applicants.map((a) => a.userId)];
}

const userView = (users: Map<string, LoungeUser>, id: string): PublicUser => {
  const u = users.get(id);
  return u ? toPublicUser(u) : unknownUser(id);
};

/**
 * 참여 버튼을 못 누르는 이유를 사람 말로. null 이면 참여 가능.
 * 순서가 곧 우선순위다 — 이미 참여한 사람에게 "마감" 보다 "이미 참여 중" 이 먼저 보여야 한다.
 */
function blockedReason(
  status: GatheringStatusView,
  viewer: LoungeUser,
  member: boolean,
  applicant: boolean,
  sameDeptBlocked: boolean,
): string | null {
  if (member) return '이미 참여 중';
  if (applicant) return '승인 대기 중';
  if (status === 'cancelled') return '취소된 모임';
  if (status === 'done') return '끝난 모임';
  if (status === 'full') return '마감 (정원 참)';
  if (status === 'closed') return '신청 마감';
  const ban = banReason(viewer);
  if (ban) return ban;
  if (sameDeptBlocked) return '같은 학과는 참여할 수 없는 미팅이에요.';
  return null;
}

/** '같은 학과 제외' 미팅에서 나와 같은 학과인 사람이 주최자·참여자 중에 있는가 (서비스의 join 검사와 같은 기준) */
function hasSameDeptPerson(g: Gathering, users: Map<string, LoungeUser>, viewer: LoungeUser): boolean {
  if (!g.meta.excludeSameDept || !viewer.department) return false;
  return [g.hostId, ...memberIds(g)].some((id) => {
    const u = users.get(id);
    return u !== undefined && u.id !== viewer.id && u.department === viewer.department;
  });
}

export function toView(
  g: Gathering,
  ctx: ViewContext,
  viewer: LoungeUser,
  now: ISODateTime,
  conflict?: string | null,
): GatheringView {
  const { users } = ctx;
  const status = currentStatus(g, now);

  const slots: SlotView[] = g.slots.map((s) => ({
    key: s.key,
    label: s.label,
    capacity: s.capacity,
    seatsLeft: seatsLeft(s),
    members: s.memberIds.map((id) => userView(users, id)),
  }));

  const isHost = g.hostId === viewer.id;
  const member = isMember(g, viewer.id);
  const applicant = isApplicant(g, viewer.id);
  const reason = blockedReason(status, viewer, member, applicant, hasSameDeptPerson(g, users, viewer));

  const viewerState: ViewerState = {
    userId: viewer.id,
    isHost,
    isMember: member,
    isApplicant: applicant,
    mySlotKey: g.slots.find((s) => s.memberIds.includes(viewer.id))?.key ?? null,
    canJoin: reason === null && g.joinPolicy === 'auto',
    canApply: reason === null && g.joinPolicy === 'approval',
    // 도메인 leave() 가 허용하는 때와 같게: 취소·종료가 아니고 마감 전. (정원이 차 있어도 마감 전이면 나갈 수 있다)
    canLeave: member && !isHost && (status === 'open' || status === 'full') && now < g.joinDeadline,
    // 취소된 모임은 만나지 않았으니 평가도 없다 (노쇼 벌점이 잘못 찍히지 않게)
    canReview: member && status !== 'cancelled' && now >= g.meetAt,
    blockedReason: reason,
    timetableConflict: conflict ?? null,
  };

  const visibleApplicants = g.applicants.filter((a) => !ctx.hidden?.has(a.userId));
  const applicants: ApplicantView[] = isHost
    ? visibleApplicants.map((a) => ({
        user: userView(users, a.userId),
        slotKey: a.slotKey,
        message: a.message,
        appliedAt: a.appliedAt,
      }))
    : [];

  const myReviews: Record<string, ReviewMark> = {};
  for (const id of memberIds(g)) {
    const mark = reviewOf(g, viewer.id, id)?.mark;
    if (mark !== undefined) myReviews[id] = mark;
  }

  return {
    id: g.id,
    kind: g.kind,
    title: g.title,
    body: g.body,
    place: g.place,
    meetAt: g.meetAt,
    joinDeadline: g.joinDeadline,
    joinPolicy: g.joinPolicy,
    meta: g.meta,
    status,
    host: userView(users, g.hostId),
    slots,
    applicants,
    applicantCount: visibleApplicants.length,
    noshowIds: memberIds(g).filter((id) => isNoshowConfirmed(g, id)),
    myReviews,
    // 정원이 찼거나 끝난 모임은 단톡방이 열려 있다
    roomOpen: isFull(g) || status === 'done',
    createdAt: g.createdAt,
    viewer: viewerState,
  };
}

const ENDED = new Set<GatheringStatusView>(['done', 'cancelled']);

/** 아직 남은 약속은 가까운 순으로 위에, 끝난 약속은 아래로(최근 것부터) 내린다. */
export function sortMealFeed(views: GatheringView[]): GatheringView[] {
  return [...views].sort((a, b) => {
    const aEnded = ENDED.has(a.status);
    const bEnded = ENDED.has(b.status);
    if (aEnded !== bEnded) return aEnded ? 1 : -1;
    return aEnded ? b.meetAt.localeCompare(a.meetAt) : a.meetAt.localeCompare(b.meetAt);
  });
}

/**
 * 목록 변환. 입력 순서(저장소가 주는 최신순)를 지키되, 밥약 피드만 "곧 먹을 약속"이 위로 오게 다시 정렬한다.
 * (미팅은 새 글이 위로 — 글이 쌓이는 게시판이라 최신순이 자연스럽다)
 */
export function viewList(
  gatherings: Gathering[],
  ctx: ViewContext,
  viewer: LoungeUser,
  now: ISODateTime,
  opts: { kind?: Gathering['kind']; conflicts?: Map<string, string> } = {},
): GatheringView[] {
  const views = gatherings.map((g) => toView(g, ctx, viewer, now, opts.conflicts?.get(g.id)));
  return opts.kind === 'meal' ? sortMealFeed(views) : views;
}
