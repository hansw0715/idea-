# 캠퍼스 스페이스 (Campus Space)

교내 시설 예약 서비스. 팀원들의 시간표를 모아 **공통 여유 시간**을 자동으로 찾고,
그 시간에 이용 가능한 교내 시설을 바로 예약할 수 있습니다.

## 주요 기능

- **회원가입 / 로그인** — 이메일 + 비밀번호(bcrypt 해시), JWT httpOnly 쿠키 세션
- **개인 시간표** — 월~금 09:00~21:00, 30분 단위로 수업·고정 일정 등록/삭제
- **회의(팀) 관리** — 회의 생성 시 6자리 참가 코드 발급, 코드로 참가, 나가기/삭제
- **회의 예약** — 팀원 전체 시간표를 조합해 공통 여유 시간 계산 → 날짜·시작 시간 선택 →
  해당 시간에 비어 있는 시설 목록 확인 → 예약. 서버에서 시설 충돌·팀원 수업 겹침을 재검증
- **대시보드** — 내 시간표 미리보기, 참여 중인 회의, 다가오는 예약

## 기술 스택

| 구분 | 스택 |
|---|---|
| 서버 | Express 4 + TypeScript, PostgreSQL(`pg`) — 로컬은 PGlite, 배포는 Supabase |
| 인증 | bcryptjs + jsonwebtoken (httpOnly 쿠키) |
| 클라이언트 | React 19 + Vite + TypeScript, react-router v6 |
| 디자인 | goorm 레퍼런스 디자인 시스템 (Pretendard Variable, Vapor Blue `#2a72e5`) |

## 실행 방법

```bash
npm install
npm run dev
```

- 클라이언트: http://localhost:5173 (Vite, `/api`는 서버로 프록시)
- API 서버: http://localhost:3001 (`API_PORT` 환경 변수로 변경 가능)
- 데이터: 로컬 PGlite (최초 실행 시 테이블 자동 생성 + 시설 시드 데이터 삽입)

타입 검사:

```bash
npm run typecheck
```

프로덕션 빌드(빌드 후 `npm start` 하면 Express가 정적 파일까지 서빙):

```bash
npm run build
npm start
```

## 데이터베이스

**PostgreSQL**을 사용하며 배포 환경에서는 **Supabase**에 연결합니다.

로컬 개발에서는 `DATABASE_URL`이 없으면 **PGlite**(파일에 저장되는 임베디드 Postgres)로 자동
전환되므로, Postgres를 따로 설치하지 않아도 `npm run dev`가 바로 됩니다. 로컬 데이터는
`~/.campus-space/pgdata`에 저장됩니다. 프로젝트가 OneDrive·Dropbox 같은 동기화 폴더 안에 있으면
DB 파일이 동기화 도중 교체되어 데이터가 사라질 수 있어, 자동으로 동기화되지 않는 경로를 씁니다.

로컬에서도 Supabase에 직접 붙어 보려면 [.env.example](.env.example)을 `.env`로 복사해 값을 채우고
`npm run dev`를 다시 실행하면 됩니다. `.env`는 git에 올라가지 않습니다.

연결 문자열이 잘못되면 회원가입 시 **"데이터베이스에 연결하지 못했습니다"** 라는 503 응답이
화면에 그대로 표시되므로, 설정 실수인지 앱 버그인지 바로 구분할 수 있습니다.

## 환경 변수

| 변수 | 필요 시점 | 설명 |
|---|---|---|
| `DATABASE_URL` | 배포 시 **필수** | Supabase Postgres 연결 문자열. 없으면 로컬 PGlite를 씁니다 |
| `JWT_SECRET` | 배포 시 **필수** | 세션 서명 키. 없으면 인스턴스마다 달라져 로그인이 끊깁니다 |
| `NODE_ENV` | 선택 | 서버리스에서는 자동으로 `Secure` 쿠키가 적용되므로 설정하지 않아도 됩니다 |
| `DATA_DIR` | 선택 | 로컬 PGlite 데이터 위치 |
| `API_PORT` | 선택 | 단일 서버 실행 시 포트 (기본 3001) |

## 배포하기

### 공통 1단계 — Supabase 연결 문자열 구하기

Supabase 대시보드에서 프로젝트를 열고 `Connect` (또는 `Settings` → `Database`)로 들어가
**Transaction pooler** 연결 문자열을 복사합니다. 서버리스에서는 연결이 잘게 쪼개지므로
직접 연결(5432)이 아니라 **풀러(6543)** 를 써야 합니다.

형태는 다음과 같습니다.

```
postgresql://postgres.<프로젝트ref>:<비밀번호>@aws-0-<리전>.pooler.supabase.com:6543/postgres
```

테이블은 앱이 첫 요청에서 자동 생성하지만, Supabase의 `SQL Editor`에 [schema.sql](schema.sql)을
붙여넣어 미리 만들어 두면 첫 요청이 빨라지고 결과를 눈으로 확인할 수 있습니다.

세션 서명 키는 아래 명령으로 만듭니다.

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### Vercel

`vercel.json`이 준비돼 있습니다. `api/index.ts`가 Express 앱을 서버리스 함수로 노출하고,
`client/dist`가 정적 파일로 서빙됩니다.

```bash
npm install -g vercel
```

```bash
vercel login
```

프로젝트 설정에 `DATABASE_URL`, `JWT_SECRET` 두 개를 등록한 뒤:

```bash
vercel --prod
```

### Netlify

`netlify.toml`과 `netlify/functions/api.ts`가 준비돼 있습니다.

```bash
npm install -g netlify-cli
```

```bash
netlify login
```

같은 환경 변수 2개를 등록한 뒤:

```bash
netlify deploy --prod
```

### Fly.io

`Dockerfile`과 `fly.toml`이 준비돼 있습니다. 서버리스가 아니라 상시 실행 컨테이너라
Supabase의 **직접 연결(5432)** 을 써도 되고 풀러를 써도 됩니다.

```bash
fly auth login
```

`fly.toml`의 `app = "campus-space"`를 유일한 이름으로 바꾼 뒤:

```bash
fly apps create campus-space-내이름
```

```bash
fly secrets set DATABASE_URL="postgresql://..." JWT_SECRET="..."
```

```bash
fly deploy
```

### 서버리스에서의 제약

로그인·회의 참가·예약 등 모든 기능이 정상 동작하지만, 무차별 대입 방지용 레이트리밋은
인스턴스 메모리에 저장되므로 서버리스에서는 인스턴스마다 따로 세어집니다.
효과가 약해질 뿐 기능이 깨지지는 않으며, 더 엄격히 막아야 한다면 카운터를 DB로 옮기면 됩니다.

## 프로젝트 구조

```
server/            Express API (TypeScript, tsx로 실행)
  app.ts           Express 앱 조립 (모든 배포 방식이 공유)
  index.ts         단일 서버 실행 진입점 (로컬 / Fly.io)
  db.ts            Postgres 연결(pg/PGlite), 쿼리 헬퍼, 스키마, 시설 시드
  auth.ts          회원가입/로그인/세션, requireAuth 미들웨어
  dates.ts         날짜 엄격 검증 + 서비스 표준시(KST) 처리
  rateLimit.ts     의존성 없는 고정 윈도 레이트리미터
api/index.ts       Vercel 서버리스 함수 진입점
netlify/functions/ Netlify 함수 진입점 (serverless-http)
  timetable.ts     개인 시간표 CRUD
  meetings.ts      회의 생성/참가/멤버/공통 여유 시간 계산
  facilities.ts    시설 목록 + 시간대별 가용 여부
  reservations.ts  예약 생성/조회/취소 (충돌·팀원 시간표 재검증)
  freeTime.ts      구간 병합/여집합 알고리즘
client/
  src/pages/       Login, Signup, Dashboard, TimetablePage, Meetings, MeetingDetail
  src/components/  TimetableGrid (개인/다인 레인 겹침 렌더링)
  src/styles.css   goorm 디자인 시스템 토큰·컴포넌트
```

## 시간 모델

- 모든 시각은 자정 기준 **분 단위 정수**로 저장합니다 (09:00 = 540).
- 시간표는 요일(0=월 ~ 4=금) 기반 주간 반복, 예약은 실제 날짜(`YYYY-MM-DD`) 기반입니다.
- 공통 여유 시간 = 운영 시간(09:00~21:00)에서 **모든 팀원의 busy 구간 합집합**을 뺀 구간.
