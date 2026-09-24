'use client';

/**
 * 관리자 대시보드 탭. 버스 데이터 · 신고 처리 · 이용 통계. (담당: 한승원)
 */
import { useState } from 'react';
import { Tabs } from '@/components/ui';
import { BusAdmin } from './BusAdmin';
import { ReportsAdmin } from './ReportsAdmin';
import { StatsAdmin } from './StatsAdmin';

type Tab = 'bus' | 'reports' | 'stats';

export function AdminTabs() {
  const [tab, setTab] = useState<Tab>('bus');
  return (
    <div className="space-y-4">
      <Tabs<Tab>
        items={[
          { value: 'bus', label: '🚌 버스' },
          { value: 'reports', label: '🚨 신고' },
          { value: 'stats', label: '📊 통계' },
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === 'bus' && <BusAdmin />}
      {tab === 'reports' && <ReportsAdmin />}
      {tab === 'stats' && <StatsAdmin />}
    </div>
  );
}
