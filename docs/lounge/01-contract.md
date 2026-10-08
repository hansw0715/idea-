# 라운지 — 서버 계약 (API · 규칙 · 저장)

> **⚠ 셔틀버스 기능은 사용자 지시로 범위에서 완전히 삭제되었다.** 이 문서나 다른 지시서에 셔틀·정류장·`/api/bus`·`BusSheet`·`bus` 구역이 남아 있어도 **무시한다**(만들지도, 없다고 지적하지도 않는다). 지도 구역은 광장·미팅 라운지·밥약 식당 셋이다.

타입은 `shared/lounge/*`(이미 작성됨)가 진실이다. 이 문서는 **동작 규칙**을 정한다.
원본 도메인 코드: `ROOT\.tmp\reference\idea-zip\src` (읽기 전용, `ZIP` 이라 부른다. 수정 금지)

## 0. 공통

- 모든 `/api/lounge/*` 는 로그인(JWT 쿠키) 필요. 라우터 기반은 `server/lounge/index.ts` (이미 있음): `requireAuth → withUser → meRouter → /admin(requireAdmin) → requireProfile → 나머지`.
- 오류 응답: `{ "error": "사람이 읽는 문장", "code": "SLOT_FULL" }` + HTTP 상태(`ERROR_STATUS`). `sendResult(res, result, map?, status?)` / `sendError` / `handler(fn)` 는 `server/lounge/http.ts` 에 있다. 처리 중 예외(throw)는 기존 전역 오류 처리기로 간다(500).
- **도메인은 예외를 던지지 않고 `Result` 를 돌려준다** (`shared/lounge/types.ts` 의 ok/fail). 순수 함수 + `now: ISODateTime` 을 인자로 받는다 (테스트 가능).
- 사용자 id 는 문자열(`String(users.id)`). 모임 문서 안의 id 도 문자열. 시각은 ISO 문자열.
- 실명(`users.name`)·이메일·학과(`department`)는 어떤 응답에도 넣지 않는다. 학과는 서버 안에서 "같은 과 제외/같은 과만" 비교에만 쓴다.
- 속도 제한은 기존 `server/rateLimit.ts` 의 `createRateLimiter(max, windowMs)` (인스턴스 메모리 — 서버리스에선 약하지만 기능이 깨지지 않는다). 키는 사용자 id. 초과 시 429 + `code: "RATE_LIMITED"` + 동작별 문장 (`RATE_LIMITED` 는 `shared/lounge/types.ts` 의 `ErrorCode`·`ERROR_STATUS` 에 있다 — 클라이언트는 문자열이 아니라 이 코드로 분기한다).

| 동작 | 제한 |
|---|---|
| presence 쓰기 | 분당 90 |
| 메시지 보내기 | 분당 40 |
| 모임 만들기 | 10분당 10 |
| 빠른 매칭 신청 | 10분당 10 |
| 신고 | 하루 20 (24h 창) |

## 1. 프로필 · 사용자 (S2) — `routes/me.ts`

- `GET /me` → `MeResponse`. 프로필 없이도 호출 가능. `profile` 은 `profileDone` 일 때만 (아니면 null, `needsProfile: true`). `isAdmin = users.is_admin`.
- `PUT /me` ← `ProfileInput` → `{ profile }`. 검증:
  - `nickname`: 앞뒤 공백 제거 후 2~8자(코드포인트 기준), 공백 연속 금지, `@` 와 제어문자 금지, 금칙 없음(욕설 필터는 이번 단계 제외). 중복 허용.
  - `college` ∈ `COLLEGES`, `department` 1~30자, `admissionYear` 정수 `ADMISSION_YEAR_MIN ≤ y ≤ 올해(KST)`, `avatar` ∈ `AVATARS`, `avatarColor` ∈ `AVATAR_COLORS`.
  - 저장하며 `profile_done = TRUE`. 이미 만든 프로필도 같은 API 로 고친다(평판 컬럼은 건드리지 않는다).
  - 위반 시 `INVALID` + 어느 항목이 왜 틀렸는지 문장.
- `GET /users/:id` → `{ user: PublicUser }`. 없는 사용자·프로필 미완성·**차단 관계(서로)** 이면 404 `NOT_FOUND`(차단 사실을 드러내지 않는다).

## 2. 접속자(presence) (S2) — `routes/presence.ts`

- `POST /presence` ← `PresenceInput` → `{ ok: true }`. `x,y ∈ [0,1]` 숫자, `zone ∈ ZONES`, `emote ∈ EMOTES.key`(선택). **이용 정지(`banned`) 사용자는 403 `BANNED`**. `lounge_presence` upsert(`seen_at = now()`), `emote` 가 오면 `emote/emote_at` 갱신. 한 사용자 한 줄.
- `GET /presence` → `PresenceResponse`. `seen_at` 이 `PRESENCE_TTL_SEC` 안인 사람, 나 제외, **차단 관계(서로) 제외**, 프로필 있는 사람만, 최대 200명. `emote` 는 `emote_at` 이 `EMOTE_TTL_MS` 안일 때만. `count = users.length + 1`. 가끔(요청 100번에 1번 꼴 또는 `seen_at` 이 10분 넘은 행이 있을 때 한 번의 DELETE) 오래된 행을 정리한다.
- 프레임당 부하: **핸들러 안**의 쿼리는 2개 이내(차단 목록 + 접속자·프로필 조인)가 되게 한다. 모든 라운지 요청이 거치는 `withUser`(로그인 사용자 한 건 조회, 기본키)가 더해져 **HTTP 요청 하나는 3쿼리**다 — 정지·프로필 상태를 요청마다 새로 확인해야 해서 일부러 캐시하지 않는다. 더 줄이려면 차단 목록을 접속자 SQL 의 `NOT EXISTS (… lounge_blocks …)` 로 합쳐 총 2개로 맞춘다(아직 하지 않음).
- 탈퇴: `DELETE /api/auth/me` 는 사용자 행을 지우기 전에 라운지 자료를 정리한다 — 주최 중인 모임은 가장 먼저 앉은 다른 참여자에게 넘기고(혼자인 모임만 메시지와 함께 삭제), 승인 대기 신청은 지우고, 쓴 메시지는 본문을 지워 `탈퇴한 사용자의 메시지예요.` 안내(system)로 바꾼다. 탈퇴자의 자리는 `unknownUser` 로 남는다. (`server/lounge/services/withdraw.ts`)

## 3. 모임 (S1) — `routes/gatherings.ts`

### 3.1 저장과 동시성 — **가장 중요**
- `lounge_gatherings.data` 에 `Gathering` 전체(JSONB), `status/meet_at/kind/host_id` 는 인덱스용 사본, `version` 은 낙관적 잠금.
- 모든 변경은 `mutateGathering(id, (g) => Result<Gathering>)` 하나로 한다: ① 읽기(+version) ② 도메인 함수 ③ `UPDATE … SET data=?, status=?, meet_at=?, version=version+1 WHERE id=? AND version=?` ④ 0행이면(다른 요청이 먼저 바꿈) **처음부터 다시**(최대 6회, 짧은 지연), 끝내 실패하면 `CONFLICT`. 두 사람이 같은 의자에 동시에 앉으면 정확히 한 명만 성공하고 다른 한 명은 다시 읽은 뒤 `SLOT_FULL` 을 받아야 한다 — **이걸 동시성 테스트로 증명**한다(같은 모임에 20명이 동시에 앉기 → 정원만큼만 성공).
- 결과가 성공이고 정원이 막 찼으면(`isFull` 이 false→true) 단톡방을 연다: `lounge_messages` 에 system 메시지(`SYSTEM_OPEN_MESSAGE`) 한 줄, **방(모임 id)에 메시지가 하나도 없을 때만** (멱등).

### 3.2 도메인 규칙 (ZIP `domain/gathering/gathering.ts` 를 그대로 옮기고 테스트 `gathering.test.ts` 도 옮긴다)
`createGathering`, `join`(선착순, auto 정책), `apply`(승인제), `approve`, `reject`, `leave`(마감 전만, 주최자 불가), `cancel`, `submitReview`(모임 시각 이후만, 참여자끼리, 자기 자신 불가, 덮어쓰기), `currentStatus`(open/full/closed/cancelled/done), `isNoshowConfirmed`(그 사람 뺀 나머지 **전원** noshow), 조회 헬퍼. ZIP 의 `Result/fail` 은 `shared/lounge/types` 것을 쓴다. 에러 코드·문구는 ZIP 과 같다(`ERROR_MESSAGES`).

### 3.3 서비스 규칙 (ZIP `server/service.ts`)
- 만들기: 프로필 있음(미들웨어), `banned` 이면 `BANNED`('이용이 제한된 계정은 모임을 만들 수 없습니다.'), `kind` 는 `meetup`/`meal` 만(`team` 은 400 `INVALID` — 이번 단계 미지원), 미팅은 `joinPolicy:auto`+`MEETUP_PRESETS` 자리, 밥약은 `approval`+`MEAL_PRESET`. 서버가 `slots/joinPolicy` 를 프리셋으로 **다시 만든다**(클라이언트가 보낸 자리 구성은 프리셋과 같을 때만 허용, 아니면 INVALID). `title` 1~60자, `body` ≤ 300, `place` 1~40, `meta.tags` ≤ 6개 각 ≤ 20자, `meta.placeType ∈ PLACE_TYPES`, `meta.menu ∈ MENU_CATEGORIES`, `excludeSameDept` 는 미팅에서만. `meetAt` 은 미래, `joinDeadline ≤ meetAt`.
- 참여(`join`/`apply`) 전 검사(순서): 차단 — 주최자·참여자 중 내가 차단했거나 나를 차단한 사람이 있으면 `FORBIDDEN` '차단한 사용자가 있는 모임이에요.'(조회에서는 404 로 숨김) → **같은 과 제외**(`meta.excludeSameDept` 이고 주최자·참여자 중 나와 `department` 가 같은 사람이 있으면 `FORBIDDEN` '같은 학과는 참여할 수 없는 미팅이에요.') → 도메인 함수(정지 여부·마감·정원 등).
- `reviewParticipant` → 도메인 `submitReview` 성공 후 **평판 반영(멱등)**:
  - 이전에 내가 그 사람에게 남긴 평가(`prev`)와 새 평가(`next`)로 온도 변화 = `(next==='good'?+GOOD_DELTA:0) − (prev==='good'?+GOOD_DELTA:0)` — 같은 평가를 다시 눌러도 온도가 또 오르지 않는다(ZIP 은 매번 올려서 연타로 올릴 수 있었다 — 고친다). 0 이 아니면 `addTemperature`.
  - 노쇼: 이 평가로 **처음** `isNoshowConfirmed` 가 true 가 된 순간에만 `confirmNoshowDb`(온도 −5, 경고 +1, 경고 ≥ 2 면 정지). 이미 확정된 뒤 다시 평가해도 중복 경고 없음.
- 부수효과(평판·단톡방)는 **같은 요청 안에서 await** 한다 (서버리스는 응답 뒤에 작업이 멈출 수 있어 fire-and-forget 금지).

### 3.4 조회와 DTO (ZIP `shared/view.ts` + `server/present.ts`)
- `toView(g, usersMap, viewer, now, conflict?)` → `GatheringView`(shared). `viewer` 필드 계산은 ZIP 과 같고, `blockedReason` 은 비로그인 분기 없이: 이미 참여 `이미 참여 중` / 신청 `승인 대기 중` / `취소된 모임` / `끝난 모임` / `마감 (정원 참)` / `신청 마감` / 정지 사유(`banReason`). `roomOpen = isFull || status==='done'`. 탈퇴한 사용자 자리는 `unknownUser`.
- `viewer.timetableConflict`: `timetableConflicts(viewerId, items)`(S2 제공, `server/lounge/timetableConflict.ts`)로 목록 전체를 **한 번에** 계산해 채운다(`durationMin`: 밥약 60, 미팅 120). 내가 이미 참여한 모임에는 채우지 않아도 된다.
- `GET /gatherings?kind=` : `meetAt > now − 24h` 인 것, **차단 관계 모임 제외**, 최대 100개. 밥약은 `sortMealFeed`(남은 약속 가까운 순, 끝난 건 아래로), 그 외는 최신순. `kind` 가 이상하면 400.
- `GET /gatherings/:id` : 없거나 차단 관계면 404.
- `GET /mine` : 내가 주최·참여·신청한 모임 중 취소되지 않았고 `meetAt > now − 7일`, `meetAt` 오름차순, 최대 50.
- `POST /gatherings/:id/:action` : ZIP `[action]/route.ts` 와 같다 — `join {slotKey}` `apply {slotKey,message≤200}` `approve {userId}` `reject {userId}` `leave` `cancel` `review {userId, mark}`. 알 수 없는 action 404, 본문 검증 실패 `INVALID`. 응답 `{ gathering: GatheringView }`.

### 3.5 단톡방 (ZIP `domain/chat` + `server/chat-service.ts`)
- 방 id = 모임 id. `GET /gatherings/:id/messages?after=ISO` → `{ room: RoomView }`: 방이 열렸고(`roomOpen`) 내가 참여자일 때만(아니면 `NOT_OPEN`/`FORBIDDEN` — ZIP 문구 그대로). 차단한 사람의 메시지는 `text:'차단한 사용자의 메시지예요.'`, `kind:'system'` 으로 가린다. `after` 가 있으면 그 이후 메시지만(폴링). 최근 200개.
- `POST /gatherings/:id/messages {text}` → 같은 `RoomView`. 길이 `MAX_MESSAGE_LENGTH`, 빈 문자열 금지, 읽기 전용(취소·종료) 이면 막는다. 정지 사용자는 `BANNED`.

## 4. 빠른 매칭 (S3) — `routes/quick.ts`, ZIP `features/mealdate/*` 를 옮긴다 (테스트 `quick-match.test.ts` 포함)
- 규칙은 ZIP 과 같다: 조건 일치(`date·placeType·size` 같고 `bands` 교집합 있음, `같은 과만` 태그는 서로 `dept:` 태그 같아야), 오래 기다린 사람부터 채움, 후보 방(`ROOM_TTL=QUICK_ROOM_TTL_MIN`), 시간 투표, **전원 수락** 시 확정 → 진짜 밥약(`Gathering`, kind meal, joinPolicy auto, 자리는 확정 인원)으로 `materialize` → 단톡방 열림. 한 명이라도 거절·만료면 방이 깨지고 나머지는 대기열로.
- 저장: `lounge_quick_requests`(문서+status+room_id), `lounge_quick_rooms`(문서+version). **방 만들기 경쟁**: 그룹을 찾으면 각 대기표를 `UPDATE … SET status='matched', room_id=? WHERE id=? AND status='waiting'` 로 선점하고(영향 행 수 확인), 하나라도 실패하면 이미 선점한 것을 `waiting` 으로 되돌리고 방을 만들지 않는다(다음 요청이 다시 시도). 방 상태 변경(투표·수락)은 `version` 낙관적 잠금 + 재시도.
- 만료 정리(`sweep`)는 읽을 때마다 한다(별도 스케줄러 없음). 정지 사용자는 신청 불가(`BANNED`), 지난 시간대만 고르면 INVALID, 이미 대기 중이면 `ALREADY_JOINED`.
- `GET/POST/PATCH/DELETE /meals/quick` → `{ state: QuickState }` (`PatchBody` 는 투표 또는 수락/거절). `QuickState.members` 는 `PublicUser`, `meId` 는 내 id, `waitingCount` 는 대기 중인 사람 수. 다른 사람의 대기표 내용은 내려보내지 않는다.

## 5. 안전 (S1) — `routes/safety.ts`, ZIP `domain/safety` + `server/safety-service.ts` (테스트 `safety.test.ts` 포함)
- `GET /blocks` → `{ blocked: PublicUser[] }`(내가 차단한 사람). `POST /blocks {userId}`(자기 자신 INVALID, 없는 사용자 404, 멱등). `DELETE /blocks {userId}`(멱등).
- 차단은 **한쪽만 걸어도 양쪽**의 목록·접속자·매칭·사용자 조회에서 서로 사라진다. 상대에게 알리지 않는다.
- `POST /reports {userId, context, refId, reason, detail}` → `{ ok:true }`: 자기 자신 INVALID, `reason ∈ REPORT_REASONS`, `detail ≤ REPORT_DETAIL_MAX`, **같은 (신고자, 대상, refId) 의 열린 신고가 있으면** `INVALID` '이미 신고한 건이에요. 관리자가 확인 중입니다.', 저장 후 서로 다른 신고자의 열린 신고가 `AUTO_RESTRICT_REPORTS` 이상이면 대상 `banned=true`(이미 정지면 그대로).

## 6. 관리자 (S1) — `routes/admin.ts` (미들웨어가 `requireAdmin`)
- `GET /admin/reports` → `{ reports: ReportView[] }` 최신순 200. `POST /admin/reports {reportId, action}`: `resolve`(조치 완료), `dismiss`(반려), `ban`(정지), `unban`(정지 해제 — 온도는 두고 **경고 0 + banned false**, 그 사람에 대한 **열린 신고 전부 dismissed**: 다시 자동 제한에 안 걸리게). 처리자/시각 기록.
- `GET /admin/stats` → `AdminStats`: `users`(프로필 만든 수, 정지 수, 평균 온도 — 프로필 만든 사용자 기준), `gatherings`(kind별 total/open(open+full)/done/cancelled/participants), `noshow`(끝난 모임 참여자 중 확정 노쇼 비율).

## 7. (삭제됨) 셔틀
사용자 지시로 셔틀버스 기능 전체(노선·시간표·실시간 위치·기사 화면·관리자 편집)를 범위에서 뺐다. `/api/bus`, `lounge_bus_*` 테이블, `shared/lounge/bus*.ts` 는 만들지 않는다.

## 8. 시간표 연결 (S2) — `server/lounge/timetableConflict.ts`
`timetableConflicts(userId, items)` : 사용자의 `timetable_entries`(weekly: `day` 가 KST 요일(0=월)과 같음 / once: `date` 가 KST 날짜와 같음)를 한 번 읽고, 각 모임 `[meetAt, meetAt+durationMin)`(KST 분 단위)과 `start_min < 끝 && end_min > 시작` 으로 겹치면 그 수업 이름을 맵에 넣는다(여러 개면 첫 번째). 주말이면 겹침 없음.

## 9. 개발용 시드 (S2) — `routes/dev.ts` (운영에서는 절대 열리지 않음)
`LOUNGE_DEV_SEED=1` **이고** `NODE_ENV !== 'production'` 이고 서버리스가 아닐 때만 `/api/lounge/dev/*` 를 마운트한다(`server/lounge/index.ts` 는 이미 이 조건 자리를 가지고 있다 — S2 가 조건을 켠다). `POST /dev/seed` (로그인 불필요) → 데모 사용자 8명(`demo1~8@hansung.ac.kr`, 비밀번호는 응답에 `password` 로 돌려줌, 이미 있으면 건너뜀) + 프로필(닉네임·단과대·학과·학번·아바타 다양하게) + 샘플 모임(미팅 2:2 열린 것 2개 중 1개는 한 자리만 남기기, 밥약 모집글 2개, 정원이 막 찬 미팅 1개 + 단톡방 시스템 메시지)을 만든다. 멱등.

## 10. 테스트
- 도메인 순수 함수: ZIP 의 vitest 테스트를 가져와 import 만 고친다 (gathering 296줄, reputation, safety, chat, quick-match). `npm test` 가 통과해야 한다.
- 동시성 테스트(§3.1)와 평판 멱등 테스트는 **새로** 쓴다 (PGlite 임시 DB — `DATA_DIR` 을 임시 폴더로, 실행 중인 개발 DB 와 절대 겹치지 않게).
- 서버를 직접 띄워 확인할 때: `DATA_DIR=<임시폴더> API_PORT=<3201~3299 중 비어 있는 것> ADMIN_PASSWORD=<임의> LOUNGE_DEV_SEED=1 node_modules/.bin/tsx server/index.ts`. **개발 서버(3101)와 그 DB 를 건드리지 않는다.**
