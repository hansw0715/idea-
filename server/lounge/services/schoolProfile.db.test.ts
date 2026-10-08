/**
 * 학교 계정 → 라운지 프로필 자동 생성 테스트 — 임시 PGlite DB 와 가짜 학교(testkit)만 쓴다. 실제 학교에는 접속하지 않는다.
 *
 * 지키는 것
 *  - 연동(link)하면 실명을 가린 닉네임·학과·입학년도로 프로필이 만들어지고 profile_done 이 켜진다. 해제하면 꺼진다.
 *  - PUT /api/lounge/me 는 아바타 색만 바꾼다. 이름·학과·학번 필드는 400, 연동이 없으면 400.
 *  - 연동은 있는데 프로필이 없는 옛 계정은 GET /me 에서 한 번 채워진다.
 *  - 다른 사용자 카드(PublicUser)에 department·admissionYear 가 실린다.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import jwt from 'jsonwebtoken';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'school-profile-'));
process.env.DATA_DIR = dataDir;
process.env.JWT_SECRET = 'school-profile-test-secret-0123456789';
delete process.env.DATABASE_URL;
delete process.env.SCHOOL_MOCK_ORIGIN;

import { createApp } from '../../app.js';
import { get, insert, ready, run } from '../../db.js';
import { linkLimiter, schoolCallLimiter, studentLinkHash } from '../../school/guard.js';
import { createSchoolService } from '../../school/service.js';
import { createFakeSchool } from '../../school/testkit.js';
import { findUser, toPublicUser } from '../users.js';
import { ensureSchoolProfile, maskName } from './schoolProfile.js';

const STUDENT = '2021204044';
const PASSWORD = 'pw-SECRET-7f3a91';
const creds = { studentId: STUDENT, password: PASSWORD };
const b64 = (n: number): string => Buffer.alloc(n, 7).toString('base64');
const cipher = { v: 2, iv: b64(12), ct: b64(32) };

let server: Server;
let base = '';

beforeAll(async () => {
  await ready();
  server = await new Promise<Server>((resolve) => {
    const s = createApp().listen(0, '127.0.0.1', () => resolve(s));
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}, 180_000);

afterAll(async () => {
  await new Promise<void>((resolve) => server?.close(() => resolve()));
  try {
    fs.rmSync(dataDir, { recursive: true, force: true });
  } catch {
    // 임시 폴더라 남겨 둬도 된다.
  }
});

let seq = 0;
async function makeUser(name = '박민재'): Promise<number> {
  seq += 1;
  return insert("INSERT INTO users (email, name, password_hash) VALUES (?, ?, 'x') RETURNING id", [`sp${seq}@hansung.ac.kr`, name]);
}

/** 학번 하나당 계정 하나 — 앞 테스트가 연동해 둔 학번을 풀어 준다 */
const releaseStudent = () =>
  run('UPDATE users SET school_student_hash = NULL, school_cipher = NULL, school_hint = NULL WHERE school_student_hash IS NOT NULL');

function service() {
  const fake = createFakeSchool({ users: { [STUDENT]: PASSWORD }, names: { [STUDENT]: '박민재' } });
  return createSchoolService({ fetch: fake.fetch });
}

async function api(uid: number, method: string, url: string, body?: unknown) {
  const res = await fetch(`${base}/api/lounge${url}`, {
    method,
    headers: { 'content-type': 'application/json', cookie: `token=${jwt.sign({ uid }, process.env.JWT_SECRET!)}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as Record<string, any> };
}

const row = (uid: number) => get<Record<string, unknown>>('SELECT * FROM users WHERE id = ?', [uid]);

describe('maskName — 실명을 가린 닉네임', () => {
  it('첫 글자만 남기고 나머지는 ○, 한 글자는 그대로, 길면 앞 8글자', () => {
    expect(maskName('박민재')).toBe('박○○');
    expect(maskName('남궁민수')).toBe('남○○○');
    expect(maskName('박')).toBe('박');
    expect(maskName('  이둘 ')).toBe('이○');
    expect(maskName('가나다라마바사아자차')).toBe('가○○○○○○○');
    expect(maskName('')).toBe('학생');
  });
});

describe('연동하면 프로필이 만들어진다', () => {
  it('link → 가린 이름·학과·입학년도, 단과대는 비움, profile_done. 재연동은 학과·입학년도를 갱신하고 unlink 는 프로필을 닫는다', async () => {
    await releaseStudent();
    const uid = await makeUser();
    linkLimiter.clear(String(uid));
    schoolCallLimiter.clear(String(uid));
    expect((await findUser(uid))!.profileDone).toBe(false);

    const svc = service();
    await svc.link(uid, { creds, cipher });
    expect(await row(uid)).toMatchObject({
      nickname: '박○○',
      college: '',
      department: 'AI응용학과',
      admission_year: 2021,
      profile_done: true,
      avatar: 'turtle-smile',
      avatar_color: 'm1',
    });

    // 재연동: 학교에서 학과가 바뀌어 읽히면 그 값으로 갱신
    await run("UPDATE users SET school_department = '경영학부', school_admission_year = 2020 WHERE id = ?", [uid]);
    expect(await ensureSchoolProfile(uid)).toBe(true);
    expect(await row(uid)).toMatchObject({ department: '경영학부', admission_year: 2020 });
    await svc.link(uid, { creds, cipher });
    expect(await row(uid)).toMatchObject({ department: 'AI응용학과', admission_year: 2021, profile_done: true });

    await svc.unlink(uid);
    expect(await row(uid)).toMatchObject({ profile_done: false, school_cipher: null });
    // 연동이 없으면 채우지 않는다
    expect(await ensureSchoolProfile(uid)).toBe(false);
    expect((await row(uid))!.profile_done).toBe(false);
  });
});

describe('PUT /api/lounge/me — 아바타 색만', () => {
  async function linkedUser(): Promise<number> {
    await releaseStudent();
    const uid = await makeUser();
    await run(
      "UPDATE users SET school_cipher = ?, school_hint = '*******044', school_student_hash = ?, school_linked_at = now(), school_department = 'AI응용학과', school_admission_year = 2021 WHERE id = ?",
      [JSON.stringify(cipher), studentLinkHash(STUDENT), uid],
    );
    return uid;
  }

  it('연동이 없는 사용자는 400 (프로필 시트로 만들 수 없다)', async () => {
    const uid = await makeUser();
    const r = await api(uid, 'PUT', '/me', { avatarColor: 'm3' });
    expect(r.status).toBe(400);
    expect(r.json).toMatchObject({ code: 'INVALID', error: '학교 계정을 연동하면 라운지를 쓸 수 있어요.' });
    expect((await row(uid))!.profile_done).toBe(false);
  });

  it('이름·학과·학번·아바타를 보내면 400, 아무것도 바뀌지 않는다', async () => {
    const uid = await linkedUser();
    await ensureSchoolProfile(uid);
    for (const extra of [{ nickname: '하늘' }, { college: 'IT공과대학' }, { department: '경영학부' }, { admissionYear: 2024 }]) {
      const r = await api(uid, 'PUT', '/me', { avatarColor: 'm3', ...extra });
      expect(r.status, JSON.stringify(extra)).toBe(400);
      expect(r.json).toMatchObject({ code: 'INVALID', error: '이름·학과·학번은 학교 계정 정보로 자동으로 정해져요.' });
    }
    expect(await row(uid)).toMatchObject({ nickname: '박○○', department: 'AI응용학과', avatar_color: 'm1' });
  });

  it('avatarColor 만 바꿀 수 있고, 목록에 없는 색은 400', async () => {
    const uid = await linkedUser();
    const bad = await api(uid, 'PUT', '/me', { avatarColor: '#ff0000' });
    expect(bad.status).toBe(400);

    const r = await api(uid, 'PUT', '/me', { avatarColor: 'm4' });
    expect(r.status).toBe(200);
    expect(r.json.profile).toMatchObject({ nickname: '박○○', department: 'AI응용학과', admissionYear: 2021, college: '', avatarColor: 'm4' });
    expect((await row(uid))!.avatar_color).toBe('m4');
  });
});

describe('GET /api/lounge/me · 다른 사용자 카드', () => {
  it('연동은 있는데 프로필이 없는 옛 계정은 /me 에서 한 번 채워지고, 연동이 없으면 needsProfile', async () => {
    await releaseStudent();
    const legacy = await makeUser('김하나');
    await run(
      "UPDATE users SET school_cipher = ?, school_hint = '*******044', school_student_hash = ?, school_linked_at = now(), school_department = '경영학부', school_admission_year = 2022 WHERE id = ?",
      [JSON.stringify(cipher), studentLinkHash(STUDENT), legacy],
    );
    expect((await row(legacy))!.profile_done).toBe(false);
    const r = await api(legacy, 'GET', '/me');
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ needsProfile: false, profile: { nickname: '김○○', department: '경영학부', admissionYear: 2022 } });
    expect((await row(legacy))!.profile_done).toBe(true);

    const none = await makeUser('이둘');
    const r2 = await api(none, 'GET', '/me');
    expect(r2.json).toMatchObject({ needsProfile: true, profile: null });
  });

  it('PublicUser 에 department·admissionYear 가 실리고 실명·이메일은 없다', async () => {
    await releaseStudent();
    const target = await makeUser('최셋');
    await run(
      "UPDATE users SET school_cipher = ?, school_hint = '*******044', school_student_hash = ?, school_linked_at = now(), school_department = '융합행정학부', school_admission_year = 2023 WHERE id = ?",
      [JSON.stringify(cipher), studentLinkHash(STUDENT), target],
    );
    await ensureSchoolProfile(target);
    const viewer = await makeUser('정넷');
    await ensureSchoolProfile(viewer); // 연동이 없어 false — 프로필 없음
    await run("UPDATE users SET profile_done = TRUE, nickname = '보는이' WHERE id = ?", [viewer]); // 카드를 보려면 본인도 프로필이 있어야 한다

    const r = await api(viewer, 'GET', `/users/${target}`);
    expect(r.status).toBe(200);
    expect(r.json.user).toEqual({
      id: String(target),
      nickname: '최○',
      college: '',
      department: '융합행정학부',
      admissionYear: 2023,
      avatar: 'turtle-smile',
      avatarColor: 'm1',
      temperature: 36.5,
    });
    expect(JSON.stringify(r.json)).not.toContain('최셋');
    expect(JSON.stringify(r.json)).not.toContain('hansung.ac.kr');

    const u = (await findUser(target))!;
    expect(toPublicUser(u)).toMatchObject({ department: '융합행정학부', admissionYear: 2023 });
  });
});
