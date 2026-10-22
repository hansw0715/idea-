# UI 리디자인 공동 작업 노트 (Claude + Codex)

## Codex — 선택 상태 안정화와 강조 면 정리 (2026-10-22, 완료)
- 담당: MeetingDetail/BookingFlow/CreateGatheringSheet 선택 표시, meeting-detail/account/gathering/timetable 페이지 CSS. 공통 토큰·components.css는 수정하지 않음.
- 팀원·시간·날짜·밥약 태그는 체크 아이콘 공간을 항상 확보하고 선택 여부만 visibility로 표시. 선택 전후 글자 굵기 500 고정. 팀원 제외 문구는 스크린리더용으로 전달하고 aria-pressed 유지. 긴 이름 줄바꿈 및 최대 폭 보정.
- 내 정보 이니셜: 각진 옅은 블루 패널. 시간표 선택 시간 말풍선·라운지 선택 체크: 옅은 블루+진한 글자+경계선. 라운지 체크는 카드 안으로 이동. 온도 게이지의 블루는 수치 정보이므로 유지.
- 브라우저: 회의 상세/시간표/내 정보/라운지 1280px, 390px, 320px·글자 200% 가로 넘침·실행 오류 없음. 팀원 8명 일반/선명한 화면 선택 전후 칩 크기·상대 위치 동일. 예약 시간·날짜도 동일 검사 통과. 라운지 미팅 만들기 캡처 확인. 현재 라우트에서 밥약 태그 폼으로 진입하는 경로는 없어 해당 폼은 코드만 수정했으며 직접 조작 검증은 하지 않음.
- scripts/review-selection.mjs는 API 전부를 샘플로 응답하고, 예약 UI 확인에만 SchoolContext의 canUse를 브라우저 응답에서 대체함. 실제 학교 인증·예약 제출 검증이 아님. 외부 폰트는 환경 네트워크 차단으로 폴백 서체로 확인.
- 요청: 제안한 --m-5 #0f766e는 기존 --m-7 #0f7470와 거의 같음(8명 범례 임시 적용 캡처 확인). 5번 하나만 변경하지 말고 전체 8색을 함께 재조정할 것. 그 전까지 기존 무늬 유지. 모션 정리 시 체크 표시 공간을 다시 조건부 렌더링으로 바꾸지 말 것.
- 검증: npx.cmd tsc -p client/tsconfig.json 통과. npm.cmd run build는 esbuild 상위 폴더 접근 오류로 실패. npm.cmd run build -- --configLoader runner 통과, 첫 묶음 483.73kB, 번들 경고 없음. 사용자 추가 조치 불필요.

## Claude — 선택 상태 위계 정리 (2026-10-22)
- 체크박스 라운드 0.7rem → `--r-xs`(2px).
- `.tag` 선택 상태(팀원 칩·시간 칩·날짜 칩·라운지 칩 공통): 꽉 찬 블루 → 옅은 블루 면(`--c-action-bg-strong`) + 남색 글자(`--c-ink`, 14:1) + 2px 테두리 + 굵기 650. 꽉 찬 블루는 주 버튼 전용. 색 없이도 테두리 두께·체크 아이콘·굵기로 구분.
- 검증: tsc 통과, `npm run build` 기본 명령 통과(첫 묶음 483.73kB, 경고 없음). 브라우저 미확인.

## Codex — Hansung Blue 페이지 정리 (2026-10-22, 완료)
- 홈: 다음 예약만 옅은 파란 면과 직선 막대로 강조. 시간 숫자의 크기·자간 축소, 동일 서체의 tabular-nums 유지.
- 회의 목록: 장식용 01/02 번호 삭제, 데스크톱 카드 높이 축소. 참가 코드 입력의 자간 0.4em → 0.06em, 코드 배지 0.04em.
- 회의 상세: 큰 남색 초대 패널 → 옅은 파란 면과 왼쪽 직선. 코드 크기·굵기·자간 절제.
- 가입: 진행 숫자를 본문 제목 크기로 축소. 라운지: 남색 대형 패널 → 흰 카드, 파란 상단 선; 실제 본문 64rem 이상에서 2열.
- 데이터 요청·제출·기존 motion/reduced-motion 흐름 변경 없음. Claude 담당 공통 파일 수정 없음.
- Playwright 샘플 API 검증: 주요 6개 화면 1280/390/320px(320은 글자 200%) 가로 넘침·실행 오류 없음. 로그인·가입 4단계도 1280/390/320 및 1280px 200%에서 통과. 1280px 200% 가입 진행 패널 position:static, 한 열 화면 캡처 확인.
- 하단 여백: 데스크톱 브라우저에서 --safe-bottom:34px 모의 적용. 활성 선 하단 749px < 안전 여백 시작 810px. 실제 iPhone 기기 검증은 아님.
- 외부 폰트는 네트워크 제한으로 로드 실패하여 폴백 서체로 확인. 실제 가입/학교 인증/예약 제출은 수행하지 않음.
- 검증: npx.cmd tsc -p client/tsconfig.json 통과. npm.cmd run build는 esbuild 상위 폴더 접근 오류. npm.cmd run build -- --configLoader runner 통과(631kB 경고).
- Claude 다음 작업: --m-5가 --primary-50과 같은 #1f4fbf임. 팀원 5번째 레인이 개인 수업과 같은 색으로 보일 수 있으므로 범례와 함께 다른 색으로 조정. 공통 .code-chip의 0.12em도 0.04em 수준으로 축소하고 기본 파란 버튼의 강한 그림자를 제거해 사용자 요청의 평평하고 각진 방향에 맞출 것. 이후 번들 분할.

## 3차 방향 "Hansung Blue" — 사용자 피드백 반영 (Claude, 2026-10-22) ※ 아래 2차 규칙보다 우선
사용자: 서체 하나로 통일(숫자 이상함), 둥글둥글·AI 티 지양, 흰 바탕 + 한성대 파란색.
- 바탕 순백(`--c-canvas` #fff). 카드 = 그림자 없이 1px 헤어라인(`--shadow-card` = `--c-line`). 큰 그림자는 시트·다이얼로그만.
- 행동색 한성 블루 `--primary-50` #1f4fbf(흰 글자 7.2:1) = 버튼·링크·활성 표시. 진한 강조 면은 `--c-ink`(#0c245c). 주홍 폐기.
- 라운드 `--r` 3px / `--r-lg` 4px / `--r-xl` 6px. `--r-pill` 도 4px 로 바꿈 → 알약 전부 사각. 진짜 원은 `--r-round`(50%).
- 서체 Pretendard 하나. JetBrains Mono 링크 제거, `--font-mono` = `--font`. `.mono` 는 이제 `tabular-nums` 만. 새 코드에 고정폭 서체 쓰지 말 것.
- 탭바: 바닥에 붙은 흰 막대 + 위 헤어라인, 활성 = 위쪽 3px 파란 선(layoutId 유지). 데스크톱 레일: 흰 면 + 오른쪽 헤어라인, 활성 = 옅은 블루 면 + 왼쪽 3px 선.
- 가입·로그인 두 판 전환: 미디어 쿼리 em 은 앱 글자 확대를 못 따라감(Codex 지적 맞음) → `.app-page` 컨테이너 쿼리 `96rem` 으로 교체. 한 열에서는 스텝 점 목록을 시각적으로만 숨기고 "01 / 04" + 제목만.
- **Codex 요청:** 페이지 css 에 남은 큰 라운드 리터럴(1.6rem 등)·`--shadow-raised` 카드·`letter-spacing` 넓은 대문자 머리말을 3차 규칙에 맞게 정리. 시간표 수업 블록 색이 블루로 바뀌었으니 예약 빗금·팀원 레인과 구분되는지 확인.

## 2차 리디자인 "Paper & Ink" — 방향 (Claude, 2026-10-22)
KRDS·4px·Pretendard GOV 폐기. 아래가 새 규칙이다.
- 바탕 `--c-canvas` 종이색(#f4f1ea) 위에 흰 카드(`--c-bg`)가 `--shadow-card` 로 뜬다. 카드에 1px 보더 쓰지 말 것.
- 기본 버튼 = 잉크(`--c-action` #1c1a16, 흰 글자 17:1), 알약형. 포인트 버밀리언(`--c-accent`/`--primary-50`)은 점·막대·활성 표시에만. 글자색은 `--primary-60` 이상.
- 라운드 `--r` 12 / `--r-lg` 20(카드) / `--r-xl` 28(시트). 제목은 `--fw-heavy` + `--tracking-tight`.
- 숫자·시간·코드: `.mono`(JetBrains Mono), 머리말: `.eyebrow`.
- 모션: `ui/motion.tsx` 의 `StaggerList`/`StaggerItem`(목록), `Reveal`(덩어리), `SPRING`. 화면 전환·탭바 알약은 Shell 이 처리. `MotionConfig reducedMotion="user"` 적용됨.

| 영역 | 담당 | 상태 |
|---|---|---|
| tokens / base / components.css, index.html 서체, Shell(헤더·탭바·화면 전환), ui/motion.tsx, 로그인 | Claude | 완료 |
| 홈, 시간표, 회의 목록·상세, 내 정보, 회원가입, 라운지 페이지 css·tsx | Codex | 2차 구조·스타일 수정 완료 |

## Codex — Paper & Ink 페이지 재구성 (2026-10-22)
- 홈: 예약/회의/라운지를 별도 표면으로 분리. 첫 예약은 날짜·큰 모노 시간·주홍 막대로 강조하고 e-class는 일정 아래로 이동.
- 회의 목록: 번호가 있는 개별 카드와 StaggerList. 상세: 페이지 제목·멤버 수, 잉크색 초대 코드 패널, 개별 예약 카드.
- 시간표: 주간 제목과 탭 트랙 재구성, 수업 블록은 옅은 주홍 면과 진한 주홍 막대. 예약 빗금·팀원 레인·키보드 포커스 유지.
- 내 정보: 이니셜 프로필과 설정 행. 가입: 중복 로고 제거, 현재 단계 제목과 01/04 진행 패널, 별도 signup.css로 인증 입력 카드 구성.
- 라운지: 잉크색 밥약과 흰 미팅 선택 패널, Reveal 및 약속 StaggerList 적용.
- Claude 담당 공통 파일은 수정하지 않음. 기존 MotionConfig reducedMotion=user 사용.
- 검증: npx.cmd tsc -p client/tsconfig.json 통과. 기본 빌드는 esbuild 상위 폴더 읽기 Access denied로 실패; --configLoader runner 빌드는 통과(500kB 경고).
- scripts/review-redesign.mjs는 API를 샘플 응답으로 가로채는 화면 점검용. 실제 서버 데이터는 변경하지 않음. 외부 폰트 요청은 환경 네트워크 제한으로 차단됨.
- 브라우저 점검: 홈·회의 목록/상세·시간표·내 정보·라운지 390px 및 320px/글자 200%에서 가로 넘침 없음. 홈의 공통 hover 의사 요소 돌출과 내 정보 프로필 줄바꿈을 보정한 뒤 해당 화면 재검사 통과. 회원가입 390px 캡처도 확인. 실제 학교 인증·예약 제출은 수행하지 않음.
- Claude 다음 작업: 공통 헤더·하단 탭을 320px/글자 200%에서 점검. 현재 공통 여백과 로고·탭 글자가 크게 확대되어 지나치게 세로로 쌓임. 데스크톱도 520px 프레임에 머무르므로 넓은 화면 전용 셸 검토.

## Claude — 헤더·탭바 반응형과 데스크톱 레일 (2026-10-22)
- 탭바: 컨테이너 쿼리 2단계. 31rem 이하에서는 활성 탭만 [아이콘+이름] 가로 알약이고 나머지는 아이콘만 보임. 21rem 이하에서는 전부 아이콘만 보임. 숨긴 이름은 화면 읽기용으로 남김. rem 기준이라 글자를 키우면 같은 폭에서도 단계가 바뀜.
- 탭바 가운데 정렬: motion 인라인 transform과 겹치던 translateX(-50%)를 margin-inline:auto로 교체.
- 헤더: 26rem 이하에서는 로고타입 글자를 숨기고 마크만 보임(링크 이름은 aria-label).
- 데스크톱 1024px 이상: 하단 알약 대신 왼쪽 세로 레일(23rem, 위에 로고타입). 본문은 --content-max 76rem 안에 가운데 정렬. 헤더 로고는 숨기고 하단 여백·토스트 위치는 원래대로.
- 토큰 추가: --sheet-max(시트·토스트·안내는 520px 유지), --content-max, --rail-w. 로그인·회원가입처럼 탭바가 없는 화면은 520px 컬럼 그대로.
- (Claude → Codex 요청) 76rem 폭에서 홈·회의 목록 카드가 한 줄로 길게 늘어짐. 1024px 이상에서 홈은 2열(예약·회의 | 라운지·e-class), 회의 목록은 auto-fill 카드 그리드 검토 바람.
- 검증: tsc 통과, 기본 npm run build 통과(500kB 경고만). 브라우저 확인 못 함.

## Codex — 제목 줄바꿈과 데이터 범위 (2026-10-22)
- 완료: home.css 제목·소개에 overflow-wrap: anywhere 적용. 확대 화면의 실제 렌더링 검증은 남음.
- 완료: Dashboard.tsx 슬로건 대신 참여 중인 회의 수 표시. 데이터가 없거나 회의가 없으면 중립 제목 '내 일정' 사용. 소개에는 다가오는 예약 수 표시.
- 현재 DashboardData에는 수업 데이터가 없으며 meetings는 오늘의 회의 수가 아님. 오늘 수업/회의 집계로 표시하지 않음.
- git diff --check 통과. 빌드 결과는 이번 대화 응답 참조. Claude 담당 공통 스타일은 수정하지 않음.

둘 다 이 파일을 읽고 고친다. 작업 시작 전에 "담당" 칸에 이름을 적고, 끝나면 "완료"로 바꾼다.

## 진단 — AI 티가 나는 지점

| # | 위치 | 문제 | 왜 문제인가 |
|---|---|---|---|
| 1 | `client/src/styles/tokens.css` | Primary `#6366f1` / `#4f46e5` | Tailwind indigo-500/600 그대로. AI가 만든 사이트의 대표 색 |
| 2 | `tokens.css`, `index.html` | KRDS(정부 디자인 시스템) + Pretendard GOV | 정부 민원 사이트 인상. "간지"와 정반대 |
| 3 | `pages/Dashboard.tsx` 상단 | 아이콘 + "홈" 제목 + 날짜 | 탭바와 중복, 첫 화면 가장 좋은 자리를 낭비 |
| 4 | 전역 | 4px 라운드 + 1px 보더 카드만 반복, 위계 없음 | 모든 구역이 같은 무게라 시선이 갈 곳이 없음 |
| 5 | `--frame-max: 480px` | 데스크톱에서도 모바일 폭 고정 | 넓은 화면에서 빈 회색 여백 |

## 담당 (충돌 방지: 파일 단위로 나눈다)

| 영역 | 파일 | 담당 | 상태 |
|---|---|---|---|
| 디자인 토큰 (색·서체·라운드·그림자) | `styles/tokens.css`, `styles/base.css`, `index.html` | Claude | 대기 (방향 합의 후) |
| 공통 컴포넌트 | `styles/components.css` | Claude | 대기 |
| 홈 화면 레이아웃 | `pages/Dashboard.tsx`, `pages/home.css` | Codex | 홈 1차 수정 완료 / 라운지 대기 |
| 라운지 | `lounge/**` | Codex | 홈 1차 수정 완료 / 라운지 대기 |

## 규칙

- 남이 담당한 파일은 고치지 말고 이 파일 "요청" 칸에 적는다.
- 페이지 CSS는 색을 직접 쓰지 않고 `--c-*` 의미 토큰만 쓴다 (토큰만 바꿔도 전체가 따라오게).
- 한 단계 끝날 때마다 `npm run build`가 통과하는지 확인한다.

## 요청

- (Claude → Codex) 홈 히어로 제목에 `--fs-display` + 굵기 800 + 자간 -0.02em 적용 검토. 토큰이 정리되면 위계는 제목 크기 대비로 만드는 게 가장 효과적.

## Claude — 토큰 1차 수정
- tokens.css: primary 단계표를 잉크 코발트(#2448c9, 흰 배경 7.4:1)로 교체. 원시 단계만 바꿔 timetable/chat 등 `--primary-*` 직접 참조도 함께 따라옴.
- tokens.css: gray-5/10을 웜 그레이로. 표면·바깥 배경이 종이 톤이 됨.
- components.css: 기존 인디고가 흰 글자 4.47:1로 AA 미달이라 모든 기본 버튼 글자를 18.7px로 키우던 보정을 제거(굵기만 유지).
- 서체는 Codex 의견 수용해 유지 (GOV와 일반 Pretendard의 시각 차이 미미).
- 검증: vite 미설치로 빌드 미확인.

## Codex — 홈 1차 수정
- Dashboard.tsx: 중복 홈 아이콘/제목을 날짜, 캠퍼스 제목, 회의 생성·시간표 링크로 교체. 내 일정 제목을 표시.
- home.css: 타이포그래피 위계, 행동 영역, 링크 터치 높이, 작은 화면 줄바꿈 추가. 색상은 의미 토큰 유지.
- 디자인 의견: 인디고/서체 자체를 AI 디자인의 원인으로 단정하지 않음. 정보 위계와 간격이 우선. 밝은 바탕 + 짙은 본문 + 절제된 포인트 제안.
- Claude 요청: 담당 토큰/공통 CSS 변경 시 키보드 포커스·확대·고대비 기능 유지. 기존 색상 변경은 사용자 전체 리디자인 위임 범위에서 판단 가능.
- 권한: Codex의 위 세 파일 쓰기 성공. Claude 측 쓰기/명령 권한은 Claude 환경에서 별도 확인 필요.
- 검증: git diff --check 공백 오류 없음. npm run build는 vite 미설치로 실패. npm ci 설치 시도는 출력 없이 지연되어 중단 요청; 빌드/브라우저 검증 미완료.

## Codex — 제목 크기와 설치 경로 재확인 (2026-10-22)
- home.css: 제목을 --fs-display × 1.25(기본 3.5rem), 굵기 800, 자간 -0.02em으로 변경. vw 의존을 제거해 루트 글자 크기 확대를 따르도록 조정.
- package.json은 프로젝트 루트에 있으며 client에는 없음. 설치 명령은 루트에서 실행해야 함.
- 검증: npm run build는 vite 미설치로 실패. npm ci --offline은 yargs-parser 캐시 누락(ENOTCACHED), 일반 npm ci는 Exit handler never called 오류로 실패. 화면 검증 미완료.
- Claude 요청: 공통 토큰과 버튼을 적용한 화면에서 제목/버튼 균형, 고대비 모드의 흰 글자 대비도 함께 확인. 파일별 분담 유지.

## Claude — 대비 점검과 범주 색 정리 (2026-10-22)
- 대비 점검(계산값): 기본 버튼 #2448c9/흰 글자 7.4:1, 링크 primary-60 약 9:1, 고대비 버튼 primary-70 약 11:1, 링크 primary-80 약 14:1. 모두 AA 통과.
- tokens.css: 시간표·아바타 범주 색 --m-1(#052b57 남색)이 새 코발트 행위색과 같은 계열이라, 1번 팀원 칸이 "눌러야 하는 요소"처럼 읽히던 문제를 올리브(#5c5000)로 교체해 해결.
- tokens.css: 헤더 주석의 #6366f1, 포커스 주석의 "정부 인디고"를 현재 값에 맞게 정정.
- (Claude → Codex 요청) .home-hero__title: 3.5rem + keep-all이라 글자 200% 확대 시 7rem 크기에서 어절을 쪼개지 못해 480px 프레임 가로가 넘칠 수 있음. overflow-wrap: anywhere 추가 권장. 그리고 "오늘의 캠퍼스, 한눈에."는 어느 앱에나 붙는 문구라 오히려 AI 문구처럼 보임. 고정 문구 대신 "오늘 수업 3개 · 회의 1개"처럼 실제 데이터로 만든 제목을 검토 바람.

## Codex — 시간표 식별 수단 및 실행 오류 재확인 (2026-10-22)
- TimetableGrid.tsx: 팀원 레인은 글자를 숨기지만 entryLabel의 aria-label에는 팀원명이 포함됨. 팀원별 텍스트 일정 목록과 클릭 시 상세 정보도 존재함. 시각적으로 즉시 식별하는 문제와 대체 식별 수단 유무를 구분해야 함.
- components/timetable.css: 포커스는 흰색 2px + primary-50 4px 이중 인셋 링. 단일 코발트 링으로 기술하지 않음. 실제 화면 검증은 아직 필요.
- 이번 환경에서 npm은 npm.ps1 실행 정책 오류. npm.cmd run build로 호출하면 실행되지만 vite 미설치로 실패함. 실행 정책 변경은 필요하지 않으며 Claude의 별도 명령 권한과 구분함.
- 이번 수정은 공동 노트만. UI 파일과 Claude 설정은 변경하지 않음.

## Codex — 데스크톱 홈·회의 그리드 (2026-10-22, 완료)
- Dashboard.tsx/home.css: 예약·회의 주 영역과 라운지·e-class 보조 영역으로 분리. 본문 컨테이너 64rem 이상에서 1.35:1 두 열, 좁거나 확대하면 DOM 순서 그대로 한 열. 히어로 행동은 넓은 화면에서 오른쪽 배치.
- meetings.css: auto-fit/minmax(min(100%,30rem),1fr) 카드 그리드. 넓은 화면에서 번호를 독립 행으로, 생성·참가 버튼을 내용 폭으로 제한.
- 시간은 시각 단위로 줄바꿈해 확대 시 16:00 중간이 끊어지지 않게 수정. 기존 데이터 요청·StaggerList·전역 reduced-motion 유지. Claude 담당 공통 파일 수정 없음.
- Playwright 샘플 API: 홈·회의 1280/390/320px·글자 200% 가로 넘침 없음, 실행 오류 없음. 1280px 홈 402/298px 두 열, 회의 352px 두 열. 캡처 직접 확인.
- Claude 요청 확인: 320px·200% 활성 탭 46px/scrollWidth 46px, 이름은 접근성 텍스트로 숨김(잘림 없음). 데스크톱 focus-visible 링 #ff9d70 5px, 직접 확인했고 보정 요청 없음.
- 검증: 기본 npm.cmd run build는 esbuild의 상위 디렉터리 읽기 Access denied. --configLoader runner 우회 빌드 통과(500kB 경고). npx.cmd tsc -p client/tsconfig.json 통과. 외부 폰트 요청은 네트워크 제한으로 차단되어 폴백 서체로 확인.
- Claude 다음 작업: 예정한 로그인·회원가입 좌우 구성. 폼 폭은 제한하되 글자 확대 때 한 열로 복귀하도록 컨테이너 가용 폭 기준 권장.

### Claude — 로그인·회원가입 좌우 배치 (2026-10-22)
- 기준: `@media (min-width: 64em) and (min-height: 600px)`. em 기준이라 기본 글자 확대·브라우저 200% 확대 시 한 열로 복귀.
- 로그인: `.auth-split` 2열(활자 판 1fr / 입력 판 최대 44rem). 왼쪽에 기능 목차 `.auth-index`(01~03, 넓은 화면만 표시).
- 회원가입: 왼쪽 `.signup-side`(단계 제목·진행, sticky) / 오른쪽 단계 본문(최대 52rem). 단계 전환 시 본문이 `motion.div key={step}`로 떠오름(퇴장 애니메이션 없음 → 포커스 이동 유지).
- 프레임: `body:has(.auth-split) .app-frame { max-width: 128rem }` — 탭바 있는 화면에는 영향 없음.
- 요청(Codex): 1280px·390px·글자 200%에서 로그인·가입 4단계 캡처, sticky 왼쪽 판이 긴 동의 단계에서 겹치지 않는지 확인.


### Codex — 회의 상세·시간표 작업 공간 및 가입 검증 (2026-10-22)
- MeetingDetail.tsx/meeting-detail.css: 회의 코드·예약 시작·팀원 선택을 왼쪽에, 예약 현황을 오른쪽에 배치. 팀원 시간표는 아래 전체 폭. 본문 64rem 컨테이너 기준, DOM과 키보드 읽기 순서도 동일. Reveal/StaggerList 적용, 기존 reduced-motion 설정 유지. 초대 코드 설명의 잉크 바탕 대비도 수정.
- TimetablePage.tsx/timetable.css: 본문 68rem 이상에서 격자 + 25rem 일정 목록으로 분리. 요일/시각순 수업·예약 목록은 같은 gridEntries 사용, 클릭 시 기존 상세 시트. 일정 추가 버튼도 기존 openAdd 연결. 확대/좁은 본문은 한 열.
- Playwright 샘플 API 검증: 회의 상세·시간표 1280/390/320px(200% 글자) 가로 넘침·실행 오류 없음. 시간표 데스크톱 격자/목록 446px/250px. 캡처 직접 확인. 외부 폰트 네트워크 제한으로 폴백 사용.
- scripts/review-auth-layout.mjs 추가: 학교 인증과 가입 요청을 모두 가로채는 샘플 API로 로그인+가입 4단계 1280/390px 및 320/1280px·200% 검사. 서버 쓰기 없음. 20개 캡처, 가로 넘침·실행 오류 없음. 정상 글자 desktop sticky 상단 72px 확인.
- Claude 수정 요청: auth.css의 64em 미디어 쿼리는 앱의 루트 글자 확대에 따라 바뀌지 않음. 1280px/루트 20px에서 두 열 유지, signup-side 높이 학교 단계 2642px/동의 단계 2989px, 스크롤 시 상단 -124px. auth-split에 실제 가용 폭 기준 container query 또는 rem 최소 폭 기반 자동 줄바꿈 적용 요청. 320px/200%도 진행 패널 높이 1012px: 현재 단계 중심의 간결한 진행 표시 권장. 공통/인증 파일은 수정하지 않음. 캡처 shots/auth-review-1280-200pct-consent.png 참고.
- 검증: npx.cmd tsc -p client/tsconfig.json 통과. npm.cmd run build는 esbuild 상위 디렉터리 접근 거부로 실패. npm.cmd run build -- --configLoader runner 통과(631kB 묶음 경고). 사용자 추가 조치 불필요.
- Claude 다음 작업: 가입 확대 레이아웃 먼저 보정 후 예정한 코드 분할. fallback 최소 높이와 경로 변경 포커스 유지, motion 재등장 확인.

### Claude — 공통 보정 + 화면 나눠 불러오기
- `.btn--primary` 그림자 제거(평면 블루), `.code-chip` 고정폭 지정 삭제·자간 0.04em, 토스트의 잉크 그림자 → `--shadow-raised`.
- `--m-5` #1f4fbf → #8a5a2b(갈색, 흰 바탕 5.6:1). 범례·레인은 같은 변수를 써서 함께 바뀜.
- `App.tsx`: Signup·MeetingDetail·Account·라운지 4화면을 `lazy`로 분리. `Suspense`는 AppFrame 안쪽이라 헤더·탭바·화면 전환 모션은 유지, 대기 자리(`.route-fallback`)는 60dvh 높이를 지키고 0.3초 뒤에만 스피너 표시.
- 결과: 첫 JS 631kB → 483kB(gzip 157kB), 500kB 경고 사라짐. tsc·build 통과.
- 요청(Codex): 회의 목록 → 상세 진입 시 포커스가 본문 제목으로 가는지, 느린 3G에서 대기 자리가 튀지 않는지 확인.

## Codex — 지연 로딩 포커스와 팀원 식별 보정 (2026-10-22)
- Shell.tsx: 경로 변경 후 Suspense와 API 로딩이 끝날 때까지 기다렸다가 main 내부 제목으로 한 번만 포커스 이동. 로딩 중 키보드/포인터 조작이 시작되면 자동 이동을 취소해 사용자 포커스 유지. 문서 제목도 실제 회의 제목을 따라감.
- 회원가입·로그인 공용 auth-card: 6px → 4px 라운드, 떠 있는 그림자 → 얇은 경계선. 숫자 장식이나 추가 서체 없음.
- 다섯 번째 팀원: 갈색 유지 + 선택 칩/범례/시간표 레인에 가로줄 무늬 추가. 예약의 대각선 빗금과 방향을 다르게 함. 범례는 작은 사각형으로 통일. 기존 이름·일정 목록·접근성 이름 유지.
- review-redesign.mjs: 다섯 명이 겹치는 샘플로 확대. 모듈 400ms/API 500ms 지연 후 제목 포커스, 로딩 중 Tab 입력 후 포커스 유지 검증 통과.
- 회의 상세·시간표: 1280px/390px/320px·글자 200% 가로 넘침 없음, 실행 오류 없음. 5인 범례와 격자 데스크톱 캡처 확인. 외부 폰트는 네트워크 제한으로 폴백 사용.
- 검증: npx.cmd tsc -p client/tsconfig.json 통과. npm.cmd run build는 esbuild 상위 폴더 접근 거부로 실패. npm.cmd run build -- --configLoader runner 통과, 첫 묶음 483.73kB·500kB 경고 없음.
- Claude 다음 작업: 공통 체크박스의 border-radius: 0.7rem을 --r-xs로 변경. 팀원 선택 칩이 모두 파란 면으로 채워져 기본 예약 버튼과 강조가 경쟁하므로 선택 상태를 옅은 블루 면+진한 글자로 조정. 포커스 수정은 이번 차례에서 완료.
