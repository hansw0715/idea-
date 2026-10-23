export class ApiError extends Error {
  status: number;
  /** 서버가 돌려준 오류 코드 (라운지 API: PROFILE_REQUIRED, SLOT_FULL …). 없으면 undefined. */
  code?: string;
  /** 오류 본문 전체. SCHOOL_LOCKED 의 retryAfterSec·long 처럼 코드별 추가 필드를 읽을 때 쓴다. */
  data?: Record<string, unknown>;

  constructor(status: number, message: string, code?: string, data?: Record<string, unknown>) {
    super(message);
    this.status = status;
    this.code = code;
    this.data = data;
  }
}

// 세션 만료(401) 시 앱 전역에서 로그인 상태를 되돌리기 위한 훅
let onUnauthorized: (() => void) | null = null;

export function setOnUnauthorized(callback: () => void): void {
  onUnauthorized = callback;
}

/*
 * 마지막으로 받은 화면 내용(GET 응답)을 이 기기에 기억해 둔다.
 * 휴대폰 화면 모드를 바꾸는 등으로 페이지가 새로 열려도 "불러오는 중" 대신 지난 내용을 바로 보여 주고,
 * 최신 내용은 뒤에서 받아와 바꿔 넣는다 (api.cached 로 꺼내 쓴다). 로그아웃하면 지운다.
 */
const CACHE_KEY = 'sangsang-booke:last-responses';
const CACHE_MAX = 40;
let memo: Record<string, unknown> | null = null;

function readCache(): Record<string, unknown> {
  if (memo) return memo;
  try {
    memo = JSON.parse(localStorage.getItem(CACHE_KEY) ?? '{}') ?? {};
  } catch {
    memo = {};
  }
  return memo!;
}

function remember(path: string, data: unknown) {
  const cache = readCache();
  delete cache[path];
  cache[path] = data;
  const keys = Object.keys(cache);
  for (const k of keys.slice(0, Math.max(0, keys.length - CACHE_MAX))) delete cache[k];
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch {
    /* 저장 공간이 모자라거나 막힌 환경 — 이번에는 기억하지 않는다 */
  }
}

/** 로그아웃·계정 전환 때 지난 화면 내용을 지운다 */
export function clearCachedResponses(): void {
  memo = {};
  try {
    localStorage.removeItem(CACHE_KEY);
  } catch {
    /* 막힌 환경 — 무시 */
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      credentials: 'same-origin',
    });
  } catch {
    // 오프라인·서버 중단 등 응답 자체를 받지 못한 경우
    throw new ApiError(
      0,
      '서버에 연결하지 못했습니다. 네트워크 연결을 확인한 뒤 다시 시도해 주세요.',
    );
  }
  const data: unknown = await res.json().catch(() => null);
  if (res.status === 401 && !path.startsWith('/auth')) {
    onUnauthorized?.();
  }
  if (!res.ok) {
    const message =
      data && typeof data === 'object' && 'error' in data && typeof data.error === 'string'
        ? data.error
        : '요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.';
    const code =
      data && typeof data === 'object' && 'code' in data && typeof data.code === 'string'
        ? data.code
        : undefined;
    const extra = data && typeof data === 'object' ? (data as Record<string, unknown>) : undefined;
    throw new ApiError(res.status, message, code, extra);
  }
  if (method === 'GET') remember(path, data);
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  /** 이 주소로 마지막에 받은 내용 (없으면 undefined). 첫 화면을 바로 그릴 때 쓴다 */
  cached: <T>(path: string): T | undefined => readCache()[path] as T | undefined,
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body),
  del: <T>(path: string, body?: unknown) => request<T>('DELETE', path, body),
};
