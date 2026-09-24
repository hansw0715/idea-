import type { Metadata } from 'next';
import { BlockList } from '@/components/BlockList';

export const metadata: Metadata = { title: '차단 목록 | 상상BOOK-e' };

export default function BlocksPage() {
  return <BlockList />;
}
