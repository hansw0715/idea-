/**
 * GET    /api/meals/quick — 내 대기표 / 후보 방 상태
 * POST   /api/meals/quick — { date, placeType, size, bands, tags } 빠른 매칭 신청
 * PATCH  /api/meals/quick — { roomId, bands } 가능 시간 수정 / { roomId, answer } 수락·거절
 * DELETE /api/meals/quick — 대기 취소
 */
import { NextResponse } from 'next/server';
import {
  answerRoom,
  cancelQuickMatch,
  quickState,
  requestQuickMatch,
  voteBands,
  type QuickInput,
} from '@/features/mealdate/service';
import type { Answer } from '@/features/mealdate/quick-match';
import { currentUser } from '@/server/session';
import { toErrorResponse } from '../../_lib/respond';

export async function GET() {
  const me = await currentUser();
  if (!me) return toErrorResponse({ code: 'FORBIDDEN', message: '로그인이 필요합니다.' });
  return NextResponse.json(await quickState(me.id));
}

export async function POST(req: Request) {
  const me = await currentUser();
  if (!me) return toErrorResponse({ code: 'FORBIDDEN', message: '로그인이 필요합니다.' });

  const body = (await req.json().catch(() => ({}))) as Partial<QuickInput>;
  const result = await requestQuickMatch(me, {
    date: body.date ?? '',
    placeType: body.placeType!,
    size: Number(body.size),
    bands: body.bands ?? [],
    tags: body.tags ?? [],
  });
  if (!result.ok) return toErrorResponse(result.error);
  return NextResponse.json(result.value);
}

export async function PATCH(req: Request) {
  const me = await currentUser();
  if (!me) return toErrorResponse({ code: 'FORBIDDEN', message: '로그인이 필요합니다.' });

  const body = (await req.json().catch(() => ({}))) as { roomId?: string; bands?: string[]; answer?: Answer };
  if (!body.roomId) return toErrorResponse({ code: 'INVALID', message: '방 정보가 없습니다.' });

  const result = body.answer
    ? await answerRoom(me.id, body.roomId, body.answer)
    : await voteBands(me.id, body.roomId, body.bands ?? []);
  if (!result.ok) return toErrorResponse(result.error);
  return NextResponse.json(result.value);
}

export async function DELETE() {
  const me = await currentUser();
  if (!me) return toErrorResponse({ code: 'FORBIDDEN', message: '로그인이 필요합니다.' });

  const result = await cancelQuickMatch(me.id);
  if (!result.ok) return toErrorResponse(result.error);
  return NextResponse.json(result.value);
}
