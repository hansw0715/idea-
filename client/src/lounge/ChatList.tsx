import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { RoomSummary } from '../../../shared/lounge';
import { Alert, Button, EmptyState, Icon, LoadingBlock } from '../ui';
import { loungeApi } from './api';

export default function ChatList({ onExplore }: { onExplore: () => void }) {
  const [rooms, setRooms] = useState<RoomSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setError(null);
    loungeApi.rooms().then((list) => { if (!cancelled) setRooms(list); })
      .catch((err: unknown) => { if (!cancelled) setError(err instanceof Error ? err.message : '잠시 후 다시 시도해 주세요.'); });
    return () => { cancelled = true; };
  }, [attempt]);
  if (error) return <Alert tone="danger" title="채팅 목록을 불러오지 못했어요" actions={<Button variant="secondary" onClick={() => setAttempt((n) => n + 1)}>다시 시도하기</Button>}>{error}</Alert>;
  if (rooms === null) return <LoadingBlock>참여한 채팅방을 불러오고 있어요.</LoadingBlock>;
  return <section className="section" aria-labelledby="lounge-chats-title">
    <div className="section__head"><h2 id="lounge-chats-title" className="section__title">내 채팅방</h2><span className="text-sub text-sm">{rooms.length}개</span></div>
    {rooms.length === 0 ? <div className="card"><EmptyState icon="message" title="아직 참여한 채팅방이 없어요" description="밥약이나 미팅의 인원이 모이면 채팅방이 열려요. 종료된 방의 대화도 여기서 볼 수 있어요." action={<Button variant="secondary" onClick={onExplore}>모임 둘러보기</Button>} /></div> :
      <ul className="card list lounge-chat-list">{rooms.map((room) => <li key={room.id}>
        <Link className="list__item list__item--link" to={`/lounge/rooms/${room.id}`}>
          <Icon name="message" className="lounge-chat-list__icon" />
          <div className="list__body"><div className="list__main">{room.title}</div>
            <div className="list__sub">{{ meal: '밥약', meetup: '미팅', team: '팀 모임' }[room.kind]} · {room.memberCount}명{room.readOnly ? ' · 대화 기록' : ''}</div>
            <div className="list__sub">{new Date(room.meetAt).toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' })} · {room.place}</div>
          </div><Icon name="chevron-right" className="list__chev" />
        </Link>
      </li>)}</ul>}
  </section>;
}
