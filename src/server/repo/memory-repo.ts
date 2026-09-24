/**
 * 인메모리 구현 + 시연용 시드 데이터. (담당: 한승원)
 *
 * 서버를 재시작하면 데이터가 초기화된다. 공모전 시연/발표에는 이게 오히려 편하고,
 * 실제 배포 때는 이 파일 대신 supabase-repo.ts 를 만들어 끼우면 된다.
 */
import { asGatheringId, asUserId, type GatheringId, type UserId } from '@/shared/types';
import type { User } from '@/shared/user';
import { DEFAULT_TEMPERATURE } from '@/domain/reputation/reputation';
import type { Gathering } from '@/domain/gathering';
import { createGathering } from '@/domain/gathering';
import { MEETUP_PRESETS } from '@/features/meetup/preset';
import { MEAL_PRESET } from '@/features/mealdate/preset';
import type { Block, Report } from '@/domain/safety/safety';
import type { QuickRequest, QuickRoom } from '@/features/mealdate/quick-match';
import type { GatheringRepo, QuickMatchRepo, SafetyRepo, UserRepo } from './gathering-repo';

type Store = {
  users: Map<string, User>;
  gatherings: Map<string, Gathering>;
  blocks: Block[];
  reports: Map<string, Report>;
  quickRequests: Map<string, QuickRequest>;
  quickRooms: Map<string, QuickRoom>;
};

// Next.js dev 서버는 파일이 바뀔 때마다 모듈을 새로 불러오므로,
// globalThis에 붙여두지 않으면 코드 한 줄 고칠 때마다 데이터가 날아간다.
const globalStore = globalThis as unknown as { __booke?: Store };

function getStore(): Store {
  if (!globalStore.__booke) {
    globalStore.__booke = seed();
  }
  return globalStore.__booke;
}

export const gatheringRepo: GatheringRepo = {
  async list(kind) {
    const all = [...getStore().gatherings.values()];
    const filtered = kind ? all.filter((g) => g.kind === kind) : all;
    // 최신 글이 위로 (카톡 피드 느낌)
    return filtered.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  },
  async find(id) {
    return getStore().gatherings.get(id) ?? null;
  },
  async save(gathering) {
    getStore().gatherings.set(gathering.id, gathering);
  },
  async listByUser(userId) {
    return [...getStore().gatherings.values()].filter(
      (g) => g.hostId === userId || g.slots.some((s) => s.memberIds.includes(userId)),
    );
  },
};

export const safetyRepo: SafetyRepo = {
  async listBlocks() {
    return [...getStore().blocks];
  },
  async saveBlock(block) {
    const s = getStore();
    if (!s.blocks.some((b) => b.blockerId === block.blockerId && b.blockedId === block.blockedId)) {
      s.blocks.push(block);
    }
  },
  async removeBlock(blockerId, blockedId) {
    const s = getStore();
    s.blocks = s.blocks.filter((b) => !(b.blockerId === blockerId && b.blockedId === blockedId));
  },
  async listReports() {
    return [...getStore().reports.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  },
  async saveReport(report) {
    getStore().reports.set(report.id, report);
  },
};

export const quickMatchRepo: QuickMatchRepo = {
  async listRequests() {
    return [...getStore().quickRequests.values()];
  },
  async saveRequest(request) {
    getStore().quickRequests.set(request.id, request);
  },
  async listRooms() {
    return [...getStore().quickRooms.values()];
  },
  async findRoom(id) {
    return getStore().quickRooms.get(id) ?? null;
  },
  async saveRoom(room) {
    getStore().quickRooms.set(room.id, room);
  },
};

export const userRepo: UserRepo = {
  async list() {
    return [...getStore().users.values()];
  },
  async find(id) {
    return getStore().users.get(id) ?? null;
  },
  async save(user) {
    getStore().users.set(user.id, user);
  },
};

// ---------- 시드 ----------

const hoursFromNow = (h: number) => new Date(Date.now() + h * 3600_000).toISOString();

function makeUser(
  id: string,
  nickname: string,
  college: User['college'],
  department: string,
  admissionYear: number,
  reputation: Partial<Pick<User, 'temperature' | 'warnings' | 'banned'>> = {},
): User {
  return {
    id: asUserId(id),
    nickname,
    college,
    department,
    admissionYear,
    verified: true,
    temperature: DEFAULT_TEMPERATURE,
    warnings: 0,
    banned: false,
    ...reputation,
    createdAt: new Date('2026-03-02').toISOString(),
  };
}

const SEED_USERS: User[] = [
  // 시연용 관리자. 관리자 탭(/admin)은 이 계정으로만 열린다.
  { ...makeUser('u1', '승원', 'IT공과대학', '컴퓨터공학부', 2026), role: 'admin' },
  makeUser('u2', '지민', '디자인대학', '시각디자인전공', 2025),
  makeUser('u3', '태현', '사회과학대학', '사회복지학과', 2024),
  makeUser('u4', '수빈', '크리에이티브인문예술대학', '한국어문학부', 2026),
  makeUser('u5', '현우', 'IT공과대학', '컴퓨터공학부', 2025),
  // 노쇼 경고가 2번 쌓여 이용이 정지된 계정. 참여를 시도하면 막히는 걸 시연할 수 있다.
  makeUser('u6', '노쇼왕', '미래융합사회과학대학', '융합행정학과', 2024, {
    temperature: 21.5,
    warnings: 2,
    banned: true,
  }),
];

function seed(): Store {
  const users = new Map(SEED_USERS.map((u) => [u.id as string, u]));
  const gatherings = new Map<string, Gathering>();
  const now = new Date().toISOString();

  const drafts = [
    {
      id: 'g1',
      hostId: 'u1',
      preset: MEETUP_PRESETS['2:2'],
      title: '금요일 저녁 2:2 미팅 하실 분',
      body: '삼선교 쪽에서 가볍게 저녁 먹어요. 부담 없이 오세요!',
      place: '삼선교 먹자골목',
      meetInHours: 30,
    },
    {
      id: 'g2',
      hostId: 'u2',
      preset: MEETUP_PRESETS['3:3'],
      title: '축제 전날 3:3 미팅 🎉',
      body: '축제 같이 갈 사람 미리 만들어 두려고요. 단과대 안 겹치면 더 좋아요.',
      place: '한성대입구역 2번 출구',
      meetInHours: 54,
    },
  ];

  for (const d of drafts) {
    const created = createGathering(
      {
        id: asGatheringId(d.id),
        kind: 'meetup',
        hostId: asUserId(d.hostId),
        title: d.title,
        body: d.body,
        place: d.place,
        meetAt: hoursFromNow(d.meetInHours),
        joinDeadline: hoursFromNow(d.meetInHours - 6),
        joinPolicy: 'auto',
        slots: d.preset.slots,
      },
      now,
    );
    if (created.ok) gatherings.set(d.id, created.value);
  }

  const meals = [
    {
      id: 'g3',
      hostId: 'u3',
      title: '오늘 점심 학식 같이 드실 분',
      body: '혼밥하기 싫어서요 ㅠㅠ 12시에 상상관 앞에서 만나요.',
      place: '상상관 학생식당',
      capacity: 4,
      meetInHours: 3,
    },
    {
      id: 'g4',
      hostId: 'u4',
      title: '공강에 카페 가서 과제할 사람',
      body: '3교시 공강인데 같이 과제하면서 커피 마셔요. 조용한 사람 환영.',
      place: '학교 앞 투썸',
      capacity: 3,
      meetInHours: 6,
    },
  ];

  for (const m of meals) {
    const created = createGathering(
      {
        id: asGatheringId(m.id),
        kind: 'meal',
        hostId: asUserId(m.hostId),
        title: m.title,
        body: m.body,
        place: m.place,
        meetAt: hoursFromNow(m.meetInHours),
        joinDeadline: hoursFromNow(Math.max(m.meetInHours - 1, 0.5)),
        joinPolicy: 'approval',
        slots: MEAL_PRESET(m.capacity).slots,
      },
      now,
    );
    if (created.ok) gatherings.set(m.id, created.value);
  }

  return {
    users,
    gatherings,
    blocks: [],
    reports: new Map(),
    quickRequests: new Map(),
    quickRooms: new Map(),
  };
}

export const DEFAULT_USER_ID: UserId = asUserId('u1');
export type { GatheringId };
