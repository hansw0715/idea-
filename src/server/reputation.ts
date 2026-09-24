/**
 * 평판 이벤트 구독. (담당: 한승원)
 *
 * 미팅/밥약 도메인은 온도 계산을 전혀 모른다. "무슨 일이 있었는지"만 이벤트로 내보내고,
 * 온도와 경고를 실제로 바꾸는 건 이 파일이다. 정책을 바꾸려면 domain/reputation만 고치면 된다.
 */
import { on } from '@/shared/events';
import { asUserId } from '@/shared/types';
import { applyReview, confirmNoshow } from '@/domain/reputation/reputation';
import { userRepo } from './repo/memory-repo';

const globalFlag = globalThis as unknown as { __bookeSubscribed?: boolean };

if (!globalFlag.__bookeSubscribed) {
  globalFlag.__bookeSubscribed = true;

  on('participant.reviewed', (e) => {
    if (e.type !== 'participant.reviewed' || e.mark === 'noshow') return;
    void update(e.userId, (u) => applyReview(u, e.mark));
  });

  // 노쇼는 "전원이 안 왔어요를 눌렀을 때" 한 번만 온다. 여기서 온도를 깎고 경고를 쌓는다.
  on('participant.noshow', (e) => {
    if (e.type !== 'participant.noshow') return;
    void update(e.userId, confirmNoshow);
  });
}

async function update(
  userId: string,
  change: (u: { temperature: number; warnings: number; banned: boolean }) => {
    temperature: number;
    warnings: number;
    banned: boolean;
  },
) {
  const user = await userRepo.find(asUserId(userId));
  if (!user) return;
  await userRepo.save({ ...user, ...change(user) });
}
