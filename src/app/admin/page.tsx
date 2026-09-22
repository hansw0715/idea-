import type { Metadata } from 'next';
import { AdminTabs } from '@/components/admin/AdminTabs';
import { EmptyState } from '@/components/ui';
import { isAdmin } from '@/shared/user';
import { currentUser } from '@/server/session';

export const metadata: Metadata = { title: '관리자 | 상상BOOK-e' };

/** 화면은 여기서 한 번 막고, 실제 쓰기 권한은 /api/admin/* 에서 다시 검사한다. */
export default async function AdminPage() {
  const me = await currentUser();
  if (!isAdmin(me)) {
    return <EmptyState icon="🔒" title="관리자만 볼 수 있어요">관리자 계정으로 전환해 주세요.</EmptyState>;
  }
  return (
    <div className="space-y-3">
      <h1 className="text-lg font-bold">관리자</h1>
      <AdminTabs />
    </div>
  );
}
