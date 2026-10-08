/**
 * 개발용 시드 DB 통합 테스트 — 임시 PGlite DB. 멱등성과 단톡방 시스템 메시지(한 줄)를 실제 SQL 로 확인한다.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { all, get, ready, run } from '../../db.js';
import { SYSTEM_OPEN_MESSAGE } from '../../../shared/lounge/constants.js';
import { currentStatus, isFull, memberIds } from '../domain/gathering.js';
import { findGathering, listGatherings } from '../repo/gatherings.js';
import { findUser } from '../users.js';
import { DEMO_PASSWORD, DEMO_USERS, SAMPLE_PLANS, seedDemo } from './dev.js';

let tmp: string;

beforeAll(async () => {
  delete process.env.DATABASE_URL; // 원격 DB 로 새지 않게
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 's2-devseed-'));
  process.env.DATA_DIR = tmp;
  process.env.ADMIN_PASSWORD = 'test-admin-password';
  await ready();
}, 120_000);

afterAll(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

const NOW = new Date('2026-10-08T05:00:00Z'); // KST 목 14:00
const count = async (sql: string, params: unknown[] = []) => Number((await get<{ c: number }>(sql, params))!.c);

describe('seedDemo', () => {
  it('데모 사용자 8명 + 프로필 + 샘플 모임 5개를 만든다', async () => {
    const r = await seedDemo(NOW);
    expect(r.password).toBe(DEMO_PASSWORD);
    expect(r.users).toHaveLength(8);
    expect(r.users.every((u) => u.created)).toBe(true);
    expect(r.users.map((u) => u.email)).toEqual(DEMO_USERS.map((u) => u.email));
    expect(r.gatherings.map((g) => g.id)).toEqual(SAMPLE_PLANS.map((p) => p.id));
    expect(r.gatherings.every((g) => g.created)).toBe(true);

    // 프로필이 모두 완성돼 있고 라운지가 읽는 형태다
    for (const u of r.users) {
      const lu = (await findUser(u.id))!;
      expect(lu.profileDone, u.email).toBe(true);
      expect(lu.nickname).toBe(DEMO_USERS.find((d) => d.email === u.email)!.nickname);
      expect(lu.banned).toBe(false);
      expect(lu.isAdmin).toBe(false);
    }
    // 응답에 비밀번호 해시나 실명이 새지 않는다
    expect(JSON.stringify(r)).not.toMatch(/\$2[aby]\$/);
    expect(JSON.stringify(r)).not.toContain('데모1');
  });

  it('응답의 password 로 로그인할 수 있는 해시가 저장된다', async () => {
    const row = await get<{ password_hash: string }>('SELECT password_hash FROM users WHERE email = ?', ['demo3@hansung.ac.kr']);
    expect(row).toBeDefined();
    expect(bcrypt.compareSync(DEMO_PASSWORD, row!.password_hash)).toBe(true);
    expect(bcrypt.compareSync('wrong-password', row!.password_hash)).toBe(false);
  });

  it('모임 구성: 열린 2:2 미팅 2개(하나는 한 자리 남음), 밥약 2개, 정원이 찬 미팅 1개', async () => {
    const list = await listGatherings({ limit: 50 });
    expect(list).toHaveLength(5);
    const nowIso = NOW.toISOString();
    const open = list.filter((g) => g.kind === 'meetup' && currentStatus(g, nowIso) === 'open');
    expect(open).toHaveLength(2);
    const seatsLeft = open.map((g) => g.slots.reduce((n, s) => n + s.capacity - s.memberIds.length, 0)).sort();
    expect(seatsLeft[0]).toBe(1);
    expect(seatsLeft[1]).toBeGreaterThan(1);
    expect(list.filter((g) => g.kind === 'meal')).toHaveLength(2);
    const full = list.filter((g) => g.kind === 'meetup' && isFull(g));
    expect(full).toHaveLength(1);
    expect(memberIds(full[0])).toHaveLength(4);
    // 저장된 사본 컬럼(status/meet_at/kind/host_id)이 문서와 일치한다
    const rows = await all<{ id: string; kind: string; status: string; host_id: number }>(
      'SELECT id, kind, status, host_id FROM lounge_gatherings',
    );
    for (const row of rows) {
      const doc = list.find((g) => g.id === row.id)!;
      expect([row.kind, row.status, String(row.host_id)]).toEqual([doc.kind, doc.status, doc.hostId]);
    }
  });

  it('정원이 찬 미팅에만 단톡방 시스템 메시지가 정확히 한 줄 있다', async () => {
    const msgs = await all<{ room_id: string; kind: string; text: string; user_id: number | null }>(
      'SELECT room_id, kind, text, user_id FROM lounge_messages ORDER BY room_id',
    );
    expect(msgs).toEqual([{ room_id: 'demo-meetup-full', kind: 'system', text: SYSTEM_OPEN_MESSAGE, user_id: null }]);
  });

  it('다시 불러도 같은 결과다 (멱등): 아무것도 새로 만들지 않고 id 가 그대로', async () => {
    const before = await seedDemo(NOW);
    expect(before.users.every((u) => !u.created)).toBe(true);
    expect(before.gatherings.every((g) => !g.created)).toBe(true);

    const again = await seedDemo(new Date(NOW.getTime() + 3600_000));
    expect(again.users.map((u) => u.id)).toEqual(before.users.map((u) => u.id));
    expect(again.gatherings.every((g) => !g.created)).toBe(true);

    expect(await count(`SELECT COUNT(*)::int AS c FROM users WHERE email LIKE 'demo%@hansung.ac.kr'`)).toBe(8);
    expect(await count('SELECT COUNT(*)::int AS c FROM lounge_gatherings')).toBe(5);
    expect(await count('SELECT COUNT(*)::int AS c FROM lounge_messages')).toBe(1);
  });

  it('동시에 두 번 불려도 충돌하지 않는다', async () => {
    const [a, b] = await Promise.all([seedDemo(NOW), seedDemo(NOW)]);
    expect(a.users.map((u) => u.id)).toEqual(b.users.map((u) => u.id));
    expect(await count('SELECT COUNT(*)::int AS c FROM lounge_gatherings')).toBe(5);
  });

  it('이미 있는 데모 사용자는 건드리지 않는다 (건너뜀)', async () => {
    await run(`UPDATE users SET nickname = '내가바꿈', temperature = 40.5 WHERE email = 'demo1@hansung.ac.kr'`);
    const r = await seedDemo(NOW);
    expect(r.users[0].created).toBe(false);
    const u = (await findUser(r.users[0].id))!;
    expect(u.nickname).toBe('내가바꿈');
    expect(u.temperature).toBe(40.5);
  });

  it('지워진 모임 하나만 다시 만든다', async () => {
    await run(`DELETE FROM lounge_gatherings WHERE id = 'demo-meal-b'`);
    const r = await seedDemo(NOW);
    expect(r.gatherings.filter((g) => g.created).map((g) => g.id)).toEqual(['demo-meal-b']);
    expect(await findGathering('demo-meal-b')).toBeDefined();
  });

  it('날짜가 지난 샘플은 새 날짜로 다시 만들고, 단톡방 메시지도 한 줄만 유지한다', async () => {
    const later = new Date(NOW.getTime() + 10 * 24 * 3600_000); // 10일 뒤: 기존 샘플은 모두 지났다
    const r = await seedDemo(later);
    expect(r.gatherings.every((g) => g.created)).toBe(true);
    expect(r.users.every((u) => !u.created)).toBe(true);

    const g = (await findGathering('demo-meetup-open-a'))!;
    expect(g.meetAt > later.toISOString()).toBe(true);
    expect(await count('SELECT COUNT(*)::int AS c FROM lounge_gatherings')).toBe(5);
    // 지났던 방의 메시지는 지워지고 새로 만든 정원 찬 미팅에 안내가 한 줄
    expect(await count('SELECT COUNT(*)::int AS c FROM lounge_messages')).toBe(1);
    expect(await count(`SELECT COUNT(*)::int AS c FROM lounge_messages WHERE room_id = 'demo-meetup-full' AND kind = 'system'`)).toBe(1);
  });
});
