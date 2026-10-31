import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { QuickMember } from '../../../../shared/lounge';
import { api } from '../../api';
import type { Meeting } from '../../types';
import { Alert, EmptyState, Icon, LoadingBlock, Sheet, btnClass, useToast } from '../../ui';
import { loungeApi } from '../api';

/**
 * 친구를 내 회의에 초대 — 내가 들어가 있는 회의 중 하나를 고르면 친구가 바로 그 회의에 들어가고, 폰에 알림이 간다.
 */
export default function InviteMeetingSheet({ friend, onClose }: { friend: QuickMember | null; onClose: () => void }) {
  const toast = useToast();
  // 지난번에 받은 내 회의 목록으로 첫 그림부터 그리고, 뒤에서 새로 받아 바꾼다
  const [meetings, setMeetings] = useState<Meeting[] | null>(() => api.cached<Meeting[]>('/meetings') ?? null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<number | null>(null);

  useEffect(() => {
    if (!friend) return;
    let cancelled = false;
    setError(null);
    setMeetings(api.cached<Meeting[]>('/meetings') ?? null);
    api
      .get<Meeting[]>('/meetings')
      .then((list) => !cancelled && setMeetings(list))
      .catch((err: unknown) => !cancelled && setError(err instanceof Error ? err.message : '회의 목록을 불러오지 못했어요.'));
    return () => {
      cancelled = true;
    };
  }, [friend]);

  async function invite(m: Meeting) {
    if (!friend || busy !== null) return;
    setBusy(m.id);
    try {
      const r = await loungeApi.inviteToMeeting(m.id, friend.id);
      toast(
        r.alreadyMember
          ? `${friend.name} 님은 이미 '${m.name}' 회의에 있어요.`
          : `${friend.name} 님을 '${m.name}' 회의에 초대했어요.`,
      );
      onClose();
    } catch (err) {
      toast(err instanceof Error ? err.message : '초대하지 못했어요.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <Sheet open={friend !== null} onClose={onClose} title={friend ? `${friend.name} 님을 회의에 초대` : '회의에 초대'}>
      {error ? (
        <Alert tone="danger" title="회의 목록을 불러오지 못했어요.">
          {error}
        </Alert>
      ) : meetings === null ? (
        <LoadingBlock>회의 목록을 불러오는 중이에요.</LoadingBlock>
      ) : meetings.length === 0 ? (
        <EmptyState
          icon="users"
          title="참여 중인 회의가 없어요"
          description="회의를 먼저 만든 뒤 친구를 초대해 보세요."
          action={
            <Link to="/meetings" state={{ sheet: 'create' }} className={btnClass({ variant: 'secondary' })}>
              회의 만들기
            </Link>
          }
        />
      ) : (
        <>
          <p className="text-sub text-sm lounge-invite__lead">고른 회의에 친구가 바로 들어가고, 친구의 폰에 알림이 가요.</p>
          <ul className="lounge-invite__list">
            {meetings.map((m) => (
              <li key={m.id}>
                <button
                  type="button"
                  className="lounge-invite__item"
                  disabled={busy !== null}
                  onClick={() => void invite(m)}
                >
                  <span className="lounge-invite__name truncate">{m.name}</span>
                  <span className="lounge-invite__go">
                    {busy === m.id ? '초대하는 중…' : '초대'}
                    <Icon name="chevron-right" />
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </Sheet>
  );
}
