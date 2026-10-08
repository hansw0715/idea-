/**
 * 학교 계정 금고 — 학번·비밀번호를 이 브라우저에서 AES-GCM 으로 봉인하고 푼다.
 * 설계: docs/school/00-design.md §1 (보안 모델)
 *
 *  - **키는 플랫폼 아이디·비밀번호에서 이 브라우저가 만든다**(deriveKey). 가입·로그인할 때 입력한 값으로 같은 키가 나오므로
 *    다른 기기에서 로그인해도 연동이 이어진다. 만든 키는 이 브라우저의 localStorage 에 둔다: `sangsang-booke:school-key:<사용자id>`.
 *    서버는 암호문(SealedBox)만 보관하고 키를 한 번도 받지 않는다.
 *  - 키 만들기는 서버가 비밀번호를 저장할 때 쓰는 해시(bcrypt)와 **다른 방법**이다: PBKDF2-SHA256(60만 번, 아이디로 만든 별도의 소금) →
 *    HKDF(용도 표시). 서버에 저장된 해시로는 이 키를 거꾸로 만들 수 없다.
 *  - 암호문에는 "이 아이디 것"이라는 표시(AAD = `sangsang-booke:school:v2:<아이디>`)를 묶는다.
 *    다른 계정의 암호문을 옮겨 붙여도 풀리지 않는다.
 *  - 풀지 못하는 이유(키 없음·키 불일치·변조·다른 계정·형식 오류·옛 방식 암호문)는 모두 SchoolKeyMissingError 하나로만 알린다.
 *  - 평문을 이 파일 밖으로 남기지 않는다: open 의 결과는 호출한 쪽(runWithCredentials)이 쓰고 곧바로 버린다.
 *
 * react 와 DOM 을 직접 부르지 않는다. 저장소·암호 모듈은 주입할 수 있어 Node(vitest)에서 그대로 시험한다.
 */
import { normalizeUsername } from '../../../shared/auth';
import type { SchoolCredentials, SealedBox } from '../../../shared/school/types';
import {
  CRYPTO_UNAVAILABLE_MESSAGE,
  SchoolKeyMissingError,
  SchoolStorageUnavailableError,
} from './errors';

/** localStorage 와 같은 모양의 최소 저장소 (시험에서는 메모리 저장소를 넣는다) */
export interface KeyStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface VaultDeps {
  /**
   * 키를 둘 저장소. 생략하면 이 브라우저의 localStorage.
   * 접근 자체가 막힌 환경(프라이빗 모드 등)은 null 을 넘기거나, 던지는 저장소를 넣어 흉내 낸다.
   */
  storage?: KeyStorage | null;
  /** WebCrypto. 생략하면 globalThis.crypto */
  crypto?: Crypto;
}

type Bytes = Uint8Array<ArrayBuffer>;

const KEY_PREFIX = 'sangsang-booke:school-key:';
const AAD_PREFIX = 'sangsang-booke:school:v2:';
/** 암호문 형식 버전. 키를 아이디·비밀번호에서 만드는 방식 = 2 (1 은 기기마다 무작위 키를 쓰던 옛 방식) */
const SEAL_VERSION = 2;
/** PBKDF2 반복 횟수. 낮추면 비밀번호 추측이 쉬워지므로 줄이지 않는다 (OWASP 2023: PBKDF2-HMAC-SHA256 60만 번) */
export const KDF_ITERATIONS = 600_000;
const KDF_SALT_PBKDF2 = 'sangsang-booke/school-key/v2/pbkdf2|';
const KDF_SALT_HKDF = 'sangsang-booke/school-key/v2/hkdf|';
const KDF_INFO = 'sangsang-booke:school-cipher:v2';
/** 저장소를 쓸 수 있는지 시험 쓰기를 할 때 쓰는 임시 이름 */
const PROBE_KEY = 'sangsang-booke:school-key-probe';
const KEY_BYTES = 32; // AES-256
const IV_BYTES = 12; // AES-GCM 권장 길이

/** 사용자별 키가 놓이는 localStorage 이름 (다른 계정의 키와 섞이지 않는다) */
export const keyStorageName = (userId: number | string): string => `${KEY_PREFIX}${userId}`;

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

function toBase64(bytes: Uint8Array): string {
  let text = '';
  for (const b of bytes) text += String.fromCharCode(b);
  return btoa(text);
}

function fromBase64(text: string): Bytes {
  const binary = atob(text);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

/** 이 아이디 몫의 추가 인증 데이터 (가입 때는 사용자 id 가 아직 없어 바뀌지 않는 아이디에 묶는다) */
const aadOf = (username: string): Bytes => encoder.encode(`${AAD_PREFIX}${normalizeUsername(username)}`);

/** 브라우저의 localStorage. 접근만 해도 던지는 환경이 있어 try 로 감싼다 */
function browserStorage(): KeyStorage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function createVault(deps: VaultDeps = {}) {
  const storage = (): KeyStorage | null => (deps.storage === undefined ? browserStorage() : deps.storage);

  const subtle = (): SubtleCrypto => {
    const c = deps.crypto ?? globalThis.crypto;
    if (!c?.subtle) throw new SchoolStorageUnavailableError(CRYPTO_UNAVAILABLE_MESSAGE);
    return c.subtle;
  };
  const random = (n: number): Bytes => {
    const c = deps.crypto ?? globalThis.crypto;
    if (!c?.getRandomValues) throw new SchoolStorageUnavailableError(CRYPTO_UNAVAILABLE_MESSAGE);
    return c.getRandomValues(new Uint8Array(n));
  };

  /** 저장소가 실제로 읽고 쓰이는가 (읽기만 되고 쓰기가 막힌 경우도 걸러낸다) */
  function storageAvailable(): boolean {
    const s = storage();
    if (!s) return false;
    try {
      s.setItem(PROBE_KEY, '1');
      const ok = s.getItem(PROBE_KEY) === '1';
      s.removeItem(PROBE_KEY);
      return ok;
    } catch {
      return false;
    }
  }

  /**
   * 학교에 요청을 보내기 **전에** 부른다. 저장소나 암호화를 못 쓰면 키를 둘 곳이 없으니,
   * 연동을 시작하지 않는다(서버에만 암호문이 남고 풀 수 없게 되는 일을 막는다).
   */
  function assertReady(): void {
    subtle();
    if (!storageAvailable()) throw new SchoolStorageUnavailableError();
  }

  /** 저장된 키(32바이트). 없거나 형식이 다르면 KeyMissing */
  function readStoredKey(userId: number | string): Bytes {
    let raw: string | null = null;
    try {
      raw = storage()?.getItem(keyStorageName(userId)) ?? null;
    } catch {
      raw = null;
    }
    if (!raw) throw new SchoolKeyMissingError();
    try {
      const bytes = fromBase64(raw);
      if (bytes.length !== KEY_BYTES) throw new SchoolKeyMissingError();
      return bytes;
    } catch {
      throw new SchoolKeyMissingError();
    }
  }

  const importKey = (raw: Bytes): Promise<CryptoKey> =>
    subtle().importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);

  /** 이 사용자에게 저장된 키가 있는가 (암호문과 맞는지는 canOpen 으로 본다) */
  function hasKey(userId: number | string): boolean {
    try {
      readStoredKey(userId);
      return true;
    } catch {
      return false;
    }
  }

  const sha256 = async (text: string): Promise<Bytes> =>
    new Uint8Array(await subtle().digest('SHA-256', encoder.encode(text)));

  /**
   * 플랫폼 아이디·비밀번호에서 암호 키(32바이트)를 만든다. 같은 입력이면 어느 기기에서든 같은 키다.
   * 일부러 느리게 만든다(0.3~1.5초): 비밀번호 추측 한 번마다 같은 비용이 들게 한다. 결과는 **메모리에만** 만든다 —
   * 저장은 서버가 로그인·가입을 확인해 준 뒤 saveKey 로 한다.
   */
  async function deriveKey(username: string, password: string): Promise<Bytes> {
    const name = normalizeUsername(username);
    const pw = encoder.encode(password.normalize('NFC'));
    try {
      const base = await subtle().importKey('raw', pw, 'PBKDF2', false, ['deriveBits']);
      const hashed = new Uint8Array(
        await subtle().deriveBits(
          { name: 'PBKDF2', hash: 'SHA-256', salt: await sha256(KDF_SALT_PBKDF2 + name), iterations: KDF_ITERATIONS },
          base,
          KEY_BYTES * 8,
        ),
      );
      try {
        const ikm = await subtle().importKey('raw', hashed, 'HKDF', false, ['deriveBits']);
        return new Uint8Array(
          await subtle().deriveBits(
            { name: 'HKDF', hash: 'SHA-256', salt: await sha256(KDF_SALT_HKDF + name), info: encoder.encode(KDF_INFO) },
            ikm,
            KEY_BYTES * 8,
          ),
        );
      } finally {
        hashed.fill(0);
      }
    } finally {
      pw.fill(0);
    }
  }

  /** 키를 저장하고 다시 읽어 확인한다. 못 쓰면 SchoolStorageUnavailableError */
  function saveKey(userId: number | string, key: Bytes): void {
    const s = storage();
    if (!s) throw new SchoolStorageUnavailableError();
    const encoded = toBase64(key);
    try {
      s.setItem(keyStorageName(userId), encoded);
      if (s.getItem(keyStorageName(userId)) !== encoded) throw new Error('read-back mismatch');
    } catch {
      throw new SchoolStorageUnavailableError();
    }
  }

  /** 이 사용자의 키를 지운다 (로그아웃·탈퇴). 저장소가 막혀 있어도 던지지 않는다 */
  function forget(userId: number | string): void {
    try {
      storage()?.removeItem(keyStorageName(userId));
    } catch {
      /* 지울 수 없으면 이미 쓸 수 없는 상태다 */
    }
  }

  /**
   * 학번·비밀번호를 봉인한다. keyBytes 를 주면 그 키로(가입 — 아직 저장 전), 없으면 이 기기에 저장된 키로 한다.
   * 저장된 키가 없으면 SchoolKeyMissingError. 매번 새 무작위 IV 를 쓰므로 같은 평문도 암호문이 매번 다르다.
   */
  async function seal(
    userId: number | string | null,
    username: string,
    creds: SchoolCredentials,
    keyBytes?: Bytes,
  ): Promise<SealedBox> {
    const key = await importKey(keyBytes ?? readStoredKey(userId ?? ''));
    const iv = random(IV_BYTES);
    const plain = encoder.encode(JSON.stringify({ studentId: creds.studentId, password: creds.password }));
    try {
      const ct = await subtle().encrypt({ name: 'AES-GCM', iv, additionalData: aadOf(username) }, key, plain);
      return { v: SEAL_VERSION, iv: toBase64(iv), ct: toBase64(new Uint8Array(ct)) };
    } finally {
      plain.fill(0);
    }
  }

  /**
   * 암호문을 푼다. 실패하면 이유와 상관없이 SchoolKeyMissingError.
   * 결과(평문)는 호출한 쪽이 쓰고 버려야 한다 — 상태·저장소·URL·콘솔에 두지 않는다.
   */
  async function open(userId: number | string, username: string, sealed: SealedBox): Promise<SchoolCredentials> {
    try {
      if (!sealed || sealed.v !== SEAL_VERSION || typeof sealed.iv !== 'string' || typeof sealed.ct !== 'string') {
        throw new Error('format');
      }
      const key = await importKey(readStoredKey(userId));
      const iv = fromBase64(sealed.iv);
      if (iv.length !== IV_BYTES) throw new Error('iv');
      const ct = fromBase64(sealed.ct);
      const plain = new Uint8Array(
        await subtle().decrypt({ name: 'AES-GCM', iv, additionalData: aadOf(username) }, key, ct),
      );
      try {
        const parsed: unknown = JSON.parse(decoder.decode(plain));
        const o = parsed as { studentId?: unknown; password?: unknown } | null;
        if (!o || typeof o.studentId !== 'string' || typeof o.password !== 'string') throw new Error('shape');
        return { studentId: o.studentId, password: o.password };
      } finally {
        plain.fill(0);
      }
    } catch {
      throw new SchoolKeyMissingError();
    }
  }

  /** 이 기기의 키로 이 암호문을 풀 수 있는가. 평문은 남기지 않고 가능 여부만 돌려준다 */
  async function canOpen(userId: number | string, username: string, sealed: SealedBox): Promise<boolean> {
    try {
      await open(userId, username, sealed);
      return true;
    } catch {
      return false;
    }
  }

  return { storageAvailable, assertReady, hasKey, deriveKey, saveKey, forget, seal, open, canOpen };
}

export type Vault = ReturnType<typeof createVault>;

/** 앱이 쓰는 기본 금고 (이 브라우저의 localStorage + WebCrypto) */
export const vault: Vault = createVault();
