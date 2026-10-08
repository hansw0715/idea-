# 작업 B — 홈(대시보드) · 회의 목록

## 담당 파일 (이것만 쓴다)
- `client/src/pages/Dashboard.tsx`, `client/src/pages/Meetings.tsx` (현재는 stub — 덮어쓴다)
- `client/src/pages/home.css`, `client/src/pages/meetings.css`

## cody 원본 (읽기 전용)
`cody/client/src/pages/Dashboard.tsx`, `Meetings.tsx`, `cody/server/dashboard.ts`, `cody/server/meetings.ts`(응답 형태·오류 문구), `cody/client/src/styles.css` 중 `.week-bar`·`.row-item` 부분

## 의존하는 공용 모듈 (수정 금지)
- `components/TimetableGrid` — **다른 작업자(C)가 지금 모바일용으로 다시 쓰는 중**이다. 현재 props(`entries, compact, weekStart, onPrevWeek, onNextWeek, slide, …`)를 그대로 쓰면 되고, 겉모습은 C 의 작업에 따라 바뀐다. 주 이동 UI 도 격자 컴포넌트가 가질 수 있으니, 캡처에서 주 이동이 중복되면 보고서 `openIssues` 에 적는다.
- `gridEntries.ts` 의 `reservationsToEntries`, `useWeek`, `time.ts` 의 `fmt*`, `reservationStatus.ts` (배지는 `className={`badge ${status.className}`}`)

## 기능 유지 체크리스트
**홈**
- [ ] 인사말 "안녕하세요, {이름}님" + 한 줄 안내
- [ ] `GET /dashboard?week={weekStart}` 한 번 호출로 `timetable / meetings / reservations / weekReservations` 를 받음 (주가 바뀔 때마다 다시 호출)
- [ ] 내 시간표: 주 라벨(`fmtWeekLabel`), 이번 주가 아니면 "이번 주로", 격자(`compact`)에 수업 + 예약(`reservationsToEntries(weekReservations)`) 표시. 한 번만 있는 일정 `subtitle` = `${fmtDayHeader(date)} 하루만`
- [ ] "시간표 편집하기" → `/timetable`
- [ ] 내 회의: 최대 5개, 이름 + "멤버 N명" + 회의 코드 배지, 탭하면 `/meetings/:id`, "회의 관리하기" → `/meetings`, 비어 있으면 안내
- [ ] 다가오는 예약: 최대 5개, "시설 · 건물", 날짜(`fmtDate`) + 시간(`fmtRange`) + 회의 이름, 학교 확인 상태 배지, 비어 있으면 안내
- [ ] (개선) 예약 행을 누르면 해당 회의(`/meetings/:meetingId`)로 이동
- [ ] (개선) 불러오기 실패를 삼키지 말고 `Alert` + "다시 시도" 로 보여 준다 (cody 는 오류를 무시했다). 불러오는 중 상태도 보여 준다
**회의 목록**
- [ ] `GET /meetings` 로 내 회의 목록: 이름, "멤버 N명", 코드 배지, 탭하면 상세로
- [ ] 새 회의 만들기: 회의 이름 입력(필수, 1~30자) → `POST /meetings {name}` → 성공 시 `/meetings/:id` 로 이동, 실패 시 서버 메시지
- [ ] 코드로 참가: 숫자 4자리(`inputMode="numeric"`, 숫자만 입력되게) → `POST /meetings/join {code}`
  - 응답 `alreadyMember` 이면 이동하지 않고 안내: "{이름}님은 이미 '{회의}'의 {방장입니다|멤버입니다}. 다른 팀원이 참가하려면 그 사람의 계정으로 로그인한 뒤 코드를 입력해야 합니다."
  - 아니면 `/meetings/:id` 로 이동. 실패 시 서버 메시지 (429·404 포함)
- [ ] 목록이 비어 있으면 다음 행동 안내 (회의 만들기)

## 모바일 설계 방향
- **홈 순서**(모바일에서 가장 급한 것 먼저): 인사말 → 다가오는 예약 → 내 회의 → 이번 주 시간표(미리보기). 각 구역은 `.section` + `.section__head`(제목 + 오른쪽 `Button variant="text"` 더보기 링크).
- 홈에는 Primary 버튼을 두지 않아도 된다(탐색 화면). 구역 안 링크는 Text/Secondary.
- 시간표 미리보기는 카드 하나 안에 격자를 넣고, 주 이동·라벨은 격자의 것을 쓰되 중복되지 않게 한다. 격자가 화면 폭을 넘치면 안 된다.
- 회의 행: `.list__item.list__item--link` 로 통째로 탭 가능하게(높이 56 이상), 오른쪽에 코드 배지 + `chevron-right`. 코드는 `.code-chip`.
- 회의 목록 화면 상단: Primary "회의 만들기"(→ `Sheet` 안에 이름 입력 폼, footer 에 제출), Secondary "코드로 참가하기"(→ `Sheet` 안에 4자리 입력). 두 시트의 오류·`alreadyMember` 안내는 시트 안 `Alert` 로. 시트가 닫히면 입력·오류를 초기화한다.
- 코드 입력: 큰 글자·넓은 자간(`.code-chip`), 4자리가 채워지면 제출 버튼 활성.
- 불러오는 중에는 `LoadingBlock`, 빈 상태는 `EmptyState`(제목 + 행동 버튼).

## 보고서 스키마
공통 지침의 JSON 스키마를 따른다.
