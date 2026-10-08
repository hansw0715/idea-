import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { GatheringView } from '../../../../shared/lounge';
import { loungeApi } from '../api';
import { useLounge } from '../LoungeContext';

/** 모임 목록 갱신 간격. 접속자(3초)보다 느려도 되는 값이다 — 모임은 사람이 직접 만들고 앉을 때만 바뀐다. */
export const GATHERINGS_POLL_MS = 5000;

const isMine = (g: GatheringView) => g.viewer.isHost || g.viewer.isMember || g.viewer.isApplicant;

/**
 * 모임 목록 폴링(5초, 탭이 보일 때만)과 즉시 갱신.
 *  - all : 지도·게시판·목록이 보는 전체 (공개 목록 ∪ 내 모임; 목록이 100개로 잘려도 내 모임은 빠지지 않는다)
 *  - mine: 내 약속 (목록 모드)
 * 시트에서 모임이 바뀌면 `upsert` 로 화면을 먼저 고치고 곧바로 다시 읽는다. 읽는 중에 바뀐 경우
 * 오래된 응답이 화면을 되돌리지 않도록 응답을 버리고 다시 읽는다(epoch).
 * 실패해도 마지막 값을 유지하고, 한 번도 못 읽었을 때만 `error` 를 알린다.
 */
export function useGatherings(enabled: boolean) {
  const { handleError } = useLounge();
  const handleErrorRef = useRef(handleError);
  handleErrorRef.current = handleError;

  const [list, setList] = useState<GatheringView[]>([]);
  const [mineList, setMineList] = useState<GatheringView[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);

  const epoch = useRef(0);
  const cache = useRef(new Map<string, { json: string; view: GatheringView }>());
  const readNow = useRef<() => void>(() => undefined);

  /** 내용이 같은 모임은 이전 객체를 그대로 쓴다 → 지도의 테이블이 바뀐 것만 다시 그려진다 */
  const stable = useCallback((next: GatheringView[]): GatheringView[] => {
    return next.map((g) => {
      const json = JSON.stringify(g);
      const hit = cache.current.get(g.id);
      if (hit && hit.json === json) return hit.view;
      cache.current.set(g.id, { json, view: g });
      return g;
    });
  }, []);

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
      const started = epoch.current;
      let again = false;
      try {
        const [all, mine] = await Promise.all([loungeApi.gatherings(), loungeApi.mine()]);
        if (!alive) return;
        if (started !== epoch.current) {
          again = true; // 읽는 동안 모임이 바뀌었다: 이 응답은 버리고 바로 다시 읽는다
          return;
        }
        const merged = new Map<string, GatheringView>();
        for (const g of all) merged.set(g.id, g);
        for (const g of mine) if (!merged.has(g.id)) merged.set(g.id, g);
        setList(stable([...merged.values()]));
        setMineList(stable(mine));
        // 목록에서 사라진 모임의 캐시는 버린다 (오래 켜 둬도 메모리가 늘지 않게)
        for (const id of cache.current.keys()) if (!merged.has(id)) cache.current.delete(id);
        setLoaded(true);
        setError(null);
        setStale(false);
        fails = 0;
      } catch (err) {
        if (!alive) return;
        handleErrorRef.current(err);
        fails += 1;
        setError(err instanceof Error ? err.message : '모임 목록을 불러오지 못했습니다.');
        setStale(true);
      } finally {
        busy = false;
        schedule(again ? 200 : fails === 0 ? GATHERINGS_POLL_MS : Math.min(GATHERINGS_POLL_MS * (fails + 1), 20_000));
      }
    };

    const onVisibility = () => {
      window.clearTimeout(timer);
      if (document.visibilityState === 'visible') void tick();
    };

    readNow.current = () => {
      window.clearTimeout(timer);
      void tick();
    };
    document.addEventListener('visibilitychange', onVisibility);
    if (document.visibilityState === 'visible') void tick();

    return () => {
      alive = false;
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibility);
      readNow.current = () => undefined;
    };
  }, [enabled, stable]);

  /** 서버에서 바로 다시 읽는다 (모임을 만들거나 앉은 직후) */
  const refresh = useCallback(() => {
    epoch.current += 1;
    readNow.current();
  }, []);

  /** 시트가 알려 준 최신 view 로 화면을 먼저 고친다 */
  const upsert = useCallback(
    (g: GatheringView) => {
      epoch.current += 1;
      setList((prev) => stable(prev.some((x) => x.id === g.id) ? prev.map((x) => (x.id === g.id ? g : x)) : [g, ...prev]));
      setMineList((prev) => {
        const without = prev.filter((x) => x.id !== g.id);
        return stable(isMine(g) && g.status !== 'cancelled' ? [...without, g] : without);
      });
      setLoaded(true);
    },
    [stable],
  );

  return useMemo(
    () => ({ all: list, mine: mineList, loaded, error, stale, refresh, upsert }),
    [list, mineList, loaded, error, stale, refresh, upsert],
  );
}
