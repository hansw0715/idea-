import { useCallback, useState } from 'react';
import type { GatheringView } from '../../../shared/lounge';
import { AppHeader } from '../shell/Shell';
import { Alert, Button, EmptyState, Icon, LoadingBlock } from '../ui';
import { useLounge } from './LoungeContext';
import GatheringListItem from './parts/GatheringListItem';
import CreateGatheringSheet from './sheets/CreateGatheringSheet';
import TableSheet from './sheets/TableSheet';
import { isEnded } from './world/tables';
import { useGatherings } from './world/useGatherings';
import './hub.css';

/** 미팅 (/lounge/meetup): 열려 있는 미팅 자리 목록 → 눌러서 자리에 앉기, 새 자리 만들기. */
export default function MeetupPage() {
  const { profile, needsProfile, loading, openProfileSheet } = useLounge();
  const ready = !loading && !needsProfile && profile !== null;
  const gatherings = useGatherings(ready);
  const { upsert, refresh } = gatherings;

  const [tableOpen, setTableOpen] = useState(false);
  const [tableArg, setTableArg] = useState<{ id: string | null; initial: GatheringView | null }>({ id: null, initial: null });
  const [createOpen, setCreateOpen] = useState(false);
  const openTable = useCallback((g: GatheringView) => {
    setTableArg({ id: g.id, initial: g });
    setTableOpen(true);
  }, []);

  const meetups = gatherings.all.filter((g) => g.kind === 'meetup' && !isEnded(g));

  return (
    <>
      <AppHeader title="미팅" backTo="/lounge" />
      <main id="main" className="app-main">
        {loading ? (
          <LoadingBlock>불러오는 중입니다.</LoadingBlock>
        ) : needsProfile || profile === null ? (
          <Alert
            tone="primary"
            title="학교 계정을 연동하면 미팅에 참여할 수 있어요"
            actions={
              <Button variant="primary" onClick={openProfileSheet}>
                안내 보기
              </Button>
            }
          >
            이름(가림)·학과·학번은 연동한 학교 계정에서 자동으로 가져와요.
          </Alert>
        ) : (
          <>
            <p className="page-lead lounge-hub-lead">자리에 앉으면 바로 참여돼요.</p>
            <Button variant="primary" size="lg" block disabled={profile.banned} onClick={() => setCreateOpen(true)}>
              <Icon name="plus" className="btn__icon" />
              미팅 자리 만들기
            </Button>

            <section className="section" aria-labelledby="meetup-list-title">
              <div className="section__head">
                <h2 className="section__title" id="meetup-list-title">
                  모집 중인 미팅
                </h2>
              </div>
              {!gatherings.loaded ? (
                <LoadingBlock>미팅을 불러오는 중입니다.</LoadingBlock>
              ) : gatherings.error ? (
                <Alert
                  tone="danger"
                  title="미팅을 불러오지 못했습니다."
                  actions={
                    <Button variant="secondary" onClick={refresh}>
                      다시 시도하기
                    </Button>
                  }
                >
                  {gatherings.error}
                </Alert>
              ) : meetups.length === 0 ? (
                <EmptyState icon="smile" title="아직 열린 미팅이 없어요." description="첫 번째 자리를 만들어 보세요." />
              ) : (
                <ul className="card card--list">
                  {meetups.map((g) => (
                    <li key={g.id}>
                      <GatheringListItem gathering={g} onOpen={openTable} />
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
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
        <CreateGatheringSheet
          open={createOpen}
          kind="meetup"
          onClose={() => setCreateOpen(false)}
          onCreated={(g) => {
            upsert(g);
            refresh();
            setCreateOpen(false);
          }}
        />
      </main>
    </>
  );
}
