/**
 * GET  /api/admin/reports — 신고 목록 (관리자)
 * POST /api/admin/reports — { reportId, action } 처리. action: resolve | dismiss | ban | unban
 */
import { NextResponse } from 'next/server';
import { handleReport, listReportsForAdmin, type ReportAction } from '@/server/safety-service';
import { requireAdmin } from '@/server/guard';
import { toErrorResponse } from '../../_lib/respond';

export async function GET() {
  const admin = await requireAdmin();
  if (!admin.ok) return toErrorResponse(admin.error);
  return NextResponse.json({ reports: await listReportsForAdmin() });
}

export async function POST(req: Request) {
  const admin = await requireAdmin();
  if (!admin.ok) return toErrorResponse(admin.error);

  const body = (await req.json().catch(() => ({}))) as { reportId?: string; action?: ReportAction };
  if (!body.reportId || !body.action) return toErrorResponse({ code: 'INVALID', message: '처리 정보가 없습니다.' });

  const result = await handleReport(admin.value.id, body.reportId, body.action);
  if (!result.ok) return toErrorResponse(result.error);
  return NextResponse.json({ ok: true });
}
