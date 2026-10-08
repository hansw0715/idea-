/**
 * 로그인·가입 때 학교 계정 암호 키를 만들어 이 기기에 두는 도우미.
 * 키는 플랫폼 아이디·비밀번호에서 이 브라우저가 만든다(vault.deriveKey) — 서버에는 보내지 않는다.
 * 그래서 다른 기기에서 로그인해도 같은 키가 만들어져 학교 연동이 이어진다.
 */
import { vault } from './vault';

type Bytes = Uint8Array<ArrayBuffer>;

/**
 * 키 만들기를 시작한다. 60만 번 계산이라 1초쯤 걸리므로 서버 요청과 나란히 돌려 기다림을 겹치게 한다.
 * 이 기기가 암호화를 못 쓰는 환경이면 null — 로그인·가입 자체는 막지 않는다(학교 기능만 못 쓴다).
 */
export function startKeyDerivation(username: string, password: string): Promise<Bytes | null> {
  return vault.deriveKey(username, password).catch(() => null);
}

/**
 * 서버가 로그인·가입을 확인해 준 **뒤에만** 부른다(틀린 비밀번호로 만든 키를 두지 않는다).
 * 저장소를 못 써도 던지지 않고 false 를 돌려준다.
 */
export function cacheKey(userId: number, key: Bytes | null): boolean {
  if (!key) return false;
  try {
    vault.saveKey(userId, key);
    return true;
  } catch {
    return false;
  }
}
