/**
 * GET /api/bus — 노선·정류장·시간표 + 오늘 시간표 종류 + 지금 달리는 버스. 로그인 없이 열람 가능.
 */
import { NextResponse } from 'next/server';
import { getSnapshot } from '@/features/bus/service';

export async function GET() {
  return NextResponse.json(await getSnapshot());
}
