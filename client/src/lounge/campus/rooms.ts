/** 건물 안 라운지. 실제 시설 이름을 따왔고 탁자 배치는 미팅 라운지용으로 새로 짰다. */
import type { Pt, Rect } from './geometry';

export const ROOM_W = 900;
export const ROOM_H = 640;
/** 위쪽 벽(창문) 두께 */
export const ROOM_WALL = 110;

/** 앱의 라운지 모임 종류와 같은 말을 쓴다 */
export type TableKind = 'meeting' | 'meal' | 'study' | 'free';

export const KIND_LABEL: Record<TableKind, string> = {
  meeting: '미팅',
  meal: '밥약',
  study: '스터디',
  free: '자유',
};

export interface RoomTable extends Rect {
  id: string;
  kind: TableKind;
  shape: 'rect' | 'round';
  seats: number;
  title: string;
  /** 이 탁자에 놓인 실제 모임 (미팅·밥약 탁자) */
  gatheringId?: string;
  /** 미팅·밥약 탁자인데 아직 모임이 없다 */
  vacant?: boolean;
}

export type RoomTheme = 'sky' | 'cafe' | 'lab' | 'plaza' | 'cafeteria' | 'base';

export interface Room {
  id: string;
  building: string;
  name: string;
  floor: string;
  desc: string;
  theme: RoomTheme;
  tables: RoomTable[];
  counter?: Rect & { label: string };
}

const t = (
  id: string, kind: TableKind, shape: 'rect' | 'round', x: number, y: number, seats: number, title: string,
  w = shape === 'round' ? 96 : 170, h = shape === 'round' ? 96 : 70,
): RoomTable => ({ id, kind, shape, x, y, w, h, seats, title });

export const ROOMS: Room[] = [
  {
    id: 'sangsang-12f', building: 'sangsang', name: '상상관 전망 라운지', floor: '12층', theme: 'sky',
    desc: '캠퍼스에서 전망이 가장 좋은 층이에요. 창밖으로 낙산과 한양도성이 보여요.',
    counter: { x: 650, y: 470, w: 210, h: 56, label: '카페 한담' },
    tables: [
      t('s1', 'meeting', 'rect', 110, 210, 6, '3:3 미팅 · 상상관 12층'),
      t('s2', 'meeting', 'rect', 380, 210, 4, '2:2 미팅 · 전망 자리'),
      t('s3', 'free', 'round', 690, 230, 4, '노을 보면서 수다'),
      t('s4', 'study', 'rect', 110, 430, 4, '정보처리기사 스터디'),
      t('s5', 'meal', 'round', 420, 400, 4, '케이키친 한상 밥약'),
    ],
  },
  {
    id: 'sangsang-base', building: 'sangsang', name: '상상베이스', floor: '지하 1층', theme: 'base',
    desc: '조용히 모여 공부하는 스터디 라운지예요.',
    tables: [
      t('b1', 'study', 'rect', 100, 200, 6, '캡스톤 팀플 회의'),
      t('b2', 'study', 'rect', 380, 200, 4, '토익 900 스터디'),
      t('b3', 'study', 'rect', 640, 200, 4, '알고리즘 스터디'),
      t('b4', 'free', 'round', 160, 430, 4, '과제 질문방'),
      t('b5', 'meeting', 'rect', 420, 400, 4, '2:2 미팅 · 조용한 자리'),
    ],
  },
  {
    id: 'research-park', building: 'yeongu', name: '상상파크', floor: '1층', theme: 'cafe',
    desc: '카페 오뜨 옆 라운지예요. 공강 시간에 가볍게 모여요.',
    counter: { x: 640, y: 150, w: 220, h: 56, label: '카페 오뜨' },
    tables: [
      t('r1', 'free', 'round', 120, 220, 4, '공강 메이트'),
      t('r2', 'meeting', 'rect', 330, 230, 4, '2:2 미팅 · 커피 한 잔'),
      t('r3', 'meal', 'round', 640, 300, 3, '점심 뭐 먹지'),
      t('r4', 'study', 'rect', 120, 440, 6, '교양 조별과제'),
      t('r5', 'free', 'round', 450, 400, 4, '새내기 모여라'),
    ],
  },
  {
    id: 'eng-plus', building: 'eng-a', name: '상상파크 플러스 · 코딩라운지', floor: '옥상', theme: 'lab',
    desc: '옥상 정원 옆 코딩라운지예요. 해커톤·프로젝트 팀이 자주 모여요.',
    tables: [
      t('e1', 'study', 'rect', 90, 200, 6, '해커톤 팀 빌딩', 220, 64),
      t('e2', 'study', 'rect', 400, 200, 6, '웹 프로젝트 데일리', 220, 64),
      t('e3', 'meeting', 'rect', 90, 430, 4, '2:2 미팅 · 공대생'),
      t('e4', 'free', 'round', 420, 400, 4, '코드 리뷰 해줄 사람'),
      t('e5', 'free', 'round', 690, 300, 3, '옥상에서 바람 쐬기'),
    ],
  },
  {
    id: 'global-plaza', building: 'mirae', name: '글로벌플라자', floor: '지하 1층', theme: 'plaza',
    desc: '카페와 출력센터가 있는 선큰광장 라운지예요. 도서관 가기 전 들르는 곳이에요.',
    counter: { x: 60, y: 150, w: 220, h: 56, label: '카페 그라찌에' },
    tables: [
      t('g1', 'meeting', 'rect', 380, 200, 6, '3:3 미팅 · 글로벌플라자'),
      t('g2', 'free', 'round', 690, 220, 4, '교환학생 언어교환'),
      t('g3', 'study', 'rect', 100, 430, 4, '시험기간 열람실 메이트'),
      t('g4', 'meal', 'round', 420, 400, 4, '저녁 밥약'),
      t('g5', 'free', 'round', 660, 440, 2, '1:1 커피챗'),
    ],
  },
  {
    id: 'changui-cafe', building: 'changui', name: '학생식당', floor: '지하', theme: 'cafeteria',
    desc: '밥약은 여기서! 학식 같이 먹을 사람을 찾아보세요.',
    counter: { x: 600, y: 150, w: 260, h: 56, label: '오늘의 학식' },
    tables: [
      t('c1', 'meal', 'rect', 90, 210, 4, '학식 같이 먹어요'),
      t('c2', 'meal', 'rect', 340, 210, 4, '돈까스 원정대'),
      t('c3', 'meal', 'rect', 90, 430, 6, '동아리 밥약'),
      t('c4', 'meal', 'round', 400, 400, 4, '혼밥 탈출'),
      t('c5', 'meeting', 'rect', 620, 380, 4, '2:2 미팅 · 밥 먹으면서'),
    ],
  },
];

export const roomById = (id: string): Room | undefined => ROOMS.find((r) => r.id === id);

export const ROOM_DOOR: Pt = { x: ROOM_W / 2, y: ROOM_H - 30 };

export interface SeatPos extends Pt {
  tableId: string;
  idx: number;
}

/** 직사각 탁자는 윗줄·아랫줄, 원형 탁자는 둘레에 의자를 놓는다 */
export function seatsOf(table: RoomTable): SeatPos[] {
  const gap = 30;
  const out: SeatPos[] = [];
  if (table.shape === 'round') {
    const cx = table.x + table.w / 2;
    const cy = table.y + table.h / 2;
    const r = table.w / 2 + gap;
    for (let i = 0; i < table.seats; i++) {
      const a = -Math.PI / 2 + (i * Math.PI * 2) / table.seats;
      out.push({ tableId: table.id, idx: i, x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
    }
    return out;
  }
  const top = Math.ceil(table.seats / 2);
  const bottom = table.seats - top;
  const row = (n: number, y: number, start: number) => {
    for (let i = 0; i < n; i++) {
      out.push({ tableId: table.id, idx: start + i, x: table.x + (table.w * (i + 1)) / (n + 1), y });
    }
  };
  row(top, table.y - gap, 0);
  row(bottom, table.y + table.h + gap, top);
  return out;
}
