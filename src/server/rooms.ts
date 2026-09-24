/**
 * 정원이 차면 단톡방을 연다. (담당: 한승원)
 *
 * 모임 도메인은 채팅을 전혀 모른다 — gathering.filled 이벤트만 보고 여기서 방을 만든다.
 * (미팅은 자리가 다 차는 순간, 밥약 빠른 매칭은 확정되는 순간 이 이벤트가 나간다)
 */
import { on } from '@/shared/events';
import { openRoom } from './chat-service';

const globalFlag = globalThis as unknown as { __bookeRooms?: boolean };

if (!globalFlag.__bookeRooms) {
  globalFlag.__bookeRooms = true;

  on('gathering.filled', (e) => {
    if (e.type !== 'gathering.filled') return;
    void openRoom(
      e.gatheringId,
      '자리가 다 찼어요! 여기서 만날 시간과 장소를 정해 보세요. 연락처는 공개되지 않아요.',
    );
  });
}
