interface Bucket {
  count: number;
  resetAt: number;
}

/** 의존성 없는 간단한 고정 윈도 레이트리미터. */
export function createRateLimiter(max: number, windowMs: number) {
  const buckets = new Map<string, Bucket>();
  return {
    /** 허용되면 true, 한도를 넘었으면 false. */
    hit(key: string): boolean {
      const now = Date.now();
      const bucket = buckets.get(key);
      if (!bucket || bucket.resetAt <= now) {
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
  };
}
