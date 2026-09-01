/**
 * 미팅 프리셋. (담당: 한승원)
 *
 * 미팅은 개인이 아무 데나 선착순으로 붙으면 2:2 구성이 깨진다.
 * 그래서 "우리 쪽 / 상대 쪽" 두 자리 그룹을 만들어 두고 빈 의자에 앉는 방식으로 간다.
 * 카톡 선착순 감성은 그대로면서 인원 구성은 안 무너진다.
 */
import type { SlotSpec } from '@/domain/gathering';

export const MEETUP_HOST_SLOT = 'host';
export const MEETUP_GUEST_SLOT = 'guest';

export type MeetupSize = '1:1' | '2:2' | '3:3' | '4:4';

const preset = (size: MeetupSize, n: number): { size: MeetupSize; slots: SlotSpec[] } => ({
  size,
  slots: [
    { key: MEETUP_HOST_SLOT, label: '우리 쪽', capacity: n },
    { key: MEETUP_GUEST_SLOT, label: '상대 쪽', capacity: n },
  ],
});

export const MEETUP_PRESETS: Record<MeetupSize, { size: MeetupSize; slots: SlotSpec[] }> = {
  '1:1': preset('1:1', 1),
  '2:2': preset('2:2', 2),
  '3:3': preset('3:3', 3),
  '4:4': preset('4:4', 4),
};

export const MEETUP_SIZES = Object.keys(MEETUP_PRESETS) as MeetupSize[];

/** 미팅은 선착순이라 누르는 즉시 확정된다. */
export const MEETUP_JOIN_POLICY = 'auto' as const;
