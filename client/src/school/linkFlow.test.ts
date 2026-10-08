/**
 * 연동 흐름 단위 테스트 — "이 기기에 저장된 키(로그인 때 만든 것)로 봉인", "키가 없으면 학교(서버)에 요청하기 전에 멈춤",
 * "학교 기능을 쓸 때 최신 암호문을 받아 풀고 평문을 비운다". 학교에는 어떤 요청도 보내지 않는다(가짜 서버).
 */
import { webcrypto } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { ApiError } from '../api';
import type {
  LinkRequest,
  LinkResponse,
  LinkStatus,
  SchoolCredentials,
  SealedBox,
} from '../../../shared/school/types';
import { SchoolKeyMissingError, SchoolStorageUnavailableError } from './errors';
import { linkAccount, runWithCredentials, unlinkAccount } from './linkFlow';
import type { SchoolRemote } from './linkFlow';
import { createVault, keyStorageName } from './vault';
import type { KeyStorage } from './vault';

class MemoryStorage implements KeyStorage {
  readonly data = new Map<string, string>();
  getItem(key: string) {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.data.set(key, value);
  }
  removeItem(key: string) {
    this.data.delete(key);
  }
}

const CREDS: SchoolCredentials = { studentId: '1912345', password: 'Zq9!mock-pw' };
const NEW_CREDS: SchoolCredentials = { studentId: '1912345', password: 'N3w-mock-pw!' };
const crypto = webcrypto as unknown as Crypto;
const PROFILE = { studentId: '1912345', name: '시험', department: '시험학과', admissionYear: 2019 };
const USER = 'flow_user';

// 키 만들기는 일부러 느려서 한 번만 만들어 나눠 쓴다
let KEY: Uint8Array<ArrayBuffer>;
let OTHER_KEY: Uint8Array<ArrayBuffer>;
beforeAll(async () => {
  const v = createVault({ storage: new MemoryStorage(), crypto });
  KEY = await v.deriveKey(USER, 'flow-password-1');
  OTHER_KEY = await v.deriveKey(USER, 'flow-password-2');
}, 60_000);

/** 서버를 흉내 낸다: 마지막으로 받은 암호문을 기억하고, 호출을 기록하고, 원하는 때 실패시킨다 */
function fakeServer(options: { failLinkWith?: ApiError } = {}) {
  const calls: string[] = [];
  const requests: LinkRequest[] = [];
  let stored: SealedBox | null = null;
  const remote: SchoolRemote = {
    async getLink(): Promise<LinkStatus> {
      calls.push('getLink');
      return stored
        ? { linked: true, hint: '****345', linkedAt: '2026-10-08T00:00:00.000Z', cipher: stored, profileHint: null }
        : { linked: false, hint: null, linkedAt: null, cipher: null, profileHint: null };
    },
    async link(body: LinkRequest): Promise<LinkResponse> {
      calls.push('link');
      requests.push(body);
      if (options.failLinkWith) throw options.failLinkWith;
      stored = body.cipher;
      return { linked: true, hint: '****345', profile: PROFILE };
    },
    async unlink() {
      calls.push('unlink');
      stored = null;
      return { ok: true as const };
    },
  };
  return {
    remote,
    calls,
    requests,
    get stored() {
      return stored;
    },
    set stored(value: SealedBox | null) {
      stored = value;
    },
  };
}

const authFailed = () =>
  new ApiError(422, '학번 또는 비밀번호가 맞지 않아요.', 'SCHOOL_AUTH_FAILED', { code: 'SCHOOL_AUTH_FAILED' });

/** 로그인 때 키를 이 기기에 저장해 둔 상태 */
function loggedIn(server = fakeServer(), userId = 1) {
  const storage = new MemoryStorage();
  const vault = createVault({ storage, crypto });
  vault.saveKey(userId, KEY);
  return { storage, vault, server };
}

describe('연동(linkAccount)', () => {
  it('이 기기에 저장된 키로 봉인해 서버에 보내고, 서버가 받은 암호문을 같은 키로 풀 수 있다', async () => {
    const { vault, server } = loggedIn();
    const profile = await linkAccount({ vault, remote: server.remote }, 1, USER, CREDS);
    expect(profile).toEqual(PROFILE);
    expect(server.calls).toEqual(['link']);
    expect(server.requests[0].cipher.v).toBe(2);
    expect(await vault.open(1, USER, server.stored!)).toEqual(CREDS);
  });

  it('요청 본문의 creds 만 평문이고 cipher 에는 평문이 없다', async () => {
    const { vault, server } = loggedIn();
    await linkAccount({ vault, remote: server.remote }, 1, USER, CREDS);
    const body = server.requests[0];
    expect(body.creds).toEqual(CREDS);
    const cipherText = JSON.stringify(body.cipher);
    expect(cipherText).not.toContain(CREDS.password);
    expect(cipherText).not.toContain(CREDS.studentId);
  });

  it('이 기기에 키가 없으면 학교(서버)에 요청하기 전에 멈춘다 (로그아웃 후 다시 로그인하면 키가 만들어진다)', async () => {
    const { vault, server, storage } = loggedIn();
    storage.data.clear();
    await expect(linkAccount({ vault, remote: server.remote }, 1, USER, CREDS)).rejects.toBeInstanceOf(
      SchoolKeyMissingError,
    );
    expect(server.calls).toEqual([]);
  });

  it('저장소를 못 쓰면 학교(서버)에 요청하기 전에 멈춘다', async () => {
    const server = fakeServer();
    const vault = createVault({ storage: null, crypto });
    await expect(linkAccount({ vault, remote: server.remote }, 1, USER, CREDS)).rejects.toBeInstanceOf(
      SchoolStorageUnavailableError,
    );
    expect(server.calls).toEqual([]);
  });

  it('서버가 거절하면(학번/비밀번호 불일치) 이 기기의 키와 서버의 기존 암호문을 그대로 두고 오류를 던진다', async () => {
    const server = fakeServer();
    const { vault, storage } = loggedIn(server);
    await linkAccount({ vault, remote: server.remote }, 1, USER, CREDS);
    const before = server.stored;
    const keyBefore = storage.getItem(keyStorageName(1));

    const failing = fakeServer({ failLinkWith: authFailed() });
    failing.stored = before;
    await expect(linkAccount({ vault, remote: failing.remote }, 1, USER, NEW_CREDS)).rejects.toMatchObject({
      code: 'SCHOOL_AUTH_FAILED',
    });
    expect(storage.getItem(keyStorageName(1))).toBe(keyBefore);
    expect(await vault.open(1, USER, failing.stored!)).toEqual(CREDS);
  });

  it('학교 비밀번호를 바꿔 다시 연동하면 새 암호문으로 바뀌고 같은 키로 풀린다 (키는 그대로)', async () => {
    const { vault, server, storage } = loggedIn();
    await linkAccount({ vault, remote: server.remote }, 1, USER, CREDS);
    const keyBefore = storage.getItem(keyStorageName(1));
    await linkAccount({ vault, remote: server.remote }, 1, USER, NEW_CREDS);
    expect(storage.getItem(keyStorageName(1))).toBe(keyBefore);
    expect(await vault.open(1, USER, server.stored!)).toEqual(NEW_CREDS);
  });

  it('같은 브라우저의 다른 사용자 키와 섞이지 않는다', async () => {
    const { vault, server, storage } = loggedIn();
    vault.saveKey(2, OTHER_KEY);
    await linkAccount({ vault, remote: server.remote }, 1, USER, CREDS);
    expect(storage.getItem(keyStorageName(1))).not.toBe(storage.getItem(keyStorageName(2)));
    expect(await vault.canOpen(2, USER, server.stored!)).toBe(false);
  });
});

describe('다른 기기에서 로그인해도 이어지는 연동', () => {
  it('기기 A 에서 봉인한 암호문을 기기 B 에서 같은 아이디·비밀번호로 만든 키로 풀 수 있다', async () => {
    const server = fakeServer();
    const a = loggedIn(server);
    await linkAccount({ vault: a.vault, remote: server.remote }, 1, USER, CREDS);

    // 기기 B: 저장소가 비어 있다가 로그인할 때 같은 아이디·비밀번호로 키를 만들어 둔다
    const bStorage = new MemoryStorage();
    const bVault = createVault({ storage: bStorage, crypto });
    bVault.saveKey(1, await bVault.deriveKey(USER, 'flow-password-1'));
    const seen = await runWithCredentials({ vault: bVault, remote: server.remote }, 1, USER, async (c) => ({ ...c }));
    expect(seen).toEqual(CREDS);
  }, 60_000);

  it('기기 B 에서 틀린 비밀번호로 만든 키로는 풀리지 않아 fn 을 부르지 않는다', async () => {
    const server = fakeServer();
    const a = loggedIn(server);
    await linkAccount({ vault: a.vault, remote: server.remote }, 1, USER, CREDS);

    const b = createVault({ storage: new MemoryStorage(), crypto });
    b.saveKey(1, OTHER_KEY);
    let called = false;
    await expect(
      runWithCredentials({ vault: b, remote: server.remote }, 1, USER, async () => {
        called = true;
        return 1;
      }),
    ).rejects.toBeInstanceOf(SchoolKeyMissingError);
    expect(called).toBe(false);
  });
});

describe('해제(unlinkAccount)', () => {
  it('서버의 연동 정보만 지우고, 이 기기의 키는 그대로 둔다 (키는 로그인에서 나온 것이라 다시 연동에 쓴다)', async () => {
    const { vault, server, storage } = loggedIn();
    await linkAccount({ vault, remote: server.remote }, 1, USER, CREDS);
    await unlinkAccount({ vault, remote: server.remote });
    expect(server.stored).toBeNull();
    expect(storage.getItem(keyStorageName(1))).not.toBeNull();
    // 다시 연동할 수 있다
    await linkAccount({ vault, remote: server.remote }, 1, USER, CREDS);
    expect(await vault.open(1, USER, server.stored!)).toEqual(CREDS);
  });

  it('서버 해제가 실패하면 오류를 그대로 던진다 (아직 연동 상태)', async () => {
    const { vault, server } = loggedIn();
    await linkAccount({ vault, remote: server.remote }, 1, USER, CREDS);
    const remote: SchoolRemote = {
      ...server.remote,
      unlink: async () => {
        throw new ApiError(0, '서버에 연결하지 못했습니다.');
      },
    };
    await expect(unlinkAccount({ vault, remote })).rejects.toBeInstanceOf(ApiError);
    expect(server.stored).not.toBeNull();
  });
});

describe('풀어서 쓰기(runWithCredentials)', () => {
  async function linked() {
    const ctx = loggedIn();
    await linkAccount({ vault: ctx.vault, remote: ctx.server.remote }, 1, USER, CREDS);
    return ctx;
  }

  it('서버의 최신 암호문을 풀어 fn 에 평문을 넘기고 결과를 돌려준다', async () => {
    const { vault, server } = await linked();
    const out = await runWithCredentials({ vault, remote: server.remote }, 1, USER, async (c) => `${c.studentId}:${c.password}`);
    expect(out).toBe(`${CREDS.studentId}:${CREDS.password}`);
    expect(server.calls.filter((c) => c === 'getLink')).toHaveLength(1);
  });

  it('fn 이 끝나면 평문 객체를 비운다 (성공·실패 모두)', async () => {
    const { vault, server } = await linked();
    let held: SchoolCredentials | null = null;
    await runWithCredentials({ vault, remote: server.remote }, 1, USER, async (c) => {
      held = c;
    });
    expect(held).toEqual({ studentId: '', password: '' });

    held = null;
    await expect(
      runWithCredentials({ vault, remote: server.remote }, 1, USER, async (c) => {
        held = c;
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(held).toEqual({ studentId: '', password: '' });
  });

  it('키가 없으면 fn 을 부르지 않는다 (학교로 가는 요청이 없다)', async () => {
    const { vault, server, storage } = await linked();
    storage.data.clear();
    let called = false;
    await expect(
      runWithCredentials({ vault, remote: server.remote }, 1, USER, async () => {
        called = true;
        return 1;
      }),
    ).rejects.toBeInstanceOf(SchoolKeyMissingError);
    expect(called).toBe(false);
  });

  it('연동이 해제되어 있으면 SCHOOL_NOT_LINKED 로 멈추고 fn 을 부르지 않는다', async () => {
    const { vault, server } = await linked();
    server.stored = null;
    let called = false;
    await expect(
      runWithCredentials({ vault, remote: server.remote }, 1, USER, async () => {
        called = true;
        return 1;
      }),
    ).rejects.toMatchObject({ code: 'SCHOOL_NOT_LINKED', status: 409 });
    expect(called).toBe(false);
  });

  it('옛 방식(v:1) 암호문은 풀지 않고 fn 을 부르지 않는다 (다시 연동해야 한다)', async () => {
    const { vault, server } = await linked();
    server.stored = { ...server.stored!, v: 1 } as SealedBox;
    let called = false;
    await expect(
      runWithCredentials({ vault, remote: server.remote }, 1, USER, async () => {
        called = true;
        return 1;
      }),
    ).rejects.toBeInstanceOf(SchoolKeyMissingError);
    expect(called).toBe(false);
  });

  it('다른 아이디의 암호문이 서버에서 내려와도 풀지 않는다 (AAD)', async () => {
    const { vault, server } = await linked();
    let called = false;
    await expect(
      runWithCredentials({ vault, remote: server.remote }, 1, 'someone_else', async () => {
        called = true;
        return 1;
      }),
    ).rejects.toBeInstanceOf(SchoolKeyMissingError);
    expect(called).toBe(false);
  });
});
