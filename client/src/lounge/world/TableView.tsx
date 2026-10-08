import { memo } from 'react';
import type { CSSProperties } from 'react';
import type { EmoteKey, GatheringView } from '../../../../shared/lounge';
import { Icon } from '../../ui';
import Avatar from '../parts/Avatar';
import { mealGeometry, meetupGeometry, pctX, pctY } from './layout';
import type { SeatSpot } from './layout';
import { captionOf, tableLabel, tableTag } from './tables';
import { EmoteBubble } from './Walker';

/** css 변수로 칸 안의 위치·크기를 넘긴다 (단위 없는 vu 숫자 — world.css 가 --u 를 곱한다) */
const box = (x: number, y: number, w: number, h: number) => ({ '--x': x, '--y': y, '--w': w, '--h': h }) as CSSProperties;

type TableViewProps = {
  g: GatheringView;
  /** 칸 가운데 (vu) */
  cx: number;
  cy: number;
  meId: string;
  /** 사용자 id → 지금 보이는 이모트 (앉은 사람의 말풍선) */
  emotes: Record<string, EmoteKey>;
  /** 테이블 또는 의자를 눌렀다. 빈 의자면 그 자리의 slot key 를 함께 넘긴다. */
  onOpen: (g: GatheringView, slotKey?: string) => void;
};

/**
 * 모임 하나를 테이블과 의자로 그린다.
 *  - 미팅: 직사각 상판, 윗줄=우리 쪽 / 아랫줄=상대 쪽 의자 (줄당 1~4개)
 *  - 밥약: 원형 상판, 둘레에 의자 2~4개
 * 앉은 자리는 아바타, 빈 의자는 점선. 테이블 아래에 "시간 · 제목" 한 줄.
 *
 * 키보드: 테이블과 빈 의자는 Tab 으로 닿는다. 앉은 의자는 누르면 테이블과 같은 시트가 열리므로
 * tabIndex=-1 로 두어(포인터·스크린 리더 탐색은 가능) Tab 정류장을 줄인다 — 미팅 4:4 하나가 의자 8개다.
 */
const TableView = memo(function TableView({ g, cx, cy, meId, emotes, onOpen }: TableViewProps) {
  const geo = g.kind === 'meal' ? mealGeometry(g.slots) : meetupGeometry(g.slots);
  const mine = g.viewer.isHost || g.viewer.isMember || g.viewer.isApplicant;
  const full = g.status === 'full' || g.roomOpen;
  const t = geo.table;

  const renderSeat = (seat: SeatSpot) => {
    const slot = g.slots.find((s) => s.key === seat.slotKey);
    const member = slot?.members[seat.memberIndex];
    const key = `${seat.slotKey}-${seat.seatNo}`;
    if (!member) {
      return (
        <button
          key={key}
          type="button"
          className="lounge-world-seat lounge-world-seat--empty"
          style={box(seat.x, seat.y, seat.w, seat.h)}
          aria-label={`${seat.slotLabel} ${seat.seatNo}번 빈 의자. 누르면 이 자리를 고른 상태로 테이블이 열립니다`}
          onClick={() => onOpen(g, seat.slotKey)}
        >
          <Icon name="plus" className="lounge-world-seat__plus" />
        </button>
      );
    }
    const isMe = member.id === meId;
    return (
      <button
        key={key}
        type="button"
        tabIndex={-1}
        className={`lounge-world-seat lounge-world-seat--taken${isMe ? ' lounge-world-seat--me' : ''}`}
        style={box(seat.x, seat.y, seat.w, seat.h)}
        aria-label={`${seat.slotLabel} ${seat.seatNo}번 의자: ${member.nickname}${isMe ? ' (나)' : ''} 앉아 있음`}
        onClick={() => onOpen(g)}
      >
        <EmoteBubble emote={emotes[member.id]} />
        <Avatar user={member} />
        {isMe && (
          <span className="lounge-world-me-tag" aria-hidden="true">
            나
          </span>
        )}
      </button>
    );
  };

  return (
    <div className="lounge-world-cell" style={{ left: pctX(cx), top: pctY(cy) }} data-gathering={g.id}>
      <button
        type="button"
        className={`lounge-world-table${geo.round ? ' lounge-world-table--round' : ''}${mine ? ' lounge-world-table--mine' : ''}`}
        style={box(t.x, t.y, t.w, t.h)}
        aria-label={tableLabel(g)}
        onClick={() => onOpen(g)}
      >
        {!(geo.round && full) && <span>{tableTag(g)}</span>}
        {full && <Icon name="message" className="lounge-world-table__chat" />}
        <span className="lounge-world-caption" aria-hidden="true">
          {captionOf(g)}
        </span>
      </button>
      {geo.seats.map(renderSeat)}
    </div>
  );
});

export default TableView;
