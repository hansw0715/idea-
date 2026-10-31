/**
 * 한성대학교 캠퍼스 배치 (삼선교로16길 116).
 *
 * 실제 배치를 바탕으로 단순화한 지도다. 아래쪽이 정문(한성대입구역 쪽, 낮은 곳),
 * 위쪽이 낙산공원·한양도성(높은 곳)이라 화면을 위로 걸어 올라가면 언덕을 오르는 셈이다.
 *  - 정문을 지나면 오른쪽에 통유리 미래관(학술정보관), 앞에 연구관, 그 왼쪽에 창의관
 *  - 가운데 고층 상상관, 그 위로 상상마당 잔디 광장, 미래관 위로 미래마당
 *  - 상상관 옆 낙산관, 중문 쪽 우촌관, 그 옆 진리관·우진사, 삼군부 총무당과 학군단
 *  - 탐구관 앞 거북상·삼학송 광장, 가장 높은 구석에 공학관 A·B동과 상상빌리지
 *  - 창의관 2층에서 지선교로 낙산정원, 그 끝 후문(남문)에서 낙산공원
 * 거리·크기 비율은 정확하지 않다. 공식 캠퍼스맵: hansung.ac.kr/campusMap/hansung/view.do
 */
import type { Pt, Rect } from './geometry';

export const CAMPUS_W = 1200;
export const CAMPUS_H = 1600;

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

export const BUILDINGS: Building[] = [
  {
    id: 'eng-a', name: '공학관 A동', sub: '상상파크 플러스', x: 860, y: 180, w: 150, h: 100, wall: 36, tone: 'plain',
    floors: '캠퍼스 가장 높은 곳', info: '옥상 정원 상상파크 플러스와 코딩라운지가 있어요. 낙산공원과 가장 가까운 건물이에요.',
    rooms: ['eng-plus'],
  },
  {
    id: 'eng-b', name: '공학관 B동', sub: '강의실', x: 1030, y: 190, w: 130, h: 90, wall: 30, tone: 'plain',
    floors: '엘리베이터 없음', info: 'A동 옆 공학 강의동이에요.',
  },
  {
    id: 'village', name: '상상빌리지', sub: '기숙사', x: 600, y: 170, w: 200, h: 90, wall: 48, tone: 'plain',
    floors: '기숙사', info: '공학관 옆 기숙사예요. 창밖으로 한양도성과 낙산이 보여요.',
  },
  {
    id: 'jiseon', name: '지선관', sub: '회화과', x: 60, y: 660, w: 150, h: 80, wall: 24, tone: 'plain',
    floors: '미술 실기동', info: '회화과 실기실이 있는 건물이에요. 지선교로 창의관과 이어져요.',
  },
  {
    id: 'changui', name: '창의관', sub: '학생식당', x: 50, y: 880, w: 200, h: 120, wall: 30, tone: 'plain',
    floors: '지하 학생식당', info: '지하에 학생식당·교직원식당·편의점이 있어요. 2층에서 지선교로 낙산정원에 가요.',
    rooms: ['changui-cafe'],
  },
  {
    id: 'inseong', name: '인성관', sub: '동아리방', x: 250, y: 900, w: 70, h: 90, wall: 24, tone: 'plain',
    floors: '창의관에 붙은 건물', info: '동아리방이 모여 있어요. 주로 창의관을 거쳐 들어가요.',
  },
  {
    id: 'yeongu', name: '연구관', sub: '상상파크 · 카페 오뜨', x: 360, y: 1050, w: 150, h: 110, wall: 60, tone: 'plain',
    floors: '지하 2층 ~ 지상 9층', info: '정문 맞은편 건물이에요. 1층에 상상파크 라운지와 카페가 있고, 옥상은 서울시 조망 명소예요.',
    rooms: ['research-park'],
  },
  {
    id: 'sangsang', name: '상상관', sub: '12층 전망 라운지', x: 560, y: 860, w: 220, h: 150, wall: 72, tone: 'landmark',
    floors: '지하 ~ 지상 12층', info: '캠퍼스 한가운데 고층 건물이에요. 지하 상상베이스, 12층 전망대·식당·카페가 있어요.',
    rooms: ['sangsang-12f', 'sangsang-base'],
  },
  {
    id: 'mirae', name: '미래관', sub: '학술정보관 · 글로벌플라자', x: 560, y: 1300, w: 200, h: 110, wall: 40, tone: 'glass',
    floors: '지하 1층 ~ 지상 6층', info: '정문 바로 오른쪽 통유리 건물. 지상은 도서관, 지하 글로벌플라자는 카페와 선큰광장이에요.',
    rooms: ['global-plaza'],
  },
  {
    id: 'tamgu', name: '탐구관', sub: '대형 강의실', x: 780, y: 520, w: 170, h: 110, wall: 30, tone: 'plain',
    floors: '지하 계단식 강의실', info: '교양 강의가 많은 건물이에요. 앞에 거북상과 삼학송이 있어요.',
  },
  {
    id: 'haksong', name: '학송관', sub: '평생교육원', x: 990, y: 540, w: 150, h: 80, wall: 16, tone: 'brick',
    floors: '붉은 기와 건물', info: '예전 체육관이던 붉은 기와 건물이에요. 이름은 삼학송에서 왔어요.',
  },
  {
    id: 'samgunbu', name: '삼군부 총무당', sub: '문화재', x: 1000, y: 700, w: 120, h: 56, wall: 14, tone: 'heritage',
    floors: '조선 시대 건물', info: '조선 시대 삼군부의 건물로 캠퍼스 안의 문화재예요.',
  },
  {
    id: 'rotc', name: '학군단', sub: 'ROTC', x: 1130, y: 705, w: 55, h: 48, wall: 14, tone: 'plain',
    floors: '단층', info: '옆 계단으로 내려가면 삼선공원이에요.',
  },
  {
    id: 'jinri', name: '진리관', sub: '학생회', x: 1010, y: 800, w: 150, h: 90, wall: 20, tone: 'old',
    floors: '1956년 · 가장 오래된 건물', info: '학교에서 가장 오래된 건물이에요. 학생회와 학과 사무실이 있어요.',
  },
  {
    id: 'naksan', name: '낙산관', sub: '체육관 · 강당', x: 820, y: 880, w: 150, h: 120, wall: 30, tone: 'plain',
    floors: '지상 4층', info: '1층 무용실, 2층 강당, 3층 체육관, 4층 체력단련실이 있어요.',
  },
  {
    id: 'uchon', name: '우촌관', sub: '본부 · 중문', x: 860, y: 1150, w: 210, h: 130, wall: 42, tone: 'plain',
    floors: '지상 7층', info: '대학 본부가 있어요. 중문과 지하주차장이 이어져요.',
  },
  {
    id: 'annex', name: '제1별관', sub: '신문사 · 은행', x: 1060, y: 1420, w: 110, h: 70, wall: 18, tone: 'plain',
    floors: '경사지 가장 아래', info: '학보사·방송국과 은행이 있어요.',
  },
];

export const AREAS: Area[] = [
  { id: 'garden', name: '낙산정원', kind: 'forest', x: 30, y: 170, w: 270, h: 440, info: '숲길과 벤치, 정자가 있는 산책로예요. 끝의 후문으로 낙산공원에 가요.' },
  { id: 'futsal', name: '풋살장', kind: 'field', x: 340, y: 210, w: 220, h: 150, info: '풋살과 테니스를 하는 운동장이에요.' },
  { id: 'madang', name: '상상마당', kind: 'lawn', x: 330, y: 640, w: 400, h: 190, info: '파라솔과 무대가 있는 잔디 광장이에요. 축제가 열리는 곳이에요.' },
  { id: 'turtle', name: '거북상 광장', kind: 'plaza', x: 770, y: 680, w: 190, h: 70, info: '탐구관 앞 거북상과 삼학송이 있는 광장이에요.' },
  { id: 'woojin', name: '우진사', kind: 'garden', x: 1000, y: 940, w: 180, h: 150, info: '봄이면 벚꽃이 피는 쉼터예요.' },
  { id: 'miraemadang', name: '미래마당', kind: 'plaza', x: 540, y: 1180, w: 260, h: 96, info: '미래관 위 벽돌 광장이에요. 아래가 글로벌플라자예요.' },
  { id: 'sunken', name: '선큰광장', kind: 'sunken', x: 775, y: 1320, w: 70, h: 80, info: '계단으로 내려가면 글로벌플라자와 상상관 지하가 이어져요.' },
];

export const GATES: Gate[] = [
  { id: 'main', name: '정문', x: 300, y: 1586, info: '한성대입구역에서 오는 보행자 전용 출입구예요.' },
  { id: 'middle', name: '중문', x: 1186, y: 1240, info: '차량이 드나드는 출입구예요. 우촌관과 이어져요.' },
  { id: 'rear', name: '후문', x: 160, y: 152, info: '낙산정원 끝, 낙산공원으로 가는 가장 빠른 길이에요.' },
  { id: 'east', name: '동문', x: 1186, y: 470, info: '창신역 쪽으로 나가는 출입구예요.' },
];

/** 걷는 길 (그림만, 충돌 없음) */
export const PATHS: Pt[][] = [
  [{ x: 300, y: 1600 }, { x: 300, y: 1260 }, { x: 540, y: 1240 }, { x: 830, y: 1240 }, { x: 1200, y: 1240 }],
  [{ x: 300, y: 1260 }, { x: 300, y: 1040 }, { x: 320, y: 860 }, { x: 330, y: 620 }, { x: 320, y: 400 }, { x: 310, y: 190 }, { x: 160, y: 150 }],
  [{ x: 330, y: 620 }, { x: 760, y: 470 }, { x: 1200, y: 470 }],
  [{ x: 760, y: 470 }, { x: 820, y: 330 }, { x: 940, y: 330 }],
  [{ x: 800, y: 1100 }, { x: 800, y: 800 }, { x: 990, y: 790 }, { x: 990, y: 1120 }],
  [{ x: 560, y: 470 }, { x: 600, y: 310 }, { x: 700, y: 310 }],
];

/** 지선교: 창의관 2층 → 낙산정원 다리 */
export const BRIDGE: Pt[] = [
  { x: 150, y: 880 },
  { x: 150, y: 790 },
  { x: 170, y: 640 },
];

/** 한양도성 성곽 — 위쪽 낙산 능선. 후문 자리만 열려 있다 */
export const WALL_Y = 132;
export const REAR_GAP = { from: 130, to: 190 };

/** 지나갈 수 없는 곳 */
export const CAMPUS_BLOCKED: Rect[] = [
  ...BUILDINGS.map((b) => ({ x: b.x, y: b.y, w: b.w, h: b.h + b.wall })),
  { x: 0, y: 0, w: REAR_GAP.from, h: WALL_Y + 16 },
  { x: REAR_GAP.to, y: 0, w: CAMPUS_W - REAR_GAP.to, h: WALL_Y + 16 },
  { x: REAR_GAP.from, y: 0, w: REAR_GAP.to - REAR_GAP.from, h: 70 },
  // 거북상
  { x: 845, y: 698, w: 40, h: 26 },
];

export const TURTLE: Pt = { x: 865, y: 711 };
export const CAMPUS_SPAWN: Pt = { x: 300, y: 1520 };

/** 건물 문 앞 (앞벽 아래 가운데) */
export const doorOf = (b: Building): Pt => ({ x: b.x + b.w / 2, y: b.y + b.h + b.wall + 20 });

export const buildingById = (id: string): Building | undefined => BUILDINGS.find((b) => b.id === id);
