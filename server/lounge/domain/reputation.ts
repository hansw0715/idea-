/**
 * 매너온도 · 노쇼 경고. (ZIP domain/reputation 이식)
 *
 * 당근마켓 매너온도처럼 36.5도에서 시작한다. 모임이 끝나면 같이 만난 사람끼리 서로 평가하고,
 * 그 결과로 온도가 오르내린다. 주최자 혼자 판단하지 않는 이유는 간단하다 —
 * 주최자와 사이가 틀어졌다고 노쇼로 찍히면 안 되기 때문.
 *
 * 노쇼는 **같이 만난 다른 사람 전원**이 "안 왔어요"를 눌러야 확정된다(sealed). 단 그 "다른 사람"이 2명 이상일 때만이다
 * (둘뿐인 모임에서는 상대 한 명의 주장으로 벌점이 찍히지 않는다 — domain/gathering 의 NOSHOW_MIN_REVIEWERS).
 * 확정되면 경고 1회, 경고 2회면 미팅·밥약 이용이 막힌다. 해제는 관리자만.
 *
 * 전부 순수 함수. 누가 언제 평가했는지는 domain/gathering 의 reviews 가 들고 있다.
 * 상수(36.5 · 0.4 · −5 · 2회)는 shared/lounge/constants 가 한 곳에서 정한다 — 서버 SQL(users.ts)도 같은 값을 쓴다.
 */
import type { ReviewMark } from '../../../shared/lounge/gathering.js';
import {
  DEFAULT_TEMPERATURE,
  GOOD_DELTA,
  MAX_TEMPERATURE,
  MIN_TEMPERATURE,
  NOSHOW_DELTA,
  REVIEW_LABEL,
  WARNINGS_TO_BAN,
  temperatureFace,
} from '../../../shared/lounge/constants.js';

export type { ReviewMark };
// 테스트와 다른 작업자가 한 곳(reputation)에서 꺼내 쓸 수 있게 shared 의 값을 그대로 다시 내보낸다.
export {
  DEFAULT_TEMPERATURE,
  GOOD_DELTA,
  MAX_TEMPERATURE,
  MIN_TEMPERATURE,
  NOSHOW_DELTA,
  REVIEW_LABEL,
  WARNINGS_TO_BAN,
  temperatureFace,
};

/** 사용자에 붙는 평판 상태 (users 테이블의 temperature · warnings · banned) */
export type ReputationState = {
  /** 매너온도 */
  temperature: number;
  /** 확정된 노쇼 횟수 */
  warnings: number;
  /** 경고가 쌓여(또는 신고가 쌓여) 이용이 막힌 상태 */
  banned: boolean;
};

/** 정지 여부만 필요한 곳(참여 자격 검사)에서 쓰는 최소 형태 */
export type BanState = Pick<ReputationState, 'warnings' | 'banned'>;

export const initialReputation = (): ReputationState => ({
  temperature: DEFAULT_TEMPERATURE,
  warnings: 0,
  banned: false,
});

/** 소수점 한 자리로 고정 — 0.1씩 어긋난 값이 화면에 뜨는 걸 막는다. (서버 SQL 도 ROUND(…, 1) 로 같게 맞춘다) */
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

/** 관리자가 정지를 푼다. 억울한 노쇼였던 경우라 경고도 같이 지운다. (온도는 기록이라 그대로 둔다) */
export const liftBan = (state: ReputationState): ReputationState => ({ ...state, warnings: 0, banned: false });

/**
 * 참여를 막아야 하는 이유. null 이면 참여 가능.
 * 정지 사유가 노쇼인지 신고 누적인지에 따라 문구가 달라진다 — 본인이 왜 막혔는지 알아야 하니까.
 * (온도는 보지 않으므로 `{banned, warnings}` 만 있으면 된다)
 */
export function joinBlockReason(state: BanState & { temperature?: number }): string | null {
  if (!state.banned) return null;
  return state.warnings >= WARNINGS_TO_BAN
    ? `노쇼 경고 ${WARNINGS_TO_BAN}회로 이용이 정지됐어요.`
    : '신고가 누적돼 이용이 정지됐어요. 관리자 확인 후 풀립니다.';
}
