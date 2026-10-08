# 작업 C2 — 모임 UI: 테이블 시트 · 자리 만들기 · 사용자 카드 · 차단 목록 · 프로필 만들기

`docs/lounge/tasks/00-client-common.md` → `docs/lounge/00-overview.md` → `docs/lounge/01-contract.md`(§1, §3, §5) 를 읽는다. 원본 화면(ZIP, 읽기 전용): `ROOT\.tmp\reference\idea-zip\src\components\{GatheringCard,GatheringForm,SafetyMenu,BlockList}.tsx`, `components\meetup\MeetupLounge.tsx`. **기능은 ZIP 화면의 것을 전부 옮기되 화면은 KRDS 모바일 시트로 새로 짠다**(ZIP 은 Tailwind 카드 — 그대로 옮기지 않는다).

## 담당 파일 (자리표시를 채운다 — export 와 props 계약 유지)
```
client/src/lounge/sheets/TableSheet.tsx          테이블(모임) 상세
client/src/lounge/sheets/CreateGatheringSheet.tsx 자리 만들기(미팅/밥약)
client/src/lounge/sheets/UserSheet.tsx           사용자 카드(+신고·차단)
client/src/lounge/sheets/BlockListSheet.tsx      차단 목록
client/src/lounge/sheets/ProfileSheet.tsx        프로필 만들기·고치기 (LoungeProvider 가 렌더)
client/src/lounge/parts/GatheringListItem.tsx    모임 한 줄 요약
client/src/lounge/parts/SafetyForm.tsx           (새로) 신고·차단 폼 조각 — UserSheet 와 TableSheet 가 공용
client/src/lounge/gathering.css                  (접두사 lounge-gath-)
```

## 체크리스트
**TableSheet** (ZIP `GatheringCard` 의 모든 기능)
- [ ] `loungeApi.gathering(id)` 로 불러오고(`initial` 이 있으면 먼저 보여 줌), 열려 있는 동안 5초마다 새로고침, 오류·로딩 상태. 모든 동작 후 최신 view 를 `onChanged` 로 알린다.
- [ ] 머리: 종류 아이콘·제목·상태 배지(모집 중/마감/신청 마감/취소됨/종료 — 글자로), 주최자(아바타·닉네임·단과대·학번·매너온도 `TemperatureBadge`), 분위기 태그(#), 소개, 장소·시간·마감까지 남은 시간(`formatMeetAt`/`timeLeft`).
- [ ] **수업과 겹쳐요**: `viewer.timetableConflict` 가 있으면 경고 `Alert`("수업과 겹쳐요: 자료구조 — 그래도 참여할 수 있어요")를 보인다(막지 않는다).
- [ ] **자리**: 슬롯별 박스(우리 쪽/상대 쪽/같이 먹을 사람, `members.length/capacity`), 앉은 사람(아바타·닉네임·주최 표시·노쇼 확정 표시), 빈 자리. 선착순(`canJoin`)이면 빈 자리마다 "여기에 앉기"(눌러서 **확인 후** `act(id,'join',{slotKey})`; `focusSlotKey` 가 있으면 그 자리가 선택돼 있다). 승인제(`canApply`)면 "참여 신청하기" → 한마디 입력(≤200자) → `apply`. `blockedReason` 은 버튼 옆에 그대로 표시.
- [ ] 참여 취소(`canLeave`, `useConfirm`), 신청 취소(`isApplicant`), **단톡방 열기**(`roomOpen && isMember` → 시트를 닫고 `navigate('/lounge/rooms/:id')`).
- [ ] **모임 후 평가**(`canReview`): 같이 간 사람마다 `좋았어요/보통이에요/안 왔어요`(`REVIEW_LABEL`), 내가 남긴 평가 표시(`myReviews`, `aria-pressed`), 안내 "같이 간 사람 전원이 '안 왔어요'를 누르면 노쇼 경고가 들어가요", 노쇼 확정 표시.
- [ ] **주최자 메뉴**(`isHost`): 신청자 목록(아바타·닉네임·단과대·온도·한마디) 수락/거절(`approve`/`reject`), 신청자 없음 안내, **모임 취소**(`useConfirm`, danger).
- [ ] 신고·차단: 시트의 "⋯"(더보기 아이콘 버튼, `aria-label="신고 또는 차단"`) → 참여자 중 대상 고르기(나 제외) → `SafetyForm`. 차단하면 `onChanged` 로 지도·목록이 갱신되게 한다.
- [ ] 오류는 코드별 문구(`SLOT_FULL`: "이미 다른 사람이 앉았어요" 후 즉시 새로고침, `CONFLICT`, `PROFILE_REQUIRED` → `handleError`), 처리 중 중복 제출 방지, 성공은 토스트.

**CreateGatheringSheet** (ZIP `GatheringForm` + `MeetupLounge`)
- [ ] 미팅: 인원(1:1~4:4, 세그먼트), 한 줄 소개(≤60자, 예시 문구 "금요일 저녁 2:2 하실 분!"), 장소, 시간(`datetime-local`, 기본 24시간 뒤 정시 — `defaultLocalInput`), 상세(소개 ≤300자, 신청 마감 직접 설정; 기본은 약속 2시간 전, 약속이 2시간 안이면 약속 1분 전 이전으로 clamp), **같은 과는 빼고** 체크(안내: 아는 사람 마주치지 않게). 제출 = 선착순(`auto`)이며 서버가 자리 구성을 프리셋으로 다시 만든다 — `MEETUP_PRESETS[size].slots` 를 보내고 `meta.tags=[size, ('같은 과 제외')]`, `excludeSameDept`.
- [ ] 밥약: 정원(2/3/4), 제목·소개·장소, 장소 종류(`PLACE_TYPES`), 메뉴(`MENU_CATEGORIES`), 태그 복수(`MEAL_TAGS`), 만나는 시간, 신청 마감(안내: 마감 후에는 취소할 수 없어요 — 노쇼를 줄이려는 장치). 주최자 승인제.
- [ ] 검증(`noValidate`, 필드별 오류·첫 오류 포커스, 필수 `*`): 제목·장소 필수, 시간이 과거 금지, 마감 ≤ 약속. 제출 중 "올리는 중…", 실패 시 폼 위 `Alert`(입력 보존), 성공하면 `onCreated(view)` + 닫기 + 토스트. 시트는 닫을 때 입력 초기화.
- [ ] `kind` 가 바뀌어 열리면 해당 종류 폼.

**UserSheet**: `loungeApi.user(id)`(404 면 "볼 수 없는 사용자예요"), 아바타(lg)·닉네임·단과대·학번(`admissionLabel`)·매너온도(숫자+단계 글자+얼굴, 게이지는 색+글자), 내 id 면 "내 프로필" + 프로필 고치기 버튼(`useLounge().openProfileSheet`), 남이면 `SafetyForm`(신고 사유 `REPORT_REASONS`, 자세한 내용 ≤500자 "관리자만 볼 수 있어요", 신고하기 / 차단하기 — 차단은 `useConfirm`, 안내 "서로의 모임과 매칭에서 사라져요. 상대에게는 알리지 않아요", 신고는 "이미 신고한 건이에요" 오류 처리) + "차단한 사용자 보기"(BlockListSheet). 성공 시 `onSafetyChanged`.

**BlockListSheet**: `loungeApi.blocks()`, 아바타·닉네임·단과대, "차단 해제"(`useConfirm`), 빈 상태("차단한 사람이 없어요" + 안내), 변경 시 `onChanged`.

**ProfileSheet** (필수 — 라운지 입장권)
- [ ] 닉네임(2~8자, `NICKNAME_MIN/MAX`, 안내 "실명 대신 라운지에서 보이는 이름이에요"), 단과대(`COLLEGES`, `SelectField`), 학과(1~30자, 안내 "같은 과 제외·같은 과만 매칭에만 쓰이고 다른 사람에게는 보이지 않아요"), 입학년도(`ADMISSION_YEAR_MIN`~올해 셀렉트, 기본값은 `useSchool().profileHint?.admissionYear` 또는 이메일 학번에서 추정 `guessAdmissionYear`), 아바타(얼굴 12개 + 색 8개를 `role="radiogroup"` 선택 그리드, 미리보기 `Avatar lg`).
- [ ] 기본값: 처음이면 학교 연동 힌트(`useSchool().profileHint` — 학과·입학년도), 닉네임은 `defaultNickname(user.name)`(실명 가림). 고치는 중이면 현재 프로필.
- [ ] 저장 = `loungeApi.saveProfile` → `useLounge().setProfile` → 닫기 + 토스트("프로필을 저장했어요"). 서버 검증 오류는 필드별로 보여 준다. 처음 만드는 경우 닫기만 해서 건너뛸 수 있다(라운지가 안내를 보임). 동의·개인정보: 수집 목적을 평문으로.

**GatheringListItem**: 한 줄 카드(`.list__item--link` 스타일 재사용 가능): 종류 아이콘(미팅 `heart`·밥약 `utensils`), 제목, "금 19:00 · 상상관 앞", 자리 `3/4`, 상태 배지(+내 모임이면 "내 모임"/"신청 중"), 수업 겹침 배지, 단톡방 열림 아이콘. 터치 높이 56 이상. `aria-label` 로 요약 낭독.

## 확인 시나리오
demo1~demo3 컨텍스트로: ① 미팅 만들기(2:2) → demo2 가 의자 확인 후 앉기 → 마지막 자리 경쟁 메시지 ② 밥약 모집 → 신청 → 승인/거절 → 참여 취소 ③ 같은 과 제외 미팅에 같은 학과 사용자 시도 ④ 시간이 지난 모임(시드의 종료 모임 또는 DB 로 시각 변경)에서 평가 3종 ⑤ 신고·차단·차단 해제 ⑥ 프로필 없는 admin1 으로 ProfileSheet 만들기(오류 포함) ⑦ 360/390·글자 150%·선명한 화면 캡처, 키보드 Tab·포커스 가둠, 가로 넘침·콘솔 오류 없음.
