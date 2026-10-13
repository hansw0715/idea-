/**
 * 학교 호스트 고정 HTTP 클라이언트 (+ 학교 연동 오류 종류).
 * 설계: docs/school/00-design.md §2·§3
 *
 * 지키는 것
 *  - 요청은 `info.hansung.ac.kr`, `hansung.ac.kr`, `learn.hansung.ac.kr`(e-class) 세 호스트로만 나간다. 리다이렉트로 다른 호스트에 끌려가도 막는다 (SSRF 방지).
 *  - 리다이렉트는 직접 처리한다 (`redirect:'manual'`). 로그인·제출처럼 따라가면 안 되는 요청은 따라가지 않는다.
 *  - 쿠키는 인스턴스마다 따로 둔 jar 에 쌓는다 (Domain/Path 반영). 사용자 사이, 요청 사이에 쿠키가 섞이지 않는다.
 *  - 타임아웃 10초, 응답 2MB 제한, 항상 같은 User-Agent.
 *  - 요청 본문(학번·비밀번호)과 학교 응답 본문은 **로그·오류 메시지에 절대 남기지 않는다.**
 *    오류에는 고정 문장과 호스트+경로(쿼리 제외)만 쓴다.
 */
import type { SchoolErrorCode } from '../../shared/school/types.js';

// ── 오류 ─────────────────────────────────────────────────────────

/** 학교 연동에서 생기는 오류. 메시지는 화면에 그대로 보여 줘도 되는 고정 문장이다 (평문·응답 본문 금지). */
export class SchoolError extends Error {
  readonly code: SchoolErrorCode;
  constructor(code: SchoolErrorCode, message: string) {
    super(message);
    this.name = 'SchoolError';
    this.code = code;
  }
}

/** 학번/비밀번호가 맞지 않음. 이 오류는 가드가 실패로 센다. 재시도하지 않는다. */
export class SchoolAuthFailed extends SchoolError {
  constructor(
    message = '학번 또는 비밀번호가 맞지 않아요. 다시 시도하기 전에 학교 포털에서 먼저 로그인해 확인해 주세요. 10번 틀리면 계정이 잠겨요.',
  ) {
    super('SCHOOL_AUTH_FAILED', message);
    this.name = 'SchoolAuthFailed';
  }
}

/**
 * 실패가 쌓여 학교 계정이 잠기지 않도록 학교에 아예 요청하지 않는 상태.
 *
 * - `long=false`: 5~7회째 실패 뒤의 30분 쉬는 시간. `retryAfterSec` 가 지나면 다시 시도할 수 있다.
 * - `long=true`: 안전선(연속 8회 실패)에 닿아 **시간이 아니라 상태로** 멈춘 것이다. 저장된 옛 비밀번호로는 몇 시간이 지나도
 *   다시 학교에 요청하지 않는다 (시간으로 풀면 풀릴 때마다 한 번씩 더 두드려 결국 학교의 10회 한도에 닿는다).
 *   `retryAfterSec` 는 0 이고(기다린다고 풀리지 않는다), 이 연동의 주인이 학교 포털에서 확인한 새 비밀번호로 다시 연동할 때만
 *   딱 한 번 시도를 허용한다. 그것도 실패해 `final` 이면 운영자가 풀어 주기 전까지 어떤 요청도 보내지 않는다.
 */
export class SchoolLocked extends SchoolError {
  /** 잠금이 풀리기까지 남은 초. long(상태 기반 멈춤)이면 0 */
  readonly retryAfterSec: number;
  /** 안전선 멈춤인가. 화면이 "학교 포털에서 직접 로그인해 확인" 안내를 덧붙이는 기준 */
  readonly long: boolean;
  /** long 이면서 새 비밀번호로 다시 연동해 볼 수 있는가 (final 이면 false) */
  readonly needsRelink: boolean;
  constructor(retryAfterSec: number, long = false, final = false) {
    super(
      'SCHOOL_LOCKED',
      !long
        ? `학교 계정이 잠기지 않도록 학교 로그인을 잠시 멈췄어요. ${Math.max(1, Math.ceil(retryAfterSec / 60))}분 뒤에 다시 시도할 수 있어요.`
        : final
          ? '학교 계정이 잠기지 않도록 이 학번의 학교 로그인을 완전히 멈췄어요. 학교 포털에서 직접 로그인해 계정 상태를 확인하고, 계속 쓰려면 운영자에게 알려 주세요.'
          : '학교 계정이 잠기지 않도록 학교 로그인을 멈췄어요. 학교 포털에서 직접 로그인해 비밀번호를 확인한 뒤 다시 연동해 주세요.',
    );
    this.name = 'SchoolLocked';
    this.retryAfterSec = long ? 0 : retryAfterSec;
    this.long = long;
    this.needsRelink = long && !final;
  }
}

/** 학교 사이트가 점검 중이거나 응답이 없거나 화면 구조가 달라져 읽을 수 없음 */
export class SchoolUnavailable extends SchoolError {
  constructor(message = '학교 사이트가 지금 응답하지 않아요. 잠시 후 다시 시도해 주세요.') {
    super('SCHOOL_UNAVAILABLE', message);
    this.name = 'SchoolUnavailable';
  }
}

/** 학교 서버 검증 실패 (필수 항목 누락, 이미 예약됨 등). 메시지는 학교가 준 문장일 수 있다. */
export class SchoolRejected extends SchoolError {
  constructor(message: string) {
    super('SCHOOL_REJECTED', message);
    this.name = 'SchoolRejected';
  }
}

/** 학교 계정을 연동하지 않았거나 연동한 학번과 다름 */
export class SchoolNotLinked extends SchoolError {
  constructor(message = '학교 계정이 연동되어 있지 않아요. 먼저 학교 계정을 연동해 주세요.') {
    super('SCHOOL_NOT_LINKED', message);
    this.name = 'SchoolNotLinked';
  }
}

/** 요청 자체가 잘못됨 (형식·권한·횟수 제한). 학교와는 상관없다. */
export class ApiInputError extends Error {
  readonly status: number;
  readonly code:
    | 'INVALID'
    | 'NOT_FOUND'
    | 'FORBIDDEN'
    | 'RATE_LIMITED'
    // 가입·연동에서 쓰는 충돌(409)
    | 'USERNAME_TAKEN'
    | 'SCHOOL_ALREADY_REGISTERED'
    // 학교 인증 확인표(ticket)가 틀렸거나 만료됨(400)
    | 'TICKET_INVALID';
  /** 어느 입력 칸의 문제인지(INVALID 일 때 화면이 그 칸에 문장을 붙인다). 없을 수 있다 */
  readonly field?: string;
  /** `status` 는 코드의 기본 상태를 바꿔야 할 때만 쓴다 (예: 세션이 사라진 사용자는 FORBIDDEN 코드에 401) */
  constructor(code: ApiInputError['code'], message: string, status?: number, field?: string) {
    super(message);
    this.name = 'ApiInputError';
    this.code = code;
    this.field = field;
    this.status =
      status ??
      {
        INVALID: 400,
        NOT_FOUND: 404,
        FORBIDDEN: 403,
        RATE_LIMITED: 429,
        USERNAME_TAKEN: 409,
        SCHOOL_ALREADY_REGISTERED: 409,
        TICKET_INVALID: 400,
      }[code];
  }
}

/**
 * 로그인 토큰은 유효한데 users 행이 없다 (탈퇴한 사용자의 남은 토큰, 최대 7일).
 * 라운지의 withUser 와 같은 응답(401 — 앱이 로그아웃 처리한다). 이런 사용자가 서버를 학교 로그인 프록시로 쓰지 못하게 한다.
 */
export const sessionGone = (): ApiInputError => new ApiInputError('FORBIDDEN', '세션이 만료되었습니다. 다시 로그인해 주세요.', 401);

/** `SchoolErrorCode` → HTTP 상태. AUTH_FAILED 를 401 로 두면 앱 로그아웃(401 인터셉터)과 섞이므로 422. */
export const SCHOOL_ERROR_STATUS: Record<SchoolErrorCode, number> = {
  SCHOOL_NOT_LINKED: 409,
  SCHOOL_AUTH_FAILED: 422,
  SCHOOL_LOCKED: 429,
  SCHOOL_UNAVAILABLE: 502,
  SCHOOL_REJECTED: 422,
};

/**
 * 학교·입력 오류 → 응답(상태·본문·Retry-After). 학교 라우터(/api/school)와 가입 라우터(/api/auth)가 같은 모양으로 답하도록 한 곳에 둔다.
 * 오류 객체에는 평문·요청 본문이 없고 메시지는 고정 문장이다. 해당하지 않는 오류면 null (호출한 쪽이 전역 오류 처리기로 넘긴다).
 */
export function errorResponseOf(err: unknown): { status: number; body: Record<string, unknown>; retryAfter?: number } | null {
  if (err instanceof SchoolError) {
    const body: Record<string, unknown> = { error: err.message, code: err.code };
    let retryAfter: number | undefined;
    if (err instanceof SchoolLocked) {
      // 화면이 남은 시간(30분 잠금)이나 "학교 포털에서 확인한 뒤 다시 연동" 안내(long)를 고를 수 있게 한다.
      // long 은 시간이 지나도 풀리지 않는다(retryAfterSec=0). needsRelink=true 면 새 비밀번호로 다시 연동할 수 있고,
      // false 면 완전히 중단된 것이라 운영자가 풀어 주어야 한다.
      body.retryAfterSec = err.retryAfterSec;
      body.long = err.long;
      body.needsRelink = err.needsRelink;
      if (!err.long) retryAfter = err.retryAfterSec;
    }
    return { status: SCHOOL_ERROR_STATUS[err.code], body, retryAfter };
  }
  if (err instanceof ApiInputError) {
    const body: Record<string, unknown> = { error: err.message, code: err.code };
    if (err.field) body.field = err.field;
    return { status: err.status, body };
  }
  return null;
}

// ── 주소 · 호스트 화이트리스트 ─────────────────────────────────────

export type SchoolOrigins = {
  /** 개인 포털 (EUC-KR) */
  info: string;
  /** 시설 예약 (공용 CMS) */
  resve: string;
  /** e-class (Moodle). 생략하면 info 가 가짜 학교일 때는 같은 가짜 학교, 아니면 운영 주소 */
  eclass?: string;
};

/** 운영에서 쓰는 유일한 대상 */
export const SCHOOL_ORIGINS: SchoolOrigins = {
  info: 'https://info.hansung.ac.kr',
  resve: 'https://hansung.ac.kr',
  eclass: 'https://learn.hansung.ac.kr',
};

export const SCHOOL_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

export const REQUEST_TIMEOUT_MS = 10_000;
export const MAX_BODY_BYTES = 2 * 1024 * 1024;
export const MAX_REDIRECTS = 5;

/** 파일시스템이 유지되지 않는 서버리스 환경인지 (server/db.ts 의 isServerless 와 같은 기준 — db.ts 를 끌어오지 않으려고 따로 둔다) */
const isServerless = Boolean(process.env.VERCEL ?? process.env.NETLIFY ?? process.env.AWS_LAMBDA_FUNCTION_NAME);

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

const isProduction = (): boolean => process.env.NODE_ENV === 'production';

function isLoopbackOrigin(origin: string): boolean {
  try {
    const u = new URL(origin);
    return (u.protocol === 'http:' || u.protocol === 'https:') && LOOPBACK_HOSTS.has(u.hostname) && u.pathname === '/';
  } catch {
    return false;
  }
}

/**
 * 개발·테스트용 가짜 학교 주소 (`SCHOOL_MOCK_ORIGIN=http://127.0.0.1:포트`).
 * 운영(NODE_ENV=production)·서버리스에서는 값이 있어도 **무시**하고, 루프백 주소가 아니면 거부한다.
 * 그래서 운영 코드는 어떤 설정으로도 학교 호스트 두 곳 밖으로 요청을 보낼 수 없다.
 */
export function mockOriginFromEnv(): string | null {
  const raw = process.env.SCHOOL_MOCK_ORIGIN;
  if (!raw) return null;
  if (isProduction() || isServerless) {
    console.warn('[school] 운영 환경에서는 SCHOOL_MOCK_ORIGIN 을 무시합니다.');
    return null;
  }
  const origin = raw.replace(/\/+$/, '');
  if (!isLoopbackOrigin(origin)) {
    console.warn('[school] SCHOOL_MOCK_ORIGIN 은 localhost/127.0.0.1 주소만 허용합니다. 무시합니다.');
    return null;
  }
  return origin;
}

export function resolveOrigins(): SchoolOrigins {
  const mock = mockOriginFromEnv();
  return mock ? { info: mock, resve: mock, eclass: mock } : SCHOOL_ORIGINS;
}

function checkOrigins(origins: SchoolOrigins): void {
  for (const origin of [origins.info, origins.resve, origins.eclass].filter((o): o is string => typeof o === 'string')) {
    if (origin === SCHOOL_ORIGINS.info || origin === SCHOOL_ORIGINS.resve || origin === SCHOOL_ORIGINS.eclass) continue;
    if (!isProduction() && isLoopbackOrigin(origin)) continue;
    throw new Error('허용되지 않은 학교 주소입니다.');
  }
}

// ── 쿠키 jar ─────────────────────────────────────────────────────

type Cookie = {
  name: string;
  value: string;
  /** 소문자, 앞의 점 없음 */
  domain: string;
  hostOnly: boolean;
  path: string;
  secure: boolean;
  /** epoch ms. null 이면 세션 쿠키 */
  expiresAt: number | null;
};

function defaultPath(pathname: string): string {
  if (!pathname.startsWith('/')) return '/';
  const i = pathname.lastIndexOf('/');
  return i <= 0 ? '/' : pathname.slice(0, i);
}

function domainMatches(host: string, domain: string, hostOnly: boolean): boolean {
  if (hostOnly) return host === domain;
  return host === domain || host.endsWith(`.${domain}`);
}

function pathMatches(requestPath: string, cookiePath: string): boolean {
  if (requestPath === cookiePath) return true;
  if (!requestPath.startsWith(cookiePath)) return false;
  return cookiePath.endsWith('/') || requestPath[cookiePath.length] === '/';
}

/** 인스턴스별 쿠키 저장소. RFC 6265 중 이 앱에 필요한 만큼(Domain·Path·Max-Age/Expires·Secure)만 따른다. */
export class CookieJar {
  private cookies: Cookie[] = [];

  /** 응답의 Set-Cookie 들을 저장한다. 요청 호스트와 맞지 않는 Domain 은 거부한다. */
  store(requestUrl: URL, setCookies: string[], nowMs: number): void {
    const host = requestUrl.hostname.toLowerCase();
    for (const line of setCookies) {
      const parts = line.split(';');
      const first = parts.shift() ?? '';
      const eq = first.indexOf('=');
      if (eq <= 0) continue;
      const name = first.slice(0, eq).trim();
      const value = first.slice(eq + 1).trim();
      if (!name) continue;

      let domain = host;
      let hostOnly = true;
      let path = defaultPath(requestUrl.pathname);
      let secure = false;
      let expiresAt: number | null = null;
      let maxAge: number | null = null;
      let rejected = false;

      for (const attr of parts) {
        const i = attr.indexOf('=');
        const key = (i < 0 ? attr : attr.slice(0, i)).trim().toLowerCase();
        const val = i < 0 ? '' : attr.slice(i + 1).trim();
        if (key === 'domain' && val) {
          const d = val.replace(/^\./, '').toLowerCase();
          if (!domainMatches(host, d, false)) {
            rejected = true;
            break;
          }
          domain = d;
          hostOnly = false;
        } else if (key === 'path' && val.startsWith('/')) {
          path = val;
        } else if (key === 'secure') {
          secure = true;
        } else if (key === 'max-age') {
          const n = Number(val);
          if (Number.isFinite(n)) maxAge = n;
        } else if (key === 'expires') {
          const t = Date.parse(val);
          if (!Number.isNaN(t)) expiresAt = t;
        }
      }
      if (rejected) continue;
      if (maxAge !== null) expiresAt = nowMs + maxAge * 1000;

      // 같은 (이름, 도메인, 경로) 는 덮어쓴다. 만료된 값이면 지우는 뜻이다.
      this.cookies = this.cookies.filter((c) => !(c.name === name && c.domain === domain && c.path === path));
      if (expiresAt !== null && expiresAt <= nowMs) continue;
      this.cookies.push({ name, value, domain, hostOnly, path, secure, expiresAt });
    }
  }

  private matching(url: URL, nowMs: number): Cookie[] {
    const host = url.hostname.toLowerCase();
    const https = url.protocol === 'https:';
    return this.cookies
      .filter(
        (c) =>
          (c.expiresAt === null || c.expiresAt > nowMs) &&
          domainMatches(host, c.domain, c.hostOnly) &&
          pathMatches(url.pathname || '/', c.path) &&
          (!c.secure || https),
      )
      .sort((a, b) => b.path.length - a.path.length);
  }

  /** `Cookie` 요청 헤더 값. 보낼 게 없으면 빈 문자열 */
  header(url: URL, nowMs: number): string {
    return this.matching(url, nowMs)
      .map((c) => `${c.name}=${c.value}`)
      .join('; ');
  }

  /**
   * 이 호스트에서 받은 같은 이름의 쿠키가 있는가 (값이 비어 있지 않고 만료 전).
   * 로그인 판정(`ssotoken`)에 쓰므로 Path·Secure 는 따지지 않는다 — 파이썬이 `"ssotoken" in session.cookies` 로
   * 이름만 보는 것과 같게, 경로가 달라서 성공한 로그인을 실패로 잘못 세는 일을 막는다.
   */
  has(name: string, host: string, nowMs: number): boolean {
    const h = host.toLowerCase();
    return this.cookies.some(
      (c) =>
        c.name === name &&
        c.value !== '' &&
        (c.expiresAt === null || c.expiresAt > nowMs) &&
        domainMatches(h, c.domain, c.hostOnly),
    );
  }
}

// ── 요청 ─────────────────────────────────────────────────────────

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export type SchoolHttpOptions = {
  fetch?: FetchLike;
  origins?: SchoolOrigins;
  timeoutMs?: number;
  maxBytes?: number;
  now?: () => number;
};

export type SchoolRequest = {
  method?: 'GET' | 'POST';
  /** 폼 본문 (순서 유지). 학교 서버가 필드 순서에 민감할 수 있어 배열도 받는다 */
  form?: [string, string][] | Record<string, string>;
  headers?: Record<string, string>;
  /** 리다이렉트를 따라갈지. 로그인·최종 제출은 false */
  follow?: boolean;
  /** 'auto' 는 응답 헤더의 charset 을 따르고 없으면 utf-8 */
  encoding?: 'utf-8' | 'euc-kr' | 'auto';
};

export type SchoolResponse = {
  status: number;
  /** 마지막으로 응답한 주소 (리다이렉트를 따라갔다면 최종 주소) */
  url: string;
  /** 리다이렉트를 따라가지 않았을 때 Location (절대 주소) */
  location: string | null;
  text: string;
};

function describeFailure(err: unknown): string {
  const e = err as { name?: string; cause?: { code?: string } } | null;
  if (e?.name === 'TimeoutError' || e?.name === 'AbortError') return 'timeout';
  return String(e?.cause?.code ?? e?.name ?? 'error');
}

/** 지정한 인코딩(또는 헤더 charset)으로 디코딩한다. 모르는 charset 이면 utf-8. 잘못된 바이트는 대체 문자로 둔다 */
export function decodeBody(bytes: Uint8Array, encoding: 'utf-8' | 'euc-kr' | 'auto', contentType: string | null): string {
  let label: string = encoding;
  if (encoding === 'auto') {
    const m = /charset\s*=\s*"?([\w-]+)/i.exec(contentType ?? '');
    label = m ? m[1].toLowerCase() : 'utf-8';
  }
  try {
    return new TextDecoder(label).decode(bytes);
  } catch {
    return new TextDecoder('utf-8').decode(bytes);
  }
}

function concat(chunks: Uint8Array[], total: number): Uint8Array {
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

/** 한 학교 호스트(origin)에 묶인 클라이언트. 쿠키 jar 는 인스턴스마다 따로 가진다. */
export class SchoolHttp {
  readonly jar = new CookieJar();
  readonly origin: string;
  private readonly allowedHosts: Set<string>;
  private readonly doFetch: FetchLike;
  private readonly timeoutMs: number;
  private readonly maxBytes: number;
  private readonly now: () => number;

  constructor(kind: 'info' | 'resve' | 'eclass', opts: SchoolHttpOptions = {}) {
    const origins = opts.origins ?? resolveOrigins();
    checkOrigins(origins);
    // 가짜 학교(info 가 운영 주소가 아님)면 e-class 도 같은 가짜 학교로 보낸다
    const eclass = origins.eclass ?? (origins.info === SCHOOL_ORIGINS.info ? SCHOOL_ORIGINS.eclass! : origins.info);
    this.origin = kind === 'eclass' ? eclass : origins[kind];
    this.allowedHosts = new Set([new URL(origins.info).host, new URL(origins.resve).host, new URL(eclass).host]);
    this.doFetch = opts.fetch ?? ((input, init) => fetch(input, init));
    this.timeoutMs = opts.timeoutMs ?? REQUEST_TIMEOUT_MS;
    this.maxBytes = opts.maxBytes ?? MAX_BODY_BYTES;
    this.now = opts.now ?? Date.now;
  }

  /** 상대 경로(`/…`)를 이 클라이언트의 학교 주소로 만든다 */
  url(path: string): string {
    return `${this.origin}${path}`;
  }

  /** 이 클라이언트의 학교 호스트에서 받은 같은 이름의 쿠키가 있는가 (예: ssotoken) */
  hasCookie(name: string): boolean {
    return this.jar.has(name, new URL(this.origin).hostname, this.now());
  }

  /** 학교 호스트 화이트리스트 검사. 통과하지 못하면 요청을 보내지 않는다. */
  private assertAllowed(url: URL): void {
    const loopback = LOOPBACK_HOSTS.has(url.hostname);
    const okProtocol = url.protocol === 'https:' || (loopback && !isProduction() && url.protocol === 'http:');
    if (!okProtocol || !this.allowedHosts.has(url.host)) {
      console.warn('[school] 허용되지 않은 주소로의 요청을 막았습니다:', url.host);
      throw new SchoolUnavailable('학교 사이트가 예상하지 못한 주소로 안내해서 중단했어요.');
    }
  }

  /**
   * 요청 한 번. 오류는 모두 `SchoolError`(대개 SchoolUnavailable)로 바뀌어 나간다.
   * 본문·헤더 값은 어디에도 기록하지 않는다.
   */
  async request(target: string, req: SchoolRequest = {}): Promise<SchoolResponse> {
    const follow = req.follow ?? true;
    const signal = AbortSignal.timeout(this.timeoutMs);
    let method = req.method ?? 'GET';
    let body: string | undefined =
      req.form === undefined
        ? undefined
        : new URLSearchParams(Array.isArray(req.form) ? req.form : Object.entries(req.form)).toString();
    let url = new URL(target.startsWith('/') ? this.url(target) : target);

    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      this.assertAllowed(url);
      const headers: Record<string, string> = {
        'User-Agent': SCHOOL_USER_AGENT,
        ...(body !== undefined ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
        ...req.headers,
      };
      const cookie = this.jar.header(url, this.now());
      if (cookie) headers.Cookie = cookie;

      let res: Response;
      try {
        res = await this.doFetch(url.toString(), { method, headers, body, redirect: 'manual', signal });
      } catch (err) {
        console.warn('[school] 요청 실패:', url.host + url.pathname, describeFailure(err));
        throw new SchoolUnavailable();
      }

      const setCookies = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
      if (setCookies.length > 0) this.jar.store(url, setCookies, this.now());

      const location = res.headers.get('location');
      const isRedirect = res.status >= 300 && res.status < 400 && location !== null;
      if (isRedirect) {
        let next: URL;
        try {
          next = new URL(location, url);
        } catch {
          await res.body?.cancel().catch(() => undefined);
          throw new SchoolUnavailable();
        }
        if (!follow) {
          await res.body?.cancel().catch(() => undefined);
          return { status: res.status, url: url.toString(), location: next.toString(), text: '' };
        }
        await res.body?.cancel().catch(() => undefined);
        // requests/브라우저와 같게: 301·302·303 은 GET 으로 바꾸고, 307·308 은 그대로 보낸다.
        if (res.status !== 307 && res.status !== 308) {
          method = 'GET';
          body = undefined;
        }
        url = next;
        continue;
      }

      let bytes: Uint8Array;
      try {
        bytes = await this.readBody(res);
      } catch (err) {
        if (err instanceof SchoolError) throw err;
        console.warn('[school] 응답 읽기 실패:', url.host + url.pathname, describeFailure(err));
        throw new SchoolUnavailable();
      }
      return {
        status: res.status,
        url: url.toString(),
        location: null,
        text: decodeBody(bytes, req.encoding ?? 'auto', res.headers.get('content-type')),
      };
    }
    throw new SchoolUnavailable('학교 사이트가 계속 다른 주소로 안내해서 중단했어요.');
  }

  private async readBody(res: Response): Promise<Uint8Array> {
    const tooBig = () => new SchoolUnavailable('학교 사이트의 응답이 너무 커서 중단했어요.');
    const declared = Number(res.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > this.maxBytes) {
      await res.body?.cancel().catch(() => undefined);
      throw tooBig();
    }
    if (!res.body) return new Uint8Array();
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > this.maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw tooBig();
      }
      chunks.push(value);
    }
    return concat(chunks, total);
  }

  get(path: string, req: Omit<SchoolRequest, 'method' | 'form'> = {}): Promise<SchoolResponse> {
    return this.request(path, { ...req, method: 'GET' });
  }

  post(path: string, form: SchoolRequest['form'], req: Omit<SchoolRequest, 'method' | 'form'> = {}): Promise<SchoolResponse> {
    return this.request(path, { ...req, method: 'POST', form: form ?? {} });
  }
}
