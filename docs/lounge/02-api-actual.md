# 서버가 실제로 하는 일 (클라이언트 작업자용)

`01-contract.md` 가 설계이고 이 문서는 **구현 뒤에 확정된 사실**이다. 둘이 다르면 이 문서와 **서버 코드(`server/lounge/routes/*`, `server/school/index.ts`)** 가 맞다. 서버 코드는 읽기 전용이다. 서버가 아직 마무리 수정 중이라 세부 동작이 조금 바뀔 수 있으니, 의심스러우면 실제로 호출해서 확인한다.

## 공통
- 모든 응답에 `Cache-Control: no-store`. 오류 형식은 `{ error: string, code?: string }`. 클라이언트는 `ApiError(status, message, code, data)` 로 받는다(`data` 는 본문 전체).
- 알아야 할 `code`: `PROFILE_REQUIRED`(428 → `useLounge().handleError`), `BANNED`(403), `NOT_FOUND`(404), `INVALID`(400), `FORBIDDEN`(403), `CONFLICT`(409, 동시에 같은 자리를 눌러 진 경우 — "방금 다른 사람이 먼저 앉았어요" 후 목록 새로고침), `RATE_LIMITED`(429, 아직 공용 ErrorCode 에 없는 문자열 코드 — 상태코드 429 로도 처리).
- 라우트 목록: 라운지 `/api/lounge/{me,users/:id,presence,gatherings…,quick…,blocks…,reports,admin/…}`, 학교 `/api/school/{link,timetable/preview,timetable/import,reservations,book/preview,book/submit}`. 정확한 경로·본문은 `server/lounge/routes/*.ts` 와 `01-contract.md`.

## 프로필 · 접속자 (me, users, presence)
- `GET /me` → `MeResponse`. **프로필이 없어도 호출 가능**(`profile:null, needsProfile:true`). 정지 사용자도 호출 가능(`profile.banned/banReason`).
- `PUT /me` ← `ProfileInput` → `{profile}`. 닉네임은 NFC 로 저장, 학과는 공백 정리해 저장 → **응답 값을 그대로 쓴다**. 닉네임 길이는 이모지 한 개=1글자. 평판·권한 필드를 보내도 무시. 잘못된 값은 400 `INVALID` + 항목별 문장.
- `GET /users/:id` → `{user: PublicUser}`. **내 프로필이 없으면 428**. 없는/미완성/차단 관계는 모두 같은 404 본문(차단 여부를 구분할 수 없음).
- `POST /presence` ← `{x,y,zone,emote?}` → `{ok:true}`. zone 은 `plaza|meetup|meal` 만. x,y 는 0~1. 정지 사용자는 403 `BANNED`. **사용자당 분당 90회**(초과 429). `emote` 를 생략한 하트비트는 위치만 갱신.
- `GET /presence` → `PresenceResponse`. 나는 목록에서 빠지고 `count` 는 나 포함. `emote` 는 보낸 지 5초 안일 때만 채워진다(같은 이모트를 다시 눌러도 다시 보임). 위치는 float32 라 `0.6` 이 `0.6000000238…` 로 올 수 있다. 45초 넘게 신호가 없으면 사라진다. 차단 관계는 서로 보이지 않는다.
- `viewer.timetableConflict`: 모임 응답의 보는 사람 상태에 들어 있다. 시간표와 겹치면 수업 이름, 아니면 `null`. **막지 않는다** — "이 시간에 '○○' 수업이 있어요" 경고만.

## 개발용 시드
`POST /api/lounge/dev/seed` (로그인 불필요, `LOUNGE_DEV_SEED=1` 로 띄운 개발 서버에서만. 아니면 404). 데모 계정 `demo1~8@hansung.ac.kr` / 비밀번호 `Demo1234!`, 샘플 모임 id: `demo-meetup-open-a`, `demo-meetup-open-b`(한 자리 남음), `demo-meetup-full`(방 열림), `demo-meal-a`, `demo-meal-b`. 며칠 지나 다시 부르면 지난 샘플만 새 날짜로 다시 만들어진다. 관리자 계정은 `ADMIN_PASSWORD` 로 서버가 만든다(개발 서버: 비밀번호 `Test1234!`, 이메일은 `scripts/lib.mjs` 의 login 도우미 참고).

## 학교 연동 (`/api/school/*`)
- 모두 로그인 필요. **학교 기능(link 제외)은 요청마다 본문에 `creds:{studentId,password}` 를 실어야 한다.** 서버는 그 요청 안에서만 쓰고 버린다. 연동하지 않았거나 학번이 연동한 것과 다르면 409 `SCHOOL_NOT_LINKED`(학교에는 요청하지 않음).
- 상태코드: `SCHOOL_AUTH_FAILED` 422, `SCHOOL_REJECTED` 422, `SCHOOL_LOCKED` 429(+`Retry-After`, 본문에 `retryAfterSec`·`long` — 타입 `SchoolLockedDetail`), `SCHOOL_UNAVAILABLE` 502, `SCHOOL_NOT_LINKED` 409. 일반 코드 `INVALID` 400 · `NOT_FOUND` 404 · `FORBIDDEN` 403 · `RATE_LIMITED` 429(link 10분 3회, 그 밖 학교 호출 10분 20회).
- **가드: 연속 4회 실패까지 잠금 없음, 5회째 30분 잠금, 잠금이 끝나도 횟수 유지(6·7회째 실패는 다시 30분), 8회째 24시간 잠금, 성공하면 초기화.** 잠금 중에는 맞는 비밀번호를 넣어도 풀리지 않고 학교로 요청이 가지 않는다. 점검·네트워크 오류(502)는 실패로 세지 않는다. **`SCHOOL_AUTH_FAILED`/`SCHOOL_LOCKED` 뒤에는 절대 자동 재시도하지 않는다.**
- `GET /link` → `{linked,hint,linkedAt,cipher,profileHint{department,admissionYear|null}}`. `admissionYear` 는 학번 앞자리 추정이라 2015 보다 작을 수 있다(라운지 프로필 기본값으로 쓸 때 범위 확인).
- `POST /link` ← `{creds,cipher}`(cipher=`{v:1,iv,ct}`) → `{linked:true,hint,profile{studentId,name,department,admissionYear}}`. 재연동하면 암호문을 덮어쓴다. 응답에 비밀번호·암호문 없음. `DELETE /link` 로 해제.
- `POST /timetable/preview` 저장 안 함 / `POST /timetable/import` 는 학교에서 온 일정(`source='school'`)만 교체하고 직접 입력한 일정은 건드리지 않는다. 학교가 빈 시간표를 주면 기존 가져온 일정을 지우지 않고 `imported:0`. 한 번에 최대 100개. 수동 일정과 겹쳐도 막지 않는다.
- `POST /reservations` → `{reservations[],failed[]}`. 비밀번호가 틀리면 첫 로그인에서 중단하고 422.
- `POST /book/preview` `{creds,reservationId}` → `BookPreview`(`canBook=false` 면 `reason` 을 그대로 보여 준다). `POST /book/submit` `{creds,reservationId,items,tel?,email?}` → `status:'confirmed'`(내 신청내역에서 확인됨) 또는 `'unknown'`(보냈지만 확인 못 함 → **다시 보내지 말고** 학교 사이트에서 확인하라고 안내). 학교 검증 오류는 422 `SCHOOL_REJECTED` + 학교 문장 그대로(보내지 않았으므로 고쳐서 다시 시도 가능).
- **실제 학교와는 한 번도 통신해 보지 않았다**(가짜 학교로만 시험). 화면에서 "처음 연동 때 학교 응답이 달라 실패할 수 있다"는 안내 문구를 둔다.

## 이 문서에 아직 없는 것
모임(미팅·밥약), 빠른 매칭, 단톡방, 차단·신고, 관리자 API 의 세부는 `01-contract.md` 가 맞고 서버 코드가 그대로 따른다. 다른 점이 보이면 보고서 `openIssues` 에 적는다.
