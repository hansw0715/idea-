# 작업 C — 시간표 화면 · 시간표 격자 · 과목 검색

## 담당 파일 (이것만 쓴다)
- `client/src/pages/TimetablePage.tsx` (stub — 덮어쓴다)
- `client/src/components/TimetableGrid.tsx`, `client/src/components/CourseSearch.tsx` (지금은 cody 원본 복사본 — **모바일용으로 다시 쓴다**)
- `client/src/components/timetable.css`, `client/src/pages/timetable.css`

## cody 원본 (읽기 전용)
`cody/client/src/pages/TimetablePage.tsx`, `cody/client/src/components/TimetableGrid.tsx`, `CourseSearch.tsx`, `cody/client/src/styles.css` 의 `.tt-*` 규칙(격자 치수·겹침·애니메이션), `cody/server/timetable.ts`·`courses.ts`·`coursesRouter.ts`(검증 규칙·오류 문구)

## ⚠ TimetableGrid 는 3개 화면이 공유한다
홈(작업 B: `compact`+주 이동), 회의 상세(작업 D: `laneCount`+`freeRanges`+`selectable`+`pendingRange`+주 이동+`MEMBER_COLORS`)가 **지금의 props 로 이미 코드를 짜고 있다.** 따라서:
- `Props` 의 기존 이름·타입·의미를 **바꾸지 않는다** (`entries, laneCount, compact, onEntryClick, selectable, onSelectRange, pendingRange, freeRanges, weekStart, onPrevWeek, onNextWeek, slide, step`). 필요하면 **선택(optional) props 만 추가**한다.
- `GridEntry`, `SelectedRange`, `MEMBER_COLORS`(배열) export 를 유지한다. `MEMBER_COLORS` 의 값은 CSS 변수 문자열(`'var(--m-1)'` … `'var(--m-8)'`)로 바꿔 헥스를 없앤다. 사용처는 `style={{ background: MEMBER_COLORS[i] }}` 형태이므로 그대로 동작한다.
- `reservationsToEntries` 는 이제 `src/gridEntries.ts` 에 있다. `TimetablePage` 에서 export 하지 않는다.
- 선택 범위 표시는 색만이 아니라 시간 글자(`09:00~10:30`)를 함께 보여 준다 (기존과 동일).

## 기능 유지 체크리스트
**격자(TimetableGrid)**
- [ ] 월~금 5열, 09:00~22:00, 30분 단위, 정각 눈금선과 시각 라벨(마지막 22:00 라벨 잘리지 않게)
- [ ] 머리글: `weekStart` 가 있으면 `9/18(목)` 형식 날짜, 오늘은 강조(색만이 아닌 굵기/표식 병행). 없으면 요일 이름
- [ ] 같은 날 겹치는 항목을 나란히 배치(`placeOverlaps` 로직 유지), `laneCount>1`(팀원 시간표)이면 사람별 세로 레인 + 사람별 색, 예약 블록은 전체 폭
- [ ] 블록: 제목(+ 1시간 이상이고 부제/장소가 있으면 한 줄 더). 팀원 시간표(`multi`)에서는 칸이 좁아 글자 없이 색 블록만
- [ ] `kind==='reservation'` 은 확정된 예약으로 구분해 그림 (색 + 라벨/패턴으로 구분, 색만 X)
- [ ] 드래그로 시간 선택: `selectable` 일 때 열을 눌러 끌면 `{day,startMin,endMin}` 으로 `onSelectRange`, 짧게 눌러도 최소 `step`(기본 30분) 한 칸이 잡힘, 기존 블록 위에서는 드래그 시작 안 됨, 범위 밖 clamp
- [ ] `freeRanges`(팀원 모두 비는 시간) 배경 강조, `pendingRange` 표시, `step` prop(드래그 단위)
- [ ] 주 이동(`onPrevWeek`/`onNextWeek`, `slide` 방향 애니메이션 — 400ms 이하, reduced-motion 이면 즉시)
- [ ] 항목 정보 보기: cody 는 마우스 hover 툴팁(제목·요일 시간·부제·장소·팀원 이름+색). **모바일에는 hover 가 없다 → 항목을 탭하면 정보(제목, `월요일 10:00~12:00`, 장소/부제, 팀원 이름)를 보여 주는 시트 또는 팝오버**. `onEntryClick` 이 있으면 그 콜백이 우선(시간표 편집 화면은 삭제 흐름으로 연결), 없으면 격자가 자체 읽기 전용 정보 시트를 연다.
- [ ] 키보드/보조기기: 항목은 버튼으로 포커스 가능, `aria-label` 에 제목·요일·시간. 격자 열은 선택 가능 시 "시간 직접 입력" 대체 수단이 화면에 있음(아래 시간표 화면의 입력 시트)
**시간표 화면(TimetablePage)**
- [ ] `GET /dashboard?week={weekStart}` 로 내 일정 + 그 주 예약 (주 이동 시 재호출)
- [ ] 내 수업·일정 + 회의 예약/계획(학교 처리 상태 문구 포함 subtitle) 표시, 범례
- [ ] 격자에서 시간 선택(탭 또는 드래그) → 즉시 "일정 추가" 입력: 일정(필수, 선택 직후 자동 포커스) / 장소(선택) / 반복 `매주|그 날만`(설명 문구: "매주 {요일}요일마다 표시됩니다." / "{날짜} 하루에만 표시됩니다.") / "시간 직접 고치기": 요일·시작·종료 셀렉트(시작 변경 시 종료가 시작+30분 미만이면 보정, 종료 옵션은 시작+30분부터) → `POST /timetable {day,startMin,endMin,title,place,repeatKind,date}` (`date` 는 `weekDates(weekStart)[range.day]`), 성공 시 입력 닫고 재조회, 실패 시 서버 메시지
- [ ] 입력을 취소하면 입력값·반복·오류 초기화
- [ ] 등록된 수업을 탭 → 삭제: 확인 후 `DELETE /timetable/:id` → 재조회. 예약 블록은 지울 수 없고 안내 "회의 예약은 시간표에서 지울 수 없습니다. 해당 회의 화면에서 학교 예약 내역을 확인해 주세요."
- [ ] 안내 문구(드래그/탭으로 시간 정하기, 수업 탭하면 정보·삭제)
**과목 검색(CourseSearch)**
- [ ] `GET /courses/options` → 학기(기본 첫 항목)·학과(교양 `code` 가 `L` 로 시작 / 전공으로 optgroup) 목록, 실패 시 오류 표시
- [ ] 학기·학과 선택 시 `GET /courses?term&major[&grade][&q]` (학년은 응답의 `grades` 로 채움, 학과 바꾸면 학년 초기화, 학과 없으면 학년·검색 비활성), 요청 경쟁 시 이전 응답 무시
- [ ] 목록 최대 60개 + "N개 중 60개만 표시했습니다. 검색어로 좁혀 보세요."
- [ ] 항목: 과목명 + 분류 배지, "{요일} {시간}, …", 강의실·교수·학년, 온라인 전용 안내("…은 대면 시간이 아니라 시간표에 넣지 않습니다.")
- [ ] "담기": 과목의 모든 대면 시간대를 `POST /timetable` 로 각각 추가, 전부 실패/일부 실패/성공 메시지 구분 (원문 의미 유지), 담은 뒤 시간표 재조회, 성공은 토스트
- [ ] 불러오는 중·조건 없음·결과 없음 상태 문구

## 모바일 설계 방향
- 화면 구성: 상단 `Tabs`("시간표" | "과목 검색"). 시간표 탭: 주 이동 바(‹ 이전 주 | 라벨 | 다음 주 ›, 이번 주가 아니면 "이번 주로") → 범례 → 격자 → 안내. 오른쪽 위에 Secondary `일정 추가` 버튼(드래그 없이도 입력 시트를 여는 **항상 쓸 수 있는 대체 경로**, 기본값은 오늘 요일(주말이면 월요일) 현재 시각 이후의 정시 1시간).
- 격자 크기: 폭 360 에서 시각 축 3.6rem + 5열이 읽힐 것. 글자는 1.3rem 이상(KRDS 최소). 높이는 rem 으로(시간당 약 4.4~4.8rem). 항목 블록 최소 터치 높이가 모자라면 탭 영역을 키운다. 격자는 페이지 세로 스크롤 안에서 자연스럽게 스크롤되어야 한다.
- **터치 선택**: 마우스는 눌러 끌기, 터치는 **탭 = 그 칸 30분 선택, 길게 눌렀다(약 350ms) 끌기 = 범위 선택** 이어야 한다. 세로 스크롤이 막히면 안 된다(열에 `touch-action: pan-y`, 길게 눌러 드래그가 시작된 뒤에만 `touchmove` 를 non-passive 로 `preventDefault`). Playwright 로는 `page.evaluate` 로 `PointerEvent`(`pointerType:'touch'`)를 합성해 길게 누르기·끌기·탭·세로 스크롤을 검증한다.
- 입력은 `Sheet`(바텀 시트): 제목 "{날짜/요일} {시작}~{종료} 일정 추가", 일정·장소(`TextField`), 반복(`Segmented`), 시간(요일·시작·종료 `SelectField`, 기본 펼침 — 모바일에선 접어 두지 않는다), footer 에 Primary "추가하기"(제출 중 "추가하는 중…") + Tertiary "취소". 성공하면 토스트 "일정을 추가했습니다."
- 항목 탭 시트: 정보 + (삭제 가능한 수업이면) `danger` "삭제" 버튼 → `useConfirm`(`run` 으로 삭제, 실패 시 다이얼로그 안 오류).
- 과목 검색은 한 열: 셀렉트 3개(학기·학과·학년) + 검색어, 아래 결과 목록(`.list`). "담기" 는 Secondary `sm`. 결과 항목은 터치 높이 56 이상.
- 색: 내 수업 = `--primary-*` 계열 틴트 + 왼쪽 3px 막대, 예약 = `--success-*` 틴트 + 막대 + 라벨, 선택 범위 = `--primary-50` 테두리/틴트 + 시간 글자, 비는 시간 = `--primary-10`(+ 범례 글자), 오늘 열 머리글 = `--primary-5` 배경 + 굵게. 팀원 색은 `--m-1..8`. 색만으로 구분하지 않는다.
- 선명한 화면 모드·글자 150% 에서도 겹치거나 잘리지 않는지 확인한다.

## 보고서 스키마
공통 지침의 JSON 스키마를 따른다. 추가로 `gridApi` 필드(문자열)에 최종 TimetableGrid props 를 한 줄씩 적는다 (다른 작업자와 리뷰어가 참조).
