import { afterEach, describe, expect, it, vi } from 'vitest';
import iconv from 'iconv-lite';
import {
  CookieJar,
  MAX_BODY_BYTES,
  SCHOOL_ORIGINS,
  SchoolHttp,
  SchoolUnavailable,
  decodeBody,
  mockOriginFromEnv,
  resolveOrigins,
} from './http.js';
import type { FetchLike } from './http.js';

const NOW = Date.UTC(2026, 9, 8, 3, 0, 0);

type Seen = { url: string; method: string; headers: Record<string, string>; body: string | undefined; redirect: unknown };

/** 요청을 기록하고 미리 정한 응답을 차례로 돌려주는 가짜 fetch */
function scripted(responses: (Response | Error)[]): { fetch: FetchLike; seen: Seen[] } {
  const seen: Seen[] = [];
  let i = 0;
  const fetch: FetchLike = async (input, init) => {
    seen.push({
      url: input,
      method: String(init.method),
      headers: init.headers as Record<string, string>,
      body: init.body as string | undefined,
      redirect: init.redirect,
    });
    const r = responses[Math.min(i++, responses.length - 1)];
    if (r instanceof Error) throw r;
    return r;
  };
  return { fetch, seen };
}

const redirect = (location: string, status = 302, cookies: string[] = []): Response => {
  const h = new Headers({ location });
  for (const c of cookies) h.append('set-cookie', c);
  return new Response(null, { status, headers: h });
};

const make = (fetch: FetchLike, kind: 'info' | 'resve' = 'info') => new SchoolHttp(kind, { fetch, origins: SCHOOL_ORIGINS, now: () => NOW });

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('호스트 화이트리스트', () => {
  it('허용 호스트 두 곳이 아니면 요청을 보내지 않는다', async () => {
    const { fetch, seen } = scripted([new Response('ok')]);
    const http = make(fetch);
    await expect(http.get('https://evil.example.com/x')).rejects.toBeInstanceOf(SchoolUnavailable);
    await expect(http.get('http://info.hansung.ac.kr/x')).rejects.toBeInstanceOf(SchoolUnavailable); // 평문 http 금지
    await expect(http.get('https://info.hansung.ac.kr.evil.com/x')).rejects.toBeInstanceOf(SchoolUnavailable);
    expect(seen).toHaveLength(0);
  });

  it('두 학교 호스트는 허용한다', async () => {
    const { fetch, seen } = scripted([new Response('a'), new Response('b')]);
    await make(fetch, 'info').get('/');
    await make(fetch, 'resve').get('/resve/x');
    expect(seen.map((s) => s.url)).toEqual(['https://info.hansung.ac.kr/', 'https://hansung.ac.kr/resve/x']);
  });

  it('리다이렉트가 다른 호스트로 향하면 따라가지 않고 중단한다', async () => {
    const { fetch, seen } = scripted([redirect('https://evil.example.com/steal'), new Response('x')]);
    await expect(make(fetch).get('/')).rejects.toBeInstanceOf(SchoolUnavailable);
    expect(seen).toHaveLength(1);
  });

  it('허용되지 않은 학교 주소 설정은 생성 단계에서 거부한다', () => {
    expect(() => new SchoolHttp('info', { origins: { info: 'https://evil.example.com', resve: 'https://hansung.ac.kr' } })).toThrow();
  });
});

describe('요청 방식', () => {
  it("redirect:'manual' 로 보내고 항상 같은 User-Agent 를 쓴다", async () => {
    const { fetch, seen } = scripted([new Response('a'), new Response('b')]);
    const http = make(fetch);
    await http.get('/a');
    await http.post('/b', [['k', 'v']]);
    expect(seen.every((s) => s.redirect === 'manual')).toBe(true);
    expect(seen[0].headers['User-Agent']).toBe(seen[1].headers['User-Agent']);
    expect(seen[1].headers['Content-Type']).toBe('application/x-www-form-urlencoded');
    expect(seen[1].body).toBe('k=v');
  });

  it('follow:false 이면 리다이렉트를 따라가지 않고 Location 을 돌려준다', async () => {
    const { fetch, seen } = scripted([redirect('/h_dae/dae_main.html')]);
    const res = await make(fetch).post('/login', [['a', 'b']], { follow: false });
    expect(res.status).toBe(302);
    expect(res.location).toBe('https://info.hansung.ac.kr/h_dae/dae_main.html');
    expect(seen).toHaveLength(1);
  });

  it('리다이렉트를 따라갈 때 302 는 GET 으로 바꾸고 307 은 그대로 보낸다', async () => {
    const a = scripted([redirect('/next', 302), new Response('done')]);
    await make(a.fetch).post('/p', [['a', '1']]);
    expect(a.seen[1]).toMatchObject({ method: 'GET', body: undefined });
    const b = scripted([redirect('/next', 307), new Response('done')]);
    await make(b.fetch).post('/p', [['a', '1']]);
    expect(b.seen[1]).toMatchObject({ method: 'POST', body: 'a=1' });
  });

  it('리다이렉트가 끝없이 이어지면 중단한다', async () => {
    const { fetch, seen } = scripted([redirect('/loop')]);
    await expect(make(fetch).get('/')).rejects.toBeInstanceOf(SchoolUnavailable);
    expect(seen.length).toBeLessThanOrEqual(6);
  });

  it('네트워크 오류·타임아웃은 SchoolUnavailable 이고 요청 본문이 메시지에 없다', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { fetch } = scripted([Object.assign(new TypeError('fetch failed passwd=SECRET-PW'), { cause: { code: 'ECONNRESET' } })]);
    const err = await make(fetch).post('/login', [['passwd', 'SECRET-PW']]).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SchoolUnavailable);
    expect(JSON.stringify([(err as Error).message, warn.mock.calls])).not.toContain('SECRET-PW');
  });

  it('응답이 2MB 를 넘으면 중단한다 (content-length / 스트림 모두)', async () => {
    const big = new Uint8Array(MAX_BODY_BYTES + 10);
    const declared = new Response(big, { headers: { 'content-length': String(big.byteLength) } });
    await expect(make(scripted([declared]).fetch).get('/')).rejects.toBeInstanceOf(SchoolUnavailable);
    const streamed = new Response(big); // content-length 없음
    streamed.headers.delete('content-length');
    await expect(make(scripted([streamed]).fetch).get('/')).rejects.toBeInstanceOf(SchoolUnavailable);
    const small = new Response(new Uint8Array(1000));
    await expect(make(scripted([small]).fetch).get('/')).resolves.toMatchObject({ status: 200 });
  });

  it('euc-kr 로 디코딩한다 / auto 는 헤더 charset 을 따른다', async () => {
    const bytes = iconv.encode('박민재 AI응용학과', 'euc-kr');
    const res = await make(scripted([new Response(new Uint8Array(bytes))]).fetch).get('/', { encoding: 'euc-kr' });
    expect(res.text).toBe('박민재 AI응용학과');
    expect(decodeBody(bytes, 'auto', 'text/html; charset=EUC-KR')).toBe('박민재 AI응용학과');
    expect(decodeBody(new TextEncoder().encode('한글'), 'auto', 'text/html')).toBe('한글');
    expect(decodeBody(new TextEncoder().encode('한글'), 'auto', 'text/html; charset=no-such-charset')).toBe('한글');
  });
});

describe('쿠키 jar', () => {
  it('Set-Cookie 를 쌓아 다음 요청에 Cookie 로 보낸다', async () => {
    const { fetch, seen } = scripted([
      redirect('/x', 200, ['JSESSIONID=abc; Path=/']),
      new Response('ok'),
    ]);
    const http = make(fetch);
    await http.get('/', { follow: false });
    await http.get('/page');
    expect(seen[1].headers.Cookie).toBe('JSESSIONID=abc');
  });

  it('인스턴스마다 따로 가진다 (다른 사용자·요청의 쿠키가 섞이지 않는다)', async () => {
    const a = scripted([redirect('/', 302, ['ssotoken=A; Path=/']), new Response('x')]);
    const b = scripted([new Response('x')]);
    const ha = make(a.fetch);
    const hb = make(b.fetch);
    await ha.get('/', { follow: false });
    expect(ha.hasCookie('ssotoken')).toBe(true);
    await hb.get('/');
    expect(hb.hasCookie('ssotoken')).toBe(false);
    expect(b.seen[0].headers.Cookie).toBeUndefined();
  });

  it('Domain 속성(.hansung.ac.kr)은 하위 호스트에 보내고, Domain 이 없으면 그 호스트에만 보낸다', () => {
    const jar = new CookieJar();
    const info = new URL('https://info.hansung.ac.kr/servlet/login');
    jar.store(info, ['sso=1; Domain=.hansung.ac.kr; Path=/', 'sess=2; Path=/'], NOW);
    expect(jar.header(new URL('https://hansung.ac.kr/resve/x'), NOW)).toBe('sso=1');
    expect(jar.header(new URL('https://info.hansung.ac.kr/y'), NOW)).toBe('sso=1; sess=2');
    expect(jar.header(new URL('https://www.hansung.ac.kr/y'), NOW)).toBe('sso=1');
  });

  it('요청 호스트와 맞지 않는 Domain 은 거부한다', () => {
    const jar = new CookieJar();
    jar.store(new URL('https://info.hansung.ac.kr/'), ['x=1; Domain=evil.com; Path=/', 'y=1; Domain=ac.kr.evil.com'], NOW);
    expect(jar.header(new URL('https://evil.com/'), NOW)).toBe('');
    expect(jar.header(new URL('https://info.hansung.ac.kr/'), NOW)).toBe('');
  });

  it('Path · Secure · 만료를 반영하고, 만료된 값으로 덮으면 지운다', () => {
    const jar = new CookieJar();
    const u = new URL('https://hansung.ac.kr/resve/a/b');
    jar.store(u, ['p=1; Path=/resve', 'q=2; Path=/other', 's=3; Secure; Path=/', 'm=4; Max-Age=60; Path=/'], NOW);
    expect(jar.header(new URL('https://hansung.ac.kr/resve/a'), NOW)).toBe('p=1; s=3; m=4');
    expect(jar.header(new URL('https://hansung.ac.kr/resve/a'), NOW + 61_000)).toBe('p=1; s=3');
    jar.store(u, ['p=; Max-Age=0; Path=/resve'], NOW);
    expect(jar.header(new URL('https://hansung.ac.kr/resve/a'), NOW)).toBe('s=3; m=4');
    expect(jar.has('ssotoken', u.hostname, NOW)).toBe(false);
  });

  it('has: 로그인 판정은 쿠키 이름으로만 본다 (Path 가 달라도 성공한 로그인을 실패로 세지 않는다)', () => {
    const jar = new CookieJar();
    jar.store(new URL('https://hansung.ac.kr/hnuLogin/cncschool/loginProcess.do'), ['ssotoken=T; Path=/hnuLogin/cncschool', 'empty=; Path=/'], NOW);
    expect(jar.has('ssotoken', 'hansung.ac.kr', NOW)).toBe(true);
    expect(jar.has('ssotoken', 'info.hansung.ac.kr', NOW)).toBe(false); // 호스트 전용 쿠키는 다른 호스트에서 보이지 않는다
    expect(jar.has('empty', 'hansung.ac.kr', NOW)).toBe(false); // 빈 값은 없는 것과 같다
    expect(jar.has('ssotoken', 'hansung.ac.kr', NOW)).toBe(true);
  });
});

describe('SCHOOL_MOCK_ORIGIN (테스트 전용 주입)', () => {
  it('설정이 없으면 학교 호스트 두 곳', () => {
    vi.stubEnv('SCHOOL_MOCK_ORIGIN', '');
    expect(resolveOrigins()).toEqual(SCHOOL_ORIGINS);
  });

  it('개발에서는 루프백 주소만 받아들인다', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('SCHOOL_MOCK_ORIGIN', 'http://127.0.0.1:4555/');
    expect(mockOriginFromEnv()).toBe('http://127.0.0.1:4555');
    expect(resolveOrigins()).toEqual({ info: 'http://127.0.0.1:4555', resve: 'http://127.0.0.1:4555' });
    vi.stubEnv('SCHOOL_MOCK_ORIGIN', 'https://evil.example.com');
    expect(mockOriginFromEnv()).toBeNull();
    expect(resolveOrigins()).toEqual(SCHOOL_ORIGINS);
  });

  it('운영(NODE_ENV=production)에서는 루프백이어도 무시한다', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('SCHOOL_MOCK_ORIGIN', 'http://127.0.0.1:4555');
    expect(mockOriginFromEnv()).toBeNull();
    expect(resolveOrigins()).toEqual(SCHOOL_ORIGINS);
    expect(() => new SchoolHttp('info', { origins: { info: 'http://127.0.0.1:4555', resve: 'http://127.0.0.1:4555' } })).toThrow();
  });

  it('루프백 http 주소로는 개발에서만 요청할 수 있다', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    const { fetch, seen } = scripted([new Response('ok')]);
    const http = new SchoolHttp('info', { fetch, origins: { info: 'http://127.0.0.1:4555', resve: 'http://127.0.0.1:4555' } });
    await http.get('/');
    expect(seen[0].url).toBe('http://127.0.0.1:4555/');
    await expect(http.get('http://127.0.0.1:9999/')).rejects.toBeInstanceOf(SchoolUnavailable); // 포트가 다르면 다른 호스트
  });
});
