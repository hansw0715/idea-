# 상상Book-E

> 같이 밥 먹고, 같이 만나고, 같이 이용하는 한성 캠퍼스 연결 플랫폼
> 한성 아이디어 경진대회 출품작 (팀 상상Book-E)

한성대 학생이 시간표를 모아 **함께 비는 시간**을 찾고, 그 시간에 쓸 수 있는 **교내 시설을 예약**하는 모바일 우선 웹 앱입니다.
신청서의 전체 구상(밥 약속 · 팀 빌딩 · 소개팅 · 매너 점수)에서 **1단계 = 팀 빌딩(기존 앱 cody)** 을 모바일 UI 로 옮긴 상태입니다.

## 1단계에 들어 있는 기능

하단 탭바로 이동합니다: **홈 · 시간표 · 회의 · 내 정보**

- **회원가입 / 로그인** — 한성대 메일(`@hansung.ac.kr`) 인증코드 가입, 학번만 입력해도 로그인
- **내 시간표** — 월~금 09:00~22:00, 30분 단위. 격자에서 탭·길게 눌러 끌기로 일정 추가, 매주/그 날만 반복, 학교 강의시간표에서 과목 검색해 담기
- **회의(팀)** — 4자리 코드로 만들고 참가, 참여자 선택, 팀원 시간표 겹쳐 보기
- **회의 예약** — 팀원 전체의 공통 여유 시간 계산 → 날짜 → 이용 가능한 시설 → 예약. 학교 예약 사이트 연결과 예약 확인
- **홈** — 다가오는 예약, 내 회의, 이번 주 시간표
- **글자·화면 설정** — 글자 크기 90~150%, 선명한 화면(고대비) — 모든 화면 헤더에서 열림

다음 단계(아직 없음): 밥 약속(실시간 매칭·화살표 길 안내), 소개팅, 매너 점수와 이용 제한.

## 실행

```bash
npm install
npm run dev
```

- 클라이언트 http://localhost:5273 (Vite, `/api` 는 서버로 프록시)
- API 서버 http://localhost:3101
- 데이터: 로컬 PGlite (`~/.sangsang-booke`, 최초 실행 시 테이블·시설 자동 생성). `DATABASE_URL` 이 있으면 Supabase 등 Postgres 사용

시연 계정과 데이터(관리자 3명 + 시간표 + 회의 "캡스톤 디자인 팀" + 예약 1건):

```bash
# 서버를 ADMIN_PASSWORD 와 함께 시작 (빈 DB 일 때 admin1~3@hansung.ac.kr 생성)
ADMIN_PASSWORD='Test1234!' npm run dev:server
npm run seed:demo
```

인증 메일 SMTP 가 없으면 가입 인증코드가 **API 서버 콘솔**에 출력됩니다. (`.env.example` 참고)

휴대폰으로 보려면 PC 와 같은 Wi-Fi 에서 `npx vite --config client/vite.config.ts --host` 로 열고 `http://<PC IP>:5273` 에 접속합니다.

## 화면 확인 도구

```bash
npm run shot -- timetable my-shot --user=admin1 --full      # 모바일 390×844 캡처 → shots/
npm run shot -- account acc-150 --zoom=1.5                   # 글자 150%
npm run shot -- account acc-hc --contrast=high               # 선명한 화면
```

## 디자인

디자인은 [`DESIGN.md`](DESIGN.md) (KRDS, 대한민국 정부 디자인 시스템)를 따릅니다.
`DESIGN.md` 의 "Explicit user selections" — Primary `#6366f1`, 라운드 4px, 밑줄형 입력, solid 내비, compact 밀도 — 가 KRDS 일반 서술보다 우선합니다.
토큰·컴포넌트·문장 규칙은 [`docs/UI-KIT.md`](docs/UI-KIT.md) 를 보세요.

## 구조

```
server/            Express API (cody 와 동일 — 시간표·회의·시설·예약·과목·인증)
client/src/
  styles/          tokens.css(KRDS 토큰) · base.css(프레임·헤더·탭바) · components.css
  ui/              Button · TextField 등 폼 · Alert · Sheet · useConfirm · useToast · 글자·화면 설정
  shell/           앱 프레임 · 상단 헤더 · 하단 탭바 · 오류 화면
  pages/           Login · Signup · Dashboard · TimetablePage · Meetings · MeetingDetail · Account
  components/      TimetableGrid(터치 대응 시간표 격자) · CourseSearch · BookingFlow
docs/              UI-KIT.md(UI 계약) · tasks/(작업 지시서)
scripts/           seed-demo.mjs · shot.mjs · lib.mjs
```

배포(Vercel · Netlify · Fly.io)와 환경 변수는 cody 와 같은 방식입니다: `DATABASE_URL`, `JWT_SECRET` 필수.
