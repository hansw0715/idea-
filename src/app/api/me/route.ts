/**
 * GET  /api/me   — 현재 사용자 + 전환 가능한 계정 목록
 * POST /api/me   — { userId } 로 계정 전환 (시연용 목업 로그인)
 *
 * 진짜 로그인이 붙으면 POST는 지우고 GET만 남기면 된다. (담당: 한승원 / 인증은 친구)
 */
import { NextResponse } from 'next/server';
import { asUserId } from '@/shared/types';
import { toPublicUser } from '@/shared/view';
import { findUser, listUsers } from '@/server/service';
import { currentUser, SESSION_COOKIE } from '@/server/session';
import { toErrorResponse } from '../_lib/respond';

export async function GET() {
  const me = await currentUser();
  const users = await listUsers();
  return NextResponse.json({
    me: me ? toPublicUser(me) : null,
    users: users.map(toPublicUser),
  });
}

export async function POST(req: Request) {
  const { userId } = (await req.json()) as { userId: string };
  const user = await findUser(asUserId(userId));
  if (!user) return toErrorResponse({ code: 'NOT_FOUND', message: '없는 계정입니다.' });

  const res = NextResponse.json({ me: toPublicUser(user) });
  res.cookies.set(SESSION_COOKIE, user.id, { httpOnly: false, sameSite: 'lax', path: '/' });
  return res;
}
