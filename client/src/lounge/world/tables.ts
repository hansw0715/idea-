/** 모임 목록에서 쓰는 작은 판별 함수. (지도·테이블 그림은 없앴다 — 라운지는 밥약·미팅 두 버튼으로 시작한다) */
import type { GatheringView } from '../../../../shared/lounge';

export const isEnded = (g: GatheringView): boolean => g.status === 'done' || g.status === 'cancelled';
