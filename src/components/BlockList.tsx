'use client';

/** 내가 차단한 사람 관리. (담당: 한승원) */
import { useEffect, useState } from 'react';
import { Badge, Button, Card, EmptyState } from '@/components/ui';
import { ApiError } from '@/lib/api';
import { fetchBlocked, unblockUser } from '@/lib/meal-api';
import type { PublicUser } from '@/shared/view';

export function BlockList() {
  const [blocked, setBlocked] = useState<PublicUser[] | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetchBlocked()
      .then(setBlocked)
      .catch(() => setMsg('목록을 불러오지 못했어요.'));
  }, []);

  async function unblock(userId: string) {
    setBusy(true);
    setMsg(null);
    try {
      await unblockUser(userId);
      setBlocked(await fetchBlocked());
      setMsg('차단을 해제했어요.');
    } catch (e) {
      setMsg(e instanceof ApiError ? e.message : '해제하지 못했어요.');
    } finally {
      setBusy(false);
    }
  }

  if (!blocked) return <div className="h-24 animate-pulse rounded-lg bg-surface-muted" />;

  return (
    <div className="space-y-3">
      <header>
        <h1 className="text-lg font-bold">차단한 사용자</h1>
        <p className="text-xs text-muted">차단한 사람의 모임과 매칭은 서로에게 보이지 않아요.</p>
      </header>

      {msg && <Badge tone="brand">{msg}</Badge>}

      {blocked.length === 0 ? (
        <EmptyState icon="🙂" title="차단한 사람이 없어요" />
      ) : (
        blocked.map((u) => (
          <Card key={u.id} className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-pill bg-surface-muted text-xs font-bold">
              {u.nickname.slice(0, 1)}
            </span>
            <span className="flex-1 text-sm font-semibold">
              {u.nickname}
              <span className="ml-1 text-xs font-normal text-muted">{u.college}</span>
            </span>
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => unblock(u.id)}>
              차단 해제
            </Button>
          </Card>
        ))
      )}
    </div>
  );
}
