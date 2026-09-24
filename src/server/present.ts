/** 도메인 모델 → 화면 DTO 변환에 필요한 사용자 정보를 모아 붙인다. (담당: 한승원) */
import type { Gathering, GatheringKind } from '@/domain/gathering';
import { memberIds } from '@/domain/gathering';
import type { User } from '@/shared/user';
import { toView, type GatheringView } from '@/shared/view';
import { listGatherings, listUsers } from './service';
import { hiddenFor } from './safety-service';

async function userMap(): Promise<Map<string, User>> {
  return new Map((await listUsers()).map((u) => [u.id as string, u]));
}

export async function viewOf(g: Gathering, viewer: User | null): Promise<GatheringView> {
  return toView(g, await userMap(), viewer);
}

/**
 * 목록. 차단한 사람이 끼어 있는 모임은 아예 빼고, 밥약은 "곧 먹을 약속"이 위로 오게 정렬한다.
 * (미팅은 새 글이 위로 — 글이 쌓이는 게시판이라 최신순이 자연스럽다)
 */
export async function viewList(
  kind: GatheringKind | undefined,
  viewer: User | null,
): Promise<GatheringView[]> {
  const [gatherings, users, hidden] = await Promise.all([
    listGatherings(kind),
    userMap(),
    hiddenFor(viewer?.id ?? null),
  ]);
  const now = new Date().toISOString();

  const visible = gatherings.filter(
    (g) => !hidden.has(g.hostId) && !memberIds(g).some((id) => hidden.has(id)),
  );
  const views = visible.map((g) => toView(g, users, viewer, now));
  return kind === 'meal' ? sortMealFeed(views) : views;
}

const ENDED = new Set(['done', 'cancelled']);

/** 아직 남은 약속은 가까운 순으로 위에, 끝난 약속은 아래로 내린다. */
export function sortMealFeed(views: GatheringView[]): GatheringView[] {
  return [...views].sort((a, b) => {
    const aEnded = ENDED.has(a.status);
    const bEnded = ENDED.has(b.status);
    if (aEnded !== bEnded) return aEnded ? 1 : -1;
    return aEnded ? b.meetAt.localeCompare(a.meetAt) : a.meetAt.localeCompare(b.meetAt);
  });
}
