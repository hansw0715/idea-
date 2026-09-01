'use client';

/**
 * 시연용 계정 전환기. (임시 — 진짜 로그인이 붙으면 통째로 지운다)
 *
 * 미팅/밥약은 "주최자 화면"과 "참여자 화면"이 다른데, 발표할 때 노트북 두 대를 켤 순 없다.
 * 이걸로 계정을 바꿔 가며 선착순 착석 → 승인 → 노쇼 처리까지 혼자 보여줄 수 있다.
 */
import { useEffect, useState } from 'react';
import { fetchMe, switchUser } from '@/lib/api';
import type { PublicUser } from '@/shared/view';

export function UserSwitcher() {
  const [me, setMe] = useState<PublicUser | null>(null);
  const [users, setUsers] = useState<PublicUser[]>([]);

  useEffect(() => {
    fetchMe()
      .then(({ me, users }) => {
        setMe(me);
        setUsers(users);
      })
      .catch(() => {});
  }, []);

  async function onChange(userId: string) {
    await switchUser(userId);
    // 서버 컴포넌트와 각 피드가 새 계정 기준으로 다시 그려져야 하므로 통째로 새로고침한다.
    window.location.reload();
  }

  if (!me) return <div className="h-9 w-28 animate-pulse rounded-full bg-surface-muted" />;

  return (
    <label className="flex items-center gap-2 rounded-full border border-border bg-surface-muted px-3 py-1.5">
      <span className="text-[11px] text-muted">계정</span>
      <select
        value={me.id}
        onChange={(e) => onChange(e.target.value)}
        className="bg-transparent text-sm font-semibold outline-none"
      >
        {users.map((u) => (
          <option key={u.id} value={u.id}>
            {u.nickname} ({u.trustScore})
          </option>
        ))}
      </select>
    </label>
  );
}
