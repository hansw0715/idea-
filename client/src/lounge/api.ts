/**
 * 라운지 API 클라이언트 — 모든 화면이 이것만 부른다. 서버 계약은 docs/lounge/01-contract.md.
 * 응답은 한 겹 벗겨서(unwrap) 돌려준다. 오류는 ApiError(status, message, code) — `code` 로 분기한다.
 */
import { api } from '../api';
import type {
  AdminStats,
  CreateGatheringBody,
  FriendsView,
  GatheringAction,
  GatheringActionBody,
  GatheringKind,
  GatheringView,
  MeResponse,
  PresenceInput,
  PresenceResponse,
  Profile,
  ProfileInput,
  PublicUser,
  QuickInput,
  QuickPatchBody,
  QuickState,
  ReportAction,
  ReportInput,
  ReportView,
  RoomView,
  RoomSummary,
} from '../../../shared/lounge';

const L = '/lounge';

/** 친구 시간표 한 칸 (수업·일정. 예약은 없다) */
export type FriendTimetableEntry = {
  id: number;
  day: number;
  startMin: number;
  endMin: number;
  title: string;
  place: string | null;
  repeatKind: string;
  date: string | null;
};

export const loungeApi = {
  // 프로필
  me: () => api.get<MeResponse>(`${L}/me`),
  saveProfile: (input: ProfileInput) => api.put<{ profile: Profile }>(`${L}/me`, input).then((r) => r.profile),
  user: (id: string) => api.get<{ user: PublicUser }>(`${L}/users/${id}`).then((r) => r.user),

  // 접속자
  presence: () => api.get<PresenceResponse>(`${L}/presence`),
  sendPresence: (input: PresenceInput) => api.post<{ ok: true }>(`${L}/presence`, input),
  /** 라운지를 나갔다고 알린다. 앱을 닫는 중에도 끝까지 보내지도록 keepalive 로 직접 보낸다. */
  leavePresence: () => {
    void fetch(`/api${L}/presence`, { method: 'DELETE', credentials: 'same-origin', keepalive: true }).catch(() => undefined);
  },

  // 모임
  gatherings: (kind?: GatheringKind) =>
    api.get<{ gatherings: GatheringView[] }>(`${L}/gatherings${kind ? `?kind=${kind}` : ''}`).then((r) => r.gatherings),
  /** 내가 주최·참여·신청한 모임 */
  mine: () => api.get<{ gatherings: GatheringView[] }>(`${L}/mine`).then((r) => r.gatherings),
  gathering: (id: string) => api.get<{ gathering: GatheringView }>(`${L}/gatherings/${id}`).then((r) => r.gathering),
  createGathering: (body: CreateGatheringBody) =>
    api.post<{ gathering: GatheringView }>(`${L}/gatherings`, body).then((r) => r.gathering),
  act: (id: string, action: GatheringAction, body: GatheringActionBody = {}) =>
    api.post<{ gathering: GatheringView }>(`${L}/gatherings/${id}/${action}`, body).then((r) => r.gathering),

  // 단톡방
  leaveRoom: (id: string) => api.post<{ ok: true }>(`${L}/gatherings/${id}/leave-room`),
  rooms: () => api.get<{ rooms: RoomSummary[] }>(`${L}/rooms`).then((r) => r.rooms),
  room: (id: string, after?: string) =>
    api
      .get<{ room: RoomView }>(`${L}/gatherings/${id}/messages${after ? `?after=${encodeURIComponent(after)}` : ''}`)
      .then((r) => r.room),
  sendMessage: (id: string, text: string) =>
    api.post<{ room: RoomView }>(`${L}/gatherings/${id}/messages`, { text }).then((r) => r.room),

  // 밥약 빠른 매칭
  quick: () => api.get<{ state: QuickState }>(`${L}/meals/quick`).then((r) => r.state),
  requestQuick: (input: QuickInput) => api.post<{ state: QuickState }>(`${L}/meals/quick`, input).then((r) => r.state),
  patchQuick: (body: QuickPatchBody) => api.patch<{ state: QuickState }>(`${L}/meals/quick`, body).then((r) => r.state),
  cancelQuick: () => api.del<{ state: QuickState }>(`${L}/meals/quick`).then((r) => r.state),
  startQuickNow: () => api.post<{ state: QuickState }>(`${L}/meals/quick/start`, {}).then((r) => r.state),

  // 안전
  blocks: () => api.get<{ blocked: PublicUser[] }>(`${L}/blocks`).then((r) => r.blocked),
  // 친구 (아이디로 요청 → 상대가 수락)
  friends: () => api.get<FriendsView>(`${L}/friends`),
  requestFriend: (username: string) =>
    api.post<FriendsView & { result: 'requested' | 'accepted' }>(`${L}/friends`, { username }),
  acceptFriend: (userId: string) => api.post<FriendsView>(`${L}/friends/accept`, { userId }),
  removeFriend: (userId: string) => api.del<FriendsView>(`${L}/friends`, { userId }),
  askMeal: (userId: string) => api.post<{ ok: true }>(`${L}/friends/meal`, { userId }),
  friendTimetable: (userId: string, week: string) =>
    api.get<{ weekStart: string; entries: FriendTimetableEntry[] }>(`${L}/friends/${userId}/timetable?week=${week}`),
  inviteToMeeting: (meetingId: number, userId: string) =>
    api.post<{ ok: true; alreadyMember: boolean; name: string }>(`/meetings/${meetingId}/invite`, { userId }),
  block: (userId: string) => api.post<{ ok: true }>(`${L}/blocks`, { userId }),
  unblock: (userId: string) => api.del<{ ok: true }>(`${L}/blocks`, { userId }),
  report: (input: ReportInput) => api.post<{ ok: true }>(`${L}/reports`, input),

  // 관리자
  adminReports: () => api.get<{ reports: ReportView[] }>(`${L}/admin/reports`).then((r) => r.reports),
  adminHandleReport: (reportId: string, action: ReportAction) =>
    api.post<{ ok: true }>(`${L}/admin/reports`, { reportId, action }),
  adminStats: () => api.get<AdminStats>(`${L}/admin/stats`),
  adminWithdrawn: () =>
    api
      .get<{ items: { hint: string; withdrawnAt: string; releasedAt: string | null }[] }>(`${L}/admin/withdrawn`)
      .then((r) => r.items),
  adminReleaseWithdrawn: (studentId: string) => api.post<{ ok: true }>(`${L}/admin/withdrawn/release`, { studentId }),
};
