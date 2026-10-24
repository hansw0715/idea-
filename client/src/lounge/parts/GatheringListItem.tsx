import type { GatheringKind, GatheringStatusView, GatheringView } from '../../../../shared/lounge';
import { Badge, Icon } from '../../ui';
import type { IconName } from '../../ui';
import '../gathering.css';

/**
 * 모임 한 줄 요약 — 종류 아이콘, 제목, 시간·장소, 자리(3/4), 상태 배지, "수업과 겹쳐요" 배지.
 * 목록 모드와 구역 게시판이 같이 쓴다. 눌러서 TableSheet 를 여는 건 호출한 쪽(onOpen)이 한다.
 * 담당: 작업 C2.
 */
export type GatheringListItemProps = {
  gathering: GatheringView;
  onOpen: (g: GatheringView) => void;
};

// ───────────── 표시용 공용 값 (TableSheet 도 같이 쓴다) ─────────────

export const KIND_LABEL: Record<GatheringKind, string> = { meetup: '미팅', meal: '밥약', team: '팀빌딩' };
export const KIND_ICON: Record<GatheringKind, IconName> = { meetup: 'smile', meal: 'utensils', team: 'users' };

type BadgeTone = 'primary' | 'success' | 'warning' | 'danger' | 'info' | 'point' | 'gray';

/** 상태는 색만으로 전하지 않는다 — 항상 글자와 함께 */
export const STATUS_BADGE: Record<GatheringStatusView, { label: string; tone: BadgeTone }> = {
  open: { label: '모집 중', tone: 'primary' },
  full: { label: '마감', tone: 'gray' },
  closed: { label: '신청 마감', tone: 'gray' },
  cancelled: { label: '취소됨', tone: 'danger' },
  done: { label: '종료', tone: 'gray' },
};

/** 내가 얽힌 모임이면 "내 모임" / "신청 중". 아니면 null */
export function relationBadge(g: GatheringView): { label: string; tone: BadgeTone } | null {
  if (g.viewer.isHost || g.viewer.isMember) return { label: '내 모임', tone: 'info' };
  if (g.viewer.isApplicant) return { label: '신청 중', tone: 'warning' };
  return null;
}

/** 앉은 사람 수 / 전체 자리 */
export function seatCount(g: GatheringView): { taken: number; capacity: number } {
  return {
    taken: g.slots.reduce((sum, s) => sum + s.members.length, 0),
    capacity: g.slots.reduce((sum, s) => sum + s.capacity, 0),
  };
}

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
const pad = (n: number) => String(n).padStart(2, '0');
const dayStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

/**
 * 목록용 짧은 시각: 오늘 19:00 / 내일 19:00 / 금 19:00 / 10/24(토) 19:00.
 * 일주일 넘게 멀거나 이미 지난 약속은 날짜를 적는다(요일만으로는 언제인지 헷갈린다). 기기의 시간대 기준이다.
 */
export function shortMeetAt(iso: string, now: number = Date.now()): string {
  const d = new Date(iso);
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const diff = Math.round((dayStart(d) - dayStart(new Date(now))) / 86_400_000);
  if (diff === 0) return `오늘 ${time}`;
  if (diff === 1) return `내일 ${time}`;
  if (diff > 1 && diff < 7) return `${WEEKDAYS[d.getDay()]} ${time}`;
  return `${d.getMonth() + 1}/${d.getDate()}(${WEEKDAYS[d.getDay()]}) ${time}`;
}

export default function GatheringListItem({ gathering: g, onOpen }: GatheringListItemProps) {
  const status = STATUS_BADGE[g.status];
  const relation = relationBadge(g);
  const { taken, capacity } = seatCount(g);
  const when = shortMeetAt(g.meetAt);
  const conflict = g.viewer.timetableConflict;
  const roomOpen = g.roomOpen && g.viewer.isMember;

  // 한 줄 낭독: 무엇인지 → 언제·어디서 → 자리 → 상태 순서
  const label = [
    `${KIND_LABEL[g.kind]}, ${g.title}`,
    `${when}, ${g.place}`,
    `${capacity}명 중 ${taken}명 참여`,
    status.label,
    relation?.label,
    conflict ? `수업과 겹쳐요: ${conflict}` : null,
    roomOpen ? '단톡방 열림' : null,
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <button
      type="button"
      className="list__item list__item--link lounge-gath-item"
      aria-label={label}
      onClick={() => onOpen(g)}
    >
      <span className={`lounge-gath-item__icon lounge-gath-item__icon--${g.kind}`} aria-hidden="true">
        <Icon name={KIND_ICON[g.kind]} />
      </span>
      <span className="list__body lounge-gath-item__body">
        <span className="list__main lounge-gath-item__title">{g.title}</span>
        <span className="list__sub lounge-gath-item__when">
          {when} · {g.place}
        </span>
        <span className="lounge-gath-item__badges">
          {/* 자리 수는 오른쪽 열이 아니라 배지 줄 맨 앞에 둔다 — 글자를 키워도 제목이 쓸 폭이 줄지 않게 */}
          <span className="lounge-gath-item__seats">
            <Icon name="users" className="lounge-gath-badge-icon" />
            <span className="tabular">
              {taken}/{capacity}
            </span>
          </span>
          <span className={`lounge-gath-status lounge-gath-status--${status.tone}`}>{status.label}</span>
          {relation && <span className="lounge-gath-relation">{relation.label}</span>}
          {conflict && (
            <Badge tone="warning">
              <Icon name="alert" className="lounge-gath-badge-icon" />
              수업과 겹쳐요
            </Badge>
          )}
          {roomOpen && (
            <Badge tone="success">
              <Icon name="message" className="lounge-gath-badge-icon" />
              단톡방
            </Badge>
          )}
        </span>
      </span>
      <Icon name="chevron-right" className="list__chev" />
    </button>
  );
}
