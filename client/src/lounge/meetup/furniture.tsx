/**
 * 라운지 가구. 모두 바닥 평면 좌표(x, y)와 높이(z)로 놓고, 상자의 보이는 세 면을 평평한 색으로 칠한다.
 * 한 가구 안의 그리는 순서는 뒤(x+y 가 작은 쪽)에서 앞으로다.
 */
import type { ReactNode } from 'react';
import { ISO_C, ISO_S, iso, isoBox, isoRect, pts, type Pt } from './iso';

export function Face({ points, className }: { points: Pt[]; className?: string }) {
  return <polygon points={pts(points)} className={className} />;
}

export function Box({ x, y, w, d, h, z = 0, tone }: { x: number; y: number; w: number; d: number; h: number; z?: number; tone: string }) {
  const b = isoBox(x, y, w, d, h, z);
  return (
    <g className={tone}>
      <Face points={b.left} className="f-l" />
      <Face points={b.right} className="f-r" />
      <Face points={b.top} className="f-t" />
    </g>
  );
}

/**
 * 벽 창문: 하늘과 낙산 능선 (a~b 사이에 고르게).
 * plane 'back' 은 뒤 벽(y=0)을 x 로, 'side' 는 왼쪽 벽(x=0)을 y 로 따라간다. z0~z1 이 창 높이.
 */
export function Windows({ x0, x1, h, plane = 'back', z0 = 84, z1 = h - 22, pane = 76 }: { x0: number; x1: number; h: number; plane?: 'back' | 'side'; z0?: number; z1?: number; pane?: number }) {
  const out: ReactNode[] = [];
  const gap = 14;
  const count = Math.max(1, Math.floor((x1 - x0 + gap) / (pane + gap)));
  const start = x0 + (x1 - x0 - (count * (pane + gap) - gap)) / 2;
  const at = (t: number, z: number) => (plane === 'back' ? iso(t, 0, z) : iso(0, t, z));
  // 능선: 창마다 이어지도록 위치에 따라 높이를 정한다
  const ridge = (t: number) => z0 + (z1 - z0) * 0.25 + 10 * Math.sin(t / 70) + 6 * Math.sin(t / 23);
  for (let i = 0; i < count; i++) {
    const a = start + i * (pane + gap);
    const b = a + pane;
    const steps = 6;
    const hill = [at(a, z0), ...Array.from({ length: steps + 1 }, (_, k) => at(a + (pane * k) / steps, ridge(a + (pane * k) / steps))), at(b, z0)];
    out.push(
      <g key={i}>
        <Face points={[at(a, z0), at(b, z0), at(b, z1), at(a, z1)]} className="iso-sky" />
        <Face points={hill} className="iso-hill" />
      </g>,
    );
  }
  return <>{out}</>;
}

/** 바 의자: 가는 다리 + 둥근 방석 대신 낮은 상자 */
export function Stool({ x, y }: { x: number; y: number }) {
  return (
    <g>
      <Box x={x - 9} y={y - 9} w={18} d={18} h={3} tone="iso-metal" />
      <Box x={x - 2} y={y - 2} w={4} d={4} h={44} z={3} tone="iso-metal" />
      <Box x={x - 11} y={y - 11} w={22} d={22} h={7} z={44} tone="iso-cushion" />
    </g>
  );
}

/** 높은 창가 바 테이블과 바 의자 (뒤 벽에 붙는다) */
export function WindowBar({ x0, x1 }: { x0: number; x1: number }) {
  const stools: number[] = [];
  // 의자는 넉넉한 간격으로 (빽빽하지 않게)
  for (let x = x0 + 50; x <= x1 - 40; x += 100) stools.push(x);
  return (
    <g aria-hidden="true">
      <Box x={x0} y={14} w={x1 - x0} d={20} h={66} tone="iso-panel" />
      <Box x={x0 - 4} y={4} w={x1 - x0 + 8} d={44} h={7} z={66} tone="iso-wood" />
      {stools.map((x) => (
        <Stool key={x} x={x} y={78} />
      ))}
    </g>
  );
}

/** 오른쪽 뒤 구석의 카페 카운터: 커피 머신, 컵 */
export function CafeCounter({ x0, x1 }: { x0: number; x1: number }) {
  return (
    <g aria-hidden="true">
      <Box x={x0} y={10} w={x1 - x0} d={50} h={58} tone="iso-panel" />
      <Box x={x0 - 4} y={6} w={x1 - x0 + 8} d={58} h={6} z={58} tone="iso-wood" />
      <Box x={x0 + 18} y={14} w={34} d={28} h={34} z={64} tone="iso-metal" />
      <Box x={x0 + 66} y={30} w={10} d={10} h={12} z={64} tone="iso-cup" />
      <Box x={x0 + 84} y={30} w={10} d={10} h={12} z={64} tone="iso-cup" />
      <Box x={x1 - 52} y={18} w={30} d={30} h={20} z={64} tone="iso-wood" />
      {/* 카운터 바 의자: 원래 두 개 + 오른쪽으로 두 개 더 */}
      <Stool x={x0 + 40} y={92} />
      <Stool x={x0 + 100} y={92} />
      <Stool x={x0 + 160} y={92} />
      <Stool x={x0 + 220} y={92} />
    </g>
  );
}

const BOOK_TONES = 8;

/** 왼쪽 벽 책장: 칸마다 책이 꽂혀 있다 */
export function Bookshelf({ y0, y1 }: { y0: number; y1: number }) {
  const depth = 28;
  const h = 128;
  const shelves = [10, 50, 90];
  const books: ReactNode[] = [];
  let n = 0;
  for (const z of shelves) {
    let y = y0 + 6;
    while (y < y1 - 14) {
      const bw = 7 + ((n * 7) % 6);
      const bh = 22 + ((n * 11) % 9);
      const yy = Math.min(y + bw, y1 - 6);
      books.push(
        <Face
          key={`${z}-${n}`}
          points={[iso(depth, y, z), iso(depth, yy, z), iso(depth, yy, z + bh), iso(depth, y, z + bh)]}
          className={`iso-book iso-book--${(n % BOOK_TONES) + 1}`}
        />,
      );
      y = yy + 2 + (n % 4 === 3 ? 10 : 0);
      n++;
    }
  }
  return (
    <g aria-hidden="true">
      <Box x={0} y={y0} w={depth} d={y1 - y0} h={h} tone="iso-wood" />
      {shelves.map((z) => (
        <Face key={z} points={[iso(depth, y0 + 4, z), iso(depth, y1 - 4, z), iso(depth, y1 - 4, z + 34), iso(depth, y0 + 4, z + 34)]} className="iso-shelf" />
      ))}
      {books}
    </g>
  );
}

/** 소파. facing 'front' 는 등받이가 뒤(y 작은 쪽), 'back' 은 등받이가 앞이다. */
export function Sofa({ x, y, w, facing, clay = false }: { x: number; y: number; w: number; facing: 'front' | 'back'; clay?: boolean }) {
  const body = clay ? 'iso-clay' : 'iso-sofa';
  const cushion = clay ? 'iso-clay-seat' : 'iso-seat';
  const D = 52;
  const back = 16;
  const arm = 14;
  // 등받이는 전체 폭, 팔걸이는 방석 옆에만 (등받이와 겹치지 않아야 모서리가 반듯하다)
  const seatY = facing === 'front' ? y + back : y;
  const backY = facing === 'front' ? y : y + D - back;
  const backrest = <Box x={x} y={backY} w={w} d={back} h={48} tone={body} />;
  const parts = (
    <>
      <Box x={x} y={seatY} w={arm} d={D - back} h={30} tone={body} />
      <Box x={x + arm} y={seatY} w={w - arm * 2} d={D - back} h={20} tone={cushion} />
      <Box x={x + w - arm} y={seatY} w={arm} d={D - back} h={30} tone={body} />
    </>
  );
  // 뒤(y 작은 쪽)에 있는 것부터 그린다
  return facing === 'front' ? (
    <g>
      {backrest}
      {parts}
    </g>
  ) : (
    <g>
      {parts}
      {backrest}
    </g>
  );
}

/** 소파 앉는 자리의 가운데 줄 (뒤 소파·앞 소파) */
export const sofaSeatY = (cy: number) => ({ back: cy - 58, front: cy + 58 });
/** 소파 팔걸이 사이 폭 */
export const sofaInner = (w: number) => w - 28;
/** 소파 방석 높이 */
export const SOFA_SEAT_Z = 20;

/**
 * 소파 두 개가 낮은 탁자를 사이에 두고 마주 본다. 바닥 깔개는 loungeRug 로 따로 깐다.
 * 미팅 자리로 쓸 때는 backSeats·frontSeats 에 앉은 사람을 넘긴다 (각 소파를 그린 바로 뒤에 그린다).
 */
export function LoungeSet({ cx, cy, w = 170, backSeats, frontSeats }: { cx: number; cy: number; w?: number; backSeats?: ReactNode; frontSeats?: ReactNode }) {
  return (
    <g aria-hidden="true">
      <Sofa x={cx - w / 2} y={cy - 92} w={w} facing="front" />
      {backSeats}
      <Box x={cx - 48} y={cy - 22} w={96} d={44} h={16} tone="iso-wood" />
      <Box x={cx - 30} y={cy - 10} w={12} d={12} h={10} z={16} tone="iso-cup" />
      <Sofa x={cx - w / 2} y={cy + 40} w={w} facing="back" />
      {frontSeats}
    </g>
  );
}

export const loungeRug = (cx: number, cy: number, w = 170) => isoRect(cx - w / 2 - 22, cy - 104, w + 44, 208);

/** 스탠드 조명 */
export function FloorLamp({ x, y }: { x: number; y: number }) {
  return (
    <g aria-hidden="true">
      <Box x={x - 8} y={y - 8} w={16} d={16} h={3} tone="iso-metal" />
      <Box x={x - 2} y={y - 2} w={4} d={4} h={84} z={3} tone="iso-metal" />
      <Box x={x - 13} y={y - 13} w={26} d={26} h={22} z={80} tone="iso-shade" />
    </g>
  );
}

/** 화분: 큰 것은 잎이 세 겹 */
export function Plant({ x, y, tall = false }: { x: number; y: number; tall?: boolean }) {
  return (
    <g aria-hidden="true">
      <Box x={x - 12} y={y - 12} w={24} d={24} h={20} tone="iso-pot" />
      <Box x={x - 16} y={y - 16} w={32} d={32} h={22} z={20} tone="iso-leaf" />
      <Box x={x - 11} y={y - 11} w={22} d={22} h={18} z={42} tone="iso-leaf" />
      {tall && <Box x={x - 7} y={y - 7} w={14} d={14} h={16} z={60} tone="iso-leaf" />}
    </g>
  );
}

/** 등받이 의자. back 은 등받이가 붙는 쪽 */
export function Chair({ x, y, back }: { x: number; y: number; back: 'x-' | 'x+' | 'y-' | 'y+' }) {
  const s = 22;
  const seat = <Box x={x - s / 2} y={y - s / 2} w={s} d={s} h={4} z={20} tone="iso-chair" />;
  const legs = <Box x={x - 3} y={y - 3} w={6} d={6} h={20} tone="iso-metal" />;
  const rest = {
    'x-': <Box x={x - s / 2} y={y - s / 2} w={4} d={s} h={26} z={24} tone="iso-chair" />,
    'x+': <Box x={x + s / 2 - 4} y={y - s / 2} w={4} d={s} h={26} z={24} tone="iso-chair" />,
    'y-': <Box x={x - s / 2} y={y - s / 2} w={s} d={4} h={26} z={24} tone="iso-chair" />,
    'y+': <Box x={x - s / 2} y={y + s / 2 - 4} w={s} d={4} h={26} z={24} tone="iso-chair" />,
  }[back];
  // 등받이가 앞(x+·y+)이면 방석 뒤에, 뒤(x-·y-)면 방석 앞에 그려야 가려지는 순서가 맞다
  const front = back === 'x+' || back === 'y+';
  return (
    <g>
      {legs}
      {!front && rest}
      {seat}
      {front && rest}
    </g>
  );
}

/** 책상 위에 놓는 물건 */
export type DeskItem = 'laptop' | 'books' | 'open-book' | 'mug' | 'plant' | 'empty';

/** 공부 책상: 나무 상판 위 물건 하나(노트북·책·컵·화분, 또는 비워 둠), 작은 스탠드, 앞에 의자 */
export function StudyDesk({ x, y, item = 'laptop', lamp = true }: { x: number; y: number; item?: DeskItem; lamp?: boolean }) {
  const w = 76;
  const d = 40;
  const top = 45;
  return (
    <g aria-hidden="true">
      <Box x={x + 4} y={y + 4} w={6} d={d - 8} h={40} tone="iso-panel" />
      <Box x={x + w - 10} y={y + 4} w={6} d={d - 8} h={40} tone="iso-panel" />
      <Box x={x} y={y} w={w} d={d} h={5} z={40} tone="iso-wood" />
      {item === 'laptop' && (
        <>
          <Box x={x + 16} y={y + 14} w={26} d={18} h={2} z={top} tone="iso-metal" />
          <Face points={[iso(x + 16, y + 14, top + 2), iso(x + 42, y + 14, top + 2), iso(x + 42, y + 14, top + 19), iso(x + 16, y + 14, top + 19)]} className="iso-screen" />
        </>
      )}
      {item === 'books' && (
        // 쌓아 둔 책 세 권 (위로 갈수록 조금씩 어긋나게)
        <>
          <Box x={x + 14} y={y + 12} w={26} d={18} h={4} z={top} tone="iso-bookbox iso-bookbox--1" />
          <Box x={x + 16} y={y + 13} w={22} d={16} h={4} z={top + 4} tone="iso-bookbox iso-bookbox--2" />
          <Box x={x + 13} y={y + 14} w={24} d={15} h={3} z={top + 8} tone="iso-bookbox iso-bookbox--3" />
          <Box x={x + 44} y={y + 10} w={8} d={20} h={22} z={top} tone="iso-bookbox iso-bookbox--4" />
        </>
      )}
      {item === 'open-book' && (
        // 펼친 책: 표지 위에 흰 두 쪽
        <>
          <Box x={x + 12} y={y + 12} w={34} d={20} h={1.5} z={top} tone="iso-bookbox iso-bookbox--2" />
          <Box x={x + 13} y={y + 13} w={15.5} d={18} h={2.5} z={top + 1.5} tone="iso-page" />
          <Box x={x + 29.5} y={y + 13} w={15.5} d={18} h={2.5} z={top + 1.5} tone="iso-page" />
          <Box x={x + 50} y={y + 22} w={8} d={8} h={9} z={top} tone="iso-cup" />
        </>
      )}
      {item === 'mug' && (
        <>
          <Box x={x + 18} y={y + 16} w={20} d={14} h={2} z={top} tone="iso-page" />
          <Box x={x + 42} y={y + 16} w={9} d={9} h={10} z={top} tone="iso-cup" />
        </>
      )}
      {item === 'plant' && (
        <>
          <Box x={x + 24} y={y + 14} w={12} d={12} h={9} z={top} tone="iso-pot" />
          <Box x={x + 21} y={y + 11} w={18} d={18} h={12} z={top + 9} tone="iso-leaf" />
        </>
      )}
      {lamp && (
        <>
          <Box x={x + w - 18} y={y + 8} w={8} d={8} h={20} z={top} tone="iso-metal" />
          <Box x={x + w - 24} y={y + 4} w={16} d={14} h={8} z={top + 17} tone="iso-shade" />
        </>
      )}
      <Chair x={x + w / 2} y={y + d + 16} back="y+" />
    </g>
  );
}

/** 카페 테이블 두 개: 작은 정사각 상판, 마주 보는 의자 */
export function CafePair({ cx, cy }: { cx: number; cy: number }) {
  const table = (x: number, y: number, k: string) => (
    <g key={k}>
      <Chair x={x} y={y - 34} back="y-" />
      <Chair x={x - 34} y={y} back="x-" />
      <Box x={x - 12} y={y - 12} w={24} d={24} h={3} tone="iso-metal" />
      <Box x={x - 3} y={y - 3} w={6} d={6} h={32} z={3} tone="iso-metal" />
      <Box x={x - 22} y={y - 22} w={44} d={44} h={5} z={35} tone="iso-wood" />
      <Box x={x - 4} y={y - 4} w={9} d={9} h={10} z={40} tone="iso-cup" />
      <Chair x={x + 34} y={y} back="x+" />
      <Chair x={x} y={y + 34} back="y+" />
    </g>
  );
  return <g aria-hidden="true">{[table(cx - 70, cy - 40, 'a'), table(cx + 60, cy + 50, 'b')]}</g>;
}

/** 빈백 세 개와 둥근 깔개 대신 낮은 사이드 테이블 */
export function BeanCorner({ cx, cy }: { cx: number; cy: number }) {
  const bag = (x: number, y: number, n: number) => (
    <g key={n}>
      <Box x={x - 18} y={y - 18} w={36} d={36} h={14} tone={`iso-bean iso-bean--${n}`} />
      <Box x={x - 12} y={y - 12} w={24} d={24} h={9} z={14} tone={`iso-bean iso-bean--${n}`} />
    </g>
  );
  return (
    <g aria-hidden="true">
      {bag(cx - 50, cy - 40, 1)}
      {bag(cx + 40, cy - 50, 2)}
      <Box x={cx - 14} y={cy - 14} w={28} d={28} h={26} tone="iso-wood" />
      <Box x={cx - 4} y={cy - 4} w={8} d={8} h={12} z={26} tone="iso-cup" />
      <Box x={cx - 8} y={cy - 8} w={16} d={16} h={10} z={38} tone="iso-leaf" />
      {bag(cx - 30, cy + 50, 3)}
    </g>
  );
}

/** 긴 나무 벤치와 양끝의 낮은 사이드 테이블 */
export function BenchRow({ cx, cy }: { cx: number; cy: number }) {
  return (
    <g aria-hidden="true">
      <Box x={cx - 92} y={cy - 12} w={24} d={24} h={24} tone="iso-wood" />
      <Box x={cx - 60} y={cy - 14} w={120} d={28} h={8} z={18} tone="iso-wood" />
      <Box x={cx - 54} y={cy - 10} w={8} d={20} h={18} tone="iso-metal" />
      <Box x={cx + 46} y={cy - 10} w={8} d={20} h={18} tone="iso-metal" />
      <Box x={cx + 68} y={cy - 12} w={24} d={24} h={24} tone="iso-wood" />
      <Box x={cx + 76} y={cy - 4} w={8} d={8} h={10} z={24} tone="iso-cup" />
    </g>
  );
}

/** 벽 액자: plane 'back' 은 뒤 벽(y=0), 'side' 는 왼쪽 벽(x=0). a~b 는 벽을 따라간 범위 */
export function WallArt({ plane, a, b, z0, z1, n }: { plane: 'back' | 'side'; a: number; b: number; z0: number; z1: number; n: number }) {
  const at = (t: number, z: number) => (plane === 'back' ? iso(t, 0, z) : iso(0, t, z));
  const m = 6;
  return (
    <g aria-hidden="true">
      <Face points={[at(a, z0), at(b, z0), at(b, z1), at(a, z1)]} className="iso-frame" />
      <Face points={[at(a + m, z0 + m), at(b - m, z0 + m), at(b - m, z1 - m), at(a + m, z1 - m)]} className={`iso-art iso-art--${n}`} />
      <Face points={[at(a + m, z0 + m), at(b - m, z0 + m), at((a + b) / 2, z0 + (z1 - z0) * 0.55)]} className={`iso-art iso-art--${((n + 1) % 4) + 1}`} />
    </g>
  );
}

/** 큰 나무 탁자: 긴 쪽에 의자 셋씩 마주 본다 */
export function BigTable({ cx, cy }: { cx: number; cy: number }) {
  const w = 150;
  const d = 62;
  const xs = [-45, 0, 45];
  return (
    <g aria-hidden="true">
      {xs.map((dx) => (
        <Chair key={`b${dx}`} x={cx + dx} y={cy - d / 2 - 16} back="y-" />
      ))}
      <Box x={cx - w / 2 + 8} y={cy - d / 2 + 8} w={8} d={d - 16} h={38} tone="iso-wood" />
      <Box x={cx + w / 2 - 16} y={cy - d / 2 + 8} w={8} d={d - 16} h={38} tone="iso-wood" />
      <Box x={cx - w / 2} y={cy - d / 2} w={w} d={d} h={6} z={38} tone="iso-wood" />
      <Box x={cx - 30} y={cy - 6} w={12} d={12} h={10} z={44} tone="iso-cup" />
      <Box x={cx + 20} y={cy - 8} w={16} d={16} h={14} z={44} tone="iso-leaf" />
      {xs.map((dx) => (
        <Chair key={`f${dx}`} x={cx + dx} y={cy + d / 2 + 16} back="y+" />
      ))}
    </g>
  );
}

/** 정사각 탁자와 의자 넷 */
export function SquareTable({ cx, cy }: { cx: number; cy: number }) {
  return (
    <g aria-hidden="true">
      <Chair x={cx} y={cy - 46} back="y-" />
      <Chair x={cx - 46} y={cy} back="x-" />
      <Box x={cx - 6} y={cy - 6} w={12} d={12} h={34} tone="iso-metal" />
      <Box x={cx - 30} y={cy - 30} w={60} d={60} h={6} z={34} tone="iso-wood" />
      <Box x={cx - 6} y={cy - 6} w={12} d={12} h={9} z={40} tone="iso-cup" />
      <Chair x={cx + 46} y={cy} back="x+" />
      <Chair x={cx} y={cy + 46} back="y+" />
    </g>
  );
}

/** 독서 자리: 테라코타 1인 소파 둘과 사이의 스탠드 */
export function ReadingNook({ cx, cy }: { cx: number; cy: number }) {
  return (
    <g aria-hidden="true">
      <Sofa x={cx - 96} y={cy - 26} w={62} facing="front" clay />
      <FloorLamp x={cx} y={cy - 10} />
      <Sofa x={cx + 34} y={cy - 26} w={62} facing="front" clay />
      <Box x={cx - 14} y={cy + 30} w={28} d={28} h={22} tone="iso-wood" />
    </g>
  );
}

/** 창가 책상 위 물건 차례: 노트북은 여덟 자리에 둘, 나머지는 책·컵·화분, 빈 책상 하나 */
const WINDOW_ITEMS: DeskItem[] = ['books', 'laptop', 'open-book', 'empty', 'mug', 'books', 'laptop', 'plant'];

/** 창가 자리: 뒤 벽 창문 아래로 책상을 줄지어 놓는다 (의자는 창을 바라본다) */
export function WindowDesks({ x0, x1 }: { x0: number; x1: number }) {
  const xs: number[] = [];
  for (let x = x0; x + 76 <= x1; x += 92) xs.push(x);
  return (
    <g aria-hidden="true">
      {xs.map((x, i) => (
        <StudyDesk key={x} x={x} y={8} item={WINDOW_ITEMS[i % WINDOW_ITEMS.length]} lamp={i % 2 === 0 && WINDOW_ITEMS[i % WINDOW_ITEMS.length] !== 'empty'} />
      ))}
    </g>
  );
}

/** 마주 보는 1인 소파 둘과 작은 탁자 (좁은 벽가에 맞춘 소파 자리) */
export function SofaBooth({ cx, cy }: { cx: number; cy: number }) {
  return (
    <g aria-hidden="true">
      <Sofa x={cx - 32} y={cy - 64} w={64} facing="front" />
      <Box x={cx - 22} y={cy - 14} w={44} d={28} h={16} tone="iso-wood" />
      <Box x={cx - 4} y={cy - 4} w={8} d={8} h={10} z={16} tone="iso-cup" />
      <Sofa x={cx - 32} y={cy + 12} w={64} facing="back" />
    </g>
  );
}
