/** GET /api/gatherings/:id — 모임 하나 */
import { NextResponse } from 'next/server';
import { asGatheringId } from '@/shared/types';
import { findGathering } from '@/server/service';
import { viewOf } from '@/server/present';
import { currentUser } from '@/server/session';
import { toErrorResponse } from '../../_lib/respond';

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const gathering = await findGathering(asGatheringId(id));
  if (!gathering) return toErrorResponse({ code: 'NOT_FOUND', message: '모임을 찾을 수 없습니다.' });

  return NextResponse.json({ gathering: await viewOf(gathering, await currentUser()) });
}
