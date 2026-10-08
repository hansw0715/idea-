# 작업 S4 — 학교 계정 연동 서버 (로그인 · 시간표 · 내 학교 예약 · 바로 신청)

**이 작업은 학생의 학교 비밀번호를 다룬다. 가장 조심스러운 작업이다.** 먼저 읽는다:
1. `docs/lounge/tasks/00-server-common.md` (공통 규칙)
2. `docs/school/00-design.md` — **전부.** 보안 모델(§1), 학교 API(§2), 안전 규칙(§3), API(§4), DB(§5), 변환 규칙(§6), 테스트 정책(§8)
3. `shared/school/types.ts` (계약 타입 — 고치지 않는다)
4. 파이썬 원본 4개 (`ROOT\.tmp\reference\school-py\hansung_info (1).py`, `hansung_timetable (1).py`, `hansung_facility.py`, `hansung_facility_tui.py`) — 설계 문서의 §2 가 요약이지만 **원본을 직접 읽고 대조한다**. (`account.txt` 는 없다. 실제 계정으로 학교에 로그인하는 시도는 **절대 하지 않는다** — §8.)
5. 기존 `server/campusSchedule.ts`(공개 예약 현황 파서)·`server/facilities.ts`·`server/reservations.ts`·`server/timetable.ts` — 겹치지 않게 재사용할 것과 건드리지 않을 것을 파악한다.

## 담당 파일
```
server/school/http.ts          학교 호스트 고정 fetch: 쿠키 jar(Domain/Path 반영, 인스턴스별), 수동 리다이렉트, 10초 타임아웃, 2MB 제한, EUC-KR 디코딩, 항상 같은 User-Agent
server/school/info.ts          info.hansung.ac.kr: login / fetchProfile / fetchTimetable
server/school/resve.ts         hansung.ac.kr/resve: 사이트별 login, spaces, setup, info, items, booked, mine, 신청 컨텍스트·페이로드·제출
server/school/parse.ts         순수 파서·변환(프로필·시간표·공간 목록·내 신청내역·슬롯 상태·30분 격자 변환·슬롯 펼치기)
server/school/guard.ts         DB 기반 로그인 실패 가드 + 사용자 호출 제한
server/school/facilityMap.ts   우리 facilities(system_key+campus_name) → 학교 예약 시스템 키·공간 매핑, 지원 시스템 목록
server/school/service.ts       link / timetable preview·import / reservations / book preview·submit 흐름
server/school/schema.ts        §5 의 SQL (SCHOOL_MIGRATIONS) — **이미 만들어져 있고 db.ts 가 실행하도록 연결돼 있다.** 필요하면 보강한다(멱등 유지)
server/school/index.ts         `schoolRouter` (자리표시를 채운다. 인증·no-store 는 app.ts 가 이미 건다)
server/school/**/*.test.ts     파서·변환·가드·슬롯·페이로드·서비스 흐름(mock fetch) 테스트
```
- **schema 연결은 이미 되어 있다**: `server/db.ts` 의 migrate() 가 `LOUNGE_MIGRATIONS` 다음에 `SCHOOL_MIGRATIONS` 를 실행한다. `ready()` 를 부르면 테이블·컬럼이 생긴다.
- 새 npm 패키지 금지: Node 내장 `fetch`/`TextDecoder('euc-kr')`/`crypto` 만 쓴다.

## 체크리스트
**학교 클라이언트 (파이썬 → TypeScript, 동작 동일)**
- [ ] `http.ts`: 허용 호스트는 `info.hansung.ac.kr`, `hansung.ac.kr` 둘뿐(그 외 URL 은 예외), `fetch(..., { redirect:'manual', signal: AbortSignal.timeout(10000) })`, `Set-Cookie` 를 jar 에 쌓고 다음 요청에 `Cookie` 로 보냄(Domain 속성 `.hansung.ac.kr` 반영), 응답은 `arrayBuffer` 로 받아 필요 시 `euc-kr` 디코딩, 본문 2MB 초과 시 중단. 학교 응답 본문·요청 본문을 **로그에 남기지 않는다**.
- [ ] `info.ts`: `loginInfo(creds)`(`GET /` → `POST gong_login_ssl`, 성공 = `ssotoken` 쿠키, 실패 시 `SchoolAuthFailed` — **재시도 없음**), `fetchProfile`(학번·이름·학과 파싱, 구조가 바뀌면 `SchoolUnavailable`), `fetchTimetable`(JSON 파싱 실패 → `SchoolUnavailable`).
- [ ] `resve.ts`: 공개 조회(`spaces/setup/info/items/booked`), 사이트별 `login`(`hnuLogin/<사이트>/loginProcess.do`, 성공 = 302 + `ssotoken`), `mine`(페이지 반복, 중단 조건 ‘첫 행 번호 중복·최대 20쪽’), 신청: 컨텍스트 로드(`artclRegistView.do` → `actionForm` 확인, 입력값 추출) → 페이로드(필드 순서까지 파이썬과 동일, `resveTm` 반복, 추가 항목) → **AJAX 서버 검증**(`layout=""`, 비어 있어야 통과) → 본 제출 → `mine` 로 재확인.
- [ ] `parse.ts`(순수): 프로필/시간표/공간 목록(`<select id="resveSpceSeq">`)/내 신청내역(`<tr>`·`<td>`)/`slotStates`(운영 요일·기간·`posblTm` 리드타임·예약됨)/`toGrid`(§6: 시작 내림·끝 올림·범위 밖 자르기·길이 0 건너뜀·`adjusted` 집계·중복 제거)/`expandSlots`(우리 `[startMin,endMin)` → 슬롯 시작 시각들, 단위에 안 맞으면 이유 반환). 학교 HTML/JSON 을 흉내 낸 **고정 fixture** 로 테스트(파이썬이 파싱하는 모양 그대로).

**안전 가드 (§3 — 이게 핵심)**
- [ ] `guard.ts`: `student_hash = sha256(학번 + 서버 비밀값)`(서버 비밀값은 `JWT_SECRET` 또는 `server/auth.ts` 가 쓰는 같은 비밀 파생 — 새 비밀을 만들지 말고 `crypto.createHmac('sha256', secret)` 로). 로그인 **직전** `assertNotLocked`, 실패 `recordFailure`, 성공 `recordSuccess`(0 으로 초기화). 잠금이면 학교에 요청하지 않고 `SCHOOL_LOCKED`. **규칙(사용자가 정함)**: 학교는 10번 틀리면 **계정을 잠근다**(초기화가 아님). 그래서 **연속 5회 실패 → 30분 잠금**. 잠금이 끝나도 `fails` 는 0 으로 돌리지 않고 유지(잠금 뒤 또 틀리면 6, 7…회째로 이어져 다시 30분 잠금), **연속 8회에 이르면 24시간 잠금**(학교 한도 10회에 절대 닿지 않게 하는 안전선 — 이 안전선은 설계서 §3 에 있다). 성공하면 전부 초기화. 상수는 `SCHOOL_LOCK_AFTER=5`, `SCHOOL_LOCK_MIN=30`, `SCHOOL_HARD_LOCK_AFTER=8`, `SCHOOL_HARD_LOCK_HOURS=24` 로 한 곳에 둔다.
- [ ] 한 요청 안에서 같은 사이트에 로그인은 최대 1회(예: `/reservations` 는 사이트마다 1회, 같은 사이트 키들은 로그인 공유). 어떤 경로에서도 실패 후 자동 재시도 없음 — 테스트로 증명(mock fetch 호출 횟수).
- [ ] `/link` 호출 제한: 사용자당 10분 3회(DB 또는 `createRateLimiter`). 학번 형식 `isStudentId`, 비밀번호 1~64자, cipher 형식 검사(`v===1`, `iv` base64 → 정확히 12바이트, `ct` base64 → 17~2048바이트).
- [ ] 평문이 로그·오류·응답·DB 어디에도 안 나가는 것: 오류를 만들 때 creds 를 문자열에 넣지 않는다. 전역 오류 처리기가 `console.error(err)` 하므로 학교 오류 객체에 creds·요청 본문을 달지 않는다. 테스트: 가짜 비밀번호로 실패 흐름을 돌리고 `console.*` 출력을 가로채 비밀번호 문자열이 포함되지 않음을 확인.

**서비스·라우트** (설계 §4)
- [ ] `GET /link`(없으면 `linked:false`), `POST /link`(검증 → 학교 1회 로그인 → 프로필 → cipher/hint/학과·입학년도 저장 → `LinkResponse`), `DELETE /link`.
- [ ] `POST /timetable/preview`, `POST /timetable/import`(§6: 새 일정 먼저 `source='school'` 이 아닌 임시 값으로 삽입 → 기존 `source='school'` 삭제 → 임시 값을 `school` 로 갱신. 직접 입력한 일정 불변. `timetable_entries` 열은 `server/timetable.ts` 의 INSERT 와 같은 모양).
- [ ] `POST /reservations`(지원 예약 시스템 전체의 내 신청내역, 로그인 사이트당 1회, 실패한 시스템은 `failed`).
- [ ] `POST /book/preview`: `reservationId` 의 소유 확인(그 회의 멤버), 시설 매핑(`facilityMap`), 공간·설정 조회(공개), 슬롯 펼치기, 상태 확인, 로그인해 신청 화면 프로필(이름·학번·전화·이메일)과 추가 항목·신청 대상·담당을 읽어 `BookPreview` 로. `canBook=false` 이면 이유(예: 시설 매핑 없음, 단위 불일치, 이미 예약됨, 이미 신청함, 지난 시간).
- [ ] `POST /book/submit`: 위 검증을 **다시** 하고(미리보기와 제출 사이에 상태가 바뀔 수 있다) `school_bookings` 에 먼저 `submitted` 기록(중복 방지: 같은 예약 계획에 `confirmed/submitted/unknown` 이 있으면 거절) → 제출 → `mine` 재확인 → 있으면 `confirmed`(그리고 우리 `reservations.school_status='confirmed'`), 없으면 `unknown`(**자동 재전송 없음**, 메시지로 학교 사이트 확인 안내). 서버 검증 오류는 `SCHOOL_REJECTED` + 학교가 준 문장 그대로.
- [ ] 오류 코드: `SchoolErrorCode`(shared) 를 응답 `code` 로. 상태코드: AUTH_FAILED 401? **아니다** — 우리 앱 로그아웃(401 인터셉터)과 섞이면 안 되므로 `SCHOOL_AUTH_FAILED` 는 **422**, `SCHOOL_LOCKED` 429, `SCHOOL_UNAVAILABLE` 502, `SCHOOL_REJECTED` 422, `SCHOOL_NOT_LINKED` 409.
- [ ] 모든 응답 본문에 비밀번호·cipher(GET /link 제외)를 넣지 않는다. `GET /link` 만 cipher 를 돌려준다.

**테스트 (실제 학교 접속 금지 — mock fetch 와 고정 fixture)**
- [ ] 파서·변환(`toGrid` 경계: 09:15→09:00, 10:45→11:00, 21:50→22:00, 주말, 22시 넘김, 중복), 슬롯 상태·펼치기, 페이로드(필드 순서·`resveTm` 반복), 가드(4회 실패까지는 잠금 없음·5회째 30분 잠금·잠금 만료 후에도 횟수 유지·8회째 24시간 잠금·성공 초기화·잠금 중 학교 호출 0회), 서비스 흐름(link 성공/실패, import 교체가 수동 일정 불변, book submit 중복 거절·unknown 처리), 평문 누출 없음.

## 확인과 보고
- 임시 서버(포트 3214, 임시 DB, `SCHOOL_MIGRATIONS` 적용)에서 mock 학교(로컬에 띄운 가짜 HTTP 서버를 `http.ts` 가 테스트 모드에서만 허용하도록 **주입 가능한 base URL** 로 — 운영 코드는 학교 호스트 화이트리스트를 유지)로 `/link`→`/timetable/import`→`/book/preview` 를 돌려 본다.
- 보고서에 반드시: 실제 학교와는 **검증하지 못한 항목**(로그인 판정, 신청 폼 필드, hsel 신청 가능 여부, 해외 IP 차단 여부 등)을 구체적으로 나열한다.
