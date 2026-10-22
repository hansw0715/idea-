/**
 * 금고(vault) 단위 테스트 — Node 의 WebCrypto 와 메모리 저장소를 주입해 시험한다.
 * 키는 플랫폼 아이디·비밀번호에서 만든다(deriveKey). 학교에는 어떤 요청도 보내지 않는다.
 * 쓰는 아이디·비밀번호·학번은 모두 시험용 가짜 값이다.
 */
import { webcrypto } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import type { SchoolCredentials, SealedBox } from '../../../shared/school/types';
import { SchoolKeyMissingError, SchoolStorageUnavailableError } from './errors';
import { KDF_ITERATIONS, createVault, keyStorageName } from './vault';
import type { KeyStorage } from './vault';

class MemoryStorage implements KeyStorage {
  readonly data = new Map<string, string>();
  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }
  removeItem(key: string): void {
    this.data.delete(key);
  }
}

const CREDS: SchoolCredentials = { studentId: '1912345', password: 'Zq9!mock-pw' };
const crypto = webcrypto as unknown as Crypto;
const USER = 'minjae_test';
const PW = 'platform-pw-123';

const b64 = (text: string) => Buffer.from(text, 'base64');
const flipByte = (base64: string, at: number): string => {
  const bytes = b64(base64);
  bytes[at] ^= 0x01;
  return bytes.toString('base64');
};
const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString('hex');

// 키 만들기는 일부러 느려서(60만 번) 한 번만 만들어 여러 시험이 나눠 쓴다
let KEY: Uint8Array<ArrayBuffer>;
beforeAll(async () => {
  KEY = await createVault({ storage: new MemoryStorage(), crypto }).deriveKey(USER, PW);
}, 60_000);

/** 새 저장소와 금고, 사용자 1 의 키를 저장해 둔다 */
function setup(userId = 1) {
  const storage = new MemoryStorage();
  const vault = createVault({ storage, crypto });
  vault.saveKey(userId, KEY);
  return { storage, vault };
}

describe('금고: 아이디·비밀번호에서 키 만들기', () => {
  it('같은 아이디·비밀번호면 언제나(다른 기기에서도) 같은 32바이트 키가 나온다', async () => {
    const vault = createVault({ storage: new MemoryStorage(), crypto });
    const again = await vault.deriveKey(USER, PW);
    expect(again).toHaveLength(32);
    expect(hex(again)).toBe(hex(KEY));
  }, 60_000);

  it('아이디가 다르면 키가 다르다 (아이디가 소금에 들어간다)', async () => {
    const vault = createVault({ storage: new MemoryStorage(), crypto });
    expect(hex(await vault.deriveKey('other_user', PW))).not.toBe(hex(KEY));
  }, 60_000);

  it('비밀번호가 한 글자만 달라도 키가 다르다', async () => {
    const vault = createVault({ storage: new MemoryStorage(), crypto });
    expect(hex(await vault.deriveKey(USER, `${PW}4`))).not.toBe(hex(KEY));
  }, 60_000);

  it('아이디의 대소문자·앞뒤 공백·학교 메일 꼴은 같은 아이디로 본다 (비밀번호는 그대로 구분)', async () => {
    const vault = createVault({ storage: new MemoryStorage(), crypto });
    expect(hex(await vault.deriveKey(`  ${USER.toUpperCase()} `, PW))).toBe(hex(KEY));
    expect(hex(await vault.deriveKey(`${USER}@hansung.ac.kr`, PW))).toBe(hex(KEY));
    expect(hex(await vault.deriveKey(USER, PW.toUpperCase()))).not.toBe(hex(KEY));
  }, 60_000);

  it('한글 비밀번호는 맥(NFD)·윈도우(NFC) 입력 차이와 상관없이 같은 키가 나온다', async () => {
    const vault = createVault({ storage: new MemoryStorage(), crypto });
    const nfc = '한글비밀번호!234'.normalize('NFC');
    const nfd = nfc.normalize('NFD');
    expect(nfd).not.toBe(nfc);
    expect(hex(await vault.deriveKey(USER, nfd))).toBe(hex(await vault.deriveKey(USER, nfc)));
  }, 60_000);

  it('반복 횟수는 60만 번 이상이다 (낮추면 비밀번호 추측이 쉬워진다)', () => {
    expect(KDF_ITERATIONS).toBeGreaterThanOrEqual(600_000);
  });

  it('만든 키를 저장하지 않는다 (서버 확인 전에는 메모리에만 있다)', () => {
    const storage = new MemoryStorage();
    createVault({ storage, crypto });
    expect(storage.data.size).toBe(0);
  });

  it('키가 비밀번호 원문이나 그 일부를 담고 있지 않다', () => {
    expect(hex(KEY)).not.toContain(Buffer.from(PW).toString('hex'));
  });
});

describe('금고: 봉인과 해제', () => {
  it('봉인한 것을 같은 키로 풀면 원래 학번·비밀번호가 나온다', async () => {
    const { vault } = setup();
    const sealed = await vault.seal(1, USER, CREDS);
    expect(await vault.open(1, USER, sealed)).toEqual(CREDS);
  });

  it('가입 때처럼 사용자 id 가 없어도 방금 만든 키로 봉인하고, 저장된 키로 풀 수 있다', async () => {
    const { vault } = setup();
    const sealed = await vault.seal(null, USER, CREDS, KEY);
    expect(await vault.open(1, USER, sealed)).toEqual(CREDS);
  });

  it('한글·특수문자·공백이 든 비밀번호도 그대로 돌아온다', async () => {
    const { vault } = setup();
    const creds = { studentId: '2019000123', password: ' 한글 비밀번호!@#"\\\n😀 ' }; // taste-skill-ignore: 이모지 입력 테스트
    expect(await vault.open(1, USER, await vault.seal(1, USER, creds))).toEqual(creds);
  });

  it('같은 평문도 봉인할 때마다 암호문(IV 포함)이 다르다', async () => {
    const { vault } = setup();
    const a = await vault.seal(1, USER, CREDS);
    const b = await vault.seal(1, USER, CREDS);
    expect(a.iv).not.toBe(b.iv);
    expect(a.ct).not.toBe(b.ct);
    expect(await vault.open(1, USER, a)).toEqual(CREDS);
    expect(await vault.open(1, USER, b)).toEqual(CREDS);
  });

  it('서버가 요구하는 모양(v:2, iv 12바이트, ct 17~2048바이트, 정규 base64)이다', async () => {
    const { vault } = setup();
    const sealed = await vault.seal(1, USER, CREDS);
    expect(sealed.v).toBe(2);
    expect(b64(sealed.iv)).toHaveLength(12);
    expect(b64(sealed.ct).length).toBeGreaterThanOrEqual(17);
    expect(b64(sealed.ct).length).toBeLessThanOrEqual(2048);
    expect(b64(sealed.iv).toString('base64')).toBe(sealed.iv);
    expect(b64(sealed.ct).toString('base64')).toBe(sealed.ct);
    expect(Object.keys(sealed).sort()).toEqual(['ct', 'iv', 'v']);
  });

  it('최대 길이 비밀번호(64자)와 학번(10자리)도 서버 한도(2048바이트) 안에 들어간다', async () => {
    const { vault } = setup();
    const sealed = await vault.seal(1, USER, { studentId: '1234567890', password: 'ㅎ'.repeat(64) });
    expect(b64(sealed.ct).length).toBeLessThanOrEqual(2048);
  });
});

describe('금고: 풀 수 없는 경우는 모두 같은 오류', () => {
  async function sealed() {
    const { vault, storage } = setup();
    return { vault, storage, box: await vault.seal(1, USER, CREDS) };
  }
  const expectMissing = (p: Promise<unknown>) => expect(p).rejects.toBeInstanceOf(SchoolKeyMissingError);

  it('다른 비밀번호에서 만든 키로 열면 실패한다 (다른 기기에서 틀린 비밀번호로 만든 키)', async () => {
    const { box } = await sealed();
    const other = createVault({ storage: new MemoryStorage(), crypto });
    const wrong = await other.deriveKey(USER, 'another-password-1');
    other.saveKey(1, wrong);
    await expectMissing(other.open(1, USER, box));
  }, 60_000);

  it('키가 없으면(저장소 비움·로그인 전) 실패한다', async () => {
    const { vault, storage, box } = await sealed();
    storage.data.clear();
    await expectMissing(vault.open(1, USER, box));
  });

  it('암호문 본문을 한 비트라도 바꾸면 실패한다 (변조 감지)', async () => {
    const { vault, box } = await sealed();
    await expectMissing(vault.open(1, USER, { ...box, ct: flipByte(box.ct, 3) }));
    await expectMissing(vault.open(1, USER, { ...box, ct: flipByte(box.ct, b64(box.ct).length - 1) }));
  });

  it('IV 를 바꾸거나 길이가 다르면 실패한다', async () => {
    const { vault, box } = await sealed();
    await expectMissing(vault.open(1, USER, { ...box, iv: flipByte(box.iv, 0) }));
    await expectMissing(vault.open(1, USER, { ...box, iv: b64(box.iv).subarray(0, 8).toString('base64') }));
  });

  it('다른 아이디의 암호문은 같은 키여도 풀리지 않는다 (AAD 불일치)', async () => {
    const { vault, box } = await sealed();
    await expectMissing(vault.open(1, 'someone_else', box));
  });

  it('아이디는 대소문자만 달라도 같은 아이디로 풀린다', async () => {
    const { vault, box } = await sealed();
    expect(await vault.open(1, USER.toUpperCase(), box)).toEqual(CREDS);
  });

  it('옛 방식(v:1) 암호문은 풀지 않는다 — 다시 연동해야 한다', async () => {
    const { vault, box } = await sealed();
    await expectMissing(vault.open(1, USER, { ...box, v: 1 } as SealedBox));
  });

  it('형식이 다른 암호문(타입·깨진 base64)은 실패한다', async () => {
    const { vault, box } = await sealed();
    await expectMissing(vault.open(1, USER, { ...box, iv: 5 } as unknown as SealedBox));
    await expectMissing(vault.open(1, USER, { ...box, ct: '%%%not-base64%%%' }));
    await expectMissing(vault.open(1, USER, null as unknown as SealedBox));
  });

  it('저장된 키가 깨져 있어도(길이 다름·base64 아님) 같은 오류다', async () => {
    const { vault, storage, box } = await sealed();
    storage.setItem(keyStorageName(1), Buffer.alloc(16).toString('base64'));
    await expectMissing(vault.open(1, USER, box));
    storage.setItem(keyStorageName(1), '%%%');
    await expectMissing(vault.open(1, USER, box));
  });

  it('실패 원인에 상관없이 문구가 완전히 같다 (원인을 알려 주지 않는다)', async () => {
    const { vault, storage, box } = await sealed();
    const messages = new Set<string>();
    const collect = async (p: Promise<unknown>) => {
      try {
        await p;
      } catch (e) {
        messages.add((e as Error).message);
      }
    };
    await collect(vault.open(1, 'someone_else', box));
    await collect(vault.open(1, USER, { ...box, ct: flipByte(box.ct, 2) }));
    await collect(vault.open(1, USER, { ...box, v: 1 } as SealedBox));
    storage.data.clear();
    await collect(vault.open(1, USER, box));
    expect(messages.size).toBe(1);
  });

  it('canOpen 은 평문을 돌려주지 않고 가능 여부만 알려 준다', async () => {
    const { vault, box } = await sealed();
    expect(await vault.canOpen(1, USER, box)).toBe(true);
    expect(await vault.canOpen(1, 'someone_else', box)).toBe(false);
    expect(await vault.canOpen(2, USER, box)).toBe(false); // 사용자 2 에게는 키가 없다
  });

  it('저장된 키 없이 저장된 키로 봉인하려 하면 SchoolKeyMissingError', async () => {
    const vault = createVault({ storage: new MemoryStorage(), crypto });
    await expect(vault.seal(1, USER, CREDS)).rejects.toBeInstanceOf(SchoolKeyMissingError);
  });
});

describe('금고: 키 보관', () => {
  it('키는 사용자 id 별 이름으로 분리되어 저장된다', () => {
    const { storage, vault } = setup(1);
    vault.saveKey(2, KEY);
    expect(storage.getItem(keyStorageName(1))).not.toBeNull();
    expect(storage.getItem(keyStorageName(2))).not.toBeNull();
    expect(keyStorageName(1)).not.toBe(keyStorageName(2));
    expect(vault.hasKey(1)).toBe(true);
    expect(vault.hasKey(3)).toBe(false);
  });

  it('한 사용자의 키를 지워도 다른 사용자의 키는 그대로다', () => {
    const { vault } = setup(1);
    vault.saveKey(2, KEY);
    vault.forget(1);
    expect(vault.hasKey(1)).toBe(false);
    expect(vault.hasKey(2)).toBe(true);
  });

  it('암호문·저장소 어디에도 평문 학번·비밀번호·플랫폼 비밀번호가 들어 있지 않다', async () => {
    const { storage, vault } = setup();
    const sealed = await vault.seal(1, USER, CREDS);
    const dump = JSON.stringify({ sealed, storage: [...storage.data.entries()] });
    expect(dump).not.toContain(CREDS.password);
    expect(dump).not.toContain(CREDS.studentId);
    expect(dump).not.toContain(PW);
  });

  it('봉인된 암호문은 키 없이 보면 평문 일부(JSON 모양)도 드러나지 않는다', async () => {
    const { vault } = setup();
    const sealed = await vault.seal(1, USER, CREDS);
    const raw = b64(sealed.ct).toString('latin1');
    expect(raw).not.toContain('studentId');
    expect(raw).not.toContain('password');
  });
});

describe('금고: 저장소·암호 기능을 못 쓰는 환경', () => {
  const failing = (): KeyStorage => ({
    getItem() {
      throw new Error('blocked');
    },
    setItem() {
      throw new Error('blocked');
    },
    removeItem() {
      throw new Error('blocked');
    },
  });

  it('저장소가 없으면(null) 준비 확인에서 명확한 오류로 멈춘다', () => {
    const vault = createVault({ storage: null, crypto });
    expect(vault.storageAvailable()).toBe(false);
    expect(() => vault.assertReady()).toThrow(SchoolStorageUnavailableError);
  });

  it('접근할 때마다 던지는 저장소도 같은 오류로 멈춘다', () => {
    const vault = createVault({ storage: failing(), crypto });
    expect(() => vault.assertReady()).toThrow(SchoolStorageUnavailableError);
    expect(() => vault.saveKey(1, KEY)).toThrow(SchoolStorageUnavailableError);
    expect(() => vault.forget(1)).not.toThrow();
  });

  it('쓰기는 되지만 읽을 때 값이 다르면(저장이 안 되는 저장소) 저장 실패로 본다', () => {
    const lying: KeyStorage = { getItem: () => 'x', setItem: () => undefined, removeItem: () => undefined };
    const vault = createVault({ storage: lying, crypto });
    expect(() => vault.saveKey(1, KEY)).toThrow(SchoolStorageUnavailableError);
  });

  it('암호화 기능(crypto.subtle)이 없는 주소면 키 만들기와 준비 확인에서 멈춘다', async () => {
    const vault = createVault({ storage: new MemoryStorage(), crypto: {} as Crypto });
    expect(() => vault.assertReady()).toThrow(SchoolStorageUnavailableError);
    await expect(vault.deriveKey(USER, PW)).rejects.toBeInstanceOf(SchoolStorageUnavailableError);
  });

  it('준비 확인은 시험 쓰기 흔적을 남기지 않는다', () => {
    const storage = new MemoryStorage();
    createVault({ storage, crypto }).assertReady();
    expect(storage.data.size).toBe(0);
  });
});
