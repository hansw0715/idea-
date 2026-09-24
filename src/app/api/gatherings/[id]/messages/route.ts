/**
 * GET  /api/gatherings/:id/messages?after=<ISO> — 단톡방 내용 (폴링)
 * POST /api/gatherings/:id/messages             — { text } 메시지 보내기
 *
 * 방 id는 모임 id와 같다. 참여자만 읽고 쓸 수 있고, 자리가 다 차야 열린다.
 */
import { NextResponse } from 'next/server';
import { roomView, sendMessage } from '@/server/chat-service';
import { currentUser } from '@/server/session';
import { toErrorResponse } from '../../../_lib/respond';

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const viewer = await currentUser();
  const after = new URL(req.url).searchParams.get('after');

  const result = await roomView(id, viewer, after);
  if (!result.ok) return toErrorResponse(result.error);
  return NextResponse.json(result.value);
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const viewer = await currentUser();
  if (!viewer) return toErrorResponse({ code: 'FORBIDDEN', message: '로그인이 필요합니다.' });

  const { text } = (await req.json().catch(() => ({}))) as { text?: string };
  const sent = await sendMessage(id, viewer.id, text ?? '');
  if (!sent.ok) return toErrorResponse(sent.error);

  // 보낸 직후 화면을 갱신할 수 있게 방 전체를 돌려준다.
  const result = await roomView(id, viewer);
  if (!result.ok) return toErrorResponse(result.error);
  return NextResponse.json(result.value);
}
