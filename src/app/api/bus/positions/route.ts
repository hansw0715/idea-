/**
 * GET  /api/bus/positions — 지금 달리는 버스 위치 (지도에서 몇 초마다 부름, 공개)
 * POST /api/bus/positions — 위치 보고. 기사 폰(/bus/driver)이나 GPS 트래커가 부른다.
 *
 *   Authorization: Bearer <BUS_DEVICE_TOKEN>
 *   { deviceId, routeId, lat, lng, heading?, speed? }
 *
 * 트래커를 새로 사도 이 형식으로만 보내게 하면 지도 쪽은 안 고쳐도 된다.
 */
import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { livePositions, reportPosition, type PositionInput } from '@/features/bus/service';
import { toErrorResponse } from '../../_lib/respond';

export async function GET() {
  return NextResponse.json({ positions: await livePositions() });
}

/**
 * BUS_DEVICE_TOKEN이 비어 있으면 개발 모드에서만 토큰 없이 받아준다(로컬 시연용).
 * 배포 환경에서 env를 빼먹으면 누구나 가짜 버스를 띄울 수 있으니 그땐 전부 거절한다.
 */
function authorized(req: Request): boolean {
  const expected = process.env.BUS_DEVICE_TOKEN;
  if (!expected) return process.env.NODE_ENV !== 'production';
  const given = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(req: Request) {
  if (!authorized(req)) return toErrorResponse({ code: 'FORBIDDEN', message: '기기 토큰이 올바르지 않습니다.' });
  const body = (await req.json().catch(() => ({}))) as PositionInput;
  const result = await reportPosition(body);
  if (!result.ok) return toErrorResponse(result.error);
  return NextResponse.json({ position: result.value });
}
