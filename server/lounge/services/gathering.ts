/**
 * 모임 서비스. 순수 도메인 함수(domain/gathering)와 바깥 세계(저장소 · 평판 · 단톡방)를 이어 붙이는 곳.
 *
 * 모든 변경은 "읽기 → 도메인 함수 → 조건부 저장(mutateGathering)" 한 흐름이고, 부수효과(평판 · 방 열기)는
 * 저장이 성공한 뒤 **같은 요청 안에서 await** 한다 — 서버리스는 응답을 보내면 남은 작업이 멈출 수 있어서
 * fire-and-forget 은 쓰지 않는다. 라우트는 판단하지 않고 이 파일을 부르기만 한다.
 */
import { randomUUID } from 'node:crypto';
import { fail, ok } from '../../../shared/lounge/types.js';
import type { ISODateTime, Result } from '../../../shared/lounge/types.js';
import type {
  CreateGatheringBody,
  Gathering,
  GatheringKind,
  GatheringMeta,
  JoinPolicy,
  ReviewMark,
  SlotSpec,
} from '../../../shared/lounge/gathering.js';
import {
  GOOD_DELTA,
  MEAL_CAPACITY_OPTIONS,
  MEAL_JOIN_POLICY,
  MEAL_PRESET,
  MENU_CATEGORIES,
  MEETUP_JOIN_POLICY,
  MEETUP_PRESETS,
  MEETUP_SIZES,
  NOSHOW_DELTA,
  PLACE_TYPES,
} from '../../../shared/lounge/constants.js';
import type { GatheringView } from '../../../shared/lounge/view.js';
import { findUser, loadUsers } from '../users.js';
import type { LoungeUser } from '../users.js';
import { timetableConflicts } from '../timetableConflict.js';
import type { ConflictQuery } from '../timetableConflict.js';
import * as G from '../domain/gathering.js';
import { hasUnsafeChars } from '../domain/chat.js';
import { joinBlockReason } from '../domain/reputation.js';
import {
  findGathering,
  insertGathering,
  listGatherings,
  listMine,
  mutateGathering,
  mutateGatheringWithReputation,
} from '../repo/gatherings.js';
import { openRoomIfNeeded } from './chat.js';
import { blockRelations, hiddenFor } from './safety.js';
import type { BlockRelations } from './safety.js';
import { toView, userIdsOf, viewList } from './present.js';

const nowISO = (): ISODateTime => new Date().toISOString();
const HOUR_MS = 3600_000;
const DAY_MS = 24 * HOUR_MS;

// ───────────── 입력 규칙 (계약 §3.3) ─────────────

export const TITLE_MAX = 60;
export const BODY_MAX = 300;
export const PLACE_MAX = 40;
export const TAGS_MAX = 6;
export const TAG_MAX = 20;
export const APPLY_MESSAGE_MAX = 200;
/** 이보다 먼 미래의 약속은 만들 수 없다 (잘못 입력한 해를 걸러내고, 목록에 영영 남는 글을 막는다) */
export const MAX_HORIZON_DAYS = 365;

/** 코드포인트 기준 길이 (이모지 하나가 2로 세어지지 않게) */
const lengthOf = (s: string) => [...s].length;

/** 정규화된 ISO 형식(`toISOString()` 결과)인가. 도메인이 날짜를 문자열로 비교하므로 형식이 어긋나면 안 된다. */
const isCanonicalISO = (s: string) => {
  const t = Date.parse(s);
  return Number.isFinite(t) && new Date(t).toISOString() === s;
};

/** 한 줄 글 검사 → 다듬은 값. 틀리면 어느 항목이 왜 틀렸는지 문장으로. */
function checkLine(label: string, value: string, min: number, max: number): Result<string> {
  const v = value.trim();
  if (lengthOf(v) < min) return fail('INVALID', `${label}을(를) 입력해 주세요.`);
  if (lengthOf(v) > max) return fail('INVALID', `${label}은(는) ${max}자까지 쓸 수 있어요.`);
  if (hasUnsafeChars(v, false)) return fail('INVALID', `${label}에 쓸 수 없는 글자가 들어 있어요.`);
  return ok(v);
}

function normalizeMeta(kind: GatheringKind, meta: GatheringMeta | undefined): Result<GatheringMeta> {
  const out: GatheringMeta = {};
  if (!meta) return ok(out);

  if (meta.placeType !== undefined) {
    if (!(PLACE_TYPES as readonly string[]).includes(meta.placeType)) {
      return fail('INVALID', '장소 종류가 올바르지 않습니다.');
    }
    out.placeType = meta.placeType;
  }
  if (meta.menu !== undefined) {
    if (!(MENU_CATEGORIES as readonly string[]).includes(meta.menu)) {
      return fail('INVALID', '메뉴 종류가 올바르지 않습니다.');
    }
    out.menu = meta.menu;
  }
  if (meta.tags !== undefined) {
    const tags: string[] = [];
    for (const raw of meta.tags) {
      const tag = checkLine('태그', raw, 1, TAG_MAX);
      if (!tag.ok) return tag;
      if (!tags.includes(tag.value)) tags.push(tag.value);
    }
    if (tags.length > TAGS_MAX) return fail('INVALID', `태그는 ${TAGS_MAX}개까지 달 수 있어요.`);
    out.tags = tags;
  }
  if (meta.excludeSameDept) {
    // 아는 사람을 만나지 않게 하는 안전장치는 미팅 전용이다.
    if (kind !== 'meetup') return fail('INVALID', '같은 학과 제외는 미팅에서만 쓸 수 있어요.');
    out.excludeSameDept = true;
  }
  return ok(out);
}

const sameSlots = (a: SlotSpec[], b: SlotSpec[]) =>
  a.length === b.length && a.every((s, i) => s.key === b[i].key && s.capacity === b[i].capacity);

/**
 * 모임 종류별 자리 구성·참여 방식을 프리셋으로 **다시 만든다**.
 * 클라이언트가 보낸 구성은 프리셋과 같을 때만 받아 준다 — 임의의 자리(예: 1:9 미팅)나 라벨 위조를 막는다.
 */
export function resolvePreset(
  kind: GatheringKind,
  slots: SlotSpec[],
  joinPolicy: JoinPolicy,
): Result<{ slots: SlotSpec[]; joinPolicy: JoinPolicy }> {
  if (kind === 'meetup') {
    const size = MEETUP_SIZES.find((s) => sameSlots(MEETUP_PRESETS[s].slots, slots));
    if (!size) return fail('INVALID', '미팅 자리 구성이 올바르지 않습니다.');
    if (joinPolicy !== MEETUP_JOIN_POLICY) return fail('INVALID', '미팅은 선착순으로만 만들 수 있어요.');
    return ok({ slots: MEETUP_PRESETS[size].slots, joinPolicy: MEETUP_JOIN_POLICY });
  }
  if (kind === 'meal') {
    const capacity = MEAL_CAPACITY_OPTIONS.find((c) => sameSlots(MEAL_PRESET(c).slots, slots));
    if (capacity === undefined) return fail('INVALID', '밥약 인원은 2~4명이에요.');
    if (joinPolicy !== MEAL_JOIN_POLICY) return fail('INVALID', '밥약은 주최자 승인으로만 만들 수 있어요.');
    return ok({ slots: MEAL_PRESET(capacity).slots, joinPolicy: MEAL_JOIN_POLICY });
  }
  return fail('INVALID', '팀빌딩 모임은 아직 만들 수 없어요.');
}

// ───────────── 만들기 ─────────────

/**
 * 모임 만들기 ①: 검증하고 문서를 만든다 (DB 에 쓰지 않는다 — 동기 함수).
 * 정지된 계정은 만들 수 없다. 주최자는 만들자마자 자기 자리에 앉는다.
 * `body` 의 시각은 정규화된 ISO 여야 한다(라우트가 바꿔 준다). 어느 항목이 왜 틀렸는지는 INVALID 문장으로.
 *
 * 저장과 나눈 이유: 속도 제한(10분에 10번)을 "잘못 입력해서 되돌려받은 요청"에는 쓰지 않으려고.
 * 라우트가 이 함수로 먼저 검증하고, 통과한 요청만 제한에 세고, 그다음 저장한다. 검증과 제한 확인 사이에
 * await 가 없어 동시에 여러 요청이 와도 제한을 피해 가지 못한다.
 */
export function prepareGathering(
  host: LoungeUser,
  body: CreateGatheringBody,
  now: ISODateTime = nowISO(),
): Result<Gathering> {
  if (!host.profileDone) return fail('PROFILE_REQUIRED');
  if (host.banned) return fail('BANNED', '이용이 제한된 계정은 모임을 만들 수 없습니다.');
  if (body.kind === 'team') return fail('INVALID', '팀빌딩 모임은 아직 만들 수 없어요.');

  const title = checkLine('제목', body.title, 1, TITLE_MAX);
  if (!title.ok) return title;
  const place = checkLine('장소', body.place, 1, PLACE_MAX);
  if (!place.ok) return place;
  const text = body.body.trim();
  if (lengthOf(text) > BODY_MAX) return fail('INVALID', `내용은 ${BODY_MAX}자까지 쓸 수 있어요.`);
  if (hasUnsafeChars(text)) return fail('INVALID', '내용에 쓸 수 없는 글자가 들어 있어요.');

  if (!isCanonicalISO(body.meetAt)) return fail('INVALID', '만나는 시각이 올바르지 않습니다.');
  if (!isCanonicalISO(body.joinDeadline)) return fail('INVALID', '신청 마감 시각이 올바르지 않습니다.');
  if (Date.parse(body.meetAt) > Date.parse(now) + MAX_HORIZON_DAYS * DAY_MS) {
    return fail('INVALID', `만나는 시각은 ${MAX_HORIZON_DAYS}일 안으로 정해 주세요.`);
  }

  const preset = resolvePreset(body.kind, body.slots, body.joinPolicy);
  if (!preset.ok) return preset;
  const meta = normalizeMeta(body.kind, body.meta);
  if (!meta.ok) return meta;

  const created = G.createGathering(
    {
      id: randomUUID(),
      kind: body.kind,
      hostId: host.id,
      hostGender: host.gender,
      title: title.value,
      body: text,
      place: place.value,
      meetAt: body.meetAt,
      joinDeadline: body.joinDeadline,
      joinPolicy: preset.value.joinPolicy,
      slots: preset.value.slots,
      hostSlotKey: body.hostSlotKey,
      meta: meta.value,
    },
    now,
  );
  if (!created.ok) return created;

  // 마감 시각이 이미 지났으면 글이 처음부터 '신청 마감' 이라 아무도 참여할 수 없다. 사용자가 만드는 글에서만 막는다
  // (도메인에서 막으면 마감 직전에 확정되는 빠른 매칭 밥약처럼 서버가 직접 만드는 모임까지 걸린다). 같은 순간(=)도 마감이다.
  if (created.value.joinDeadline <= now) return fail('INVALID', '신청 마감 시각은 지금 이후로 정해 주세요.');
  return created;
}

/** 모임 만들기 ②: 검증을 통과한 문서를 저장한다. */
export const saveGathering = insertGathering;

/** 검증 + 저장. (라우트는 속도 제한을 사이에 끼우려고 둘을 따로 부른다) */
export async function createGathering(host: LoungeUser, body: CreateGatheringBody): Promise<Result<Gathering>> {
  const prepared = prepareGathering(host, body);
  if (prepared.ok) await saveGathering(prepared.value);
  return prepared;
}

// ───────────── 참여 · 신청 ─────────────

/**
 * 참여 전 검사 (계약 §3.3 순서): ① 차단 ② 같은 과 제외. 정지 여부·마감·정원은 그 뒤 도메인 함수가 본다.
 * 도메인은 사람 사이의 관계를 모른다 — 차단은 저장소, 학과는 사용자 테이블이 필요해서 서비스에서 막는다.
 *
 * 차단은 "상대에게 알리지 않는다" 가 원칙이라 답이 방향에 따라 다르다.
 *  - 내가 차단한 사람이 있는 모임: FORBIDDEN 과 사유. 내가 한 일이라 숨길 게 없고, 그래서 못 들어간다고 알려 주는 게 친절하다.
 *  - 나를 차단한 사람이 있는 모임: 없는 모임과 같은 NOT_FOUND. 조회(getGatheringView)가 이미 그렇게 숨기는데
 *    참여·신청만 403 으로 답하면 모임 id 를 아는 사람이 자기가 차단당했는지 알아낼 수 있다.
 *  - 이미 주최·참여·신청한 모임: 차단 검사를 건너뛴다. 새 자리가 생길 수 없고 도메인이 ALREADY_JOINED 등으로 거절하는데,
 *    여기서 차단을 따지면 이미 앉은 사람이 다시 눌렀을 때만 응답이 달라져 차단 사실이 드러난다.
 */
async function checkEntry(g: Gathering, user: LoungeUser, rel: BlockRelations): Promise<Result<true>> {
  if (isInvolved(g, user.id)) return ok(true);

  const people = [g.hostId, ...G.memberIds(g)].filter((id) => id !== user.id);
  if (people.some((id) => rel.byMe.has(id))) return fail('FORBIDDEN', '차단한 사용자가 있는 모임이에요.');
  if (people.some((id) => rel.hidden.has(id))) return fail('NOT_FOUND', '모임을 찾을 수 없습니다.');

  if (g.meta.excludeSameDept && user.department) {
    const others = await loadUsers(people);
    if ([...others.values()].some((o) => o.department === user.department)) {
      return fail('FORBIDDEN', '같은 학과는 참여할 수 없는 미팅이에요.');
    }
  }
  return ok(true);
}

/** 정원이 막 찼으면(false → true) 단톡방을 연다. 방 열기는 멱등이라 놓쳐도 중복되지 않는다. */
async function openRoomIfJustFilled(before: boolean, after: Gathering): Promise<void> {
  if (!before && G.isFull(after)) await openRoomIfNeeded(after.id);
}

async function enter(
  user: LoungeUser,
  id: string,
  step: (g: Gathering, now: ISODateTime) => Result<Gathering>,
): Promise<Result<Gathering>> {
  const relations = await blockRelations(user.id);
  let wasFull = false;
  // 검사도 mutateGathering 안에서 한다 — 그 사이 다른 참여자가 들어와도 "방금 읽은 문서" 기준으로 판단하려고.
  const result = await mutateGathering(id, async (g) => {
    const allowed = await checkEntry(g, user, relations);
    if (!allowed.ok) return allowed;
    wasFull = G.isFull(g);
    return step(g, nowISO());
  });
  if (result.ok) await openRoomIfJustFilled(wasFull, result.value);
  return result;
}

/** 선착순 착석 (미팅). 같은 의자를 동시에 노리면 정확히 한 명만 성공하고 나머지는 SLOT_FULL. */
export function joinGathering(user: LoungeUser, id: string, slotKey: string): Promise<Result<Gathering>> {
  return enter(user, id, (g, now) => G.join(g, user, slotKey, now));
}

/** 참여 신청 (밥약). 승인 전에는 자리를 차지하지 않는다. */
export function applyToGathering(
  user: LoungeUser,
  id: string,
  slotKey: string,
  message: string,
): Promise<Result<Gathering>> {
  return enter(user, id, (g, now) => G.apply(g, user, slotKey, message, now));
}

/**
 * 나를 차단한 신청자는 내 신청자 목록에 나오지 않는다(toView 가 거른다). 그 사람의 id 로 승인·거절을 불러도
 * "신청자가 아닙니다" 로만 답해야 한다 — 다르게 답하면 주최자가 그 사람이 신청했고 자신을 차단했다는 걸 알아낸다.
 * 내가 차단한 신청자는 내가 한 일이라 사유(승인) 또는 정리(거절)를 그대로 허용한다.
 */
const blockedMeApplicant = (rel: BlockRelations, applicantId: string) =>
  rel.hidden.has(applicantId) && !rel.byMe.has(applicantId);

export async function approveApplicant(host: LoungeUser, id: string, applicantId: string): Promise<Result<Gathering>> {
  const relations = await blockRelations(host.id);
  let wasFull = false;
  const result = await mutateGathering(id, async (g) => {
    // 주최자의 승인일 때만 신청자 상태를 본다 (주최자가 아니면 도메인이 FORBIDDEN 을 낸다)
    if (g.hostId === host.id && G.isApplicant(g, applicantId)) {
      if (blockedMeApplicant(relations, applicantId)) return fail('NOT_APPLICANT');
      if (relations.byMe.has(applicantId)) return fail('FORBIDDEN', '차단한 사용자의 신청은 승인할 수 없어요.');
      const applicant = await findUser(applicantId);
      if (!applicant) return fail('NOT_APPLICANT', '탈퇴한 사용자의 신청이에요.');
      if (joinBlockReason(applicant)) return fail('BANNED', '이용이 정지된 사용자의 신청은 승인할 수 없어요.');
    }
    wasFull = G.isFull(g);
    return G.approve(g, host.id, applicantId, nowISO());
  });
  if (result.ok) await openRoomIfJustFilled(wasFull, result.value);
  return result;
}

export async function rejectApplicant(host: LoungeUser, id: string, applicantId: string): Promise<Result<Gathering>> {
  const relations = await blockRelations(host.id);
  return mutateGathering(id, (g) => {
    if (g.hostId === host.id && blockedMeApplicant(relations, applicantId)) return fail('NOT_APPLICANT');
    return G.reject(g, host.id, applicantId);
  });
}

export function leaveGathering(user: LoungeUser, id: string): Promise<Result<Gathering>> {
  return mutateGathering(id, (g) => G.leave(g, user.id, nowISO()));
}

export function cancelGathering(host: LoungeUser, id: string): Promise<Result<Gathering>> {
  return mutateGathering(id, (g) => G.cancel(g, host.id));
}

// ───────────── 모임 후 평가 (평판 반영) ─────────────

/**
 * "이 사람의 노쇼는 이미 벌점을 줬다" 는 표시. 모임 문서에 함께 저장되어 평가 저장과 한 번에(원자적으로) 기록된다.
 * Gathering 타입에는 없는 필드지만 도메인 함수들이 `{...g}` 로 문서를 복사하므로 그대로 따라다니고,
 * 화면 DTO(toView)는 필드를 하나씩 골라 담으므로 밖으로 새지 않는다.
 *
 * 왜 필요한가: "확정 → 누군가 평가를 바꿔 풀림 → 다시 확정" 을 반복하면 매번 새로 확정된 것처럼 보여
 * 경고가 계속 쌓인다(평가자 한 명이 자기 평가를 껐다 켜는 것만으로 정지를 만들 수 있다).
 * 한 모임에서 한 사람에게는 벌점을 **딱 한 번**만 준다.
 */
type WithPenalty = Gathering & { noshowPenalized?: string[] };

const penalizedOf = (g: Gathering): string[] => (g as WithPenalty).noshowPenalized ?? [];
const withPenalty = (g: Gathering, targetId: string): Gathering =>
  ({ ...g, noshowPenalized: [...penalizedOf(g), targetId] }) as Gathering;

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * 평가 남기기 + 평판 반영(멱등).
 *  - 온도: 이전에 내가 그 사람에게 남긴 평가(prev)와 새 평가(next)의 차이만 반영한다.
 *    같은 평가를 다시 눌러도 오르지 않고, good → soso 로 바꾸면 −0.4 로 되돌아간다.
 *  - 노쇼: 이 평가로 처음 "나머지 전원이 안 왔어요" 가 된 순간에만 확정(온도 −5, 경고 +1, 경고 2회면 정지).
 *    나머지가 2명 미만인 모임(둘뿐인 모임)은 확정되지 않는다 — domain/gathering 의 NOSHOW_MIN_REVIEWERS.
 * prev · 확정 여부는 **저장에 성공한 시도**에서 읽은 문서로 정해진다 — 같은 요청이 동시에 두 번 와도 한 번만 반영된다.
 *
 * 원자성: 평가가 담긴 문서 저장과 대상의 온도·경고 갱신은 **한 문장**으로 같이 반영된다(repo 의 mutateGatheringWithReputation).
 * "벌점을 줬다" 는 표시(noshowPenalized)와 실제 벌점이 한꺼번에 되거나 한꺼번에 안 되므로, 중간에 프로세스가 죽거나 연결이 끊겨도
 * 벌점이 영영 사라지거나(표시만 남음) 두 번 들어가지 않는다 — 실패하면 아무것도 바뀌지 않아 같은 평가를 다시 누르면 된다.
 */
export async function reviewParticipant(
  user: LoungeUser,
  id: string,
  targetId: string,
  mark: ReviewMark,
): Promise<Result<Gathering>> {
  return mutateGatheringWithReputation(id, (g) => {
    // 취소된 모임은 만나지 않았다 — 평가(노쇼 벌점)가 생기면 안 된다. (도메인 submitReview 는 이걸 보지 않는다)
    if (g.status === 'cancelled') return fail('NOT_OPEN', '취소된 모임은 평가할 수 없어요.');

    const prev = G.reviewOf(g, user.id, targetId)?.mark;
    const reviewed = G.submitReview(g, user.id, targetId, mark, nowISO());
    if (!reviewed.ok) return reviewed;

    const newlyConfirmed = !penalizedOf(g).includes(targetId) && G.isNoshowConfirmed(reviewed.value, targetId);
    const goodDelta = round1((mark === 'good' ? GOOD_DELTA : 0) - (prev === 'good' ? GOOD_DELTA : 0));
    return ok({
      gathering: newlyConfirmed ? withPenalty(reviewed.value, targetId) : reviewed.value,
      effect: {
        userId: targetId,
        temperatureDelta: round1(goodDelta + (newlyConfirmed ? NOSHOW_DELTA : 0)),
        warningsDelta: newlyConfirmed ? 1 : 0,
      },
    });
  });
}

// ───────────── 조회 (DTO) ─────────────

const touchesHidden = (g: Gathering, hidden: Set<string>) =>
  hidden.has(g.hostId) || G.memberIds(g).some((id) => hidden.has(id));

/** 내가 주최·참여·신청한 모임인가 — 이미 얽힌 약속은 차단 때문에 사라지면 안 된다 (나갈 방법이 없어진다) */
const isInvolved = (g: Gathering, userId: string) =>
  g.hostId === userId || G.isMember(g, userId) || G.isApplicant(g, userId);

/**
 * 내 시간표(수업)와 겹치는 모임. 참고용이라 실패해도 라운지가 멈추지 않게 빈 맵으로 물러난다.
 * 내가 이미 얽힌 모임·참여할 수 없는 상태의 모임은 계산하지 않는다.
 */
async function conflictsFor(viewer: LoungeUser, gatherings: Gathering[], now: ISODateTime): Promise<Map<string, string>> {
  const items: ConflictQuery[] = gatherings
    .filter((g) => !isInvolved(g, viewer.id) && G.currentStatus(g, now) === 'open')
    .map((g) => ({ id: g.id, meetAt: g.meetAt, durationMin: g.kind === 'meal' ? 60 : 120 }));
  if (items.length === 0) return new Map();
  try {
    return await timetableConflicts(viewer.id, items);
  } catch (err) {
    console.error('[lounge] 시간표 겹침 계산 실패:', err instanceof Error ? err.message : err);
    return new Map();
  }
}

/** 모임 하나를 내가 보는 모습으로 (액션 응답 · 상세) */
export async function viewOf(viewer: LoungeUser, g: Gathering): Promise<GatheringView> {
  const now = nowISO();
  const [users, hidden, conflicts] = await Promise.all([
    loadUsers(userIdsOf(g)),
    g.hostId === viewer.id && g.applicants.length > 0 ? hiddenFor(viewer.id) : Promise.resolve(undefined),
    conflictsFor(viewer, [g], now),
  ]);
  return toView(g, { users, hidden }, viewer, now, conflicts.get(g.id));
}

/** GET /gatherings/:id — 없거나, 내가 얽히지 않았는데 차단 관계가 있으면 NOT_FOUND (차단 사실을 드러내지 않는다) */
export async function getGatheringView(viewer: LoungeUser, id: string): Promise<Result<GatheringView>> {
  const g = await findGathering(id);
  if (!g) return fail('NOT_FOUND', '모임을 찾을 수 없습니다.');
  if (!isInvolved(g, viewer.id) && touchesHidden(g, await hiddenFor(viewer.id))) {
    return fail('NOT_FOUND', '모임을 찾을 수 없습니다.');
  }
  return ok(await viewOf(viewer, g));
}

export const LIST_WINDOW_MS = DAY_MS;
export const LIST_MAX = 100;

/**
 * GET /gatherings — 24시간 전 이후에 만나는 모임, 차단 관계 모임 제외, 최대 100개.
 * 밥약은 곧 먹을 약속이 위로(끝난 건 아래로), 그 밖에는 최신 글이 위로.
 */
export async function listGatheringViews(viewer: LoungeUser, kind?: GatheringKind): Promise<GatheringView[]> {
  const now = nowISO();
  const since = new Date(Date.parse(now) - LIST_WINDOW_MS).toISOString();
  // 차단으로 빠지는 만큼을 감안해 넉넉히 읽고, 걸러낸 뒤 100개로 자른다.
  const [rows, hidden] = await Promise.all([
    listGatherings({ kind, since, limit: LIST_MAX * 3 }),
    hiddenFor(viewer.id),
  ]);
  const visible = rows.filter((g) => isInvolved(g, viewer.id) || !touchesHidden(g, hidden)).slice(0, LIST_MAX);

  const [users, conflicts] = await Promise.all([
    loadUsers(visible.flatMap(userIdsOf)),
    conflictsFor(viewer, visible, now),
  ]);
  return viewList(visible, { users, hidden }, viewer, now, { kind, conflicts });
}

export const MINE_WINDOW_MS = 7 * DAY_MS;
export const MINE_MAX = 50;

/** GET /mine — 내가 주최·참여·신청한 모임(취소 제외), 7일 전 이후, 만나는 시각 오름차순, 최대 50개 */
export async function mineViews(viewer: LoungeUser): Promise<GatheringView[]> {
  const now = nowISO();
  const since = new Date(Date.parse(now) - MINE_WINDOW_MS).toISOString();
  const rows = await listMine(viewer.id, since, MINE_MAX);
  const [users, hidden] = await Promise.all([loadUsers(rows.flatMap(userIdsOf)), hiddenFor(viewer.id)]);
  return viewList(rows, { users, hidden }, viewer, now);
}
