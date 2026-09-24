/**
 * 도메인 이벤트. (담당: 공용)
 *
 * 머지 전략의 핵심: 미팅/밥약 모듈은 노쇼 관리나 관리자 대시보드 코드를 직접 부르지 않는다.
 * 대신 "무슨 일이 일어났는지"만 발행하고, 팀빌딩 담당자가 자기 모듈에서 구독해 간다.
 * 서로의 파일을 안 건드리므로 각자 개발하다 합쳐도 충돌이 안 난다.
 *
 *   // 친구 쪽 코드 예시 (features/team-building/subscribe.ts)
 *   on('participant.noshow', (e) => decreaseTrust(e.userId));
 */
import type { GatheringId, ISODateTime, UserId } from './types';

export type DomainEvent =
  | { type: 'gathering.created'; gatheringId: GatheringId; hostId: UserId; kind: string; at: ISODateTime }
  | { type: 'gathering.joined'; gatheringId: GatheringId; userId: UserId; at: ISODateTime }
  | { type: 'gathering.left'; gatheringId: GatheringId; userId: UserId; at: ISODateTime }
  | { type: 'gathering.filled'; gatheringId: GatheringId; at: ISODateTime }
  | { type: 'gathering.cancelled'; gatheringId: GatheringId; at: ISODateTime }
  | { type: 'participant.reviewed'; gatheringId: GatheringId; userId: UserId; mark: 'good' | 'soso' | 'noshow'; at: ISODateTime }
  /** 같이 만난 사람 전원이 '안 왔어요'를 눌러 노쇼가 확정된 순간 (한 모임에서 한 번만) */
  | { type: 'participant.noshow'; gatheringId: GatheringId; userId: UserId; at: ISODateTime };

export type EventType = DomainEvent['type'];
type Handler = (event: DomainEvent) => void;

const handlers = new Map<EventType, Set<Handler>>();

export function on(type: EventType, handler: Handler): () => void {
  const set = handlers.get(type) ?? new Set<Handler>();
  set.add(handler);
  handlers.set(type, set);
  return () => set.delete(handler);
}

export function emit(event: DomainEvent): void {
  for (const handler of handlers.get(event.type) ?? []) {
    // 구독자 한 명이 터져도 본 흐름(참여 신청 등)은 성공해야 한다.
    try {
      handler(event);
    } catch (e) {
      console.error(`[events] ${event.type} 구독자에서 에러:`, e);
    }
  }
}
