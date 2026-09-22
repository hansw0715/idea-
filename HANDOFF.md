# 상상BOOK-e — 팀 작업 규칙 (머지용)

한성대 상상BOOK-e 아이디어 공모전 출품작. 기능 4개를 한 앱에 담는다.

| 기능 | 담당 | 상태 |
|---|---|---|
| 미팅 (선착순 착석) | 한승원 | ✅ 완료 |
| 밥약 (주최자 승인) | 한승원 | ✅ 완료 |
| 팀빌딩 (노쇼 관리 · 관리자 대시보드) | — | ⬜ |
| 시설 예약 (공강 시간표 자동 계산) | — | ⬜ |
| 셔틀버스 노선도 (시간표 + 실시간 위치) | 한승원 | ✅ 1차 |

---

## 1. 제일 중요한 것: 미팅·밥약·팀빌딩은 같은 엔티티다

셋 다 "글을 올리고 → 정원이 있고 → 사람이 들어온다"로 구조가 같다.
그래서 `Gathering` 하나로 만들었고, 다른 건 **두 개뿐**이다.

| | 미팅 | 밥약 | 팀빌딩 |
|---|---|---|---|
| `joinPolicy` | `auto` (선착순) | `approval` (승인) | `approval` |
| `slots` | 우리 쪽 N / 상대 쪽 N | 같이 먹을 사람 N | 역할별 자리 (기획 1, 개발 2 …) |

**팀빌딩을 처음부터 새로 만들 필요가 없다.** 프리셋만 만들면 참여/승인/취소/노쇼 로직이 전부 딸려온다.

```ts
// src/features/team-building/preset.ts — 이거 하나만 새로 만들면 됨
import type { SlotSpec } from '@/domain/gathering';

export const TEAM_PRESET = (roles: { name: string; count: number }[]): { slots: SlotSpec[] } => ({
  slots: roles.map((r) => ({ key: r.name, label: r.name, capacity: r.count })),
});
export const TEAM_JOIN_POLICY = 'approval' as const;
```

화면도 `<GatheringFeed kind="team" .../>` 와 `<GatheringCard/>` 를 그대로 쓰면 된다.

---

## 2. 폴더 = 담당 구분 (여기만 지키면 충돌 안 남)

```
src/
  shared/          ⚠️ 공용 계약. 고치기 전에 반드시 말하기
    types.ts         Result, 에러 코드
    user.ts          User, 단과대, 신뢰도 기준값
    events.ts        도메인 이벤트 + 구독
    view.ts          화면에 내려보내는 DTO
  domain/gathering/  Gathering 규칙 (순수 함수, DB 없음)   — 한승원
  features/
    meetup/          미팅 프리셋                            — 한승원
    mealdate/        밥약 프리셋                            — 한승원
    team-building/   ⬅ 여기에 만드세요
    facility/        ⬅ 여기에 만드세요
  server/
    repo/            저장소 (지금은 인메모리)
    service.ts       도메인 + 저장소 + 이벤트 연결
  components/        공용 UI (GatheringCard, GatheringFeed, GatheringForm)
  app/
    api/gatherings/  모임 API                               — 한승원
    api/facilities/  ⬅ 시설 예약 API
    api/admin/       ⬅ 관리자 대시보드 API
    meetups/ meals/  화면                                   — 한승원
    teams/ facilities/ ⬅ 화면
```

**규칙 3개**
1. 남의 폴더 파일은 안 고친다. 필요하면 이슈로 남기거나 말한다.
2. `src/shared/` 는 둘 다 쓰는 곳이다. 여기를 고칠 땐 먼저 얘기한다.
3. 브랜치는 기능별로. `feat/meetup`, `feat/team-building` 식으로.

---

## 3. 노쇼 관리 연동 — 서로 코드를 안 건드리는 방법

미팅/밥약은 신뢰도 계산을 **전혀 모른다.** 무슨 일이 있었는지만 이벤트로 뿌린다.

```ts
// src/features/team-building/trust.ts (담당자가 만들 파일)
import { on } from '@/shared/events';

on('participant.noshow', (e) => {
  // e.userId, e.gatheringId, e.at
  // 신뢰도를 얼마나 깎을지, 언제 회복시킬지는 전부 여기 정책
});
on('participant.attended', (e) => { /* ... */ });
```

발행되는 이벤트 (`src/shared/events.ts`):

| 이벤트 | 언제 |
|---|---|
| `gathering.created` | 모임이 만들어짐 |
| `gathering.joined` | 선착순 착석 또는 승인 완료 |
| `gathering.left` | 참여 취소 |
| `gathering.filled` | 정원이 참 |
| `gathering.cancelled` | 주최자가 모임을 접음 |
| `participant.attended` | 주최자가 참석으로 체크 |
| `participant.noshow` | 주최자가 노쇼로 체크 |

지금은 `src/server/bootstrap.ts` 에 **임시 구현**(노쇼 -25, 참석 +5)이 들어 있다.
담당자가 `trust.ts` 를 만들면 그 파일을 지우고 구독만 옮기면 된다.

신뢰도가 `MIN_TRUST_TO_JOIN`(40, `src/shared/user.ts`) 밑이면 참여가 자동으로 막힌다 —
이 검사는 이미 도메인에 들어 있으니 따로 만들 필요 없다.

---

## 4. 관리자 대시보드에서 쓸 것

```ts
import { listGatherings, listUsers } from '@/server/service';

const all = await listGatherings();          // 전체 모임 (kind 필터 가능)
const users = await listUsers();             // 신뢰도 포함
```

노쇼율은 각 모임의 `attendance` 를 세면 나온다.

---

## 5. 시설 예약 담당자에게 — 붙이면 좋은 지점

밥약에 **"내 공강에 맞는 밥약만 보기"** 필터를 넣으면 기능 4개가 하나의 서비스로 보인다.
공강 계산이 이런 함수로 나오면 밥약 목록에 바로 끼울 수 있다:

```ts
// src/features/facility/free-time.ts
export type FreeSlot = { start: string; end: string }; // ISO
export function freeSlotsOf(userId: string, date: string): Promise<FreeSlot[]>;
```

이게 있으면 `meetAt` 이 `FreeSlot` 안에 들어가는 밥약만 필터링해서 보여주면 끝이다.
보고서에도 이 연결을 쓰는 게 좋다 (기능이 따로 노는 앱 vs 하나로 이어진 서비스).

---

## 6. 저장소 교체 (지금은 인메모리 — 서버 끄면 초기화됨)

`src/server/repo/gathering-repo.ts` 의 인터페이스만 만족하면 된다.

```ts
// src/server/repo/supabase-repo.ts 를 만들고
export const gatheringRepo: GatheringRepo = { list, find, save, listByUser };
// service.ts 의 import 한 줄만 바꾸면 domain/ 과 API는 손 안 대도 된다.
```

> ⚠️ DB로 옮길 때 선착순 동시성 주의:
> 지금은 JS가 단일 스레드라 안전하지만, DB에선 검사와 저장 사이에 다른 요청이 낄 수 있다.
> 트랜잭션 안에서 처리하거나 `(gathering_id, slot_key, seat_no)` 유니크 제약을 걸어야 한다.
> (`src/domain/gathering/gathering.ts` 의 `join()` 주석에도 적어둠)

---

## 7. API 계약

| 메서드 | 경로 | 설명 |
|---|---|---|
| GET | `/api/gatherings?kind=meetup\|meal\|team` | 목록 |
| POST | `/api/gatherings` | 모임 만들기 |
| GET | `/api/gatherings/:id` | 상세 |
| POST | `/api/gatherings/:id/join` | `{ slotKey }` 선착순 착석 |
| POST | `/api/gatherings/:id/apply` | `{ slotKey, message }` 신청 |
| POST | `/api/gatherings/:id/approve` | `{ userId }` 승인 |
| POST | `/api/gatherings/:id/reject` | `{ userId }` 거절 |
| POST | `/api/gatherings/:id/leave` | 참여/신청 취소 |
| POST | `/api/gatherings/:id/cancel` | 모임 취소 |
| POST | `/api/gatherings/:id/attendance` | `{ userId, mark }` 출결 |
| GET/POST | `/api/me` | 현재 계정 / 계정 전환(시연용) |

에러는 전부 `{ "error": { "code": "SLOT_FULL", "message": "..." } }` 모양이다.
코드 목록은 `src/shared/types.ts` 의 `ERROR_MESSAGES`.

---

## 8. 실행

```bash
npm install
npm run dev        # http://localhost:3000
npm test           # 도메인 규칙 테스트 20개
npm run typecheck
```

로그인은 아직 없다. 화면 오른쪽 위에서 계정을 바꿔 가며
주최자 ↔ 참여자를 혼자 시연할 수 있다. `노쇼왕` 계정은 신뢰도가 25라 참여가 막히는 걸 보여준다.

**시연 순서 추천**
1. 미팅 탭 → `지민` 계정으로 상대 쪽 자리 앉기 (선착순)
2. 다시 눌러 보기 → "이미 참여 중"
3. `노쇼왕` 으로 전환 → "노쇼 기록으로 참여 제한"
4. 밥약 탭 → `현우` 로 신청 → `태현`(주최자) 으로 전환해 수락
5. 주최자 메뉴에서 노쇼 체크 → 그 사람 신뢰도가 깎이는 것 확인

---

## 9. 셔틀버스 (`src/features/bus/`)

- 화면: `/bus`(로그인 없이 열람) · `/bus/driver`(기사 폰에서 GPS 송신) · `/admin` 버스 탭(노선·정류장·시간표·방학 편집)
- 시간표 = 출발지 출발 시각 목록 + 정류장별 소요 분. 계산은 `schedule.ts` 순수 함수(KST 기준, 테스트 있음)
- 저장소: env에 Supabase가 있으면 `supabase-bus-repo`, 없으면 `seed.json` 인메모리 (`repo/index.ts`)
- 실시간 위치: `POST /api/bus/positions` (`Authorization: Bearer BUS_DEVICE_TOKEN`). GPS 트래커를 사도 이 형식만 맞추면 된다.
  AirTag는 위치를 꺼낼 공개 API가 없어서 못 쓴다.
- ⚠️ `seed.json`의 노선·좌표·시간표는 **가짜**(`_todo`) — 실제 데이터로 교체 필요

```bash
cp .env.example .env.local          # Supabase 쓸 때만
# Supabase SQL Editor에서 supabase/migrations/0001_bus.sql 실행 후
npm run bus:seed                    # seed.json → Supabase
npm run bus:simulate                # 가짜 버스를 노선 위로 달리게 (시연용)
```

## 10. 공용 UI (`src/components/ui/`)

색·radius·간격 토큰은 `globals.css` 한 곳에만 있다. 페이지는 `Button / Card / Field·Input / Badge / Tabs / Modal / EmptyState`를 조립해서 만든다.
디자인 교체 시 토큰 → `components/ui` 순서로만 고치면 된다.
