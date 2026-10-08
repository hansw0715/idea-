/**
 * 학과 변경 제한 DB 통합 테스트 — 임시 PGlite DB 에서 실제 SQL 을 돌린다. (개발 서버 DB 와 절대 겹치지 않는다)
 *
 * 고치는 문제: 학과는 어떤 응답에도 안 나오고 "같은 학과 제외" 미팅의 참여 가능 여부로만 비교에 쓰이는데,
 * 학과를 제한 없이 바꿀 수 있으면 후보 학과를 넣어 보고 blockedReason 이 나오는지 보는 것만으로
 * 주최자·참여자의 학과를 알아낼 수 있었다. 아래 테스트는 그 탐색이 더는 안 된다는 것을 지킨다.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { get, ready, run } from '../../db.js';
import { MEETUP_PRESETS } from '../../../shared/lounge/constants.js';
import type { CreateGatheringBody } from '../../../shared/lounge/gathering.js';
import { findUser } from '../users.js';
import type { LoungeUser } from '../users.js';
import { createGathering, getGatheringView } from './gathering.js';
import { DEPARTMENT_CHANGE_COOLDOWN_DAYS, saveProfile } from './profile.js';

let tmp: string;

beforeAll(async () => {
  // 원격 DB 로 새지 않게: 환경에 DATABASE_URL 이 있어도 지우고 임시 PGlite 만 쓴다.
  delete process.env.DATABASE_URL;
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 's2-profile-dept-'));
  process.env.DATA_DIR = tmp;
  process.env.ADMIN_PASSWORD = 'test-admin-password';
  await ready();
}, 120_000);

afterAll(() => {
  // Windows 에서는 PGlite 가 파일을 쥐고 있어 지우지 못할 수 있다 — 임시 폴더라 무시한다.
  try {
    fs.rmSync(tmp, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

const DAY = 86_400_000;
const NOW = new Date('2026-10-08T05:00:00Z');
const later = (days: number, from = NOW) => new Date(from.getTime() + days * DAY);

let seq = 0;

/** 이메일 인증 없이 users 에 바로 넣는다. department 가 있으면 "예전에 만든 프로필"(변경 시각 없음)이다. */
async function addUser(opts: { department?: string | null; profile?: boolean } = {}): Promise<LoungeUser> {
  seq += 1;
  const profile = opts.profile ?? opts.department !== undefined;
  const row = await get<{ id: number }>(
    `INSERT INTO users (email, name, password_hash, nickname, college, department, admission_year,
                        avatar, avatar_color, profile_done)
     VALUES (?, ?, 'x', ?, 'IT공과대학', ?, 2024, 'cat', 'm2', ?) RETURNING id`,
    [`dept${seq}@hansung.ac.kr`, `실명${seq}`, `닉${seq}`, opts.department ?? null, profile],
  );
  const u = await findUser(row!.id);
  if (!u) throw new Error('사용자를 만들지 못했습니다.');
  return u;
}

const body = (department: string, over: Record<string, unknown> = {}) => ({
  nickname: '하늘',
  college: 'IT공과대학',
  department,
  admissionYear: 2024,
  avatar: 'bear',
  avatarColor: 'm1',
  ...over,
});

type Stored = { department: string | null; changed_at: Date | string | null; nickname: string | null };
const stored = async (id: string): Promise<Stored> =>
  (await get<Stored>('SELECT department, department_changed_at AS changed_at, nickname FROM users WHERE id = ?', [Number(id)]))!;
const changedAtMs = (s: Stored): number | null => (s.changed_at === null ? null : new Date(s.changed_at).getTime());

const codeOf = (r: Awaited<ReturnType<typeof saveProfile>>) => (r.ok ? 'OK' : r.error.code);

describe('학과 변경 제한 — 처음 정하기와 고치기', () => {
  it('처음 정하면 그 시각이 기록되고, 같은 학과로 다른 항목만 고치는 것은 언제든 된다', async () => {
    const u = await addUser({ profile: false });
    expect(codeOf(await saveProfile(u.id, body('컴퓨터공학부'), NOW))).toBe('OK');
    const first = await stored(u.id);
    expect(first.department).toBe('컴퓨터공학부');
    expect(changedAtMs(first)).toBe(NOW.getTime());

    // 닉네임·아바타만 여러 번 고쳐도 학과 기록은 그대로 (학과 때문에 프로필 수정이 막히면 안 된다)
    for (const [i, nickname] of ['보리', '모찌', '구름'].entries()) {
      const r = await saveProfile(u.id, body('컴퓨터공학부', { nickname, avatar: 'owl' }), later(i + 1));
      expect(codeOf(r)).toBe('OK');
    }
    const after = await stored(u.id);
    expect(after.nickname).toBe('구름');
    expect(changedAtMs(after)).toBe(NOW.getTime());
  });

  it('공백·조합형 표기만 다른 같은 학과는 "바꾼 것"으로 치지 않는다', async () => {
    const u = await addUser({ profile: false });
    await saveProfile(u.id, body('컴퓨터공학부'), NOW);
    const r = await saveProfile(u.id, body('  컴퓨터공학부 '.normalize('NFD'), { nickname: '다른닉' }), later(2));
    expect(codeOf(r)).toBe('OK');
    expect(changedAtMs(await stored(u.id))).toBe(NOW.getTime());
  });
});

describe('학과 변경 제한 — 30일 잠금 (학과 탐색 방지)', () => {
  it('정한 뒤 30일 안에 다른 학과로 바꾸려 하면 FORBIDDEN 이고, 학과·기록·다른 항목 모두 그대로다', async () => {
    const u = await addUser({ profile: false });
    await saveProfile(u.id, body('경영학부'), NOW);

    const r = await saveProfile(u.id, body('컴퓨터공학부', { nickname: '바뀌면안돼' }), later(1));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('FORBIDDEN');
    expect(r.error.message).toContain(`${DEPARTMENT_CHANGE_COOLDOWN_DAYS}일`);
    expect(r.error.message).toContain('학교 계정을 연동');
    // 거절 문장에 학과 이름이 섞이지 않는다 — 본인의 현재 학과도, 시도한 학과도 말하지 않는다
    expect(r.error.message).not.toContain('경영학부');
    expect(r.error.message).not.toContain('컴퓨터공학부');

    const s = await stored(u.id);
    expect(s.department).toBe('경영학부');
    expect(s.nickname).not.toBe('바뀌면안돼'); // 저장이 통째로 거절된다
    expect(changedAtMs(s)).toBe(NOW.getTime());
  });

  it('후보 학과를 25번 바꿔 넣어 봐도 한 번도 적용되지 않는다 (재현했던 탐색 시나리오)', async () => {
    const u = await addUser({ profile: false });
    await saveProfile(u.id, body('경영학부'), NOW);
    const candidates = ['컴퓨터공학부', 'AI응용학과', '융합행정학부', '패션디자인트랙', '영미문화콘텐츠트랙'];
    const codes: string[] = [];
    for (let i = 0; i < 25; i += 1) {
      codes.push(codeOf(await saveProfile(u.id, body(candidates[i % candidates.length]!), later(0.5 + i / 100))));
    }
    expect(codes.every((c) => c === 'FORBIDDEN')).toBe(true);
    expect((await stored(u.id)).department).toBe('경영학부');
  });

  it('30일이 지나면 바꿀 수 있고, 그때부터 다시 30일 잠긴다', async () => {
    const u = await addUser({ profile: false });
    await saveProfile(u.id, body('경영학부'), NOW);

    expect(codeOf(await saveProfile(u.id, body('컴퓨터공학부'), new Date(later(30).getTime() - 1)))).toBe('FORBIDDEN');
    expect(codeOf(await saveProfile(u.id, body('컴퓨터공학부'), later(30)))).toBe('OK');
    const s = await stored(u.id);
    expect(s.department).toBe('컴퓨터공학부');
    expect(changedAtMs(s)).toBe(later(30).getTime());

    expect(codeOf(await saveProfile(u.id, body('AI응용학과'), later(31)))).toBe('FORBIDDEN');
    expect((await stored(u.id)).department).toBe('컴퓨터공학부');
  });

  it('제한이 생기기 전에 만든 프로필(변경 시각 없음)은 한 번 바꿀 수 있고, 그 뒤로는 잠긴다', async () => {
    const u = await addUser({ department: '옛학과' });
    expect(changedAtMs(await stored(u.id))).toBeNull();
    expect(codeOf(await saveProfile(u.id, body('경영학부'), NOW))).toBe('OK');
    expect(changedAtMs(await stored(u.id))).toBe(NOW.getTime());
    expect(codeOf(await saveProfile(u.id, body('컴퓨터공학부'), later(1)))).toBe('FORBIDDEN');
  });

  it('동시에 서로 다른 학과 8개를 보내도 정확히 하나만 적용된다 (처음 정할 때)', async () => {
    const u = await addUser({ profile: false });
    const depts = Array.from({ length: 8 }, (_, i) => `동시학과${i}`);
    const results = await Promise.all(depts.map((d) => saveProfile(u.id, body(d), NOW)));
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => codeOf(r) === 'FORBIDDEN')).toHaveLength(7);
    const winner = results.findIndex((r) => r.ok);
    expect((await stored(u.id)).department).toBe(depts[winner]);
  });

  it('동시에 서로 다른 학과 8개를 보내도 정확히 하나만 적용된다 (30일이 지나 바꿀 수 있을 때)', async () => {
    const u = await addUser({ profile: false });
    await saveProfile(u.id, body('경영학부'), NOW);
    const t = later(31);
    const depts = Array.from({ length: 8 }, (_, i) => `바꿀학과${i}`);
    const results = await Promise.all(depts.map((d) => saveProfile(u.id, body(d), t)));
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => codeOf(r) === 'FORBIDDEN')).toHaveLength(7);
    const winner = results.findIndex((r) => r.ok);
    const s = await stored(u.id);
    expect(s.department).toBe(depts[winner]);
    expect(changedAtMs(s)).toBe(t.getTime());
  });
});

describe('학과 변경 제한 — 학교 계정으로 확인된 학과', () => {
  const link = (id: string, department: string | null) =>
    run('UPDATE users SET school_department = ? WHERE id = ?', [department, Number(id)]);

  it('연동한 사용자는 확인된 학과만 쓸 수 있고, 다른 값은 INVALID 로 거절된다 (아직 안 정했어도)', async () => {
    const u = await addUser({ profile: false });
    await link(u.id, 'AI응용학과');
    const r = await saveProfile(u.id, body('경영학부'), NOW);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('INVALID');
    expect(r.error.message).toContain('AI응용학과');
    expect((await findUser(u.id))!.profileDone).toBe(false);

    expect(codeOf(await saveProfile(u.id, body('AI응용학과'), NOW))).toBe('OK');
    expect((await stored(u.id)).department).toBe('AI응용학과');
  });

  it('연동 전에 직접 적은 학과가 있어도, 연동 뒤에는 30일을 기다리지 않고 확인된 학과로 맞출 수 있다', async () => {
    const u = await addUser({ profile: false });
    await saveProfile(u.id, body('내가적은학과'), NOW);
    expect(codeOf(await saveProfile(u.id, body('컴퓨터공학부'), later(1)))).toBe('FORBIDDEN');

    await link(u.id, '컴퓨터공학부');
    expect(codeOf(await saveProfile(u.id, body('컴퓨터공학부'), later(1)))).toBe('OK');
    const s = await stored(u.id);
    expect(s.department).toBe('컴퓨터공학부');
    expect(changedAtMs(s)).toBe(later(1).getTime());
    // 이제 다른 값으로는 못 바꾼다
    expect(codeOf(await saveProfile(u.id, body('경영학부'), later(100)))).toBe('INVALID');
  });

  it('연동을 해제해도 방금 맞춘 시점부터 30일 잠금이 이어진다 (연동↔해제로 제한을 피할 수 없다)', async () => {
    const u = await addUser({ profile: false });
    await link(u.id, 'AI응용학과');
    await saveProfile(u.id, body('AI응용학과'), NOW);
    await link(u.id, null); // 연동 해제: school_department 가 지워진다

    expect(codeOf(await saveProfile(u.id, body('경영학부'), later(1)))).toBe('FORBIDDEN');
    expect((await stored(u.id)).department).toBe('AI응용학과');
    expect(codeOf(await saveProfile(u.id, body('경영학부'), later(30)))).toBe('OK');
  });

  it('학교가 준 학과가 우리 규칙에 안 맞으면(너무 긺) 확인된 값으로 쓰지 않는다', async () => {
    const u = await addUser({ profile: false });
    await link(u.id, '가'.repeat(31));
    expect(codeOf(await saveProfile(u.id, body('경영학부'), NOW))).toBe('OK');
  });
});

describe('회귀: 학과를 바꿔 "같은 학과 제외" 미팅으로 남의 학과를 떠보는 방법', () => {
  const inHours = (h: number) => new Date(Date.now() + h * 3600_000).toISOString();
  const meetup: CreateGatheringBody = {
    kind: 'meetup',
    title: '금요일 저녁 2:2',
    body: '',
    place: '삼선교',
    meetAt: inHours(72),
    joinDeadline: inHours(48),
    joinPolicy: 'auto',
    slots: MEETUP_PRESETS['2:2'].slots,
    meta: { excludeSameDept: true },
  };

  const blockedReasonFor = async (id: string, gatheringId: string): Promise<string | null> => {
    const viewer = (await findUser(id))!; // 요청마다 사용자를 새로 읽는 것과 같다
    const view = await getGatheringView(viewer, gatheringId);
    if (!view.ok) throw new Error(`조회 실패 ${view.error.code}`);
    return view.value.viewer.blockedReason;
  };

  it('탐색자가 주최자의 학과를 넣어 보려 해도 막히고, 참여 가능 여부는 달라지지 않는다', async () => {
    const host = await addUser({ profile: false });
    await saveProfile(host.id, body('컴퓨터공학부', { nickname: '주최자' }), NOW);
    const hostFresh = (await findUser(host.id))!;
    const created = await createGathering(hostFresh, meetup);
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const gid = created.value.id;

    const prober = await addUser({ profile: false });
    await saveProfile(prober.id, body('경영학부', { nickname: '탐색자' }), NOW);
    expect(await blockedReasonFor(prober.id, gid)).toBeNull(); // 다른 학과라 참여할 수 있다

    // 탐색: 주최자일 것 같은 학과를 넣어 보고 → 반응을 본다
    const probe = await saveProfile(prober.id, body('컴퓨터공학부', { nickname: '탐색자' }), later(1));
    expect(codeOf(probe)).toBe('FORBIDDEN');
    expect(await blockedReasonFor(prober.id, gid)).toBeNull(); // 반응이 달라지지 않았다 = 정답을 확인할 수 없다
    expect((await stored(prober.id)).department).toBe('경영학부');

    // 다른 후보를 이어서 넣어 봐도 마찬가지다
    for (const candidate of ['AI응용학과', '융합행정학부', '패션디자인트랙']) {
      expect(codeOf(await saveProfile(prober.id, body(candidate, { nickname: '탐색자' }), later(2)))).toBe('FORBIDDEN');
    }
    expect(await blockedReasonFor(prober.id, gid)).toBeNull();

    // 정상적인 같은 학과 사용자는 (자기 학과가 같으므로) 여전히 막힌다 — 기능 자체는 그대로다
    const sameDept = await addUser({ profile: false });
    await saveProfile(sameDept.id, body('컴퓨터공학부', { nickname: '같은과' }), NOW);
    expect(await blockedReasonFor(sameDept.id, gid)).toBe('같은 학과는 참여할 수 없는 미팅이에요.');
  });

  it('학교 연동 사용자는 학과를 거짓으로 적어 비교를 속이거나 떠볼 수 없다', async () => {
    const host = await addUser({ profile: false });
    await saveProfile(host.id, body('컴퓨터공학부', { nickname: '주최자2' }), NOW);
    const created = await createGathering((await findUser(host.id))!, meetup);
    if (!created.ok) throw new Error('모임 생성 실패');

    const user = await addUser({ profile: false });
    await run('UPDATE users SET school_department = ? WHERE id = ?', ['경영학부', Number(user.id)]);
    expect(codeOf(await saveProfile(user.id, body('컴퓨터공학부', { nickname: '연동자' }), NOW))).toBe('INVALID');
    expect(codeOf(await saveProfile(user.id, body('경영학부', { nickname: '연동자' }), NOW))).toBe('OK');
    expect(await blockedReasonFor(user.id, created.value.id)).toBeNull();
  });
});
