'use client';

/** 미팅/밥약 공용 피드. 카드 하나가 바뀌면 그 카드만 갈아끼운다. (담당: 한승원) */
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { fetchGatherings } from '@/lib/api';
import type { GatheringView } from '@/shared/view';
import type { GatheringKind } from '@/domain/gathering';
import { GatheringCard } from './GatheringCard';

type Props = {
  kind: GatheringKind;
  newHref: string;
  ctaLabel: string;
  emptyText: string;
  /** 값이 바뀌면 목록을 다시 불러온다 (빠른 매칭 확정 등) */
  reloadToken?: number;
};

export function GatheringFeed({ kind, newHref, ctaLabel, emptyText, reloadToken = 0 }: Props) {
  const [items, setItems] = useState<GatheringView[] | null>(null);

  useEffect(() => {
    fetchGatherings(kind).then(setItems).catch(() => setItems([]));
  }, [kind, reloadToken]);

  const replace = useCallback((next: GatheringView) => {
    setItems((prev) => prev?.map((g) => (g.id === next.id ? next : g)) ?? prev);
  }, []);

  return (
    <div className="space-y-3">
      <Link
        href={newHref}
        className="flex w-full items-center justify-center gap-1.5 rounded-2xl border border-dashed border-brand bg-brand-soft py-3 text-sm font-bold text-brand"
      >
        ✏️ {ctaLabel}
      </Link>

      {items === null && <SkeletonList />}

      {items?.length === 0 && (
        <p className="rounded-2xl border border-border bg-surface p-6 text-center text-sm text-muted">
          {emptyText}
        </p>
      )}

      {items?.map((g) => (
        <GatheringCard key={g.id} gathering={g} onChange={replace} />
      ))}
    </div>
  );
}

const SkeletonList = () => (
  <div className="space-y-3">
    {[0, 1].map((i) => (
      <div key={i} className="h-48 animate-pulse rounded-2xl bg-surface" />
    ))}
  </div>
);
