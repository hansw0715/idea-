interface Bucket {
  count: number;
  resetAt: number;
}

/** 한 제한 장치가 기억하는 키의 최대 수. 넘으면 시간이 지난 칸부터 비우고, 그래도 넘으면 가장 오래된 칸을 버린다. */
export const RATE_LIMIT_MAX_KEYS = 10_000;

/** 의존성 없는 간단한 고정 윈도 레이트리미터. */
export function createRateLimiter(max: number, windowMs: number, maxKeys: number = RATE_LIMIT_MAX_KEYS) {
  const buckets = new Map<string, Bucket>();

  /** 긴 키·많은 키로 서버 메모리가 계속 늘지 않게 한다 */
  function prune(now: number): void {
    for (const [key, b] of buckets) {
      if (b.resetAt <= now) buckets.delete(key);
    }
    // Map 은 넣은 순서를 지키므로 앞쪽이 가장 오래된 칸이다
    for (const key of buckets.keys()) {
      if (buckets.size < maxKeys) break;
      buckets.delete(key);
    }
  }

  return {
    /** 허용되면 true, 한도를 넘었으면 false. */
    hit(key: string): boolean {
      const now = Date.now();
      const bucket = buckets.get(key);
      if (!bucket || bucket.resetAt <= now) {
        if (!bucket && buckets.size >= maxKeys) prune(now);
        buckets.set(key, { count: 1, resetAt: now + windowMs });
        return true;
      }
      if (bucket.count >= max) return false;
      bucket.count += 1;
      return true;
    },
    clear(key: string): void {
      buckets.delete(key);
    },
    /** 지금 기억하는 키의 수 (시험용) */
    size(): number {
      return buckets.size;
    },
  };
}
