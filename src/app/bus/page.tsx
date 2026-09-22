import type { Metadata } from 'next';
import { BusView } from '@/components/bus/BusView';

export const metadata: Metadata = { title: '셔틀버스 | 상상BOOK-e' };

/** 로그인 없이 볼 수 있는 페이지. */
export default function BusPage() {
  return <BusView />;
}
