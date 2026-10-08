/**
 * 밥약 즉시 매칭 시트 — 택시처럼: 시작하면 내 위치로 가까운 학우를 찾고, 이어지면 수락·거절만 한다.
 * 날짜·시간·장소 종류 같은 조건은 받지 않는다(서버가 "지금, 학식, 2명"으로 정한다).
 *
 * 흐름: 시작 → (위치 허용) → 찾는 중 → 연결됨(수락/거절) → 확정(단톡방) | 상대가 거절·시간 초과 | 근처에 아무도 없음
 * 진실은 서버다. 소켓이 없어서 열려 있는 동안 2초마다 상태를 묻는다(탭이 보일 때만). 시트를 닫아도 대기는 서버에 남는다.
 * 내 위치는 매칭에만 쓰이고 매칭이 끝나면 서버가 지운다. 상대에게는 거리(50m 단위)만 보인다.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { QUICK_WAIT_MIN } from '../../../../shared/lounge';
import type { PublicUser, QuickState } from '../../../../shared/lounge';
import { Alert, Button, Icon, LoadingBlock, Sheet, useConfirm } from '../../ui';
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
  const [busy, setBusy] = useState<null | 'locating' | 'start' | 'answer'>(null);
  const [error, setError] = useState<string | null>(null);
  const [ended, setEnded] = useState<Ended>(null);
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
      apply(await loungeApi.requestQuick(pos));
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

  const others: PublicUser[] = (state?.members ?? []).filter((m) => m.id !== state?.meId);
  const peer = others[0];
  const room = state?.room ?? null;
  const iAccepted = room && state ? room.answers[state.meId] === 'accepted' : false;

  let footer: ReactNode = null;
  if (phase === 'idle' || phase === 'ended') {
    footer = (
      <Button size="lg" block loading={busy === 'start'} onClick={() => void start()}>
        {phase === 'ended' ? '다시 찾기' : '밥약 시작하기'}
      </Button>
    );
  } else if (phase === 'searching') {
    footer = (
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
                  ? '상대가 거절했거나 시간이 지났어요'
                  : ended === 'expired'
                    ? '근처에 아직 아무도 없어요'
                    : ended === 'cancelled'
                      ? '찾기를 그만뒀어요'
                      : '가까이 있는 학우와 밥 한 끼'}
              </h3>
              <p className="lounge-quick-hero__text">
                {ended === 'expired'
                  ? `${QUICK_WAIT_MIN}분 동안 근처에서 찾지 못했어요. 잠시 뒤에 다시 시도해 보세요.`
                  : '시작을 누르면 내 위치로 가까운 학우를 바로 찾아요. 연결되면 수락이나 거절만 하면 돼요.'}
              </p>
              <p className="lounge-quick-hero__note">내 위치는 매칭에만 쓰고, 끝나면 지워요. 상대에게는 거리만 보여요.</p>
            </div>
          )}

          {phase === 'locating' && <LoadingBlock>내 위치를 확인하는 중입니다.</LoadingBlock>}

          {phase === 'searching' && (
            <div className="lounge-quick-hero" role="status" aria-live="polite">
              <span className="lounge-quick-pulse" aria-hidden="true" />
              <h3 className="lounge-quick-hero__title">가까운 학우를 찾는 중이에요</h3>
              <p className="lounge-quick-hero__text">
                {state && state.waitingCount > 0
                  ? `근처에 찾는 사람이 ${state.waitingCount}명 있어요.`
                  : '이 창을 닫아도 계속 찾고 있어요.'}
              </p>
            </div>
          )}

          {phase === 'matched' && peer && (
            <div className="lounge-quick-peer" role="status" aria-live="polite">
              <h3 className="lounge-quick-hero__title">밥 같이 먹을 학우를 찾았어요</h3>
              <div className="lounge-quick-peer__card">
                <Avatar user={peer} size="lg" />
                <div>
                  <p className="bold">{peer.nickname}</p>
                  <p className="text-sub text-sm">{factLine(peer)}</p>
                </div>
              </div>
              <p className="text-sub text-sm">
                {iAccepted ? '상대가 수락하기를 기다리는 중이에요.' : '둘 다 수락하면 바로 약속이 만들어져요.'}
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
