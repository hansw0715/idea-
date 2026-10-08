/**
 * 연동·해제·"풀어서 쓰기" 흐름 — 금고(vault)와 서버(remote)를 순서대로 엮는 순수 로직.
 * SchoolContext 가 이것을 부르고, react 없이 단위 테스트한다 (linkFlow.test.ts).
 *
 * 키는 로그인·가입 때 플랫폼 아이디·비밀번호에서 만들어 이 기기에 저장돼 있다(vault.deriveKey / saveKey). 여기서는 그 키를 쓴다.
 *
 * 지키는 순서 규칙
 *  1. 저장소·암호화를 못 쓰거나 이 기기에 키가 없으면 학교에 요청하기 전에 멈춘다.
 *  2. 학교 기능을 쓸 때는 매번 서버의 최신 암호문을 받아 푼다. 풀리지 않으면(옛 방식 암호문·다른 비밀번호로 만든 키 등)
 *     학교에 요청하지 않고 멈춘다 (옛 비밀번호를 보내 학교 쪽 실패 횟수를 늘리지 않는다).
 *  3. 연동을 해제해도 키는 지우지 않는다 — 키는 이 계정의 로그인에서 나온 것이라 다시 연동할 때 그대로 쓴다.
 */
import { ApiError } from '../api';
import type {
  LinkRequest,
  LinkResponse,
  LinkStatus,
  SchoolCredentials,
  SchoolProfile,
} from '../../../shared/school/types';
import type { Vault } from './vault';

/** 이 흐름이 서버에 요구하는 것 (schoolApi 가 만족한다. 시험에서는 가짜를 넣는다) */
export interface SchoolRemote {
  getLink(): Promise<LinkStatus>;
  link(body: LinkRequest): Promise<LinkResponse>;
  unlink(): Promise<{ ok: true }>;
}

export interface FlowDeps {
  vault: Vault;
  remote: SchoolRemote;
}

export async function linkAccount(
  { vault, remote }: FlowDeps,
  userId: number,
  username: string,
  creds: SchoolCredentials,
): Promise<SchoolProfile> {
  vault.assertReady();
  // 이 기기에 저장된 키로 봉인한다. 키가 없으면 SchoolKeyMissingError (로그아웃 후 다시 로그인하면 키가 만들어진다)
  const cipher = await vault.seal(userId, username, creds);
  const response = await remote.link({ creds, cipher });
  return response.profile;
}

export async function unlinkAccount({ remote }: FlowDeps): Promise<void> {
  // 서버의 연동 정보(암호문)만 지운다. 이 기기의 키는 로그인에서 나온 것이라 그대로 둔다.
  await remote.unlink();
}

/**
 * 최신 암호문을 받아 풀고 fn(creds) 를 부른다. fn 이 끝나면(성공이든 실패든) 평문을 비워 참조를 놓는다.
 * 연동이 없으면 ApiError(SCHOOL_NOT_LINKED), 풀 수 없으면 SchoolKeyMissingError — 둘 다 학교에는 요청하지 않는다.
 */
export async function runWithCredentials<T>(
  { vault, remote }: FlowDeps,
  userId: number,
  username: string,
  fn: (creds: SchoolCredentials) => Promise<T>,
): Promise<T> {
  const status = await remote.getLink();
  if (!status.linked || !status.cipher) {
    throw new ApiError(409, '학교 계정이 연동되어 있지 않아요. 먼저 학교 계정을 연동해 주세요.', 'SCHOOL_NOT_LINKED');
  }
  const creds = await vault.open(userId, username, status.cipher);
  try {
    return await fn(creds);
  } finally {
    creds.studentId = '';
    creds.password = '';
  }
}
