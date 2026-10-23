import { useEffect, useState } from 'react';
import { formatMeetAt } from '../../../../shared/lounge';
import type { GatheringView } from '../../../../shared/lounge';
import { api, ApiError } from '../../api';
import { HomeTableRow } from '../../pages/HomeTableRow';
import { loungeApi } from '../api';
import { useLounge } from '../LoungeContext';

/**
 * 홈 표의 "라운지 약속" 한 줄 — 내가 주최·참여·신청한 모임 중 가장 가까운 것과 남은 개수.
 * 홈의 다른 줄과 따로 불러온다(자기 상태만 가진다). 여기가 느리거나 실패해도 예약·회의 줄은 그대로 보인다.
 */

type State =
  | { kind: 'loading' }
  | { kind: 'profile' }
  | { kind: 'error' }
  | { kind: 'ready'; items: GatheringView[] };

/** 끝난 모임 중 내가 아직 평가하지 않은 사람이 남은 것 — 매너온도는 이 평가로 움직이므로 홈에서도 알려 준다 */
function needsReview(g: GatheringView): boolean {
  if (g.status !== 'done' || !g.viewer.canReview) return false;
  return g.slots.some((s) =>
    s.members.some((m) => m.id !== g.viewer.userId && g.myReviews[m.id] === undefined),
  );
}

export default function MyLoungeSection() {
  const { needsProfile, loading: profileLoading, refresh } = useLounge();
  // 지난번에 받은 내 약속이 있으면 먼저 보여 주고, 최신 내용은 아래에서 받아와 바꿔 넣는다
  const [state, setState] = useState<State>(() => {
    const last = api.cached<{ gatherings: GatheringView[] }>('/lounge/mine');
    return last ? { kind: 'ready', items: last.gatherings } : { kind: 'loading' };
  });

  useEffect(() => {
    // 프로필이 없는 사람에게 /mine 을 보내면 428 이 나오므로, 내 라운지 정보가 정해진 뒤에 판단한다
    if (profileLoading) return;
    if (needsProfile) {
      setState({ kind: 'profile' });
      return;
    }
    let cancelled = false;
    setState((s) => (s.kind === 'ready' ? s : { kind: 'loading' }));
    loungeApi
      .mine()
      .then((items) => {
        if (!cancelled) setState({ kind: 'ready', items });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        // 프로필 시트는 홈에서 갑자기 열지 않는다. 안내 문장으로 바꾸고 라운지 정보만 조용히 다시 받는다.
        if (err instanceof ApiError && err.code === 'PROFILE_REQUIRED') {
          setState({ kind: 'profile' });
          void refresh();
          return;
        }
        setState({ kind: 'error' });
      });
    return () => {
      cancelled = true;
    };
  }, [profileLoading, needsProfile, refresh]);

  const upcoming =
    state.kind === 'ready'
      ? state.items
          .filter((g) => g.status !== 'done' && g.status !== 'cancelled')
          .sort((a, b) => a.meetAt.localeCompare(b.meetAt))
      : [];
  const reviewCount = state.kind === 'ready' ? state.items.filter(needsReview).length : 0;
  const first = upcoming[0];

  let preview: string;
  if (state.kind === 'loading') preview = '불러오는 중이에요.';
  else if (state.kind === 'profile') preview = '학교 계정을 연동하면 볼 수 있어요.';
  else if (state.kind === 'error') preview = '불러오지 못했어요. 눌러서 라운지에서 확인해요.';
  else if (first) preview = `${first.title} · ${formatMeetAt(first.meetAt)}`;
  else if (reviewCount > 0) preview = `끝난 약속 ${reviewCount}건에 매너 평가를 남겨요.`;
  else preview = '아직 약속이 없어요.';

  return (
    <HomeTableRow
      to="/lounge"
      label="라운지 약속"
      preview={preview}
      count={upcoming.length + reviewCount}
      countLabel={`약속 ${upcoming.length}건, 평가 남길 약속 ${reviewCount}건`}
    />
  );
}
