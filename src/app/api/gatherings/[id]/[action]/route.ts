/**
 * POST /api/gatherings/:id/:action
 *
 *   join       { slotKey }              선착순 착석 (미팅)
 *   apply      { slotKey, message }     참여 신청 (밥약)
 *   approve    { userId }               신청 승인 (주최자)
 *   reject     { userId }               신청 거절 (주최자)
 *   leave      {}                       참여 취소
 *   cancel     {}                       모임 취소 (주최자)
 *   attendance { userId, mark }         출결 기록 → 노쇼 이벤트 발행
 *
 * 액션을 한 라우트로 모은 이유: 파일이 7개로 흩어지면 친구가 API를 훑어보기 어렵고,
 * 라우트마다 세션/에러 처리를 복붙하게 된다. 실제 판단은 전부 service.ts에 있다.
 */
import { NextResponse } from 'next/server';
import { asGatheringId, asUserId, fail } from '@/shared/types';
import type { AttendanceMark } from '@/domain/gathering';
import {
  applyToGathering,
  approveApplicant,
  cancelGathering,
  joinGathering,
  leaveGathering,
  markAttendance,
  rejectApplicant,
} from '@/server/service';
import { viewOf } from '@/server/present';
import { currentUser } from '@/server/session';
import { toErrorResponse } from '../../../_lib/respond';

const ACTIONS = ['join', 'apply', 'approve', 'reject', 'leave', 'cancel', 'attendance'] as const;
type Action = (typeof ACTIONS)[number];

type Body = {
  slotKey?: string;
  message?: string;
  userId?: string;
  mark?: AttendanceMark;
};

export async function POST(req: Request, ctx: { params: Promise<{ id: string; action: string }> }) {
  const { id: rawId, action } = await ctx.params;
  if (!ACTIONS.includes(action as Action)) {
    return toErrorResponse({ code: 'NOT_FOUND', message: `알 수 없는 동작: ${action}` });
  }

  const viewer = await currentUser();
  if (!viewer) return toErrorResponse({ code: 'FORBIDDEN', message: '로그인이 필요합니다.' });

  const id = asGatheringId(rawId);
  const body = (await req.json().catch(() => ({}))) as Body;

  const result = await run(action as Action, id, viewer.id, body);
  if (!result.ok) return toErrorResponse(result.error);

  return NextResponse.json({ gathering: await viewOf(result.value, viewer) });
}

function run(action: Action, id: ReturnType<typeof asGatheringId>, me: ReturnType<typeof asUserId>, body: Body) {
  switch (action) {
    case 'join':
      if (!body.slotKey) return Promise.resolve(fail('INVALID', '앉을 자리를 골라 주세요.'));
      return joinGathering(id, me, body.slotKey);

    case 'apply':
      if (!body.slotKey) return Promise.resolve(fail('INVALID', '자리를 골라 주세요.'));
      return applyToGathering(id, me, body.slotKey, body.message ?? '');

    case 'approve':
      if (!body.userId) return Promise.resolve(fail('INVALID', '승인할 사람이 없습니다.'));
      return approveApplicant(id, me, asUserId(body.userId));

    case 'reject':
      if (!body.userId) return Promise.resolve(fail('INVALID', '거절할 사람이 없습니다.'));
      return rejectApplicant(id, me, asUserId(body.userId));

    case 'leave':
      return leaveGathering(id, me);

    case 'cancel':
      return cancelGathering(id, me);

    case 'attendance':
      if (!body.userId || !body.mark) return Promise.resolve(fail('INVALID', '출결 정보가 없습니다.'));
      return markAttendance(id, me, asUserId(body.userId), body.mark);
  }
}
