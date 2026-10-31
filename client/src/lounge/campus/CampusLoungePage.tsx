/**
 * 미팅 라운지 (/lounge/campus) — 한성대 캠퍼스를 아이소메트릭 모형으로 한눈에 보는 화면.
 *  - 사람은 그리지 않는다. 캠퍼스에서 건물을 누르면 그 건물 라운지로 들어간다.
 *  - 탁자: 열려 있는 미팅·밥약 모임을 건물 라운지의 미팅·밥약 탁자에 차례로 놓는다.
 *    멤버 수만큼 의자가 채워지고, 탁자를 누르면 그 모임 화면으로 간다. 빈 탁자는 자리 만들기로 간다.
 * 모임 화면에 다녀와도 같은 라운지로 돌아오도록 장면을 sessionStorage 에 둔다.
 */
import { useCallback, useMemo, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { AVATARS, normalizeAvatar } from '../../../../shared/lounge';
import type { GatheringView } from '../../../../shared/lounge';
import { useHideTabBar } from '../../shell/Shell';
import { Alert, Button, Icon, LoadingBlock, Sheet } from '../../ui';
import { useLounge } from '../LoungeContext';
import { isEnded } from '../world/tables';
import { useGatherings } from '../world/useGatherings';
import { buildingById } from './campus';
import { clamp } from './geometry';
import { KIND_LABEL, ROOMS, roomById, seatsOf, type Room } from './rooms';
import { campusScene, roomScene, type Scene } from './scene';
import { World } from './World';
import './campus.css';

const SCENE_KEY = 'campus-lounge-scene';

type SheetState =
  | { type: 'floors'; buildingId: string }
  | { type: 'info'; title: string; text: string }
  | { type: 'table'; tableId: string };

const avatarSrc = (key: string) => AVATARS.find((a) => a.key === normalizeAvatar(key))?.src ?? AVATARS[0].src;

const campus = campusScene();

function readScene(): string {
  try {
    const v = sessionStorage.getItem(SCENE_KEY);
    return v && roomById(v) ? v : 'campus';
  } catch {
    return 'campus';
  }
}
function writeScene(sceneId: string) {
  try {
    sessionStorage.setItem(SCENE_KEY, sceneId);
  } catch {
    /* 저장 못 해도 이번 화면은 그대로 */
  }
}

/**
 * 모임 → 탁자 배치: 라운지 순서대로 미팅 탁자에는 미팅, 밥약 탁자에는 밥약을 약속 시간이 가까운 순으로 놓는다.
 * 모임이 놓인 탁자는 정원만큼 의자를 두고, 멤버를 앞 의자부터 앉힌다.
 */
function placeGatherings(gatherings: GatheringView[]) {
  const live = gatherings.filter((g) => !isEnded(g) && g.status !== 'closed').sort((a, b) => a.meetAt.localeCompare(b.meetAt));
  const queue = { meeting: live.filter((g) => g.kind === 'meetup'), meal: live.filter((g) => g.kind === 'meal') };
  const byTable = new Map<string, GatheringView>();
  for (const room of ROOMS) {
    for (const t of room.tables) {
      if (t.kind !== 'meeting' && t.kind !== 'meal') continue;
      const g = queue[t.kind].shift();
      if (g) byTable.set(`${room.id}/${t.id}`, g);
    }
  }
  return byTable;
}

function resolveRoom(room: Room, byTable: Map<string, GatheringView>): Room {
  return {
    ...room,
    tables: room.tables.map((t) => {
      if (t.kind !== 'meeting' && t.kind !== 'meal') return t;
      const g = byTable.get(`${room.id}/${t.id}`);
      if (!g) return { ...t, vacant: true, title: `빈 ${KIND_LABEL[t.kind]} 탁자` };
      const capacity = g.slots.reduce((n, s) => n + s.capacity, 0);
      return { ...t, gatheringId: g.id, title: g.title, seats: clamp(capacity, 2, 8) };
    }),
  };
}

export default function CampusLoungePage() {
  useHideTabBar();
  const { profile, needsProfile, loading } = useLounge();

  if (loading) {
    return (
      <div className="mv mv--center">
        <LoadingBlock>미팅 라운지를 불러오는 중입니다.</LoadingBlock>
      </div>
    );
  }
  if (needsProfile || !profile) return <Navigate to="/lounge" replace />;
  if (profile.banned) {
    return (
      <div className="mv mv--center">
        <Alert tone="danger" title="이용이 정지된 계정이에요" actions={<Link to="/lounge" className="btn btn--secondary">라운지로</Link>}>
          {profile.banReason ?? '정지된 동안에는 미팅 라운지를 이용할 수 없습니다.'}
        </Alert>
      </div>
    );
  }
  return <CampusLounge />;
}

function CampusLounge() {
  const navigate = useNavigate();
  const [sceneId, setSceneId] = useState(readScene);
  const [sheet, setSheet] = useState<SheetState | null>(null);

  const gatherings = useGatherings(true);
  const byTable = useMemo(() => placeGatherings(gatherings.all), [gatherings.all]);
  const gatheringById = useMemo(() => new Map(gatherings.all.map((g) => [g.id, g])), [gatherings.all]);

  const baseRoom = sceneId === 'campus' ? undefined : roomById(sceneId);
  const room = useMemo(() => (baseRoom ? resolveRoom(baseRoom, byTable) : undefined), [baseRoom, byTable]);
  const scene: Scene = useMemo(() => (room ? roomScene(room) : campus), [room]);

  // 모임 멤버 수만큼 앞 의자부터 채워 보인다
  const taken = useMemo(() => {
    const set = new Set<string>();
    for (const t of room?.tables ?? []) {
      const g = t.gatheringId ? gatheringById.get(t.gatheringId) : undefined;
      const n = g ? g.slots.reduce((k, sl) => k + sl.members.length, 0) : 0;
      seatsOf(t).slice(0, n).forEach((st) => set.add(`${t.id}:${st.idx}`));
    }
    return set;
  }, [room, gatheringById]);

  const goScene = (id: string) => {
    setSheet(null);
    writeScene(id);
    setSceneId(id);
  };

  const onBuilding = useCallback((id: string) => {
    const b = buildingById(id)!;
    if (!b.rooms) setSheet({ type: 'info', title: b.name, text: b.info });
    else if (b.rooms.length === 1) goScene(b.rooms[0]);
    else setSheet({ type: 'floors', buildingId: b.id });
  }, []);
  const onTable = useCallback((tableId: string) => setSheet({ type: 'table', tableId }), []);

  const openGathering = (gatheringId: string) =>
    navigate(`/lounge/gatherings/${gatheringId}`, { state: { backTo: '/lounge/campus' } });

  const sheetTable = sheet?.type === 'table' ? room?.tables.find((t) => t.id === sheet.tableId) : undefined;
  const sheetGathering = sheetTable?.gatheringId ? gatheringById.get(sheetTable.gatheringId) : undefined;
  const sheetBuilding = sheet?.type === 'floors' ? buildingById(sheet.buildingId) : undefined;

  return (
    <div className="mv">
      <World key={sceneId} scene={scene} taken={taken} onBuilding={onBuilding} onTable={onTable} />

      <header className="mv-top">
        {room ? (
          <button type="button" className="mv-back" onClick={() => goScene('campus')}>
            <Icon name="chevron-left" /> 캠퍼스
          </button>
        ) : (
          <Link to="/lounge" className="mv-back">
            <Icon name="chevron-left" /> 라운지
          </Link>
        )}
        <div className="mv-place">
          <p className="mv-place-name">{room ? room.name : '미팅 라운지'}</p>
          <p className="mv-place-sub">{room ? `${buildingById(room.building)?.name} ${room.floor}` : '건물을 누르면 안에 있는 탁자가 보여요'}</p>
        </div>
      </header>

      <section className="mv-panel" aria-label={room ? '이 라운지의 탁자' : '라운지 목록'}>
        <ul className="mv-list">
          {room
            ? room.tables
                .filter((t) => t.kind === 'meeting' || t.kind === 'meal')
                .map((t) => {
                  const used = seatsOf(t).filter((st) => taken.has(`${t.id}:${st.idx}`)).length;
                  return (
                    <li key={t.id}>
                      <button type="button" className="mv-list-btn" onClick={() => onTable(t.id)}>
                        <span className="mv-list-tag">{KIND_LABEL[t.kind]}</span>
                        <span className="mv-list-text">
                          <b>{t.vacant ? '빈 탁자' : t.title}</b>
                          <span>{t.vacant ? '눌러서 자리 만들기' : `${t.seats}자리 중 ${used}자리 찼어요`}</span>
                        </span>
                      </button>
                    </li>
                  );
                })
            : ROOMS.map((r) => {
                const b = buildingById(r.building)!;
                const n = [...byTable.keys()].filter((k) => k.startsWith(`${r.id}/`)).length;
                return (
                  <li key={r.id}>
                    <button type="button" className="mv-list-btn" onClick={() => goScene(r.id)}>
                      <span className="mv-list-tag">{b.name}</span>
                      <span className="mv-list-text">
                        <b>{r.name}</b>
                        <span>
                          {r.floor} · {n ? `모임 ${n}개` : '아직 모임이 없어요'}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
        </ul>
      </section>

      <Sheet open={sheet?.type === 'floors'} onClose={() => setSheet(null)} title={sheetBuilding ? `${sheetBuilding.name} 엘리베이터` : '엘리베이터'}>
        {sheetBuilding && (
          <div className="mv-sheet">
            <p className="mv-sheet-desc">{sheetBuilding.info}</p>
            <ul className="mv-list">
              {sheetBuilding.rooms!.map((id) => {
                const r = roomById(id)!;
                return (
                  <li key={id}>
                    <button type="button" className="mv-list-btn" onClick={() => goScene(id)}>
                      <span className="mv-list-tag">{r.floor}</span>
                      <span className="mv-list-text">
                        <b>{r.name}</b>
                        <span>{r.desc}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </Sheet>

      <Sheet open={sheet?.type === 'info'} onClose={() => setSheet(null)} title={sheet?.type === 'info' ? sheet.title : ''}>
        {sheet?.type === 'info' && <p className="mv-sheet-desc">{sheet.text}</p>}
      </Sheet>

      <Sheet
        open={sheet?.type === 'table'}
        onClose={() => setSheet(null)}
        title={sheetTable?.title ?? '탁자'}
        footer={
          sheetTable?.vacant ? (
            <Button variant="primary" block onClick={() => navigate(sheetTable.kind === 'meal' ? '/lounge/meal' : '/lounge/meetup')}>
              {KIND_LABEL[sheetTable.kind]} 자리 만들기
            </Button>
          ) : sheetGathering ? (
            <Button variant="primary" block onClick={() => openGathering(sheetGathering.id)}>
              {sheetGathering.viewer.isMember || sheetGathering.viewer.isHost ? '내 모임 보기' : '자리 보고 참여하기'}
            </Button>
          ) : undefined
        }
      >
        {sheetTable && (
          <div className="mv-sheet">
            {sheetGathering ? (
              <>
                <p className="mv-sheet-desc">
                  <span className="mv-kind">{KIND_LABEL[sheetTable.kind]}</span> {sheetGathering.place} ·{' '}
                  {new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: 'long', day: 'numeric', weekday: 'short', hour: 'numeric', minute: '2-digit' }).format(new Date(sheetGathering.meetAt))}
                </p>
                <ul className="mv-people">
                  {sheetGathering.slots.flatMap((s) => s.members).map((m) => (
                    <li key={m.id}>
                      <img src={avatarSrc(m.avatar)} alt="" width={28} height={28} />
                      {m.nickname}
                    </li>
                  ))}
                </ul>
                <p className="mv-sheet-note">
                  {sheetGathering.slots.reduce((n, s) => n + s.seatsLeft, 0)}자리 남았어요. 자리는 모임 화면에서 골라요.
                </p>
              </>
            ) : sheetTable.vacant ? (
              <p className="mv-sheet-desc">
                아직 이 탁자에 {KIND_LABEL[sheetTable.kind]} 모임이 없어요. 자리를 만들면 이 탁자에 나타나요.
              </p>
            ) : (
              <p className="mv-sheet-desc">
                누구나 앉을 수 있는 {KIND_LABEL[sheetTable.kind]} 자리예요.
              </p>
            )}
          </div>
        )}
      </Sheet>

    </div>
  );
}
