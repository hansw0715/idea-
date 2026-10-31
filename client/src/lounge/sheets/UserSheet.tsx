import { useEffect, useId, useRef, useState } from 'react';
import { DEFAULT_TEMPERATURE, MAX_TEMPERATURE, temperatureFace } from '../../../../shared/lounge';
import type { PublicUser } from '../../../../shared/lounge';
import { ApiError } from '../../api';
import { Alert, Badge, Button, EmptyState, Icon, LoadingBlock, Sheet, useToast } from '../../ui';
import { loungeApi } from '../api';
import { useLounge } from '../LoungeContext';
import { factLine } from '../parts/fact';
import Avatar from '../parts/Avatar';
import SafetyForm from '../parts/SafetyForm';
import BlockListSheet from './BlockListSheet';
import '../gathering.css';

/**
 * 사용자 카드 시트 — 아바타를 눌렀을 때: 닉네임·단과대·학번·매너온도, 신고·차단.
 * 담당: 작업 C2.
 *
 * 계약(props)은 바꾸지 말고, 필요하면 선택(optional) props 만 추가한다.
 *  - userId: 볼 사용자 id (내 id 면 "내 프로필" — 프로필 고치기 버튼을 보여 준다). loungeApi.user(id) 로 불러온다.
 *  - context/refId: 신고에 함께 기록할 출처 (예: 'profile' / 'meetup' + 모임 id)
 */
export type UserSheetProps = {
  open: boolean;
  userId: string | null;
  context?: string;
  refId?: string | null;
  onClose: () => void;
  /** 차단·신고 후 지도의 접속자 목록을 즉시 새로 고치도록 알린다 */
  onSafetyChanged?: () => void;
};

type Phase = 'loading' | 'ready' | 'missing' | 'error';

export default function UserSheet({
  open,
  userId,
  context = 'profile',
  refId = null,
  onClose,
  onSafetyChanged,
}: UserSheetProps) {
  const { profile, openProfileSheet, handleError } = useLounge();
  const toast = useToast();
  const [user, setUser] = useState<PublicUser | null>(null);
  const [phase, setPhase] = useState<Phase>('loading');
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [blockListOpen, setBlockListOpen] = useState(false);
  const changedRef = useRef(onSafetyChanged);
  changedRef.current = onSafetyChanged;

  const isMe = profile !== null && userId !== null && profile.id === userId;
  // 남의 카드는 내 프로필이 바뀐다고 다시 불러올 이유가 없다.
  const myProfile = isMe ? profile : null;

  useEffect(() => {
    if (!open || !userId) return;
    // 내 카드는 이미 들고 있는 프로필로 그린다(네트워크 없이, 고친 직후에도 바로 반영).
    if (myProfile) {
      setUser(myProfile);
      setPhase('ready');
      return;
    }
    let cancelled = false;
    setUser(null);
    setPhase('loading');
    setError(null);
    loungeApi
      .user(userId)
      .then((u) => {
        if (cancelled) return;
        setUser(u);
        setPhase('ready');
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        // 없는 사용자·프로필 미완성·차단 관계는 서버가 같은 404 로 답한다 — 이유를 짐작해 말하지 않는다.
        if (err instanceof ApiError && err.status === 404) {
          setPhase('missing');
          return;
        }
        handleError(err);
        setError(err instanceof Error ? err.message : '사용자 정보를 불러오지 못했어요.');
        setPhase('error');
      });
    return () => {
      cancelled = true;
    };
    // 내 프로필이 바뀌면(고치기) 카드도 바뀌어야 하므로 myProfile 을 의존에 둔다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, userId, attempt, myProfile]);

  // 친구 상태: 이미 친구·요청 보냄이면 버튼을 잠근다
  const [busy, setBusy] = useState<null | 'friend'>(null);
  const [friendState, setFriendState] = useState<'none' | 'requested' | 'friend'>('none');
  useEffect(() => {
    if (!open || !userId || isMe) return;
    let cancelled = false;
    setFriendState('none');
    loungeApi
      .friends()
      .then((f) => {
        if (cancelled) return;
        if (f.friends.some((x) => x.id === userId)) setFriendState('friend');
        else if (f.outgoing.some((x) => x.id === userId)) setFriendState('requested');
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [open, userId, isMe]);

  async function addFriend() {
    if (!userId || busy) return;
    setBusy('friend');
    try {
      const r = await loungeApi.requestFriendById(userId);
      setFriendState(r.result === 'accepted' ? 'friend' : 'requested');
      toast(r.result === 'accepted' ? '친구가 됐어요.' : '친구 요청을 보냈어요. 상대가 수락하면 친구가 돼요.');
    } catch (err) {
      toast(err instanceof Error ? err.message : '친구 요청을 보내지 못했어요.');
    } finally {
      setBusy(null);
    }
  }

  function afterBlocked(target: PublicUser) {
    onClose();
    changedRef.current?.();
    toast(`${target.nickname} 님을 차단했어요. 차단 목록에서 해제할 수 있어요.`, {
      action: {
        label: '되돌리기',
        onClick: () => {
          loungeApi
            .unblock(target.id)
            .then(() => {
              changedRef.current?.();
              toast('차단을 해제했어요.');
            })
            .catch((err: unknown) => {
              toast(err instanceof Error ? err.message : '차단을 해제하지 못했어요.');
            });
        },
      },
    });
  }

  const title = isMe ? '내 프로필' : '사용자 카드';

  return (
    <>
      <Sheet open={open} onClose={onClose} title={title}>
        {phase === 'loading' && <LoadingBlock>사용자 정보를 불러오는 중이에요.</LoadingBlock>}

        {phase === 'missing' && (
          <EmptyState
            icon="user"
            title="볼 수 없는 사용자예요"
            description="프로필이 없거나, 지금은 볼 수 없는 상태예요."
          />
        )}

        {phase === 'error' && (
          <Alert
            tone="danger"
            title="사용자 정보를 불러오지 못했어요."
            actions={
              <Button variant="secondary" onClick={() => setAttempt((n) => n + 1)}>
                다시 불러오기
              </Button>
            }
          >
            {error}
          </Alert>
        )}

        {phase === 'ready' && user && (
          <div className="lounge-gath-user">
            <div className="lounge-gath-user__head">
              <Avatar user={user} size="lg" />
              <div className="lounge-gath-user__who">
                <h3 className="lounge-gath-user__name">
                  {user.nickname}
                  {isMe && <Badge tone="primary">나</Badge>}
                </h3>
                <p className="text-sub">
                  {factLine(user)}
                </p>
              </div>
            </div>

            <TemperaturePanel value={user.temperature} />

            {isMe && profile && (
              <>
                {profile.banned && (
                  <Alert tone="danger" title="이용이 정지된 계정이에요.">
                    {profile.banReason ?? '관리자 확인 후 풀려요.'}
                  </Alert>
                )}
                <dl className="lounge-gath-kv">
                  <div className="kv">
                    <dt className="kv__key">학과</dt>
                    <dd className="kv__val grow">
                      {profile.department}
                    </dd>
                  </div>
</dl>
                <Button variant="secondary" block onClick={openProfileSheet}>
                  프로필 이미지 바꾸기
                </Button>
              </>
            )}

            {/* 라운지에서 만난 사람: 친구 추가 (1:1 채팅은 두지 않는다) */}
            {!isMe && (
              <div className="lounge-user-actions">
                <Button
                  variant="primary"
                  block
                  loading={busy === 'friend'}
                  disabled={busy !== null || friendState !== 'none'}
                  onClick={() => void addFriend()}
                >
                  <Icon name="user-plus" className="btn__icon" />
                  {friendState === 'friend' ? '친구예요' : friendState === 'requested' ? '요청을 보냈어요' : '친구 추가'}
                </Button>
              </div>
            )}

            {!isMe && (
              <SafetyForm
                target={user}
                context={context}
                refId={refId}
                onReported={() => changedRef.current?.()}
                onBlocked={afterBlocked}
              />
            )}

            <Button variant="text" block onClick={() => setBlockListOpen(true)}>
              차단한 사용자 보기
            </Button>
          </div>
        )}
      </Sheet>

      <BlockListSheet
        open={blockListOpen}
        onClose={() => setBlockListOpen(false)}
        onChanged={() => changedRef.current?.()}
      />
    </>
  );
}

/**
 * 매너온도: 숫자 + 단계 글자 + 얼굴 + 막대. 막대는 장식이고 의미는 글자가 전한다(색만으로 전하지 않는다).
 * 36.5° 는 모두가 시작하는 값이라 막대에 눈금으로 표시한다.
 */
function TemperaturePanel({ value }: { value: number }) {
  const titleId = useId();
  const face = temperatureFace(value);
  const pct = Math.max(0, Math.min(100, (value / MAX_TEMPERATURE) * 100));
  const basePct = (DEFAULT_TEMPERATURE / MAX_TEMPERATURE) * 100;
  return (
    <section className="lounge-gath-temp" aria-labelledby={titleId}>
      <div className="lounge-gath-temp__row">
        <h3 className="lounge-gath-h3" id={titleId}>
          매너온도
        </h3>
        <p className={`lounge-gath-temp__value lounge-gath-temp__value--${face.tone}`}>
          {value.toFixed(1)}°
          <span className="lounge-gath-temp__level">{face.label}</span>
        </p>
      </div>
      <div className="lounge-gath-gauge" aria-hidden="true">
        <span className={`lounge-gath-gauge__fill lounge-gath-gauge__fill--${face.tone}`} style={{ width: `${pct}%` }} />
        <span className="lounge-gath-gauge__tick" style={{ left: `${basePct}%` }} />
      </div>
      <p className="text-xs text-sub">
        {DEFAULT_TEMPERATURE}°에서 시작해요. 모임 뒤에 좋은 평가를 받으면 올라요.
      </p>
    </section>
  );
}
