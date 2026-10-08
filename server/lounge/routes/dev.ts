import { Router } from 'express';
import type { RequestHandler } from 'express';
import bcrypt from 'bcryptjs';
import { get, isServerless, run } from '../../db.js';
import {
  ADMISSION_YEAR_MIN,
  MEAL_JOIN_POLICY,
  MEAL_SLOT,
  MEAL_PRESET,
  MEETUP_GUEST_SLOT,
  MEETUP_HOST_SLOT,
  MEETUP_JOIN_POLICY,
  MEETUP_PRESETS,
} from '../../../shared/lounge/constants.js';
import type { AvatarColor, AvatarKey } from '../../../shared/lounge/constants.js';
import type { Gathering, GatheringMeta } from '../../../shared/lounge/gathering.js';
import { toKst } from '../../../shared/lounge/format.js';
import { apply, createGathering, isFull, join } from '../domain/gathering.js';
import type { CreateGatheringInput } from '../domain/gathering.js';
import { findGathering, insertGathering } from '../repo/gatherings.js';
import { openRoomIfNeeded } from '../services/chat.js';
import { handler } from '../http.js';
import { currentYearKst } from '../services/profile.js';

/**
 * 개발용 시드: POST /api/lounge/dev/seed — 데모 사용자 8명 + 프로필 + 샘플 모임을 만든다.
 * 규칙: docs/lounge/01-contract.md §9
 *
 * 운영에서는 절대 열리지 않는다. 두 겹으로 막는다.
 *   1) server/lounge/index.ts 가 `LOUNGE_DEV_SEED=1` 이고 NODE_ENV≠production 이고 서버리스가 아닐 때만 이 라우터를 마운트한다.
 *   2) 이 라우터 안에서도 요청마다 같은 조건을 다시 확인한다 (누가 다른 곳에 마운트해도 404).
 * 로그인 없이 부를 수 있다(시연 DB 를 처음 채우는 용도). 멱등이라 여러 번 불러도 같은 결과다.
 */
export const devRouter = Router();

/** 데모 계정 공통 비밀번호. 개발 DB 에서만 만들어지고, 응답의 `password` 로 알려 준다. */
export const DEMO_PASSWORD = 'Demo1234!';

export const devSeedEnabled = (): boolean =>
  process.env.LOUNGE_DEV_SEED === '1' && process.env.NODE_ENV !== 'production' && !isServerless;

const onlyInDev: RequestHandler = (_req, res, next) => {
  if (!devSeedEnabled()) {
    res.status(404).json({ error: '요청한 API를 찾을 수 없습니다.' });
    return;
  }
  next();
};

// ───────────── 시드 데이터 (순수) ─────────────

export type DemoUser = {
  email: string;
  name: string;
  nickname: string;
  college: string;
  department: string;
  /** 올해에서 몇 년 전에 입학했는가 (해가 바뀌어도 입학년도가 미래가 되지 않게 상대값으로 둔다) */
  yearsAgo: number;
  avatar: AvatarKey;
  avatarColor: AvatarColor;
  temperature: number;
};

/**
 * 1번과 2번은 같은 학과다 — "같은 학과 제외" 미팅과 "같은 과만" 밥약을 눈으로 확인할 수 있게.
 * 단과대·학년·온도도 일부러 고르게 흩었다.
 */
export const DEMO_USERS: DemoUser[] = [
  { email: 'demo1@hansung.ac.kr', name: '데모1', nickname: '하늘', college: 'IT공과대학', department: '컴퓨터공학부', yearsAgo: 0, avatar: 'turtle-smile', avatarColor: 'm1', temperature: 36.5 },
  { email: 'demo2@hansung.ac.kr', name: '데모2', nickname: '보리', college: 'IT공과대학', department: '컴퓨터공학부', yearsAgo: 1, avatar: 'turtle-laugh', avatarColor: 'm2', temperature: 37.4 },
  { email: 'demo3@hansung.ac.kr', name: '데모3', nickname: '모찌', college: '사회과학대학', department: '경영학부', yearsAgo: 1, avatar: 'cat-surprised', avatarColor: 'm3', temperature: 39.1 },
  { email: 'demo4@hansung.ac.kr', name: '데모4', nickname: '도토리', college: '디자인대학', department: '패션디자인트랙', yearsAgo: 2, avatar: 'cat-think', avatarColor: 'm4', temperature: 36.5 },
  { email: 'demo5@hansung.ac.kr', name: '데모5', nickname: '구름', college: '크리에이티브인문예술대학', department: '영미문화콘텐츠트랙', yearsAgo: 1, avatar: 'turtle-cool', avatarColor: 'm5', temperature: 41 },
  { email: 'demo6@hansung.ac.kr', name: '데모6', nickname: '콩이', college: '미래융합사회과학대학', department: '융합행정학부', yearsAgo: 3, avatar: 'frog-tongue', avatarColor: 'm6', temperature: 35.2 },
  { email: 'demo7@hansung.ac.kr', name: '데모7', nickname: '새봄', college: 'IT공과대학', department: 'AI응용학과', yearsAgo: 2, avatar: 'chick-love', avatarColor: 'm7', temperature: 38 },
  { email: 'demo8@hansung.ac.kr', name: '데모8', nickname: '다람', college: '디자인대학', department: '인터랙션디자인트랙', yearsAgo: 0, avatar: 'turtle-shy', avatarColor: 'm8', temperature: 36.5 },
];

export const demoAdmissionYear = (u: DemoUser, now: Date): number =>
  Math.max(ADMISSION_YEAR_MIN, currentYearKst(now) - u.yearsAgo);

/** 오늘(KST)에서 `dayOffset` 일 뒤 `hh:mm`(KST) 의 ISO 시각 */
export function kstTime(now: Date, dayOffset: number, hh: number, mm = 0): string {
  const [y, m, d] = toKst(now).date.split('-').map(Number);
  const day = new Date(Date.UTC(y, m - 1, d + dayOffset)).toISOString().slice(0, 10);
  const pad = (n: number) => String(n).padStart(2, '0');
  return new Date(`${day}T${pad(hh)}:${pad(mm)}:00+09:00`).toISOString();
}

const hoursBefore = (iso: string, h: number): string => new Date(new Date(iso).getTime() - h * 3600_000).toISOString();

type Participant = { user: number; slot: string };

/** 만들 모임 한 개의 설계. user 는 DEMO_USERS 의 인덱스(0부터). */
type SamplePlan = {
  id: string;
  host: number;
  title: string;
  body: string;
  place: string;
  kind: 'meetup' | 'meal';
  slots: CreateGatheringInput['slots'];
  joinPolicy: CreateGatheringInput['joinPolicy'];
  hostSlotKey?: string;
  meta: GatheringMeta;
  day: number;
  hour: number;
  minute?: number;
  deadlineHoursBefore: number;
  /** 선착순으로 앉는 사람 (미팅) */
  seated?: Participant[];
  /** 승인 대기 신청 (밥약) */
  applicants?: { user: number; slot: string; message: string }[];
};

/** 모임 id 는 고정(`demo-…`)이다: 다시 불러도 같은 모임을 찾아 건너뛸 수 있다. */
export const SAMPLE_PLANS: SamplePlan[] = [
  {
    id: 'demo-meetup-open-a',
    host: 0,
    kind: 'meetup',
    title: '저녁에 가볍게 2:2 미팅해요',
    body: '밥 먹고 근처에서 한 시간 정도 이야기해요. 편하게 오세요.',
    place: '학교 정문 앞 카페',
    slots: MEETUP_PRESETS['2:2'].slots,
    joinPolicy: MEETUP_JOIN_POLICY,
    hostSlotKey: MEETUP_HOST_SLOT,
    meta: { tags: ['2:2'], excludeSameDept: true },
    day: 1,
    hour: 19,
    deadlineHoursBefore: 3,
  },
  {
    id: 'demo-meetup-open-b',
    host: 2,
    kind: 'meetup',
    title: '2:2 미팅, 한 자리만 남았어요',
    body: '세 명 모였어요. 상대 쪽 한 분만 오시면 바로 시작해요.',
    place: '혜화동 로터리 근처',
    slots: MEETUP_PRESETS['2:2'].slots,
    joinPolicy: MEETUP_JOIN_POLICY,
    hostSlotKey: MEETUP_HOST_SLOT,
    meta: { tags: ['2:2'] },
    day: 2,
    hour: 18,
    minute: 30,
    deadlineHoursBefore: 3,
    seated: [
      { user: 3, slot: MEETUP_HOST_SLOT },
      { user: 4, slot: MEETUP_GUEST_SLOT },
    ],
  },
  {
    id: 'demo-meetup-full',
    host: 5,
    kind: 'meetup',
    title: '정원이 막 찬 2:2 미팅',
    body: '자리가 다 찼어요. 단톡방에서 시간과 장소를 정해요.',
    place: '성북천 산책로 입구',
    slots: MEETUP_PRESETS['2:2'].slots,
    joinPolicy: MEETUP_JOIN_POLICY,
    hostSlotKey: MEETUP_HOST_SLOT,
    meta: { tags: ['2:2'] },
    day: 3,
    hour: 20,
    deadlineHoursBefore: 3,
    seated: [
      { user: 6, slot: MEETUP_HOST_SLOT },
      { user: 7, slot: MEETUP_GUEST_SLOT },
      { user: 0, slot: MEETUP_GUEST_SLOT },
    ],
  },
  {
    id: 'demo-meal-a',
    host: 1,
    kind: 'meal',
    title: '내일 점심 학식 같이 먹어요',
    body: '수업 끝나고 12시에 학생식당에서 만나요. 혼자 먹기 심심해서요.',
    place: '학생식당',
    slots: MEAL_PRESET(3).slots,
    joinPolicy: MEAL_JOIN_POLICY,
    meta: { placeType: '학식', menu: '한식', tags: ['수다 환영', '동기끼리'] },
    day: 1,
    hour: 12,
    deadlineHoursBefore: 1,
    applicants: [{ user: 4, slot: MEAL_SLOT, message: '같이 먹고 싶어요!' }],
  },
  {
    id: 'demo-meal-b',
    host: 3,
    kind: 'meal',
    title: '저녁 분식 한 끼 하실 분',
    body: '떡볶이랑 순대 먹을 건데 두 명이서 나눠 먹어요.',
    place: '학교 앞 분식집',
    slots: MEAL_PRESET(2).slots,
    joinPolicy: MEAL_JOIN_POLICY,
    meta: { placeType: '학교 주변', menu: '분식', tags: ['조용히 먹기'] },
    day: 1,
    hour: 18,
    deadlineHoursBefore: 1,
  },
];

/**
 * 계획 → 완성된 모임 문서. 도메인 함수(createGathering/join/apply)로 만들어서 운영 코드와 같은 규칙을 지킨다 —
 * 시드가 규칙을 우회한 문서를 만들면 시연 중에 규칙을 어기는 상태가 보이기 때문이다.
 * `userIds[i]` 는 DEMO_USERS[i] 의 DB id. 순수 함수라 DB 없이 테스트한다.
 */
export function buildSampleGatherings(userIds: string[], now: Date): Gathering[] {
  const nowIso = now.toISOString();
  return SAMPLE_PLANS.map((plan) => {
    const meetAt = kstTime(now, plan.day, plan.hour, plan.minute ?? 0);
    const created = createGathering(
      {
        id: plan.id,
        hostId: userIds[plan.host],
        kind: plan.kind,
        title: plan.title,
        body: plan.body,
        place: plan.place,
        meetAt,
        joinDeadline: hoursBefore(meetAt, plan.deadlineHoursBefore),
        joinPolicy: plan.joinPolicy,
        slots: plan.slots,
        hostSlotKey: plan.hostSlotKey,
        meta: plan.meta,
      },
      nowIso,
    );
    if (!created.ok) throw new Error(`[dev-seed] ${plan.id}: ${created.error.message}`);
    let g = created.value;

    for (const p of plan.seated ?? []) {
      const joined = join(g, { id: userIds[p.user], banned: false, warnings: 0 }, p.slot, nowIso);
      if (!joined.ok) throw new Error(`[dev-seed] ${plan.id}: ${joined.error.message}`);
      g = joined.value;
    }
    for (const a of plan.applicants ?? []) {
      const applied = apply(g, { id: userIds[a.user], banned: false, warnings: 0 }, a.slot, a.message, nowIso);
      if (!applied.ok) throw new Error(`[dev-seed] ${plan.id}: ${applied.error.message}`);
      g = applied.value;
    }
    return g;
  });
}

// ───────────── 실행 (DB) ─────────────

export type SeedResponse = {
  /** 데모 계정 공통 비밀번호 */
  password: string;
  users: { id: string; email: string; nickname: string; created: boolean }[];
  gatherings: { id: string; kind: string; title: string; created: boolean }[];
};

/** 데모 사용자 한 명. 이미 있으면 건드리지 않고 id 만 돌려준다. */
async function ensureUser(u: DemoUser, passwordHash: string, now: Date): Promise<{ id: string; created: boolean }> {
  const inserted = await get<{ id: number }>(
    // 로그인 아이디는 이메일의 앞부분(demo1). 이메일·아이디 어느 쪽이 겹쳐도 건드리지 않는다.
    `INSERT INTO users (email, username, name, password_hash, nickname, college, department, admission_year,
                        avatar, avatar_color, temperature, profile_done)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, TRUE)
     ON CONFLICT DO NOTHING
     RETURNING id`,
    [u.email, u.email.split('@')[0].toLowerCase(), u.name, passwordHash, u.nickname, u.college, u.department, demoAdmissionYear(u, now), u.avatar, u.avatarColor, u.temperature],
  );
  if (inserted) return { id: String(inserted.id), created: true };
  const existing = await get<{ id: number }>('SELECT id FROM users WHERE email = ?', [u.email]);
  if (!existing) throw new Error(`[dev-seed] ${u.email} 를 만들지도 찾지도 못했습니다.`);
  return { id: String(existing.id), created: false };
}

let running: Promise<SeedResponse> | null = null;

/** 동시에 두 번 불려도 한 번만 돌린다 (같은 id 모임을 둘이 넣다 충돌하지 않게) */
export function seedDemo(now: Date = new Date()): Promise<SeedResponse> {
  if (!running) {
    running = runSeed(now).finally(() => {
      running = null;
    });
  }
  return running;
}

async function runSeed(now: Date): Promise<SeedResponse> {
  const passwordHash = bcrypt.hashSync(DEMO_PASSWORD, 10);
  const users: SeedResponse['users'] = [];
  for (const u of DEMO_USERS) {
    const r = await ensureUser(u, passwordHash, now);
    users.push({ id: r.id, email: u.email, nickname: u.nickname, created: r.created });
  }

  const nowIso = now.toISOString();
  const gatherings: SeedResponse['gatherings'] = [];
  for (const g of buildSampleGatherings(users.map((u) => u.id), now)) {
    const existing = await findGathering(g.id);
    // 아직 지나지 않은 샘플은 그대로 둔다(멱등). 날짜가 지난 샘플만 새 날짜로 다시 만든다 — 안 그러면 며칠 뒤 라운지가 텅 빈다.
    if (existing && existing.meetAt > nowIso) {
      gatherings.push({ id: g.id, kind: g.kind, title: g.title, created: false });
      continue;
    }
    if (existing) {
      await run('DELETE FROM lounge_messages WHERE room_id = ?', [g.id]);
      await run('DELETE FROM lounge_gatherings WHERE id = ?', [g.id]);
    }
    await insertGathering(g);
    // 정원이 찬 모임은 단톡방이 열린 상태여야 한다 (멱등 — 메시지가 이미 있으면 아무것도 하지 않는다)
    if (isFull(g)) await openRoomIfNeeded(g.id);
    gatherings.push({ id: g.id, kind: g.kind, title: g.title, created: true });
  }
  return { password: DEMO_PASSWORD, users, gatherings };
}

devRouter.use(onlyInDev);

devRouter.post(
  '/seed',
  handler(async (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json(await seedDemo());
  }),
);
