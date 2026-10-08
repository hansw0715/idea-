# 서버 작업 공통 규칙 (S1·S2·S3·S4)

## 프로젝트
**상상Book-E** 라운지·학교 연동의 **서버** 작업이다. 네 명이 병렬로 일한다 (S1 라운지 코어 / S2 프로필·접속자·시드·시간표 연결 / S3 빠른 매칭 / S4 학교 계정 연동).
- 루트: `C:\Users\1lebe\OneDrive\Desktop\상상Book-E-claude` (이하 `ROOT`). **여기에만 쓴다.**
- 읽기 전용 참고: `C:\Users\1lebe\OneDrive\Desktop\cody`(예전 앱, 수정 금지), ZIP(원본 아이디어 코드 — 경로는 `docs/lounge/01-contract.md` 맨 위), 학교 API 파이썬(`ROOT\.tmp\reference\school-py\hansung_*.py` — S4만 읽는다).
- `C:\Users\1lebe\OneDrive\Desktop\아이디어 경진대회` 는 다른 도구가 쓰는 폴더다. **읽지도 쓰지도 않는다.** `.env` 는 열지 않는다.

## 반드시 먼저 읽을 것
1. 자기 지시서 (`docs/lounge/tasks/S?-*.md` 또는 `docs/school/tasks/S4-server.md`)
2. `docs/lounge/00-overview.md`, `docs/lounge/01-contract.md` (S4 는 추가로 `docs/school/00-design.md`)
3. 이미 있는 기반: `shared/lounge/*`(공용 타입·상수·DTO — **고치지 않는다**), `shared/school/types.ts`, `server/lounge/{schema,users,http,index,timetableConflict}.ts`, `server/db.ts`(헬퍼 `all/get/run/insert`, `?` 자리표시자 → `$n` 자동 변환), `server/auth.ts`(`requireAuth`, `userId(res)`, `wrap`), `server/rateLimit.ts`.

## 코드 규칙
- TypeScript strict, ESM(`type: module`), 서버 tsconfig 는 **NodeNext** → 상대 import 에 `.js` 확장자를 붙인다 (`import { x } from './y.js'`). 공용 계약은 `../../shared/lounge/index.js` 처럼 상대 경로로.
- 주석은 한국어로, "왜"를 적는다 (기존 코드 톤: 규칙의 이유·위험을 한두 문장).
- 도메인(순수 함수, DB·시간·랜덤 의존 없음) / repo(SQL) / services(둘을 잇고 부수효과를 **await**) / routes(검증 + `sendResult`) 로 나눈다. 라우트는 판단하지 않고 검증·변환만 한다.
- SQL 은 항상 파라미터 바인딩(`?`). 문자열 이어 붙이기 금지. JSONB 컬럼에는 `JSON.stringify(...)` 로 넣고 읽을 때 객체로 받는다 (pg 는 jsonb 를 객체로, PGlite 도 동일 — 둘 다에서 동작하는지 확인).
- 응답에 실명·이메일·학과·비밀번호 해시를 넣지 않는다. 오류 메시지에 내부 정보(SQL, 스택)를 넣지 않는다.
- 새 npm 패키지는 추가하지 않는다 (vitest 는 이미 있음).

## 소유권 (충돌 방지)
- **자기 지시서에 적힌 파일만 만들고 고친다.** `shared/*`, `server/db.ts`, `server/app.ts`, `server/lounge/{schema,users,http,index}.ts`, `package.json`, 클라이언트(`client/`)는 고치지 않는다. 필요한 변경은 보고서 `foundationRequests` 에 "무엇을, 왜" 로 적는다.
- 다른 작업자의 파일(예: S1 이 S2 의 `timetableConflict.ts`)은 **정해진 함수 시그니처로 import 만** 한다. 상대 파일이 아직 자리표시여도 시그니처가 같으니 컴파일된다.
- 개발 서버(3101, 5273)를 끄거나 다시 띄우지 않는다. 자기 서버를 띄울 때는 §테스트의 방법으로 **임시 DB·다른 포트**를 쓴다. 시연 DB 를 건드리지 않는다. `git` 명령 금지.

## 검증
- 타입: `node_modules/.bin/tsc -p server/tsconfig.json` (남의 파일의 일시적 오류는 잠시 뒤 다시 — 고치지 않는다). 도메인 테스트: `node_modules/.bin/vitest run <경로>`.
- API 를 직접 불러 확인한다(Node `fetch` 스크립트 또는 curl, 쿠키는 `Set-Cookie` 를 받아 `Cookie` 로). 임시 서버: `DATA_DIR=<ROOT/.tmp/서브작업명-db> API_PORT=<작업별 포트> ADMIN_PASSWORD=<임의> LOUNGE_DEV_SEED=1 node_modules/.bin/tsx server/index.ts` (포트: S1 3211, S2 3212, S3 3213, S4 3214). 끝나면 서버를 끄고 임시 DB 폴더는 남겨 둬도 된다.
- 사용자 만들기: 가입은 이메일 코드가 필요하므로, 임시 DB 에 직접 `INSERT INTO users …`(bcryptjs 해시) 하는 테스트 도우미를 `ROOT/.tmp/` 에 만들어 쓰거나 S2 의 `/dev/seed`(`LOUNGE_DEV_SEED=1`)가 준비되면 그것을 쓴다. 로그인은 `POST /api/auth/login` → `Set-Cookie: token`.
- **정직한 보고**: 확인한 것과 못 한 것을 구분한다. 못 돌려 본 경로를 돌렸다고 쓰지 않는다.

## 보고서 (JSON 스키마 하나)
`{ summary, filesChanged[], checklist[{item, status: done|changed|missing, note}], testsAdded[], apiNotes(문자열: 클라이언트 작업자가 알아야 할 실제 동작·주의), foundationRequests[], openIssues[] }`
