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
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body),
  del: <T>(path: string, body?: unknown) => request<T>('DELETE', path, body),
};
