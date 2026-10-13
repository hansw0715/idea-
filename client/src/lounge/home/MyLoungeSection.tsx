import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { formatMeetAt } from '../../../../shared/lounge';
import type { GatheringView } from '../../../../shared/lounge';
import { ApiError } from '../../api';
import { Badge, Button, Icon } from '../../ui';
import { loungeApi } from '../api';
import { useLounge } from '../LoungeContext';

/**
 * 홈 "내 일정" 상자 안의 "내 라운지 약속" 묶음 — 내가 주최·참여·신청한 모임 중 가까운 3건.
 * 홈의 다른 묶음과 따로 불러온다(자기 상태만 가진다). 여기가 느리거나 실패해도 예약·회의는 그대로 보인다.
 * 상자(card)와 묶음 머리글 틀은 홈이 그리고, 스타일은 pages/home.css (접두사 home-sum-, lounge-home-).
 */

/** 홈에 보여 주는 약속의 최대 개수 */
const SHOW = 3;

const STATUS_LABEL: Record<string, { text: string; tone: 'success' | 'info' | 'gray' }> = {
  open: { text: '모집 중', tone: 'success' },
  full: { text: '정원 마감', tone: 'info' },
  closed: { text: '신청 마감', tone: 'gray' },
};

type State =
  | { kind: 'loading' }
  | { kind: 'profile' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; items: GatheringView[] };

/** 끝난 모임 중 내가 아직 평가하지 않은 사람이 남은 것 — 매너온도는 이 평가로 움직이므로 홈에서도 한 줄로 알려 준다 */
function needsReview(g: GatheringView): boolean {
  if (g.status !== 'done' || !g.viewer.canReview) return false;
  return g.slots.some((s) =>
    s.members.some((m) => m.id !== g.viewer.userId && g.myReviews[m.id] === undefined),
  );
}

export default function MyLoungeSection() {
  const { needsProfile, loading: profileLoading, refresh } = useLounge();
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    // 프로필이 없는 사람에게 /mine 을 보내면 428 이 나오므로, 내 라운지 정보가 정해진 뒤에 판단한다
    if (profileLoading) return;
    if (needsProfile) {
      setState({ kind: 'profile' });
      return;
    }
    let cancelled = false;
    setState({ kind: 'loading' });
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
        setState({
          kind: 'error',
          message: err instanceof Error ? err.message : '요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.',
        });
      });
    return () => {
      cancelled = true;
    };
  }, [profileLoading, needsProfile, attempt, refresh]);

  const upcoming =
    state.kind === 'ready'
      ? state.items
          .filter((g) => g.status !== 'done' && g.status !== 'cancelled')
          .sort((a, b) => a.meetAt.localeCompare(b.meetAt))
      : [];
  const reviewCount = state.kind === 'ready' ? state.items.filter(needsReview).length : 0;

  let body;
  if (state.kind === 'loading') {
    body = <p className="home-sum__empty">불러오는 중이에요.</p>;
  } else if (state.kind === 'profile') {
    body = (
      <p className="home-sum__empty">
        라운지에서 학교 계정을 연동하면 약속을 볼 수 있어요. <Link to="/lounge">라운지 가기</Link>
      </p>
    );
  } else if (state.kind === 'error') {
    body = (
      <div className="home-sum__error">
        <p>{state.message}</p>
        <Button variant="secondary" size="sm" onClick={() => setAttempt((n) => n + 1)}>
          다시 시도하기
        </Button>
      </div>
    );
  } else if (upcoming.length === 0 && reviewCount === 0) {
    body = <p className="home-sum__empty">아직 약속이 없어요.</p>;
  } else {
    body = (
      <>
        {upcoming.length > 0 && (
          <ul className="list home-ul">
            {upcoming.slice(0, SHOW).map((g) => (
              <li key={g.id}>
                <GatheringRow gathering={g} />
              </li>
            ))}
          </ul>
        )}
        {upcoming.length > SHOW && (
          <p className="home-sum__more">약속 {upcoming.length}건 중 가까운 {SHOW}건을 표시했어요.</p>
        )}
        {reviewCount > 0 && (
          <p className="home-sum__more">끝난 약속 {reviewCount}건에 매너 평가를 남길 수 있어요.</p>
        )}
      </>
    );
  }

  return (
    <section className="home-sum__group" aria-labelledby="home-lounge-title">
      <div className="home-sum__head">
        <h3 className="home-sum__title" id="home-lounge-title">
          내 라운지 약속
        </h3>
        <Link to="/lounge" className="home-sum__link">
          라운지에서 보기
        </Link>
      </div>
      {body}
    </section>
  );
}

/** 약속 한 줄: 눌러서 라운지로 간다 (자리 확인·취소는 라운지에서). 두 줄 + 오른쪽 상태 배지 */
function GatheringRow({ gathering: g }: { gathering: GatheringView }) {
  const status = STATUS_LABEL[g.status];
  const role = g.viewer.isHost ? '주최' : g.viewer.isApplicant ? '승인 대기' : '참여';
  return (
    <Link to="/lounge" className="list__item list__item--link">
      <Icon name={g.kind === 'meal' ? 'utensils' : 'users'} className="lounge-home-kind" />
      <div className="list__body">
        <div className="list__main">{g.title}</div>
        <div className="list__sub tabular">
          {role} · {formatMeetAt(g.meetAt)} · {g.place}
        </div>
        {g.viewer.timetableConflict && (
          <div className="lounge-home-badges">
            <Badge tone="warning">수업과 겹쳐요: {g.viewer.timetableConflict}</Badge>
          </div>
        )}
      </div>
      <Badge tone={g.viewer.isApplicant ? 'warning' : (status?.tone ?? 'primary')}>
        {g.viewer.isApplicant ? '승인 대기' : (status?.text ?? '진행 중')}
      </Badge>
      <Icon name="chevron-right" className="list__chev" />
    </Link>
  );
}
