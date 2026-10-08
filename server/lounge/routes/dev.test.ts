import { afterEach, describe, expect, it, vi } from 'vitest';
import { COLLEGES, AVATARS, AVATAR_COLORS } from '../../../shared/lounge/constants.js';
import { currentStatus, isFull, memberIds, totalSeatsLeft } from '../domain/gathering.js';
import { validateProfileInput } from '../services/profile.js';
import {
  DEMO_PASSWORD,
  DEMO_USERS,
  SAMPLE_PLANS,
  buildSampleGatherings,
  demoAdmissionYear,
  devRouter,
  devSeedEnabled,
  kstTime,
} from './dev.js';

const NOW = new Date('2026-10-08T05:00:00Z'); // KST 목 14:00
const IDS = DEMO_USERS.map((_, i) => String(100 + i));

describe('kstTime', () => {
  it('KST 기준으로 며칠 뒤 몇 시인지 ISO(UTC) 로', () => {
    expect(kstTime(NOW, 1, 19)).toBe('2026-10-09T10:00:00.000Z'); // 금 19:00 KST
    expect(kstTime(NOW, 2, 18, 30)).toBe('2026-10-10T09:30:00.000Z');
  });

  it('UTC 날짜와 KST 날짜가 다른 시각에도 KST 날짜를 기준으로 센다', () => {
    const lateUtc = new Date('2026-10-08T16:00:00Z'); // KST 10-09 01:00
    expect(kstTime(lateUtc, 1, 12)).toBe('2026-10-10T03:00:00.000Z'); // 10-10 12:00 KST
  });

  it('월말·연말을 넘겨도 날짜가 맞다', () => {
    const endOfYear = new Date('2026-12-30T05:00:00Z');
    expect(kstTime(endOfYear, 3, 20)).toBe('2027-01-02T11:00:00.000Z');
  });
});

describe('DEMO_USERS', () => {
  it('8명, 이메일·닉네임이 서로 다르다', () => {
    expect(DEMO_USERS).toHaveLength(8);
    expect(DEMO_USERS.map((u, i) => u.email)).toEqual(Array.from({ length: 8 }, (_, i) => `demo${i + 1}@hansung.ac.kr`));
    expect(new Set(DEMO_USERS.map((u) => u.nickname)).size).toBe(8);
  });

  it('모든 프로필이 PUT /me 와 같은 검증을 통과한다', () => {
    for (const u of DEMO_USERS) {
      const r = validateProfileInput(
        {
          nickname: u.nickname,
          college: u.college,
          department: u.department,
          admissionYear: demoAdmissionYear(u, NOW),
          avatar: u.avatar,
          avatarColor: u.avatarColor,
        },
        NOW,
      );
      expect(r.ok, u.email).toBe(true);
    }
  });

  it('단과대·아바타·색·학번이 고르게 흩어져 있고 같은 학과 쌍이 있다', () => {
    expect(new Set(DEMO_USERS.map((u) => u.college)).size).toBeGreaterThanOrEqual(4);
    expect(new Set(DEMO_USERS.map((u) => u.avatar)).size).toBe(8);
    expect(DEMO_USERS.every((u) => (COLLEGES as readonly string[]).includes(u.college))).toBe(true);
    expect(DEMO_USERS.every((u) => AVATARS.some((a) => a.key === u.avatar))).toBe(true);
    expect(DEMO_USERS.every((u) => (AVATAR_COLORS as readonly string[]).includes(u.avatarColor))).toBe(true);
    expect(new Set(DEMO_USERS.map((u) => demoAdmissionYear(u, NOW))).size).toBeGreaterThanOrEqual(3);
    const depts = DEMO_USERS.map((u) => u.department);
    expect(depts.length - new Set(depts).size).toBeGreaterThanOrEqual(1);
  });

  it('해가 바뀌어도 입학년도가 미래가 되지 않고, 하한 아래로도 내려가지 않는다', () => {
    const jan1 = new Date('2025-12-31T15:00:00Z'); // KST 2026-01-01
    for (const u of DEMO_USERS) {
      expect(demoAdmissionYear(u, jan1)).toBeLessThanOrEqual(2026);
      expect(demoAdmissionYear(u, new Date('2016-01-01T00:00:00Z'))).toBeGreaterThanOrEqual(2015);
    }
  });

  it('비밀번호 상수는 8자 이상 (가입 규칙과 같은 최소 길이)', () => {
    expect(DEMO_PASSWORD.length).toBeGreaterThanOrEqual(8);
  });
});

describe('buildSampleGatherings — 샘플 모임 구성', () => {
  const list = buildSampleGatherings(IDS, NOW);
  const byId = Object.fromEntries(list.map((g) => [g.id, g]));
  const nowIso = NOW.toISOString();

  it('미팅 3개(열림 2 + 정원 참 1) · 밥약 2개, id 는 고정', () => {
    expect(list.map((g) => g.id)).toEqual(SAMPLE_PLANS.map((p) => p.id));
    expect(list.filter((g) => g.kind === 'meetup')).toHaveLength(3);
    expect(list.filter((g) => g.kind === 'meal')).toHaveLength(2);
    expect(new Set(list.map((g) => g.id)).size).toBe(list.length);
  });

  it('열린 2:2 미팅 두 개 — 하나는 정확히 한 자리만 남았다', () => {
    const a = byId['demo-meetup-open-a'];
    const b = byId['demo-meetup-open-b'];
    expect(currentStatus(a, nowIso)).toBe('open');
    expect(currentStatus(b, nowIso)).toBe('open');
    expect(a.slots.map((s) => s.capacity)).toEqual([2, 2]);
    expect(totalSeatsLeft(b)).toBe(1);
    expect(totalSeatsLeft(a)).toBeGreaterThan(1);
  });

  it('정원이 찬 미팅은 full 이고 참여자는 4명 모두 다른 사람', () => {
    const g = byId['demo-meetup-full'];
    expect(isFull(g)).toBe(true);
    expect(currentStatus(g, nowIso)).toBe('full');
    const ids = memberIds(g);
    expect(ids).toHaveLength(4);
    expect(new Set(ids).size).toBe(4);
  });

  it('밥약은 승인제이고 하나는 승인 대기 신청이 있다', () => {
    const meals = list.filter((g) => g.kind === 'meal');
    expect(meals.every((g) => g.joinPolicy === 'approval')).toBe(true);
    expect(meals.some((g) => g.applicants.length > 0)).toBe(true);
    // 신청자는 자리를 차지하지 않는다 (주최자 한 명만 앉아 있다)
    expect(memberIds(byId['demo-meal-a'])).toEqual([IDS[1]]);
  });

  it('한 사람이 한 모임에 두 번 앉지 않는다', () => {
    for (const g of list) {
      const ids = memberIds(g);
      expect(new Set(ids).size, g.id).toBe(ids.length);
    }
  });

  it('모든 모임은 미래이고 마감 ≤ 만나는 시각, 계약의 길이 제한 안', () => {
    for (const g of list) {
      expect(g.meetAt > nowIso, g.id).toBe(true);
      expect(g.joinDeadline <= g.meetAt, g.id).toBe(true);
      expect(g.title.length).toBeGreaterThanOrEqual(1);
      expect(g.title.length).toBeLessThanOrEqual(60);
      expect(g.body.length).toBeLessThanOrEqual(300);
      expect(g.place.length).toBeGreaterThanOrEqual(1);
      expect(g.place.length).toBeLessThanOrEqual(40);
      expect(g.meta.tags?.length ?? 0).toBeLessThanOrEqual(6);
    }
  });

  it('"같은 학과 제외" 미팅의 참여자 중에 주최자와 같은 학과가 없다', () => {
    const dept = (id: string) => DEMO_USERS[IDS.indexOf(id)].department;
    for (const g of list.filter((x) => x.meta.excludeSameDept)) {
      const others = memberIds(g).filter((id) => id !== g.hostId);
      expect(others.every((id) => dept(id) !== dept(g.hostId)), g.id).toBe(true);
    }
  });

  it('호출할 때마다 같은 설계의 모임이 나온다 (id·자리 구성)', () => {
    const again = buildSampleGatherings(IDS, NOW);
    expect(again.map((g) => [g.id, g.slots.map((s) => s.memberIds)])).toEqual(
      list.map((g) => [g.id, g.slots.map((s) => s.memberIds)]),
    );
  });
});

describe('devSeedEnabled — 운영에서는 닫혀 있다', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('LOUNGE_DEV_SEED=1 이고 NODE_ENV 가 production 이 아닐 때만 열린다', () => {
    vi.stubEnv('LOUNGE_DEV_SEED', '1');
    vi.stubEnv('NODE_ENV', 'development');
    expect(devSeedEnabled()).toBe(true);

    vi.stubEnv('NODE_ENV', 'production');
    expect(devSeedEnabled()).toBe(false);

    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('LOUNGE_DEV_SEED', '');
    expect(devSeedEnabled()).toBe(false);
    vi.stubEnv('LOUNGE_DEV_SEED', 'true'); // 정확히 '1' 만
    expect(devSeedEnabled()).toBe(false);
    vi.stubEnv('LOUNGE_DEV_SEED', '0');
    expect(devSeedEnabled()).toBe(false);
  });
});

describe('devRouter 자체 방어선 — 어디에 마운트돼도 조건이 안 맞으면 404', () => {
  afterEach(() => vi.unstubAllEnvs());

  /** 임시 포트에 devRouter 만 올려 실제 HTTP 로 부른다 (DB 는 열리지 않는다 — 404 는 핸들러 앞에서 끝난다) */
  async function postSeed(): Promise<{ status: number; body: unknown }> {
    const { default: express } = await import('express');
    const { createServer } = await import('node:http');
    const app = express();
    app.use('/dev', devRouter);
    const server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const { port } = server.address() as { port: number };
      const res = await fetch(`http://127.0.0.1:${port}/dev/seed`, { method: 'POST' });
      return { status: res.status, body: await res.json() };
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }

  it('NODE_ENV=production 이면 LOUNGE_DEV_SEED=1 이어도 404', async () => {
    vi.stubEnv('LOUNGE_DEV_SEED', '1');
    vi.stubEnv('NODE_ENV', 'production');
    const r = await postSeed();
    expect(r.status).toBe(404);
    expect(JSON.stringify(r.body)).not.toContain('password');
  });

  it('LOUNGE_DEV_SEED 가 없으면 404', async () => {
    vi.stubEnv('LOUNGE_DEV_SEED', '');
    vi.stubEnv('NODE_ENV', 'development');
    expect((await postSeed()).status).toBe(404);
  });
});
