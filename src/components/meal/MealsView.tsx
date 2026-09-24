'use client';

/** 밥약 화면. 모집글 피드와 빠른 매칭을 탭으로 나눈다. (담당: 한승원) */
import { useState } from 'react';
import { Tabs } from '@/components/ui';
import { GatheringFeed } from '@/components/GatheringFeed';
import { QuickMatchPanel } from './QuickMatchPanel';

type Tab = 'feed' | 'quick';

export function MealsView() {
  const [tab, setTab] = useState<Tab>('feed');
  // 빠른 매칭이 확정되면 새 밥약이 생기므로 목록을 다시 불러온다.
  const [reloadToken, setReloadToken] = useState(0);

  return (
    <section className="space-y-3">
      <header>
        <h2 className="text-lg font-bold">밥약</h2>
        <p className="text-xs text-muted">혼밥하기 싫은 한 끼, 같이 먹을 사람을 찾아요.</p>
      </header>

      <Tabs<Tab>
        items={[
          { value: 'feed', label: '📋 모집글' },
          { value: 'quick', label: '⚡ 빠른 매칭' },
        ]}
        value={tab}
        onChange={setTab}
      />

      {tab === 'quick' && (
        <QuickMatchPanel
          onConfirmed={() => {
            setReloadToken((n) => n + 1);
            setTab('feed');
          }}
        />
      )}

      {tab === 'feed' && (
        <GatheringFeed
          kind="meal"
          newHref="/meals/new"
          ctaLabel="밥약 만들기"
          emptyText="열린 밥약이 없어요. 직접 방을 만들어 보세요!"
          reloadToken={reloadToken}
        />
      )}
    </section>
  );
}
