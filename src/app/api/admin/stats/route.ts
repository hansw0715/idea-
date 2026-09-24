/** GET /api/admin/stats — 이용 통계 (관리자) */
import { NextResponse } from 'next/server';
import { confirmedNoshows, currentStatus, memberIds } from '@/domain/gathering';
import { listGatherings, listUsers } from '@/server/service';
import { requireAdmin } from '@/server/guard';
import { toErrorResponse } from '../../_lib/respond';

export type AdminStats = {
  users: { total: number; verified: number; banned: number; averageTemperature: number };
  gatherings: { kind: string; total: number; open: number; done: number; cancelled: number; participants: number }[];
  noshow: { confirmed: number; participants: number; rate: number };
};

export async function GET() {
  const admin = await requireAdmin();
  if (!admin.ok) return toErrorResponse(admin.error);

  const [all, users] = await Promise.all([listGatherings(), listUsers()]);
  const now = new Date().toISOString();

  const kinds = ['meetup', 'meal', 'team'] as const;
  const gatherings = kinds.map((kind) => {
    const list = all.filter((g) => g.kind === kind);
    const status = list.map((g) => currentStatus(g, now));
    return {
      kind,
      total: list.length,
      open: status.filter((s) => s === 'open' || s === 'full').length,
      done: status.filter((s) => s === 'done').length,
      cancelled: status.filter((s) => s === 'cancelled').length,
      participants: list.reduce((sum, g) => sum + memberIds(g).length, 0),
    };
  });

  // 노쇼율 = 확정 노쇼 수 / 끝난 모임의 참여자 수
  const finished = all.filter((g) => currentStatus(g, now) === 'done');
  const participants = finished.reduce((sum, g) => sum + memberIds(g).length, 0);
  const confirmed = finished.reduce((sum, g) => sum + confirmedNoshows(g).length, 0);

  const stats: AdminStats = {
    users: {
      total: users.length,
      verified: users.filter((u) => u.verified).length,
      banned: users.filter((u) => u.banned).length,
      averageTemperature: users.length
        ? Math.round((users.reduce((s, u) => s + u.temperature, 0) / users.length) * 10) / 10
        : 0,
    },
    gatherings,
    noshow: { confirmed, participants, rate: participants ? Math.round((confirmed / participants) * 1000) / 10 : 0 },
  };
  return NextResponse.json(stats);
}
