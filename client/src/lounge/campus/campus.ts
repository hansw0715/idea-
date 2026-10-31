/**
 * 미팅 라운지 캠퍼스 — 라운지가 있는 핵심 건물 다섯 곳을 사람 인(人) 자 모양으로 크게 놓는다.
 *
 * 땅 위에 붓으로 쓴 人 자 두 획(삐침 · 파임)을 넓은 길로 깔고, 건물은 그 획 위에 띄엄띄엄 앉힌다.
 *  - 꼭대기: 상상관 (학교 파랑, 가장 높다)
 *  - 왼쪽 삐침: 연구관 → 창의관
 *  - 오른쪽 파임: 공학관 A동 → 미래관
 *  - 두 다리 사이 아래: 상상마당 잔디와 정문
 * 좌표는 화면(아이소메트릭 투영) 기준으로 적고 fromScreen 으로 평면 좌표로 바꾼다.
 */
import type { Pt, Rect } from './geometry';

export const CAMPUS_W = 1500;
export const CAMPUS_H = 1400;
/** 땅 모서리 둥글기 */
export const GROUND_R = 110;

const R3 = Math.sqrt(3);
/** 人 자를 오른쪽으로 기울이는 각도 (가운데를 축으로 시계 방향) */
const LEAN = (16 * Math.PI) / 180;
const PIVOT = { x: 0, y: 360 };
/** 화면 좌표(人 자 꼭대기가 원점, 아래가 +) → 오른쪽으로 기울여 → 평면 좌표 */
export function fromScreen(sx: number, sy: number): Pt {
  const dx = sx - PIVOT.x;
  const dy = sy - PIVOT.y;
  const lx = PIVOT.x + dx * Math.cos(LEAN) - dy * Math.sin(LEAN);
  const ly = PIVOT.y + dx * Math.sin(LEAN) + dy * Math.cos(LEAN);
  return { x: 124 + ly + lx / R3, y: 271 + ly - lx / R3 };
}

/** 붓 획: 2차 곡선(p0 → p2, 조절점 p1)과 시작·끝 굵기 (화면 좌표) */
export interface Stroke {
  p0: Pt;
  p1: Pt;
  p2: Pt;
  w0: number;
  w1: number;
}

/** 人: 왼쪽 삐침은 굵게 시작해 가늘게 빠지고, 오른쪽 파임은 가늘게 시작해 끝이 넓게 퍼진다 */
export const STROKES: Stroke[] = [
  { p0: { x: 20, y: -90 }, p1: { x: -170, y: 250 }, p2: { x: -640, y: 720 }, w0: 150, w1: 60 },
  { p0: { x: -40, y: 110 }, p1: { x: 250, y: 300 }, p2: { x: 620, y: 720 }, w0: 60, w1: 180 },
];

export const strokeAt = (s: Stroke, t: number): Pt => ({
  x: (1 - t) ** 2 * s.p0.x + 2 * (1 - t) * t * s.p1.x + t ** 2 * s.p2.x,
  y: (1 - t) ** 2 * s.p0.y + 2 * (1 - t) * t * s.p1.y + t ** 2 * s.p2.y,
});

/** 획의 바깥 테두리 (평면 좌표 다각형) */
export function strokeOutline(s: Stroke, steps = 28): Pt[] {
  const left: Pt[] = [];
  const right: Pt[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const p = strokeAt(s, t);
    const q = strokeAt(s, Math.min(1, t + 0.01));
    const o = strokeAt(s, Math.max(0, t - 0.01));
    const dx = q.x - o.x;
    const dy = q.y - o.y;
    const len = Math.hypot(dx, dy) || 1;
    // 붓끝: 양 끝을 둥글게 오므린다
    const w = (s.w0 + (s.w1 - s.w0) * t) * Math.sin(Math.PI * Math.min(1, 0.18 + t * 0.82)) ** 0.25 / 2;
    left.push(fromScreen(p.x - (dy / len) * w, p.y + (dx / len) * w));
    right.push(fromScreen(p.x + (dy / len) * w, p.y - (dx / len) * w));
  }
  return [...left, ...right.reverse()];
}

export type BuildingTone = 'plain' | 'glass' | 'landmark' | 'heritage' | 'brick' | 'old';
/** 건물마다 다른 색 (campus.css 의 .i-bld--c-*) */
export type BuildingColor = 'blue' | 'mint' | 'coral' | 'violet' | 'amber';

export interface Building extends Rect {
  id: string;
  name: string;
  /** 건물 안 대표 시설 한 줄 */
  sub: string;
  /** 앞면 벽 높이(층수 느낌). 지붕 아래로 그려진다 */
  wall: number;
  tone: BuildingTone;
  color: BuildingColor;
  floors: string;
  info: string;
  /** 들어갈 수 있는 라운지 (rooms.ts id) */
  rooms?: string[];
}

export type AreaKind = 'lawn' | 'plaza' | 'forest' | 'field' | 'garden' | 'sunken';

export interface Area extends Rect {
  id: string;
  name: string;
  kind: AreaKind;
  info: string;
}

export interface Gate extends Pt {
  id: string;
  name: string;
  info: string;
}

type BuildingSpec = Omit<Building, 'x' | 'y'> & { at: Pt };

/** 화면 자리(at)를 가운데로 하는 건물 (발자국 깊이는 h + 앞벽) */
const place = ({ at, ...b }: BuildingSpec): Building => {
  const c = fromScreen(at.x, at.y);
  return { ...b, x: Math.round(c.x - b.w / 2), y: Math.round(c.y - (b.h + b.wall) / 2) };
};

const [LEFT, RIGHT] = STROKES;

export const BUILDINGS: Building[] = (
  [
    {
      id: 'sangsang', name: '상상관', sub: '12층 전망 라운지', at: { x: 0, y: 0 }, w: 150, h: 120, wall: 96, tone: 'landmark', color: 'blue',
      floors: '지하 ~ 지상 12층', info: '캠퍼스 한가운데 고층 건물이에요. 지하 상상베이스, 12층 전망대·식당·카페가 있어요.',
      rooms: ['sangsang-12f', 'sangsang-base'],
    },
    {
      id: 'yeongu', name: '연구관', sub: '상상파크 · 카페', at: strokeAt(LEFT, 0.5), w: 160, h: 100, wall: 64, tone: 'plain', color: 'mint',
      floors: '지하 2층 ~ 지상 9층', info: '1층에 상상파크 라운지와 카페가 있고, 옥상은 서울시 조망 명소예요.',
      rooms: ['research-park'],
    },
    {
      id: 'changui', name: '창의관', sub: '학생식당', at: strokeAt(LEFT, 0.88), w: 170, h: 100, wall: 40, tone: 'plain', color: 'coral',
      floors: '지하 학생식당', info: '지하에 학생식당·교직원식당·편의점이 있어요.',
      rooms: ['changui-cafe'],
    },
    {
      id: 'eng-a', name: '공학관 A동', sub: '상상파크 플러스', at: strokeAt(RIGHT, 0.45), w: 150, h: 96, wall: 52, tone: 'plain', color: 'violet',
      floors: '캠퍼스 가장 높은 곳', info: '옥상 정원 상상파크 플러스와 코딩라운지가 있어요.',
      rooms: ['eng-plus'],
    },
    {
      id: 'mirae', name: '미래관', sub: '학술정보관 · 글로벌플라자', at: strokeAt(RIGHT, 0.88), w: 180, h: 104, wall: 40, tone: 'glass', color: 'amber',
      floors: '지하 1층 ~ 지상 6층', info: '지상은 도서관, 지하 글로벌플라자는 카페와 라운지예요.',
      rooms: ['global-plaza'],
    },
  ] satisfies BuildingSpec[]
).map(place);

const area = (id: string, name: string, kind: AreaKind, at: Pt, w: number, h: number, info: string): Area => {
  const c = fromScreen(at.x, at.y);
  return { id, name, kind, info, x: Math.round(c.x - w / 2), y: Math.round(c.y - h / 2), w, h };
};

export const AREAS: Area[] = [
  area('madang', '상상마당', 'lawn', { x: 20, y: 560 }, 240, 240, '두 다리 사이 잔디 광장이에요. 축제가 열리는 곳이에요.'),
];

export const GATES: Gate[] = [{ id: 'main', name: '정문', ...fromScreen(0, 780), info: '한성대입구역에서 오는 출입구예요.' }];

/** 걷는 길 (그림만): 정문 → 상상마당 */
export const PATHS: Pt[][] = [[fromScreen(0, 780), fromScreen(10, 700)]];

/** 나무 숲 (화면 좌표 네모, 건물·획·광장과 겹치는 나무는 뺀다) */
export const FORESTS: { n: number; x0: number; y0: number; x1: number; y1: number }[] = [
  { n: 30, x0: -380, y0: -260, x1: 380, y1: -40 },
  { n: 30, x0: -760, y0: 60, x1: -200, y1: 560 },
  { n: 30, x0: 200, y0: 60, x1: 760, y1: 560 },
  { n: 26, x0: -620, y0: 640, x1: 620, y1: 900 },
];

/** 볼록 껍질 (모노톤 체인) */
function hull(points: Pt[]): Pt[] {
  const p = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (o: Pt, a: Pt, b: Pt) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: Pt[] = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop();
    lower.push(q);
  }
  const upper: Pt[] = [];
  for (const q of p.reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop();
    upper.push(q);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

/** 볼록 다각형을 r 만큼 바깥으로 넓히고 모서리를 둥글게 */
export function roundOut(poly: Pt[], r: number, arc = 8): Pt[] {
  const out: Pt[] = [];
  const n = poly.length;
  const normal = (a: Pt, b: Pt) => {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const l = Math.hypot(dx, dy) || 1;
    return Math.atan2(-dx / l, dy / l);
  };
  for (let i = 0; i < n; i++) {
    const prev = poly[(i + n - 1) % n];
    const cur = poly[i];
    const next = poly[(i + 1) % n];
    let a0 = normal(prev, cur);
    let a1 = normal(cur, next);
    if (a1 < a0) a1 += Math.PI * 2;
    for (let k = 0; k <= arc; k++) {
      const a = a0 + ((a1 - a0) * k) / arc;
      out.push({ x: cur.x + Math.cos(a) * r, y: cur.y + Math.sin(a) * r });
    }
  }
  return out;
}

/** 모형을 감싸는 섬 모양 땅의 뼈대 (건물 · 획 · 정문) */
const CORE = hull([
  ...BUILDINGS.flatMap((b) => [
    { x: b.x - 40, y: b.y - 40 },
    { x: b.x + b.w + 40, y: b.y - 40 },
    { x: b.x - 40, y: b.y + b.h + b.wall + 40 },
    { x: b.x + b.w + 40, y: b.y + b.h + b.wall + 40 },
  ]),
  ...STROKES.flatMap((st) => [0, 0.25, 0.5, 0.75, 1].map((t) => fromScreen(strokeAt(st, t).x, strokeAt(st, t).y))),
  fromScreen(0, -200),
  fromScreen(0, 820),
  fromScreen(-420, 760),
  fromScreen(420, 780),
]);
/** 땅 (둥근 섬) */
export const GROUND: Pt[] = roundOut(CORE, GROUND_R);
/** 나무를 심을 수 있는 곳 (땅 가장자리에서 조금 안쪽) */
export const GROUND_INNER: Pt[] = roundOut(CORE, GROUND_R - 40);
/** 섬 두께 (평면 좌표로 (d, d) 만큼 내리면 화면에서 바로 아래로 d 만큼) */
export const GROUND_DEPTH = 26;

/** 지나갈 수 없는 곳 */
export const CAMPUS_BLOCKED: Rect[] = BUILDINGS.map((b) => ({ x: b.x, y: b.y, w: b.w, h: b.h + b.wall }));

export const CAMPUS_SPAWN: Pt = { x: GATES[0].x, y: GATES[0].y - 20 };

/** 건물 문 앞 (앞벽 아래 가운데) */
export const doorOf = (b: Building): Pt => ({ x: b.x + b.w / 2, y: b.y + b.h + b.wall + 20 });

export const buildingById = (id: string): Building | undefined => BUILDINGS.find((b) => b.id === id);
