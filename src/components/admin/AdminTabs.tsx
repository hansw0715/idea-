'use client';

/**
 * 관리자 대시보드 탭. 신고 처리·이용 통계는 밥약/미팅 단계에서 채운다. (담당: 한승원)
 */
import { useState } from 'react';
import { EmptyState, Tabs } from '@/components/ui';
import { BusAdmin } from './BusAdmin';

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
      {tab === 'reports' && <EmptyState icon="🚨" title="신고 처리">밥약·미팅 단계에서 추가돼요.</EmptyState>}
      {tab === 'stats' && <EmptyState icon="📊" title="이용 통계">밥약·미팅 단계에서 추가돼요.</EmptyState>}
    </div>
  );
}
