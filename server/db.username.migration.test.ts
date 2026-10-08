/**
 * 옛 모양의 DB(이메일 NOT NULL, 아이디 없음, 같은 학번을 연동한 계정이 둘)를 새 규칙으로 올리는 마이그레이션 시험.
 * 임시 PGlite 폴더만 쓴다. 개발 서버와 그 DB 는 건드리지 않는다.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'username-migration-'));
process.env.DATA_DIR = dataDir;
process.env.JWT_SECRET = 'username-migration-test-secret';
delete process.env.DATABASE_URL;
delete process.env.ADMIN_PASSWORD;

import { all, get, ready, run } from './db.js';

beforeAll(async () => {
  // db.ts 가 열기 전에 같은 폴더에 "옛 모양" 테이블을 먼저 만들어 둔다
  const moduleName = '@electric-sql/pglite';
  const { PGlite } = (await import(moduleName)) as typeof import('@electric-sql/pglite');
  const dir = path.join(dataDir, 'pgdata');
  fs.mkdirSync(dir, { recursive: true });
  const lite = await PGlite.create(dir);
  await lite.exec(`
    CREATE TABLE users (
      id SERIAL PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      is_admin BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      school_cipher TEXT, school_hint TEXT, school_linked_at TIMESTAMPTZ,
      school_department TEXT, school_admission_year INTEGER, school_student_hash TEXT
    );
    INSERT INTO users (email, name, password_hash, is_admin) VALUES
      ('admin1@hansung.ac.kr', '관리자1', 'x', TRUE),
      ('Demo1@hansung.ac.kr', '데모1', 'x', FALSE),
      ('ab@hansung.ac.kr', '짧은아이디', 'x', FALSE);
    -- 같은 학번(해시)을 연동한 계정 둘: 먼저 연동한 쪽만 남아야 한다
    INSERT INTO users (email, name, password_hash, school_cipher, school_hint, school_student_hash, school_linked_at, school_department) VALUES
      ('late@hansung.ac.kr', '나중', 'x', '{"v":1}', '***044', 'DUPHASH', now(), 'B학과'),
      ('early@hansung.ac.kr', '먼저', 'x', '{"v":1}', '***044', 'DUPHASH', now() - interval '1 day', 'A학과');
  `);
  await lite.close();
  await ready();
}, 180_000);

afterAll(() => {
  try {
    fs.rmSync(dataDir, { recursive: true, force: true });
  } catch {
    // 임시 폴더라 남겨 둬도 된다.
  }
});

describe('옛 DB → 아이디 로그인 + 학번 하나당 계정 하나', () => {
  it('옛 행의 username 이 이메일 앞부분(소문자)으로 채워지고 이메일은 그대로다', async () => {
    const rows = await all<{ email: string; username: string }>('SELECT email, username FROM users ORDER BY id');
    expect(rows.map((r) => [r.email, r.username])).toEqual([
      ['admin1@hansung.ac.kr', 'admin1'],
      ['Demo1@hansung.ac.kr', 'demo1'],
      ['ab@hansung.ac.kr', 'ab'],
      ['late@hansung.ac.kr', 'late'],
      ['early@hansung.ac.kr', 'early'],
    ]);
  });

  it('email 의 NOT NULL 이 풀려 새 가입(email NULL)이 여러 개 들어가지만 UNIQUE 는 유지된다', async () => {
    await run("INSERT INTO users (username, name, password_hash) VALUES ('newone1', 'n', 'x'), ('newone2', 'n', 'x')");
    await expect(run("INSERT INTO users (email, username, name, password_hash) VALUES ('admin1@hansung.ac.kr', 'dup_mail', 'n', 'x')")).rejects.toThrow(/duplicate|unique/i);
  });

  it('username 유니크 인덱스', async () => {
    await expect(run("INSERT INTO users (username, name, password_hash) VALUES ('admin1', 'n', 'x')")).rejects.toThrow(/duplicate|unique/i);
  });

  it('같은 학번을 연동한 계정이 둘이면 먼저 연동한 쪽만 남고 나머지는 연동이 풀린 채로 인덱스가 만들어진다', async () => {
    const early = await get<Record<string, unknown>>("SELECT * FROM users WHERE username = 'early'");
    const late = await get<Record<string, unknown>>("SELECT * FROM users WHERE username = 'late'");
    expect(early).toMatchObject({ school_student_hash: 'DUPHASH', school_department: 'A학과' });
    expect(late).toMatchObject({ school_student_hash: null, school_cipher: null, school_hint: null, school_linked_at: null, school_department: null });
    await expect(run("INSERT INTO users (username, name, password_hash, school_student_hash) VALUES ('third', 'n', 'x', 'DUPHASH')")).rejects.toThrow(/duplicate|unique/i);
    // 해시가 NULL 인 행은 여러 개여도 된다 (부분 인덱스)
    await run("INSERT INTO users (username, name, password_hash) VALUES ('nohash1', 'n', 'x'), ('nohash2', 'n', 'x')");
    const idx = (await all<{ indexname: string }>("SELECT indexname FROM pg_indexes WHERE tablename = 'users'")).map((r) => r.indexname);
    expect(idx).toEqual(expect.arrayContaining(['uq_users_username', 'uq_users_school_student_hash']));
  });
});
