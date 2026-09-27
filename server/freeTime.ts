export interface Interval {
  start: number;
  end: number;
}

/** 겹치거나 맞닿은 구간을 하나로 합친다. */
export function mergeIntervals(list: Interval[]): Interval[] {
  const sorted = [...list].sort((a, b) => a.start - b.start);
  const out: Interval[] = [];
  for (const iv of sorted) {
    const last = out[out.length - 1];
    if (last && iv.start <= last.end) {
      last.end = Math.max(last.end, iv.end);
    } else {
      out.push({ ...iv });
    }
  }
  return out;
}

/** [open, close) 운영 시간에서 busy 구간을 뺀 여유 구간을 구한다. */
export function freeWithin(busy: Interval[], open: number, close: number): Interval[] {
  const merged = mergeIntervals(busy);
  const out: Interval[] = [];
  let cursor = open;
  for (const iv of merged) {
    if (iv.end <= open || iv.start >= close) continue;
    const start = Math.max(iv.start, open);
    if (start > cursor) out.push({ start: cursor, end: start });
    cursor = Math.max(cursor, Math.min(iv.end, close));
  }
  if (cursor < close) out.push({ start: cursor, end: close });
  return out;
}
