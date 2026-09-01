/** 도메인 모델 → 화면 DTO 변환에 필요한 사용자 정보를 모아 붙인다. (담당: 한승원) */
import type { Gathering, GatheringKind } from '@/domain/gathering';
import type { User } from '@/shared/user';
import { toView, type GatheringView } from '@/shared/view';
import { listGatherings, listUsers } from './service';

async function userMap(): Promise<Map<string, User>> {
  return new Map((await listUsers()).map((u) => [u.id as string, u]));
}

export async function viewOf(g: Gathering, viewer: User | null): Promise<GatheringView> {
  return toView(g, await userMap(), viewer);
}

export async function viewList(
  kind: GatheringKind | undefined,
  viewer: User | null,
): Promise<GatheringView[]> {
  const [gatherings, users] = await Promise.all([listGatherings(kind), userMap()]);
  const now = new Date().toISOString();
  return gatherings.map((g) => toView(g, users, viewer, now));
}
