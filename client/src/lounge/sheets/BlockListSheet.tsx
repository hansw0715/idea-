import { useEffect, useRef, useState } from 'react';
import { admissionLabel } from '../../../../shared/lounge';
import type { PublicUser } from '../../../../shared/lounge';
import { Alert, Button, EmptyState, LoadingBlock, Sheet, useConfirm, useToast } from '../../ui';
import { loungeApi } from '../api';
import { factLine } from '../parts/fact';
import Avatar from '../parts/Avatar';
import InlineNotice from '../parts/InlineNotice';
import '../gathering.css';

/**
 * 차단한 사용자 목록 시트 — 차단 해제. (내 정보 화면과 사용자 카드에서 연다)
 * 담당: 작업 C2.
 */
export type BlockListSheetProps = {
  open: boolean;
  onClose: () => void;
  onChanged?: () => void;
};

export default function BlockListSheet({ open, onClose, onChanged }: BlockListSheetProps) {
  const confirm = useConfirm();
  const toast = useToast();
  const [list, setList] = useState<PublicUser[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const onChangedRef = useRef(onChanged);
  onChangedRef.current = onChanged;

  // 열릴 때마다 서버에서 다시 읽는다 — 다른 화면에서 차단했을 수 있어서 오래된 목록을 보여 주지 않는다.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setList(null);
    setError(null);
    loungeApi
      .blocks()
      .then((blocked) => {
        if (!cancelled) setList(blocked);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : '차단 목록을 불러오지 못했어요.');
      });
    return () => {
      cancelled = true;
    };
  }, [open, attempt]);

  // 열릴 때 지난번 알림 문구를 지운다. (재시도로 다시 읽을 때는 지우지 않는다)
  useEffect(() => {
    if (open) setNotice(null);
  }, [open]);

  async function unblock(user: PublicUser) {
    const ok = await confirm({
      title: `${user.nickname} 님의 차단을 해제할까요?`,
      message: '다시 서로의 모임과 접속자 목록에 보여요. 상대에게는 알리지 않아요.',
      confirmLabel: '해제하기',
      cancelLabel: '돌아가기',
      run: async () => {
        await loungeApi.unblock(user.id);
      },
    });
    if (!ok) return;
    setList((cur) => (cur ? cur.filter((u) => u.id !== user.id) : cur));
    setNotice(`${user.nickname} 님의 차단을 해제했어요.`);
    toast('차단을 해제했어요.');
    onChangedRef.current?.();
  }

  return (
    <Sheet open={open} onClose={onClose} title="차단한 사용자">
      {notice && (
        <div className="lounge-gath-gap">
          <InlineNotice>{notice}</InlineNotice>
        </div>
      )}

      {error ? (
        <Alert
          tone="danger"
          title="차단 목록을 불러오지 못했어요."
          actions={
            <Button variant="secondary" onClick={() => setAttempt((n) => n + 1)}>
              다시 불러오기
            </Button>
          }
        >
          {error}
        </Alert>
      ) : list === null ? (
        <LoadingBlock>차단 목록을 불러오는 중이에요.</LoadingBlock>
      ) : list.length === 0 ? (
        <EmptyState
          icon="block"
          title="아직 차단한 사람이 없어요"
          description="모임이나 프로필에서 차단하면 여기에 모여요. 차단하면 서로의 모임과 매칭에서 사라져요."
        />
      ) : (
        <>
          <p className="text-sub text-sm lounge-gath-gap">
            차단한 사람과는 서로의 모임, 접속자 목록, 매칭에서 보이지 않아요. 상대에게는 알리지 않아요.
          </p>
          <ul className="list" aria-label="차단한 사용자 목록">
            {list.map((u) => (
              <li key={u.id} className="list__item lounge-gath-row">
                <Avatar user={u} size="md" />
                <div className="list__body">
                  <div className="list__main truncate">{u.nickname}</div>
                  <div className="list__sub">
                    {factLine(u)}
                  </div>
                </div>
                <Button variant="secondary" aria-label={`${u.nickname} 차단 해제`} onClick={() => unblock(u)}>
                  차단 해제
                </Button>
              </li>
            ))}
          </ul>
        </>
      )}
    </Sheet>
  );
}
