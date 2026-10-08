/**
 * 가입·아이디 확인 API 클라이언트 — `/api/auth/*` 중 학교 인증 가입에 쓰는 것만 (서버: server/auth.ts).
 *
 * 학교 학번·비밀번호는 `schoolVerify` 의 요청 본문에만 실리고, 다른 어디에도 저장하거나 기록하지 않는다.
 * 가입(`signup`)에는 학교 평문이 없다 — 이미 학교 인증을 끝낸 증표(ticket)와, 브라우저가 봉인한 암호문만 간다.
 */
import { api } from '../api';
import type { AuthUser } from '../../../shared/auth';
import type { SchoolCredentials, SchoolSignupRequest, SchoolVerifyResponse } from '../../../shared/school/types';

export type SignupResponse = AuthUser & {
  school: { hint: string; department: string; admissionYear: number | null };
};

export const authApi = {
  /** 학교 계정으로 학생 인증 — 서버가 학교에 한 번 로그인해 보고 15분짜리 인증 확인표(ticket)를 준다 */
  schoolVerify: (creds: SchoolCredentials) => api.post<SchoolVerifyResponse>('/auth/school-verify', creds),
  usernameAvailable: (username: string) =>
    api.get<{ available: boolean; reason?: string }>(`/auth/username-available?username=${encodeURIComponent(username)}`),
  signup: (body: SchoolSignupRequest) => api.post<SignupResponse>('/auth/signup', body),
};
