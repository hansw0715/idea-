/** 권한 검사. API 라우트 맨 앞에서 부른다. (담당: 공용) */
import { fail, ok, type Result } from '@/shared/types';
import { isAdmin, type User } from '@/shared/user';
import { currentUser } from './session';

export async function requireAdmin(): Promise<Result<User>> {
  const me = await currentUser();
  if (!me) return fail('FORBIDDEN', '로그인이 필요합니다.');
  if (!isAdmin(me)) return fail('FORBIDDEN', '관리자만 할 수 있습니다.');
  return ok(me);
}
