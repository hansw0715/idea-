# 작업 C5 — 학교 계정 연동 클라이언트 (암호화 금고 · 가입 3단계 · 시간표 가져오기 · 학교 바로 신청)

**학생의 학교 비밀번호를 다루는 화면이다.** 먼저 읽는다: `docs/lounge/tasks/00-client-common.md`(공통) → `docs/school/00-design.md`(**전부** — 보안 모델 §1, 안전 규칙 §3, API §4, 화면 흐름 §7, 테스트 정책 §8) → `shared/school/types.ts` → `docs/UI-KIT.md`.
서버는 이미 구현되어 있다(`/api/school/*`, `docs/lounge/02-api-actual.md` 의 학교 절). 실제 학교 사이트로 자동 테스트하지 않는다(10번 실패 시 학교 계정이 잠긴다) — 화면은 **mock 응답**(Playwright `page.route`)과 고정 fixture 로 확인한다.

## 담당 파일
```
client/src/school/vault.ts            AES-GCM 봉인·해제, 키는 localStorage (주입 가능한 storage/crypto 로 테스트 가능하게)
client/src/school/vault.test.ts       금고 단위 테스트 (vitest)
client/src/school/api.ts              schoolApi (GET/POST/DELETE /school/*)
client/src/school/errors.ts           SchoolErrorCode → 한국어 문구 (+ 키 없음 오류)
client/src/school/SchoolContext.tsx   (자리표시를 실제 구현으로 교체 — 계약 인터페이스 유지)
client/src/school/SchoolLinkForm.tsx  연동 폼(동의 + 학번 + 비밀번호) — 가입 3단계와 시트가 공용
client/src/school/SchoolLinkSheet.tsx 연동 시트(내 정보에서)
client/src/school/SchoolLinkCard.tsx  (자리표시를 채운다 — `<SchoolLinkCard />` props 없음)
client/src/school/SchoolTimetableSheet.tsx   시간표 미리보기 → 가져오기
client/src/school/SchoolReservationsSheet.tsx 내 학교 예약
client/src/school/SchoolBookSheet.tsx 학교 바로 신청(미리보기 → 확인 → 제출 → 결과)
client/src/school/school.css          (접두사 school-)
client/src/pages/Signup.tsx           3단계(학교 계정 연동, 선택) 추가 — 기존 1·2단계 동작 회귀 금지
client/src/pages/TimetablePage.tsx    연동되어 있으면 "학교 시간표 가져오기" 버튼 + 가져온 뒤 목록 새로고침만 **삽입**
client/src/pages/MeetingDetail.tsx    예약 현황 행에 "학교에 바로 신청하기"만 **삽입** (필요하면 components/BookingFlow.tsx 의 성공 안내에도)
vitest.config.ts                      include 에 'client/src/**/*.test.ts' 한 줄 추가 허용 (이 파일은 이 작업만 고친다)
```
`pages/Account.tsx` 는 **C4 가 고친다**(SchoolLinkCard 를 넣는 일은 C4 가 한다). 이 작업은 건드리지 않는다.

## 체크리스트
**금고 (vault.ts) — 보안의 핵심**
- [ ] 키: `crypto.subtle.generateKey({name:'AES-GCM',length:256}, true, ['encrypt','decrypt'])` → raw export → base64 → `localStorage['sangsang-booke:school-key:'+userId]`. **사용자 id 별로 분리**(같은 브라우저의 다른 계정 키와 섞이지 않는다).
- [ ] `seal(userId, creds, keyBytes?)`: JSON → UTF-8 → AES-GCM(12바이트 무작위 IV) → `SealedBox{v:1, iv, ct}`(base64). **추가 인증 데이터(AAD)에 `"sangsang-booke:school:v1:"+userId` 를 묶어** 다른 계정으로 옮겨 붙인 암호문이 풀리지 않게 한다. `open(userId, sealed)`: 실패(키 없음·키 불일치·변조·AAD 불일치·형식 오류)는 모두 `SchoolKeyMissingError`(같은 문구 — 원인을 구분해 알려 주지 않는다).
- [ ] **새 키는 서버가 연동을 확인해 준 뒤에만 저장한다**: `link` 는 새 키를 메모리에 만들어 봉인 → `POST /school/link` → 성공하면 그때 localStorage 에 새 키 저장(실패하면 기존 키를 그대로 둔다 — 기존 암호문이 아직 유효하다).
- [ ] `forget(userId)`: 키 삭제. localStorage 접근 불가(프라이빗 모드·차단)면 `link` 단계에서 명확한 오류("이 브라우저는 저장소를 쓸 수 없어 학교 연동을 쓸 수 없어요").
- [ ] 평문(creds)은 React 상태·localStorage·sessionStorage·URL·콘솔 어디에도 두지 않는다. 입력 폼 상태는 제출 직후 비운다. `withCredentials(fn)` 안에서만 존재.
- [ ] 단위 테스트(vitest, Node 의 WebCrypto + 메모리 storage 주입): 왕복, 다른 키 실패, 변조 실패, **다른 사용자 id 로 열면 실패**, 같은 평문도 매번 다른 암호문(IV), 키가 사용자별로 분리, `link` 실패 시 기존 키 유지(컨텍스트 단위 테스트 가능하면), 평문이 암호문 JSON 에 포함되지 않음.

**SchoolContext (계약 `SchoolState` 유지)**
- [ ] 로그인한 동안 `GET /school/link` 로 상태(`linked/hint/profileHint/cipher`) 로드(`loading`), `canUse = linked && 이 브라우저에 키 있음`. 로그아웃하면 상태 비움. `refresh`.
- [ ] `link(creds)`: 위 규칙. 성공 시 `SchoolProfile` 반환(이름·학과 — 화면에서 확인용으로만, 저장하지 않는다). 오류는 `ApiError(code)` 그대로 던진다(문구는 `errors.ts` 가 만든다).
- [ ] `withCredentials(fn)`: `canUse` 가 아니면 `SchoolKeyMissingError`, 맞으면 암호문을 풀어 `fn(creds)` 호출 후 평문 참조를 놓는다. 호출한 쪽이 오류를 `schoolErrorMessage(err)` 로 보여 준다. `SCHOOL_AUTH_FAILED`/`SCHOOL_LOCKED` 가 오면 상태를 `refresh` 하고 화면에 "다시 연동" 안내(자동 재시도 금지).
- [ ] `unlink()`: `DELETE /school/link` + 키 삭제 + 상태 갱신.

**연동 폼·시트 (KRDS "동의" + "개인 식별 정보 입력")**
- [ ] 수집 목적·보관 방식·한계를 평문으로 먼저 안내(접어 두지 않는다, 짧게): "학교 시간표 가져오기와 시설 신청을 대신 하려고 학교 포털 학번·비밀번호를 한 번 확인해요 / 저장되는 건 암호문뿐이고 풀 수 있는 키는 이 기기에만 있어요 / 학교 기능을 쓰는 순간에는 우리 서버가 요청 처리를 위해 잠깐 사용하고 바로 버려요(저장·기록하지 않아요) / 언제든 연동을 해제할 수 있어요 / 기기마다 키가 달라 마지막으로 연동한 기기에서만 쓸 수 있어요". `SCHOOL_PASSWORD_WARNING` 은 비밀번호 칸 바로 아래에.
- [ ] 동의 체크박스("학교 계정 정보 수집·이용에 동의합니다") 필수 — 체크 전에는 버튼 비활성+이유. 학번(`inputMode="numeric"`, `isStudentId` 검사, 오류 문장), 비밀번호(`PasswordField`, `autoComplete="off"` — 우리 서비스 비밀번호로 자동완성되지 않게 `name` 을 `school-pw` 로), 제출 "연동하기"(처리 중 "학교에 확인하는 중…", 중복 제출 방지).
- [ ] 오류: `SCHOOL_AUTH_FAILED` → "학번 또는 비밀번호가 맞지 않아요. 다시 시도하기 전에 학교 포털에서 먼저 로그인해 확인해 주세요. 10번 틀리면 계정이 잠겨요." / `SCHOOL_LOCKED` → "학교 계정이 잠기지 않도록 학교 로그인을 잠시 멈췄어요. 30분 뒤에 다시 시도할 수 있어요."(서버가 24시간 잠금을 알리면 "24시간 동안 멈췄어요. 학교 포털에서 직접 로그인해 비밀번호를 확인해 주세요") / `SCHOOL_UNAVAILABLE` / 429 / 네트워크. **자동 재시도 없음**, 오류 뒤에 비밀번호 칸은 비운다. 필드 오류는 `aria-describedby`.
- [ ] 성공 화면: 확인된 이름·학과(예: "박○○님, AI응용학과로 확인했어요" — 이름은 가려서), "학교 시간표를 지금 가져올까요?"(Primary) / 나중에(Tertiary). 시트에서는 닫기.

**가입 3단계 (Signup.tsx)**
- [ ] 단계 표시기를 3단계로(이메일 확인 → 정보 입력 → 학교 연동). 2단계 가입 성공 후 **`setUser` 를 아직 부르지 않고** 3단계를 보여 준다(서버 쿠키는 이미 로그인 상태라 `/school/*` 가 동작). 3단계: 연동 폼 + "나중에 하기"(건너뛰기). 끝나거나 건너뛰면 그때 `setUser(user)` → 홈으로. 3단계에서 새로고침/이탈해도 이미 가입·로그인된 상태가 깨지지 않는다(다음 방문은 `/auth/me` 로 복구).
- [ ] 기존 1·2단계의 모든 동작(코드 10분 카운트다운, 다시 받기, 이메일 다시 입력, 검증, 오류)은 그대로.

**SchoolLinkCard (내 정보 카드)**
- [ ] 상태: 연동 안 됨(설명 + "학교 계정 연동하기") / 연동됨(`***044`, 연동한 날짜, "학교 시간표 가져오기", "내 학교 예약 보기", "다시 연동", "연동 해제"(`useConfirm`: 암호문과 이 기기의 키가 지워진다)) / 연동됐지만 **이 기기에서는 쓸 수 없음**(`!canUse`: "다른 기기에서 연동했어요. 이 기기에서 쓰려면 다시 연동해 주세요" + 다시 연동).

**시간표 가져오기 (SchoolTimetableSheet + TimetablePage)**
- [ ] `withCredentials` → `POST /school/timetable/preview` → 요일별 목록(과목·시간·강의실·교수), `adjusted`(30분 격자 맞춤 N건 안내)·`skipped` 목록과 이유. "가져오기" 전 확인 문장: "학교에서 가져왔던 기존 일정은 새 일정으로 바뀌고, 직접 입력한 일정은 그대로예요." → `POST /school/timetable/import` → 결과 토스트("N개 수업을 가져왔어요") → `onImported` 로 시간표 새로고침. 수업이 없으면 EmptyState. 오류는 코드별 문구.
- [ ] TimetablePage: 연동(`linked && canUse`)되어 있을 때만 "학교 시간표 가져오기" 버튼(헤더 영역, Secondary) — 기존 "일정 추가" 버튼과 자리를 다투지 않게. 연동은 됐는데 `!canUse` 이면 버튼 대신 다시 연동 안내.

**내 학교 예약 (SchoolReservationsSheet)**: `POST /school/reservations` → 시스템별 목록(`facilityLabel`, 번호·공간·날짜·시간·상태 배지·신청일), 조회 실패한 시스템 안내(`failed`), 빈 상태.

**학교 바로 신청 (SchoolBookSheet + MeetingDetail)** — 가장 조심스러운 흐름
- [ ] MeetingDetail 예약 현황 행에서 `school_status !== 'confirmed'` 이고 연동되어 있으면 "학교에 바로 신청하기"(Secondary sm). 연동 안 됐으면 기존 안내만(링크로 학교 사이트 열기) — 연동 유도 한 줄.
- [ ] 시트: ① `POST /school/book/preview {creds, reservationId}` → `BookPreview`. `canBook=false` 면 `reason` 을 그대로 보여 주고 제출 버튼 없음(`alreadySubmitted` 면 "이미 신청을 보냈어요. 학교 사이트에서 확인하고 '학교 예약 확인'을 눌러 주세요"). ② 신청서: 신청자(이름·학번·연락처·이메일 — 연락처·이메일은 수정 가능), 신청 대상·담당, **추가 항목 입력**(필수 `*`, 필수 누락 시 제출 불가+이유), ③ 요약(어느 시설·언제·누구 이름으로 신청되는지) + 체크박스 "위 내용으로 학교에 신청하는 것에 동의해요" + Primary "학교에 신청하기"(처리 중 "신청 중…", **한 번 누르면 비활성, 결과가 나올 때까지 닫지 않는다**). ④ 결과: `confirmed` → 성공 `Alert`("학교 신청내역에서 확인했어요") + 우리 예약 상태 갱신(`onResult` → `loadAll()`), `unknown` → 경고 `Alert`("신청을 보냈지만 확인하지 못했어요. 자동으로 다시 보내지 않아요. 학교 사이트에서 확인해 주세요") + 학교 사이트 링크 + 닫기. **어떤 경우에도 자동 재전송 금지.**
- [ ] 미리보기와 제출 사이에 상태가 바뀌어 서버가 `SCHOOL_REJECTED`(학교 문장)를 주면 그 문장을 그대로 보여 주고 입력은 보존.

**접근성·견고성**: 모든 입력 라벨·오류 `aria`, 시트 포커스 처리, 키보드 완전 조작, 360px 가로 넘침 없음, 글자 150%·선명한 화면, 터치 44px. 학교 응답 지연(최대 ~25초)을 고려해 진행 표시와 취소 불가 안내.

## 확인 (실제 학교 접속 금지)
- 단위: `node_modules/.bin/vitest run client/src/school`.
- 화면: Playwright `page.route('**/api/school/**', …)` 로 mock(성공·`SCHOOL_AUTH_FAILED`·`SCHOOL_LOCKED`·`SCHOOL_UNAVAILABLE`·느린 응답)을 주고 모든 흐름을 눌러 본다. **실제 브라우저에서 키가 localStorage 에만 생기고, 서버로 가는 `cipher` 에 평문 학번·비밀번호가 없음을 요청 본문으로 확인**하고, `creds` 가 `link`/학교 요청 본문에만 실리는지(그 밖의 요청·localStorage·sessionStorage·콘솔·URL 에는 없는지) 점검한다. 가입 3단계는 새 사용자로(`/auth/signup` 은 mock, 이메일 코드 필요) 확인.
- 확인한 것과 못 한 것(특히 **실제 학교와의 연동**)을 구분해 보고한다.

## 서버 구현 후 확정된 사항 (S4 보고서 반영)
- `ApiError.data` 에 오류 본문 전체가 들어온다(`client/src/api.ts`). `SCHOOL_LOCKED` 는 `data.retryAfterSec`(남은 초)와 `data.long`(true=24시간 안전선 잠금) 을 읽는다 — 타입은 `shared/school/types.ts` 의 `SchoolLockedDetail`. `long` 이면 "학교 포털에서 직접 로그인해 비밀번호를 확인한 뒤 다시 연동해 주세요" 를 보여 준다.
- 학교 API 는 `SchoolErrorCode` 밖의 코드도 돌려준다: `INVALID`(400) · `NOT_FOUND`(404) · `FORBIDDEN`(403) · `RATE_LIMITED`(429, `SchoolGeneralErrorCode`). 모르는 코드는 상태코드·메시지로 처리한다.
- `SCHOOL_AUTH_FAILED`·`SCHOOL_LOCKED` 뒤에는 **자동 재시도를 하지 않는다.** 사용자가 직접 다시 누를 때만 보낸다.
- 시간표 가져오기는 학교가 빈 시간표를 주면 기존 가져온 일정을 지우지 않는다(`imported: 0`). 이 경우 "가져올 수업이 없어요" 로 안내한다. 한 번에 최대 100개.
- `book/submit` 의 `status: 'unknown'` 은 "보냈지만 확인 못 함" — 다시 보내기 버튼을 두지 않고 "학교 사이트에서 신청 내역을 확인해 주세요" 로 안내한다.
