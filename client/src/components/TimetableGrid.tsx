import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type {
  CSSProperties,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  ReactNode,
} from 'react';
import { Badge, Button, Icon, Sheet, Spinner } from '../ui';
import {
  DAY_NAMES,
  OPEN_MIN,
  RESERVE_CLOSE_MIN,
  STEP_MIN,
  fmtMin,
  fmtDayHeader,
  fmtWeekLabel,
  weekDates,
  todayStr,
} from '../time';
import type { WeekSlide } from '../useWeek';
import './timetable.css';

/** 팀원 구분용 색 (tokens.css 의 --m-1 … --m-8). 항상 이름·위치와 함께 쓴다. */
export const MEMBER_COLORS = [
  'var(--m-1)',
  'var(--m-2)',
  'var(--m-3)',
  'var(--m-4)',
  'var(--m-5)',
  'var(--m-6)',
  'var(--m-7)',
  'var(--m-8)',
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
  /** 홈처럼 작게 보여 줄 때 (시간당 높이를 줄인다) */
  compact?: boolean;
  /**
   * 항목을 눌렀을 때. 주면 이 함수가 우선하고(시간표 화면은 삭제 흐름으로 연결),
   * 없으면 격자가 자체 읽기 전용 정보 시트를 연다.
   */
  onEntryClick?: (entry: GridEntry) => void;
  /** 시간대를 직접 고를 수 있게 한다. (마우스: 눌러 끌기 / 터치: 탭 = 한 칸, 길게 눌러 끌기 = 범위) */
  selectable?: boolean;
  /** 선택이 끝났을 때 고른 범위 */
  onSelectRange?: (range: SelectedRange) => void;
  /** 확정 전 선택 범위를 표시한다. */
  pendingRange?: SelectedRange | null;
  /** 팀원 모두가 비는 시간대를 배경으로 강조한다. */
  freeRanges?: SelectedRange[];
  /** 보고 있는 주의 월요일 'YYYY-MM-DD'. 주면 머리글에 날짜가 함께 나온다. */
  weekStart?: string;
  /** 주를 넘기는 화살표. 둘 다 없으면 이동 바를 그리지 않는다. */
  onPrevWeek?: () => void;
  onNextWeek?: () => void;
  /** 주가 바뀔 때 어느 쪽으로 넘어갈지 (슬라이드 방향) */
  slide?: WeekSlide | null;
  /** 고를 때의 시간 단위(분). 학교 예약은 정각 1시간 단위라 60을 넘긴다. */
  step?: number;
  /** 격자가 끝나는 시각(분). 기본은 22:00 — 시간표 화면은 일정에 맞춰 줄이거나 늘려서 넘긴다. */
  closeMin?: number;
}

/** 길게 눌러야 범위 선택이 시작되는 시간 (그 전에 움직이면 스크롤로 본다) */
const LONG_PRESS_MS = 350;
/** 누른 채 이만큼(px) 움직이면 스크롤 의도로 본다 */
const MOVE_SLOP_PX = 10;
/** 블록 글자 한 줄 높이(rem) = 1.3rem × 1.25 */
const TEXT_LINE_REM = 1.625;

/* ─────────────────────────────────────────────────────────────
   겹침 배치
   ───────────────────────────────────────────────────────────── */
interface Placement {
  lane: number;
  lanes: number;
}

/**
 * 같은 날에 시간이 겹치는 항목들을 나란히 배치한다.
 * 수업끼리는 서버가 겹침을 막지만, 서로 다른 주차의 예약은 같은 요일·시간에 겹칠 수 있다.
 * 수업 id 와 예약 id 는 서로 겹칠 수 있으므로 id 가 아니라 항목 객체로 구분한다.
 */
function placeOverlaps(dayEntries: GridEntry[]): Map<GridEntry, Placement> {
  const sorted = [...dayEntries].sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin);
  const result = new Map<GridEntry, Placement>();
  let cluster: GridEntry[] = [];
  let clusterEnd = -1;

  const flush = () => {
    if (cluster.length === 0) return;
    const laneEnds: number[] = [];
    const laneOf = new Map<GridEntry, number>();
    for (const entry of cluster) {
      let lane = laneEnds.findIndex((end) => end <= entry.startMin);
      if (lane === -1) {
        lane = laneEnds.length;
        laneEnds.push(entry.endMin);
      } else {
        laneEnds[lane] = entry.endMin;
      }
      laneOf.set(entry, lane);
    }
    for (const entry of cluster) {
      result.set(entry, { lane: laneOf.get(entry) ?? 0, lanes: laneEnds.length });
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

/** '월요일 10:00~12:00' */
export function entryTimeText(e: Pick<GridEntry, 'day' | 'startMin' | 'endMin'>): string {
  return `${DAY_NAMES[e.day] ?? ''}요일 ${fmtMin(e.startMin)}~${fmtMin(e.endMin)}`;
}

function entryLabel(e: GridEntry): string {
  const parts = [e.kind === 'reservation' ? `회의 예약 ${e.title}` : e.title, entryTimeText(e)];
  const extra = e.subtitle ?? e.place;
  if (extra) parts.push(extra);
  if (e.memberName) parts.push(e.memberName);
  return parts.join(', ');
}

/** 블록 높이(분)에 글자가 몇 줄 들어가는지 */
function textLines(minutes: number, hourRem: number): number {
  return Math.max(1, Math.floor(((minutes / 60) * hourRem - 0.5) / TEXT_LINE_REM));
}

/** 손가락을 뗀 뒤 뒤늦게 오는 click 이 방금 열린 시트 위에 떨어지지 않도록 한 번 삼킨다. */
function swallowNextClick() {
  const done = () => {
    window.removeEventListener('click', stop, true);
    window.clearTimeout(timer);
  };
  const stop = (ev: Event) => {
    ev.stopPropagation();
    ev.preventDefault();
    done();
  };
  const timer = window.setTimeout(done, 600);
  window.addEventListener('click', stop, true);
}

/* ─────────────────────────────────────────────────────────────
   주 이동 바 · 범례 · 정보 시트 (시간표 화면과 공용)
   ───────────────────────────────────────────────────────────── */
interface WeekNavProps {
  /** 큰 글자 (예: 2026년 10월) */
  label?: string;
  /** 작은 글자 (예: 10/5(월) ~ 10/9(금)) */
  sub?: string;
  onPrev?: () => void;
  onNext?: () => void;
  /** 주면 "이번 주로" 버튼을 보여 준다 (이번 주가 아닐 때만 넘긴다) */
  onToday?: () => void;
  /** 다른 주 일정을 받아 오는 중 */
  busy?: boolean;
  /** 격자 바로 위에 붙는 작은 형태 */
  compact?: boolean;
}

/** ‹ 이전 주 | 라벨 | 다음 주 › (터치 44px 이상) */
export function WeekNav({ label, sub, onPrev, onNext, onToday, busy, compact }: WeekNavProps) {
  return (
    <div className={`tt-weeknav${compact ? ' tt-weeknav--compact' : ''}`}>
      <Button
        variant="tertiary"
        className="tt-weeknav__btn"
        onClick={onPrev}
        disabled={!onPrev}
        aria-label="이전 주"
      >
        <Icon name="chevron-left" className="btn__icon" />
      </Button>
      <div className="tt-weeknav__center" aria-live="polite" aria-atomic="true">
        {(label || busy) && (
          <div className="tt-weeknav__line">
            {label && <span className="tt-weeknav__label">{label}</span>}
            {busy && <Spinner label="시간표를 불러오는 중입니다." />}
          </div>
        )}
        {sub && <span className="tt-weeknav__sub">{sub}</span>}
        {onToday && (
          <Button variant="text" onClick={onToday}>
            이번 주로
          </Button>
        )}
      </div>
      <Button
        variant="tertiary"
        className="tt-weeknav__btn"
        onClick={onNext}
        disabled={!onNext}
        aria-label="다음 주"
      >
        <Icon name="chevron-right" className="btn__icon" />
      </Button>
    </div>
  );
}

type LegendItem = 'class' | 'reservation' | 'free' | 'pending';

const LEGEND_TEXT: Record<LegendItem, string> = {
  class: '내 수업·일정',
  reservation: '회의 예약과 계획 (학교 처리 상태 확인)',
  free: '모두 비는 시간',
  pending: '선택한 시간',
};

/** 격자에 쓰인 모양과 같은 견본 + 글자. 색만으로 구분하지 않는다. */
export function GridLegend({ items = ['class', 'reservation'] }: { items?: LegendItem[] }) {
  return (
    <ul className="tt-legend" aria-label="범례">
      {items.map((item) => (
        <li key={item} className="tt-legend__item">
          <span
            className={`tt-swatch${
              item === 'reservation'
                ? ' tt-swatch--res'
                : item === 'free'
                  ? ' tt-swatch--free'
                  : item === 'pending'
                    ? ' tt-swatch--pending'
                    : ''
              }`}
            aria-hidden="true"
          />
          <span>{LEGEND_TEXT[item]}</span>
        </li>
      ))}
    </ul>
  );
}

interface EntryInfoSheetProps {
  /** 보여 줄 항목. null 이면 닫힌다. */
  entry: GridEntry | null;
  onClose: () => void;
  /** 시트 아래 버튼. 없으면 "닫기" 하나. */
  footer?: ReactNode;
  /** 정보 아래에 덧붙일 내용 (안내 문구 등) */
  children?: ReactNode;
}

/** 항목 하나의 정보(제목·요일 시간·장소/부제·팀원 이름)를 보여 주는 바텀 시트. hover 가 없는 모바일의 툴팁 대신 쓴다. */
export function EntryInfoSheet({ entry, onClose, footer, children }: EntryInfoSheetProps) {
  // 닫히는 400ms 동안에도 내용이 남아 있도록 마지막 항목을 기억한다.
  const [shown, setShown] = useState<GridEntry | null>(entry);
  useEffect(() => {
    if (entry) setShown(entry);
  }, [entry]);
  if (!shown) return null;

  const isReservation = shown.kind === 'reservation';
  const color = MEMBER_COLORS[(shown.memberIndex ?? 0) % MEMBER_COLORS.length];

  return (
    <Sheet
      open={entry !== null}
      onClose={onClose}
      title={shown.title}
      footer={
        footer ?? (
          <Button variant="tertiary" onClick={onClose}>
            닫기
          </Button>
        )
      }
    >
      <div className="tt-info">
        <div className="tt-info__tags">
          {isReservation ? (
            <Badge tone="success">회의 예약</Badge>
          ) : (
            <Badge tone="primary">수업·일정</Badge>
          )}
        </div>
        <div className="kv">
          <span className="tt-info__key">시간</span>
          <span className="tt-info__val">{entryTimeText(shown)}</span>
        </div>
        {shown.memberName && (
          <div className="kv">
            <span className="tt-info__key">팀원</span>
            <span className="tt-info__val">
              <span className="tt-dot" style={{ background: color }} aria-hidden="true" />
              {shown.memberName}
            </span>
          </div>
        )}
        {/* 부제가 장소와 같으면(팀원 시간표) 같은 말을 두 번 보이지 않는다. */}
        {shown.subtitle && shown.subtitle !== shown.place && (
          <div className="kv">
            <span className="tt-info__key">{isReservation ? '예약 정보' : '안내'}</span>
            <span className="tt-info__val">{shown.subtitle}</span>
          </div>
        )}
        {shown.place && (
          <div className="kv">
            <span className="tt-info__key">장소</span>
            <span className="tt-info__val">{shown.place}</span>
          </div>
        )}
        {children}
      </div>
    </Sheet>
  );
}

/* ─────────────────────────────────────────────────────────────
   일정 목록 (격자와 같은 정보를 큰 눌림 대상으로 보여 주는 대체 보기)
   - 팀원 시간표: 사람마다 가로 폭이 20px 안팎이라 칸을 정확히 누르기 어렵다.
   - 글자를 크게 키운 좁은 화면: 칸 안에 글자를 쓰지 않으므로 이름을 읽을 수 없다.
   ───────────────────────────────────────────────────────────── */
interface ListGroup {
  key: string;
  label: string;
  color?: string;
  entries: GridEntry[];
}

function byTime(a: GridEntry, b: GridEntry): number {
  return a.day - b.day || a.startMin - b.startMin || a.endMin - b.endMin;
}

/** 팀원 시간표는 사람별(예약은 따로), 개인 시간표는 요일별로 묶는다. */
function buildListGroups(entries: GridEntry[], multi: boolean): ListGroup[] {
  const sorted = [...entries].sort(byTime);
  if (multi) {
    const members = new Map<number, ListGroup>();
    const reservations: GridEntry[] = [];
    for (const e of sorted) {
      if (e.kind === 'reservation') {
        reservations.push(e);
        continue;
      }
      const idx = e.memberIndex ?? 0;
      let group = members.get(idx);
      if (!group) {
        group = {
          key: `m-${idx}`,
          label: e.memberName ?? `팀원 ${idx + 1}`,
          color: MEMBER_COLORS[idx % MEMBER_COLORS.length],
          entries: [],
        };
        members.set(idx, group);
      }
      group.entries.push(e);
    }
    const groups = [...members.entries()].sort((a, b) => a[0] - b[0]).map(([, g]) => g);
    if (reservations.length > 0) groups.push({ key: 'res', label: '회의 예약', entries: reservations });
    return groups;
  }

  const days = new Map<number, GridEntry[]>();
  for (const e of sorted) days.set(e.day, [...(days.get(e.day) ?? []), e]);
  return [...days.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([day, list]) => ({ key: `d-${day}`, label: `${DAY_NAMES[day]}요일`, entries: list }));
}

interface EntryListProps {
  /** 격자에 실제로 그려지는 항목 */
  entries: GridEntry[];
  /** 팀원 시간표(사람별 레인)인지 */
  multi: boolean;
  onPick: (entry: GridEntry) => void;
}

function EntryList({ entries, multi, onPick }: EntryListProps) {
  const [open, setOpen] = useState(false);
  const uid = useId();
  const groups = useMemo(() => buildListGroups(entries, multi), [entries, multi]);
  const count = groups.reduce((n, g) => n + g.entries.length, 0);
  if (count === 0) return null;

  const bodyId = `${uid}-body`;
  return (
    // 팀원 시간표는 늘 보이고, 개인 시간표는 칸에 글자가 안 들어갈 만큼 좁을 때만 보인다. (css 컨테이너 쿼리)
    <div className={`tt-list${multi ? '' : ' tt-list--narrow'}`}>
      <p className="tt-list__hint">
        {multi
          ? '팀원 칸은 좁아서 글자를 쓰지 않았습니다. 칸을 누르거나 목록으로 확인해 주세요.'
          : '글자가 커서 칸 안에 일정 이름을 쓰지 않았습니다. 칸을 누르거나 목록으로 확인해 주세요.'}
      </p>
      <Button
        variant="tertiary"
        block
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => setOpen((v) => !v)}
      >
        {open ? '일정 목록 닫기' : `일정 목록 보기 (${count}개)`}
        <Icon name={open ? 'chevron-up' : 'chevron-down'} className="btn__icon" />
      </Button>
      <div id={bodyId} className="tt-list__body" hidden={!open}>
        {groups.map((group) => {
          const titleId = `${uid}-${group.key}`;
          return (
            <div key={group.key} role="group" aria-labelledby={titleId} className="tt-list__group">
              <p className="tt-list__title" id={titleId}>
                {group.color && (
                  <span className="tt-dot" style={{ background: group.color }} aria-hidden="true" />
                )}
                {group.label}
              </p>
              <ul className="tt-list__rows">
                {group.entries.map((e) => {
                  const reservation = e.kind === 'reservation';
                  const extra = e.subtitle ?? e.place;
                  const when = multi ? entryTimeText(e) : `${fmtMin(e.startMin)}~${fmtMin(e.endMin)}`;
                  return (
                    <li key={`${reservation ? 'r' : 'c'}-${e.memberIndex ?? 0}-${e.id}`}>
                      <button
                        type="button"
                        className="list__item list__item--link tt-list__row"
                        onClick={() => onPick(e)}
                      >
                        <span className="list__body">
                          <span className="list__main tt-list__main">
                            {reservation ? `회의 예약 · ${e.title}` : e.title}
                          </span>
                          <span className="list__sub tt-list__sub">
                            {extra ? `${when} · ${extra}` : when}
                          </span>
                        </span>
                        <Icon name="chevron-right" className="list__chev" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   격자
   ───────────────────────────────────────────────────────────── */
interface DragView {
  day: number;
  from: number;
  to: number;
}

interface PressState {
  day: number;
  pointerId: number;
  x: number;
  y: number;
  col: HTMLElement;
  timer: number;
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
  step = STEP_MIN,
  closeMin = RESERVE_CLOSE_MIN,
}: Props) {
  const totalMin = closeMin - OPEN_MIN;
  const clampMinute = (value: number): number => Math.min(closeMin, Math.max(OPEN_MIN, value));
  // 시간당 높이(rem). 글자 줄 수 계산에도 쓴다.
  // 홈처럼 줄인 격자도 정각 1시간 블록(수업·예약)이 터치 대상 최소 높이(--touch, 4.4rem)를 채우도록 한다.
  const hourRem = compact ? 4.4 : 4.6;
  const cells = Math.ceil(totalMin / step);

  // 시각 글자는 각 시간 칸의 맨 위(눈금선 바로 아래)에 같은 방식으로 붙인다. 마감(22:00)은 칸이 아니라 끝선이라 글자를 달지 않는다.
  const hourLabels: number[] = [];
  for (let m = OPEN_MIN; m < closeMin; m += 60) hourLabels.push(m);

  const rootRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<DragView | null>(null);
  // 포인터 이벤트가 한 프레임 안에 연달아 들어와도 최신 값을 읽어야 하므로 ref 도 함께 갱신한다.
  const dragRef = useRef<DragView | null>(null);
  const dragColRef = useRef<HTMLElement | null>(null);
  const pressRef = useRef<PressState | null>(null);
  const touchDragRef = useRef(false);
  const lastTypeRef = useRef('mouse');
  const lastUpRef = useRef(0);
  const blockClickUntilRef = useRef(0);
  const lastYRef = useRef(0);
  const scrollRafRef = useRef(0);
  const [info, setInfo] = useState<GridEntry | null>(null);

  function commitDrag(next: DragView | null) {
    dragRef.current = next;
    setDrag(next);
  }

  /** 세로 위치 → 칸 번호 (눌린 칸 자체가 선택된다) */
  function cellAt(clientY: number, col: HTMLElement): number {
    const rect = col.getBoundingClientRect();
    if (rect.height <= 0) return 0;
    const ratio = (clientY - rect.top) / rect.height;
    const raw = Math.floor((ratio * totalMin) / step);
    return Math.min(cells - 1, Math.max(0, raw));
  }

  function rangeOf(day: number, a: number, b: number): SelectedRange {
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    return {
      day,
      startMin: clampMinute(OPEN_MIN + lo * step),
      endMin: clampMinute(OPEN_MIN + (hi + 1) * step),
    };
  }

  function clearPress() {
    const press = pressRef.current;
    if (press) window.clearTimeout(press.timer);
    pressRef.current = null;
  }

  function stopAutoScroll() {
    window.cancelAnimationFrame(scrollRafRef.current);
    scrollRafRef.current = 0;
  }

  /** 끄는 손가락이 화면 위·아래 가장자리에 닿으면 페이지를 같이 넘겨, 화면보다 긴 범위도 고를 수 있게 한다. */
  function startAutoScroll() {
    stopAutoScroll();
    const tick = () => {
      const d = dragRef.current;
      const col = dragColRef.current;
      if (!d || !col) return;
      const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 10;
      const edgeTop = 10 * rem; // 머리글 아래
      const edgeBottom = window.innerHeight - 12 * rem; // 탭바 위
      const y = lastYRef.current;
      let dy = 0;
      if (y < edgeTop) dy = -Math.min(16, (edgeTop - y) / 4 + 2);
      else if (y > edgeBottom) dy = Math.min(16, (y - edgeBottom) / 4 + 2);
      if (dy !== 0) {
        const before = window.scrollY;
        window.scrollBy(0, dy);
        if (window.scrollY !== before) {
          const cell = cellAt(y, col);
          if (cell !== d.to) commitDrag({ ...d, to: cell });
        }
      }
      scrollRafRef.current = window.requestAnimationFrame(tick);
    };
    scrollRafRef.current = window.requestAnimationFrame(tick);
  }

  function beginDrag(day: number, cell: number, col: HTMLElement, pointerId: number, touch: boolean) {
    dragColRef.current = col;
    touchDragRef.current = touch;
    commitDrag({ day, from: cell, to: cell });
    // 포인터 캡처는 실패해도 선택 자체는 계속 동작해야 한다.
    try {
      col.setPointerCapture(pointerId);
    } catch {
      /* 캡처 미지원·이미 끝난 포인터 무시 */
    }
  }

  function finishDrag(col: HTMLElement, pointerId: number) {
    const current = dragRef.current;
    const touch = touchDragRef.current;
    stopAutoScroll();
    commitDrag(null);
    touchDragRef.current = false;
    dragColRef.current = null;
    try {
      col.releasePointerCapture?.(pointerId);
    } catch {
      /* 캡처된 적 없으면 무시 */
    }
    if (!current) return;
    if (touch) {
      blockClickUntilRef.current = Date.now() + 700;
      swallowNextClick();
    }
    onSelectRange?.(rangeOf(current.day, current.from, current.to));
  }

  function cancelAll() {
    clearPress();
    stopAutoScroll();
    touchDragRef.current = false;
    dragColRef.current = null;
    if (dragRef.current) commitDrag(null);
  }

  function onColPointerDown(day: number, e: ReactPointerEvent<HTMLDivElement>) {
    lastTypeRef.current = e.pointerType;
    lastYRef.current = e.clientY;
    if (!selectable) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const col = e.currentTarget;

    if (e.pointerType === 'touch') {
      // 터치: 짧게 누르면 탭(click 에서 한 칸 선택), 길게 누르면 범위 선택, 바로 움직이면 스크롤.
      clearPress();
      const press: PressState = {
        day,
        pointerId: e.pointerId,
        x: e.clientX,
        y: e.clientY,
        col,
        timer: 0,
      };
      press.timer = window.setTimeout(() => {
        if (pressRef.current !== press) return;
        pressRef.current = null;
        beginDrag(day, cellAt(press.y, col), col, press.pointerId, true);
        try {
          navigator.vibrate?.(12);
        } catch {
          /* 진동 미지원 */
        }
        startAutoScroll();
      }, LONG_PRESS_MS);
      pressRef.current = press;
      return;
    }

    // 마우스·펜: 누르는 즉시 시작
    beginDrag(day, cellAt(e.clientY, col), col, e.pointerId, false);
  }

  function onColPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    lastYRef.current = e.clientY;
    const press = pressRef.current;
    if (press && press.pointerId === e.pointerId) {
      if (Math.hypot(e.clientX - press.x, e.clientY - press.y) > MOVE_SLOP_PX) clearPress();
      else press.y = e.clientY;
      return;
    }
    const current = dragRef.current;
    if (!selectable || !current) return;
    const cell = cellAt(e.clientY, e.currentTarget);
    if (cell !== current.to) commitDrag({ ...current, to: cell });
  }

  function onColPointerUp(e: ReactPointerEvent<HTMLDivElement>) {
    lastUpRef.current = Date.now();
    clearPress();
    if (!selectable || !dragRef.current) return;
    finishDrag(e.currentTarget, e.pointerId);
  }

  /** 터치 탭: 눌린 칸 하나(step 분)를 고른다. 스크롤을 멈추려고 댄 손가락은 click 이 오지 않아 선택되지 않는다. */
  function onColClick(day: number, e: ReactMouseEvent<HTMLDivElement>) {
    if (!selectable) return;
    if (Date.now() - lastUpRef.current > 800) return; // 키보드·보조기기의 click
    if (lastTypeRef.current === 'mouse' || lastTypeRef.current === 'pen') return;
    if (Date.now() < blockClickUntilRef.current) return;
    const cell = cellAt(e.clientY, e.currentTarget);
    onSelectRange?.(rangeOf(day, cell, cell));
  }

  // 길게 눌러 끌기가 시작된 뒤에만 세로 스크롤을 막는다. (React 의 touchmove 는 passive 라 직접 단다.)
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const block = (e: TouchEvent) => {
      if (touchDragRef.current && e.cancelable) e.preventDefault();
    };
    el.addEventListener('touchmove', block, { passive: false });
    return () => el.removeEventListener('touchmove', block);
  }, []);

  useEffect(
    () => () => {
      window.cancelAnimationFrame(scrollRafRef.current);
      const press = pressRef.current;
      if (press) window.clearTimeout(press.timer);
    },
    [],
  );

  const multi = laneCount > 1;
  const liveRange: SelectedRange | null = drag ? rangeOf(drag.day, drag.from, drag.to) : pendingRange;

  // 격자에 실제로 그려지는 항목 (목록에도 같은 것을 보여 준다)
  const drawnEntries = useMemo(
    () =>
      entries.filter(
        (e) =>
          e.day >= 0 &&
          e.day < DAY_NAMES.length &&
          clampMinute(e.endMin) > clampMinute(e.startMin),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [entries, closeMin],
  );

  function pickEntry(entry: GridEntry) {
    if (onEntryClick) onEntryClick(entry);
    else setInfo(entry);
  }

  const dates = weekStart ? weekDates(weekStart) : null;
  const today = todayStr();
  const hasNav = Boolean(onPrevWeek || onNextWeek);
  // key 가 바뀌면 React가 다시 그리면서 슬라이드 애니메이션이 처음부터 재생된다.
  const slideKey = `${weekStart ?? 'fixed'}-${slide?.tick ?? 0}`;

  function top(min: number): string {
    return `${((min - OPEN_MIN) / totalMin) * 100}%`;
  }
  function height(start: number, end: number): string {
    return `${((end - start) / totalMin) * 100}%`;
  }

  const weekRange = dates ? `${fmtDayHeader(dates[0])} ~ ${fmtDayHeader(dates[dates.length - 1])}` : undefined;

  return (
    <div
      ref={rootRef}
      className={`tt${compact ? ' tt--compact' : ''}${multi ? ' tt--multi' : ''}${
        step < 60 ? ' tt--half' : ''
      }`}
      style={{ '--tt-hours': totalMin / 60 } as CSSProperties}
    >
      {hasNav && <WeekNav compact sub={weekRange} onPrev={onPrevWeek} onNext={onNextWeek} />}

      <EntryList entries={drawnEntries} multi={multi} onPick={pickEntry} />

      <div className="tt-clip">
        <div className="tt-slide" key={slideKey} data-dir={slide?.dir}>
          <div
            className="tt-grid"
            role="group"
            aria-label={weekStart ? `${fmtWeekLabel(weekStart)} ${weekRange} 시간표` : '주간 시간표'}
          >
            <div className="tt-head">
              <div />
              {DAY_NAMES.map((d, i) => {
                const date = dates?.[i];
                const isToday = Boolean(date && date === today);
                if (!date) {
                  return (
                    <div key={d} className="tt-day">
                      {d}
                    </div>
                  );
                }
                const [, m, dd] = date.split('-').map(Number);
                return (
                  <div
                    key={d}
                    className={`tt-day${isToday ? ' is-today' : ''}`}
                    aria-current={isToday ? 'date' : undefined}
                  >
                    <span>{`${m}/${dd}`}</span>
                    <span>{`(${d})`}</span>
                    {isToday && <span className="sr-only"> 오늘</span>}
                  </div>
                );
              })}
            </div>

            <div
              className="tt-body"
              onContextMenu={(e) => {
                // 길게 눌렀을 때 뜨는 시스템 메뉴가 범위 선택을 가리지 않게 한다.
                if (selectable && lastTypeRef.current === 'touch') e.preventDefault();
              }}
            >
              <div className="tt-times" aria-hidden="true">
                {hourLabels.map((m) => (
                  <span
                    key={m}
                    className="tt-time-label"
                    style={{ top: top(m) }}
                  >
                    {fmtMin(m)}
                  </span>
                ))}
              </div>

              {DAY_NAMES.map((_, day) => {
                const dayEntries = entries.filter(
                  (e) => e.day === day && clampMinute(e.endMin) > clampMinute(e.startMin),
                );
                const placements = multi ? null : placeOverlaps(dayEntries);
                const range = liveRange && liveRange.day === day ? liveRange : null;

                return (
                  <div
                    key={day}
                    className={`tt-col${selectable ? ' is-selectable' : ''}`}
                    onPointerDown={selectable ? (e) => onColPointerDown(day, e) : undefined}
                    onPointerMove={selectable ? onColPointerMove : undefined}
                    onPointerUp={selectable ? onColPointerUp : undefined}
                    onPointerCancel={selectable ? cancelAll : undefined}
                    onClick={selectable ? (e) => onColClick(day, e) : undefined}
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

                    {range && (
                      <div
                        className="tt-pending"
                        data-align={day <= 1 ? 'start' : day >= 3 ? 'end' : 'mid'}
                        data-valign={range.startMin - OPEN_MIN < 60 ? 'below' : 'above'}
                        style={{
                          top: top(range.startMin),
                          height: height(range.startMin, range.endMin),
                        }}
                      >
                        <span className="tt-pending__label">
                          {fmtMin(range.startMin)}~{fmtMin(range.endMin)}
                        </span>
                      </div>
                    )}

                    {dayEntries.map((e) => {
                      const isReservation = e.kind === 'reservation';
                      const idx = e.memberIndex ?? 0;
                      const color = MEMBER_COLORS[idx % MEMBER_COLORS.length];
                      const startMin = clampMinute(e.startMin);
                      const endMin = clampMinute(e.endMin);
                      const minutes = endMin - startMin;

                      let position: CSSProperties = {};
                      if (multi && !isReservation) {
                        // 팀원 시간표는 사람별 세로 레인으로 나눈다.
                        const laneWidth = 100 / laneCount;
                        position = {
                          left: `calc(${idx * laneWidth}% + 0.2rem)`,
                          right: 'auto',
                          width: `calc(${laneWidth}% - 0.4rem)`,
                        };
                      } else if (!multi) {
                        const p = placements?.get(e);
                        if (p && p.lanes > 1) {
                          const laneWidth = 100 / p.lanes;
                          position = {
                            left: `calc(${p.lane * laneWidth}% + 0.2rem)`,
                            right: 'auto',
                            width: `calc(${laneWidth}% - 0.4rem)`,
                          };
                        }
                      }
                      // 예약은 팀원 전원에게 해당하므로 팀원 시간표에서도 하루 전체 너비로 그린다.

                      const lane = multi && !isReservation;
                      const showText = !lane;
                      const sub = e.subtitle ?? e.place;
                      const showSub = showText && minutes >= 60 && Boolean(sub);
                      const titleLines = Math.max(
                        1,
                        textLines(minutes, hourRem) - (showSub ? 1 : 0),
                      );

                      return (
                        <button
                          key={`${isReservation ? 'r' : 'c'}-${e.memberIndex ?? 0}-${e.id}`}
                          type="button"
                          className={`tt-entry${isReservation ? ' tt-entry--res' : ''}${
                              lane ? ' tt-entry--lane' : ''
                            }${lane && (e.memberIndex ?? 0) % MEMBER_COLORS.length === 4 ? ' tt-entry--patterned' : ''}`}
                          style={
                            {
                              top: top(startMin),
                              height: height(startMin, endMin),
                              ...position,
                              ...(lane ? { '--lane': color } : {}),
                            } as CSSProperties
                          }
                          aria-label={entryLabel(e)}
                          // 기존 일정 위에서는 칸 선택이 시작되지 않게 한다.
                          onPointerDown={(ev) => ev.stopPropagation()}
                          onClick={(ev) => {
                            ev.stopPropagation();
                            pickEntry(e);
                          }}
                        >
                          {showText && (
                            <>
                              <span className="tt-entry__title" style={{ WebkitLineClamp: titleLines }}>
                                {isReservation && <span className="tt-entry__tag">예약</span>}
                                {e.title}
                              </span>
                              {showSub && <span className="tt-entry__sub">{sub}</span>}
                            </>
                          )}
                        </button>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* 시트는 슬라이드 애니메이션 바깥에 둔다. */}
      {!onEntryClick && <EntryInfoSheet entry={info} onClose={() => setInfo(null)} />}
    </div>
  );
}
