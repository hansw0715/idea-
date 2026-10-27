import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, Icon } from '../ui';
import type { IconName } from '../ui';
import { useNotifications } from './Notifications';
import type { Activity } from './activity';

const icons: Record<Activity['kind'], IconName> = { reservation: 'calendar', lounge: 'lounge', meeting: 'users', notice: 'list', friend: 'user-plus', chat: 'message', timetable: 'calendar', learning: 'list' };
export default function HomeNotifications() {
  const { items, loading, failed, unread, mark, refresh } = useNotifications();
  const [expanded, setExpanded] = useState(false);
  // 학교 소식과 수업은 바로 아래 전용 섹션에서 보여 준다.
  const feed = items.filter((i) => !['notice', 'timetable', 'learning'].includes(i.kind)).sort((a, b) => {
    const isNew = Number(unread('home', b)) - Number(unread('home', a));
    if (isNew) return isNew;
    if (a.kind === 'reservation' && b.kind === 'reservation') return a.at.localeCompare(b.at);
    if (a.kind === 'reservation' || b.kind === 'reservation') return a.kind === 'reservation' ? -1 : 1;
    return b.at.localeCompare(a.at);
  });
  return <section className="home-panel home-notifications" aria-labelledby="home-notifications-title" aria-busy={loading}>
    <div className="home-sum__head"><h2 className="home-sum__title" id="home-notifications-title">알림</h2></div>
    <p className="home-notifications__lead">회의, 라운지, 예약 소식을 한곳에서 확인하세요.</p>
    {failed && <div className="home-notifications__retry"><span>일부 소식을 불러오지 못했어요.</span><Button variant="tertiary" size="sm" onClick={refresh}>다시 시도</Button></div>}
    {feed.length ? <ul className="home-notifications__list">{feed.slice(0, expanded ? undefined : 5).map((item) => <li key={item.id}>
      <Link to={item.to} onClick={() => mark('home', item)}>
        <Icon name={icons[item.kind]} className="home-notifications__icon" />
        <span className="home-notifications__body"><strong>{item.title}</strong><span>{item.body}</span>{item.when && <span className="home-notifications__when"><Icon name="calendar" /><span>{item.when}</span></span>}</span>
        {unread('home', item) && <span className="notification-new" aria-label="새 알림" />}
        <Icon name="chevron-right" className="home-notifications__chevron" />
      </Link>
    </li>)}</ul> : <p className="home-empty">{loading ? '새 소식을 확인하고 있어요.' : failed ? '연결 후 알림을 다시 확인해 주세요.' : '아직 도착한 알림이 없어요. 새 소식이 생기면 여기서 알려 드릴게요.'}</p>}
    {feed.length > 5 && <Button variant="tertiary" size="sm" onClick={() => setExpanded((v) => !v)}>{expanded ? '접기' : `알림 ${feed.length - 5}개 더 보기`}</Button>}
  </section>;
}
