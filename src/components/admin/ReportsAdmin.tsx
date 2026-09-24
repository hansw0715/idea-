'use client';

/** 관리자 — 신고 처리. (담당: 한승원) */
import { useEffect, useState } from 'react';
import { Badge, Button, Card, EmptyState, Tabs } from '@/components/ui';
import { ApiError } from '@/lib/api';
import { fetchReports, handleReport } from '@/lib/meal-api';
import { AUTO_RESTRICT_REPORTS } from '@/domain/safety/safety';
import type { ReportView } from '@/server/safety-service';

type Filter = 'open' | 'all';

export function ReportsAdmin() {
  const [reports, setReports] = useState<ReportView[] | null>(null);
  const [filter, setFilter] = useState<Filter>('open');
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetchReports()
      .then(setReports)
      .catch(() => setMsg('신고 목록을 불러오지 못했어요.'));
  }, []);

  async function act(reportId: string, action: 'resolve' | 'dismiss' | 'ban' | 'unban', label: string) {
    setBusy(true);
    setMsg(null);
    try {
      await handleReport(reportId, action);
      setReports(await fetchReports());
      setMsg(label);
    } catch (e) {
      setMsg(e instanceof ApiError ? e.message : '처리에 실패했어요.');
    } finally {
      setBusy(false);
    }
  }

  if (!reports) return <div className="h-32 animate-pulse rounded-lg bg-surface-muted" />;

  const shown = filter === 'open' ? reports.filter((r) => r.status === 'open') : reports;

  return (
    <div className="space-y-3">
      <Tabs<Filter>
        items={[
          { value: 'open', label: '처리 대기', hint: String(reports.filter((r) => r.status === 'open').length) },
          { value: 'all', label: '전체', hint: String(reports.length) },
        ]}
        value={filter}
        onChange={setFilter}
      />

      {msg && <Badge tone="brand">{msg}</Badge>}

      {shown.length === 0 && <EmptyState icon="🕊️" title="처리할 신고가 없어요" />}

      {shown.map((r) => (
        <Card key={r.id} className="space-y-2">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-sm font-bold">
                {r.target.nickname}
                <span className="ml-1 text-xs font-normal text-muted">
                  {r.target.temperature.toFixed(1)}° · 노쇼 경고 {r.target.warnings}회
                </span>
              </p>
              <p className="text-xs text-muted">
                신고자 {r.reporter.nickname} · {r.context} · {new Date(r.createdAt).toLocaleString('ko-KR')}
              </p>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1">
              {r.target.banned && <Badge tone="danger">이용 정지</Badge>}
              {r.status !== 'open' && <Badge tone="neutral">{r.status === 'resolved' ? '조치함' : '반려'}</Badge>}
              {r.openCountForTarget >= AUTO_RESTRICT_REPORTS && r.status === 'open' && (
                <Badge tone="danger">누적 {r.openCountForTarget}건</Badge>
              )}
            </div>
          </div>

          <p className="rounded-md bg-surface-muted px-3 py-2 text-sm">
            <span className="font-semibold">{r.reason}</span>
            {r.detail && <span className="block text-muted">{r.detail}</span>}
          </p>

          {r.status === 'open' && (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="danger" disabled={busy} onClick={() => act(r.id, 'ban', '이용을 정지했어요.')}>
                이용 정지
              </Button>
              <Button size="sm" variant="secondary" disabled={busy} onClick={() => act(r.id, 'resolve', '조치 완료로 표시했어요.')}>
                조치 완료
              </Button>
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => act(r.id, 'dismiss', '반려했어요.')}>
                반려
              </Button>
            </div>
          )}

          {r.target.banned && (
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => act(r.id, 'unban', '정지를 풀었어요.')}>
              정지 해제 (경고도 초기화)
            </Button>
          )}
        </Card>
      ))}
    </div>
  );
}
