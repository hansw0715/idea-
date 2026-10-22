import { useCallback, useEffect, useRef, useState } from 'react';
import { BAN_NOTICE_GENERIC } from '../../../shared/lounge';
import type { GatheringView, Profile } from '../../../shared/lounge';
import { Link } from 'react-router-dom';
import { AppHeader } from '../shell/Shell';
import { Alert, Button, Icon, LoadingBlock } from '../ui';
import { useLounge } from './LoungeContext';
import GatheringListItem from './parts/GatheringListItem';
import QuickMatchSheet from './sheets/QuickMatchSheet';
import TableSheet from './sheets/TableSheet';
import { isEnded } from './world/tables';
import { useGatherings } from './world/useGatherings';
import './hub.css';

/**
 * 라운지 첫 화면 (/lounge): 큰 버튼 두 개 — 위는 밥약(가까운 학우와 바로 연결), 아래는 미팅(자리에 앉아 참여).
 * 프로필이 없으면 프로필 만들기를 안내한다(게이트).
 */
export default function LoungePage() {
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
          <p className="page-lead">같이 밥 먹을 사람, 같이 만날 사람을 찾아요.</p>
        </div>

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
      </main>
    </>
  );
}

function LoungeHome({ profile }: { profile: Profile }) {
  const gatherings = useGatherings(true);
  const { upsert, refresh } = gatherings;
  const banned = profile.banned;

  const [quickOpen, setQuickOpen] = useState(false);
  const [tableOpen, setTableOpen] = useState(false);
  const [tableArg, setTableArg] = useState<{ id: string | null; initial: GatheringView | null }>({ id: null, initial: null });
  const openTable = useCallback((g: GatheringView) => {
    setTableArg({ id: g.id, initial: g });
    setTableOpen(true);
  }, []);

  const mine = gatherings.mine.filter((g) => !isEnded(g));

  return (
    <>
      {banned && (
        <Alert tone="danger" title="이용이 정지된 계정이에요">
          {profile.banReason ?? BAN_NOTICE_GENERIC} 정지된 동안에는 밥약·미팅을 이용할 수 없습니다.
        </Alert>
      )}

      <div className="lounge-hub">
        <button type="button" className="lounge-hub-btn lounge-hub-btn--meal" disabled={banned} onClick={() => setQuickOpen(true)}>
          <Icon name="utensils" className="lounge-hub-btn__icon" />
          <span>
            <span className="lounge-hub-btn__title">밥약</span>
            <span className="lounge-hub-btn__sub">지금 가까이 있는 학우와 바로 연결돼요</span>
          </span>
          <span className="lounge-hub-btn__go">
            <span className="bold">밥 같이 먹기</span>
            <Icon name="chevron-right" />
          </span>
        </button>

        <Link to="/lounge/meetup" className="lounge-hub-btn lounge-hub-btn--meetup" aria-disabled={banned || undefined}>
          <Icon name="smile" className="lounge-hub-btn__icon" />
          <span>
            <span className="lounge-hub-btn__title">미팅</span>
            <span className="lounge-hub-btn__sub">자리에 앉아 2:2 ~ 4:4 미팅에 참여해요</span>
          </span>
          <span className="lounge-hub-btn__go">
            <span className="bold">미팅 보러 가기</span>
            <Icon name="chevron-right" />
          </span>
        </Link>
      </div>

      {mine.length > 0 && (
        <section className="section lounge-hub-mine" aria-labelledby="lounge-mine-title">
          <div className="section__head">
            <h2 className="section__title" id="lounge-mine-title">
              내 약속
            </h2>
          </div>
          <ul className="card card--list">
            {mine.map((g) => (
              <li key={g.id}>
                <GatheringListItem gathering={g} onOpen={openTable} />
              </li>
            ))}
          </ul>
        </section>
      )}

      <TableSheet
        open={tableOpen}
        gatheringId={tableArg.id}
        initial={tableArg.initial}
        focusSlotKey={null}
        onClose={() => setTableOpen(false)}
        onSafetyChanged={refresh}
        onChanged={(g) => {
          upsert(g);
          refresh();
        }}
      />
      <QuickMatchSheet open={quickOpen} onClose={() => setQuickOpen(false)} onConfirmed={() => refresh()} />
    </>
  );
}
