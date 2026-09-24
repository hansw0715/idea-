/** POST /api/reports — { userId, context, refId, reason, detail } 신고 */
import { NextResponse } from 'next/server';
import { asUserId } from '@/shared/types';
import type { ReportReason } from '@/domain/safety/safety';
import { reportUser } from '@/server/safety-service';
import { currentUser } from '@/server/session';
import { toErrorResponse } from '../_lib/respond';

type Body = { userId?: string; context?: string; refId?: string | null; reason?: ReportReason; detail?: string };

export async function POST(req: Request) {
  const me = await currentUser();
  if (!me) return toErrorResponse({ code: 'FORBIDDEN', message: '로그인이 필요합니다.' });

  const body = (await req.json().catch(() => ({}))) as Body;
  if (!body.userId || !body.reason) return toErrorResponse({ code: 'INVALID', message: '신고 정보가 부족합니다.' });

  const result = await reportUser(me.id, {
    targetId: asUserId(body.userId),
    context: body.context ?? 'etc',
    refId: body.refId ?? null,
    reason: body.reason,
    detail: body.detail ?? '',
  });
  if (!result.ok) return toErrorResponse(result.error);
  return NextResponse.json({ ok: true });
}
