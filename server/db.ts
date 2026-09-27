import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import bcrypt from 'bcryptjs';

/** Vercel / Netlify / AWS Lambda 처럼 파일시스템이 유지되지 않는 실행 환경인지. */
export const isServerless = Boolean(
  process.env.VERCEL ?? process.env.NETLIFY ?? process.env.AWS_LAMBDA_FUNCTION_NAME,
);

/**
 * 로컬 개발용 데이터 디렉터리.
 * OneDrive/Dropbox 같은 동기화 폴더 안에서는 DB 파일이 동기화 도중 교체되면서
 * 커밋된 데이터가 사라질 수 있으므로 동기화 경로는 피한다.
 */
export function resolveDataDir(): string {
  if (process.env.DATA_DIR) return process.env.DATA_DIR;
  const local = path.join(process.cwd(), 'data');
  if (/[\\/](OneDrive|Dropbox|Google ?Drive|iCloud)/i.test(local)) {
    return path.join(os.homedir(), '.campus-space');
  }
  return local;
}

interface QueryResult {
  rows: Record<string, unknown>[];
  rowCount: number;
}

interface Driver {
  query(sql: string, params: unknown[]): Promise<QueryResult>;
  exec(sql: string): Promise<void>;
}

async function createDriver(): Promise<Driver> {
  const url = process.env.DATABASE_URL;

  if (url) {
    // 배포 환경: Supabase 등 원격 Postgres.
    const { default: pg } = await import('pg');
    const isLocalHost = /@(localhost|127\.0\.0\.1)/.test(url);
    const pool = new pg.Pool({
      connectionString: url,
      // Supabase는 SSL 필수. 관리형 인증서라 체인 검증은 끄고 암호화만 사용한다.
      ssl: isLocalHost ? undefined : { rejectUnauthorized: false },
      // 서버리스는 인스턴스가 잘게 쪼개지므로 인스턴스당 연결 수를 최소로 유지한다.
      max: isServerless ? 1 : 10,
      idleTimeoutMillis: isServerless ? 5_000 : 30_000,
      connectionTimeoutMillis: 15_000,
    });
    return {
      async query(sql, params) {
        const result = await pool.query(sql, params);
        return { rows: result.rows, rowCount: result.rowCount ?? 0 };
      },
      async exec(sql) {
        await pool.query(sql);
      },
    };
  }

  if (isServerless) {
    throw new Error(
      'DATABASE_URL 환경 변수가 필요합니다. Supabase의 Connection string(Transaction pooler)을 등록해 주세요.',
    );
  }

  // 로컬 개발: Postgres를 따로 설치하지 않아도 되도록 PGlite(임베디드 Postgres)를 쓴다.
  const dir = path.join(resolveDataDir(), 'pgdata');
  fs.mkdirSync(dir, { recursive: true });
  // 모듈 이름을 변수로 두어 번들러가 정적으로 끌어가지 못하게 한다.
  // (PGlite는 WASM Postgres를 포함해 수십 MB라 서버리스 함수 용량 제한을 넘긴다)
  const moduleName = '@electric-sql/pglite';
  const { PGlite } = (await import(moduleName)) as typeof import('@electric-sql/pglite');
  const lite = await PGlite.create(dir);
  console.warn(`[db] DATABASE_URL이 없어 로컬 PGlite를 사용합니다: ${dir}`);
  return {
    async query(sql, params) {
      const result = await lite.query(sql, params);
      return {
        rows: result.rows as Record<string, unknown>[],
        rowCount: result.affectedRows ?? result.rows.length,
      };
    },
    async exec(sql) {
      await lite.exec(sql);
    },
  };
}

let driverPromise: Promise<Driver> | null = null;

function driver(): Promise<Driver> {
  if (!driverPromise) {
    driverPromise = createDriver().catch((err) => {
      driverPromise = null;
      throw err;
    });
  }
  return driverPromise;
}

/**
 * SQLite 스타일의 `?` 자리표시자를 Postgres의 `$1, $2 …` 로 바꾼다.
 * (쿼리 문자열 안에 리터럴 `?` 는 쓰지 않는다는 전제)
 */
function toPgPlaceholders(sql: string): string {
  let index = 0;
  return sql.replace(/\?/g, () => `$${++index}`);
}

// ── 쿼리 헬퍼 ──────────────────────────────────────────────────
export async function all<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  const d = await driver();
  const result = await d.query(toPgPlaceholders(sql), params);
  return result.rows as unknown as T[];
}

export async function get<T>(sql: string, params: unknown[] = []): Promise<T | undefined> {
  const rows = await all<T>(sql, params);
  return rows[0];
}

export async function run(
  sql: string,
  params: unknown[] = [],
): Promise<{ changes: number }> {
  const d = await driver();
  const result = await d.query(toPgPlaceholders(sql), params);
  return { changes: result.rowCount };
}

/** INSERT … RETURNING id 를 실행하고 생성된 id를 돌려준다. */
export async function insert(sql: string, params: unknown[] = []): Promise<number> {
  const row = await get<{ id: number }>(sql, params);
  if (!row) throw new Error('INSERT 후 id를 돌려받지 못했습니다.');
  return Number(row.id);
}

export const SCHEMA = `
  CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    -- 운영용으로 미리 만들어 둔 계정. 스스로 탈퇴할 수 없다.
    is_admin BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  CREATE TABLE IF NOT EXISTS timetable_entries (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    day INTEGER NOT NULL,
    start_min INTEGER NOT NULL,
    end_min INTEGER NOT NULL,
    title TEXT NOT NULL,
    place TEXT NOT NULL DEFAULT '',
    -- 'weekly' = 매주 반복, 'once' = date 에 적힌 그 날만
    repeat_kind TEXT NOT NULL DEFAULT 'weekly',
    date TEXT
  );

  CREATE TABLE IF NOT EXISTS meetings (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    code TEXT NOT NULL UNIQUE,
    owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  CREATE TABLE IF NOT EXISTS meeting_members (
    meeting_id INTEGER NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (meeting_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS facilities (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    building TEXT NOT NULL,
    capacity INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS reservations (
    id SERIAL PRIMARY KEY,
    facility_id INTEGER NOT NULL REFERENCES facilities(id) ON DELETE CASCADE,
    meeting_id INTEGER NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    date TEXT NOT NULL,
    start_min INTEGER NOT NULL,
    end_min INTEGER NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  CREATE TABLE IF NOT EXISTS email_verifications (
    email TEXT PRIMARY KEY,
    code_hash TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    send_count INTEGER NOT NULL DEFAULT 1,
    first_sent_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  CREATE INDEX IF NOT EXISTS idx_timetable_user ON timetable_entries(user_id);
  CREATE INDEX IF NOT EXISTS idx_reservations_facility_date ON reservations(facility_id, date);
  CREATE INDEX IF NOT EXISTS idx_members_user ON meeting_members(user_id);
`;

/**
 * 한성대 공식 '학습공간' 안내에 실린 온라인 예약 공간 중 팀 단위로 쓸 수 있는 곳.
 * campusName은 학교 예약 시스템에 표시되는 이름 그대로여야 예약 현황이 매칭된다.
 * 설명과 인원은 학교 공식 안내에 적힌 내용만 사용하고, 없는 값은 비워 둔다.
 */
interface FacilitySeed {
  systemKey: string;
  campusName: string;
  name: string;
  building: string;
  minCapacity: number | null;
  maxCapacity: number | null;
  description: string;
}

const STUDY_ROOM_DESC = '테이블·의자·화이트보드와 TV를 갖춘 그룹학습 공간입니다.';
const IB_DESC = '상상베이스 그룹스터디룸입니다.';
const IB_FOLDING_DESC =
  '접이식 가벽이 있어 옆방과 합쳐 쓸 수 있습니다. 합실하면 5~8인이 이용할 수 있고, 두 방 모두 예약해야 합니다.';
const SMALL_GROUP_DESC = 'TV 또는 빔프로젝터를 갖춘 소모임실입니다.';
const LOUNGE_DESC =
  '세미나·회의·강의·팀 프로젝트 등 다양한 목적으로 쓸 수 있고 TV를 시청각 작업에 활용할 수 있습니다. 안내데스크에 들르면 출입문을 열어 줍니다.';

const FACILITY_SEED: FacilitySeed[] = [
  // 학술정보관 — 3~6층 그룹스터디실 (문의 02-760-5667, 5695)
  { systemKey: 'hsel', campusName: '그룹스터디실(3F-1)', name: '그룹스터디실 3F-1', building: '학술정보관 3층', minCapacity: 3, maxCapacity: 7, description: STUDY_ROOM_DESC },
  { systemKey: 'hsel', campusName: '그룹스터디실(3F-2)', name: '그룹스터디실 3F-2', building: '학술정보관 3층', minCapacity: 3, maxCapacity: 6, description: STUDY_ROOM_DESC },
  { systemKey: 'hsel', campusName: '그룹스터디실(4F)', name: '그룹스터디실 4F', building: '학술정보관 4층', minCapacity: 5, maxCapacity: 11, description: '전자칠판을 갖춘 가장 큰 그룹학습 공간으로, 5명 이상부터 이용할 수 있습니다.' },
  { systemKey: 'hsel', campusName: '그룹스터디실(5F)', name: '그룹스터디실 5F', building: '학술정보관 5층', minCapacity: 3, maxCapacity: 6, description: STUDY_ROOM_DESC },
  { systemKey: 'hsel', campusName: '그룹스터디실(6F)', name: '그룹스터디실 6F', building: '학술정보관 6층', minCapacity: 3, maxCapacity: 6, description: STUDY_ROOM_DESC },
  { systemKey: 'hsel', campusName: '코워킹룸(3F창의열람실)', name: '코워킹룸', building: '학술정보관 3층 창의열람실', minCapacity: null, maxCapacity: null, description: '창의열람실 안에 있는 코워킹 공간입니다.' },
  { systemKey: 'hsel', campusName: '회의실(5F상상커먼스)', name: '회의실', building: '학술정보관 5층 상상커먼스', minCapacity: null, maxCapacity: null, description: '상상커먼스 안에 있는 회의실입니다.' },

  // 상상베이스 — 상상관 B2층 (문의 02-760-8000)
  { systemKey: 'onestop', campusName: '세미나실(IB111)', name: '세미나실 IB111', building: '상상관 B2층', minCapacity: 6, maxCapacity: 16, description: '86인치 TV를 갖춘 세미나실로, 발표나 인원이 많은 모임에 적합합니다.' },
  { systemKey: 'onestop', campusName: 'IB101', name: '그룹스터디룸 IB101', building: '상상관 B2층', minCapacity: 4, maxCapacity: 8, description: IB_FOLDING_DESC },
  { systemKey: 'onestop', campusName: 'IB102', name: '그룹스터디룸 IB102', building: '상상관 B2층', minCapacity: 4, maxCapacity: 8, description: IB_FOLDING_DESC },
  { systemKey: 'onestop', campusName: 'IB103', name: '그룹스터디룸 IB103', building: '상상관 B2층', minCapacity: 4, maxCapacity: 8, description: IB_FOLDING_DESC },
  { systemKey: 'onestop', campusName: 'IB104', name: '그룹스터디룸 IB104', building: '상상관 B2층', minCapacity: 4, maxCapacity: 8, description: IB_FOLDING_DESC },
  { systemKey: 'onestop', campusName: 'IB105', name: '그룹스터디룸 IB105', building: '상상관 B2층', minCapacity: 4, maxCapacity: 8, description: IB_DESC },
  { systemKey: 'onestop', campusName: 'IB106', name: '그룹스터디룸 IB106', building: '상상관 B2층', minCapacity: 4, maxCapacity: 8, description: IB_DESC },
  { systemKey: 'onestop', campusName: 'IB107', name: '그룹스터디룸 IB107', building: '상상관 B2층', minCapacity: 4, maxCapacity: 8, description: IB_DESC },
  { systemKey: 'onestop', campusName: 'IB108', name: '그룹스터디룸 IB108', building: '상상관 B2층', minCapacity: 4, maxCapacity: 8, description: IB_DESC },

  // 상상파크플러스 — 공학관 B1층
  { systemKey: 'cncschool', campusName: '소모임실 Challenge', name: '소모임실 Challenge', building: '공학관 B1층', minCapacity: null, maxCapacity: 8, description: SMALL_GROUP_DESC },
  { systemKey: 'cncschool', campusName: '소모임실 Collaboration', name: '소모임실 Collaboration', building: '공학관 B1층', minCapacity: null, maxCapacity: 8, description: SMALL_GROUP_DESC },
  { systemKey: 'cncschool', campusName: '소모임실 Communication', name: '소모임실 Communication', building: '공학관 B1층', minCapacity: null, maxCapacity: 8, description: SMALL_GROUP_DESC },
  { systemKey: 'cncschool', campusName: '소모임실 Convergence', name: '소모임실 Convergence', building: '공학관 B1층', minCapacity: null, maxCapacity: 8, description: SMALL_GROUP_DESC },
  { systemKey: 'cncschool', campusName: '소모임실 Creativity', name: '소모임실 Creativity', building: '공학관 B1층', minCapacity: null, maxCapacity: 8, description: SMALL_GROUP_DESC },
  { systemKey: 'cncschool', campusName: '소모임실 Critical Thinking', name: '소모임실 Critical Thinking', building: '공학관 B1층', minCapacity: null, maxCapacity: 8, description: SMALL_GROUP_DESC },

  // 코딩라운지 (연구관 B2~1층) — 101~105호는 12인실, 106~113호는 8인실
  ...Array.from({ length: 13 }, (_, i) => {
    const roomNo = 101 + i;
    return {
      systemKey: 'codinglounge',
      campusName: `세미나실 ${roomNo}호`,
      name: `코딩라운지 세미나실 ${roomNo}호`,
      building: '연구관 B2~1층',
      minCapacity: null,
      maxCapacity: roomNo <= 105 ? 12 : 8,
      description: LOUNGE_DESC,
    };
  }),
];

const TABLES = [
  'users',
  'timetable_entries',
  'meetings',
  'meeting_members',
  'facilities',
  'reservations',
  'email_verifications',
];

/**
 * Supabase는 public 스키마의 새 테이블에 anon/authenticated 역할의 전체 권한을 자동으로 부여한다.
 * 공개된 anon 키만 있으면 PostgREST를 통해 비밀번호 해시까지 읽히므로,
 * RLS를 켜고(정책이 없으면 전면 거부) 권한도 회수한다.
 * 앱은 RLS를 우회하는 postgres 역할로 직접 접속하므로 영향받지 않는다.
 */
async function lockDownTables(): Promise<void> {
  const d = await driver();
  for (const table of TABLES) {
    try {
      await d.exec(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY`);
      await d.exec(`REVOKE ALL ON public.${table} FROM anon, authenticated`);
    } catch {
      // anon/authenticated 역할이 없는 환경(로컬 PGlite 등)에서는 무시한다.
    }
  }
}

/** 실제 학교 시설 정보를 담기 위한 컬럼 추가. 이미 있으면 아무 일도 하지 않는다. */
const FACILITY_COLUMNS = `
  ALTER TABLE facilities ADD COLUMN IF NOT EXISTS external_id TEXT;
  ALTER TABLE facilities ADD COLUMN IF NOT EXISTS min_capacity INTEGER;
  ALTER TABLE facilities ADD COLUMN IF NOT EXISTS system_key TEXT;
  ALTER TABLE facilities ADD COLUMN IF NOT EXISTS campus_name TEXT;
  ALTER TABLE facilities ADD COLUMN IF NOT EXISTS description TEXT;
  ALTER TABLE facilities ALTER COLUMN capacity DROP NOT NULL;
`;

/**
 * 이미 만들어진 DB에 나중에 추가된 것들을 보장한다.
 * 빠른 경로에서도 매번 실행되므로 한 번의 왕복으로 끝나도록 한 덩어리로 둔다.
 */
const LATE_MIGRATIONS = `
  CREATE TABLE IF NOT EXISTS email_verifications (
    email TEXT PRIMARY KEY,
    code_hash TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    send_count INTEGER NOT NULL DEFAULT 1,
    first_sent_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT FALSE;
  ALTER TABLE timetable_entries ADD COLUMN IF NOT EXISTS repeat_kind TEXT NOT NULL DEFAULT 'weekly';
  ALTER TABLE timetable_entries ADD COLUMN IF NOT EXISTS date TEXT;

  UPDATE users SET is_admin = TRUE
   WHERE is_admin = FALSE
     AND email IN ('admin1@hansung.ac.kr', 'admin2@hansung.ac.kr', 'admin3@hansung.ac.kr');
  ALTER TABLE email_verifications ENABLE ROW LEVEL SECURITY;
`;

/**
 * 운영용 관리자 계정. DB를 새로 만들어도 바로 들어갈 수 있도록 함께 심는다.
 * 비밀번호는 ADMIN_PASSWORD 환경 변수로 바꿀 수 있고, 이미 있는 계정은 건드리지 않는다.
 */
const ADMIN_ACCOUNTS = [
  { email: 'admin1@hansung.ac.kr', name: '관리자1' },
  { email: 'admin2@hansung.ac.kr', name: '관리자2' },
  { email: 'admin3@hansung.ac.kr', name: '관리자3' },
];

async function seedAdmins(): Promise<void> {
  // 비밀번호를 코드에 적어 두면 저장소를 보는 사람이 그대로 로그인할 수 있으므로
  // 환경 변수로만 받는다. 값이 없으면 계정을 아예 만들지 않는다.
  const password = process.env.ADMIN_PASSWORD;
  if (!password) {
    console.warn('[db] ADMIN_PASSWORD 가 없어 관리자 계정을 만들지 않았습니다.');
    return;
  }
  const hash = bcrypt.hashSync(password, 10);
  for (const admin of ADMIN_ACCOUNTS) {
    await run(
      `INSERT INTO users (email, name, password_hash, is_admin)
       VALUES (?, ?, ?, TRUE)
       ON CONFLICT (email) DO NOTHING`,
      [admin.email, admin.name, hash],
    );
  }
}

async function migrate(): Promise<void> {
  const d = await driver();

  // 서버리스는 인스턴스가 뜰 때마다 이 함수를 실행한다.
  // 스키마 생성·권한 회수는 왕복이 20번 넘게 들어가므로,
  // 이미 준비된 DB면 짧은 확인 쿼리 한 번으로 건너뛴다.
  try {
    const probe = await get<{ c: number }>(
      'SELECT COUNT(*)::int AS c FROM facilities WHERE campus_name IS NOT NULL',
    );
    if (probe && Number(probe.c) === FACILITY_SEED.length) {
      // 나중에 추가된 테이블은 빠른 경로에서도 한 번 보장한다.
      await d.exec(LATE_MIGRATIONS).catch(() => undefined);
      return;
    }
  } catch {
    // 테이블이 아직 없는 첫 실행이다. 아래에서 전부 만든다.
  }

  await d.exec(SCHEMA);
  await d.exec(FACILITY_COLUMNS);
  await d.exec(LATE_MIGRATIONS);
  await lockDownTables();
  await seedAdmins();

  // 학교 실제 시설로 교체한다. 목록이 이미 최신이면 건너뛴다.
  const seeded = await get<{ c: number }>(
    'SELECT COUNT(*)::int AS c FROM facilities WHERE campus_name IS NOT NULL',
  );
  if (seeded && Number(seeded.c) === FACILITY_SEED.length) return;

  await run('DELETE FROM facilities', []);
  for (const f of FACILITY_SEED) {
    await run(
      `INSERT INTO facilities
         (system_key, campus_name, name, building, min_capacity, capacity, description)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [f.systemKey, f.campusName, f.name, f.building, f.minCapacity, f.maxCapacity, f.description],
    );
  }
}

let readyPromise: Promise<void> | null = null;

/** 스키마 준비를 한 번만 수행하고, 이후 호출은 같은 Promise를 재사용한다. */
export function ready(): Promise<void> {
  if (!readyPromise) {
    readyPromise = migrate().catch((err) => {
      // 실패한 Promise를 캐시하면 이후 요청이 영영 복구되지 않으므로 초기화한다.
      readyPromise = null;
      throw err;
    });
  }
  return readyPromise;
}
