/**
 * 현재 사용자. (임시 — 로그인/학교 메일 인증은 팀빌딩 담당자가 붙일 예정)
 *
 * 지금은 쿠키에 사용자 id만 넣어두고 화면 상단에서 계정을 바꿔 끼울 수 있게 했다.
 * 시연할 때 혼자서 주최자/참여자 양쪽을 다 보여줄 수 있어서 이 방식이 편하다.
 * 나중에 진짜 인증이 붙으면 이 파일의 currentUser()만 바꾸면 되고 나머지는 그대로다.
 */
import { cookies } from 'next/headers';
import { asUserId, type UserId } from '@/shared/types';
import type { User } from '@/shared/user';
import { userRepo, DEFAULT_USER_ID } from './repo/memory-repo';

export const SESSION_COOKIE = 'booke_uid';

export async function currentUserId(): Promise<UserId> {
  const jar = await cookies();
  const raw = jar.get(SESSION_COOKIE)?.value;
  return raw ? asUserId(raw) : DEFAULT_USER_ID;
}

export async function currentUser(): Promise<User | null> {
  return userRepo.find(await currentUserId());
}
