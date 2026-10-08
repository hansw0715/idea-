import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '../../api';
import { EMOTE_TTL_MS, PRESENCE_POLL_MS } from '../../../../shared/lounge';
import type { EmoteKey, PresenceUser, Zone } from '../../../../shared/lounge';
import { loungeApi } from '../api';
import { useLounge } from '../LoungeContext';
import { clampPoint, zoneAt } from './layout';

/** 걷는 데 걸리는 시간. 이 시간이 지나 도착하면 서버에 새 위치를 알린다 (world.css 의 transition 과 같은 값) */
export const WALK_MS = 900;
/** 움직이지 않아도 서버가 45초 안에 나를 지우지 않도록 보내는 신호 간격 */
const HEARTBEAT_MS = 20_000;

export type MyPlace = { x: number; y: number; zone: Zone };
export type SendResult = 'ok' | 'rate' | 'banned' | 'error' | 'skip';

const reducedMotion = (): boolean => {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
};

const round4 = (n: number): number => Math.round(n * 10000) / 10000;

/** 새로 고쳐도 같은 자리에서 시작하도록 탭 안에서만 기억한다 (실패해도 광장에서 시작할 뿐이다) */
function startPlace(key: string): MyPlace {
  try {
    const raw = sessionStorage.getItem(key);
    if (raw) {
      const p = JSON.parse(raw) as { x?: unknown; y?: unknown };
      if (typeof p.x === 'number' && typeof p.y === 'number') {
        const c = clampPoint(p.x, p.y);
        return { ...c, zone: zoneAt(c.x, c.y) };
      }
    }
  } catch {
    /* 저장소를 못 쓰는 환경 */
  }
  // 광장 분수 아래 줄에 흩어져 서도록 약간 무작위 (여러 명이 한 점에 겹치지 않게)
  const x = round4(0.28 + Math.random() * 0.44);
  const y = round4(0.1 + Math.random() * 0.03);
  return { x, y, zone: 'plaza' };
}

/**
 * 라운지 접속자: 3초마다 읽기(탭이 보일 때만) + 내 위치 보내기(도착 때, 20초 하트비트, 이모트).
 *
 * - enabled=false(프로필 없음·정지·로딩) 이면 아무 호출도 하지 않는다.
 * - 읽기가 실패해도 마지막 값을 유지한다. 두 번 연속 실패하면 `stale` 로 조용히 알린다.
 * - 탭이 숨겨지면 읽기·하트비트를 모두 멈추고, 다시 보이면 즉시 한 번 한다.
 * - 새 목적지를 걷는 도중 눌러도 마지막 목적지로만 한 번 보낸다(타이머를 새로 건다).
 */
export function usePresence({ enabled, canMove, userId }: { enabled: boolean; canMove: boolean; userId: string }) {
  const { handleError } = useLounge();
  const handleErrorRef = useRef(handleError);
  handleErrorRef.current = handleError;

  const storeKey = `sangsang-lounge-pos-${userId}`;
  const [users, setUsers] = useState<PresenceUser[]>([]);
  const [count, setCount] = useState<number | null>(null);
  const [pollFailed, setPollFailed] = useState(false);
  const [sendFailed, setSendFailed] = useState(false);
  const [banMessage, setBanMessage] = useState<string | null>(null);
  const [me, setMe] = useState<MyPlace>(() => startPlace(storeKey));
  const [myEmote, setMyEmote] = useState<EmoteKey | null>(null);

  const posRef = useRef(me);
  const walkTimer = useRef<number | undefined>(undefined);
  const emoteTimer = useRef<number | undefined>(undefined);
  const sigRef = useRef('');
  const pollNow = useRef<() => void>(() => undefined);

  const allowSend = enabled && canMove && banMessage === null;
  const allowSendRef = useRef(allowSend);
  allowSendRef.current = allowSend;

  const sendNow = useCallback(async (emote?: EmoteKey): Promise<SendResult> => {
    if (!allowSendRef.current) return 'skip';
    const p = posRef.current;
    try {
      await loungeApi.sendPresence(emote ? { x: p.x, y: p.y, zone: p.zone, emote } : { x: p.x, y: p.y, zone: p.zone });
      setSendFailed(false);
      return 'ok';
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.code === 'BANNED') {
          setBanMessage(err.message);
          return 'banned';
        }
        if (err.code === 'RATE_LIMITED' || err.status === 429) return 'rate';
        if (handleErrorRef.current(err)) return 'skip';
      }
      setSendFailed(true);
      return 'error';
    }
  }, []);

  /** 빈 바닥을 눌렀다: 그 위치로 걷기 시작하고, 도착할 즈음 서버에 알린다 */
  const moveTo = useCallback(
    (x: number, y: number) => {
      if (!allowSendRef.current) return;
      const c = clampPoint(x, y);
      const next: MyPlace = { ...c, zone: zoneAt(c.x, c.y) };
      posRef.current = next;
      setMe(next);
      try {
        sessionStorage.setItem(storeKey, JSON.stringify({ x: next.x, y: next.y }));
      } catch {
        /* 저장 실패는 무시 */
      }
      window.clearTimeout(walkTimer.current);
      walkTimer.current = window.setTimeout(() => void sendNow(), reducedMotion() ? 0 : WALK_MS + 50);
    },
    [sendNow, storeKey],
  );

  const sendEmote = useCallback(
    async (key: EmoteKey): Promise<SendResult> => {
      if (!allowSendRef.current) return 'skip';
      setMyEmote(key);
      window.clearTimeout(emoteTimer.current);
      emoteTimer.current = window.setTimeout(() => setMyEmote(null), EMOTE_TTL_MS);
      const result = await sendNow(key);
      if (result !== 'ok') {
        window.clearTimeout(emoteTimer.current);
        setMyEmote(null);
      }
      return result;
    },
    [sendNow],
  );

  // 입장 알림 + 20초 하트비트 (탭이 보일 때만)
  useEffect(() => {
    if (!allowSend) return;
    const beat = () => {
      if (document.visibilityState === 'visible') void sendNow();
    };
    beat();
    const timer = window.setInterval(beat, HEARTBEAT_MS);
    document.addEventListener('visibilitychange', beat);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', beat);
    };
  }, [allowSend, sendNow]);

  // 3초 폴링 (탭이 보일 때만). 타이머는 요청이 끝난 뒤에 다시 걸어 요청이 겹치지 않게 한다.
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    let busy = false;
    let fails = 0;
    let timer: number | undefined;

    const schedule = (ms: number) => {
      window.clearTimeout(timer);
      if (alive && document.visibilityState === 'visible') timer = window.setTimeout(() => void tick(), ms);
    };

    const tick = async () => {
      if (!alive || busy) return;
      busy = true;
      try {
        const res = await loungeApi.presence();
        if (!alive) return;
        fails = 0;
        setPollFailed(false);
        const next = res.users.map((p) => ({ ...p, x: round4(p.x), y: round4(p.y) }));
        // 아무도 안 움직였으면 상태를 바꾸지 않는다 (3초마다 지도 전체가 다시 그려지지 않게)
        const sig = `${res.count}#${next.map((p) => `${p.user.id}|${p.x}|${p.y}|${p.emote ?? ''}|${p.user.nickname}|${p.user.avatar}|${p.user.avatarColor}`).join(';')}`;
        if (sig !== sigRef.current) {
          sigRef.current = sig;
          setUsers(next);
          setCount(res.count);
        }
      } catch (err) {
        if (!alive) return;
        // 프로필이 없으면 프로필 시트가 열린다. 그 밖의 실패는 마지막 값을 그대로 두고 조용히 표시한다.
        handleErrorRef.current(err);
        fails += 1;
        if (fails >= 2) setPollFailed(true);
      } finally {
        busy = false;
        // 실패가 이어지면 조금씩 늦춘다 (서버가 힘들 때 3초마다 계속 두드리지 않게)
        schedule(fails === 0 ? PRESENCE_POLL_MS : Math.min(PRESENCE_POLL_MS * (fails + 1), 12_000));
      }
    };

    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        window.clearTimeout(timer);
        void tick();
      } else {
        window.clearTimeout(timer);
      }
    };

    pollNow.current = () => {
      window.clearTimeout(timer);
      void tick();
    };
    document.addEventListener('visibilitychange', onVisibility);
    if (document.visibilityState === 'visible') void tick();

    return () => {
      alive = false;
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibility);
      pollNow.current = () => undefined;
    };
  }, [enabled]);

  // 화면을 떠날 때 걷기·이모트 타이머를 정리한다
  useEffect(
    () => () => {
      window.clearTimeout(walkTimer.current);
      window.clearTimeout(emoteTimer.current);
    },
    [],
  );

  const refresh = useCallback(() => pollNow.current(), []);

  return {
    users,
    count,
    /** 접속자 정보를 새로 받지 못하고 있다 (마지막 값을 보여 주는 중) */
    stale: pollFailed || sendFailed,
    me,
    myEmote,
    /** 서버가 정지로 거절했을 때의 사유 문장 */
    banMessage,
    moveTo,
    sendEmote,
    refresh,
  };
}
