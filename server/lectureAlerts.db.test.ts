/**
 * 미수강 강의 마감 푸시 — 임시 PGlite. 30시간 전·6시간 전 두 번 보내는지, 단계마다 한 번만 가는지 확인한다.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lecture-alerts-'));
delete process.env.DATABASE_URL;

const pushed = vi.hoisted(() => [] as Array<{ userId: string; body: string }>);
vi.mock('./lounge/services/push.js', () => ({
  pushOnly: async (userId: string, message: { body: string }) => { pushed.push({ userId, body: message.body }); },
}));

const { insert, ready, run } = await import('./db.js');
const { sweepLectureAlerts } = await import('./lectureAlerts.js');

const H = 3_600_000;
const NOW = Date.parse('2026-11-03T12:00:00+09:00');
let uid = 0;

beforeAll(async () => {
  await ready();
  uid = await insert("INSERT INTO users (username, name, password_hash) VALUES ('alert01', '알림', 'x') RETURNING id", []);
});
beforeEach(async () => {
  pushed.length = 0;
  await run('DELETE FROM lecture_alerts');
});
const add = (id: string, dueAt: number) =>
  run('INSERT INTO lecture_alerts (user_id, item_id, title, course, due_at) VALUES (?, ?, ?, ?, ?::timestamptz)', [uid, id, id, '자료구조', new Date(dueAt).toISOString()]);

describe('sweepLectureAlerts', () => {
  it('마감 30시간 전에 한 번, 6시간 전에 또 한 번 보낸다', async () => {
    await add('a', NOW + 40 * H);
    expect(await sweepLectureAlerts(NOW)).toBe(0);
    expect(await sweepLectureAlerts(NOW + 10 * H)).toBe(1); // 30시간 전
    expect(await sweepLectureAlerts(NOW + 11 * H)).toBe(0); // 같은 단계는 한 번만
    expect(await sweepLectureAlerts(NOW + 34 * H)).toBe(1); // 6시간 전
    expect(await sweepLectureAlerts(NOW + 35 * H)).toBe(0);
    expect(pushed.map((p) => p.body)).toEqual(['자료구조 · 마감 30시간 전', '자료구조 · 마감 6시간 전']);
  });

  it('보내는 시각은 정각으로 올린다: 11월 4일 23:59 마감 → 11월 3일 18:00, 11월 4일 18:00', async () => {
    const at = (s: string) => Date.parse(`${s}+09:00`);
    await add('c', at('2026-11-04T23:59:00'));
    expect(await sweepLectureAlerts(at('2026-11-03T17:59:00'))).toBe(0);
    expect(await sweepLectureAlerts(at('2026-11-03T18:00:00'))).toBe(1);
    expect(await sweepLectureAlerts(at('2026-11-03T18:01:00'))).toBe(0);
    expect(await sweepLectureAlerts(at('2026-11-04T17:59:00'))).toBe(0);
    expect(await sweepLectureAlerts(at('2026-11-04T18:00:00'))).toBe(1);
    expect(pushed.map((p) => p.body)).toEqual(['자료구조 · 마감 30시간 전', '자료구조 · 마감 6시간 전']);
  });

  it('처음 알게 된 때가 이미 6시간 안이면 6시간 알림만 보낸다', async () => {
    await add('b', NOW + 3 * H);
    expect(await sweepLectureAlerts(NOW)).toBe(1);
    expect(await sweepLectureAlerts(NOW + H)).toBe(0);
    expect(pushed.map((p) => p.body)).toEqual(['자료구조 · 마감 3시간 전']);
  });
});
