import { useCallback, useEffect, useRef, useState } from 'react';
import type { FriendsView, PublicUser, QuickMember } from '../../../../shared/lounge';
import { api } from '../../api';
import { Button, Icon, useConfirm, useToast } from '../../ui';
import { loungeApi } from '../api';
import Avatar from '../parts/Avatar';
import { factLine } from '../parts/fact';
import AddFriendSheet from './AddFriendSheet';
import FriendTimetableSheet from './FriendTimetableSheet';
import InviteMeetingSheet from './InviteMeetingSheet';
import { enablePush, pushPermission, syncPush } from '../push';
import './friends.css';

/**
 * 라운지 첫 화면의 "친구" 구역. 친구에 관한 일은 모두 여기서 한다.
 *  - 친구 추가(아이디로 요청) · 받은 요청 수락/거절 · 보낸 요청 취소
 *  - 친구마다 ⋯ 메뉴: 밥 먹자(폰 알림) · 시간표 보기 · 회의에 초대 · 삭제
 *  - 친구는 밥약에서 "친구끼리만" 찾을 때 쓰인다
 *  - 폰 알림을 아직 켜지 않았으면 "알림 켜기"를 보여 준다
 */
export default function FriendsSection() {
  const confirm = useConfirm();
  const toast = useToast();
  // 지난번에 받은 목록이 있으면 먼저 보여 준다
  const [view, setView] = useState<FriendsView | null>(() => api.cached<FriendsView>('/lounge/friends') ?? null);
  const [failed, setFailed] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [menuId, setMenuId] = useState<string | null>(null);
  const [timetableOf, setTimetableOf] = useState<QuickMember | null>(null);
  const [inviteOf, setInviteOf] = useState<QuickMember | null>(null);
  const [permission, setPermission] = useState(pushPermission);
  const menuRef = useRef<HTMLDivElement>(null);

  // 이미 알림을 허락한 기기면 구독을 조용히 맞춘다
  useEffect(() => {
    void syncPush();
  }, []);

  // 메뉴 밖을 누르거나 Esc 를 누르면 닫는다
  useEffect(() => {
    if (!menuId) return;
    const onDown = (e: PointerEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuId(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuId(null);
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuId]);

  async function turnOnPush() {
    const on = await enablePush().catch(() => false);
    setPermission(pushPermission());
    toast(
      on
        ? '알림을 켰어요. 친구 요청·밥 먹자·회의 초대를 폰으로 알려 드려요.'
        : '알림을 켜지 못했어요. 폰 설정에서 알림을 허용해 주세요.',
    );
  }

  async function askMeal(u: QuickMember) {
    setMenuId(null);
    try {
      await loungeApi.askMeal(u.id);
      toast(`${u.name} 님에게 밥 먹자고 알렸어요.`);
    } catch (err) {
      toast(err instanceof Error ? err.message : '보내지 못했어요.');
    }
  }

  const load = useCallback(() => {
    setFailed(false);
    loungeApi
      .friends()
      .then(setView)
      .catch(() => setFailed(true));
  }, []);

  useEffect(load, [load]);

  async function accept(u: PublicUser) {
    setBusyId(u.id);
    try {
      setView(await loungeApi.acceptFriend(u.id));
      toast(`${u.nickname} 님과 친구가 됐어요.`);
    } catch (err) {
      toast(err instanceof Error ? err.message : '수락하지 못했어요.');
      load();
    } finally {
      setBusyId(null);
    }
  }

  async function remove(u: PublicUser, kind: 'decline' | 'cancel' | 'unfriend') {
    if (kind === 'unfriend') {
      const ok = await confirm({
        title: `${'name' in u ? (u as QuickMember).name : u.nickname} 님을 친구에서 삭제할까요?`,
        message: '상대에게는 알리지 않아요. 다시 친구가 되려면 요청을 새로 보내야 해요.',
        confirmLabel: '삭제하기',
        cancelLabel: '돌아가기',
      });
      if (!ok) return;
    }
    setBusyId(u.id);
    try {
      setView(await loungeApi.removeFriend(u.id));
      toast(kind === 'decline' ? '요청을 거절했어요.' : kind === 'cancel' ? '요청을 취소했어요.' : '친구에서 삭제했어요.');
    } catch (err) {
      toast(err instanceof Error ? err.message : '처리하지 못했어요.');
      load();
    } finally {
      setBusyId(null);
    }
  }

  const friends = view?.friends ?? [];
  const incoming = view?.incoming ?? [];
  const outgoing = view?.outgoing ?? [];

  return (
    <section className="lounge-friends" aria-labelledby="lounge-friends-title">
      <div className="lounge-friends__head">
        <span className="lounge-friends__icon" aria-hidden="true">
          <Icon name="users" />
        </span>
        <div className="lounge-friends__heading">
          <h2 className="lounge-friends__title" id="lounge-friends-title">
            친구{friends.length > 0 && <span className="lounge-friends__count tabular">{friends.length}</span>}
          </h2>
          <p className="lounge-friends__lead">친구와 밥 약속을 잡고, 시간표를 보고, 회의에 초대해요.</p>
        </div>
        <Button variant="secondary" size="sm" className="lounge-friends__add" onClick={() => setAddOpen(true)}>
          <Icon name="user-plus" className="btn__icon" />
          친구 추가
        </Button>
      </div>

      {permission === 'default' && (
        <div className="lounge-friends__push">
          <Icon name="info" />
          <span>친구가 밥 먹자고 하거나 회의에 초대하면 폰으로 알려 드려요.</span>
          <button type="button" className="btn btn--text btn--sm" onClick={() => void turnOnPush()}>
            알림 켜기
          </button>
        </div>
      )}

      {incoming.length > 0 && (
        <div className="lounge-friends__group lounge-friends__group--incoming">
          <h3 className="lounge-friends__label">받은 요청 {incoming.length}</h3>
          <ul className="lounge-friends__list">
            {incoming.map((u) => (
              <li key={u.id} className="lounge-friend-row">
                <Avatar user={u} size="md" />
                <div className="lounge-friend-row__body">
                  <div className="lounge-friend-row__name truncate">{u.nickname}</div>
                  <div className="lounge-friend-row__sub truncate">{factLine(u)}</div>
                </div>
                <div className="lounge-friend-row__actions">
                  <Button size="sm" variant="tertiary" disabled={busyId === u.id} onClick={() => void remove(u, 'decline')}>
                    거절
                  </Button>
                  <Button size="sm" loading={busyId === u.id} onClick={() => void accept(u)}>
                    수락
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {view === null && !failed ? (
        <p className="text-sub text-sm">친구 목록을 불러오는 중이에요.</p>
      ) : failed && view === null ? (
        <p className="text-sub text-sm">
          친구 목록을 불러오지 못했어요.{' '}
          <button type="button" className="btn btn--text btn--sm" onClick={load}>
            다시 시도
          </button>
        </p>
      ) : friends.length === 0 ? (
        <p className="lounge-friends__empty">아직 친구가 없어요. 친구 추가를 눌러 친구의 아이디로 요청을 보내 보세요.</p>
      ) : (
        <ul className="lounge-friends__list" aria-label="친구 목록">
          {friends.map((u) => (
            <li key={u.id} className="lounge-friend-row">
              <Avatar user={u} size="md" />
              <div className="lounge-friend-row__body">
                {/* 친구끼리는 실명을 보여 주고, 라운지 닉네임은 옆에 작게 */}
                <div className="lounge-friend-row__name truncate">
                  {u.name}
                  <span className="lounge-friend-row__nick"> {u.nickname}</span>
                </div>
                <div className="lounge-friend-row__sub truncate">{factLine(u)}</div>
              </div>
              <div className="lounge-friend-menu" ref={menuId === u.id ? menuRef : undefined}>
                <button
                  type="button"
                  className="btn btn--icon lounge-friend-menu__toggle"
                  aria-label={`${u.name} 메뉴`}
                  aria-haspopup="menu"
                  aria-expanded={menuId === u.id}
                  disabled={busyId === u.id}
                  onClick={() => setMenuId((cur) => (cur === u.id ? null : u.id))}
                >
                  <Icon name="more" className="btn__icon" />
                </button>
                {menuId === u.id && (
                  <div className="lounge-friend-menu__list" role="menu">
                    <button type="button" role="menuitem" onClick={() => void askMeal(u)}>
                      <Icon name="utensils" />밥 먹자
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setMenuId(null);
                        setTimetableOf(u);
                      }}
                    >
                      <Icon name="calendar" />시간표 보기
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setMenuId(null);
                        setInviteOf(u);
                      }}
                    >
                      <Icon name="users" />회의에 초대
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      className="lounge-friend-menu__danger"
                      onClick={() => {
                        setMenuId(null);
                        void remove(u, 'unfriend');
                      }}
                    >
                      <Icon name="trash" />삭제
                    </button>
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {outgoing.length > 0 && (
        <div className="lounge-friends__group">
          <h3 className="lounge-friends__label">보낸 요청 {outgoing.length}</h3>
          <ul className="lounge-friends__list">
            {outgoing.map((u) => (
              <li key={u.id} className="lounge-friend-row">
                <Avatar user={u} size="md" />
                <div className="lounge-friend-row__body">
                  <div className="lounge-friend-row__name truncate">{u.nickname}</div>
                  <div className="lounge-friend-row__sub truncate">수락을 기다리는 중</div>
                </div>
                <button
                  type="button"
                  className="btn btn--text btn--sm lounge-friend-row__more"
                  disabled={busyId === u.id}
                  onClick={() => void remove(u, 'cancel')}
                >
                  취소
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <AddFriendSheet open={addOpen} onClose={() => setAddOpen(false)} onChanged={setView} />
      <FriendTimetableSheet friend={timetableOf} onClose={() => setTimetableOf(null)} />
      <InviteMeetingSheet friend={inviteOf} onClose={() => setInviteOf(null)} />
    </section>
  );
}
