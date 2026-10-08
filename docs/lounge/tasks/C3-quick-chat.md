# 작업 C3 — 밥약 빠른 매칭 시트 + 단톡방 화면

`docs/lounge/tasks/00-client-common.md` → `docs/lounge/00-overview.md` → `docs/lounge/01-contract.md`(§3.5, §4) 를 읽는다. 원본(ZIP, 읽기 전용): `ROOT\.tmp\reference\idea-zip\src\components\{meal\QuickMatchPanel,chat\ChatRoom}.tsx`. 기능은 전부 옮기고 화면은 KRDS 모바일로 새로 짠다.

## 담당 파일
```
client/src/lounge/sheets/QuickMatchSheet.tsx   (자리표시를 채운다, props 계약 유지)
client/src/lounge/ChatRoomPage.tsx             (자리표시를 채운다; 라우트 /lounge/rooms/:id)
client/src/lounge/quick.css   (접두사 lounge-quick-)
client/src/lounge/chat.css    (접두사 lounge-chat-)
```

## 체크리스트
**QuickMatchSheet** (ZIP `QuickMatchPanel` 전부)
- [ ] 열릴 때 `loungeApi.quick()` 로 상태를 받고, 열린 동안 5초 폴링(탭이 보일 때만). 상태: **조건 입력**(요청 없음/취소됨/방 취소·확정 뒤) · **대기 중**(스피너 + "같이 먹을 사람을 찾는 중…", 조건 요약, 대기 인원 수, "대기 취소" `useConfirm`) · **후보 방**(아래) · **확정**(성공 `Alert` + "밥약이 목록에 추가됐어요. 시간·장소를 한 번 더 확인해 주세요" + 단톡방/모임 보기 버튼, `onConfirmed(gatheringId)` 호출) · **방 취소됨**(안내 `Alert`: 누군가 거절했거나 시간이 지났어요, 다시 신청 가능).
- [ ] 조건 입력: 날짜(`todayKst()` 이상, `type=date`), 장소 종류(`PLACE_TYPES`), 인원(`MEAL_CAPACITY_OPTIONS` 2/3/4 — 나 포함 안내), 가능한 시간(`TIME_BANDS` 칩 복수 선택, "여러 개 고를수록 빨리 매칭돼요", 시간 구간이 지난 오늘 칩은 비활성+이유), 태그(`MEAL_TAGS` 복수, "같은 과만" 안내 문구). 선택 없음이면 "매칭 시작" 비활성+이유 문장. 제출 중 중복 방지. 오류는 코드별(`BANNED`, `ALREADY_JOINED`, `INVALID`, `PROFILE_REQUIRED` → `handleError`).
- [ ] 후보 방: 수락 `n/전체`, 날짜·장소·인원, 멤버 칩(아바타·닉네임·단과대·수락 ✓ 표시), **가능한 시간 투표**(`room.bands` 칩, 내 표 `aria-pressed`, 표 수 표시, "표가 가장 많은 시간으로 정해져요. 동점이면 이른 시간이에요"), 겹치는 시간이 없으면 안내, **수락**(처리 중/수락함·나머지 기다리는 중 상태) / **거절**(`useConfirm`), 남은 시간 카운트다운(`expiresAt`, "30분 안에 전원이 수락하지 않으면 매칭이 취소돼요" — 분 단위로만 읽히게 `aria-live` 는 낮은 빈도).
- [ ] 한 화면에 Primary 버튼 하나(상태별로 "매칭 시작" 또는 "수락"). 시트는 닫아도 대기가 유지된다(서버 상태) — 다시 열면 상태 복원.

**ChatRoomPage** (ZIP `ChatRoom` 전부)
- [ ] `<AppHeader title={room.title} backTo="/lounge" />`(이 제목이 h1), 로딩 중에는 뒤로가기만. 방 정보: 장소·시간(`formatMeetAt`), 참여자 칩(아바타·닉네임·단과대). 상단 "⋯"(신고/차단): 참여자 중 대상을 골라 UserSheet 를 연다(`UserSheet` props 계약: `userId`, `context:'chat'`, `refId: roomId`).
- [ ] 입장 불가: `NOT_OPEN`("아직 자리가 다 안 찼어요. 인원이 모이면 방이 열려요")·`FORBIDDEN`("참여자만 들어올 수 있어요")를 `EmptyState` + 라운지로 돌아가기 버튼으로.
- [ ] 메시지: `loungeApi.room(id)` 최초 → 3초마다(`CHAT_POLL_MS`, 탭이 보일 때만) `after=마지막 메시지 at` 으로 새 메시지만 받아 이어 붙임(중복 id 제거), system 메시지는 가운데 칩, 내 말풍선 오른쪽(Primary 5 배경)·남의 말풍선 왼쪽(Gray 5)+닉네임+시각, 차단한 사람 메시지 가림 문구 그대로 표시. 새 메시지가 오면 아래로 스크롤(사용자가 위를 읽는 중이면 "새 메시지 ↓" 버튼으로 알림만).
- [ ] 입력: 하단 고정(키보드가 올라와도 가려지지 않게 `dvh`/safe-area 고려), 최대 `MAX_MESSAGE_LENGTH` 와 글자 수 안내, Enter 전송(한글 조합 중 Enter 오전송 방지: `isComposing` 확인), 전송 중 중복 방지, 실패 시 입력 보존 + 오류. 읽기 전용(`readOnly`)이면 입력을 막고 "끝난 모임이라 읽기만 돼요".
- [ ] 안내문 "연락처·실명은 공개되지 않아요. 불쾌한 일이 있으면 ⋯ 에서 신고할 수 있어요". 탭바는 숨긴다(`useHideTabBar`).
- [ ] 접근성: 메시지 목록 `role="log" aria-live="polite"`, 입력 라벨, 보내기 버튼 `aria-label`.

## 확인 시나리오
① demo1·demo2 가 같은 방에서 3초 안에 서로의 메시지를 받는지, 한글 입력(조합 중 Enter), 긴 메시지·줄바꿈 ② 시드된 "정원이 찬 미팅"의 방 입장, 아직 안 찬 모임의 방은 막힘 ③ 읽기 전용 방 ④ 빠른 매칭: demo1·demo2 가 같은 조건으로 신청 → 후보 방 → 투표·수락 → 확정 → 단톡방(두 컨텍스트 동시) ⑤ 한 명 거절 → 취소 안내·대기 복귀 ⑥ 360/390·글자 150%·선명한 화면, 키보드 Tab, 가로 넘침·콘솔 오류 없음.
