/**
 * 라운지 지도의 좌표계와 배치. (docs/lounge/00-overview.md §3)
 *
 * 모든 값은 viewBox(360×760) 단위(이하 vu)다. 화면에서는 두 가지로 쓴다.
 *  - 위치(left/top): vu ÷ 360, ÷ 760 을 % 로 → 지도 폭이 바뀌어도 같은 자리에 놓인다.
 *  - 크기: `calc(var(--u) * vu)` (--u = 지도 폭의 1/360, 컨테이너 쿼리 단위) → 글자 크기를 150% 로 키워도
 *    지도는 같은 비율로 보이고, 글자만 rem 으로 커진다.
 * 서버가 저장하는 좌표는 0~1 로 정규화한 값이라 기기 크기와 상관없이 같은 자리에 아바타가 서 있다.
 */
import type { Zone } from '../../../../shared/lounge';
import type { SlotView } from '../../../../shared/lounge';

export const MAP_W = 360;
export const MAP_H = 760;

export type Rect = { x: number; y: number; w: number; h: number };

/** 구역 바닥 (장식·바닥 색을 그리는 범위). 사이 6vu 는 구역을 가르는 길이다. */
export const ZONE_RECTS: Record<Zone, Rect> = {
  plaza: { x: 4, y: 4, w: 352, h: 106 },
  meetup: { x: 4, y: 116, w: 352, h: 344 },
  meal: { x: 4, y: 466, w: 352, h: 290 },
};

export const ZONE_NAME: Record<Zone, string> = {
  plaza: '광장',
  meetup: '미팅 라운지',
  meal: '밥약 식당',
};

/** 위치로 구역을 판정한다. 길(구역 사이 틈)은 가까운 쪽에 넣는다. */
export function zoneAt(x: number, y: number): Zone {
  const vy = y * MAP_H;
  const plazaEnd = (ZONE_RECTS.plaza.y + ZONE_RECTS.plaza.h + ZONE_RECTS.meetup.y) / 2;
  const meetupEnd = (ZONE_RECTS.meetup.y + ZONE_RECTS.meetup.h + ZONE_RECTS.meal.y) / 2;
  if (vy < plazaEnd) return 'plaza';
  if (vy < meetupEnd) return 'meetup';
  return 'meal';
}

/** 지도 밖으로 나가지 않게, 아바타와 이름표가 모두 보이는 범위로 가둔다. */
export function clampPoint(x: number, y: number): { x: number; y: number } {
  const cx = Math.min(0.95, Math.max(0.05, x));
  const cy = Math.min(0.965, Math.max(0.025, y));
  return { x: Math.round(cx * 10000) / 10000, y: Math.round(cy * 10000) / 10000 };
}

export const pctX = (vu: number): string => `${(vu / MAP_W) * 100}%`;
export const pctY = (vu: number): string => `${(vu / MAP_H) * 100}%`;
/** vu → CSS 길이 (지도 폭에 비례) */
export const u = (vu: number): string => `calc(var(--u) * ${vu})`;

// ───────────── 테이블 칸 ─────────────

/** 테이블 한 칸(의자·제목까지 포함)의 크기 */
export const CELL = { w: 152, h: 100 } as const;

export type TableSlot = { index: number; cx: number; cy: number };

const COL_X = [96, 264] as const;
const cells = (rowTops: readonly number[]): TableSlot[] =>
  rowTops.flatMap((top, row) =>
    COL_X.map((cx, col) => ({ index: row * COL_X.length + col, cx, cy: top + CELL.h / 2 })),
  );

/** 미팅 라운지 6칸 (2열×3행) */
export const MEETUP_SLOTS: TableSlot[] = cells([148, 252, 356]);
/** 밥약 식당 4칸 (2열×2행) */
export const MEAL_SLOTS: TableSlot[] = cells([498, 600]);

export const SLOTS_BY_ZONE = { meetup: MEETUP_SLOTS, meal: MEAL_SLOTS } as const;

/** 구역 간판(게시판 버튼)의 위쪽 위치 */
export const SIGN_Y = { meetup: 122, meal: 472 } as const;

/** 빠른 매칭 키오스크 (밥약 식당 맨 아래) */
export const KIOSK = { cx: 180, cy: 731, w: 208, h: 44 } as const;

// ───────────── 의자 배치 ─────────────

export type SeatSpot = {
  slotKey: string;
  slotLabel: string;
  /** 슬롯 안에서 몇 번째 의자인가 (1부터) */
  seatNo: number;
  /** 의자가 있는 줄/자리의 앉은 사람 (members[seatNo-1]) */
  memberIndex: number;
  /** 칸(셀) 왼쪽 위 기준 좌표와 크기 (vu) */
  x: number;
  y: number;
  w: number;
  h: number;
};

export type TableGeometry = {
  /** 테이블 상판 (vu, 칸 기준) */
  table: Rect;
  round: boolean;
  seats: SeatSpot[];
};

const clampCap = (n: number): number => Math.max(1, Math.min(4, Math.floor(n) || 1));

/** 의자가 4개면 촘촘하게(36), 그 밖에는 여유 있게(46) */
const pitchFor = (n: number): number => (n >= 4 ? 36 : 46);
const CHAIR_H = 24;

/**
 * 미팅: 직사각 테이블. 윗줄 = 첫 슬롯(우리 쪽), 아랫줄 = 둘째 슬롯(상대 쪽).
 * 의자는 줄당 1~4개. 줄 안에서 가운데로 모은다.
 */
export function meetupGeometry(slots: SlotView[]): TableGeometry {
  const rows = slots.slice(0, 2);
  const widest = Math.max(1, ...rows.map((s) => clampCap(s.capacity)));
  const tableW = Math.max(84, widest * pitchFor(widest));
  const seats: SeatSpot[] = [];
  rows.forEach((slot, row) => {
    const n = clampCap(slot.capacity);
    const pitch = pitchFor(n);
    const y = row === 0 ? 0 : 56;
    for (let i = 0; i < n; i += 1) {
      const w = pitch - 6;
      const cx = CELL.w / 2 + (i - (n - 1) / 2) * pitch;
      seats.push({ slotKey: slot.key, slotLabel: slot.label, seatNo: i + 1, memberIndex: i, x: cx - w / 2, y, w, h: CHAIR_H });
    }
  });
  return { table: { x: (CELL.w - tableW) / 2, y: 27, w: tableW, h: 26 }, round: false, seats };
}

/** 밥약: 원형 테이블. 정원 2~4 의자가 둘레에 놓인다. */
export function mealGeometry(slots: SlotView[]): TableGeometry {
  const slot = slots[0];
  const n = Math.max(2, clampCap(slot?.capacity ?? 2));
  const cx = CELL.w / 2;
  const cy = 42;
  const R = 32;
  const chair = 24;
  const angles: Record<number, number[]> = {
    2: [180, 0],
    3: [-90, 30, 150],
    4: [-90, 0, 90, 180],
  };
  const seats: SeatSpot[] = (angles[n] ?? angles[4]).map((deg, i) => {
    const rad = (deg * Math.PI) / 180;
    return {
      slotKey: slot?.key ?? 'table',
      slotLabel: slot?.label ?? '같이 먹을 사람',
      seatNo: i + 1,
      memberIndex: i,
      x: cx + R * Math.cos(rad) - chair / 2,
      y: cy + R * Math.sin(rad) - chair / 2,
      w: chair,
      h: chair,
    };
  });
  return { table: { x: cx - 20, y: cy - 20, w: 40, h: 40 }, round: true, seats };
}
