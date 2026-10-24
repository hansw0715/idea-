import type { InboxNotification } from '../../../shared/notifications';
import type { GatheringView, RoomSummary } from '../../../shared/lounge';
import type { Meeting, Reservation, TimetableEntry } from '../types';
import type { EclassItem } from '../../../shared/school/eclass';
import { isAvailable, needsAttention } from '../school/eclassLogic';

export type Scope = 'home' | 'timetable' | 'lounge' | 'campus' | 'account';
export type Activity = { id: string; title: string; body: string; when?: string; to: string; at: string; scopes: Scope[]; kind: 'reservation' | 'lounge' | 'meeting' | 'notice' | 'friend' | 'chat' | 'timetable' | 'learning' };
export type NoticeData = { school?: { items: { id: string; title: string; date: string; url: string }[] }; department?: { items: { id: string; title: string; date: string; url: string }[] } | null };
export function scopeFor(path: string): Scope | null {
  if (path === '/') return 'home';
  if (path.startsWith('/timetable')) return 'timetable';
  if (path.startsWith('/lounge') || path.startsWith('/meetings')) return 'lounge';
  if (path.startsWith('/campus')) return 'campus';
  if (path.startsWith('/account')) return 'account';
  return null;
}

export function activityDate(at: string, end?: string): string {
  const start = new Date(at);
  if (!Number.isFinite(start.getTime())) return '일시 확인 필요';
  const date = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: 'long', day: 'numeric', weekday: 'short' }).format(start);
  const time = (d: Date) => new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d);
  return `${date} ${time(start)}${end ? `–${time(new Date(end))}` : ''}`;
}
const reservationAt = (r: Reservation, minutes = r.startMin) => new Date(new Date(`${r.date}T00:00:00+09:00`).getTime() + minutes * 60000).toISOString();
export function buildActivity(input: { inbox?: InboxNotification[]; reservations?: Reservation[]; meetings?: Meeting[]; gatherings?: GatheringView[]; rooms?: RoomSummary[]; notices?: NoticeData; timetable?: TimetableEntry[]; learning?: EclassItem[] }, now = Date.now()): Activity[] {
  const result: Activity[] = [];
  const upcomingFor = (id: number) => (input.reservations ?? []).filter((r) => r.meetingId === id && Date.parse(reservationAt(r, r.endMin)) > now).sort((a, b) => reservationAt(a).localeCompare(reservationAt(b)))[0];
  const meetingWhen = (id: number) => { const r = upcomingFor(id); return r ? `예약 · ${activityDate(reservationAt(r), reservationAt(r, r.endMin))}` : '일정 미정 · 회의에서 시간을 정해요.'; };
  for (const n of input.inbox ?? []) {
    const scope = scopeFor(n.url.split('?')[0]) ?? 'lounge';
    const meetingId = /^\/(?:lounge\/)?meetings\/(\d+)/.exec(n.url)?.[1];
    result.push({ id: `inbox:${n.id}`, title: n.title, body: n.body, when: meetingId ? meetingWhen(Number(meetingId)) : `받은 시각 · ${activityDate(n.createdAt)}`, to: n.url, at: n.createdAt, scopes: [scope], kind: scope === 'account' ? 'friend' : meetingId ? 'meeting' : 'lounge' });
  }
  for (const r of input.reservations ?? []) {
    const at = `${r.date}T${String(Math.floor(r.startMin / 60)).padStart(2, '0')}:${String(r.startMin % 60).padStart(2, '0')}:00+09:00`;
    const end = new Date(`${r.date}T00:00:00+09:00`).getTime() + r.endMin * 60000;
    if (end <= now) continue;
    result.push({ id: `reservation:${r.id}:${r.date}:${r.startMin}:${r.endMin}:${r.facilityId}:${r.schoolStatus}`, title: `${r.meetingName} · ${r.facilityName}`, body: r.schoolStatus === 'confirmed' ? '예약 확인 완료' : '예약 일정 확인', when: `예약 · ${activityDate(at, reservationAt(r, r.endMin))}`, to: `/meetings/${r.meetingId}`, at, scopes: ['timetable', 'lounge'], kind: 'reservation' });
  }
  for (const m of input.meetings ?? []) result.push({ id: `meeting:${m.id}:${m.name}:${m.memberCount}`, title: m.name, body: `함께하는 회의 · 팀원 ${m.memberCount ?? 1}명`, when: meetingWhen(m.id), to: `/meetings/${m.id}`, at: m.createdAt, scopes: ['lounge'], kind: 'meeting' });
  for (const g of input.gatherings ?? []) {
    if (g.status === 'cancelled' || g.status === 'done') continue;
    result.push({ id: `gathering:${g.id}:${g.status}:${g.applicantCount}:${g.slots.flatMap((s) => s.members.map((m) => m.id)).join(',')}`, title: g.title, body: `${g.kind === 'meal' ? '밥약' : '미팅'} · ${g.place}${g.applicantCount && g.viewer.isHost ? ` · 참가 신청 ${g.applicantCount}명` : ''}`, when: `약속 · ${activityDate(g.meetAt)}`, to: `/lounge/gatherings/${g.id}`, at: g.meetAt, scopes: ['lounge'], kind: 'lounge' });
  }
  for (const r of input.rooms ?? []) if (r.lastActivityAt) result.push({ id: `chat:${r.id}:${r.lastActivityAt}`, title: r.title, body: '채팅방에 새 대화가 있어요.', when: `약속 · ${activityDate(r.meetAt)}`, to: `/lounge/rooms/${r.id}`, at: r.lastActivityAt, scopes: ['lounge'], kind: 'chat' });
  for (const section of [input.notices?.school, input.notices?.department]) for (const n of section?.items ?? []) result.push({ id: `notice:${n.id}:${n.title}`, title: n.title, body: `${n.date} · 학교·학과 공지`, to: '/campus?tab=notices', at: `${n.date}T00:00:00+09:00`, scopes: ['campus'], kind: 'notice' });
  for (const t of input.timetable ?? []) result.push({ id: `timetable:${t.id}:${t.title}:${t.day}:${t.startMin}:${t.endMin}:${t.place}`, title: t.title, body: '시간표 일정이 추가되거나 변경됐어요.', to: '/timetable', at: '', scopes: ['timetable'], kind: 'timetable' });
  for (const i of input.learning ?? []) if (isAvailable(i, now) && needsAttention(i, now)) result.push({ id: `learning:${i.id}:${i.dueAt}:${i.completion}`, title: i.title, body: i.courseName, to: `/campus?tab=learning&kind=${i.kind}&item=${encodeURIComponent(i.id)}`, at: i.dueAt ?? '', scopes: ['campus'], kind: 'learning' });
  return result;
}
