/**
 * 관리자 도구 DB 통합 테스트 — 임시 PGlite DB 에서 실제 SQL 을 돌린다 (DATABASE_URL 을 지우고 DATA_DIR 을 임시 폴더로).
 * 대시보드 집계, 사용자 조치, 모임 취소·빼기, 회의 삭제, 운영 도구가 관리 기록까지 남기는지 본다.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { get, insert, ready, run } from '../../db.js';
import { MEAL_PRESET, MEAL_SLOT } from '../../../shared/lounge/constants.js';
import type { CreateGatheringBody } from '../../../shared/lounge/gathering.js';
import type { Result } from '../../../shared/lounge/types.js';
import { findGathering } from '../repo/gatherings.js';
import { findUser } from '../users.js';
import type { LoungeUser } from '../users.js';
import { applyToGathering, approveApplicant, createGathering } from './gathering.js';
import {
  adminCancelGathering,
  adminDeleteMeeting,
  adminGatherings,
  adminKickMember,
  adminMeetings,
  adminOverview,
  adminRunTool,
  adminUserAction,
  adminUsers,
  recentAdminLog,
} from './admin.js';

let tmp: string;

beforeAll(async () => {
  delete process.env.DATABASE_URL;
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 's2-admin-'));
  process.env.DATA_DIR = tmp;
  process.env.ADMIN_PASSWORD = 'test-admin-password';
  await ready();
}, 120_000);

afterAll(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

let seq = 0;
async function addUser(opts: { isAdmin?: boolean; warnings?: number } = {}): Promise<LoungeUser> {
  seq += 1;
  const row = await get<{ id: number }>(
    `INSERT INTO users (email, username, name, password_hash, is_admin, nickname, college, department, admission_year,
                        avatar, avatar_color, temperature, warnings, banned, profile_done)
     VALUES (?, ?, ?, 'x', ?, ?, 'IT공과대학', '컴퓨터공학부', 2024, 'cat-think', 'm2', 36.5, ?, FALSE, TRUE) RETURNING id`,
    [`adm${seq}@hansung.ac.kr`, `admtest${seq}`, `실명${seq}`, opts.isAdmin ?? false, `닉${seq}`, opts.warnings ?? 0],
  );
  return (await findUser(row!.id))!;
}

const inHours = (h: number) => new Date(Date.now() + h * 3600_000).toISOString();
const mealBody = (): CreateGatheringBody => ({
  kind: 'meal',
  title: '학식 같이',
  body: '',
  place: '상상관',
  meetAt: inHours(30),
  joinDeadline: inHours(24),
  joinPolicy: 'approval',
  slots: MEAL_PRESET(3).slots,
});
function must<T>(r: Result<T>): T {
  if (!r.ok) throw new Error(`실패: ${r.error.code} ${r.error.message}`);
  return r.value;
}

describe('관리자 도구', () => {
  it('사용자를 찾고, 경고 초기화·정지·해제를 하면 관리 기록이 남는다 (실명은 내려가지 않는다)', async () => {
    const admin = await addUser({ isAdmin: true });
    const u = await addUser({ warnings: 2 });
    const found = await adminUsers(`admtest${seq}`, 'all');
    expect(found.map((x) => x.id)).toContain(u.id);
    expect(JSON.stringify(found)).not.toContain('실명');

    must(await adminUserAction(admin.id, u.id, 'clearWarnings'));
    expect((await findUser(u.id))!.warnings).toBe(0);
    must(await adminUserAction(admin.id, u.id, 'ban'));
    expect((await findUser(u.id))!.banned).toBe(true);
    expect((await adminUsers('', 'banned')).map((x) => x.id)).toContain(u.id);
    must(await adminUserAction(admin.id, u.id, 'unban'));
    expect((await findUser(u.id))!.banned).toBe(false);
    // 관리자는 정지할 수 없다
    expect((await adminUserAction(admin.id, admin.id, 'ban')).ok).toBe(false);

    const log = await recentAdminLog(10);
    expect(log.map((e) => e.action)).toEqual(expect.arrayContaining(['경고 초기화', '이용 정지', '정지 해제']));
  });

  it('참여자를 빼고 모임을 취소하면 목록 상태가 바뀌고 단톡방에 안내가 남는다', async () => {
    const admin = await addUser({ isAdmin: true });
    const host = await addUser();
    const guest = await addUser();
    const g = must(await createGathering(host, mealBody()));
    must(await applyToGathering(guest, g.id, MEAL_SLOT, ''));
    must(await approveApplicant(host, g.id, guest.id));

    expect((await adminKickMember(admin.id, g.id, host.id)).ok).toBe(false); // 주최자는 못 뺀다
    must(await adminKickMember(admin.id, g.id, guest.id));
    expect((await findGathering(g.id))!.slots.flatMap((s) => s.memberIds)).not.toContain(guest.id);

    const live = await adminGatherings('meal', 'live');
    expect(live.map((x) => x.id)).toContain(g.id);
    must(await adminCancelGathering(admin.id, g.id, '테스트'));
    expect((await findGathering(g.id))!.status).toBe('cancelled');
    expect((await adminGatherings('meal', 'cancelled')).map((x) => x.id)).toContain(g.id);
    const msg = await get<{ text: string }>(`SELECT text FROM lounge_messages WHERE room_id = ? AND kind = 'system' ORDER BY at DESC LIMIT 1`, [g.id]);
    expect(msg?.text).toContain('관리자가 이 모임을 취소했어요');
  });

  it('회의를 찾고 지우면 팀원·예약도 함께 지워진다', async () => {
    const admin = await addUser({ isAdmin: true });
    const owner = await addUser();
    const id = await insert('INSERT INTO meetings (name, code, owner_id) VALUES (?, ?, ?) RETURNING id', ['관리자테스트회의', `C${seq}X`, Number(owner.id)]);
    await run('INSERT INTO meeting_members (meeting_id, user_id) VALUES (?, ?)', [id, Number(owner.id)]);
    const found = await adminMeetings('관리자테스트');
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ members: 1, name: '관리자테스트회의' });
    must(await adminDeleteMeeting(admin.id, id));
    expect(await adminMeetings('관리자테스트')).toHaveLength(0);
    expect(await get('SELECT 1 AS x FROM meeting_members WHERE meeting_id = ?', [id])).toBeUndefined();
  });

  it('대시보드 집계와 운영 도구가 돈다', async () => {
    const admin = await addUser({ isAdmin: true });
    await run(`INSERT INTO lounge_presence (user_id, x, y, zone) VALUES (?, 0.5, 0.5, 'meetup') ON CONFLICT (user_id) DO UPDATE SET seen_at = now()`, [Number(admin.id)]);
    const o = await adminOverview();
    expect(o.users.total).toBeGreaterThan(0);
    expect(o.onlineNow).toBeGreaterThanOrEqual(1);
    expect(o.signups).toHaveLength(14);
    expect(o.gatherings.map((g) => g.kind)).toEqual(['meal', 'meetup', 'team']);

    const r = must(await adminRunTool(admin.id, 'clearPresence'));
    expect(r.message).toContain('접속 기록');
    expect((await adminOverview()).onlineNow).toBe(0);
  });
});
