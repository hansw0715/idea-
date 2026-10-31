/**
 * 아이소메트릭 투영. 바닥 평면 좌표(x 오른쪽 아래, y 왼쪽 아래)에 높이 z 를 더해 화면에 세운다.
 *   화면 x = (x − y) · cos30°,  화면 y = (x + y) · sin30° − z
 */
export type Pt = { x: number; y: number };

export const ISO_C = Math.cos(Math.PI / 6);
export const ISO_S = 0.5;

export const iso = (x: number, y: number, z = 0): Pt => ({ x: (x - y) * ISO_C, y: (x + y) * ISO_S - z });

export const pts = (list: Pt[]): string => list.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');

/** 바닥 사각형의 네 꼭짓점 (뒤·오른쪽·앞·왼쪽 순) */
export const isoRect = (x: number, y: number, w: number, d: number, z = 0): Pt[] => [
  iso(x, y, z),
  iso(x + w, y, z),
  iso(x + w, y + d, z),
  iso(x, y + d, z),
];

/** 상자의 보이는 세 면. left 는 앞(y+)을, right 는 오른쪽(x+)을 보는 면이다. */
export function isoBox(x: number, y: number, w: number, d: number, h: number, z = 0) {
  const g = isoRect(x, y, w, d, z);
  const t = isoRect(x, y, w, d, z + h);
  return {
    top: t,
    left: [g[3], g[2], t[2], t[3]],
    right: [g[2], g[1], t[1], t[2]],
  };
}
