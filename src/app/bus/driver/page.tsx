import type { Metadata } from 'next';
import { DriverConsole } from '@/components/bus/DriverConsole';

export const metadata: Metadata = { title: '버스 위치 보내기 | 상상BOOK-e' };

export default function DriverPage() {
  return <DriverConsole />;
}
