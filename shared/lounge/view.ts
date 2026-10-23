/**
 * 화면(클라이언트)으로 내려가는 DTO — 서버와 클라이언트 사이의 계약.
 *
 * 도메인 모델(Gathering)은 userId 만 들고 있어서 화면에 그대로 못 쓴다.
 * 서버가 닉네임·아바타를 붙이고, "내가 지금 참여할 수 있나?" 같은 판단까지 끝내서
 * 클라이언트가 규칙을 다시 구현하지 않게 한다. (규칙이 두 군데 있으면 반드시 어긋난다)
 * 이메일은 절대 내려보내지 않는다. 실명도 내려보내지 않되, 밥약 매칭(QuickMember)에서만 같은 무리·방 사람에게 보여 준다.
 * 닉네임은 실명을 가린 표기("박○재")이고, 학과·입학년도는 학교 계정에서 읽은 사실이다.
 */
import type { ISODateTime } from './types.js';
import type { AvatarColor, AvatarKey, EmoteKey, PlaceType, ReportReason, ReportStatus, Zone } from './constants.js';
import type { Gender, GatheringKind, GatheringMeta, GatheringStatusView, JoinPolicy, ReviewMark } from './gathering.js';

// ───────────── 사용자 ─────────────

/** 남에게 보여줘도 되는 최소 정보 */
export type PublicUser = {
  id: string;
  nickname: string;
  /** 호환용 — 학교 계정에서는 단과대를 읽을 수 없어 항상 '' */
  college: string;
  /** 학교 계정에서 읽은 학과. 없으면 '' */
  department: string;
  /** 입학년도(4자리). 화면에는 "26학번"처럼 보인다. 학교에서 읽지 못했으면 null */
  admissionYear: number | null;
  /** 성별. 학교 계정에서 읽었거나 내 정보에서 골랐다. 모르면 null */
  gender: Gender | null;
  avatar: AvatarKey;
  avatarColor: AvatarColor;
  /** 매너온도 */
  temperature: number;
};

/** 내 라운지 프로필. 학교 계정을 연동하면 자동으로 만들어진다. `needsProfile` 이 true 면 학교 계정 연동이 필요하다. */
export type Profile = PublicUser & {
  warnings: number;
  banned: boolean;
  /** 정지 사유 문구 (banned 일 때만) */
  banReason: string | null;
  /** 성별이 학교 계정에서 온 값이면 true — 이때는 내 정보에서 바꿀 수 없다 */
  genderFromSchool: boolean;
};

export type MeResponse = {
  /** 프로필을 아직 안 만들었으면 null */
  profile: Profile | null;
  needsProfile: boolean;
  isAdmin: boolean;
};

/**
 * `PUT /api/lounge/me` 본문 — 고칠 수 있는 것은 표정(avatar)과 색(avatarColor)뿐이다.
 * nickname·college·department·admissionYear 를 보내면 400 INVALID (학교 계정 정보로 자동으로 정해진다).
 */
export type ProfileInput = {
  avatar: AvatarKey;
  avatarColor: AvatarColor;
  /** 학교 계정에서 성별을 읽지 못한 경우에만 직접 고를 수 있다 */
  gender?: Gender;
};

// ───────────── 모임 ─────────────

export type SlotView = {
  key: string;
  label: string;
  capacity: number;
  /** 이 성별만 앉을 수 있다. 없으면 누구나 */
  gender?: Gender;
  members: PublicUser[];
  seatsLeft: number;
};

export type ApplicantView = {
  user: PublicUser;
  slotKey: string;
  message: string;
  appliedAt: ISODateTime;
};

export type ViewerState = {
  /** 보고 있는 사람의 id */
  userId: string;
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
  /** 모임이 끝나서 같이 간 사람을 평가할 수 있는가 */
  canReview: boolean;
  /** 참여가 막힌 이유. 버튼 옆에 그대로 보여준다. null 이면 막히지 않음. */
  blockedReason: string | null;
  /** 내 시간표(수업)와 겹치면 그 수업 이름. 겹치지 않으면 null. (참고용 — 막지는 않는다) */
  timetableConflict: string | null;
};

export type GatheringView = {
  id: string;
  kind: GatheringKind;
  title: string;
  body: string;
  place: string;
  meetAt: ISODateTime;
  joinDeadline: ISODateTime;
  joinPolicy: JoinPolicy;
  meta: GatheringMeta;
  status: GatheringStatusView;
  host: PublicUser;
  slots: SlotView[];
  /** 주최자에게만 채워진다. 다른 사람에겐 빈 배열. */
  applicants: ApplicantView[];
  applicantCount: number;
  /** 노쇼로 확정된 참여자 id */
  noshowIds: string[];
  /** 내가 다른 참여자에게 남긴 평가 (userId → mark) */
  myReviews: Record<string, ReviewMark>;
  /** 단톡방이 열려 있는가 (정원이 찼거나 끝난 모임) */
  roomOpen: boolean;
  createdAt: ISODateTime;
  viewer: ViewerState;
};

/** `POST /api/lounge/gatherings/:id/:action` */
export type GatheringAction = 'join' | 'apply' | 'approve' | 'reject' | 'leave' | 'cancel' | 'review';
export type GatheringActionBody = {
  slotKey?: string;
  message?: string;
  userId?: string;
  mark?: ReviewMark;
};

// ───────────── 단톡방 ─────────────

export type ChatMessageView = {
  id: string;
  roomId: string;
  /** system 메시지는 보낸 사람이 없다 */
  userId: string | null;
  kind: 'text' | 'system';
  text: string;
  at: ISODateTime;
  nickname: string;
  mine: boolean;
};

export type RoomView = {
  id: string;
  title: string;
  kind: GatheringKind;
  meetAt: ISODateTime;
  place: string;
  /** 취소되었거나 끝난 모임이면 읽기만 */
  readOnly: boolean;
  members: PublicUser[];
  messages: ChatMessageView[];
};

// ───────────── 밥약 빠른 매칭 ─────────────

/**
 * 택시식 즉시 매칭: 내 위치만 보낸다. 날짜·시간·장소 종류·인원은 서버가 "지금, 학식, 2명"으로 정한다.
 * 위치는 매칭에만 쓰고, 매칭·취소·만료가 되면 서버가 지운다. 다른 사람에게는 거리(50m 단위)만 보인다.
 */
/** 즉시 매칭 입력. size 는 본인 포함 인원(2~4, 없으면 2) — 같은 인원을 고른 사람끼리만 모인다 */
/** friendsOnly: 라운지 친구끼리만 짝지어진다 */
export type QuickInstantInput = { lat: number; lng: number; size?: number; friendsOnly?: boolean };

/** (옛 방식) 날짜·시간대를 직접 고르는 빠른 매칭 입력. 지금 화면은 쓰지 않는다. */
export type QuickLegacyInput = {
  /** YYYY-MM-DD (한국 날짜) */
  date: string;
  placeType: PlaceType;
  /** 본인 포함 2~4 */
  size: number;
  bands: string[];
  tags: string[];
};

export type QuickInput = QuickInstantInput | QuickLegacyInput;

export type QuickRequestView = {
  id: string;
  date: string;
  placeType: PlaceType;
  size: number;
  bands: string[];
  tags: string[];
  /** expired: 즉시 매칭이 QUICK_WAIT_MIN 안에 짝을 못 찾았거나 후보 방이 깨져 대기가 끝남 (다시 위치를 보내면 된다) */
  status: 'waiting' | 'matched' | 'cancelled' | 'expired';
  roomId: string | null;
  createdAt: ISODateTime;
  /** 친구끼리만 찾는 대기표인가 (즉시 매칭) */
  friendsOnly?: boolean;
};

/** 라운지 친구 목록: 친구 · 나에게 온 요청 · 내가 보낸 요청 */
export type FriendsView = {
  /** 친구끼리는 실명도 보인다 */
  friends: QuickMember[];
  /** 나에게 요청한 사람 — 스스로 요청했으니 실명을 보여 준다 */
  incoming: QuickMember[];
  /** 내가 요청한 사람 — 아직 실명은 모르고, 내가 적은 아이디로 보여 준다 */
  outgoing: (PublicUser & { username: string })[];
};

export type QuickRoomView = {
  id: string;
  memberIds: string[];
  date: string;
  placeType: PlaceType;
  size: number;
  /** 모두에게 공통으로 가능한 시간대 key */
  bands: string[];
  /** userId → 가능하다고 한 시간대 */
  votes: Record<string, string[]>;
  answers: Record<string, 'accepted' | 'declined'>;
  status: 'pending' | 'confirmed' | 'cancelled';
  /** 확정되면 만들어진 밥약 id */
  gatheringId: string | null;
  createdAt: ISODateTime;
  expiresAt: ISODateTime;
  /** 즉시 매칭에서 두 사람 사이의 거리(m, 50m 단위로 올림). 옛 방식 방에는 없다 */
  distanceM?: number;
  /** 즉시 매칭 방인가 (시간 투표 없이 수락·거절만) */
  instant?: boolean;
  /** 즉시 방이 확정되면 정해지는 약속 시각 (확정 시각 + QUICK_MEET_AFTER_MIN분) */
  meetAt?: ISODateTime;
};

/** 밥약 매칭에서 보이는 사람 — 밥약은 실제로 만날 사람이라 실명(name)까지 공개한다 */
export type QuickMember = PublicUser & {
  /** 실명. 탈퇴한 사용자는 '' */
  name: string;
};

export type QuickState = {
  request: QuickRequestView | null;
  room: QuickRoomView | null;
  /** 방 멤버 표시용 (실명 포함) */
  members: QuickMember[];
  gatheringId: string | null;
  waitingCount: number;
  /** 방이 열린 상태에서의 "나". 투표·수락 표시에 쓴다. */
  meId: string;
  /**
   * 즉시 매칭으로 찾는 중일 때 지금까지 내 무리에 모인 사람(나 포함, 먼저 온 순). 인원이 다 차면 후보 방이 된다.
   * 찾는 중이 아니면 빈 배열.
   */
  forming: QuickMember[];
};

/** `POST /api/lounge/meals/quick/start` — 3·4명을 찾다가 지금 모인 사람(2명 이상)으로 바로 시작한다. 본문 없음 */

/** `PATCH /api/lounge/meals/quick` — 둘 중 하나만 보낸다 */
export type QuickPatchBody = { roomId: string; bands: string[] } | { roomId: string; answer: 'accepted' | 'declined' };

// ───────────── 안전 · 관리자 ─────────────

export type ReportInput = {
  userId: string;
  /** 어디서 신고했는지 (meetup / meal / profile / chat) */
  context: string;
  refId: string | null;
  reason: ReportReason;
  detail: string;
};

export type ReportView = {
  id: string;
  context: string;
  refId: string | null;
  reason: ReportReason;
  detail: string;
  status: ReportStatus;
  createdAt: ISODateTime;
  handledAt: ISODateTime | null;
  reporter: { id: string; nickname: string };
  target: { id: string; nickname: string; temperature: number; warnings: number; banned: boolean };
  /** 그 사람에 대해 서로 다른 신고자가 낸 미처리 신고 수 */
  openCountForTarget: number;
};

export type ReportAction = 'resolve' | 'dismiss' | 'ban' | 'unban';

export type AdminStats = {
  users: { total: number; profiled: number; banned: number; averageTemperature: number };
  gatherings: { kind: string; total: number; open: number; done: number; cancelled: number; participants: number }[];
  noshow: { confirmed: number; participants: number; rate: number };
};

// ───────────── 라운지 접속자 (presence) ─────────────

export type PresenceUser = {
  user: PublicUser;
  /** 지도 위 위치. 0~1 (가로·세로 비율). */
  x: number;
  y: number;
  zone: Zone;
  /** 말풍선 이모트. 보낸 지 EMOTE_TTL_MS 안일 때만 채워진다. */
  emote: EmoteKey | null;
  seenAt: ISODateTime;
};

export type PresenceResponse = {
  /** 나를 뺀 접속자 (차단 관계는 서로 제외) */
  users: PresenceUser[];
  /** 접속자 수 (나 포함) */
  count: number;
  serverNow: ISODateTime;
};

/** `POST /api/lounge/presence` 본문 */
export type PresenceInput = { x: number; y: number; zone: Zone; emote?: EmoteKey };
