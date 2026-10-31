/**
 * 라운지 DB 스키마 — 전부 멱등(여러 번 실행해도 안전)이라 서버가 뜰 때마다 실행해도 된다.
 * `server/db.ts` 의 migrate() 가 빠른 경로에서도 이 문자열을 한 번의 왕복으로 실행한다.
 *
 * 설계 메모
 *  - 모임(gatherings)·후보 방(quick rooms)은 문서(JSONB) 한 줄로 저장하고 `version` 으로 낙관적 잠금을 건다.
 *    선착순 자리 경쟁은 "읽고 → 도메인 함수 → UPDATE … WHERE version = ?" 를 충돌 시 다시 시도해서 푼다.
 *    (트랜잭션 없이도 두 사람이 같은 의자에 앉는 일이 없다 — server/lounge/repo/gatherings.ts 의 mutate())
 *  - 사용자 id 는 users.id(정수). 모임 문서 안에는 문자열로 들어간다.
 *  - 모든 라운지 테이블은 RLS 를 켠다. 서버는 DB 소유자 역할로 직접 연결하므로 영향이 없고,
 *    Supabase 의 공개 Data API(anon 키)로는 아무것도 읽을 수 없게 하는 이중 안전장치다.
 */

/** 라운지 테이블 이름 (RLS 일괄 적용용) */
export const LOUNGE_TABLES = [
  'lounge_gatherings',
  'lounge_messages',
  'lounge_room_leaves',
  'lounge_blocks',
  'lounge_reports',
  'lounge_quick_requests',
  'lounge_quick_rooms',
  'lounge_presence',
  'lounge_friends',
  'lounge_push_subscriptions',
  'lounge_notifications',
] as const;

export const LOUNGE_MIGRATIONS = `
  -- 프로필 · 평판 (기존 users 테이블에 컬럼만 덧붙인다)
  ALTER TABLE users ADD COLUMN IF NOT EXISTS nickname TEXT;
  ALTER TABLE users ADD COLUMN IF NOT EXISTS college TEXT;
  ALTER TABLE users ADD COLUMN IF NOT EXISTS department TEXT;
  ALTER TABLE users ADD COLUMN IF NOT EXISTS admission_year INTEGER;
  -- 성별: gender = 내 정보에서 고른 값, school_gender = 학교 계정에서 읽은 값(있으면 이쪽이 우선이고 바꿀 수 없다)
  ALTER TABLE users ADD COLUMN IF NOT EXISTS gender TEXT;
  ALTER TABLE users ADD COLUMN IF NOT EXISTS school_gender TEXT;
  ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar TEXT NOT NULL DEFAULT 'bear';
  -- 아바타는 캐릭터 이미지로 바뀌었다(키: turtle-smile …). 옛 키(bear 등)는 읽을 때 기본 캐릭터로 보이고, 새 행의 기본값은 새 키다.
  ALTER TABLE users ALTER COLUMN avatar SET DEFAULT 'turtle-smile';
  UPDATE users SET avatar = 'turtle-smile' WHERE avatar IN ('bear','rabbit','fox','cat','dog','panda','lion','frog','penguin','owl','tiger','koala');
  ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_color TEXT NOT NULL DEFAULT 'm1';
  ALTER TABLE users ADD COLUMN IF NOT EXISTS temperature DOUBLE PRECISION NOT NULL DEFAULT 36.5;
  ALTER TABLE users ADD COLUMN IF NOT EXISTS warnings INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE users ADD COLUMN IF NOT EXISTS banned BOOLEAN NOT NULL DEFAULT FALSE;
  ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_done BOOLEAN NOT NULL DEFAULT FALSE;

  -- 모임 (미팅 / 밥약 / 팀빌딩). data = shared/lounge/gathering.ts 의 Gathering 전체
  -- host_id 의 CASCADE 는 마지막 안전망일 뿐이다. 회원 탈퇴는 users 행을 지우기 전에 services/withdraw.ts 가
  -- 다른 참여자에게 주최를 넘기고(혼자인 모임만 메시지와 함께 지운다), 이 열도 data.hostId 와 같이 바꾼다.
  CREATE TABLE IF NOT EXISTS lounge_gatherings (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    host_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    meet_at TIMESTAMPTZ NOT NULL,
    status TEXT NOT NULL,
    data JSONB NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS idx_lounge_gatherings_kind ON lounge_gatherings(kind, meet_at);
  CREATE INDEX IF NOT EXISTS idx_lounge_gatherings_host ON lounge_gatherings(host_id);

  -- 단톡방 메시지 (방 id = 모임 id). room_id 는 FK 가 아니라서 모임을 지우는 쪽이 메시지도 함께 지워야 한다
  -- (탈퇴: services/withdraw.ts, 개발 시드: routes/dev.ts). 탈퇴한 사용자의 메시지는 본문을 지우고 안내(system)로 바꾼다.
  CREATE TABLE IF NOT EXISTS lounge_messages (
    id TEXT PRIMARY KEY,
    room_id TEXT NOT NULL,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    kind TEXT NOT NULL DEFAULT 'text',
    text TEXT NOT NULL,
    at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS idx_lounge_messages_room ON lounge_messages(room_id, at);

  -- 단톡방 나가기: 나간 사람은 그 방을 목록에서 지우고 다시 들어올 수 없다. 모임 참여 자체는 그대로 둔다
  -- (빠지면 정원이 비어 남은 사람들의 방이 닫히니까). room_id 는 메시지처럼 FK 가 아니다.
  CREATE TABLE IF NOT EXISTS lounge_room_leaves (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    room_id TEXT NOT NULL,
    at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, room_id)
  );
  CREATE INDEX IF NOT EXISTS idx_lounge_room_leaves_room ON lounge_room_leaves(room_id);

  -- 차단: 한쪽만 걸어도 양쪽에서 서로 사라진다
  CREATE TABLE IF NOT EXISTS lounge_blocks (
    blocker_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    blocked_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (blocker_id, blocked_id)
  );
  CREATE INDEX IF NOT EXISTS idx_lounge_blocks_blocked ON lounge_blocks(blocked_id);

  -- 신고
  CREATE TABLE IF NOT EXISTS lounge_reports (
    id TEXT PRIMARY KEY,
    reporter_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    target_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    context TEXT NOT NULL,
    ref_id TEXT,
    reason TEXT NOT NULL,
    detail TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'open',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    handled_at TIMESTAMPTZ,
    handled_by INTEGER REFERENCES users(id) ON DELETE SET NULL
  );
  CREATE INDEX IF NOT EXISTS idx_lounge_reports_target ON lounge_reports(target_id, status);

  -- 밥약 빠른 매칭: 대기표와 후보 방
  CREATE TABLE IF NOT EXISTS lounge_quick_requests (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    data JSONB NOT NULL,
    status TEXT NOT NULL,
    room_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS idx_lounge_quick_requests_user ON lounge_quick_requests(user_id, status);
  CREATE TABLE IF NOT EXISTS lounge_quick_rooms (
    id TEXT PRIMARY KEY,
    data JSONB NOT NULL,
    status TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  -- 라운지 접속자 위치. 사용자당 한 줄, seen_at 이 PRESENCE_TTL_SEC 안인 사람만 접속 중
  CREATE TABLE IF NOT EXISTS lounge_presence (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    x REAL NOT NULL,
    y REAL NOT NULL,
    zone TEXT NOT NULL,
    emote TEXT,
    emote_at TIMESTAMPTZ,
    seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS idx_lounge_presence_seen ON lounge_presence(seen_at);

  -- 관리 기록: 관리자 탭에서 한 조치 (services/admin.ts). 누가 언제 무엇을 했는지 대시보드에 보인다
  CREATE TABLE IF NOT EXISTS lounge_admin_log (
    id SERIAL PRIMARY KEY,
    admin_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    action TEXT NOT NULL,
    target TEXT NOT NULL DEFAULT '',
    detail TEXT NOT NULL DEFAULT '',
    at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS idx_lounge_admin_log_at ON lounge_admin_log(at);

  -- 친구: 아이디로 요청 → 상대가 수락하면 accepted. 한 쌍에 한 줄만 둔다 (요청한 사람 → 받은 사람)
  CREATE TABLE IF NOT EXISTS lounge_friends (
    requester_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    addressee_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    responded_at TIMESTAMPTZ,
    PRIMARY KEY (requester_id, addressee_id)
  );
  CREATE INDEX IF NOT EXISTS idx_lounge_friends_addressee ON lounge_friends(addressee_id);

  -- 폰 알림(웹 푸시) 구독: 기기(endpoint)마다 한 줄. services/push.ts
  CREATE TABLE IF NOT EXISTS lounge_push_subscriptions (
    endpoint TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS idx_lounge_push_user ON lounge_push_subscriptions(user_id);

  CREATE TABLE IF NOT EXISTS lounge_notifications (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    url TEXT NOT NULL,
    tag TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS idx_lounge_notifications_user ON lounge_notifications(user_id, created_at DESC);

  -- RLS: 공개 Data API 로는 접근할 수 없게 (서버는 소유자 역할이라 영향 없음)
  ${LOUNGE_TABLES.map((t) => `ALTER TABLE ${t} ENABLE ROW LEVEL SECURITY;`).join('\n  ')}
  DO $lounge$
  BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      ${LOUNGE_TABLES.map((t) => `REVOKE ALL ON public.${t} FROM anon, authenticated;`).join('\n      ')}
    END IF;
  END
  $lounge$;
`;
