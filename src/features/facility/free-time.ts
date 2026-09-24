/**
 * 공강 시간표 연동 지점. (계약: 한승원 ↔ 시설예약 담당자)
 *
 * 시설 예약 기능에 공강 계산이 붙으면 이 파일의 freeSlotsOf만 진짜 구현으로 바꾸면 되고,
 * 밥약 목록의 "내 공강에 맞는 밥약만 보기" 필터가 그대로 살아난다.
 * 지금은 구현이 없다는 뜻으로 null을 돌려준다 (빈 배열이 아니다 — "공강이 없다"와 구분해야 해서).
 */
import type { ISODateTime } from '@/shared/types';

export type FreeSlot = { start: ISODateTime; end: ISODateTime };

/** 아직 시설예약 모듈이 없다. 담당자가 붙이면 true로 바뀐다. */
export const FREE_TIME_READY = false;

export async function freeSlotsOf(_userId: string, _date: string): Promise<FreeSlot[] | null> {
  return null;
}

/** 어떤 시각이 내 공강 안에 들어가는지. 필터 로직은 여기 있으니 구현만 오면 바로 동작한다. */
export const isInFreeSlot = (slots: FreeSlot[], at: ISODateTime): boolean =>
  slots.some((s) => s.start <= at && at < s.end);
