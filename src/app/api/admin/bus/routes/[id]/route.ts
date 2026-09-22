/**
 * PUT    /api/admin/bus/routes/:id — 노선 통째로 저장(정류장·시간표 포함, 없으면 새로 만듦)
 * DELETE /api/admin/bus/routes/:id — 노선 삭제
 * 관리자만.
 */
import { NextResponse } from 'next/server';
import type { BusRoute } from '@/features/bus/types';
import { deleteRoute, saveRoute } from '@/features/bus/service';
import { requireAdmin } from '@/server/guard';
import { toErrorResponse } from '../../../../_lib/respond';

export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  if (!admin.ok) return toErrorResponse(admin.error);

  const { id } = await ctx.params;
  const body = (await req.json().catch(() => null)) as BusRoute | null;
  if (!body || !Array.isArray(body.stops) || typeof body.timetables !== 'object') {
    return toErrorResponse({ code: 'INVALID', message: '노선 데이터 형식이 올바르지 않습니다.' });
  }

  const result = await saveRoute({ ...body, id });
  if (!result.ok) return toErrorResponse(result.error);
  return NextResponse.json({ route: result.value });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  if (!admin.ok) return toErrorResponse(admin.error);

  const { id } = await ctx.params;
  await deleteRoute(id);
  return NextResponse.json({ ok: true });
}
