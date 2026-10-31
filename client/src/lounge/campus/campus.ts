/**
 * 한성대학교 캠퍼스 배치 (삼선교로16길 116).
 *
 * 공식 캠퍼스맵(조감도) 위의 건물 자리를 그대로 옮겨 온다. 아래 좌표 (u, v)는 1280×720 조감도
 * 그림 속 건물 가운데 점이고, fromMap 이 그 자리가 아이소메트릭 화면에서도 같은 곳에 보이도록
 * 평면 좌표로 바꾼다. 건물은 실제보다 작게, 사이를 좁혀 옹기종기 모아 둔다.
 *  - 아래 가운데 정문 → 미래관·미래마당, 그 아래 길게 우촌관과 중문
 *  - 가운데 고층 상상관, 오른쪽으로 상상마당·풋살장, 그 앞 진리관·학송관, 끝에 학군단·탐구관
 *  - 상상관 뒤 연구관·지선관, 그 위 공학관 A·B동과 상상빌리지
 *  - 왼쪽 창의관·인성관과 낙산관, 맨 위 낙산공원과 남문
 * 공식 캠퍼스맵: hansung.ac.kr/campusMap/hansung/view.do
 */
import type { Pt, Rect } from './geometry';

export const CAMPUS_W = 1150;
export const CAMPUS_H = 760;
/** 땅 모서리 둥글기 */
export const GROUND_R = 90;

const MAP_SCALE = 1.5;
const R3 = Math.sqrt(3);
/** 조감도 그림 좌표 → 평면 좌표 (iso 로 투영하면 그림과 같은 자리) */
export function fromMap(u: number, v: number): Pt {
  const a = u - 640;
  const b = v - 470;
  return { x: 620 + MAP_SCALE * (b + a / R3), y: 400 + MAP_SCALE * (b - a / R3) };
}

export type BuildingTone = 'plain' | 'glass' | 'landmark' | 'heritage' | 'brick' | 'old';

export interface Building extends Rect {
  id: string;
  name: string;
  /** 건물 안 대표 시설 한 줄 */
  sub: string;
  /** 앞면 벽 높이(층수 느낌). 지붕 아래로 그려진다 */
  wall: number;
  tone: BuildingTone;
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

type BuildingSpec = Omit<Building, 'x' | 'y'> & { at: [number, number] };

/** 조감도 자리(at)를 가운데로 하는 건물 (발자국 깊이는 h + 앞벽) */
const place = ({ at, ...b }: BuildingSpec): Building => {
  const c = fromMap(at[0], at[1]);
  return { ...b, x: Math.round(c.x - b.w / 2), y: Math.round(c.y - (b.h + b.wall) / 2) };
};

export const BUILDINGS: Building[] = (
  [
    {
      id: 'eng-a', name: '공학관 A동', sub: '상상파크 플러스', at: [585, 330], w: 96, h: 58, wall: 30, tone: 'plain',
      floors: '캠퍼스 가장 높은 곳', info: '옥상 정원 상상파크 플러스와 코딩라운지가 있어요. 낙산공원과 가장 가까운 건물이에요.',
      rooms: ['eng-plus'],
    },
    {
      id: 'eng-b', name: '공학관 B동', sub: '강의실', at: [630, 272], w: 78, h: 40, wall: 20, tone: 'plain',
      floors: '엘리베이터 없음', info: 'A동 뒤 공학 강의동이에요.',
    },
    {
      id: 'village', name: '상상빌리지', sub: '기숙사', at: [550, 288], w: 56, h: 46, wall: 40, tone: 'plain',
      floors: '기숙사', info: '공학관 옆 기숙사예요. 창밖으로 낙산공원이 보여요.',
    },
    {
      id: 'jiseon', name: '지선관', sub: '회화과', at: [626, 370], w: 80, h: 36, wall: 18, tone: 'brick',
      floors: '미술 실기동', info: '회화과 실기실이 있는 건물이에요.',
    },
    {
      id: 'yeongu', name: '연구관', sub: '상상파크 · 카페', at: [656, 420], w: 110, h: 66, wall: 44, tone: 'plain',
      floors: '지하 2층 ~ 지상 9층', info: '상상관 뒤 큰 건물이에요. 1층에 상상파크 라운지와 카페가 있고, 옥상은 서울시 조망 명소예요.',
      rooms: ['research-park'],
    },
    {
      id: 'sangsang', name: '상상관', sub: '12층 전망 라운지', at: [600, 482], w: 80, h: 62, wall: 64, tone: 'landmark',
      floors: '지하 ~ 지상 12층', info: '캠퍼스 한가운데 고층 건물이에요. 지하 상상베이스, 12층 전망대·식당·카페가 있어요.',
      rooms: ['sangsang-12f', 'sangsang-base'],
    },
    {
      id: 'mirae', name: '미래관', sub: '학술정보관 · 글로벌플라자', at: [496, 504], w: 104, h: 70, wall: 30, tone: 'glass',
      floors: '지하 1층 ~ 지상 6층', info: '정문 바로 옆 건물. 지상은 도서관, 지하 글로벌플라자는 카페와 라운지예요.',
      rooms: ['global-plaza'],
    },
    {
      id: 'changui', name: '창의관', sub: '학생식당', at: [452, 432], w: 90, h: 56, wall: 26, tone: 'glass',
      floors: '지하 학생식당', info: '지하에 학생식당·교직원식당·편의점이 있어요.',
      rooms: ['changui-cafe'],
    },
    {
      id: 'inseong', name: '인성관', sub: '동아리방', at: [430, 398], w: 46, h: 40, wall: 18, tone: 'plain',
      floors: '창의관에 붙은 건물', info: '동아리방이 모여 있어요. 주로 창의관을 거쳐 들어가요.',
    },
    {
      id: 'naksan', name: '낙산관', sub: '체육관 · 강당', at: [345, 432], w: 80, h: 70, wall: 26, tone: 'plain',
      floors: '지상 4층', info: '1층 무용실, 2층 강당, 3층 체육관, 4층 체력단련실이 있어요.',
    },
    {
      id: 'uchon', name: '우촌관', sub: '본부 · 중문', at: [572, 592], w: 150, h: 64, wall: 30, tone: 'plain',
      floors: '지상 7층', info: '대학 본부가 있어요. 아래 중문과 지하주차장이 이어져요.',
    },
    {
      id: 'jinri', name: '진리관', sub: '학생회', at: [762, 548], w: 120, h: 44, wall: 20, tone: 'old',
      floors: '1956년 · 가장 오래된 건물', info: '학교에서 가장 오래된 건물이에요. 학생회와 학과 사무실이 있어요.',
    },
    {
      id: 'haksong', name: '학송관', sub: '평생교육원', at: [794, 596], w: 56, h: 46, wall: 12, tone: 'brick',
      floors: '붉은 기와 건물', info: '예전 체육관이던 붉은 기와 건물이에요. 이름은 삼학송에서 왔어요.',
    },
    {
      id: 'rotc', name: '학군단', sub: 'ROTC', at: [890, 548], w: 44, h: 30, wall: 10, tone: 'plain',
      floors: '단층', info: '탐구관 옆 학군단이에요.',
    },
    {
      id: 'tamgu', name: '탐구관', sub: '대형 강의실', at: [892, 604], w: 96, h: 60, wall: 24, tone: 'plain',
      floors: '지하 계단식 강의실', info: '교양 강의가 많은 건물이에요. 앞에 거북상이 있어요.',
    },
    {
      id: 'annex', name: '제1별관', sub: '신문사 · 은행', at: [640, 640], w: 50, h: 34, wall: 12, tone: 'plain',
      floors: '중문 옆', info: '학보사·방송국과 은행이 있어요.',
    },
  ] satisfies BuildingSpec[]
).map(place);

const area = (id: string, name: string, kind: AreaKind, at: [number, number], w: number, h: number, info: string): Area => {
  const c = fromMap(at[0], at[1]);
  return { id, name, kind, info, x: Math.round(c.x - w / 2), y: Math.round(c.y - h / 2), w, h };
};

export const AREAS: Area[] = [
  area('park', '낙산공원', 'forest', [420, 292], 220, 150, '캠퍼스 위쪽 숲길이에요. 남문으로 나가면 낙산공원이에요.'),
  area('madang', '상상마당', 'lawn', [700, 494], 120, 86, '잔디와 벽돌 광장이 있는 상상마당이에요. 축제가 열리는 곳이에요.'),
  area('futsal', '풋살장', 'field', [770, 482], 104, 70, '풋살과 테니스를 하는 운동장이에요.'),
  area('miraemadang', '미래마당', 'plaza', [505, 560], 110, 56, '미래관 앞 붉은 벽돌 광장이에요.'),
];

export const GATES: Gate[] = [
  { id: 'main', name: '정문', ...fromMap(420, 506), info: '한성대입구역에서 오는 보행자 출입구예요.' },
  { id: 'middle', name: '중문', ...fromMap(585, 630), info: '차량이 드나드는 출입구예요. 우촌관과 이어져요.' },
  { id: 'south', name: '남문', ...fromMap(392, 262), info: '낙산공원으로 가는 가장 빠른 길이에요.' },
];

const mapPath = (list: [number, number][]) => list.map(([u, v]) => fromMap(u, v));

/** 걷는 길 (그림만) */
export const PATHS: Pt[][] = [
  mapPath([[392, 262], [418, 330], [402, 384], [396, 470], [420, 506]]),
  mapPath([[420, 506], [462, 548], [500, 604], [585, 630]]),
  mapPath([[585, 630], [690, 620], [760, 632], [840, 660], [920, 668]]),
  mapPath([[540, 540], [640, 536], [720, 528], [860, 522], [910, 534]]),
  mapPath([[640, 536], [574, 440], [548, 380], [520, 330]]),
];

export const PAVILION: Pt = fromMap(535, 395);
export const TURTLE: Pt = fromMap(848, 634);

/** 나무 숲 (조감도 그림 좌표의 네모, 건물·광장과 겹치는 나무는 뺀다) */
export const FORESTS: { n: number; u0: number; v0: number; u1: number; v1: number }[] = [
  { n: 46, u0: 330, v0: 190, u1: 660, v1: 300 },
  { n: 14, u0: 250, v0: 300, u1: 330, v1: 420 },
  { n: 12, u0: 470, v0: 320, u1: 560, v1: 400 },
  { n: 18, u0: 700, v0: 380, u1: 920, v1: 460 },
  { n: 8, u0: 680, v0: 618, u1: 840, v1: 680 },
];

/** 지나갈 수 없는 곳 */
export const CAMPUS_BLOCKED: Rect[] = BUILDINGS.map((b) => ({ x: b.x, y: b.y, w: b.w, h: b.h + b.wall }));

export const CAMPUS_SPAWN: Pt = { x: GATES[0].x, y: GATES[0].y - 20 };

/** 건물 문 앞 (앞벽 아래 가운데) */
export const doorOf = (b: Building): Pt => ({ x: b.x + b.w / 2, y: b.y + b.h + b.wall + 20 });

export const buildingById = (id: string): Building | undefined => BUILDINGS.find((b) => b.id === id);
