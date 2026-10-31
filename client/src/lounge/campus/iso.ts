/**
 * 아이소메트릭 투영. 걷기·길찾기는 평면(위에서 본) 좌표로 하고, 그릴 때만 비스듬히 세운다.
 *   화면 x = (x - y) · cos30°,  화면 y = (x + y) · sin30° − 높이
 * 월드 (0,0)이 화면 맨 위 꼭짓점, x 가 오른쪽 아래, y 가 왼쪽 아래로 뻗는다.
 */
import type { Pt, Rect } from './geometry';

export const ISO_C = Math.cos(Math.PI / 6);
export const ISO_S = 0.5;

export const iso = (x: number, y: number, z = 0): Pt => ({ x: (x - y) * ISO_C, y: (x + y) * ISO_S - z });

/** 화면 좌표 → 바닥(z=0) 월드 좌표 */
export const unIso = (sx: number, sy: number): Pt => {
  const a = sx / ISO_C;
  const b = sy / ISO_S;
  return { x: (a + b) / 2, y: (b - a) / 2 };
};

export const pts = (list: Pt[]): string => list.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');

/** 바닥 사각형의 네 꼭짓점 (위·오른쪽·아래·왼쪽 순) */
export const isoRect = (r: Rect, z = 0): Pt[] => [
  iso(r.x, r.y, z),
  iso(r.x + r.w, r.y, z),
  iso(r.x + r.w, r.y + r.h, z),
  iso(r.x, r.y + r.h, z),
];

/** 상자 한 개의 보이는 세 면 */
export function isoBox(r: Rect, h: number, z = 0) {
  const g = isoRect(r, z);
  const t = isoRect(r, z + h);
  return {
    top: t,
    // y 가 큰 쪽(왼쪽 앞) 면
    left: [g[3], g[2], t[2], t[3]],
    // x 가 큰 쪽(오른쪽 앞) 면
    right: [g[2], g[1], t[1], t[2]],
  };
}

/** 월드 크기를 투영했을 때 화면에서 차지하는 범위 */
export const isoBounds = (w: number, h: number) => ({
  minX: -h * ISO_C,
  maxX: w * ISO_C,
  minY: 0,
  maxY: (w + h) * ISO_S,
});

export interface Sortable {
  key: string;
  /** 바닥 발자국 */
  foot: Rect;
  /** 화면 가로 범위 (겹치는 것끼리만 앞뒤를 따진다) */
  sx0: number;
  sx1: number;
}

/**
 * 앞뒤 정렬: 화면에서 겹치는 두 물체 중 한 축으로 완전히 뒤에 있는 쪽을 먼저 그린다.
 * 물체 수가 수십 개라 O(n²) 위상 정렬로 충분하다.
 */
export function depthSort<T extends Sortable>(items: T[]): T[] {
  const n = items.length;
  const behind: number[][] = items.map(() => []);
  const indeg = new Array<number>(n).fill(0);
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const a = items[i];
      const b = items[j];
      if (a.sx1 < b.sx0 || b.sx1 < a.sx0) continue;
      const ab = isBehind(a.foot, b.foot);
      const ba = isBehind(b.foot, a.foot);
      if (ab === ba) continue;
      if (ab) {
        behind[i].push(j);
        indeg[j]++;
      } else {
        behind[j].push(i);
        indeg[i]++;
      }
    }
  }
  const depth = (t: T) => t.foot.x + t.foot.w / 2 + t.foot.y + t.foot.h / 2;
  const ready = items.map((_, i) => i).filter((i) => !indeg[i]);
  const out: T[] = [];
  while (ready.length) {
    ready.sort((p, q) => depth(items[q]) - depth(items[p]));
    const i = ready.pop()!;
    out.push(items[i]);
    for (const j of behind[i]) if (--indeg[j] === 0) ready.push(j);
  }
  // 순환이 생기면 남은 것은 깊이 순으로 붙인다
  if (out.length < n) {
    const rest = items.filter((it) => !out.includes(it)).sort((p, q) => depth(p) - depth(q));
    out.push(...rest);
  }
  return out;
}

const isBehind = (a: Rect, b: Rect): boolean => {
  const xSep = a.x + a.w <= b.x + 0.01;
  const ySep = a.y + a.h <= b.y + 0.01;
  if (xSep && ySep) return true;
  if (xSep) return a.y < b.y + b.h;
  if (ySep) return a.x < b.x + b.w;
  return false;
};
