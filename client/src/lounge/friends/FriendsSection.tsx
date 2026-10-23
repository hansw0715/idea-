import { useCallback, useEffect, useState } from 'react';
import type { FriendsView, PublicUser } from '../../../../shared/lounge';
import { api } from '../../api';
import { Button, Icon, useConfirm, useToast } from '../../ui';
import { loungeApi } from '../api';
import Avatar from '../parts/Avatar';
import { factLine } from '../parts/fact';
import AddFriendSheet from './AddFriendSheet';
import './friends.css';

/**
 * 라운지 첫 화면의 "친구" 구역. 친구에 관한 일은 모두 여기서 한다.
 *  - 친구 추가(아이디로 요청) · 받은 요청 수락/거절 · 보낸 요청 취소 · 친구 삭제
 *  - 친구는 밥약에서 "친구끼리만" 찾을 때 쓰인다
 */
export default function FriendsSection() {
  const confirm = useConfirm();
  const toast = useToast();
  // 지난번에 받은 목록이 있으면 먼저 보여 준다
  const [view, setView] = useState<FriendsView | null>(() => api.cached<FriendsView>('/lounge/friends') ?? null);
  const [failed, setFailed] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

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
        title: `${u.nickname} 님을 친구에서 삭제할까요?`,
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
    <section className="section lounge-friends" aria-labelledby="lounge-friends-title">
      <div className="section__head">
        <h2 className="section__title" id="lounge-friends-title">
          친구{friends.length > 0 && <span className="lounge-friends__count tabular"> {friends.length}</span>}
        </h2>
        <button type="button" className="btn btn--text btn--sm lounge-friends__add" onClick={() => setAddOpen(true)}>
          <Icon name="user-plus" className="btn__icon" />
          친구 추가
        </button>
      </div>

      {incoming.length > 0 && (
        <div className="lounge-friends__group">
          <h3 className="lounge-friends__label">받은 요청 {incoming.length}</h3>
          <ul className="card card--list">
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
        <div className="card lounge-friends__empty">
          <p className="text-sub text-sm">아직 친구가 없어요. 친구의 아이디로 친구를 추가하면 밥약에서 친구끼리만 찾을 수 있어요.</p>
        </div>
      ) : (
        <ul className="card card--list" aria-label="친구 목록">
          {friends.map((u) => (
            <li key={u.id} className="lounge-friend-row">
              <Avatar user={u} size="md" />
              <div className="lounge-friend-row__body">
                <div className="lounge-friend-row__name truncate">{u.nickname}</div>
                <div className="lounge-friend-row__sub truncate">{factLine(u)}</div>
              </div>
              <button
                type="button"
                className="btn btn--text btn--sm lounge-friend-row__more"
                disabled={busyId === u.id}
                aria-label={`${u.nickname} 친구 삭제`}
                onClick={() => void remove(u, 'unfriend')}
              >
                삭제
              </button>
            </li>
          ))}
        </ul>
      )}

      {outgoing.length > 0 && (
        <div className="lounge-friends__group">
          <h3 className="lounge-friends__label">보낸 요청 {outgoing.length}</h3>
          <ul className="card card--list">
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
    </section>
  );
}
