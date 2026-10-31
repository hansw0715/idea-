/** 아이소메트릭 라운지 안: 뒤쪽 두 벽(창문) · 타일 바닥 · 카운터 · 탁자와 의자 */
import type { KeyboardEvent, ReactNode } from 'react';
import { KIND_LABEL, ROOM_DOOR, ROOM_H, ROOM_W, ROOM_WALL, seatsOf, type Room, type RoomTable, type SeatPos } from './rooms';
import type { Rect } from './geometry';
import { iso, ISO_C, ISO_S, isoBox, pts } from './iso';
import { sortable, type PropItem } from './CampusArt';

/** 바닥이 시작되는 줄 — 위쪽 벽 두께(ROOM_WALL)에서 창가 턱만큼 뺀 자리 */
const FLOOR_Y = ROOM_WALL - 24;
const WALL_H = 170;
const TABLE_H = 26;
const SEAT_H = 14;

/* ── 바닥 (평면 좌표, ISO_MATRIX 로 눕힌다) ─────────────────── */
export function roomGround(room: Room): ReactNode {
  const tiles: ReactNode[] = [];
  for (let x = 60; x < ROOM_W; x += 60) tiles.push(<line key={`x${x}`} x1={x} x2={x} y1={FLOOR_Y} y2={ROOM_H} className="i-floor-line" />);
  for (let y = FLOOR_Y + 60; y < ROOM_H; y += 60) tiles.push(<line key={`y${y}`} y1={y} y2={y} x1={0} x2={ROOM_W} className="i-floor-line" />);
  return (
    <g className={`i-room--${room.theme}`}>
      <rect x={0} y={FLOOR_Y} width={ROOM_W} height={ROOM_H - FLOOR_Y} className="i-floor" />
      {tiles}
      {/* 가운데 러그 */}
      <rect x={300} y={FLOOR_Y + 210} width={300} height={140} rx={12} className="i-rug" />
      <rect x={ROOM_DOOR.x - 70} y={ROOM_H - 22} width={140} height={22} className="i-door-mat" />
      <text x={ROOM_DOOR.x} y={ROOM_H - 6} textAnchor="middle" className="i-door-text">출입문</text>
    </g>
  );
}

/* ── 뒤쪽 벽: 항상 모든 것보다 뒤라 정렬 없이 먼저 그린다 ──────── */
export function roomWalls(room: Room): ReactNode {
  const backWall = [iso(0, FLOOR_Y), iso(ROOM_W, FLOOR_Y), iso(ROOM_W, FLOOR_Y, WALL_H), iso(0, FLOOR_Y, WALL_H)];
  const sideWall = [iso(0, FLOOR_Y), iso(0, ROOM_H), iso(0, ROOM_H, WALL_H), iso(0, FLOOR_Y, WALL_H)];
  const panes = 5;
  const pw = (ROOM_W - 80) / panes;
  return (
    <g>
      <polygon points={pts(sideWall)} className="i-wall-side" />
      <polygon points={pts(backWall)} className="i-wall-back" />
      {/* 뒤 벽 창문 */}
      {Array.from({ length: panes }).map((_, i) => {
        const x0 = 40 + i * pw + 6;
        const x1 = x0 + pw - 12;
        const win = [iso(x0, FLOOR_Y, 40), iso(x1, FLOOR_Y, 40), iso(x1, FLOOR_Y, WALL_H - 22), iso(x0, FLOOR_Y, WALL_H - 22)];
        return (
          <g key={i}>
            <polygon points={pts(win)} className="i-window" />
            <View theme={room.theme} x0={x0} x1={x1} />
          </g>
        );
      })}
      {/* 옆 벽 게시판 */}
      <polygon points={pts([iso(0, 220, 50), iso(0, 420, 50), iso(0, 420, 130), iso(0, 220, 130)])} className="i-board" />
      <text transform={`matrix(${ISO_C} ${-ISO_S} 0 1 ${iso(0, 320, 86).x} ${iso(0, 320, 86).y})`} textAnchor="middle" className="i-board-text">
        {room.name}
      </text>
      <text transform={`matrix(${ISO_C} ${-ISO_S} 0 1 ${iso(0, 320, 62).x} ${iso(0, 320, 62).y})`} textAnchor="middle" className="i-board-sub">
        {room.floor}
      </text>
      {/* 바닥 걸레받이 */}
      <polyline points={pts([iso(0, ROOM_H), iso(0, FLOOR_Y), iso(ROOM_W, FLOOR_Y)])} className="i-skirting" />
    </g>
  );
}

/** 창밖: 높은 층은 낙산 능선과 도시, 지하는 선큰 계단, 1층은 나무 */
function View({ theme, x0, x1 }: { theme: Room['theme']; x0: number; x1: number }) {
  const at = (x: number, z: number) => iso(x, FLOOR_Y, z);
  if (theme === 'sky' || theme === 'lab') {
    const n = 3;
    const step = (x1 - x0) / n;
    return (
      <g>
        <polygon points={pts([at(x0, 40), at(x1, 40), at(x1, 92), at((x0 + x1) / 2, 110), at(x0, 96)])} className="i-view-hill" />
        {Array.from({ length: n }).map((_, i) => {
          const a = x0 + i * step + 8;
          const b = a + step - 18;
          const top = 54 + ((i * 17) % 30);
          return <polygon key={i} points={pts([at(a, 40), at(b, 40), at(b, top), at(a, top)])} className="i-view-city" />;
        })}
      </g>
    );
  }
  if (theme === 'plaza' || theme === 'base') {
    return (
      <g>
        {[0, 1, 2, 3].map((i) => (
          <polygon key={i} points={pts([at(x0, 40 + i * 18), at(x1, 40 + i * 18), at(x1, 48 + i * 18), at(x0, 48 + i * 18)])} className="i-view-step" />
        ))}
      </g>
    );
  }
  const m = (x0 + x1) / 2;
  return <polygon points={pts([at(m, 120), at(m - 30, 40), at(m + 30, 40)])} className="i-view-hill" />;
}

/* ── 세운 물체: 탁자(의자 포함)·카운터·화분 ─────────────────── */
export function roomProps(room: Room, taken: Set<string>, onSeat: (s: SeatPos) => void, onTable: (id: string) => void): PropItem[] {
  const out: PropItem[] = room.tables.map((t) => ({
    ...sortable(`t-${t.id}`, t, 40),
    node: <TableTop key={t.id} t={t} taken={taken} onTable={onTable} />,
  }));
  for (const t of room.tables) {
    for (const s of seatsOf(t)) {
      // 의자 발자국을 앉는 점보다 살짝 뒤로 두어, 앉은 아바타가 의자 위에 그려지게 한다
      out.push({
        ...sortable(`s-${t.id}-${s.idx}`, { x: s.x - 14, y: s.y - 14, w: 9, h: 9 }, 20),
        node: <Chair key={`${t.id}-${s.idx}`} t={t} s={s} busy={taken.has(`${t.id}:${s.idx}`)} onSeat={onSeat} />,
      });
    }
  }
  if (room.counter) {
    const c = room.counter;
    out.push({ ...sortable('counter', c), node: <Counter key="counter" r={c} label={c.label} /> });
  }
  for (const [x, y] of [[40, FLOOR_Y + 40], [ROOM_W - 40, FLOOR_Y + 40], [40, ROOM_H - 50]] as const) {
    out.push({ ...sortable(`plant-${x}-${y}`, { x: x - 10, y: y - 10, w: 20, h: 20 }, 16), node: <Plant key={`${x}-${y}`} x={x} y={y} /> });
  }
  return out;
}

const box = (r: Rect, h: number, z: number, cls: string) => {
  const f = isoBox(r, h, z);
  return (
    <>
      <polygon points={pts(f.left)} className={`${cls}-l`} />
      <polygon points={pts(f.right)} className={`${cls}-r`} />
      <polygon points={pts(f.top)} className={`${cls}-t`} />
    </>
  );
};

/** 바닥 원(반지름 r)을 투영한 타원 반지름 */
const ellipseOf = (r: number) => ({ rx: r * Math.SQRT2 * ISO_C, ry: r * Math.SQRT2 * ISO_S });

function Cylinder({ cx, cy, r, h, z = 0, cls, dashed }: { cx: number; cy: number; r: number; h: number; z?: number; cls: string; dashed?: boolean }) {
  const { rx, ry } = ellipseOf(r);
  const bottom = iso(cx, cy, z);
  const top = iso(cx, cy, z + h);
  return (
    <>
      <ellipse cx={bottom.x} cy={bottom.y} rx={rx} ry={ry} className={`${cls}-r`} />
      <rect x={bottom.x - rx} y={top.y} width={rx * 2} height={bottom.y - top.y} className={`${cls}-r`} />
      <ellipse cx={top.x} cy={top.y} rx={rx} ry={ry} className={`${cls}-t${dashed ? ' is-dashed' : ''}`} />
    </>
  );
}

const onEnter = (fn: () => void) => (e: KeyboardEvent) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    fn();
  }
};

function Chair({ t, s, busy, onSeat }: { t: RoomTable; s: SeatPos; busy: boolean; onSeat: (s: SeatPos) => void }) {
  return (
    <g
      className={`i-seat${busy ? ' is-busy' : ''}`}
      role="button"
      tabIndex={busy ? -1 : 0}
      aria-label={busy ? `${t.title} ${s.idx + 1}번 자리 (사람 있음)` : `${t.title} ${s.idx + 1}번 빈자리에 앉기`}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={() => !busy && onSeat(s)}
      onKeyDown={onEnter(() => !busy && onSeat(s))}
    >
      <Cylinder cx={s.x} cy={s.y} r={13} h={SEAT_H} cls="i-chair" dashed={!busy} />
    </g>
  );
}

function TableTop({ t, taken, onTable }: { t: RoomTable; taken: Set<string>; onTable: (id: string) => void }) {
  const used = seatsOf(t).filter((s) => taken.has(`${s.tableId}:${s.idx}`)).length;
  const key = onEnter;
  const center = iso(t.x + t.w / 2, t.y + t.h / 2, TABLE_H);
  return (
    <g className={`i-tableset i-tableset--${t.kind}`}>
      <g
        role="button"
        tabIndex={0}
        aria-label={t.vacant ? `빈 ${KIND_LABEL[t.kind]} 탁자: 눌러서 ${KIND_LABEL[t.kind]} 자리 만들기` : `${KIND_LABEL[t.kind]} 탁자: ${t.title}, ${t.seats}자리 중 ${used}자리 앉음${used >= t.seats ? ', 자리 없음' : ', 자리 있음'}`}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={() => onTable(t.id)}
        onKeyDown={key(() => onTable(t.id))}
        className="i-table-hit"
      >
        {t.shape === 'round' ? (
          <Cylinder cx={t.x + t.w / 2} cy={t.y + t.h / 2} r={t.w / 2} h={TABLE_H} cls="i-table" />
        ) : (
          box(t, TABLE_H, 0, 'i-table')
        )}
        <g transform={`translate(${center.x.toFixed(1)} ${center.y.toFixed(1)})`}>
          <rect x={t.vacant ? -50 : -34} y={-12} width={t.vacant ? 100 : 68} height={22} rx={11} className={t.vacant ? 'i-kind is-vacant' : 'i-kind'} />
          <text y={4} textAnchor="middle" className="i-kind-text">
            {KIND_LABEL[t.kind]} {t.vacant ? '자리 만들기' : `${used}/${t.seats}`}
          </text>
        </g>
      </g>
    </g>
  );
}

function Counter({ r, label }: { r: Rect; label: string }) {
  const c = iso(r.x + r.w / 2, r.y + r.h / 2, 44);
  return (
    <g>
      {box(r, 40, 0, 'i-counter')}
      {/* 커피 머신 */}
      {box({ x: r.x + 20, y: r.y + 12, w: 26, h: 24 }, 22, 40, 'i-machine')}
      <text x={c.x} y={c.y - 30} textAnchor="middle" className="i-counter-text">{label}</text>
    </g>
  );
}

function Plant({ x, y }: { x: number; y: number }) {
  const apex = iso(x, y, 54);
  const s = 14;
  return (
    <g>
      {box({ x: x - 9, y: y - 9, w: 18, h: 18 }, 16, 0, 'i-pot')}
      <polygon points={pts([apex, iso(x - s, y + s, 16), iso(x + s, y + s, 16)])} className="i-tree-l" />
      <polygon points={pts([apex, iso(x + s, y + s, 16), iso(x + s, y - s, 16)])} className="i-tree-r" />
    </g>
  );
}

export const ROOM_WALL_H = WALL_H;
