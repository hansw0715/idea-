import { useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import {
  DAY_NAMES,
  OPEN_MIN,
  CLOSE_MIN,
  STEP_MIN,
  fmtMin,
  fmtDayHeader,
  weekDates,
  todayStr,
} from '../time';
import type { WeekSlide } from '../useWeek';

/** 팀원 구분용 차분한 카테고리 팔레트 (데이터 구분 목적) */
export const MEMBER_COLORS = [
  '#2a72e5',
  '#058765',
  '#d97706',
  '#7c3aed',
  '#da3944',
  '#0891b2',
  '#be185d',
  '#5d5d5d',
];

export interface GridEntry {
  id: number;
  day: number;
  startMin: number;
  endMin: number;
  title: string;
  place?: string;
  /** 여러 명을 겹쳐 그릴 때: 색·레인 배정용 인덱스 */
  memberIndex?: number;
  /** 'reservation'이면 확정된 회의 예약으로 구분해 그린다. */
  kind?: 'class' | 'reservation';
  /** 예약 블록에 함께 보여줄 날짜·장소 등의 부가 설명 */
  subtitle?: string;
  /** 팀원 시간표에서 누구 일정인지 표시할 이름 */
  memberName?: string;
}

export interface SelectedRange {
  day: number;
  startMin: number;
  endMin: number;
}

interface Props {
  entries: GridEntry[];
  /** 겹쳐 그릴 팀원 수 (1이면 개인 시간표) */
  laneCount?: number;
  compact?: boolean;
  onEntryClick?: (entry: GridEntry) => void;
  /** 드래그로 시간대를 지정할 수 있게 한다. */
  selectable?: boolean;
  /** 드래그가 끝났을 때 선택된 범위 */
  onSelectRange?: (range: SelectedRange) => void;
  /** 확정 전 선택 범위를 표시한다. */
  pendingRange?: SelectedRange | null;
  /** 팀원 모두가 비는 시간대를 배경으로 강조한다. */
  freeRanges?: SelectedRange[];
  /** 보고 있는 주의 월요일 'YYYY-MM-DD'. 주면 머리글에 날짜가 함께 나온다. */
  weekStart?: string;
  /** 주를 넘기는 화살표. 둘 다 없으면 화살표를 그리지 않는다. */
  onPrevWeek?: () => void;
  onNextWeek?: () => void;
  /** 주가 바뀔 때 어느 쪽으로 넘어갈지 (슬라이드 방향) */
  slide?: WeekSlide | null;
}

const TOTAL_MIN = CLOSE_MIN - OPEN_MIN;

interface Placement {
  lane: number;
  lanes: number;
}

/**
 * 같은 날에 시간이 겹치는 항목들을 나란히 배치한다.
 * 수업끼리는 서버가 겹침을 막지만, 서로 다른 주차의 예약은 같은 요일·시간에 겹칠 수 있다.
 */
function placeOverlaps(dayEntries: GridEntry[]): Map<number, Placement> {
  const sorted = [...dayEntries].sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin);
  const result = new Map<number, Placement>();
  let cluster: GridEntry[] = [];
  let clusterEnd = -1;

  const flush = () => {
    if (cluster.length === 0) return;
    const laneEnds: number[] = [];
    const laneOf = new Map<number, number>();
    for (const entry of cluster) {
      let lane = laneEnds.findIndex((end) => end <= entry.startMin);
      if (lane === -1) {
        lane = laneEnds.length;
        laneEnds.push(entry.endMin);
      } else {
        laneEnds[lane] = entry.endMin;
      }
      laneOf.set(entry.id, lane);
    }
    for (const entry of cluster) {
      result.set(entry.id, { lane: laneOf.get(entry.id) ?? 0, lanes: laneEnds.length });
    }
    cluster = [];
    clusterEnd = -1;
  };

  for (const entry of sorted) {
    if (cluster.length > 0 && entry.startMin >= clusterEnd) flush();
    cluster.push(entry);
    clusterEnd = Math.max(clusterEnd, entry.endMin);
  }
  flush();
  return result;
}

function clampMinute(value: number): number {
  return Math.min(CLOSE_MIN, Math.max(OPEN_MIN, value));
}

export default function TimetableGrid({
  entries,
  laneCount = 1,
  compact = false,
  onEntryClick,
  selectable = false,
  onSelectRange,
  pendingRange = null,
  freeRanges,
  weekStart,
  onPrevWeek,
  onNextWeek,
  slide = null,
}: Props) {
  // 이름·장소가 들어갈 만큼의 높이. compact도 글자가 보이도록 넉넉히 잡는다.
  const bodyHeight = compact ? 430 : 600;
  // 가로 눈금선은 마지막 시각(맨 아래 테두리)에는 그리지 않는다.
  const hours: number[] = [];
  for (let m = OPEN_MIN + 60; m < CLOSE_MIN; m += 60) hours.push(m);
  // 시각 표시는 끝 시각까지 보여 준다. 마지막 숫자는 위로 올려 잘리지 않게 한다.
  const hourLabels = [...hours, CLOSE_MIN];

  // 좁은 칸에서는 글자를 넣지 않고, 마우스를 올렸을 때 상세를 띄운다.
  const [hover, setHover] = useState<{ entry: GridEntry; x: number; y: number } | null>(null);
  const [drag, setDrag] = useState<{ day: number; from: number; to: number } | null>(null);
  // 포인터 이벤트가 한 프레임 안에 연달아 들어와도 최신 값을 읽어야 하므로
  // 렌더링용 state와 별개로 ref를 즉시 갱신한다.
  const dragRef = useRef<{ day: number; from: number; to: number } | null>(null);

  function updateDrag(next: { day: number; from: number; to: number } | null) {
    dragRef.current = next;
    setDrag(next);
  }

  function top(min: number): string {
    return `${((min - OPEN_MIN) / TOTAL_MIN) * 100}%`;
  }

  function height(start: number, end: number): string {
    return `${((end - start) / TOTAL_MIN) * 100}%`;
  }

  /** 커서 위치를 30분 단위 시각으로 바꾼다. */
  function minuteAt(clientY: number, column: HTMLElement): number {
    const rect = column.getBoundingClientRect();
    const ratio = (clientY - rect.top) / rect.height;
    return clampMinute(Math.round((OPEN_MIN + ratio * TOTAL_MIN) / STEP_MIN) * STEP_MIN);
  }

  function beginDrag(day: number, e: ReactPointerEvent<HTMLDivElement>) {
    if (!selectable) return;
    const start = minuteAt(e.clientY, e.currentTarget);
    updateDrag({ day, from: start, to: Math.min(CLOSE_MIN, start + STEP_MIN) });
    // 포인터 캡처는 실패해도 드래그 자체는 계속 동작해야 한다.
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* 캡처 미지원 환경 무시 */
    }
  }

  function moveDrag(day: number, e: ReactPointerEvent<HTMLDivElement>) {
    const current = dragRef.current;
    if (!selectable || !current || current.day !== day) return;
    updateDrag({ ...current, to: minuteAt(e.clientY, e.currentTarget) });
  }

  function endDrag(e: ReactPointerEvent<HTMLDivElement>) {
    const current = dragRef.current;
    updateDrag(null);
    if (!selectable || !current) return;
    try {
      e.currentTarget.releasePointerCapture?.(e.pointerId);
    } catch {
      /* 캡처된 적 없으면 무시 */
    }
    const startMin = Math.min(current.from, current.to);
    let endMin = Math.max(current.from, current.to);
    // 짧게 클릭했을 때도 최소 한 칸은 잡히도록 한다.
    if (endMin <= startMin) endMin = Math.min(CLOSE_MIN, startMin + STEP_MIN);
    if (endMin <= startMin) return;
    onSelectRange?.({ day: current.day, startMin, endMin });
  }

  const multi = laneCount > 1;
  const liveRange: SelectedRange | null = drag
    ? {
        day: drag.day,
        startMin: Math.min(drag.from, drag.to),
        endMin: Math.max(Math.max(drag.from, drag.to), Math.min(drag.from, drag.to) + STEP_MIN),
      }
    : pendingRange;

  const dates = weekStart ? weekDates(weekStart) : null;
  const today = todayStr();
  const hasNav = Boolean(onPrevWeek || onNextWeek);
  // key 가 바뀌면 React가 다시 그리면서 슬라이드 애니메이션이 처음부터 재생된다.
  const slideKey = `${weekStart ?? 'fixed'}-${slide?.tick ?? 0}`;

  const grid = (
    <div className="tt">
      <div className="tt-head">
        <div />
        {DAY_NAMES.map((d, i) => (
          <div key={d} className={dates && dates[i] === today ? 'today' : undefined}>
            {dates ? fmtDayHeader(dates[i]) : d}
          </div>
        ))}
      </div>
      <div className="tt-body" style={{ height: bodyHeight }}>
        <div className="tt-times">
          {hourLabels.map((m) => (
            <span
              key={m}
              className={`tt-time-label${m === CLOSE_MIN ? ' last' : ''}`}
              style={{ top: top(m) }}
            >
              {fmtMin(m)}
            </span>
          ))}
        </div>
        {DAY_NAMES.map((_, day) => {
          const dayEntries = entries.filter((e) => e.day === day);
          const placements = multi ? null : placeOverlaps(dayEntries);
          return (
            <div
              key={day}
              className={`tt-col${selectable ? ' selectable' : ''}`}
              onPointerDown={selectable ? (e) => beginDrag(day, e) : undefined}
              onPointerMove={selectable ? (e) => moveDrag(day, e) : undefined}
              onPointerUp={selectable ? endDrag : undefined}
              onPointerCancel={selectable ? () => updateDrag(null) : undefined}
            >
              {freeRanges
                ?.filter((r) => r.day === day)
                .map((r) => (
                  <div
                    key={`free-${r.startMin}`}
                    className="tt-free"
                    style={{ top: top(r.startMin), height: height(r.startMin, r.endMin) }}
                  />
                ))}

              {hours.map((m) => (
                <div key={m} className="tt-hourline" style={{ top: top(m) }} />
              ))}

              {liveRange && liveRange.day === day && (
                <div
                  className="tt-pending"
                  style={{
                    top: top(liveRange.startMin),
                    height: height(liveRange.startMin, liveRange.endMin),
                  }}
                >
                  <span>
                    {fmtMin(liveRange.startMin)}~{fmtMin(liveRange.endMin)}
                  </span>
                </div>
              )}

              {dayEntries.map((e) => {
                const isReservation = e.kind === 'reservation';
                const idx = e.memberIndex ?? 0;
                const color = MEMBER_COLORS[idx % MEMBER_COLORS.length];

                let position: CSSProperties = {};
                if (multi && !isReservation) {
                  // 팀원 시간표는 사람별 세로 레인으로 나눈다.
                  const laneWidth = 100 / laneCount;
                  position = {
                    left: `calc(${idx * laneWidth}% + 2px)`,
                    right: 'auto',
                    width: `calc(${laneWidth}% - 4px)`,
                  };
                } else if (multi) {
                  // 예약은 팀원 전원에게 해당하므로 하루 전체 너비로 그린다.
                  position = {};
                } else {
                  const p = placements?.get(e.id);
                  if (p && p.lanes > 1) {
                    const laneWidth = 100 / p.lanes;
                    position = {
                      left: `calc(${p.lane * laneWidth}% + 2px)`,
                      right: 'auto',
                      width: `calc(${laneWidth}% - 4px)`,
                    };
                  }
                }

                const colorStyle =
                  multi && !isReservation
                    ? { background: `${color}26`, borderLeftColor: color }
                    : {};

                return (
                  <div
                    key={`${isReservation ? 'r' : 'c'}-${e.id}`}
                    className={`tt-entry${isReservation ? ' tt-entry-reservation' : ''}${
                      onEntryClick ? ' clickable' : ''
                    }`}
                    style={{
                      top: top(e.startMin),
                      height: height(e.startMin, e.endMin),
                      ...position,
                      ...colorStyle,
                    }}
                    // 기존 일정 위에서는 드래그가 시작되지 않게 한다.
                    onPointerDown={selectable ? (ev) => ev.stopPropagation() : undefined}
                    onMouseEnter={(ev) => setHover({ entry: e, x: ev.clientX, y: ev.clientY })}
                    onMouseMove={(ev) => setHover({ entry: e, x: ev.clientX, y: ev.clientY })}
                    onMouseLeave={() => setHover(null)}
                    onClick={onEntryClick ? () => onEntryClick(e) : undefined}
                  >
                    {/* 팀원 시간표는 칸이 좁아 글자가 뭉개지므로 마우스 안내로만 보여준다. */}
                    {!multi && <span className="tt-entry-title">{e.title}</span>}
                    {!multi && e.endMin - e.startMin >= 60 && (e.subtitle || e.place) && (
                      <span className="tt-entry-place">{e.subtitle ?? e.place}</span>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );

  /* 툴팁은 position:fixed 라, 애니메이션 중인 요소 안에 두면 좌표가 틀어진다.
     그래서 슬라이드 바깥에 따로 그린다. */
  const tip = hover && (
        <div
          className="tt-tip"
          style={{
            left: Math.min(hover.x + 14, window.innerWidth - 260),
            top: hover.y + 16,
          }}
        >
          <div className="tt-tip-title">{hover.entry.title}</div>
          <div className="tt-tip-time">
            {DAY_NAMES[hover.entry.day]}요일 {fmtMin(hover.entry.startMin)}~
            {fmtMin(hover.entry.endMin)}
          </div>
          {(hover.entry.subtitle || hover.entry.place) && (
            <div className="tt-tip-sub">{hover.entry.subtitle ?? hover.entry.place}</div>
          )}
          {hover.entry.memberName && (
            <div className="tt-tip-owner">
              <span
                className="tt-tip-dot"
                style={{
                  background:
                    MEMBER_COLORS[(hover.entry.memberIndex ?? 0) % MEMBER_COLORS.length],
                }}
              />
              {hover.entry.memberName}
            </div>
          )}
        </div>
  );

  if (!hasNav) {
    return (
      <>
        {grid}
        {tip}
      </>
    );
  }

  return (
    <div className="tt-wrap">
      <button
        type="button"
        className="tt-nav prev"
        onClick={onPrevWeek}
        disabled={!onPrevWeek}
        aria-label="이전 주"
      >
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
          <path
            d="M15 5l-7 7 7 7"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      <div className="tt-slide" key={slideKey} data-dir={slide?.dir}>
        {grid}
      </div>

      <button
        type="button"
        className="tt-nav next"
        onClick={onNextWeek}
        disabled={!onNextWeek}
        aria-label="다음 주"
      >
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
          <path
            d="M9 5l7 7-7 7"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      {tip}
    </div>
  );
}
