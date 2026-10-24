import { useEffect, useRef } from 'react';
import { BAN_NOTICE_GENERIC } from '../../../shared/lounge';
import type { GatheringView, Profile } from '../../../shared/lounge';
import { Link, useSearchParams, useNavigate } from 'react-router-dom';
import { AppHeader } from '../shell/Shell';
import { Alert, Button, Icon, LoadingBlock, Tabs } from '../ui';
import ChatList from './ChatList';
import { useLounge } from './LoungeContext';
import GatheringListItem from './parts/GatheringListItem';
import { isEnded } from './world/tables';
import { useGatherings } from './world/useGatherings';
import './hub.css';

/**
 * 라운지 첫 화면 (/lounge): 밥약·미팅·회의를 같은 카드와 페이지 탐색으로 제공한다.
 * 모임 탭에서 밥약·미팅·내 약속·팀 회의를 함께 보여 준다.
 * 프로필이 없으면 프로필 만들기를 안내한다(게이트).
 */
export default function LoungePage() {
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') === 'chats' ? 'chats' : 'discover';
  const changeTab = (next: string) => setParams(next === 'discover' ? {} : { tab: next });
  const { profile, needsProfile, loading, error, refresh, openProfileSheet } = useLounge();

  // 프로필이 없으면 들어오자마자 만들기 시트를 한 번 연다. 닫으면 아래 안내가 남는다.
  const asked = useRef(false);
  useEffect(() => {
    if (!loading && !error && needsProfile && !asked.current) {
      asked.current = true;
      openProfileSheet();
    }
  }, [loading, error, needsProfile, openProfileSheet]);

  return (
    <>
      <AppHeader />
      <main id="main" className="app-main">
        <div className="page-head">
          <h1 className="page-title">라운지</h1>
          <p className="page-lead">밥약부터 팀 회의, 함께하는 대화까지.</p>
        </div>
        <Tabs label="라운지 메뉴" value={tab} onChange={changeTab} idBase="lounge" tabs={[{ value: 'discover', label: '모임' }, { value: 'chats', label: '채팅' }]} />
        <div role="tabpanel" id={`lounge-panel-${tab}`} aria-labelledby={`lounge-tab-${tab}`} className="lounge-panel">
        {tab === 'chats' ? <ChatList onExplore={() => changeTab('discover')} /> : <>
        {loading ? (
          <LoadingBlock>라운지를 불러오는 중입니다.</LoadingBlock>
        ) : error ? (
          <Alert
            tone="danger"
            title="라운지 정보를 불러오지 못했습니다."
            actions={
              <Button variant="secondary" onClick={() => void refresh()}>
                다시 시도하기
              </Button>
            }
          >
            {error} 연결을 확인한 뒤 다시 시도해 주세요.
          </Alert>
        ) : needsProfile || profile === null ? (
          <Alert
            tone="primary"
            title="학교 계정을 연동하면 라운지를 쓸 수 있어요"
            actions={
              <Button variant="primary" onClick={openProfileSheet}>
                안내 보기
              </Button>
            }
          >
            이름(가림)·학과·학번은 연동한 학교 계정에서 자동으로 가져와요.
          </Alert>
        ) : (
          <LoungeHome profile={profile} />
        )}
        {(loading || error || needsProfile || profile === null) && <div className="lounge-hub"><MeetingCard /></div>}
        </>}
        </div>
      </main>
    </>
  );
}

function LoungeHome({ profile }: { profile: Profile }) {
  const gatherings = useGatherings(true);
  const navigate = useNavigate();
  const banned = profile.banned;

  const openTable = (g: GatheringView) => navigate(`/lounge/gatherings/${g.id}`, { state: { backTo: '/lounge' } });

  const mine = gatherings.mine.filter((g) => !isEnded(g));

  return (
    <>
      {banned && (
        <Alert tone="danger" title="이용이 정지된 계정이에요">
          {profile.banReason ?? BAN_NOTICE_GENERIC} 정지된 동안에는 밥약·미팅을 이용할 수 없습니다.
        </Alert>
      )}

      <div className="lounge-hub">
        <Link to="/lounge/meal" className="lounge-hub-btn lounge-hub-btn--meal" aria-disabled={banned || undefined}>
          <Icon name="utensils" className="lounge-hub-btn__icon" />
          <span>
            <span className="lounge-hub-btn__title">밥약</span>
            <span className="lounge-hub-btn__sub">지금 가까이 있는 학우와 바로 연결돼요.</span>
          </span>
          <span className="lounge-hub-btn__go">
            <span className="bold">밥 같이 먹기</span>
            <Icon name="chevron-right" />
          </span>
        </Link>

        <Link to="/lounge/meetup" className="lounge-hub-btn lounge-hub-btn--meetup" aria-disabled={banned || undefined}>
          <Icon name="smile" className="lounge-hub-btn__icon" />
          <span>
            <span className="lounge-hub-btn__title">미팅</span>
            <span className="lounge-hub-btn__sub">자리에 앉아 여러 가지 만남에 참여해요.</span>
          </span>
          <span className="lounge-hub-btn__go">
            <span className="bold">미팅 보러 가기</span>
            <Icon name="chevron-right" />
          </span>
        </Link>
        <MeetingCard />
      </div>

      {mine.length > 0 && (
        <section className="section lounge-hub-mine" aria-labelledby="lounge-mine-title">
          <div className="section__head">
            <h2 className="section__title" id="lounge-mine-title">
              내 약속
            </h2>
          </div>
          <ul className="lounge-gathering-list">
            {mine.map((g) => (
              <li key={g.id}>
                <GatheringListItem gathering={g} onOpen={openTable} />
              </li>
            ))}
          </ul>
        </section>
      )}

    </>
  );
}

function MeetingCard() {
  return <Link to="/lounge/meetings" className="lounge-hub-btn lounge-hub-btn--meeting">
    <Icon name="users" className="lounge-hub-btn__icon" />
    <span><span className="lounge-hub-btn__title">회의</span><span className="lounge-hub-btn__sub">팀원의 공강을 맞추고 함께할 공간을 예약해요.</span></span>
    <span className="lounge-hub-btn__go"><span className="bold">회의 보러 가기</span><Icon name="chevron-right" /></span>
  </Link>;
}
