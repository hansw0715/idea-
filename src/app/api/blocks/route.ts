/**
 * GET    /api/blocks — 내가 차단한 사람
 * POST   /api/blocks — { userId } 차단
 * DELETE /api/blocks — { userId } 차단 해제
 *
 * 차단하면 서로의 글·매칭에서 사라진다. 상대에게는 알리지 않는다.
 */
import { NextResponse } from 'next/server';
import { asUserId } from '@/shared/types';
import { toPublicUser } from '@/shared/view';
import { blockUser, myBlocks, unblockUser } from '@/server/safety-service';
import { findUser } from '@/server/service';
import { currentUser } from '@/server/session';
import { toErrorResponse } from '../_lib/respond';

export async function GET() {
  const me = await currentUser();
  if (!me) return toErrorResponse({ code: 'FORBIDDEN', message: '로그인이 필요합니다.' });

  const ids = await myBlocks(me.id);
  const users = await Promise.all(ids.map((id) => findUser(id)));
  return NextResponse.json({ blocked: users.filter((u) => u !== null).map(toPublicUser) });
}

export async function POST(req: Request) {
  const me = await currentUser();
  if (!me) return toErrorResponse({ code: 'FORBIDDEN', message: '로그인이 필요합니다.' });

  const { userId } = (await req.json().catch(() => ({}))) as { userId?: string };
  if (!userId) return toErrorResponse({ code: 'INVALID', message: '차단할 사람이 없습니다.' });

  const result = await blockUser(me.id, asUserId(userId));
  if (!result.ok) return toErrorResponse(result.error);
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  const me = await currentUser();
  if (!me) return toErrorResponse({ code: 'FORBIDDEN', message: '로그인이 필요합니다.' });

  const { userId } = (await req.json().catch(() => ({}))) as { userId?: string };
  if (!userId) return toErrorResponse({ code: 'INVALID', message: '해제할 사람이 없습니다.' });

  await unblockUser(me.id, asUserId(userId));
  return NextResponse.json({ ok: true });
}
