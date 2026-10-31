import { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { AVATARS, BAN_NOTICE_GENERIC, normalizeAvatar } from '../../../shared/lounge';
import type { GatheringView } from '../../../shared/lounge';
import { AppHeader } from '../shell/Shell';
import { Alert, Button, Icon, LoadingBlock } from '../ui';
import { useLounge } from './LoungeContext';
import { KIND_LABEL, STATUS_BADGE, relationBadge, seatCount, shortMeetAt } from './parts/GatheringListItem';
import CreateGatheringSheet from './sheets/CreateGatheringSheet';
import { isEnded } from './world/tables';
import { useGatherings } from './world/useGatherings';
import './bento.css';

const BACK_TO = '/lounge/campus';

const avatarSrc = (key: string) => AVATARS.find((a) => a.key === normalizeAvatar(key))?.src ?? AVATARS[0].src;

/**
 * 미팅 라운지 (/lounge/campus) — 열려 있는 미팅을 정사각형 칸으로 깔아 둔 벤토 그리드.
 *  - 첫 칸은 미팅 만들기이고, 미팅 칸도 모두 같은 크기다.
 *  - 미팅 칸은 정원만큼 나눠 자리마다 앉은 사람의 프로필 사진을 채우고, 빈 자리는 비워 둔다.
 *  - 모집 중인 미팅을 약속 시간이 가까운 순으로 앞에, 마감된 미팅을 뒤에 둔다. 칸을 누르면 그 미팅 화면으로 간다.
 *  - 밥약은 밥약 탭에서 따로 한다.
 */
export default function MeetupLoungePage() {
  const { profile, needsProfile, loading } = useLounge();

  if (loading) {
    return (
      <>
        <AppHeader title="미팅" backTo="/lounge" />
        <main id="main" className="app-main">
          <LoadingBlock>미팅을 불러오는 중입니다.</LoadingBlock>
        </main>
      </>
    );
  }
  if (needsProfile || !profile) return <Navigate to="/lounge" replace />;
  return <MeetupLounge banned={profile.banned} banReason={profile.banReason} />;
}

function MeetupLounge({ banned, banReason }: { banned: boolean; banReason: string | null }) {
  const navigate = useNavigate();
  const gatherings = useGatherings(!banned);
  const { upsert, refresh } = gatherings;
  const [createOpen, setCreateOpen] = useState(false);

  const open = (g: GatheringView) => navigate(`/lounge/gatherings/${g.id}`, { state: { backTo: BACK_TO } });

  const live = gatherings.all
    .filter((g) => g.kind === 'meetup' && !isEnded(g) && g.status !== 'cancelled')
    .sort((a, b) => Number(b.status === 'open') - Number(a.status === 'open') || a.meetAt.localeCompare(b.meetAt));

  return (
    <>
      <AppHeader title="미팅" backTo="/lounge" />
      <main id="main" className="app-main">
        {banned ? (
          <Alert tone="danger" title="이용이 정지된 계정이에요" actions={<Link to="/lounge" className="btn btn--secondary">라운지로</Link>}>
            {banReason ?? BAN_NOTICE_GENERIC} 정지된 동안에는 미팅을 이용할 수 없습니다.
          </Alert>
        ) : !gatherings.loaded && !gatherings.error ? (
          <LoadingBlock>미팅을 불러오는 중입니다.</LoadingBlock>
        ) : gatherings.error && !gatherings.loaded ? (
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
        ) : (
          <ul className="bento" aria-label="미팅 목록">
            <li className="bento__cell">
              <button type="button" className="bento-tile bento-tile--create" onClick={() => setCreateOpen(true)}>
                <Icon name="plus" className="bento-tile__plus" />
                <span className="bento-tile__title">미팅 만들기</span>
                <span className="bento-tile__meta">자리를 열고 사람을 모아요</span>
              </button>
            </li>
            {live.map((g) => (
              <li key={g.id} className="bento__cell">
                <MeetupTile g={g} onOpen={open} />
              </li>
            ))}
            {live.length === 0 && (
              <li className="bento__cell">
                <div className="bento-tile bento-tile--empty">
                  <Icon name="smile" className="bento-tile__plus" />
                  <span className="bento-tile__title">아직 열린 미팅이 없어요</span>
                  <span className="bento-tile__meta">첫 미팅을 열어 보세요</span>
                </div>
              </li>
            )}
          </ul>
        )}

        <CreateGatheringSheet
          open={createOpen}
          kind="meetup"
          onClose={() => setCreateOpen(false)}
          onCreated={(g) => {
            upsert(g);
            refresh();
            setCreateOpen(false);
            open(g);
          }}
        />
      </main>
    </>
  );
}

/**
 * 정원 n 자리의 위치 (칸 안 비율, 0~1). 언제나 두 줄이고 위 줄에 반 이상, 아래 줄은 가운데로 모은다.
 *   6자리 → 위 3 · 아래 3,  3자리 → 위 2 · 아래 가운데 1,  2자리 → 왼쪽 위 · 오른쪽 아래
 */
function seatBoxes(n: number): { left: number; top: number; w: number; h: number }[] {
  if (n <= 1) return [{ left: 0.25, top: 0.25, w: 0.5, h: 0.5 }];
  if (n === 2) return [{ left: 0, top: 0, w: 0.5, h: 0.5 }, { left: 0.5, top: 0.5, w: 0.5, h: 0.5 }];
  const up = Math.ceil(n / 2);
  const down = n - up;
  const w = 1 / up;
  return [
    ...Array.from({ length: up }, (_, i) => ({ left: i * w, top: 0, w, h: 0.5 })),
    ...Array.from({ length: down }, (_, i) => ({ left: ((up - down) / 2 + i) * w, top: 0.5, w, h: 0.5 })),
  ];
}

function MeetupTile({ g, onOpen }: { g: GatheringView; onOpen: (g: GatheringView) => void }) {
  const status = STATUS_BADGE[g.status];
  const relation = relationBadge(g);
  const { taken, capacity } = seatCount(g);
  const when = shortMeetAt(g.meetAt);
  const members = g.slots.flatMap((s) => s.members);

  // 한 줄 낭독: 무엇인지 → 언제·어디서 → 자리 → 상태 순서
  const label = [`${KIND_LABEL[g.kind]}, ${g.title}`, `${when}, ${g.place}`, `${capacity}명 중 ${taken}명 참여`, status.label, relation?.label]
    .filter(Boolean)
    .join(', ');

  return (
    <button
      type="button"
      className={`bento-tile bento-tile--meetup${g.status === 'open' ? '' : ' is-closed'}${relation ? ' is-mine' : ''}`}
      aria-label={label}
      onClick={() => onOpen(g)}
    >
      {/* 정원만큼 나눈 자리: 앉은 사람은 프로필 사진, 빈 자리는 빈칸 */}
      <span className="bento-seats" aria-hidden="true">
        {seatBoxes(capacity).map((box, i) => {
          const m = members[i];
          const style = { left: `${box.left * 100}%`, top: `${box.top * 100}%`, width: `${box.w * 100}%`, height: `${box.h * 100}%` };
          return (
            <span key={i} className="bento-seats__seat" style={style}>
              {m ? <img src={avatarSrc(m.avatar)} alt="" /> : <Icon name="user" />}
            </span>
          );
        })}
        {(relation || g.status !== 'open') && <span className="bento-tile__status">{relation?.label ?? status.label}</span>}
      </span>

      <span className="bento-tile__info">
        <span className="bento-tile__title">{g.title}</span>
        <span className="bento-tile__meta">
          <span className="bento-tile__when">{when}</span>
          <span className="tabular">
            {taken}/{capacity}
          </span>
        </span>
      </span>
    </button>
  );
}
