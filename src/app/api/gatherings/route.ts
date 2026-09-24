/**
 * GET  /api/gatherings?kind=meetup|meal|team  — 목록
 * POST /api/gatherings                         — 모임 만들기
 *
 * 라우트 네임스페이스 약속 (머지 충돌 방지):
 *   /api/gatherings/*  → 미팅·밥약·팀빌딩 공통 (담당: 한승원)
 *   /api/facilities/*  → 시설 예약        (담당: 친구)
 *   /api/admin/*       → 관리자 대시보드   (담당: 친구)
 */
import { NextResponse } from 'next/server';
import type { GatheringKind, GatheringMeta, SlotSpec } from '@/domain/gathering';
import { createGathering } from '@/server/service';
import { viewList, viewOf } from '@/server/present';
import { currentUser } from '@/server/session';
import { toErrorResponse } from '../_lib/respond';

export async function GET(req: Request) {
  const kindParam = new URL(req.url).searchParams.get('kind');
  const kind = (kindParam ?? undefined) as GatheringKind | undefined;
  const viewer = await currentUser();
  return NextResponse.json({ gatherings: await viewList(kind, viewer) });
}

type CreateBody = {
  kind: GatheringKind;
  title: string;
  body: string;
  place: string;
  meetAt: string;
  joinDeadline: string;
  joinPolicy: 'auto' | 'approval';
  slots: SlotSpec[];
  meta?: GatheringMeta;
};

export async function POST(req: Request) {
  const viewer = await currentUser();
  if (!viewer) return toErrorResponse({ code: 'FORBIDDEN', message: '로그인이 필요합니다.' });

  const body = (await req.json()) as CreateBody;
  const result = await createGathering(viewer.id, body);
  if (!result.ok) return toErrorResponse(result.error);

  return NextResponse.json({ gathering: await viewOf(result.value, viewer) }, { status: 201 });
}
