/**
 * 매너온도 · 노쇼 경고. (담당: 한승원)
 *
 * 당근마켓 매너온도처럼 36.5도에서 시작한다. 모임이 끝나면 같이 만난 사람끼리 서로 평가하고,
 * 그 결과로 온도가 오르내린다. 주최자 혼자 판단하지 않는 이유는 간단하다 —
 * 주최자와 사이가 틀어졌다고 노쇼로 찍히면 안 되기 때문.
 *
 * 노쇼는 **같이 만난 다른 사람 전원**이 "안 왔어요"를 눌러야 확정된다(sealed).
 * 확정되면 경고 1회, 경고 2회면 미팅·밥약 이용이 막힌다. 해제는 관리자만.
 *
 * 전부 순수 함수. 누가 언제 평가했는지는 domain/gathering의 reviews가 들고 있다.
 */
import type { ISODateTime } from '@/shared/types';

/** 모임이 끝난 뒤 서로에게 남기는 평가 */
export type ReviewMark = 'good' | 'soso' | 'noshow';

export const REVIEW_LABEL: Record<ReviewMark, string> = {
  good: '좋았어요',
  soso: '보통이에요',
  noshow: '안 왔어요',
};

/** 사용자에 붙는 평판 상태 (User가 이 필드들을 그대로 갖고 있다) */
export type ReputationState = {
  /** 매너온도 */
  temperature: number;
  /** 확정된 노쇼 횟수 */
  warnings: number;
  /** 경고가 쌓여 이용이 막힌 상태 */
  banned: boolean;
};

export const DEFAULT_TEMPERATURE = 36.5;
export const MIN_TEMPERATURE = 0;
export const MAX_TEMPERATURE = 99;

/** 좋았어요 한 번에 오르는 온도 */
export const GOOD_DELTA = 0.4;
/** 노쇼 확정 시 떨어지는 온도 */
export const NOSHOW_DELTA = -5;
/** 이 횟수만큼 노쇼가 확정되면 이용 정지 */
export const WARNINGS_TO_BAN = 2;

export const initialReputation = (): ReputationState => ({
  temperature: DEFAULT_TEMPERATURE,
  warnings: 0,
  banned: false,
});

/** 소수점 한 자리로 고정 — 0.1씩 어긋난 값이 화면에 뜨는 걸 막는다. */
const clamp = (t: number) => Math.round(Math.min(MAX_TEMPERATURE, Math.max(MIN_TEMPERATURE, t)) * 10) / 10;

/** 평가 한 건이 온도에 주는 영향. 노쇼는 따로(confirmNoshow) 처리한다. */
export function applyReview(state: ReputationState, mark: ReviewMark): ReputationState {
  if (mark !== 'good') return state;
  return { ...state, temperature: clamp(state.temperature + GOOD_DELTA) };
}

/** 노쇼가 확정됐을 때. 경고가 쌓이면 자동으로 이용 정지된다. */
export function confirmNoshow(state: ReputationState): ReputationState {
  const warnings = state.warnings + 1;
  return {
    temperature: clamp(state.temperature + NOSHOW_DELTA),
    warnings,
    banned: warnings >= WARNINGS_TO_BAN,
  };
}

/** 관리자가 정지를 푼다. 억울한 노쇼였던 경우라 경고도 같이 지운다. */
export const liftBan = (state: ReputationState): ReputationState => ({ ...state, warnings: 0, banned: false });

/**
 * 참여를 막아야 하는 이유. null이면 참여 가능.
 * 정지 사유가 노쇼인지 신고 누적인지에 따라 문구가 달라진다 — 본인이 왜 막혔는지 알아야 하니까.
 */
export function joinBlockReason(state: ReputationState): string | null {
  if (!state.banned) return null;
  return state.warnings >= WARNINGS_TO_BAN
    ? `노쇼 경고 ${WARNINGS_TO_BAN}회로 이용이 정지됐어요.`
    : '신고가 누적돼 이용이 정지됐어요. 관리자 확인 후 풀립니다.';
}

/** 화면 표시용: 온도에 따른 얼굴과 색 */
export function temperatureFace(temperature: number): { emoji: string; tone: 'danger' | 'neutral' | 'brand' | 'success' } {
  if (temperature < 30) return { emoji: '😰', tone: 'danger' };
  if (temperature < 36.5) return { emoji: '😐', tone: 'neutral' };
  if (temperature < 42) return { emoji: '🙂', tone: 'brand' };
  return { emoji: '😄', tone: 'success' };
}

export type ReputationEvent = {
  at: ISODateTime;
  delta: number;
  reason: string;
};
