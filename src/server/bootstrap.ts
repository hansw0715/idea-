/**
 * 이벤트 구독 등록. (임시 — 팀빌딩/노쇼 관리 담당자가 가져갈 부분)
 *
 * 신뢰도를 어떻게 깎고 언제 복구할지는 노쇼 관리 담당자의 정책이다.
 * 지금은 미팅/밥약 화면에서 노쇼 흐름을 시연할 수 있게 최소 구현만 넣어뒀다.
 * 담당자가 features/team-building/trust.ts 같은 걸 만들면 여기 두 줄을 그쪽 호출로 바꾸면 끝.
 */
import { on } from '@/shared/events';
import { asUserId } from '@/shared/types';
import { userRepo } from './repo/memory-repo';

const NOSHOW_PENALTY = 25;
const ATTEND_REWARD = 5;

const globalFlag = globalThis as unknown as { __bookeSubscribed?: boolean };

if (!globalFlag.__bookeSubscribed) {
  globalFlag.__bookeSubscribed = true;

  on('participant.noshow', (e) => {
    if (e.type !== 'participant.noshow') return;
    void adjustTrust(e.userId, -NOSHOW_PENALTY);
  });

  on('participant.attended', (e) => {
    if (e.type !== 'participant.attended') return;
    void adjustTrust(e.userId, ATTEND_REWARD);
  });
}

async function adjustTrust(userId: string, delta: number) {
  const user = await userRepo.find(asUserId(userId));
  if (!user) return;
  const trustScore = Math.max(0, Math.min(100, user.trustScore + delta));
  await userRepo.save({ ...user, trustScore });
}
