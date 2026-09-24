/**
 * 밥약 프리셋. (담당: 한승원)
 *
 * 밥약은 팀 구성이 없어서 자리 그룹이 하나뿐이고, 대신 주최자가 신청을 받아 승인한다.
 * 밥은 아무나랑 먹는 게 아니고, 승인제로 두면 노쇼도 줄어든다.
 * (빠른 매칭으로 만들어지는 밥약은 이미 전원이 수락한 상태라 선착순 자리로 만든다 → quick-match.ts)
 */
import type { SlotSpec } from '@/domain/gathering';

export const MEAL_SLOT = 'table';

export const MEAL_PRESET = (capacity: number): { slots: SlotSpec[] } => ({
  slots: [{ key: MEAL_SLOT, label: '같이 먹을 사람', capacity }],
});

/** 밥약은 주최자 승인제. */
export const MEAL_JOIN_POLICY = 'approval' as const;

export const MEAL_CAPACITY_OPTIONS = [2, 3, 4] as const;

/** 장소 종류 — 빠른 매칭에서 조건으로도 쓴다. */
export const PLACE_TYPES = ['학식', '학교 주변', '기타'] as const;
export type PlaceType = (typeof PLACE_TYPES)[number];

export const MENU_CATEGORIES = ['상관없음', '한식', '중식', '일식', '양식', '분식', '아시안', '카페'] as const;

/** 분위기 태그. 밥약은 "누구랑 어떻게 먹느냐"가 중요해서 태그로 미리 맞춰둔다. */
export const MEAL_TAGS = ['선후배 밥약', '동기끼리', '조용히 먹기', '수다 환영', '같은 과만', '빨리 먹고 가기'] as const;
export type MealTag = (typeof MEAL_TAGS)[number];

/**
 * 시간대 — 빠른 매칭에서 "가능한 시간" 체크에 쓴다.
 * 분 단위로 고르게 하면 겹치는 사람이 거의 안 나와서 구간으로 묶었다.
 */
export const TIME_BANDS = [
  { key: 'b11', label: '11시~12시', startMin: 11 * 60 },
  { key: 'b12', label: '12시~13시', startMin: 12 * 60 },
  { key: 'b13', label: '13시~14시', startMin: 13 * 60 },
  { key: 'b17', label: '17시~18시', startMin: 17 * 60 },
  { key: 'b18', label: '18시~19시', startMin: 18 * 60 },
  { key: 'b19', label: '19시~20시', startMin: 19 * 60 },
] as const;

export type TimeBandKey = (typeof TIME_BANDS)[number]['key'];

export const timeBand = (key: string) => TIME_BANDS.find((b) => b.key === key);
