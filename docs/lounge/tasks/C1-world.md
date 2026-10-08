> **셔틀버스 기능은 삭제됨** — 지도에 정류장·셔틀 시트·`bus` 구역은 없다. 구역은 광장·미팅 라운지·밥약 식당 셋.

# 작업 C1 — 라운지 월드: 지도 · 아바타 · 테이블 · 접속자 · 목록 모드

`docs/lounge/tasks/00-client-common.md` 와 **`docs/lounge/00-overview.md` §3~§5(월드 설계 전부)** 를 정독한 뒤 시작한다. 이 작업이 "메타버스 느낌"을 만든다. 하지만 사이트 분위기(KRDS: 평면 도형, 보더, 토큰 색, 그림자 없음)를 지켜야 한다.

## 담당 파일
```
client/src/lounge/LoungePage.tsx        (자리표시를 채운다) 헤더·전환·데이터 폴링·시트 조정
client/src/lounge/world/World.tsx       지도 컨테이너·구역·상호작용
client/src/lounge/world/layout.ts       좌표계, 구역·테이블 슬롯·키오스크 위치 (0~1 정규화) + 좌표→구역 판정
client/src/lounge/world/Floor.tsx       SVG 바닥·장식(분수·나무·벤치·카펫·도로)
client/src/lounge/world/TableView.tsx   미팅(직사각)·밥약(원형) 테이블과 의자·앉은 아바타
client/src/lounge/world/Walker.tsx      내 아바타 이동(걷기 transition)·타인 아바타 렌더·이모트 말풍선
client/src/lounge/world/EmoteBar.tsx    이모트 바
client/src/lounge/world/usePresence.ts  3초 폴링(탭이 보일 때만)·20초 하트비트·내 위치 전송
client/src/lounge/world/useGatherings.ts 모임 목록 폴링(5초, 탭이 보일 때만)·갱신 함수
client/src/lounge/world/ZoneBoardSheet.tsx 구역 게시판(해당 종류 전체 모집글 + "자리 만들기")
client/src/lounge/world/ListMode.tsx    목록 모드(접근성 대안)
client/src/lounge/world/world.css       (접두사 lounge-world-)
```
다른 작업자의 시트는 props 계약대로 import 해서 연다: `sheets/TableSheet`, `sheets/CreateGatheringSheet`, `sheets/UserSheet`(C2), `sheets/QuickMatchSheet`(C3), `parts/GatheringListItem`(C2), `parts/Avatar`(이미 있음).

## 체크리스트
**화면 뼈대 (LoungePage)**
- [ ] 루트 탭 화면: `<AppHeader />` + `h1.page-title` "라운지"(한 줄 안내 포함), **지도 | 목록** 전환(`Segmented` 또는 탭 — 선택은 localStorage 에 기억, 실패해도 동작), "지금 N명 접속 중" 칩(`aria-live="polite"`).
- [ ] 프로필 게이트: `useLounge().needsProfile` 이면 진입 시 프로필 시트를 자동으로 연다(닫으면 화면 위에 "프로필을 만들면 라운지에 들어올 수 있어요" 안내 `Alert` + 버튼). 프로필 없이는 지도·presence 호출을 하지 않는다. 로딩 중/오류(`useLounge().error`) 상태 처리.
- [ ] 시트 조정 상태(열린 시트 하나씩): table(id) · create(kind) · user(id) · quick · zoneBoard(zone). 시트에서 모임이 바뀌면(`onChanged`/`onCreated`/`onConfirmed`) 목록을 즉시 갱신한다.

**지도 (World)**
- [ ] `docs/lounge/00-overview.md` §3 대로: `aspect-ratio 360/760`, 0~1 정규화 좌표, 모든 요소 `%` 배치 실제 `<button>`, 컨테이너 쿼리 단위(`container-type: inline-size`, `cqw`)로 크기 → **글자 150%에서도 지도 비율 유지**, 지도 `role="group" aria-label="라운지 지도"`, 페이지 세로 스크롤 방해 금지.
- [ ] 바닥: 광장(`--gray-5`)·미팅 라운지(`--primary-5`)·밥약 식당(`--success-5`), 1px 보더·4px 라운드, 장식은 보더만 있는 단순 도형(분수·나무·벤치·도로). **그림자·그라데이션 금지.** 구역 라벨/간판은 버튼(게시판 시트 열기).
- [ ] 테이블: 슬롯 고정(미팅 6·밥약 4), 표시할 모임은 **내 모임 → 약속이 가까운 순**으로 슬롯에 배정, 남는 건 게시판에서. 미팅 = 직사각(윗줄 우리 쪽·아랫줄 상대 쪽 의자, 줄당 1~4개), 밥약 = 원형(둘레 의자 2~4). 앉은 자리는 아바타(`parts/Avatar`), 빈 의자는 점선. 테이블 아래 제목(말줄임 1줄)·시간. 정원이 차면 말풍선 아이콘. 종료·취소 모임은 지도에 안 그림. 빈 슬롯은 "빈 테이블 — 자리 만들기"(눌러서 만들기 시트).
- [ ] 테이블 누르면 TableSheet. **빈 의자를 누르면 같은 시트(해당 자리 선택 상태로)** — 가능하면 `TableSheet` 에 optional prop `focusSlotKey` 를 추가해 넘긴다(C2 가 받는다. 계약에 optional 추가는 허용: 이 지시서가 그 prop 이름을 정한다).
- [ ] 한 사람은 한 번만 그려진다: 보이는 테이블의 멤버이면 의자에, 아니면 걷는 아바타로. 내 의자에는 "나" 표시.
- [ ] 키오스크(밥약 식당): 누르면 QuickMatchSheet.

**아바타·이동·접속자**
- [ ] 내 아바타: 지도 빈 바닥을 누르면 그 위치로 걷는다(`left/top` transition **0.9s linear**; `prefers-reduced-motion` 이면 즉시). 탭 위치가 다른 요소(테이블·간판) 위면 이동하지 않는다. 걷기가 끝나면 `sendPresence({x,y,zone})`, 이후 20초마다 하트비트. 지도 밖으로 나가지 않게 clamp, 걷는 도중 새 목적지를 누르면 부드럽게 갱신.
- [ ] 타인: `usePresence` 3초 폴링(문서가 숨겨지면 중단, 다시 보이면 즉시 갱신), 같은 transition 으로 이동, 사라지면 제거, 위치 갱신이 실패해도 마지막 값을 유지하고 오류를 조용히 표시. 닉네임 라벨(흰 바탕 칩+1px 보더, 1.3rem), 아바타를 누르면 `UserSheet`. 접속자 수 200명 가정 시 성능(리렌더 최소화·`memo`).
- [ ] 이모트: 하단 고정 바 `👋 😄 🙏 ❤️`(각 44px 이상 버튼, `aria-label`), 누르면 내 머리 위 말풍선 5초(`EMOTE_TTL_MS`) + `sendPresence({..., emote})`. 타인의 이모트도 `PresenceUser.emote` 로 표시. 이모트 바는 탭바 위에 붙는다(`--bottom-offset` 사용).
- [ ] PROFILE_REQUIRED/BANNED 오류 처리(BANNED 면 "이용이 정지된 계정이에요" 안내와 지도 조작 비활성).

**목록 모드 (필수 — 지도와 기능 동등)**
- [ ] 접속자 수, **내 약속**(`loungeApi.mine()`), 미팅 글·밥약 글(`GatheringListItem`, 눌러서 TableSheet), "미팅 자리 만들기"/"밥약 자리 만들기"(CreateGatheringSheet), "빠른 매칭"(QuickMatchSheet). 로딩·빈 상태(다음 행동 안내)·오류 + 다시 시도.
- [ ] 키보드만으로 지도 모드의 모든 동작을 목록 모드에서 할 수 있어야 한다. 지도 모드에서도 테이블·의자·간판·키오스크·이모트는 Tab 으로 닿고 Enter 로 열린다(아바타 이동만 포인터 전용).

**접근성·견고성**
- [ ] 의미 있는 모든 요소에 `aria-label`(예: "미팅 테이블: 금요일 저녁 2:2, 4자리 중 3자리 앉음, 자리 있음"), 포커스 링 보임, 색만으로 상태를 전달하지 않음(글자·아이콘 병행).
- [ ] 360px 폭에서 가로 넘침 없음, 글자 150%·선명한 화면에서 겹치지 않음, 지도 위 글자 최소 1.3rem.
- [ ] 폴링 정리(언마운트·탭 이동 시 타이머/이벤트 해제), 네트워크 실패 시 앱이 무너지지 않음.

## 확인 시나리오 (직접 돌려서)
데모 사용자 2~3명으로 컨텍스트를 여러 개 열어: ① demo1 이 지도에서 걸어 다니면 demo2 화면에서 아바타가 미끄러지듯 움직이는지 ② 이모트가 서로 보이는지 ③ 시드된 테이블이 슬롯에 보이고 의자 탭 → 시트 ④ 자리 만들기 → 테이블이 지도에 생기는지 ⑤ 목록 모드로 같은 일을 키보드로 ⑥ 프로필 없는 admin1 로 들어가 게이트 ⑦ 글자 150%·360px·선명한 화면 캡처 ⑧ 가로 넘침·콘솔 오류 없음. 터치 에뮬레이션(탭)과 마우스 모두.
