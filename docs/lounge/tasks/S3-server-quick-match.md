# 작업 S3 — 밥약 빠른 매칭 (서버)

먼저 `docs/lounge/tasks/00-server-common.md` → `docs/lounge/00-overview.md` → `docs/lounge/01-contract.md`(§0, §4, §10) 를 읽는다.
원본: ZIP `src/features/mealdate/{quick-match,service,preset}.ts` 와 `quick-match.test.ts`(158줄).

## 담당 파일
```
server/lounge/domain/quickMatch.ts   + quickMatch.test.ts     ZIP quick-match.ts 순수 규칙 이식 (프리셋·상수는 shared/lounge/constants 에서)
server/lounge/repo/quick.ts          대기표·후보 방 저장소(낙관적 잠금·선점 UPDATE)
server/lounge/services/quick.ts      sweep·신청·취소·투표·수락·materialize
server/lounge/routes/quick.ts        GET/POST/PATCH/DELETE /meals/quick   (자리표시 `quickRouter` 를 채운다)
server/lounge/services/quick.test.ts 경쟁 상황 테스트(PGlite 임시 DB)
```

## S1 에 의존하는 것 (시그니처는 S1 지시서에 고정 — 아직 파일이 없어도 그 시그니처로 import 해서 작성하고, 나중에 `tsc` 로 확인)
- `domain/gathering.ts`: `createGathering`, `join`, `isFull`, `memberIds`
- `repo/gatherings.ts`: `insertGathering`
- `services/chat.ts`: `openRoomIfNeeded`
- `services/safety.ts`: `blockChecker`, `hiddenFor`
- `server/lounge/users.ts`(이미 있음): `findUser`, `loadUsers`, `toPublicUser`
S1 이 늦으면 순수 도메인(`quickMatch.ts`)과 테스트부터 끝내고, 서비스는 그 뒤에 이어서 한다. 마지막 `tsc` 가 통과해야 한다.

## 체크리스트
**도메인 이식** (ZIP 코드를 줄 단위로 읽고 동작을 바꾸지 않는다)
- [ ] `intersect`, `isCompatible`(같은 날짜·장소·인원·시간 교집합·`같은 과만`·차단), `findGroup`(오래 기다린 순, 모두와 호환, 공통 시간 있어야), `commonBands`, `createRoom`(TTL = `QUICK_ROOM_TTL_MIN`, 첫 투표 = 대기표 가능 시간), `vote`, `answer`(거절 → 방 취소, 전원 수락 + 결정 가능한 시간대 → confirmed), `decideBand`(표 많은 순, 동점이면 이른 시간), `meetAtOf`(KST → UTC), `isExpired`, `allAccepted`. 테스트 이식 통과.

**서비스** (ZIP `service.ts` 이식 + 아래 보강)
- [ ] `sweep`(만료 방 취소, 깨진 방의 대기표를 waiting 으로 복귀) — 읽을 때마다.
- [ ] `quickState(userId)` → `QuickState`(`members`: PublicUser, `meId`, `waitingCount`, `gatheringId`). 다른 사람의 대기표 내용은 내려보내지 않는다.
- [ ] `requestQuickMatch`: 검증(날짜 형식 `YYYY-MM-DD`, `placeType ∈ PLACE_TYPES`, 인원 2~4, bands ⊂ `BAND_KEYS` 최소 1개, 정지 사용자 `BANNED`, 지난 시간대 제거 후 비면 INVALID, 이미 대기 중이면 `ALREADY_JOINED`), 학과는 화면에 안 보이지만 `같은 과만` 비교를 위해 대기표 태그 `dept:<학과>` 로 넣는다(응답에는 내려보내지 않는다), 그룹을 찾으면 방 생성 — **경쟁 처리**: 대기표 선점은 `UPDATE … SET status='matched', room_id=? WHERE id=? AND status='waiting'` 영향 행 수 확인, 하나라도 실패하면 선점한 것을 되돌리고 방을 만들지 않는다.
- [ ] `cancelQuickMatch`, `voteBands`, `answerRoom`(낙관적 잠금 + 재시도; 확정 시 `materialize`: 진짜 밥약 `Gathering`(kind meal, joinPolicy auto, 자리는 확정 인원, 제목 `${placeType}에서 같이 밥 (빠른 매칭)`, tags ['빠른 매칭'], 신청 마감 = 약속 10분 전 또는 지금+1초 중 늦은 쪽) 생성 → 참여자를 차례로 `join` → `insertGathering` → 방 열기 `openRoomIfNeeded`). **materialize 는 한 방에 한 번만**(재시도·동시 수락에도 모임이 두 개 생기면 안 된다): 방 문서의 `gatheringId` 를 낙관적 잠금으로 먼저 확정한 쪽만 만든다.
- [ ] 거절·취소 시 나머지 참여자를 waiting 으로 되돌리고 거절한 사람의 대기표는 cancelled.
- [ ] 신청 속도 제한(10분당 10). 부수효과는 요청 안에서 await.

**라우트** (계약 §4): `GET /meals/quick`, `POST`(본문 `QuickInput`), `PATCH`(본문 `QuickPatchBody` — `bands` 또는 `answer` 중 하나), `DELETE`. 응답 `{ state }`. 잘못된 본문은 INVALID.

**테스트(새로 쓴다)**
- [ ] 같은 조건 두 명 → 방 생성 / 조건이 다르면 안 맞음 / 차단 관계는 안 맞음 / `같은 과만`.
- [ ] 동시에 신청하는 3명이 인원 2 로 신청 → 방이 정확히 한 개, 한 명은 대기 유지(대기표 중복 선점 없음).
- [ ] 전원 수락 → 밥약 한 개만 생기고 참여자 전원이 앉아 있고 방이 열림. 두 명이 **동시에** 수락해도 밥약이 한 개.
- [ ] 거절 → 방 취소·나머지 대기 복귀. 만료 → 정리. 지난 시간대 거절.

## API 확인
임시 서버(포트 3213): 사용자 2~3명으로 신청 → 후보 방 → 투표 → 수락 → 확정 → `GET /gatherings` 에 밥약이 보이는지(이 라우트는 S1 이 만든다 — 아직 없으면 DB 의 `lounge_gatherings` 를 직접 조회해 확인). 확인한 것과 못 한 것을 구분해 보고한다.
