/**
 * 지도에 그릴 모임을 고르고, 테이블·의자 문장을 만드는 순수 함수.
 * 지도(World)와 목록(ListMode)·게시판이 같은 규칙을 쓰도록 한 곳에 둔다.
 */
import { formatMeetAt } from '../../../../shared/lounge';
import type { GatheringView, GatheringKind } from '../../../../shared/lounge';
import { MEAL_SLOTS, MEETUP_SLOTS } from './layout';

export type TableKind = Extract<GatheringKind, 'meetup' | 'meal'>;

/** 종료·취소된 모임은 지도에 그리지 않는다 (목록·게시판에만 둔다). 팀빌딩은 이번 단계의 지도에 없다. */
export function isDrawable(g: GatheringView): boolean {
  return (g.kind === 'meetup' || g.kind === 'meal') && (g.status === 'open' || g.status === 'full' || g.status === 'closed');
}

export const isEnded = (g: GatheringView): boolean => g.status === 'done' || g.status === 'cancelled';

/** 내가 주최·참여·신청한 모임인가 */
export const isMine = (g: GatheringView): boolean => g.viewer.isHost || g.viewer.isMember || g.viewer.isApplicant;

/** 내 모임 먼저, 그다음 약속이 가까운 순 (같으면 id 로 고정해 칸이 바뀌지 않게 한다) */
function byPriority(a: GatheringView, b: GatheringView): number {
  const am = isMine(a) ? 0 : 1;
  const bm = isMine(b) ? 0 : 1;
  if (am !== bm) return am - bm;
  if (a.meetAt !== b.meetAt) return a.meetAt < b.meetAt ? -1 : 1;
  return a.id < b.id ? -1 : 1;
}

export type PickedTables = Record<TableKind, GatheringView[]>;

/** 구역별로 칸 수만큼만 고른다. 나머지는 게시판에서 본다. */
export function pickTables(all: GatheringView[]): PickedTables {
  const drawable = all.filter(isDrawable);
  const pick = (kind: TableKind, limit: number) =>
    drawable
      .filter((g) => g.kind === kind)
      .sort(byPriority)
      .slice(0, limit);
  return { meetup: pick('meetup', MEETUP_SLOTS.length), meal: pick('meal', MEAL_SLOTS.length) };
}

/** 구역 게시판에 올릴 글: 진행 중인 것을 위로(내 모임 → 약속이 가까운 순), 끝난 것은 아래로 */
export function boardList(all: GatheringView[], kind: TableKind): GatheringView[] {
  const of = all.filter((g) => g.kind === kind);
  const active = of.filter((g) => !isEnded(g)).sort(byPriority);
  const ended = of.filter(isEnded).sort((a, b) => (a.meetAt < b.meetAt ? 1 : -1));
  return [...active, ...ended];
}

/** 보이는 테이블에 앉은 사람 id → 앉은 모임 (한 사람은 한 번만 그리기 위해) */
export function seatedMap(picked: PickedTables): Map<string, GatheringView> {
  const map = new Map<string, GatheringView>();
  for (const g of [...picked.meetup, ...picked.meal]) {
    for (const slot of g.slots) for (const m of slot.members) if (!map.has(m.id)) map.set(m.id, g);
  }
  return map;
}

// ───────────── 문장 ─────────────

const pad = (n: number) => String(n).padStart(2, '0');
const WD = ['일', '월', '화', '수', '목', '금', '토'];

/** 테이블 아래에 쓰는 짧은 시간: "오늘 19:00" · "내일 12:30" · "금 19:00" */
export function shortWhen(iso: string, now: number = Date.now()): string {
  const d = new Date(iso);
  const day = (t: Date) => new Date(t.getFullYear(), t.getMonth(), t.getDate()).getTime();
  const diff = Math.round((day(d) - day(new Date(now))) / 86_400_000);
  const head = diff === 0 ? '오늘' : diff === 1 ? '내일' : WD[d.getDay()];
  return `${head} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export const kindLabel = (kind: GatheringKind): string => (kind === 'meal' ? '밥약' : kind === 'meetup' ? '미팅' : '모임');

export function capacityOf(g: GatheringView): number {
  return g.slots.reduce((sum, s) => sum + s.capacity, 0);
}
export function seatedOf(g: GatheringView): number {
  return g.slots.reduce((sum, s) => sum + s.members.length, 0);
}

/** 테이블 상판 안의 짧은 표시: 미팅 "2:2", 밥약 "1/3" */
export function tableTag(g: GatheringView): string {
  if (g.kind === 'meal') return `${seatedOf(g)}/${capacityOf(g)}`;
  return g.slots.map((s) => s.capacity).join(':');
}

export function statusWord(g: GatheringView): string {
  if (g.status === 'full') return '정원이 찼음';
  if (g.status === 'closed') return '신청 마감';
  if (g.status === 'done') return '종료';
  if (g.status === 'cancelled') return '취소됨';
  return '자리 있음';
}

/** 테이블 버튼의 낭독 문장. 예) "미팅 테이블: 금요일 저녁 2:2, 4자리 중 3자리 앉음, 자리 있음, 10/9(금) 오후 7:00, 내 약속" */
export function tableLabel(g: GatheringView): string {
  const parts = [
    `${kindLabel(g.kind)} 테이블: ${g.title}`,
    `${capacityOf(g)}자리 중 ${seatedOf(g)}자리 앉음`,
    statusWord(g),
    formatMeetAt(g.meetAt),
  ];
  if (g.viewer.isHost) parts.push('내가 연 약속');
  else if (g.viewer.isMember) parts.push('내 약속');
  else if (g.viewer.isApplicant) parts.push('신청 중');
  if (g.roomOpen) parts.push('단톡방 열림');
  if (g.viewer.timetableConflict) parts.push(`수업과 겹침: ${g.viewer.timetableConflict}`);
  return parts.join(', ');
}

/** 테이블 아래 한 줄: "신청 중 · 금 19:00 · 제목" (제목이 길면 맨 끝이 말줄임으로 잘린다) */
export function captionOf(g: GatheringView): string {
  const prefix = g.viewer.isApplicant && !g.viewer.isMember ? '신청 중 · ' : g.status === 'closed' ? '마감 · ' : '';
  return `${prefix}${shortWhen(g.meetAt)} · ${g.title}`;
}
