# 작업 S1 — 라운지 서버 코어: 모임 · 평판 · 단톡방 · 차단/신고 · 관리자

먼저 `docs/lounge/tasks/00-server-common.md` → `docs/lounge/00-overview.md` → `docs/lounge/01-contract.md`(§0, §3, §5, §6, §10) 를 읽는다.

## 담당 파일 (이것만 만들고 고친다)
```
server/lounge/domain/gathering.ts   + gathering.test.ts     ZIP domain/gathering/{gathering,types}.ts + 테스트 이식
server/lounge/domain/reputation.ts  + reputation.test.ts    ZIP domain/reputation (상수는 shared/lounge/constants 를 import)
server/lounge/domain/safety.ts      + safety.test.ts        ZIP domain/safety (REPORT_REASONS 등은 shared)
server/lounge/domain/chat.ts        + chat.test.ts          ZIP domain/chat
server/lounge/repo/gatherings.ts    모임 저장소 + mutateGathering(낙관적 잠금)
server/lounge/repo/messages.ts      단톡방 메시지
server/lounge/repo/safety.ts        차단·신고
server/lounge/services/gathering.ts 모임 서비스 (만들기·참여·승인·평가 + 평판 반영 + 방 열기)
server/lounge/services/chat.ts      방 보기·메시지 보내기·방 열기
server/lounge/services/safety.ts    차단·신고·관리자 처리·hiddenFor
server/lounge/services/present.ts   toView / viewList / 정렬 (DTO 변환)
server/lounge/services/stats.ts     관리자 통계
server/lounge/routes/gatherings.ts  /gatherings … /mine  (+ /gatherings/:id/messages)
server/lounge/routes/safety.ts      /blocks /reports
server/lounge/routes/admin.ts       /admin/reports /admin/stats
server/lounge/services/gathering.test.ts  (동시성·평판 멱등 — PGlite 임시 DB)
```
이미 있는 `server/lounge/routes/*.ts` 자리표시(`gatheringsRouter`, `safetyRouter`, `adminRouter`)를 채운다. 이름·export 를 바꾸지 않는다.

## ⚠ 다른 작업자가 의존한다 — **먼저** 이 export 시그니처로 컴파일되게 만들어라 (구현은 나중에 채워도 됨)
작업 S3(빠른 매칭)와 S2 가 아래를 import 한다. 시그니처를 바꾸지 마라.
```ts
// domain/gathering.ts  — ZIP 과 같은 이름·인자. 추가로:
export function createGathering(input: CreateGatheringInput, now: ISODateTime): Result<Gathering>;
export function join(g: Gathering, user: GatherUser, slotKey: string, now: ISODateTime): Result<Gathering>;
export const isFull: (g: Gathering) => boolean;  export const memberIds: (g: Gathering) => UserId[];
//   GatherUser = { id: string; banned: boolean; warnings: number; /*학과 비교는 서비스가 한다*/ }  ← 도메인이 쓰는 최소 사용자 (ZIP 의 verified 는 없앤다: 우리는 가입 시 이미 메일 인증됨)
//   CreateGatheringInput = shared 의 CreateGatheringBody + { id: string; hostId: string }
// repo/gatherings.ts
export async function insertGathering(g: Gathering): Promise<void>;
export async function findGathering(id: string): Promise<Gathering | undefined>;
export async function mutateGathering(id: string, fn: (g: Gathering) => Result<Gathering>, opts?: { retries?: number }): Promise<Result<Gathering>>;  // §3.1
export async function listGatherings(opts?: { kind?: GatheringKind; since?: ISODateTime; limit?: number }): Promise<Gathering[]>;
// services/chat.ts
export async function openRoomIfNeeded(roomId: string): Promise<void>;   // 메시지가 하나도 없을 때만 system 메시지 한 줄 (멱등)
// services/safety.ts
export async function hiddenFor(userId: string): Promise<Set<string>>;   // 내가 차단했거나 나를 차단한 사람 id
export async function blockChecker(): Promise<(a: string, b: string) => boolean>;
```

## 체크리스트
**도메인 이식** (ZIP 의 같은 파일을 읽고 줄 단위로 옮긴다 — 동작을 바꾸지 않는다. 바꾸는 곳은 아래 "의도한 변경"뿐)
- [ ] gathering: create/join/apply/approve/reject/leave/cancel/submitReview/isNoshowConfirmed/confirmedNoshows/currentStatus/조회 헬퍼 전부. 테스트 `gathering.test.ts`(ZIP 296줄)를 import 경로만 고쳐 통과시킨다.
- [ ] reputation: `applyReview`·`confirmNoshow`·`liftBan`·`joinBlockReason`·`temperatureFace`(상수는 shared 에서). 테스트 이식.
- [ ] safety: `isBlocked`·`hiddenUserIds`·`openReportCount`·`isAutoRestricted`·`alreadyReported`. 테스트 이식.
- [ ] chat: `canRead`·`checkSend`·`sortMessages`·`messagesAfter`·`hideBlocked`. 테스트 이식.
- 의도한 변경: ① `User.verified` 개념 제거(우리는 가입 때 메일 인증 완료) — 해당 검사·테스트 입력에서 뺀다. ② id 타입은 plain string. ③ 에러·문구는 `shared/lounge/types` 의 것.

**저장소**
- [ ] `mutateGathering` 낙관적 잠금(§3.1): 읽기 → fn → `UPDATE … WHERE id=? AND version=?` → 0행이면 재시도(최대 6회, 지연 10~40ms 무작위), 실패 시 `CONFLICT`. `status/meet_at` 사본 갱신.
- [ ] `insertGathering`, `findGathering`, `listGatherings`, 내 모임 조회(`/mine`)용 쿼리(주최·참여·신청 — JSONB 안의 참여자 id 검색은 `data::text LIKE`/`jsonb_path_exists` 등 안전한 파라미터 방식으로; 사용자 수가 적어도 정확해야 하며 SQL 주입 불가).
- [ ] messages: 저장, `room_id` 별 조회(`after`, 최근 200개), 메시지 존재 확인. safety: 차단 저장/삭제/조회, 신고 저장/조회.

**서비스·라우트** (계약 §3.3~§3.5, §5, §6 의 모든 규칙)
- [ ] 만들기·참여·신청·승인·거절·취소·평가·참여취소 + 차단 검사 + 같은 과 제외 + 정원 차면 방 열기 + 평판 **멱등** 반영(§3.3).
- [ ] `toView`(ZIP `shared/view.ts` 이식, `ViewerState.timetableConflict`/`roomOpen` 포함), `viewList`(차단 제외, 밥약 정렬), 탈퇴 사용자 처리, `/mine`.
- [ ] 단톡방 읽기·쓰기(차단 말풍선 가림, 읽기 전용, 정지 사용자).
- [ ] 차단·차단 해제·차단 목록·신고(중복 방지, 자동 제한).
- [ ] 관리자 신고 목록·처리(resolve/dismiss/ban/unban 의미 정확히)·통계.
- [ ] 입력 검증 전부(§3.3 길이·집합·시간 관계). 속도 제한(§0 표).
- [ ] 모든 부수효과를 요청 안에서 await (fire-and-forget 금지).

**테스트(새로 쓴다)**
- [ ] **동시성**: 같은 미팅의 한 자리에 N명(≥10)이 동시에 `join` → 정확히 용량만큼만 성공, 나머지는 `SLOT_FULL`, 문서가 일관됨(PGlite 임시 DB, `Promise.all`).
- [ ] 평판 멱등: 좋았어요 연타 → 온도 +0.4 한 번, 평가 바꾸기(good→soso) → −0.4, 노쇼 확정은 경고 +1 이 한 번만, 경고 2회에서 정지.
- [ ] 정원이 차면 단톡방 system 메시지가 **한 줄만**(멱등).
- [ ] 차단 양방향 필터, 신고 3명 → 자동 정지, unban 시 열린 신고 정리.

## API 확인
임시 서버(포트 3211)를 띄워 실제 HTTP 로 확인: 사용자 4명 이상 준비 → 미팅 만들기 → 3명이 앉기(마지막 자리 경쟁) → 방 열림 → 메시지 → 모임 시각 이후 평가(시각을 과거로 만든 모임을 DB 에 직접 심어서) → 온도 변화 → 차단·신고·관리자 처리. 확인한 것과 못 한 것을 보고서에 구분한다.
