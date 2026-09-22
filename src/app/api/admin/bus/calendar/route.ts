/** PUT /api/admin/bus/calendar — { vacations, holidays } 방학 기간·공휴일 저장. 관리자만. */
import { NextResponse } from 'next/server';
import type { VacationPeriod } from '@/features/bus/types';
import { saveCalendar } from '@/features/bus/service';
import { requireAdmin } from '@/server/guard';
import { toErrorResponse } from '../../../_lib/respond';

export async function PUT(req: Request) {
  const admin = await requireAdmin();
  if (!admin.ok) return toErrorResponse(admin.error);

  const body = (await req.json().catch(() => null)) as { vacations?: VacationPeriod[]; holidays?: string[] } | null;
  if (!body || !Array.isArray(body.vacations) || !Array.isArray(body.holidays)) {
    return toErrorResponse({ code: 'INVALID', message: '방학/공휴일 형식이 올바르지 않습니다.' });
  }
  const result = await saveCalendar({ vacations: body.vacations, holidays: body.holidays });
  if (!result.ok) return toErrorResponse(result.error);
  return NextResponse.json({ ok: true });
}
