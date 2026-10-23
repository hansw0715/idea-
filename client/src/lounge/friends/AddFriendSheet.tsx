import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import type { FriendsView } from '../../../../shared/lounge';
import { useAuth } from '../../auth';
import { Button, Icon, Sheet, TextField, useToast } from '../../ui';
import { loungeApi } from '../api';

/**
 * 친구 추가 시트 — 친구의 아이디를 적어 요청을 보낸다. 상대가 라운지에서 수락하면 친구가 된다.
 * 위쪽에 내 아이디를 보여 주어 친구에게 알려 주기 쉽게 한다.
 */
export default function AddFriendSheet({
  open,
  onClose,
  onChanged,
}: {
  open: boolean;
  onClose: () => void;
  onChanged: (view: FriendsView) => void;
}) {
  const { user } = useAuth();
  const toast = useToast();
  const [username, setUsername] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  // 열 때마다 입력을 비운다
  useEffect(() => {
    if (open) {
      setUsername('');
      setError(null);
    }
  }, [open]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (pending) return;
    const name = username.trim();
    if (!name) {
      setError('친구의 아이디를 적어 주세요.');
      return;
    }
    setPending(true);
    setError(null);
    try {
      const { result, ...view } = await loungeApi.requestFriend(name);
      onChanged(view);
      toast(result === 'accepted' ? '서로 요청해서 바로 친구가 됐어요.' : '친구 요청을 보냈어요. 상대가 수락하면 친구가 돼요.');
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : '친구 요청을 보내지 못했어요.');
    } finally {
      setPending(false);
    }
  }

  async function copyMyId() {
    if (!user) return;
    try {
      await navigator.clipboard.writeText(user.username);
      toast('내 아이디를 복사했어요.');
    } catch {
      toast(`내 아이디: ${user.username}`);
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title="친구 추가" initialFocus="#friend-username">
      <form onSubmit={submit} noValidate>
        {user && (
          <div className="lounge-friend-myid">
            <span className="text-sub text-sm">내 아이디</span>
            <strong className="lounge-friend-myid__value">{user.username}</strong>
            <button type="button" className="btn btn--text btn--sm" onClick={() => void copyMyId()}>
              <Icon name="copy" className="btn__icon" />
              복사
            </button>
          </div>
        )}
        <TextField
          id="friend-username"
          label="친구 아이디"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          error={error}
          help="친구가 라운지에서 수락하면 친구가 돼요."
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          enterKeyHint="send"
        />
        <Button type="submit" size="lg" block loading={pending}>
          요청 보내기
        </Button>
      </form>
    </Sheet>
  );
}
