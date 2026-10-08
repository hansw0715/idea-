import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { formatMeetAt } from '../../../../shared/lounge';
import type { GatheringView } from '../../../../shared/lounge';
import { ApiError } from '../../api';
import { Alert, Badge, Button, EmptyState, Icon, LoadingBlock, btnClass } from '../../ui';
import { loungeApi } from '../api';
import { useLounge } from '../LoungeContext';

/**
 * 홈의 "내 라운지 약속" 구역 — 내가 주최·참여·신청한 모임 중 가까운 3건.
 * 홈의 다른 구역과 따로 불러온다(자기 상태만 가진다). 여기가 느리거나 실패해도 예약·회의·시간표는 그대로 보인다.
 * 스타일: pages/home.css (접두사 lounge-home-, 목록 틀은 홈의 home-card--rows / home-ul 을 같이 쓴다)
 */

/** 홈에 보여 주는 약속의 최대 개수 */
const SHOW = 3;

const KIND_LABEL: Record<string, string> = { meetup: '미팅', meal: '밥약', team: '팀빌딩' };
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
    body = (
      <div className="card">
        <LoadingBlock>라운지 약속을 불러오는 중이에요.</LoadingBlock>
      </div>
    );
  } else if (state.kind === 'profile') {
    body = (
      <div className="card">
        <EmptyState
          icon="lounge"
          title="라운지 프로필을 만들면 약속을 볼 수 있어요."
          description="닉네임과 아바타를 정하면 라운지에서 미팅과 밥약에 참여할 수 있어요."
          action={
            <Link to="/lounge" className={btnClass({ variant: 'secondary' })}>
              라운지 가기
            </Link>
          }
        />
      </div>
    );
  } else if (state.kind === 'error') {
    body = (
      <Alert
        tone="danger"
        title="라운지 약속을 불러오지 못했어요."
        actions={
          <Button variant="secondary" onClick={() => setAttempt((n) => n + 1)}>
            다시 시도하기
          </Button>
        }
      >
        {state.message}
      </Alert>
    );
  } else if (upcoming.length === 0 && reviewCount === 0) {
    body = (
      <div className="card">
        <EmptyState
          icon="lounge"
          title="아직 약속이 없어요."
          description="라운지에서 미팅이나 밥약을 찾아 자리에 앉아 보세요."
          action={
            <Link to="/lounge" className={btnClass({ variant: 'secondary' })}>
              라운지 가기
            </Link>
          }
        />
      </div>
    );
  } else {
    body = (
      <>
        {upcoming.length > 0 && (
          <div className="card home-card--rows">
            <ul className="list home-ul">
              {upcoming.slice(0, SHOW).map((g) => (
                <li key={g.id}>
                  <GatheringRow gathering={g} />
                </li>
              ))}
            </ul>
          </div>
        )}
        {upcoming.length > SHOW && (
          <p className="home-more">
            약속 {upcoming.length}건 중 가까운 {SHOW}건을 표시했어요. 나머지는 라운지에서 볼 수 있어요.
          </p>
        )}
        {reviewCount > 0 && (
          <p className="home-more">
            끝난 약속 {reviewCount}건에 함께한 사람의 매너 평가를 남길 수 있어요. 라운지의 내 약속에서 확인해 주세요.
          </p>
        )}
      </>
    );
  }

  return (
    <section className="section" aria-labelledby="home-lounge-title">
      <div className="section__head">
        <h2 className="section__title" id="home-lounge-title">
          내 라운지 약속
        </h2>
        <Link to="/lounge" className={btnClass({ variant: 'text' })}>
          라운지에서 보기
        </Link>
      </div>
      {body}
    </section>
  );
}

/** 약속 한 줄: 눌러서 라운지로 간다 (자리 확인·취소는 라운지에서) */
function GatheringRow({ gathering: g }: { gathering: GatheringView }) {
  const status = STATUS_LABEL[g.status];
  const role = g.viewer.isHost ? '주최' : g.viewer.isApplicant ? '승인 대기' : '참여';
  return (
    <Link to="/lounge" className="list__item list__item--link">
      <Icon name={g.kind === 'meal' ? 'utensils' : 'users'} className="lounge-home-kind" />
      <div className="list__body">
        <div className="list__main">{g.title}</div>
        <div className="list__sub tabular">
          {formatMeetAt(g.meetAt)} · {g.place}
        </div>
        <div className="lounge-home-badges">
          <Badge tone="gray">{KIND_LABEL[g.kind] ?? '모임'}</Badge>
          <Badge tone={g.viewer.isApplicant ? 'warning' : 'primary'}>{role}</Badge>
          {status && <Badge tone={status.tone}>{status.text}</Badge>}
          {g.viewer.timetableConflict && <Badge tone="warning">수업과 겹쳐요: {g.viewer.timetableConflict}</Badge>}
        </div>
      </div>
      <Icon name="chevron-right" className="list__chev" />
    </Link>
  );
}
