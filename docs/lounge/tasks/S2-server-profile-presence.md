# 작업 S2 — 프로필 · 접속자 · 시간표 연결 · 개발용 시드

> **⚠ 셔틀버스 기능은 사용자 지시로 범위에서 완전히 삭제되었다.** 이 문서나 다른 지시서에 셔틀·정류장·`/api/bus`·`BusSheet`·`bus` 구역이 남아 있어도 **무시한다**(만들지도, 없다고 지적하지도 않는다). 지도 구역은 광장·미팅 라운지·밥약 식당 셋이다.

먼저 `docs/lounge/tasks/00-server-common.md` → `docs/lounge/00-overview.md` → `docs/lounge/01-contract.md`(§0, §1, §2, §7, §8, §9) 를 읽는다.

## 담당 파일
```
server/lounge/routes/me.ts            GET/PUT /me, GET /users/:id           (자리표시 `meRouter` 를 채운다)
server/lounge/routes/presence.ts      GET/POST /presence                    (`presenceRouter`)
server/lounge/routes/dev.ts           /dev/seed (개발 전용)                  (`devRouter`)
server/lounge/services/profile.ts     프로필 검증·저장
server/lounge/services/presence.ts    위치 upsert·조회·정리
server/lounge/repo/presence.ts
server/lounge/timetableConflict.ts    (자리표시를 실제 구현으로 교체. 시그니처 유지)
server/lounge/**/*.test.ts            자기 파일의 테스트 (도메인 성격은 순수 함수로 분리해 테스트)
```
`server/lounge/routes/{me,presence,dev}.ts` 는 이미 자리표시가 있다. export 이름을 바꾸지 않는다.

## 체크리스트
**프로필·사용자 (계약 §1)**
- [ ] `GET /me`(프로필 없어도 동작, `profile` null/`needsProfile`), `PUT /me`(§1 의 모든 검증과 문장, `profile_done=TRUE`, 평판 컬럼 불변), `GET /users/:id`(없음·미완성·차단 관계 → 404).
- [ ] 닉네임 길이는 **코드포인트** 기준(이모지·한글 정확히), 연속 공백·`@`·제어문자 금지. 올해(KST) 계산 정확히. 입력은 신뢰하지 않는다(문자열이 아니면 INVALID).
- [ ] 프로필 수정 시 `warnings/temperature/banned` 가 바뀌지 않는다는 테스트.

**접속자 (계약 §2)**
- [ ] `POST /presence`(검증, 정지 사용자 403 BANNED, upsert, emote), `GET /presence`(TTL, 나 제외, 차단 양방향 제외, 프로필 있는 사람만, 200명 제한, emote TTL, `count`, 오래된 행 정리).
- [ ] 쿼리 수 최소화(조회 한 번에 2개 이내), `seen_at` 인덱스 활용. 속도 제한 분당 90.
- [ ] `hiddenFor(userId)` 는 S1 의 `services/safety.ts` 가 제공한다 — import 해서 쓴다(시그니처는 S1 지시서에 고정됨).

**시간표 연결 (계약 §8)**
- [ ] `timetableConflicts(userId, items)` 구현: 사용자 일정 한 번 조회 + KST 요일/날짜/분 계산, weekly·once 모두, 주말 처리, 경계(끝과 시작이 맞닿으면 겹침 아님), 여러 모임 한 번에. 순수 계산부는 함수로 분리해 테스트.

**개발용 시드 (계약 §9)**
- [ ] `POST /api/lounge/dev/seed`: 데모 사용자 8명 + 프로필 + 샘플 모임들(미팅 2:2 열림 2개[하나는 한 자리 남음], 밥약 모집 2개, 정원이 찬 미팅 1개 + system 메시지). 멱등. 비밀번호는 응답의 `password` 로(코드에 `Demo1234!` 같은 상수는 OK 지만 **운영 경로에서는 절대 열리지 않아야** 한다). 모임 생성은 S1 의 `domain/gathering.ts` `createGathering/join` 과 `repo/gatherings.ts` `insertGathering` 을 import 해 쓴다(S1 이 먼저 시그니처를 컴파일되게 만든다 — 아직 없으면 기다리지 말고 SQL 로 직접 `lounge_gatherings` 에 같은 형태의 문서를 넣는 임시 코드를 쓰고 보고서에 적는다).
- [ ] 마운트 조건 확인: `LOUNGE_DEV_SEED` 가 없거나 `NODE_ENV=production` 이면 `/api/lounge/dev/seed` 가 404 (이미 index.ts 에 조건이 있다 — 실제로 404 가 나는지 확인).

## API 확인
임시 서버(포트 3212, `LOUNGE_DEV_SEED=1`)로: seed → demo 계정 로그인 → `/me`·`PUT /me` → presence 쓰기/읽기(두 계정이 서로 보이는지, 차단 관계는 안 보이는지 — 차단 API 는 S1 이 만든다. 아직 없으면 `lounge_blocks` 에 직접 INSERT 로 확인) 확인한 것과 못 한 것을 구분해서 보고한다.
