export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
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
    throw new ApiError(res.status, message);
  }
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
  del: <T>(path: string, body?: unknown) => request<T>('DELETE', path, body),
};
