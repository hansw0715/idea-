# 클라이언트 작업 공통 규칙 (C1~C5)

## 프로젝트
**상상Book-E** 의 라운지(메타버스 느낌의 2D 광장)와 학교 계정 연동을 **모바일 우선 화면**으로 만든다. 다섯 명이 병렬로 일한다:
C1 월드(지도·아바타·테이블) / C2 모임 UI(테이블 시트·만들기·사용자 카드·프로필) / C3 빠른 매칭 + 단톡방 / C4 관리자·내 정보·홈 연결 / C5 학교 연동(암호화 금고·가입 3단계·시간표 가져오기·학교 바로 신청).
- 루트 `C:\Users\1lebe\OneDrive\Desktop\상상Book-E-claude` (이하 `ROOT`). **여기에만 쓴다.** `C:\Users\1lebe\OneDrive\Desktop\아이디어 경진대회` 는 다른 도구의 폴더라 읽지도 쓰지도 않는다. `.env` 는 열지 않는다. `git` 명령 금지.
- 서버는 **이미 구현되어 있다**(라운지·학교 연동 API). 계약: `docs/lounge/01-contract.md`, 실제 동작: `docs/lounge/02-api-actual.md`(서버 검증 결과), 학교: `docs/school/00-design.md`. 서버 코드(`server/`, `shared/` 는 읽기 전용)를 고치지 않는다. API 에 부족한 점은 보고서에 적는다.

## 반드시 먼저 읽을 것
1. 자기 지시서 (`docs/lounge/tasks/C?-*.md`)
2. `docs/UI-KIT.md` — **디자인 계약**(토큰·컴포넌트·문장 규칙·검증 도구). 규칙 12개는 그대로 적용된다(색은 토큰만, rem, 굵기 400/700, 1.3rem 미만 글자 금지, 터치 44px, 한 화면 Primary 하나, 그림자 금지(시트·모달·토스트 제외), 모션 400ms 이하 등).
3. `DESIGN.md`(KRDS) 의 필요한 절, `docs/lounge/00-overview.md`(라운지 설계 — **지도 좌표·구역·테이블·목록 모드·시각 디자인 원칙**)
4. 이미 있는 기반: `client/src/lounge/{api.ts,LoungeContext.tsx}`, `client/src/lounge/parts/{Avatar.tsx,parts.css,GatheringListItem.tsx}`, `client/src/lounge/sheets/*.tsx`(**props 계약이 고정된 자리표시**), `client/src/school/{SchoolContext.tsx,SchoolLinkCard.tsx}`, `shared/lounge/*`, `shared/school/types.ts`, `client/src/ui/*`, `client/src/shell/Shell.tsx`.

## 코드 규칙
- React 19 + TypeScript strict + Vite. 클라이언트 tsconfig 는 bundler 해석. 공용 계약은 `../../../shared/lounge`(index) / `../../../shared/school/types` 로 import (상대 경로 깊이는 파일 위치에 맞게).
- 서버 호출은 `loungeApi`(client/src/lounge/api.ts) 와 `schoolApi`(C5)로만. 오류는 `ApiError(status, message, code)` — **`code` 로 분기**한다. `PROFILE_REQUIRED` 는 `useLounge().handleError(err)` 로 처리(시트가 열린다).
- 주석은 한국어, "왜"를 적는다. 페이지 전용 css 는 **자기 파일**에 두고 접두사를 쓴다(`lounge-world-`, `lounge-gath-`, `lounge-quick-`, `lounge-chat-`, `lounge-admin-`, `school-`). 공용 css(`styles/*`)는 고치지 않는다.
- 새 npm 패키지 금지.
- 시트·확인창은 `ui` 의 `Sheet`/`useConfirm`/`useToast` 를 쓴다(네이티브 `<dialog>`, 접근성 처리됨). `window.confirm/alert/prompt` 금지.

## 소유권 (충돌 방지)
- **자기 지시서의 파일만** 만들고 고친다. 자리표시 파일(이미 있는 sheets/*, parts/GatheringListItem, LoungePage 등)은 **export 이름과 props 계약을 유지한 채** 채운다(필요하면 optional props 만 추가).
- 공용 파일(`styles/*`, `ui/*`, `shell/*`, `App.tsx`, `api.ts`, `types.ts`, `time.ts`, `shared/**`, `client/src/lounge/{api.ts,LoungeContext.tsx}`)은 고치지 않는다. 필요한 변경은 보고서 `foundationRequests` 에. (예외: `ui/Icon.tsx` 에 아이콘이 꼭 모자라면 **보고서에 요청**하고 기다리지 말고 화면 안에서 인라인 SVG 로 해결)
- 다른 작업자의 화면은 **props 계약대로 import** 만 한다. 상대 화면이 아직 자리표시여도 컴파일된다. 개발 서버(5273/3101)를 끄거나 다시 띄우지 않는다.

## 확인 방법 (직접 눈으로, 직접 눌러서)
- 개발 서버는 떠 있다: 클라이언트 `http://localhost:5273`(HMR), API `:3101`(라운지 API 포함, `LOUNGE_DEV_SEED=1`). 데모 사용자는 `POST http://localhost:3101/api/lounge/dev/seed` (이미 시드됨, 멱등)로 8명(`demo1@hansung.ac.kr` … `demo8@…`, 비밀번호 `Demo1234!`)과 샘플 모임이 준비되어 있다.
- 타입: `node_modules/.bin/tsc -p client/tsconfig.json`. 캡처: `node scripts/shot.mjs <경로> <이름> --user=demo1 [--width=360 --height=740 --zoom=1.5 --contrast=high --full]` (경로는 앞의 `/` 없이: `lounge`, `account` …; 결과는 `shots/` 에서 `Read` 로 본다). 여러 사용자를 동시에: `scripts/lib.mjs` 의 `launch()` + `login(page,'demo2')` 로 컨텍스트를 여러 개 만든다(`openAs(browser, who)` 도우미 사용 가능).
- **360×740 과 390×844, 글자 150%(`--zoom=1.5`), 선명한 화면(`--contrast=high`)** 에서 모두 본다. 터치(탭·길게 누르기) 와 키보드 Tab 이동, 오류·빈 상태·로딩 상태를 실제로 만들어 확인한다.
- 확인한 것과 못 한 것을 **구분해서** 보고한다. 못 해 본 것을 해 봤다고 쓰지 않는다.

## 보고서 (JSON 스키마 하나)
`{ summary, filesChanged[], checklist[{item, status: done|changed|missing, note}], screenshots[], typecheckPassed, foundationRequests[], openIssues[] }`
