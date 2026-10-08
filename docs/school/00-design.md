# 학교 계정 연동 — 설계

사용자가 가입할 때(또는 내 정보에서) **학교 포털 학번·비밀번호를 한 번 연동**하면, 우리 플랫폼이 학교 사이트와 대신 상호작용한다:
개인 시간표 가져오기 · 내 학교 예약 보기 · 시설 바로 신청 · (라운지 프로필 기본값: 학과·입학년도).

원본 분석 대상: 사용자가 보내 준 파이썬 4개 (`hansung_info`, `hansung_timetable`, `hansung_facility`, `hansung_facility_tui`).
TUI 는 화면일 뿐 새 API 가 없다. 아래 §2 가 파이썬이 쓰는 학교 API 의 전부다.

## 1. 보안 모델 (정직한 버전)

| 무엇 | 어디에 | 누가 풀 수 있나 |
|---|---|---|
| 복호화 **키** (AES-GCM 256, 무작위) | 이 브라우저의 `localStorage` (`sangsang-booke:school-key:<사용자id>`) | 이 브라우저(=사용자)만 |
| **암호문** (SealedBox: v, iv, ct) | 우리 DB `users.school_cipher` | 키 없이는 아무도 못 푼다 (우리 서버·DB 유출자 포함) |
| **평문** 학번·비밀번호 | 어디에도 저장하지 않는다 | 학교와 상호작용하는 **그 요청 하나** 동안만 서버 메모리에 존재 |

- 연동할 때: 브라우저가 평문을 요청 본문(`creds`)에 실어 `/api/school/link` 로 보낸다 → 서버가 학교에 **한 번** 로그인해 검증 → 성공하면 *브라우저가 만든 암호문*만 저장.
- 이후 학교 기능을 쓸 때: 브라우저가 `GET /api/school/link` 로 암호문을 받아 **localStorage 의 키로 풀고**, 그 평문을 해당 요청 본문에 실어 보낸다 → 서버는 그 요청 안에서만 쓰고 버린다.
- 서버는 키를 한 번도 받지 않는다. 따라서 DB 백업·유출·관리자 열람으로는 학교 비밀번호를 얻을 수 없다.
- **한계(문서·화면에 숨기지 않는다)**: 학교 사이트는 비밀번호 로그인만 받기 때문에, 학교 기능을 쓰는 순간에는 우리 서버가 평문을 잠깐 본다. 그래서 이 설계는 "저장된 데이터 유출"을 막지, "서버 자체가 악의적이거나 침해된 경우"나 "내 브라우저의 XSS"는 막지 못한다. 키는 기기마다 따로이며 **마지막으로 연동한 기기에서만** 풀 수 있다(다른 기기에서는 다시 연동).
- 서버 규칙: 평문(학번·비밀번호)을 **로그·에러 메시지·DB·캐시·응답**에 절대 넣지 않는다. 학교 응답 본문도 로그에 남기지 않는다. 모든 `/api/school/*` 응답은 `Cache-Control: no-store`.

## 2. 학교 API (파이썬에서 확인한 사실)

### 2.1 개인 포털 `https://info.hansung.ac.kr` (EUC-KR 응답)
| 용도 | 요청 | 판정 |
|---|---|---|
| 로그인 | `GET /` (JSESSIONID) → `POST /servlet/s_gong.gong_login_ssl` form `{changePass:"", return_url:"null", id, passwd}` + `Referer: BASE/`, `Origin: BASE`, 리다이렉트 따라가지 않음 | **성공 = `ssotoken` 쿠키가 생김**(302 → `/h_dae/dae_main.html`). 실패 = 302 → `/` 쿠키 없음 |
| 내 정보 | `GET /jsp_21/index.jsp` (euc-kr) | 학번 = `haksang_sajin\.jsp\?hakbun=(\w+)`, 이름·학과 = `<div class="info">…</a>` 안을 `<a …>` 제거 후 `<br>` 로 나눈 것: **마지막 줄 = 이름, 그 앞 줄 = 학과** (예: `AI응용학과<br/>   박민재`) |
| 개인시간표 | `POST /jsp_21/student/kyomu/dae_sigan_main_data.jsp` form `{as_hakbun: 학번}` + `Referer: …/dae_h_siganpyo.jsp` (euc-kr) | JSON 배열(FullCalendar 이벤트). `start`/`end` ISO 문자열, `title` = `"과목(분반)\n교수\n강의실"`. 월~금만 사용, 같은 (요일·시작·끝·과목) 중복 제거 |

### 2.2 시설 예약 `https://hansung.ac.kr` — 공용 CMS 모듈 `/resve/<사이트>/<기능번호>/…`
- 예약 시스템 키 `<사이트>/<기능번호>`: `cncschool/1` 상상파크(연구관) · `cncschool/2` 상상파크 플러스(공학관) · `cncschool/4` 디지털 스튜디오 · `cncschool/5` 실기 수업 콘텐츠 제작실 · `cncschool/6` 미디어 콘텐츠 제작실 · `cncschool/7` 코딩라운지 세미나실 · `onestop/16` 상상베이스(상상관 B2). (기존 서버의 `campusSchedule.ts` 는 학술정보관 `hsel/14` 도 읽는다. 신청 흐름이 `hsel` 에서도 같은 모듈인지는 **검증되지 않았다** — 지원 목록에 넣되 `verified:false` 로 표시한다.)
- 조회(공개, 로그인 불필요): 모든 호출은 `POST` + `X-Requested-With: XMLHttpRequest`, JSON 응답(서버가 404 상태코드로 정상 JSON 을 주므로 **상태코드는 무시**).
  - `artclList.do` `{siteId}` → HTML 의 `<select id="resveSpceSeq">` 옵션이 공간 목록 `{id, name}`
  - `resveSetup` `{resveSpceSeq}` → `[ {resveTm:"10:00,11:00,…", posblDay:"월,화,…", posblBgnde, posblEndde(YYYYMMDD), posblTm(시간 전부터), posblTerm(분 단위), resveGroupSeq} ]`
  - `artclSetupList` → 공간 정보(`groupNm, spceNm, mngr, telno, identityCode`), `itemList` → 추가 항목(`itemNm, mustYn`; 항목 없으면 `itemNm` 빈 placeholder 가 와서 걸러야 함)
  - `resveList` `{resveSpceSeq, resveDeStr: YYYY-MM-DD}` → 예약된 슬롯 `[{resveTm}]`
  - 슬롯 상태: 운영 요일·기간 밖이거나 `시작 < 지금 + posblTm시간` 이면 닫힘, `resveTm` 에 있으면 예약됨, 아니면 가능.
- 로그인(예약 사이트별): `GET /hnuLogin/<사이트>/loginView.do` → `POST /hnuLogin/<사이트>/loginProcess.do` form `{siteId, returnUrl:"", referer:"", userId, inputUserId, inputUserPwd}` + Referer/Origin, 리다이렉트 안 따라감. **성공 = 302 + `ssotoken` 쿠키**.
- 내 신청내역(로그인): `POST /resve/<사이트>/<기능>/artclView.do` `{page, prgrsCd:""}` 를 page=1.. 반복(최대 20, 첫 행 번호가 이미 본 번호면 중단) → 표의 `<tr>`: `no-data` 행 제외, `<td>` 8칸 이상 `[번호, 공간, 날짜, 시간, 이름, 학번, 신청일, 상태]`.
- 예약 신청(로그인): ① `GET artclRegistView.do?` (래퍼로 리다이렉트됨 — 최종 URL 이 `reg_url`) 에서 `<input name=layout|userNm|hakbun|telno|email>` 값을 읽음(`actionForm` 이 없으면 실패) ② 폼 데이터 구성(순서 유지): `layout, siteId, fnctNo, lmttYn=N, groupNm, spceNm, selDay(요일), posblDay, posblTerm, posblBgnde, posblEndde, resveGroupSeq, userNm, hakbun, addItemCnt, group, resveSpceSeq, mngr, mngrTelno, resveDeStr, identityCode(콤마), resveTm(슬롯마다 반복), telno, email, addItemMustYn<n>, addItem<n>` ③ **서버 검증**: `POST artclRegist.do` 에 `layout=""` + 나머지, `X-Requested-With`, `Referer: reg_url` → JSON 배열이 비어 있어야 통과(오류면 각 오류 객체의 값들을 문장으로) ④ **본 제출**: 같은 URL 에 일반 POST(`allow_redirects=false`, Referer/Origin) ⑤ 응답 코드만 믿지 말고 **내 신청내역에서 다시 조회**(날짜·공간 이름이 맞는 행)해 확인.
- 신청 대상 코드 `IDENTITY_00007` = 학사(재학생) 등은 `identityCode` 에서 이름으로 바꿔 보여 준다.

## 3. 반드시 지킬 안전 규칙

1. **로그인은 한 번만, 재시도 금지.** 학교는 로그인을 10번 틀리면 **계정을 잠근다**(파이썬 주석의 "비밀번호 초기화"는 틀린 설명이고, 실제는 계정 잠금). 실패하면 즉시 오류를 돌려주고 자동 재시도·재로그인을 하지 않는다. 기능 하나가 로그인을 여러 번 하지 않게(한 요청 = 사이트당 로그인 최대 1회) 한다.
2. **DB 기반 실패 가드** `school_login_guard(student_hash PK, fails, first_fail_at, locked_until)`:
   - `student_hash = sha256(학번 + 서버 비밀값)` — 학번 원문을 저장하지 않는다.
   - 로그인 **직전**에 잠금 여부를 확인(잠겨 있으면 학교에 아예 요청하지 않고 `SCHOOL_LOCKED`), 실패하면 `fails+1`(연속 실패 횟수), 성공하면 0 으로 초기화.
   - **연속 5회 실패 → 30분 잠금**(`locked_until`). 잠금이 끝나도 `fails` 는 **0 으로 돌리지 않고 유지**한다(5+5=10 이 되어 학교 계정이 잠기는 일을 막기 위해). 잠금 뒤 또 실패하면 다시 30분 잠금, **연속 8회 실패에 이르면 24시간 잠금**(학교의 10회 한도에 절대 닿지 않게 하는 안전선) — 그동안 화면은 "학교 포털에서 직접 로그인해 비밀번호를 확인하고, 그다음 다시 연동해 주세요" 라고 안내한다. 성공하면 모두 초기화.
   - 사용자 단위 호출 제한도 건다: 연동(`/link`) 10분에 3회.
3. **서버가 학교에 보내는 호스트·경로는 고정**이다. 사용자 입력은 학번(`^\d{6,10}$`), 날짜(검증된 YYYY-MM-DD), 공간 id(정수), 예약 시스템 키(화이트리스트), 슬롯 시각(`HH:mm`), 추가 항목 값(길이 제한)뿐이고 URL·호스트로 쓰지 않는다 (SSRF 방지).
4. 요청 타임아웃 10초, 리다이렉트는 수동 처리, 응답 크기 제한(2MB), 학교가 점검·구조 변경이면 `SCHOOL_UNAVAILABLE`(화면은 "학교 사이트가 지금 응답하지 않아요" 안내).
5. **예약 신청은 반드시 미리보기 → 사용자의 명시적 확인 → 제출** 순서. 제출은 사용자가 버튼을 누른 한 번에 한 번만, 결과가 모호하면(`unknown`) **자동으로 다시 보내지 않는다**. 중복 방지 `school_bookings`(예약 계획당 `submitted/confirmed/unknown` 기록, 있으면 미리보기에서 `alreadySubmitted`).
6. 연동 해제 = 서버의 암호문·힌트 삭제 + 브라우저의 키 삭제. 회원 탈퇴 시 `users` 행과 함께 사라진다.

## 4. API (`/api/school/*`, 로그인 필요, 응답 `Cache-Control: no-store`, 오류 `{ error, code }`)

| 메서드 | 경로 | 본문 → 응답 |
|---|---|---|
| GET | `/link` | → `LinkStatus` (암호문 포함) |
| POST | `/link` | `LinkRequest{creds, cipher}` → `LinkResponse` (학교에 1회 로그인, 프로필 읽기, cipher+hint+학과·입학년도 저장). 형식 검사: cipher `{v:1, iv(base64 12B), ct(base64, 17~2048B)}` |
| DELETE | `/link` | → `{ ok:true }` |
| POST | `/timetable/preview` | `{creds}` → `TimetablePreview` |
| POST | `/timetable/import` | `{creds}` → `TimetableImportResult` (학교에서 가져왔던 기존 일정(source='school')을 지우고 새로 넣는다. 직접 입력한 일정은 건드리지 않는다) |
| POST | `/reservations` | `{creds}` → `MyReservationsResult` (지원하는 모든 예약 시스템의 내 신청내역, 시스템별 로그인은 한 번씩, 실패한 시스템은 `failed` 에) |
| POST | `/book/preview` | `{creds, reservationId}` → `BookPreview` |
| POST | `/book/submit` | `BookSubmitRequest` → `BookResult` |

- `reservationId` 는 우리 앱의 예약 계획(`reservations.id`)이고, 요청한 사용자는 그 회의의 멤버여야 한다. 시설은 `facilities.system_key + campus_name` 으로 학교 예약 시스템·공간에 매핑한다(system_key → 예약 시스템 키: `hsel`→`hsel/14`, `onestop`→`onestop/16`, `cncschool`→`cncschool/2`, `codinglounge`→`cncschool/7`; 공간은 `artclList.do` 의 이름이 `campus_name` 과 같은 것).
- 우리 예약 시간 `[startMin, endMin)` 는 공간의 슬롯 단위(`posblTerm` 분)에 맞게 슬롯 시작 시각들로 펼친다. 맞지 않으면 `canBook=false`(이유 문장).
- 제출이 `confirmed` 로 확인되면 우리 `reservations.school_status = 'confirmed'`.

## 5. DB (server/school/schema.ts — 멱등, `server/db.ts` migrate 가 실행)
```sql
ALTER TABLE users ADD COLUMN IF NOT EXISTS school_cipher TEXT;            -- JSON.stringify(SealedBox)
ALTER TABLE users ADD COLUMN IF NOT EXISTS school_hint TEXT;               -- "***044"
ALTER TABLE users ADD COLUMN IF NOT EXISTS school_linked_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS school_department TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS school_admission_year INTEGER;
ALTER TABLE timetable_entries ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'manual';  -- 'school' = 학교에서 가져온 것
CREATE TABLE IF NOT EXISTS school_login_guard (student_hash TEXT PRIMARY KEY, fails INTEGER NOT NULL DEFAULT 0, first_fail_at TIMESTAMPTZ, locked_until TIMESTAMPTZ);
CREATE TABLE IF NOT EXISTS school_bookings (id SERIAL PRIMARY KEY, reservation_id INTEGER NOT NULL, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, status TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
-- 두 새 테이블에도 RLS 를 켠다
```

## 6. 시간표 가져오기 변환 규칙
- 요일 0~4(월~금)만. 시간은 우리 격자(30분 단위, 09:00~22:00)에 맞춘다: 시작은 **내림**, 끝은 **올림**, 범위 밖은 잘라서 넣고 그래도 길이가 0이면 건너뜀(이유 기록). 조정한 수업 수를 `adjusted` 로 알린다.
- `title` = 과목명, `place` = 강의실, `repeat_kind='weekly'`, `source='school'`.
- 가져오기는 "교체": 기존 `source='school'` 일정만 지우고 새로 넣는다(새 일정을 먼저 넣은 뒤 이전 것을 지워 중간 실패로 시간표가 비는 일을 막는다).

## 7. 화면(클라이언트) 흐름
- **가입 3단계(선택)**: 이메일 확인 → 정보 입력(가입) → **학교 계정 연동**(건너뛰기 가능). 연동 화면은 KRDS "동의" + "개인 식별 정보 입력" 패턴: 수집 목적·보관 방식(암호문만, 키는 이 기기에만)·한계(요청 중 서버가 잠깐 봄)·해제 방법을 평문으로 안내하고, 동의 체크박스가 있어야 버튼이 켜진다. 비밀번호 칸 옆에 `SCHOOL_PASSWORD_WARNING`.
- 연동 성공 → "학교 시간표를 지금 가져올까요?" (미리보기 → 가져오기).
- **내 정보**: `SchoolLinkCard` (상태·다시 연동·해제·시간표 가져오기·내 학교 예약).
- **시간표**: 연동되어 있으면 "학교 시간표 가져오기" 버튼.
- **회의 상세 예약 현황**: 연동되어 있고 학교에서 확인되지 않은 예약에 "학교에 바로 신청하기" → 미리보기 시트(추가 항목 입력) → 확인 → 제출 → 결과(`confirmed`/`unknown`).
- 오류 코드별 문구: `SCHOOL_AUTH_FAILED` "학번 또는 비밀번호가 맞지 않아요. 다시 시도하기 전에 학교 포털에서 먼저 로그인해 확인해 주세요. 10번 틀리면 계정이 잠겨요." / `SCHOOL_LOCKED` "학교 계정이 잠기지 않도록 학교 로그인을 잠시 멈췄어요. 30분 뒤에 다시 시도할 수 있어요." (8회 실패 잠금은 "24시간" 문구) / `SCHOOL_UNAVAILABLE` / `SCHOOL_REJECTED`(학교가 준 문장 그대로) / 키 없음 "이 기기에서는 …다시 연동해 주세요".

## 8. 테스트 정책
- **실제 학교 계정으로 자동 테스트하지 않는다**(10번 실패 시 학교 계정이 잠기는 위험). 파서·변환·가드·슬롯 계산·암호화는 **고정 fixture 와 mock fetch** 로 단위 테스트한다.
- 실제 학교와의 동작은 사용자가 화면에서 직접 확인한다 — 보고서에 "미검증"으로 솔직히 적는다.
