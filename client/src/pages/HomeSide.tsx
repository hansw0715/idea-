import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import { LOUNGE_ENABLED } from '../features';
import { useLoungeOptional } from '../lounge/LoungeContext';
import Avatar from '../lounge/parts/Avatar';
import { Icon, useToast } from '../ui';
import type { IconName } from '../ui';

/**
 * 큰 화면(1024px 이상) 홈의 왼쪽 열: 내 프로필 카드 + 바로 가기 메뉴.
 * 작은 화면에서는 CSS 로 숨긴다 (휴대폰은 하단 탭바·내 정보 화면이 같은 일을 한다).
 */
export default function HomeSide() {
  const { user, setUser } = useAuth();
  const loungeProfile = useLoungeOptional()?.profile ?? null;
  const navigate = useNavigate();
  const toast = useToast();
  const [loggingOut, setLoggingOut] = useState(false);

  if (!user) return null;

  async function logout() {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      await api.post('/auth/logout');
    } catch {
      // 서버에 닿지 못해도 이 기기의 로그인 상태는 정리하고 로그인 화면으로 보낸다.
    }
    setUser(null);
    toast('로그아웃했습니다.');
    navigate('/login', { replace: true });
  }

  const links: { to: string; label: string; icon: IconName; state?: unknown }[] = [
    { to: '/timetable', label: '내 시간표', icon: 'calendar' },
    { to: '/meetings', label: '회의 만들기', icon: 'plus', state: { sheet: 'create' } },
    { to: '/meetings', label: '코드로 참가하기', icon: 'user-plus', state: { sheet: 'join' } },
    ...(LOUNGE_ENABLED ? [{ to: '/lounge', label: '라운지에서 밥 친구 찾기', icon: 'utensils' as IconName }] : []),
  ];

  return (
    <aside className="home-side" aria-label="내 프로필과 바로 가기">
      <section className="home-side__profile">
        <div className="home-side__avatar">
          {loungeProfile ? (
            <Avatar user={loungeProfile} size="lg" />
          ) : (
            <span aria-hidden="true">{user.name.trim().charAt(0) || '나'}</span>
          )}
        </div>
        <p className="home-side__name">{user.name}</p>
        <p className="home-side__sub">{user.username}</p>
        <div className="home-side__btns">
          <Link to="/account" className="home-side__btn">
            내 정보
          </Link>
          <button type="button" className="home-side__btn" onClick={() => void logout()} disabled={loggingOut}>
            {loggingOut ? '로그아웃 중…' : '로그아웃'}
          </button>
        </div>
      </section>

      <nav className="home-side__menu" aria-label="바로 가기">
        {links.map((l) => (
          <Link key={l.label} to={l.to} state={l.state} className="home-side__link">
            <Icon name={l.icon} />
            {l.label}
          </Link>
        ))}
      </nav>
    </aside>
  );
}
