/**
 * 학교 계정 연동 DB 스키마 — 멱등. `server/db.ts` 의 migrate() 가 라운지 스키마와 함께 실행한다.
 * 설계: docs/school/00-design.md §5.  (담당: 작업 S4 — 필요하면 보강한다)
 *
 * 암호문(school_cipher)은 브라우저가 만든 AES-GCM 결과뿐이다. 서버는 키를 모른다.
 */
export const SCHOOL_TABLES = ['school_login_guard', 'school_bookings', 'school_link_probe'] as const;

export const SCHOOL_MIGRATIONS = `
  ALTER TABLE users ADD COLUMN IF NOT EXISTS school_cipher TEXT;
  ALTER TABLE users ADD COLUMN IF NOT EXISTS school_hint TEXT;
  ALTER TABLE users ADD COLUMN IF NOT EXISTS school_linked_at TIMESTAMPTZ;
  ALTER TABLE users ADD COLUMN IF NOT EXISTS school_department TEXT;
  ALTER TABLE users ADD COLUMN IF NOT EXISTS school_gender TEXT;
  ALTER TABLE users ADD COLUMN IF NOT EXISTS school_admission_year INTEGER;
  -- 연동한(학교 로그인으로 확인된) 학번의 HMAC. school_hint(끝 3자리)는 화면 표시용일 뿐이라 같은 끝자리의 다른 학번이
  -- 통과해 버리므로, 학교와 상호작용하기 전에 "이 사용자의 학번이 맞는가"는 이 값으로만 판단한다. 학번 원문은 저장하지 않는다.
  ALTER TABLE users ADD COLUMN IF NOT EXISTS school_student_hash TEXT;

  -- 학교에서 가져온 일정과 직접 입력한 일정을 구분한다 ('school' = 가져온 것)
  ALTER TABLE timetable_entries ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'manual';

  -- 학교 로그인 실패 가드: 학번 원문 대신 해시. fails = 연속 실패 횟수(성공하면 0). 5회째부터 잠시 멈추고(locked_until),
  -- 8회에 이르면 시간이 아니라 fails 로 계속 막아 학교의 계정 잠금(10회 실패)에 닿지 않게 한다. 규칙은 server/school/guard.ts 한 곳에 있다.
  -- 같은 테이블의 "<해시>:<사이트>" 키 행은 신청 흐름이 확인되지 않은 예약 사이트의 로그인 실패 후 쉬는 시간(locked_until)이다.
  CREATE TABLE IF NOT EXISTS school_login_guard (
    student_hash TEXT PRIMARY KEY,
    fails INTEGER NOT NULL DEFAULT 0,
    first_fail_at TIMESTAMPTZ,
    locked_until TIMESTAMPTZ
  );

  -- 확인되지 않은 학번(내가 연동한 학번이 아닌 것)으로 /link 를 시도해 만든 실패 기록 (사용자, 학번 HMAC 쌍별).
  -- 한 사용자가 남의 학번으로 학교 로그인을 두드려 그 학번의 공유 가드(school_login_guard)를 소진시키지 못하게 상한을 둔다.
  -- 윈도(24시간)가 지난 행은 의미가 없고, 사용자를 지우면 함께 지워진다.
  CREATE TABLE IF NOT EXISTS school_link_probe (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    student_hash TEXT NOT NULL,
    fails INTEGER NOT NULL DEFAULT 0,
    first_fail_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, student_hash)
  );

  -- 학교에 보낸 예약 신청 기록: 같은 예약 계획을 두 번 보내지 않게 한다
  CREATE TABLE IF NOT EXISTS school_bookings (
    id SERIAL PRIMARY KEY,
    reservation_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS idx_school_bookings_reservation ON school_bookings(reservation_id);
  -- 같은 예약 계획에는 '진행 중/확인됨/불명' 기록이 하나만 있을 수 있다. 동시에 두 번 눌러도 DB 가 한 번만 통과시킨다.
  -- (status: submitted = 보내는 중, confirmed = 신청내역에서 확인, unknown = 보냈지만 확인 못 함, failed = 보내기 전에 중단)
  CREATE UNIQUE INDEX IF NOT EXISTS uq_school_bookings_active ON school_bookings(reservation_id)
    WHERE status IN ('submitted', 'confirmed', 'unknown');

  ${SCHOOL_TABLES.map((t) => `ALTER TABLE ${t} ENABLE ROW LEVEL SECURITY;`).join('\n  ')}
  DO $school$
  BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      ${SCHOOL_TABLES.map((t) => `REVOKE ALL ON public.${t} FROM anon, authenticated;`).join('\n      ')}
    END IF;
  END
  $school$;
`;
