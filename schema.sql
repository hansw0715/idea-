-- 캠퍼스 스페이스 스키마 (PostgreSQL / Supabase)
--
-- 앱이 첫 요청 때 자동으로 만들기 때문에 반드시 실행할 필요는 없습니다.
-- 다만 Supabase SQL Editor에서 미리 한 번 실행해 두면 첫 요청이 빨라지고,
-- 테이블이 제대로 만들어졌는지 눈으로 확인할 수 있습니다.

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS timetable_entries (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day INTEGER NOT NULL,
  start_min INTEGER NOT NULL,
  end_min INTEGER NOT NULL,
  title TEXT NOT NULL,
  place TEXT NOT NULL DEFAULT ''
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

CREATE INDEX IF NOT EXISTS idx_timetable_user ON timetable_entries(user_id);
CREATE INDEX IF NOT EXISTS idx_reservations_facility_date ON reservations(facility_id, date);
CREATE INDEX IF NOT EXISTS idx_members_user ON meeting_members(user_id);

-- 보안: Supabase는 새 테이블에 anon(공개 키) 권한을 자동 부여합니다.
-- 그대로 두면 공개 키만으로 users 테이블의 비밀번호 해시까지 읽힙니다.
-- RLS를 켜고(정책이 없으면 전면 거부) 권한도 회수합니다.
-- 앱은 RLS를 우회하는 postgres 역할로 접속하므로 정상 동작합니다.
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE timetable_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE meetings ENABLE ROW LEVEL SECURITY;
ALTER TABLE meeting_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE facilities ENABLE ROW LEVEL SECURITY;
ALTER TABLE reservations ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON users, timetable_entries, meetings, meeting_members, facilities, reservations
  FROM anon, authenticated;

-- 시설 시드 데이터 (비어 있을 때만 넣습니다)
INSERT INTO facilities (name, building, capacity)
SELECT * FROM (VALUES
  ('스터디룸 A', '상상관 6층', 6),
  ('스터디룸 B', '상상관 6층', 6),
  ('세미나실 1', '학술정보관 2층', 8),
  ('세미나실 2', '학술정보관 2층', 8),
  ('회의실 301', '미래관 3층', 12),
  ('프로젝트룸', '공학관 4층', 10),
  ('미디어룸', '창의관 1층', 4),
  ('그룹학습실', '학술정보관 4층', 15)
) AS seed(name, building, capacity)
WHERE NOT EXISTS (SELECT 1 FROM facilities);
