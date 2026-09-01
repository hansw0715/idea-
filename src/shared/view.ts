/**
 * 화면에 내려보내는 DTO. (담당: 공용 — 프론트/백 사이의 계약)
 *
 * 도메인 모델(Gathering)은 userId만 들고 있어서 화면에 그대로 못 쓴다.
 * 여기서 닉네임/단과대를 붙이고, "내가 지금 참여할 수 있나?" 같은 판단까지 서버에서 끝내서
 * 클라이언트가 규칙을 다시 구현하지 않게 한다. (규칙이 두 군데 있으면 반드시 어긋난다)
 *
 * 순수 함수라서 서버/클라이언트 어디서 import 해도 안전하다.
 */
import type { AttendanceMark, Gathering, GatheringKind, JoinPolicy } from '@/domain/gathering';
import { currentStatus, isApplicant, isMember, seatsLeft, type GatheringStatusView } from '@/domain/gathering';
import type { User } from './user';
import { MIN_TRUST_TO_JOIN } from './user';

/** 남에게 보여줘도 되는 최소 정보. 실명/메일은 절대 안 내려보낸다. */
export type PublicUser = {
  id: string;
  nickname: string;
  college: string;
  admissionYear: number;
  trustScore: number;
};

export type SlotView = {
  key: string;
  label: string;
  capacity: number;
  members: PublicUser[];
  seatsLeft: number;
};

export type ApplicantView = {
  user: PublicUser;
  slotKey: string;
  message: string;
  appliedAt: string;
};

export type GatheringView = {
  id: string;
  kind: GatheringKind;
  title: string;
  body: string;
  place: string;
  meetAt: string;
  joinDeadline: string;
  joinPolicy: JoinPolicy;
  status: GatheringStatusView;
  host: PublicUser;
  slots: SlotView[];
  /** 주최자에게만 채워진다. 다른 사람에겐 빈 배열. */
  applicants: ApplicantView[];
  applicantCount: number;
  attendance: Record<string, AttendanceMark>;
  createdAt: string;
  viewer: ViewerState;
};

export type ViewerState = {
  isHost: boolean;
  isMember: boolean;
  isApplicant: boolean;
  /** 내가 앉은 자리 */
  mySlotKey: string | null;
  /** 선착순 모임에서 지금 앉을 수 있는가 */
  canJoin: boolean;
  /** 승인제 모임에서 지금 신청할 수 있는가 */
  canApply: boolean;
  /** 마감 전이라 취소할 수 있는가 */
  canLeave: boolean;
  /** 모임이 끝나서 출결을 찍을 수 있는가 (주최자만) */
  canMarkAttendance: boolean;
  /** 참여가 막힌 이유. 버튼 옆에 그대로 보여준다. */
  blockedReason: string | null;
};

export const toPublicUser = (u: User): PublicUser => ({
  id: u.id,
  nickname: u.nickname,
  college: u.college,
  admissionYear: u.admissionYear,
  trustScore: u.trustScore,
});

export function toView(
  g: Gathering,
  users: Map<string, User>,
  viewer: User | null,
  now: string = new Date().toISOString(),
): GatheringView {
  const status = currentStatus(g, now);
  const host = users.get(g.hostId);

  const slots: SlotView[] = g.slots.map((s) => ({
    key: s.key,
    label: s.label,
    capacity: s.capacity,
    seatsLeft: seatsLeft(s),
    members: s.memberIds.map((id) => users.get(id)).filter(Boolean).map((u) => toPublicUser(u!)),
  }));

  const isHost = viewer ? g.hostId === viewer.id : false;
  const member = viewer ? isMember(g, viewer.id) : false;
  const applicant = viewer ? isApplicant(g, viewer.id) : false;

  const viewerState: ViewerState = {
    isHost,
    isMember: member,
    isApplicant: applicant,
    mySlotKey: viewer ? (g.slots.find((s) => s.memberIds.includes(viewer.id))?.key ?? null) : null,
    canJoin: false,
    canApply: false,
    canLeave: member && !isHost && status === 'open',
    canMarkAttendance: isHost && (status === 'done' || now >= g.meetAt),
    blockedReason: blockedReason(status, viewer, member, applicant),
  };

  if (viewerState.blockedReason === null) {
    viewerState.canJoin = g.joinPolicy === 'auto';
    viewerState.canApply = g.joinPolicy === 'approval';
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
    status,
    host: host ? toPublicUser(host) : unknownUser(g.hostId),
    slots,
    applicants: isHost
      ? g.applicants.map((a) => ({
          user: users.get(a.userId) ? toPublicUser(users.get(a.userId)!) : unknownUser(a.userId),
          slotKey: a.slotKey,
          message: a.message,
          appliedAt: a.appliedAt,
        }))
      : [],
    applicantCount: g.applicants.length,
    attendance: g.attendance,
    createdAt: g.createdAt,
    viewer: viewerState,
  };
}

/** 참여 버튼을 못 누르는 이유를 사람 말로. null이면 참여 가능. */
function blockedReason(
  status: GatheringStatusView,
  viewer: User | null,
  member: boolean,
  applicant: boolean,
): string | null {
  if (!viewer) return '로그인이 필요합니다.';
  if (member) return '이미 참여 중';
  if (applicant) return '승인 대기 중';
  if (status === 'cancelled') return '취소된 모임';
  if (status === 'done') return '끝난 모임';
  if (status === 'full') return '마감 (정원 참)';
  if (status === 'closed') return '신청 마감';
  if (!viewer.verified) return '학교 메일 인증 필요';
  if (viewer.trustScore < MIN_TRUST_TO_JOIN) return `노쇼 기록으로 참여 제한 (신뢰도 ${viewer.trustScore})`;
  return null;
}

const unknownUser = (id: string): PublicUser => ({
  id,
  nickname: '(탈퇴한 사용자)',
  college: '-',
  admissionYear: 0,
  trustScore: 0,
});
