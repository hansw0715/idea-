import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BAN_NOTICE_GENERIC, EMOTES } from '../../../shared/lounge';
import type { EmoteKey, GatheringView, Profile } from '../../../shared/lounge';
import { AppHeader } from '../shell/Shell';
import { Alert, Button, Icon, LoadingBlock, Tabs, useToast } from '../ui';
import { useLounge } from './LoungeContext';
import CreateGatheringSheet from './sheets/CreateGatheringSheet';
import QuickMatchSheet from './sheets/QuickMatchSheet';
import TableSheet from './sheets/TableSheet';
import UserSheet from './sheets/UserSheet';
import EmoteBar from './world/EmoteBar';
import ListMode from './world/ListMode';
import World from './world/World';
import ZoneBoardSheet from './world/ZoneBoardSheet';
import { isEnded, pickTables, seatedMap } from './world/tables';
import type { TableKind } from './world/tables';
import { useGatherings } from './world/useGatherings';
import { usePresence } from './world/usePresence';
import './world/world.css';

type ViewMode = 'map' | 'list';
const VIEW_KEY = 'sangsang-lounge-view';

/** 마지막으로 고른 보기 방식. 저장소를 못 써도(시크릿 모드 등) 지도로 시작할 뿐 동작은 같다. */
function readMode(): ViewMode {
  try {
    return localStorage.getItem(VIEW_KEY) === 'list' ? 'list' : 'map';
  } catch {
    return 'map';
  }
}

/**
 * 라운지 메인 화면 (/lounge): 지도(월드) · 목록 전환, 접속자·테이블·구역.
 * 프로필이 없으면 지도·접속자 호출을 하지 않고 프로필 만들기를 안내한다(게이트).
 * 규칙: docs/lounge/00-overview.md, docs/lounge/01-contract.md, docs/UI-KIT.md
 */
export default function LoungePage() {
  const { profile, needsProfile, loading, error, refresh, openProfileSheet } = useLounge();
  const active = !loading && !error && !needsProfile && profile !== null;

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
      <main id="main" className={`app-main${active ? ' lounge-world-page' : ''}`}>
        <div className="page-head">
          <h1 className="page-title">라운지</h1>
          <p className="page-lead">같은 시간에 접속한 학우를 만나고, 미팅·밥약 자리에 앉아 보세요.</p>
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
            title="프로필을 만들면 라운지에 들어올 수 있어요"
            actions={
              <Button variant="primary" onClick={openProfileSheet}>
                프로필 만들기
              </Button>
            }
          >
            닉네임과 아바타만 정하면 됩니다. 실명은 다른 학우에게 보이지 않습니다.
          </Alert>
        ) : (
          <LoungeActive profile={profile} />
        )}
      </main>
    </>
  );
}

/** 프로필이 있는 사용자의 라운지. 이 컴포넌트가 떠 있는 동안에만 폴링·하트비트가 돈다. */
function LoungeActive({ profile }: { profile: Profile }) {
  const toast = useToast();
  const [mode, setModeState] = useState<ViewMode>(readMode);

  const presence = usePresence({ enabled: true, canMove: !profile.banned, userId: profile.id });
  const gatherings = useGatherings(true);
  const { sendEmote, refresh: refreshPresence } = presence;
  const { upsert, refresh: refreshGatherings } = gatherings;

  // 정지 상태: 프로필이 정지로 내려오거나, 위치를 보낼 때 서버가 정지로 거절한 경우
  const banned = profile.banned || presence.banMessage !== null;
  const banText = profile.banReason ?? presence.banMessage ?? BAN_NOTICE_GENERIC;

  // ── 시트 조정: 시트마다 열림 여부와 마지막 인자를 따로 들고 있다 (닫는 애니메이션 동안 내용 유지) ──
  const [tableOpen, setTableOpen] = useState(false);
  const [tableArg, setTableArg] = useState<{ id: string | null; initial: GatheringView | null; focus: string | null }>({
    id: null,
    initial: null,
    focus: null,
  });
  const [createOpen, setCreateOpen] = useState(false);
  const [createKind, setCreateKind] = useState<TableKind>('meetup');
  const [userOpen, setUserOpen] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [quickOpen, setQuickOpen] = useState(false);
  const [boardOpen, setBoardOpen] = useState(false);
  const [boardZone, setBoardZone] = useState<TableKind>('meetup');

  const openTable = useCallback((g: GatheringView, slotKey?: string) => {
    setTableArg({ id: g.id, initial: g, focus: slotKey ?? null });
    setTableOpen(true);
  }, []);
  const openUser = useCallback((id: string) => {
    setUserId(id);
    setUserOpen(true);
  }, []);
  const openZone = useCallback((zone: TableKind) => {
    setBoardZone(zone);
    setBoardOpen(true);
  }, []);
  const openCreate = useCallback((kind: TableKind) => {
    setCreateKind(kind);
    setCreateOpen(true);
  }, []);
  const openQuick = useCallback(() => setQuickOpen(true), []);
  /** 차단·신고가 있었다: 접속자와 모임을 곧바로 다시 읽어 사라져야 할 사람·테이블이 바로 사라지게 한다 */
  const onSafety = useCallback(() => {
    refreshPresence();
    refreshGatherings();
  }, [refreshPresence, refreshGatherings]);

  const setMode = (next: ViewMode) => {
    setModeState(next);
    try {
      localStorage.setItem(VIEW_KEY, next);
    } catch {
      /* 저장하지 못해도 이번 방문 동안은 그대로 동작한다 */
    }
  };

  // ── 지도에 그릴 것 ──
  const picked = useMemo(() => pickTables(gatherings.all), [gatherings.all]);
  const seated = useMemo(() => seatedMap(picked), [picked]);
  const boardCounts = useMemo(
    () => ({
      meetup: gatherings.all.filter((g) => g.kind === 'meetup' && !isEnded(g)).length,
      meal: gatherings.all.filter((g) => g.kind === 'meal' && !isEnded(g)).length,
    }),
    [gatherings.all],
  );
  const mySeat = seated.get(profile.id);

  const onEmote = useCallback(
    async (key: EmoteKey) => {
      const result = await sendEmote(key);
      const label = EMOTES.find((e) => e.key === key)?.label ?? '';
      if (result === 'rate') toast('이모트를 너무 자주 보내고 있습니다. 잠시 뒤에 다시 눌러 주세요.');
      else if (result === 'error') toast('이모트를 보내지 못했습니다. 연결을 확인한 뒤 다시 눌러 주세요.');
      else if (result === 'ok') toast(`${label} 이모트를 보냈습니다.`);
    },
    [sendEmote, toast],
  );

  const onSeatedTap = useCallback(
    () => toast('테이블에 앉아 있는 동안에는 지도에서 걷지 않습니다. 자리에서 나가면 다시 돌아다닐 수 있습니다.'),
    [toast],
  );

  const open = [tableOpen && 'table', createOpen && 'create', userOpen && 'user', quickOpen && 'quick', boardOpen && 'board']
    .filter(Boolean)
    .join(',');

  return (
    <div data-open-sheets={open || undefined}>
      {banned && (
        <Alert tone="danger" title="이용이 정지된 계정이에요" className="lounge-world-ban">
          {banText} 정지된 동안에는 지도에서 걷거나 자리를 만들 수 없습니다.
        </Alert>
      )}

      <Tabs
        label="라운지 보기 방식"
        value={mode}
        onChange={setMode}
        idBase="lounge-view"
        tabs={[
          { value: 'map', label: '지도' },
          { value: 'list', label: '목록' },
        ]}
      />

      <div className="lounge-world-status">
        {/* 접속자 수는 다른 사람이 들어오고 나갈 때 바뀌므로 조용히(polite) 읽힌다 */}
        <span className="lounge-world-chip" role="status" aria-live="polite">
          <span className="lounge-world-chip__dot" aria-hidden="true" />
          {presence.count === null ? '접속자를 확인하는 중' : `지금 ${presence.count}명 접속 중`}
        </span>
        {presence.stale && (
          <p className="lounge-world-note" role="status">
            <Icon name="alert" className="lounge-world-note__icon" />
            접속자 정보를 새로 받지 못하고 있습니다. 마지막으로 받은 모습을 보여 드립니다.
          </p>
        )}
        {mode === 'map' && mySeat && (
          <p className="lounge-world-note" role="status">
            <Icon name="chair" className="lounge-world-note__icon" />
            ‘{mySeat.title}’ 테이블에 앉아 있습니다.
          </p>
        )}
      </div>

      {/* 이모트 바는 지도의 아바타 수백 개보다 먼저 Tab 으로 닿도록 DOM 순서를 앞에 둔다 (화면에서는 아래에 고정) */}
      <EmoteBar active={presence.myEmote} disabled={banned} onSend={onEmote} />

      <div role="tabpanel" id={`lounge-view-panel-${mode}`} aria-labelledby={`lounge-view-tab-${mode}`}>
        {mode === 'map' ? (
          <World
            meId={profile.id}
            meAvatar={profile}
            place={presence.me}
            myEmote={presence.myEmote}
            others={presence.users}
            picked={picked}
            loaded={gatherings.loaded}
            boardCounts={boardCounts}
            seated={seated}
            disabled={banned}
            hint="빈 바닥을 누르면 내 아바타가 걸어갑니다. 테이블이나 의자를 누르면 자리를 볼 수 있습니다. 키보드로 쓰려면 ‘목록’ 을 선택해 주세요."
            onMove={presence.moveTo}
            onSeatedTap={onSeatedTap}
            onOpenTable={openTable}
            onOpenZone={openZone}
            onCreate={openCreate}
            onQuick={openQuick}
            onOpenUser={openUser}
          />
        ) : (
          <ListMode
            users={presence.users}
            all={gatherings.all}
            mine={gatherings.mine}
            loaded={gatherings.loaded}
            error={gatherings.error}
            stale={gatherings.stale}
            disabled={banned}
            onRetry={refreshGatherings}
            onOpenGathering={(g) => openTable(g)}
            onOpenUser={openUser}
            onCreate={openCreate}
            onQuick={openQuick}
          />
        )}
      </div>

      {/* 구역 게시판 위에 테이블·만들기 시트가 겹쳐 열려도 닫으면 게시판으로 돌아온다 (시트는 한 겹씩 닫힌다) */}
      <ZoneBoardSheet
        open={boardOpen}
        zone={boardZone}
        gatherings={gatherings.all}
        loaded={gatherings.loaded}
        error={gatherings.error}
        disabled={banned}
        onRetry={refreshGatherings}
        onOpenGathering={(g) => openTable(g)}
        onCreate={openCreate}
        onClose={() => setBoardOpen(false)}
      />
      <TableSheet
        open={tableOpen}
        gatheringId={tableArg.id}
        initial={tableArg.initial}
        focusSlotKey={tableArg.focus}
        onClose={() => setTableOpen(false)}
        onSafetyChanged={onSafety}
        onChanged={(g) => {
          // 시트가 알려 준 최신 모습으로 지도·목록을 먼저 고치고, 서버에서도 곧바로 다시 읽는다
          upsert(g);
          refreshGatherings();
        }}
      />
      <CreateGatheringSheet
        open={createOpen}
        kind={createKind}
        onClose={() => setCreateOpen(false)}
        onCreated={(g) => {
          upsert(g);
          refreshGatherings();
          setCreateOpen(false);
          setBoardOpen(false);
        }}
      />
      <UserSheet
        open={userOpen}
        userId={userId}
        context="profile"
        onClose={() => setUserOpen(false)}
        onSafetyChanged={onSafety}
      />
      <QuickMatchSheet
        open={quickOpen}
        onClose={() => setQuickOpen(false)}
        onConfirmed={() => refreshGatherings()}
      />
    </div>
  );
}
