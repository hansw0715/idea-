/**
 * 밥약 즉시 매칭 시트 — 택시처럼: 인원(2~4명)을 고르고 시작하면 내 위치로 같은 인원을 고른 가까운 학우를 모으고,
 * 다 모이면 수락·거절만 한다. 날짜·시간·장소 종류 같은 조건은 받지 않는다(서버가 "지금, 학식"으로 정한다).
 *
 * 흐름: 인원 고르기 → 시작 → (위치 허용) → 모으는 중(모인 사람이 자리에 하나씩 보인다) → 다 모임(수락/거절)
 *      → 확정(단톡방) | 누군가 거절·시간 초과 | 근처에 아무도 없음
 * 3·4명을 고르고 나 말고 한 명 이상 모였으면 "N명으로 바로 시작"으로 지금 인원만으로 방을 열 수 있다.
 * 밥약은 실제로 만날 사람끼리라 모인 사람의 실명을 보여 준다.
 * 진실은 서버다. 소켓이 없어서 열려 있는 동안 2초마다 상태를 묻는다(탭이 보일 때만). 시트를 닫아도 대기는 서버에 남는다.
 * 내 위치는 매칭에만 쓰이고 매칭이 끝나면 서버가 지운다. 상대에게는 거리도 보이지 않는다.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { QUICK_WAIT_MIN } from '../../../../shared/lounge';
import type { QuickMember, QuickState } from '../../../../shared/lounge';
import { Alert, Button, Icon, LoadingBlock, Segmented, Sheet, useConfirm } from '../../ui';
import { loungeApi } from '../api';
import { useLounge } from '../LoungeContext';
import Avatar from '../parts/Avatar';
import { factLine } from '../parts/fact';
import '../quick.css';

export type QuickMatchSheetProps = {
  open: boolean;
  onClose: () => void;
  onConfirmed?: (gatheringId: string) => void;
};

const POLL_MS = 2000;

/** 고를 수 있는 인원(본인 포함) */
type PartySize = '2' | '3' | '4';
/** 누구와: 아무나(가까운 학우) · 친구끼리만(라운지 친구 중 가까운 사람) */
type Who = 'anyone' | 'friends';
const WHO_OPTIONS: { value: Who; label: string }[] = [
  { value: 'anyone', label: '아무나' },
  { value: 'friends', label: '친구끼리만' },
];
const SIZE_OPTIONS: { value: PartySize; label: string }[] = [
  { value: '2', label: '2명' },
  { value: '3', label: '3명' },
  { value: '4', label: '4명' },
];

type Phase = 'idle' | 'locating' | 'searching' | 'matched' | 'confirmed' | 'ended';
type Ended = 'declined' | 'cancelled' | 'expired' | null;

function locate(): Promise<{ lat: number; lng: number }> {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) {
      reject(new Error('unsupported'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
      (e) => reject(e),
      { enableHighAccuracy: true, timeout: 12_000, maximumAge: 15_000 },
    );
  });
}

const geoMessage = (err: unknown): string => {
  const code = (err as GeolocationPositionError | null)?.code;
  if (code === 1) return '위치 사용이 허용되지 않았어요. 브라우저 주소창 옆 설정에서 이 사이트의 위치를 허용한 뒤 다시 눌러 주세요.';
  if (code === 3) return '위치를 확인하는 데 너무 오래 걸려요. 잠시 뒤에 다시 눌러 주세요.';
  if ((err as Error | null)?.message === 'unsupported') return '이 기기에서는 위치를 쓸 수 없어요.';
  return '내 위치를 확인하지 못했어요. 위치 기능을 켜고 다시 눌러 주세요.';
};

/** 밥약에서는 실명을 보여 준다. 실명이 없으면(탈퇴 등) 닉네임 */
const displayName = (u: QuickMember): string => u.name || u.nickname;

function phaseOf(state: QuickState | null): Phase {
  if (!state) return 'idle';
  if (state.gatheringId || state.room?.status === 'confirmed') return 'confirmed';
  if (state.room?.status === 'pending') return 'matched';
  if (state.request?.status === 'waiting') return 'searching';
  return 'idle';
}

export default function QuickMatchSheet({ open, onClose, onConfirmed }: QuickMatchSheetProps) {
  const navigate = useNavigate();
  const confirm = useConfirm();
  const { handleError } = useLounge();

  const [state, setState] = useState<QuickState | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState<null | 'locating' | 'start' | 'answer' | 'startNow'>(null);
  const [error, setError] = useState<string | null>(null);
  const [ended, setEnded] = useState<Ended>(null);
  const [size, setSize] = useState<PartySize>('2');
  const [who, setWho] = useState<Who>('anyone');
  const lastRoom = useRef<string | null>(null);
  const confirmedSent = useRef<string | null>(null);
  const onConfirmedRef = useRef(onConfirmed);
  onConfirmedRef.current = onConfirmed;

  const apply = useCallback((next: QuickState) => {
    setState(next);
    // 대기가 끝났다(10분 동안 근처에 아무도 없었다) — 연결됐던 방이 깨져서 끝난 경우는 아래에서 "거절·시간 초과"로 바꾼다
    if ((next.request?.status as string | undefined) === 'expired') setEnded('expired');
    // 연결됐던 방이 사라졌다면 상대가 거절했거나 시간이 지난 것이다
    if (lastRoom.current && (!next.room || next.room.id !== lastRoom.current) && !next.gatheringId) setEnded('declined');
    if (next.room?.status === 'cancelled') setEnded('declined');
    lastRoom.current = next.room && next.room.status === 'pending' ? next.room.id : null;
    if (next.gatheringId && confirmedSent.current !== next.gatheringId) {
      confirmedSent.current = next.gatheringId;
      onConfirmedRef.current?.(next.gatheringId);
    }
  }, []);

  const load = useCallback(async () => {
    try {
      apply(await loungeApi.quick());
    } catch (err) {
      if (!handleError(err)) setError(err instanceof Error ? err.message : '상태를 불러오지 못했어요.');
    } finally {
      setLoaded(true);
    }
  }, [apply, handleError]);

  // 열릴 때 한 번, 열려 있는 동안 2초마다(탭이 보일 때만)
  useEffect(() => {
    if (!open) return;
    setError(null);
    setEnded(null);
    void load();
    const tick = () => {
      if (document.visibilityState === 'visible') void load();
    };
    const timer = window.setInterval(tick, POLL_MS);
    document.addEventListener('visibilitychange', tick);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [open, load]);

  const phase: Phase = busy === 'locating' ? 'locating' : ended && phaseOf(state) === 'idle' ? 'ended' : phaseOf(state);

  async function start() {
    if (busy) return;
    setError(null);
    setEnded(null);
    setBusy('locating');
    let pos: { lat: number; lng: number };
    try {
      pos = await locate();
    } catch (err) {
      setBusy(null);
      setError(geoMessage(err));
      return;
    }
    setBusy('start');
    try {
      apply(await loungeApi.requestQuick({ ...pos, size: Number(size), friendsOnly: who === 'friends' }));
    } catch (err) {
      if (!handleError(err)) setError(err instanceof Error ? err.message : '매칭을 시작하지 못했어요.');
    } finally {
      setBusy(null);
    }
  }

  async function cancel() {
    const ok = await confirm({
      title: '찾기를 그만할까요?',
      message: '대기가 취소되고 내 위치도 지워져요.',
      confirmLabel: '그만하기',
      cancelLabel: '계속 찾기',
      tone: 'danger',
      run: async () => {
        apply(await loungeApi.cancelQuick());
      },
    });
    if (ok) setEnded('cancelled');
  }

  /** 3·4명을 찾다가 지금 모인 사람으로 바로 시작 — 이후는 다 모였을 때처럼 모두 수락하면 확정 */
  async function startNow() {
    if (busy) return;
    setError(null);
    setBusy('startNow');
    try {
      apply(await loungeApi.startQuickNow());
    } catch (err) {
      if (!handleError(err)) setError(err instanceof Error ? err.message : '바로 시작하지 못했어요.');
    } finally {
      setBusy(null);
    }
  }

  async function answer(a: 'accepted' | 'declined') {
    const room = state?.room;
    if (!room || busy) return;
    if (a === 'declined') {
      const ok = await confirm({
        title: '이 만남을 거절할까요?',
        message: '거절하면 연결이 끝나요. 다시 찾을 수 있어요.',
        confirmLabel: '거절하기',
        cancelLabel: '돌아가기',
        tone: 'danger',
        run: async () => {
          apply(await loungeApi.patchQuick({ roomId: room.id, answer: 'declined' }));
        },
      });
      if (ok) setEnded('declined');
      return;
    }
    setBusy('answer');
    try {
      apply(await loungeApi.patchQuick({ roomId: room.id, answer: 'accepted' }));
    } catch (err) {
      if (!handleError(err)) setError(err instanceof Error ? err.message : '수락하지 못했어요.');
    } finally {
      setBusy(null);
    }
  }

  const room = state?.room ?? null;
  const members: QuickMember[] = state?.members ?? [];
  const iAccepted = room && state ? room.answers[state.meId] === 'accepted' : false;
  // 찾는 중: 고른 인원만큼 자리를 그리고, 모인 사람(나 포함)을 먼저 온 순으로 앉힌다
  const wanted = state?.request?.size ?? Number(size);
  const forming: QuickMember[] = state?.forming ?? [];
  const seats: (QuickMember | null)[] = Array.from({ length: wanted }, (_, i) => forming[i] ?? null);
  // 3·4명을 찾는 중에 나 말고 한 명 이상 모였으면 지금 모인 인원으로 바로 시작할 수 있다
  const canStartNow = wanted > 2 && forming.length >= 2 && forming.length < wanted;

  let footer: ReactNode = null;
  if (phase === 'idle' || phase === 'ended') {
    footer = (
      <Button size="lg" block loading={busy === 'start'} onClick={() => void start()}>
        {phase === 'ended' ? '다시 찾기' : '밥약 시작하기'}
      </Button>
    );
  } else if (phase === 'searching') {
    footer = canStartNow ? (
      <div className="lounge-quick-foot">
        <Button variant="secondary" size="lg" disabled={busy !== null} onClick={() => void cancel()}>
          그만 찾기
        </Button>
        <Button size="lg" loading={busy === 'startNow'} onClick={() => void startNow()}>
          {forming.length}명으로 바로 시작
        </Button>
      </div>
    ) : (
      <Button variant="tertiary" size="lg" block onClick={() => void cancel()}>
        그만 찾기
      </Button>
    );
  } else if (phase === 'matched') {
    footer = (
      <div className="lounge-quick-foot">
        <Button variant="secondary" size="lg" disabled={busy !== null} onClick={() => void answer('declined')}>
          거절
        </Button>
        <Button size="lg" loading={busy === 'answer'} disabled={iAccepted} onClick={() => void answer('accepted')}>
          {iAccepted ? '수락했어요' : '수락'}
        </Button>
      </div>
    );
  } else if (phase === 'confirmed') {
    footer = (
      <Button
        size="lg"
        block
        onClick={() => {
          onClose();
          if (state?.gatheringId) navigate(`/lounge/rooms/${state.gatheringId}`);
        }}
      >
        단톡방 가기
      </Button>
    );
  }

  return (
    <Sheet open={open} onClose={onClose} title="밥약" footer={footer}>
      {!loaded ? (
        <LoadingBlock>불러오는 중입니다.</LoadingBlock>
      ) : (
        <div className="lounge-quick">
          {error && (
            <Alert tone="danger" title="잠깐 문제가 있어요">
              {error}
            </Alert>
          )}

          {(phase === 'idle' || phase === 'ended') && (
            <div className="lounge-quick-hero">
              <Icon name="utensils" className="lounge-quick-hero__icon" />
              <h3 className="lounge-quick-hero__title">
                {ended === 'declined'
                  ? '누군가 거절했거나 시간이 지났어요'
                  : ended === 'expired'
                    ? '근처에 아직 아무도 없어요'
                    : ended === 'cancelled'
                      ? '찾기를 그만뒀어요'
                      : '가까이 있는 학우와 밥 한 끼'}
              </h3>
              <p className="lounge-quick-hero__text">
                {ended === 'expired'
                  ? `${QUICK_WAIT_MIN}분 동안 근처에서 찾지 못했어요. 잠시 뒤에 다시 시도해 보세요.`
                  : '같은 인원을 고른 가까운 학우끼리 모여요. 다 모이면 수락이나 거절만 하면 돼요.'}
              </p>
            </div>
          )}

          {(phase === 'idle' || phase === 'ended') && (
            <Segmented
              label="몇 명이서 먹을까요? (나 포함)"
              value={size}
              onChange={setSize}
              options={SIZE_OPTIONS}
              help="같은 인원을 고른 사람끼리만 모여요."
            />
          )}
          {(phase === 'idle' || phase === 'ended') && (
            <Segmented
              label="누구와 먹을까요?"
              value={who}
              onChange={setWho}
              options={WHO_OPTIONS}
              help={who === 'friends' ? '라운지 친구 중 가까이 있는 사람과만 모여요. 친구는 라운지 첫 화면에서 추가해요.' : undefined}
            />
          )}

          {phase === 'locating' && <LoadingBlock>내 위치를 확인하는 중입니다.</LoadingBlock>}

          {phase === 'searching' && (
            <div className="lounge-quick-peer" role="status" aria-live="polite">
              <h3 className="lounge-quick-hero__title">
                {wanted}명 중 {Math.max(1, forming.length)}명 모였어요
              </h3>
              {state?.request?.friendsOnly && <p className="lounge-quick-hero__text">친구끼리만 찾는 중이에요.</p>}
              <ul className="lounge-quick-seats">
                {seats.map((u, i) => (
                  <li key={u?.id ?? `empty-${i}`} className={`lounge-quick-seat${u ? '' : ' lounge-quick-seat--empty'}`}>
                    {u ? (
                      <>
                        <Avatar user={u} size="lg" />
                        <span className="lounge-quick-seat__name">
                          {u.id === state?.meId ? '나' : displayName(u)}
                        </span>
                        {u.id !== state?.meId && <span className="lounge-quick-seat__fact">{factLine(u)}</span>}
                      </>
                    ) : (
                      <>
                        <span className="lounge-quick-seat__wait" aria-hidden="true">
                          <span className="lounge-quick-pulse" />
                        </span>
                        <span className="lounge-quick-seat__name">찾는 중</span>
                      </>
                    )}
                  </li>
                ))}
              </ul>
              <p className="text-sub text-sm">
                {canStartNow
                  ? `${wanted - forming.length}명 더 모이면 바로 연결돼요. 기다리지 않고 지금 ${forming.length}명으로 시작할 수도 있어요.`
                  : `${wanted - Math.max(1, forming.length)}명 더 모이면 바로 연결돼요. 이 창을 닫아도 계속 찾고 있어요.`}
              </p>
            </div>
          )}

          {phase === 'matched' && room && (
            <div className="lounge-quick-peer" role="status" aria-live="polite">
              <h3 className="lounge-quick-hero__title">
                {members.length === 2 ? '밥 같이 먹을 학우를 찾았어요' : `${members.length}명이 모였어요`}
              </h3>
              <ul className="lounge-quick-peer__list">
                {members.map((u) => {
                  const accepted = room.answers[u.id] === 'accepted';
                  return (
                    <li key={u.id} className="lounge-quick-peer__card">
                      <Avatar user={u} size="lg" />
                      <div className="lounge-quick-peer__who">
                        <p className="bold">{u.id === state?.meId ? `${displayName(u)} (나)` : displayName(u)}</p>
                        <p className="text-sub text-sm">{factLine(u)}</p>
                      </div>
                      <span className={`badge ${accepted ? 'badge--success' : 'badge--gray'}`}>
                        {accepted ? '수락' : '기다리는 중'}
                      </span>
                    </li>
                  );
                })}
              </ul>
              <p className="text-sub text-sm">
                {iAccepted
                  ? '다른 사람이 수락하기를 기다리는 중이에요.'
                  : members.length === 2
                    ? '둘 다 수락하면 바로 약속이 만들어져요.'
                    : `${members.length}명 모두 수락하면 바로 약속이 만들어져요.`}
              </p>
            </div>
          )}

          {phase === 'confirmed' && (
            <Alert tone="success" title="매칭이 확정됐어요">
              단톡방에서 어디서 만날지 정해 보세요. 연락처는 공개되지 않아요.
            </Alert>
          )}
        </div>
      )}
    </Sheet>
  );
}
