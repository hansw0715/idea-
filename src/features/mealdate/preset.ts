/**
 * 밥약 프리셋. (담당: 한승원)
 *
 * 밥약은 팀 구성이 없어서 자리 그룹이 하나뿐이고, 대신 주최자가 신청을 받아 승인한다.
 * 밥은 아무나랑 먹는 게 아니고, 승인제로 두면 노쇼도 줄어든다.
 */
import type { SlotSpec } from '@/domain/gathering';

export const MEAL_SLOT = 'table';

export const MEAL_PRESET = (capacity: number): { slots: SlotSpec[] } => ({
  slots: [{ key: MEAL_SLOT, label: '같이 먹을 사람', capacity }],
});

/** 밥약은 주최자 승인제. */
export const MEAL_JOIN_POLICY = 'approval' as const;

export const MEAL_CAPACITY_OPTIONS = [2, 3, 4, 5, 6] as const;
