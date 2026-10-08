/**
 * timetableConflicts 의 DB 부분 — 임시 PGlite DB. 계산 규칙 자체는 timetableConflict.test.ts(순수 함수)가 본다.
 * 여기서는 "사용자 일정을 한 번만 읽는다 / 남의 일정을 보지 않는다 / SQL 이 두 DB 에서 도는 모양이다" 를 확인한다.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const counter = vi.hoisted(() => ({ calls: [] as string[] }));
vi.mock('../db.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../db.js')>();
  return {
    ...actual,
    all: (sql: string, params?: unknown[]) => {
      counter.calls.push(sql);
      return actual.all(sql, params);
    },
  };
});

import { get, ready, run } from '../db.js';
import { timetableConflicts } from './timetableConflict.js';
import type { ConflictQuery } from './timetableConflict.js';

let tmp: string;
let me: string;
let other: string;

beforeAll(async () => {
  delete process.env.DATABASE_URL; // 원격 DB 로 새지 않게
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 's2-timetable-'));
  process.env.DATA_DIR = tmp;
  process.env.ADMIN_PASSWORD = 'test-admin-password';
  await ready();

  const mk = async (email: string) =>
    String((await get<{ id: number }>(`INSERT INTO users (email, name, password_hash) VALUES (?, '테스트', 'x') RETURNING id`, [email]))!.id);
  me = await mk('tt-me@hansung.ac.kr');
  other = await mk('tt-other@hansung.ac.kr');

  const add = (user: string, day: number, start: number, end: number, title: string, kind: 'weekly' | 'once', date: string | null) =>
    run(
      `INSERT INTO timetable_entries (user_id, day, start_min, end_min, title, place, repeat_kind, date)
       VALUES (?, ?, ?, ?, ?, '', ?, ?)`,
      [user, day, start, end, title, kind, date],
    );
  // 월 10:00~12:00 자료구조 / 수 13:00~15:00 운영체제 / 2026-10-14(수) 16:00~18:00 보강(한 번)
  await add(me, 0, 600, 720, '자료구조', 'weekly', null);
  await add(me, 2, 780, 900, '운영체제', 'weekly', null);
  await add(me, 2, 960, 1080, '보강', 'once', '2026-10-14');
  // 다른 사람의 일정: 내 계산에 섞이면 안 된다 (월 11:00~13:00)
  await add(other, 0, 660, 780, '남의수업', 'weekly', null);
}, 120_000);

afterAll(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

const kst = (s: string) => new Date(`${s}+09:00`).toISOString();
const q = (id: string, at: string, durationMin = 60): ConflictQuery => ({ id, meetAt: kst(at), durationMin });

describe('timetableConflicts (DB)', () => {
  it('weekly·once 모두, 여러 모임을 한 번에 — 일정 조회는 쿼리 한 번', async () => {
    counter.calls.length = 0;
    const r = await timetableConflicts(me, [
      q('mon', '2026-10-12T11:00:00'), // 월 11시 → 자료구조
      q('mon-after', '2026-10-12T12:00:00'), // 수업이 끝난 시각 → 겹침 아님
      q('wed-class', '2026-10-14T14:00:00'), // 수 14시 → 운영체제
      q('wed-once', '2026-10-14T17:00:00'), // 수 17시 → 보강(once)
      q('wed-next-week', '2026-10-21T17:00:00'), // 다음 주 수 17시 → once 는 해당 없음
      q('sat', '2026-10-10T11:00:00'), // 토요일
      q('tue', '2026-10-13T11:00:00'), // 화요일 (일정 없음)
    ]);
    expect(Object.fromEntries(r)).toEqual({ mon: '자료구조', 'wed-class': '운영체제', 'wed-once': '보강' });
    expect(counter.calls).toHaveLength(1);
  });

  it('다른 사용자의 일정은 보지 않는다', async () => {
    const mine = await timetableConflicts(me, [q('m', '2026-10-12T12:30:00')]); // 월 12:30 — 남의수업(11~13)과는 겹치지만 내 일정과는 아님
    expect(mine.size).toBe(0);
    const theirs = await timetableConflicts(other, [q('m', '2026-10-12T12:30:00')]);
    expect(theirs.get('m')).toBe('남의수업');
  });

  it('UTC 로는 전날 밤인 시각도 KST 로 계산한다', async () => {
    // UTC 2026-10-12 01:30 = KST 월 10:30
    const r = await timetableConflicts(me, [{ id: 'utc', meetAt: '2026-10-12T01:30:00Z', durationMin: 60 }]);
    expect(r.get('utc')).toBe('자료구조');
  });

  it('모임이 없거나 사용자 id 가 이상하면 쿼리 없이 빈 맵', async () => {
    counter.calls.length = 0;
    expect((await timetableConflicts(me, [])).size).toBe(0);
    expect((await timetableConflicts('abc', [q('x', '2026-10-12T11:00:00')])).size).toBe(0);
    expect((await timetableConflicts('', [q('x', '2026-10-12T11:00:00')])).size).toBe(0);
    expect((await timetableConflicts('99999999999', [q('x', '2026-10-12T11:00:00')])).size).toBe(0); // int4 범위 밖
    expect((await timetableConflicts('1 OR 1=1', [q('x', '2026-10-12T11:00:00')])).size).toBe(0);
    expect((await timetableConflicts(me, [{ id: 'bad', meetAt: 'nope', durationMin: 60 }])).size).toBe(0);
    expect(counter.calls).toHaveLength(0);
  });

  it('일정이 하나도 없는 사용자는 겹침이 없다', async () => {
    const lonely = String(
      (await get<{ id: number }>(`INSERT INTO users (email, name, password_hash) VALUES ('tt-none@hansung.ac.kr', '테스트', 'x') RETURNING id`))!.id,
    );
    expect((await timetableConflicts(lonely, [q('x', '2026-10-12T11:00:00')])).size).toBe(0);
  });
});
