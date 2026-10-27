import { Router } from 'express';
import type { Request, Response } from 'express';
import { fail, ok } from '../../../shared/lounge/types.js';
import type { Result } from '../../../shared/lounge/types.js';
import type {
  CreateGatheringBody,
  GatheringKind,
  GatheringMeta,
  JoinPolicy,
  ReviewMark,
  SlotSpec,
} from '../../../shared/lounge/gathering.js';
import type { GatheringAction, GatheringActionBody } from '../../../shared/lounge/view.js';
import { createRateLimiter } from '../../rateLimit.js';
import { handler, me, sendError, sendResult } from '../http.js';
import * as service from '../services/gathering.js';
import { APPLY_MESSAGE_MAX } from '../services/gathering.js';
import { leaveRoom, roomView, roomSummaries, sendMessage } from '../services/chat.js';
import { hasUnsafeChars } from '../domain/chat.js';

/**
 * 모임: GET/POST /gatherings, GET /gatherings/:id, POST /gatherings/:id/:action,
 *       GET/POST /gatherings/:id/messages, GET /mine
 * 규칙: docs/lounge/01-contract.md §3 · §3.5
 *
 * 라우트는 판단하지 않는다 — 본문의 **모양**(타입·필수 여부)을 확인해 서비스가 받는 형태로 바꾸고, 결과를 응답으로 보낼 뿐이다.
 * 길이·집합·시간 관계 같은 **규칙**은 서비스(와 도메인)가 본다.
 */
export const gatheringsRouter = Router();

// ───────────── 입력 모양 확인 ─────────────

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

const KINDS: readonly GatheringKind[] = ['meetup', 'meal', 'team'];
const POLICIES: readonly JoinPolicy[] = ['auto', 'approval'];
// 노쇼(안 왔어요) 평가는 없앴다 — 약속을 어기거나 불쾌한 일은 신고로 알린다. (도메인의 옛 노쇼 계산은 더는 이 경로로 닿지 않는다)
const MARKS: readonly ReviewMark[] = ['good', 'soso'];
export const ACTIONS: readonly GatheringAction[] = ['join', 'apply', 'approve', 'reject', 'leave', 'cancel', 'review'];

const invalid = (message: string) => fail('INVALID', message);

/** 시각 문자열 → 정규화된 ISO. 도메인이 날짜를 문자열로 비교하므로 형식을 하나로 맞춘다. */
function toISO(v: unknown): string | null {
  if (typeof v !== 'string' || v.length > 40) return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

/** 사용자 id 는 숫자 문자열("7"). 숫자로 와도 받아 주고, "007" 은 "7" 로 맞춘다. */
export function parseUserId(v: unknown): string | null {
  if (typeof v === 'number' && Number.isInteger(v) && v > 0) return String(v);
  if (typeof v === 'string' && /^\d{1,9}$/.test(v)) return String(Number(v));
  return null;
}

function parseSlots(v: unknown): Result<SlotSpec[]> {
  if (!Array.isArray(v) || v.length === 0 || v.length > 4) return invalid('자리 구성이 올바르지 않습니다.');
  const slots: SlotSpec[] = [];
  for (const s of v) {
    if (!isObj(s) || typeof s.key !== 'string' || typeof s.label !== 'string' || !Number.isInteger(s.capacity)) {
      return invalid('자리 구성이 올바르지 않습니다.');
    }
    slots.push({ key: s.key, label: s.label, capacity: s.capacity as number });
  }
  return ok(slots);
}

function parseMeta(v: unknown): Result<GatheringMeta | undefined> {
  if (v === undefined || v === null) return ok(undefined);
  if (!isObj(v)) return invalid('추가 정보가 올바르지 않습니다.');
  const meta: GatheringMeta = {};
  if (v.placeType !== undefined) {
    if (typeof v.placeType !== 'string') return invalid('장소 종류가 올바르지 않습니다.');
    meta.placeType = v.placeType;
  }
  if (v.menu !== undefined) {
    if (typeof v.menu !== 'string') return invalid('메뉴 종류가 올바르지 않습니다.');
    meta.menu = v.menu;
  }
  if (v.tags !== undefined) {
    // 서비스가 개수 제한을 말로 안내하지만, 터무니없이 큰 배열은 여기서 막는다.
    if (!Array.isArray(v.tags) || v.tags.length > 50 || v.tags.some((t) => typeof t !== 'string')) {
      return invalid('태그가 올바르지 않습니다.');
    }
    meta.tags = v.tags as string[];
  }
  if (v.excludeSameDept !== undefined) {
    if (typeof v.excludeSameDept !== 'boolean') return invalid('같은 학과 제외 값이 올바르지 않습니다.');
    meta.excludeSameDept = v.excludeSameDept;
  }
  return ok(meta);
}

/** `POST /gatherings` 본문 → 서비스 입력. (모르는 필드는 버린다) */
export function parseCreateBody(raw: unknown): Result<CreateGatheringBody> {
  if (!isObj(raw)) return invalid('요청 내용이 올바르지 않습니다.');
  if (typeof raw.kind !== 'string' || !(KINDS as readonly string[]).includes(raw.kind)) {
    return invalid('모임 종류가 올바르지 않습니다.');
  }
  if (typeof raw.title !== 'string') return invalid('제목을 입력해 주세요.');
  if (raw.body !== undefined && typeof raw.body !== 'string') return invalid('내용이 올바르지 않습니다.');
  if (typeof raw.place !== 'string') return invalid('장소를 입력해 주세요.');
  const meetAt = toISO(raw.meetAt);
  if (!meetAt) return invalid('만나는 시각이 올바르지 않습니다.');
  const joinDeadline = toISO(raw.joinDeadline);
  if (!joinDeadline) return invalid('신청 마감 시각이 올바르지 않습니다.');
  if (typeof raw.joinPolicy !== 'string' || !(POLICIES as readonly string[]).includes(raw.joinPolicy)) {
    return invalid('참여 방식이 올바르지 않습니다.');
  }
  const slots = parseSlots(raw.slots);
  if (!slots.ok) return slots;
  if (raw.hostSlotKey !== undefined && typeof raw.hostSlotKey !== 'string') {
    return invalid('앉을 자리가 올바르지 않습니다.');
  }
  const meta = parseMeta(raw.meta);
  if (!meta.ok) return meta;

  return ok({
    kind: raw.kind as GatheringKind,
    title: raw.title,
    body: (raw.body as string | undefined) ?? '',
    place: raw.place,
    meetAt,
    joinDeadline,
    joinPolicy: raw.joinPolicy as JoinPolicy,
    slots: slots.value,
    hostSlotKey: raw.hostSlotKey as string | undefined,
    meta: meta.value,
  });
}

/** `POST /gatherings/:id/:action` 본문 확인. 필요한 값이 없으면 INVALID. */
export function parseActionBody(action: GatheringAction, raw: unknown): Result<GatheringActionBody> {
  const body: Obj = isObj(raw) ? raw : {};
  switch (action) {
    case 'join':
    case 'apply': {
      const slotKey = body.slotKey;
      if (typeof slotKey !== 'string' || slotKey.length === 0 || slotKey.length > 40) {
        return invalid('앉을 자리를 골라 주세요.');
      }
      if (action === 'join') return ok({ slotKey });
      const message = body.message === undefined || body.message === null ? '' : body.message;
      if (typeof message !== 'string') return invalid('신청 메시지가 올바르지 않습니다.');
      const text = message.trim();
      if ([...text].length > APPLY_MESSAGE_MAX) {
        return invalid(`신청 메시지는 ${APPLY_MESSAGE_MAX}자까지 쓸 수 있어요.`);
      }
      if (hasUnsafeChars(text)) return invalid('신청 메시지에 쓸 수 없는 글자가 들어 있어요.');
      return ok({ slotKey, message: text });
    }
    case 'approve':
    case 'reject': {
      const userId = parseUserId(body.userId);
      return userId ? ok({ userId }) : invalid(action === 'approve' ? '승인할 사람이 없습니다.' : '거절할 사람이 없습니다.');
    }
    case 'review': {
      const userId = parseUserId(body.userId);
      if (!userId || typeof body.mark !== 'string' || !(MARKS as readonly string[]).includes(body.mark)) {
        return invalid('평가 정보가 없습니다.');
      }
      return ok({ userId, mark: body.mark as ReviewMark });
    }
    case 'leave':
    case 'cancel':
      return ok({});
  }
}

// ───────────── 속도 제한 (계약 §0) ─────────────

const createLimiter = createRateLimiter(10, 10 * 60 * 1000); // 모임 만들기: 10분에 10번
const messageLimiter = createRateLimiter(40, 60 * 1000); // 메시지: 분당 40

function tooMany(res: Response, message: string): void {
  res.status(429).json({ error: message, code: 'RATE_LIMITED' });
}

// 폴링이 잦은 읽기 응답이 중간에서 캐시되지 않게 한다.
const noStore = (_req: Request, res: Response, next: () => void) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
};
gatheringsRouter.use('/gatherings', noStore);
gatheringsRouter.use('/mine', noStore);
gatheringsRouter.use('/rooms', noStore);
gatheringsRouter.get('/rooms', handler(async (_req, res) => {
  res.json({ rooms: await roomSummaries(me(res)) });
}));

// 모임 id 는 UUID(또는 시드의 영문-숫자 이름)다. 그 밖의 모양(NUL 같은 글자, 너무 긴 값)은 DB 에 닿기 전에 "없는 모임" 으로 돌려보낸다.
// (NUL 이 바인딩되면 Postgres 가 오류를 내서 500 이 된다)
gatheringsRouter.param('id', (_req, res, next, value: string) => {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(value)) {
    sendError(res, fail('NOT_FOUND', '모임을 찾을 수 없습니다.').error);
    return;
  }
  next();
});

// ───────────── 모임 ─────────────

gatheringsRouter.get(
  '/gatherings',
  handler(async (req, res) => {
    const raw = req.query.kind;
    let kind: GatheringKind | undefined;
    if (raw !== undefined) {
      if (typeof raw !== 'string' || !(KINDS as readonly string[]).includes(raw)) {
        sendError(res, fail('INVALID', '모임 종류가 올바르지 않습니다.').error);
        return;
      }
      kind = raw as GatheringKind;
    }
    res.json({ gatherings: await service.listGatheringViews(me(res), kind) });
  }),
);

gatheringsRouter.post(
  '/gatherings',
  handler(async (req, res) => {
    const viewer = me(res);
    const body = parseCreateBody(req.body);
    if (!body.ok) return sendError(res, body.error);
    // 검증을 먼저 하고 통과한 요청만 속도 제한에 센다 — 잘못 입력해 되돌려받은 요청이 횟수를 깎지 않게.
    // (두 호출 사이에 await 가 없어서 동시에 와도 제한을 피해 가지 못한다)
    const prepared = service.prepareGathering(viewer, body.value);
    if (!prepared.ok) return sendError(res, prepared.error);
    if (!createLimiter.hit(viewer.id)) {
      return tooMany(res, '모임은 10분에 10번까지 만들 수 있어요. 잠시 후 다시 시도해 주세요.');
    }

    await service.saveGathering(prepared.value);
    res.status(201).json({ gathering: await service.viewOf(viewer, prepared.value) });
  }),
);

gatheringsRouter.get(
  '/mine',
  handler(async (_req, res) => {
    res.json({ gatherings: await service.mineViews(me(res)) });
  }),
);

// 단톡방은 `:action` 보다 먼저 등록한다 (`messages` 는 모임 동작이 아니다)
gatheringsRouter.get(
  '/gatherings/:id/messages',
  handler(async (req, res) => {
    const afterRaw = req.query.after;
    let after: string | null = null;
    if (afterRaw !== undefined) {
      after = toISO(afterRaw);
      if (!after) return sendError(res, fail('INVALID', '시각이 올바르지 않습니다.').error);
    }
    const result = await roomView(me(res), req.params.id, after);
    sendResult(res, result, (room) => ({ room }));
  }),
);

gatheringsRouter.post(
  '/gatherings/:id/messages',
  handler(async (req, res) => {
    const viewer = me(res);
    const text = isObj(req.body) ? req.body.text : undefined;
    if (typeof text !== 'string') return sendError(res, fail('INVALID', '메시지를 입력해 주세요.').error);
    if (!messageLimiter.hit(viewer.id)) {
      return tooMany(res, '메시지를 너무 빨리 보내고 있어요. 잠시 후 다시 보내 주세요.');
    }

    const sent = await sendMessage(viewer, req.params.id, text);
    if (!sent.ok) return sendError(res, sent.error);
    // 보낸 직후 화면을 갱신할 수 있게 방 전체를 돌려준다.
    const result = await roomView(viewer, req.params.id);
    sendResult(res, result, (room) => ({ room }));
  }),
);

// 단톡방 나가기 (모임 참여는 그대로, 내 목록에서 방만 지운다)
gatheringsRouter.post(
  '/gatherings/:id/leave-room',
  handler(async (req, res) => {
    const result = await leaveRoom(me(res), req.params.id);
    sendResult(res, result, () => ({ ok: true }));
  }),
);

gatheringsRouter.get(
  '/gatherings/:id',
  handler(async (req, res) => {
    const result = await service.getGatheringView(me(res), req.params.id);
    sendResult(res, result, (gathering) => ({ gathering }));
  }),
);

gatheringsRouter.post(
  '/gatherings/:id/:action',
  handler(async (req, res) => {
    const viewer = me(res);
    const { id, action } = req.params;
    if (!(ACTIONS as readonly string[]).includes(action)) {
      return sendError(res, fail('NOT_FOUND', '알 수 없는 동작입니다.').error);
    }
    const body = parseActionBody(action as GatheringAction, req.body);
    if (!body.ok) return sendError(res, body.error);

    const result = await runAction(action as GatheringAction, viewer, id, body.value);
    if (!result.ok) return sendError(res, result.error);
    res.json({ gathering: await service.viewOf(viewer, result.value) });
  }),
);

function runAction(
  action: GatheringAction,
  viewer: ReturnType<typeof me>,
  id: string,
  body: GatheringActionBody,
) {
  switch (action) {
    case 'join':
      return service.joinGathering(viewer, id, body.slotKey as string);
    case 'apply':
      return service.applyToGathering(viewer, id, body.slotKey as string, body.message ?? '');
    case 'approve':
      return service.approveApplicant(viewer, id, body.userId as string);
    case 'reject':
      return service.rejectApplicant(viewer, id, body.userId as string);
    case 'leave':
      return service.leaveGathering(viewer, id);
    case 'cancel':
      return service.cancelGathering(viewer, id);
    case 'review':
      return service.reviewParticipant(viewer, id, body.userId as string, body.mark as ReviewMark);
  }
}
