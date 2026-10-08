# 작업 D — 회의 상세 · 단계별 예약 흐름

## 담당 파일 (이것만 쓴다)
- `client/src/pages/MeetingDetail.tsx` (stub — 덮어쓴다)
- `client/src/components/BookingFlow.tsx` (새로 — 예약 흐름을 이 파일로 분리해도 된다. 상태가 얽혀 있으면 한 파일에 둬도 좋다)
- `client/src/pages/meeting-detail.css`

## cody 원본 (읽기 전용)
`cody/client/src/pages/MeetingDetail.tsx`(750줄 — **전부 읽는다**), `cody/client/src/time.ts`, `cody/server/meetings.ts`, `cody/server/reservations.ts`, `cody/server/facilities.ts`, `cody/server/freeTime.ts`, `cody/UX-CONTRACT.md`(예약 상태 용어), `cody/client/src/styles.css` 의 `.facility-*`, `.chip`, `.step-*`, `.booking-*`

## 의존하는 공용 모듈 (수정 금지)
- `components/TimetableGrid` — 작업 C 가 모바일용으로 다시 쓰는 중이다. **지금의 props 로 쓰면 된다**(`entries, laneCount, compact, selectable, onSelectRange, pendingRange, freeRanges, weekStart, onPrevWeek, onNextWeek, slide`, `MEMBER_COLORS`). 겉모습·터치 동작은 C 의 작업을 따른다. 격자가 아직 cody 모양이면 스타일은 무시하고 로직만 연결해 두었다가, C 가 끝난 뒤 다시 캡처해 확인한다.
- `time.ts`, `useWeek.ts`, `reservationStatus.ts`, `types.ts`, `shell/Shell.tsx` 의 `useHideTabBar`

## 기능 유지 체크리스트 (cody 의 모든 동작)
**데이터 로딩**
- [ ] `GET /meetings/:id`(상세·멤버), `GET /meetings/:id/timetable?week=`(팀원 시간표), `GET /reservations/meeting/:id`(예약) — `loadAll`
- [ ] **15초마다 + 창 포커스 시 다시 불러오기**(다른 사람이 참가하면 팀원 목록이 갱신됨). 언마운트 시 정리
- [ ] 불러오기 실패 시 화면 전체 오류 `Alert`, 불러오는 중 상태
**회의 정보**
- [ ] 회의 이름, 안내("회의 코드를 팀원에게 공유하면 함께 시간을 맞출 수 있습니다."), 4자리 코드 표시, **코드 복사**(클립보드 → 성공 토스트 "회의 코드를 복사했습니다.", 실패하면 선택 가능한 코드 표시로 대체 — `window.prompt` 쓰지 않는다)
- [ ] 방장은 **회의 삭제**, 그 외는 **나가기** — 확인 다이얼로그(`useConfirm`, `tone:'danger'`, `run` 으로 API 호출): 방장 "'{이름}' 회의를 삭제할까요? 예약과 멤버 정보가 모두 삭제됩니다." / 멤버 "'{이름}' 회의에서 나갈까요?" → 방장 `DELETE /meetings/:id`, 멤버 `POST /meetings/:id/leave` → `/meetings` 로 이동
**팀원**
- [ ] 팀원 N명 · "회의에 참여할 사람 M명", 이름 칩 토글(`aria-pressed`)로 이번 회의에서 빼거나 다시 넣기, 사람별 색 점(`MEMBER_COLORS`), 방장 배지, 제외된 사람은 "제외됨" 표시. 빠진 사람의 수업은 시간 계산에 반영되지 않음 안내
- [ ] 팀원 목록이 바뀌면 참여자 기본값 = 전원 (나간 사람 제거, 새로 온 사람 자동 추가)
- [ ] 참여자를 바꾸면 여유 시간·선택(range, 날짜, 시설, 오류)을 모두 초기화하고, 새 결과가 오기 전엔 옛 여유 시간을 보여 주지 않음
**팀원 시간표**
- [ ] 주 이동, "이번 주로", 라벨. 팀원 수업(사람별 레인) + **이 회의로 확정된 예약**을 함께 표시(예약은 전체 폭, 제목=시설명, 부제=날짜). 시간표가 없으면 안내 문구
- [ ] 범례(확정된 회의 예약), 그리고 **사람별 색 범례(이름)** — 칸이 좁아 글자가 없으므로 모바일에서는 이름·색 대응을 반드시 보여 준다
**예약 흐름 (cody: 시간표 드래그 → 날짜 → 시설 → 예약하기)**
- [ ] 열릴 때 `resetFlow`. 열려 있는 동안 `GET /meetings/:id/free-slots?duration=30&week={weekStart}&members={ids}` 로 공통 여유 시간을 계산(참여자·주가 바뀌면 재조회, 경쟁 시 이전 응답 무시). 참여자가 0명이면 조회하지 않음
- [ ] 여유 시간이 없으면 "모든 팀원이 함께 비는 시간이 없습니다. 팀원 시간표를 확인해 보세요."
- [ ] 시간 고르기: 격자에서 여유 구간 안에서만(`freeRanges` 강조 + `selectable`). 선택이 여유 구간을 벗어나면 오류 "참여자 중 수업이 있거나 예약할 수 없는 시간입니다. …구간 안에서 선택해 주세요." (색 이름만 쓰지 말고 표시 방식을 글로) / **하루 최대 3시간**(`MAX_RESERVATION_MIN = 180`) 초과 시 "학교 규정상 하루 최대 3시간까지 이용할 수 있습니다." / 선택 요약 "{요일}요일 {시작}~{종료} ({n시간 m분})"
- [ ] 시간이 정해지면 **날짜 선택**: `nextDatesForDay(range.day)` 중 오늘이면서 시작 시각이 이미 지난 날은 제외(`bookableDates`). 없으면 "이 요일은 앞으로 7일 안에 신청할 수 있는 날이 없습니다. 다른 요일을 골라 주세요." + 학교 규정 안내(이용일 7일 전부터)
- [ ] 날짜가 정해지면 `GET /facilities?date&start&end&people={참여인원}` — 이전 응답 무시, 로딩 상태, 오류 표시
- [ ] 시설 카드: 이름, "건물 · 인원(min~max명 | 최대 N명 | N명 이상 | 인원 기준 없음) · 시스템", 설명, 상태 배지(`campusState` closed → "학교 신청불가", reserved → "학교에서 예약됨", `plannedHere` → "우리 팀이 잡아 둠", 그 외 "예약 가능"), `available===false` 는 선택 불가
- [ ] `campusStatus==='unavailable'` 이면 "학교 예약 현황을 불러오지 못했습니다. 아래 목록은 우리 앱 기준이므로, 학교 사이트에서 실제 빈자리를 한 번 더 확인해 주세요."
- [ ] `hiddenByCapacity>0` 이면 "참여 {n}명 기준으로 인원 조건이 맞지 않는 시설 {k}곳은 목록에서 뺐습니다."
- [ ] 요약("{시설} ({건물}) · {날짜} {시간} · {n시간}") 후 **예약하기**: `POST /reservations {meetingId, facilityId, date, startMin, endMin, memberIds}`, 제출 중 중복 방지, 성공하면 흐름을 닫고 재조회, 실패 시 서버 메시지(흐름 유지)
- [ ] 성공 안내(화면 안 `Alert tone="success"`): "{시설}({건물})을 {날짜} {시간}에 예약했습니다." + **"아직 학교 예약은 끝나지 않았습니다."** + "{학교 시스템 이름} 예약 시스템에서 같은 시간으로 신청을 완료해 주세요." (+ 문의처) + 학교 예약 시스템 열기 링크(`target=_blank rel=noreferrer`)
**예약 현황**
- [ ] 목록: "시설 · 건물" + 상태 배지(`reservationStatus`), "{날짜} {시간} · 예약자 {이름}", 비어 있으면 안내(예약 시작하기)
- [ ] 학교에서 확인되지 않은 예약에 **학교 예약 확인**: `POST /reservations/:id/confirm-check` → `{confirmed}`. 확인되면 "…예약이 학교 시스템에서 확인되었습니다.", 아니면 "아직 학교 시스템에서 이 시간이 예약으로 보이지 않습니다. 학교 사이트에서 신청을 마쳤는지 확인한 뒤, 잠시 후(현황 갱신에 시간이 걸릴 수 있습니다) 다시 눌러 주세요." 확인 중 버튼 비활성
- [ ] **취소**: 확인 다이얼로그("{날짜} {시설} 예약을 취소할까요?" — 앱 안 계획이며 학교에 신청한 예약은 학교 사이트에서 따로 취소해야 한다는 점을 문장에 포함) → `DELETE /reservations/:id` → 재조회
- [ ] (개선) 확인되지 않은 예약에 `reserveUrl` 이 있으면 "학교 예약 사이트 열기" 링크

## 모바일 설계 방향
- **헤더**: `<AppHeader title={detail.name} backTo="/meetings" />` (이 제목이 h1). 본문에 h1 을 또 두지 않는다. 로딩·오류 중에도 헤더(뒤로가기)는 보인다.
- **본문 순서**: ① 회의 코드 카드(큰 코드 + "코드 복사" Secondary + 안내) ② **Primary "회의 예약하기"**(이 화면의 유일한 Primary) ③ 팀원(칩) ④ 팀원 시간표(+ 색 범례) ⑤ 예약 현황 ⑥ 맨 아래 위험 구역 "회의 나가기/삭제"(`Button variant="danger"`). 예약 성공 `Alert` 는 ② 아래.
- **예약 흐름은 전체 화면**: `Sheet full` 또는 직접 만든 전체 화면 오버레이 + `useHideTabBar()`. 상단에 닫기(×)와 `Stepper`("시간" → "날짜" → "시설" → "확인"), 본문, 하단 `.sticky-actions`(또는 시트 footer)에 "이전"(Tertiary) / "다음"(Primary, 해당 단계 조건을 만족해야 활성, 이유를 보조 문구로) — 마지막 "확인" 단계의 Primary 는 "예약하기"(제출 중 "예약 중…"). 한 단계에 Primary 는 하나.
  - 1단계 시간: 격자(여유 구간 강조) + **여유 시간 목록**(카드/행: "수요일 13:00~16:00 (3시간)" — 탭하면 그 구간 안에서 최대 3시간으로 선택) + 시작·종료 `SelectField`(여유 구간 안에서 30분 단위)로 미세 조정. 선택 요약 상시 표시. 격자 터치 선택은 C 의 동작(탭/길게 눌러 끌기)을 쓴다.
  - 2단계 날짜: `.tag` 목록(`aria-pressed`), 안내문.
  - 3단계 시설: 세로 카드 목록. 선택 가능한 카드는 `<button>`(또는 `role="radio"` 그룹), 선택 시 `aria-pressed/checked` + 테두리·배경 + "선택됨" 글자. 불가 카드는 `disabled` + 사유 배지.
  - 4단계 확인: 요약(`.kv` 행: 시설·건물·날짜·시간·이용 시간·참여 인원) + 안내.
  - 흐름을 닫아도(×) 선택 상태는 버린다(cody 의 `closeBooking` 과 동일: 오류만 지우고 열 때 `resetFlow`).
- 참여자 칩: `Tag`(`tag` 클래스) + 색 점(`tag__dot`) + 이름 + (방장 배지) + 제외 시 "제외됨". 칩을 눌러 바뀌는 건 팀 전체 계산에 영향이 있으니 변경 즉시 `aria-live` 로 "참여 M명" 갱신.
- 팀원 시간표 격자는 읽기 전용으로 쓰고, 격자 항목 탭 시 정보 시트는 격자가 제공한다(작업 C).
- 예약 현황 행은 한 줄에 버튼이 둘 들어가면 좁으니 본문 아래 줄에 `Button size="sm"` 둘을 가로 배치. 상태는 배지 + 글자.
- 모든 파괴적/비동기 동작은 `useConfirm`, 가벼운 확인은 `useToast`.

## 보고서 스키마
공통 지침의 JSON 스키마를 따른다.
