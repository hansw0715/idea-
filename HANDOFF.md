# 상상BOOK-e — 팀 작업 규칙 (머지용)

한성대 상상BOOK-e 아이디어 공모전 출품작. 기능 4개를 한 앱에 담는다.

| 기능 | 담당 | 상태 |
|---|---|---|
| 미팅 (선착순 착석) | 한승원 | ✅ 완료 |
| 밥약 (모집글 + 빠른 매칭) | 한승원 | ✅ 완료 |
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

## 3. 매너온도 · 노쇼 경고 (`src/domain/reputation/`)

당근마켓 매너온도 방식이다. **36.5도**에서 시작하고, 모임이 끝나면 같이 간 사람끼리 서로 평가한다
(`좋았어요 / 보통이에요 / 안 왔어요`). 주최자 혼자 노쇼를 찍지 않는다 — 사이가 틀어졌다고 찍히면 안 되니까.

| 규칙 | 값 |
|---|---|
| 좋았어요 | +0.4도 |
| 노쇼 확정 | -5도, 경고 +1 |
| 노쇼 확정 조건 | 그 사람을 뺀 **나머지 참여자 전원**이 '안 왔어요' |
| 경고 2회 | 미팅·밥약 이용 정지 (관리자만 해제, 해제 시 경고 초기화) |

흐름: `submitReview()` → 전원 일치 시 `participant.noshow` 이벤트 → `src/server/reputation.ts`가 온도·경고 갱신.
도메인은 온도 계산을 모르고, 온도 모듈은 모임을 모른다.

## 3-1. 차단 · 신고 (`src/domain/safety/`)

- 차단: 한쪽만 걸어도 **양쪽** 목록·매칭에서 사라진다. 상대에게 알리지 않는다.
- 신고: 서로 다른 3명이 신고하면 관리자가 볼 때까지 자동으로 이용 정지 (`AUTO_RESTRICT_REPORTS`).
- 관리자 처리: `/admin` → 신고 탭 (정지 / 조치 완료 / 반려 / 정지 해제)

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
| POST | `/api/gatherings/:id/review` | `{ userId, mark }` 상호 평가 (good/soso/noshow) |
| GET/POST/PATCH/DELETE | `/api/meals/quick` | 밥약 빠른 매칭 (대기 / 신청 / 투표·수락 / 취소) |
| GET/POST/DELETE | `/api/blocks` | 차단 |
| POST | `/api/reports` | 신고 |
| GET/POST | `/api/admin/reports` | 신고 처리 (관리자) |
| GET | `/api/admin/stats` | 이용 통계 (관리자) |
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
주최자 ↔ 참여자를 혼자 시연할 수 있다. `노쇼왕` 계정은 경고 2회라 참여가 막히는 걸 보여준다. `승원` 계정이 관리자다.

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

## 11. 밥약 빠른 매칭 (`src/features/mealdate/`)

조건(날짜·장소·인원·가능 시간·태그)만 걸어두면 맞는 사람을 찾아 **후보 방**을 만든다.
각자 가능한 시간을 체크하고 **전원이 수락**해야 확정되며, 확정되면 보통 밥약(Gathering)으로 바뀌어
참여·취소·평가·노쇼 로직을 그대로 탄다. 한 명이라도 거절하거나 30분이 지나면 방이 깨지고 나머지는 대기열로 돌아간다.

- 순수 규칙: `quick-match.ts` (테스트 있음) / 저장·시간: `service.ts`
- '같은 과만' 태그는 `dept:학과` 태그로 좁혀서 맞춘다 (학과는 화면에 노출하지 않는다)
- 목록은 "곧 먹을 약속"이 위로 (`server/present.ts`의 `sortMealFeed`), 지난 약속은 자동으로 종료 처리된다

## 12. 저장소 현황

버스만 Supabase 어댑터가 있고 (`env` 있으면 Supabase, 없으면 seed.json),
모임·평판·차단·신고·빠른 매칭은 아직 **인메모리**다. 미팅까지 끝낸 뒤 Supabase 스키마와 어댑터를 한 번에 붙인다.
그래야 테이블을 두 번 설계하지 않는다.
