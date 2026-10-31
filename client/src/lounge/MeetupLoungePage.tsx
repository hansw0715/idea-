import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { BAN_NOTICE_GENERIC, PRESENCE_POLL_MS } from '../../../shared/lounge';
import type { GatheringView, PresenceResponse, PublicUser } from '../../../shared/lounge';
import { api } from '../api';
import { AppHeader } from '../shell/Shell';
import { Alert, Button, Icon, Sheet, useToast } from '../ui';
import type { IconName } from '../ui';
import { loungeApi } from './api';
import ChatList from './ChatList';
import { useLounge } from './LoungeContext';
import CreateGatheringSheet from './sheets/CreateGatheringSheet';
import QuickMatchSheet, { prefetchQuickState } from './sheets/QuickMatchSheet';
import TableSheet from './sheets/TableSheet';
import { isEnded } from './world/tables';
import { useGatherings } from './world/useGatherings';
import { seatCount, shortMeetAt } from './parts/GatheringListItem';
import IsoLounge from './meetup/IsoLounge';
import type { IsoLoungeHandle, LoungeMeeting, LoungePerson } from './meetup/IsoLounge';
import type { Meeting } from '../types';
import './meetup/lounge3d.css';

/** 약속 시간이 이만큼 지난 모임은 라운지에서 치운다 */
const ENDED_AFTER_MS = 2 * 60 * 60 * 1000;
/** 접속 알림(하트비트)·접속자 수 읽기 간격. 서버는 45초 안에 소식이 있으면 접속 중으로 센다. */
// 접속 인원은 실시간: 3초마다 다시 읽고, 10초마다 내가 있다고 알린다. 나가면 바로 빠진다.
const HEARTBEAT_MS = 10_000;
const PRESENCE_READ_MS = PRESENCE_POLL_MS;

/**
 * 라운지 (/lounge, 하단 탭 '라운지') — 메타버스처럼 떠 있는 아이소메트릭 방. 밥약·회의·미팅·채팅방을 모두 여기서 연다.
 *  - 모임 하나가 자리 하나다: 미팅은 긴 탁자(1:1·2:2 는 소파), 밥약은 나무 탁자, 내 팀 회의는 큰 회의 탁자. 앉은 사람은 자리 위에 얼굴로 떠 있다.
 *  - 자리나 빈 의자를 누르면 방을 떠나지 않고 그 모임 창이 열려 바로 참여한다.
 *  - 약속 시간이 2시간 지난 모임은 사라진다.
 *  - 개인 화면: 위에 라운지 이름·접속 인원·내 모임, 그 아래 방(내 자리를 확대해 보여 준다).
 *    방 오른쪽 아래 + 를 누르면 밥약·회의·미팅이 위로 펼쳐진다 (채팅방은 머리의 말풍선 버튼). 지금 들어와 있는 사람들은 방 바닥에 서 있다.
 *  - 학교 계정을 아직 연동하지 않았으면 연동 안내만 보여 준다.
 */
export default function MeetupLoungePage() {
  const { profile, needsProfile, loading, error, refresh, openProfileSheet } = useLounge();

  // 프로필이 없으면 들어오자마자 만들기 시트를 한 번 연다. 닫으면 아래 안내가 남는다.
  const asked = useRef(false);
  useEffect(() => {
    if (!loading && !error && needsProfile && !asked.current) {
      asked.current = true;
      openProfileSheet();
    }
  }, [loading, error, needsProfile, openProfileSheet]);

  // 내 정보를 아직 못 받았어도 빈 방부터 바로 보여 준다
  if (loading) {
    return (
      <>
      <AppHeader />
      <main id="main" className="lounge-me">
        <LoungeHead online={null} />
        <div className="lounge-me__map">
          <IsoLounge gatherings={[]} mineId="" onOpen={() => undefined} fill />
        </div>
      </main>
      </>
    );
  }
  if (error || needsProfile || !profile) {
    return (
      <>
        <AppHeader title="라운지" />
        <main id="main" className="app-main">
          {error ? (
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
          ) : (
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
          )}
        </main>
      </>
    );
  }
  return <MeetupLounge me={profile} banned={profile.banned} banReason={profile.banReason} />;
}

/** 옆 탭에서 밀어 넘어올 때 잠깐 보이는 자리 (라운지는 화면을 고정해 쓰므로 여기서는 바탕만) */
export function LoungePeek() {
  return <div className="iso-peek" aria-hidden="true" />;
}

/** 방 위 왼쪽: 접속 인원 (라운지 이름은 화면 낭독용으로만), 오른쪽: 채팅방 */
function LoungeHead({ online, onChats }: { online: number | null; onChats?: () => void }) {
  return (
    <div className="lounge-me__head">
      <div className="lounge-me__title">
        <h1 className="sr-only">상상 라운지</h1>
        <p className="lounge-me__online" role="status">
          <span className="lounge-me__dot" aria-hidden="true" />
          <span className="tabular">{online === null ? '접속 인원 확인 중' : `${online}명 접속 중`}</span>
        </p>
      </div>
      {onChats && (
        <button type="button" className="lounge-me__icon" aria-label="채팅방" onClick={onChats}>
          <Icon name="message" />
        </button>
      )}
    </div>
  );
}

/** 라운지에 있다고 서버에 알리고(20초마다), 접속자 수와 접속한 사람들을 읽는다(10초마다). 화면이 가려지면 멈춘다. */
function useOnline(enabled: boolean): { presence: PresenceResponse | null; seeking: boolean } {
  const [state, setState] = useState<PresenceResponse | null>(() => api.cached<PresenceResponse>('/lounge/presence') ?? null);
  const [seeking, setSeeking] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    // 밥약을 찾는 중이면 'meal' 구역으로 알린다 → 다른 사람 화면에서 내 머리 위에 '같이 밥 먹을 사람!'이 뜬다
    const beat = () =>
      loungeApi
        .quick()
        .then((q) => q.request?.status === 'waiting')
        .catch(() => false)
        .then((seeking) => {
          setSeeking(seeking);
          return loungeApi.sendPresence({ x: 0.5, y: 0.5, zone: seeking ? 'meal' : 'meetup' });
        })
        .catch(() => undefined);
    const read = () =>
      loungeApi
        .presence()
        .then((r) => {
          if (alive) setState(r);
        })
        .catch(() => undefined);
    const tick = (fn: () => unknown) => () => {
      if (document.visibilityState === 'visible') void fn();
    };
    void beat().then(read);
    const hb = window.setInterval(tick(beat), HEARTBEAT_MS);
    const rd = window.setInterval(tick(read), PRESENCE_READ_MS);
    // 앱을 내리거나 닫으면 바로 나간 것으로, 다시 열면 바로 들어온 것으로
    const onVisible = () => {
      if (document.visibilityState === 'visible') void beat().then(read);
      else loungeApi.leavePresence();
    };
    const onLeave = () => loungeApi.leavePresence();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('pagehide', onLeave);
    return () => {
      alive = false;
      window.clearInterval(hb);
      window.clearInterval(rd);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('pagehide', onLeave);
      // 다른 탭으로 옮기면 라운지에서 나간 것
      loungeApi.leavePresence();
    };
  }, [enabled]);
  return { presence: state, seeking };
}

type Action = 'meal' | 'meeting' | 'meetup';
const ACTIONS: { key: Action; label: string; icon: IconName }[] = [
  { key: 'meal', label: '밥약', icon: 'utensils' },
  { key: 'meeting', label: '회의', icon: 'users' },
  { key: 'meetup', label: '미팅', icon: 'smile' },
];

/** 방 오른쪽 아래 작은 + 버튼. 누르면 위로 밥약·회의·미팅이 펼쳐진다. 모임은 모두 여기서 만든다. (채팅방은 머리의 말풍선 버튼) */
function CreateDial({ onPick }: { onPick: (a: Action) => void }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  return (
    <div ref={rootRef} className={`iso-dial${open ? ' is-open' : ''}`}>
      <ul id="iso-dial-menu" className="iso-dial__menu" aria-hidden={!open}>
        {ACTIONS.map((a, i) => (
          <li key={a.key} style={{ transitionDelay: open ? `${(ACTIONS.length - 1 - i) * 40}ms` : '0ms' }}>
            <button
              type="button"
              className="iso-dial__item"
              tabIndex={open ? 0 : -1}
              onClick={() => {
                setOpen(false);
                onPick(a.key);
              }}
            >
              <Icon name={a.icon} />
              {a.label}
            </button>
          </li>
        ))}
      </ul>
      <button
        type="button"
        className="iso-dial__fab"
        aria-label={open ? '메뉴 닫기' : '만들기: 밥약·회의·미팅'}
        aria-expanded={open}
        aria-controls="iso-dial-menu"
        onClick={() => setOpen((v) => !v)}
      >
        <Icon name="plus" />
      </button>
    </div>
  );
}

function MeetupLounge({ me, banned, banReason }: { me: LoungePerson; banned: boolean; banReason: string | null }) {
  const navigate = useNavigate();
  const toast = useToast();
  const gatherings = useGatherings(!banned);
  const { upsert, refresh } = gatherings;
  const { presence, seeking } = useOnline(!banned);
  const loungeRef = useRef<IsoLoungeHandle>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [mealOpen, setMealOpen] = useState(false);
  // 방을 떠나지 않고 여는 모임 창 (빈 의자를 눌렀으면 그 자리를 골라 둔다)
  const [table, setTable] = useState<{ g: GatheringView; slot: string | null } | null>(null);
  // 채팅방 목록: 채팅방에서 뒤로 오면(?chats=1) 다시 열린 채로 돌아온다
  const [params, setParams] = useSearchParams();
  const [chatsOpen, setChatsOpen] = useState(() => params.get('chats') === '1');
  useEffect(() => {
    if (params.has('chats')) setParams({}, { replace: true });
    // 처음 한 번만 주소를 정리한다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 밥약을 누르면 기다리지 않고 바로 뜨도록 내 밥약 상태를 미리 받아 둔다
  useEffect(() => {
    if (!banned) prefetchQuickState();
  }, [banned]);

  // 끝난 약속을 치우는 기준 시각: 1분마다 다시 잰다
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(t);
  }, []);

  // 모두의 회의: 누구 라운지에서나 같은 회의 탁자가 보이고 참여자가 앉는다 (지난번 내용부터 바로, 뒤에서 새로 받는다)
  type SharedMeeting = { id: number; name: string; memberCount: number; members: PublicUser[] };
  const toLounge = (list: SharedMeeting[]): LoungeMeeting[] =>
    list.map((m) => ({ id: m.id, name: m.name, memberCount: m.memberCount, members: m.members.map((u) => ({ id: Number(u.id), name: u.nickname, user: u })) }));
  const [meetings, setMeetings] = useState<LoungeMeeting[]>(() => toLounge(api.cached<SharedMeeting[]>('/meetings/lounge') ?? []));
  // 내가 속한 회의만 눌러서 들어갈 수 있다
  const [myMeetingIds, setMyMeetingIds] = useState<Set<number>>(() => new Set((api.cached<Meeting[]>('/meetings') ?? []).map((m) => m.id)));
  useEffect(() => {
    let alive = true;
    api
      .get<SharedMeeting[]>('/meetings/lounge')
      .then((list) => alive && setMeetings(toLounge(list)))
      .catch(() => undefined);
    api
      .get<Meeting[]>('/meetings')
      .then((list) => alive && setMyMeetingIds(new Set(list.map((m) => m.id))))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  // 라운지에 서 있는 사람: 나 + 지금 접속한 사람들 (서버 목록에는 내가 빠져 있다)
  const presenceUsers = presence?.users;
  const people = useMemo<LoungePerson[]>(
    () => [
      { ...me, seeking },
      ...(presenceUsers ?? []).filter((u) => u.user.id !== me.id).map((u) => ({ ...u.user, seeking: u.zone === 'meal' })),
    ],
    [me, presenceUsers, seeking],
  );

  const live = gatherings.all
    .filter(
      (g) =>
        (g.kind === 'meetup' || g.kind === 'meal' || g.kind === 'team') &&
        !isEnded(g) &&
        g.status !== 'cancelled' &&
        Date.parse(g.meetAt) + ENDED_AFTER_MS > now,
    )
    .sort((a, b) => Number(b.status === 'open') - Number(a.status === 'open') || a.meetAt.localeCompare(b.meetAt));
  // 내 모임: 내가 열었거나 앉은 모임 중 가장 가까운 것
  const mine = live.filter((g) => g.viewer.isHost || g.viewer.isMember).sort((a, b) => a.meetAt.localeCompare(b.meetAt))[0] ?? null;

  const pick = (a: Action) => {
    if (a === 'meetup') setCreateOpen(true);
    else if (a === 'meal') setMealOpen(true);
    else navigate('/lounge/meetings');
  };

  // 정지됐거나 처음부터 못 불러오면 보통 화면으로 안내한다
  if (banned || (gatherings.error && !gatherings.loaded)) {
    return (
      <>
        <AppHeader title="라운지" />
        <main id="main" className="app-main">
          {banned ? (
            <Alert tone="danger" title="이용이 정지된 계정이에요" actions={<Link to="/" className="btn btn--secondary">홈으로</Link>}>
              {banReason ?? BAN_NOTICE_GENERIC} 정지된 동안에는 미팅을 이용할 수 없습니다.
            </Alert>
          ) : (
            <Alert
              tone="danger"
              title="라운지를 불러오지 못했습니다."
              actions={
                <Button variant="secondary" onClick={refresh}>
                  다시 시도하기
                </Button>
              }
            >
              {gatherings.error}
            </Alert>
          )}
        </main>
      </>
    );
  }

  return (
    <>
    {/* 다른 탭처럼 위에는 앱 아이콘과 이름이 있는 머리글을 그대로 둔다 */}
    <AppHeader />
    <main id="main" className="lounge-me">
      <LoungeHead online={presence?.count ?? null} onChats={() => setChatsOpen(true)} />

      {/* 내 모임: 누르면 방이 내 자리로 가고 모임 창이 열린다 */}
      {mine ? (
        <button
          type="button"
          className="lounge-me__mine"
          onClick={() => {
            loungeRef.current?.focusOn(mine.id);
            setTable({ g: mine, slot: null });
          }}
        >
          <span className="lounge-me__mine-icon" aria-hidden="true">
            <Icon name="users" />
          </span>
          <span className="lounge-me__mine-text">
            <strong>{mine.title}</strong>
            <span>
              {shortMeetAt(mine.meetAt)} · 참여자 {seatCount(mine).taken}명
            </span>
          </span>
          <Icon name="chevron-right" className="lounge-me__chev" />
        </button>
      ) : null}

      <div className="lounge-me__map">
        <IsoLounge
          ref={loungeRef}
          gatherings={live}
          mineId={me.id}
          meId={me.id}
          people={people}
          meetings={meetings}
          onOpenMeeting={(id) => (myMeetingIds.has(id) ? navigate(`/meetings/${id}`) : toast('회의에 참여한 사람만 들어갈 수 있어요.'))}
          focusId={mine?.id ?? null}
          onOpen={(g, slot) => setTable({ g, slot: slot ?? null })}
          fill
        >
          <CreateDial onPick={pick} />
        </IsoLounge>
      </div>

      <TableSheet
        open={table !== null}
        gatheringId={table?.g.id ?? null}
        initial={table?.g ?? null}
        focusSlotKey={table?.slot ?? null}
        onClose={() => setTable(null)}
        onChanged={upsert}
        onSafetyChanged={refresh}
      />
      <CreateGatheringSheet
        open={createOpen}
        kind="meetup"
        onClose={() => setCreateOpen(false)}
        onCreated={(g) => {
          upsert(g);
          refresh();
          setCreateOpen(false);
          setTable({ g, slot: null });
        }}
      />
      <Sheet open={chatsOpen} onClose={() => setChatsOpen(false)} title="채팅방">
        <ChatList onExplore={() => setChatsOpen(false)} />
      </Sheet>
      <QuickMatchSheet
        open={mealOpen}
        onClose={() => setMealOpen(false)}
        onConfirmed={() => {
          setMealOpen(false);
          refresh();
        }}
      />
    </main>
    </>
  );
}
