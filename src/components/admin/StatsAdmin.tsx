'use client';

/** 관리자 — 이용 통계. (담당: 한승원) */
import { useEffect, useState } from 'react';
import { Card, EmptyState } from '@/components/ui';
import { request } from '@/lib/api';
import type { AdminStats } from '@/app/api/admin/stats/route';

const KIND_LABEL: Record<string, string> = { meetup: '미팅', meal: '밥약', team: '팀빌딩' };

export function StatsAdmin() {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    request<AdminStats>('/api/admin/stats')
      .then(setStats)
      .catch(() => setError(true));
  }, []);

  if (error) return <EmptyState icon="⚠️" title="통계를 불러오지 못했어요" />;
  if (!stats) return <div className="h-32 animate-pulse rounded-lg bg-surface-muted" />;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <Stat label="가입자" value={`${stats.users.total}명`} sub={`메일 인증 ${stats.users.verified}명`} />
        <Stat label="평균 매너온도" value={`${stats.users.averageTemperature}°`} sub={`이용 정지 ${stats.users.banned}명`} />
        <Stat
          label="노쇼율"
          value={`${stats.noshow.rate}%`}
          sub={`끝난 모임 참여 ${stats.noshow.participants}명 중 ${stats.noshow.confirmed}명`}
        />
        <Stat
          label="진행 중 모임"
          value={`${stats.gatherings.reduce((s, g) => s + g.open, 0)}개`}
          sub={`전체 ${stats.gatherings.reduce((s, g) => s + g.total, 0)}개`}
        />
      </div>

      <Card className="space-y-2">
        <h3 className="text-sm font-bold">기능별</h3>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-muted">
              <th className="py-1">기능</th>
              <th>전체</th>
              <th>모집 중</th>
              <th>종료</th>
              <th>참여</th>
            </tr>
          </thead>
          <tbody>
            {stats.gatherings.map((g) => (
              <tr key={g.kind} className="border-t border-border">
                <td className="py-1.5 font-semibold">{KIND_LABEL[g.kind] ?? g.kind}</td>
                <td>{g.total}</td>
                <td>{g.open}</td>
                <td>{g.done}</td>
                <td>{g.participants}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <Card className="space-y-0.5">
      <p className="text-xs text-muted">{label}</p>
      <p className="text-xl font-bold">{value}</p>
      <p className="text-[11px] text-muted">{sub}</p>
    </Card>
  );
}
