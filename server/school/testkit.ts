/**
 * 테스트·점검용 **가짜 학교**. 실제 학교와는 아무 상관이 없다 — 파이썬 원본이 파싱하는 모양을 흉내 낸 고정 응답만 돌려준다.
 *  - 단위 테스트: `fake.fetch` 를 SchoolHttp 에 주입한다 (호출 횟수·요청 본문 확인).
 *  - 실제 HTTP 확인: `.tmp/s4/mock-school.ts` 가 `fake.handle` 을 로컬 HTTP 서버로 감싼다.
 * 운영 코드는 이 파일을 가져오지 않는다.
 */
import iconv from 'iconv-lite';
import type { FetchLike } from './http.js';

export type FakeReq = {
  method: string;
  /** 경로+쿼리 (호스트 제외) */
  path: string;
  headers: Record<string, string>;
  body: string;
};

export type FakeRes = {
  status: number;
  headers?: Record<string, string | string[]>;
  body?: string | Uint8Array;
};

type SpaceDef = { id: number; name: string };

export type FakeSchoolOptions = {
  /** 학번 → 비밀번호 */
  users?: Record<string, string>;
  /** 학번 → 표시 이름 */
  names?: Record<string, string>;
  /** 로그인 판정을 못 내리는 점검 상태 (로그인 화면이 503) */
  maintenance?: boolean;
  /** 예약 시스템 키 → 공간들 */
  spaces?: Record<string, SpaceDef[]>;
  /** "<키>|<공간id>|<날짜>" → 이미 예약된 슬롯 시작 시각들 */
  booked?: Record<string, string[]>;
  /** 슬롯 단위(분). 기본 60 */
  termMin?: number;
  /** 운영 요일. 기본 월~금 */
  posblDay?: string;
  /** 추가 항목. 없으면 학교처럼 빈 placeholder 를 돌려준다 */
  items?: { itemNm: string; mustYn: string }[];
  /** AJAX 서버 검증 응답 본문 원문. 기본 "[]" */
  validationBody?: string;
  /** true 면 본 제출이 와도 내 신청내역에 행을 만들지 않는다 (확인 불가 → unknown 시나리오) */
  dropBooking?: boolean;
  /** 이 조건을 만족하는 요청은 네트워크 오류로 끊는다 */
  failNetwork?: (req: FakeReq) => boolean;
  /** 내 신청내역 한 쪽 행 수 (기본 100) */
  pageSize?: number;
  /** 로그인 후 응답할 이름이 없을 때 쓸 이름 */
  defaultName?: string;
  /** 개인시간표 이벤트(FullCalendar 모양). 없으면 기본 4건 */
  timetable?: unknown[];
};

export type FakeSchool = ReturnType<typeof createFakeSchool>;

const DEFAULT_SPACES: Record<string, SpaceDef[]> = {
  'cncschool/2': [
    { id: 47, name: '소모임실 Challenge' },
    { id: 48, name: '소모임실 Collaboration' },
  ],
  'cncschool/7': [{ id: 58, name: '세미나실 101호' }],
  'onestop/16': [{ id: 71, name: 'IB101' }],
  'hsel/14': [{ id: 90, name: '그룹스터디실(3F-1)' }],
};

const SLOTS = Array.from({ length: 13 }, (_, i) => `${String(9 + i).padStart(2, '0')}:00`);

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

export function createFakeSchool(opts: FakeSchoolOptions = {}) {
  const users: Record<string, string> = { ...(opts.users ?? { '2021204044': 'right-pass' }) };
  const names = opts.names ?? {};
  const spaces = opts.spaces ?? DEFAULT_SPACES;
  const pageSize = opts.pageSize ?? 100;
  const termMin = opts.termMin ?? 60;

  /** 발급한 로그인 토큰 → 학번 */
  const tokens = new Map<string, string>();
  /** 내 신청내역: "<site>/<fn>" → 학번 → 행들 */
  const mine = new Map<string, Map<string, string[][]>>();
  let nextNo = 100;

  const state = {
    /** 모든 요청의 (메서드, 경로) — 본문·헤더는 기록하지 않는다 */
    calls: [] as { method: string; path: string }[],
    /** 학교 로그인 POST 가 온 횟수 */
    infoLogins: 0,
    resveLogins: 0,
    /** artclRegist.do 로 온 요청들 (ajax 여부, 폼 필드 순서 그대로) */
    registPosts: [] as { ajax: boolean; pairs: [string, string][]; referer: string }[],
    mine,
    opts,
  };

  const loginCalls = (): number => state.infoLogins + state.resveLogins;

  function cookieOf(req: FakeReq): Record<string, string> {
    const out: Record<string, string> = {};
    for (const part of (req.headers.cookie ?? '').split(';')) {
      const i = part.indexOf('=');
      if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
    }
    return out;
  }

  /** 로그인한 학번 (없으면 null) */
  const who = (req: FakeReq): string | null => tokens.get(cookieOf(req).ssotoken ?? '') ?? null;

  const json = (data: unknown, status = 200): FakeRes => ({
    status,
    headers: { 'content-type': 'application/json;charset=UTF-8' },
    body: JSON.stringify(data),
  });
  const html = (body: string, status = 200): FakeRes => ({
    status,
    headers: { 'content-type': 'text/html;charset=UTF-8' },
    body,
  });
  const euckr = (body: string, type: string): FakeRes => ({
    status: 200,
    headers: { 'content-type': type },
    body: iconv.encode(body, 'euc-kr'),
  });
  const redirect = (location: string, cookies: string[] = []): FakeRes => ({
    status: 302,
    headers: { location, ...(cookies.length > 0 ? { 'set-cookie': cookies } : {}) },
  });

  function login(req: FakeReq, idField: string, pwField: string): { ok: boolean; id: string } {
    const form = new URLSearchParams(req.body);
    const id = form.get(idField) ?? '';
    const ok = Object.prototype.hasOwnProperty.call(users, id) && users[id] === (form.get(pwField) ?? '');
    return { ok, id };
  }

  function mineRows(site: string, fn: string, id: string): string[][] {
    const key = `${site}/${fn}`;
    if (!mine.has(key)) mine.set(key, new Map());
    const byUser = mine.get(key)!;
    if (!byUser.has(id)) byUser.set(id, []);
    return byUser.get(id)!;
  }

  function handleResve(req: FakeReq, url: URL): FakeRes | null {
    let m = /^\/hnuLogin\/([a-z]+)\/loginView\.do$/.exec(url.pathname);
    if (m) {
      if (opts.maintenance) return html('점검 중', 503);
      return { status: 200, headers: { 'content-type': 'text/html;charset=UTF-8', 'set-cookie': ['JSESSIONID=r1; Path=/'] }, body: '<html>login</html>' };
    }
    m = /^\/hnuLogin\/([a-z]+)\/loginProcess\.do$/.exec(url.pathname);
    if (m) {
      state.resveLogins += 1;
      const r = login(req, 'userId', 'inputUserPwd');
      if (!r.ok) return redirect(`/hnuLogin/${m[1]}/loginView.do`);
      const token = `tok-${m[1]}-${r.id}`;
      tokens.set(token, r.id);
      return redirect(`/${m[1]}/main.do`, [`ssotoken=${token}; Path=/`]);
    }

    m = /^\/resve\/([a-z]+)\/(\d+)\/([A-Za-z]+\.do|resveSetup|artclSetupList|itemList|resveList)$/.exec(url.pathname);
    if (!m) return null;
    const [, site, fn, endpoint] = m;
    const key = `${site}/${fn}`;
    const form = new URLSearchParams(req.body);

    if (endpoint === 'artclList.do') {
      const options = (spaces[key] ?? []).map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join('');
      return html(`<form><select id="resveSpceSeq" name="resveSpceSeq"><option value="">선택</option>${options}</select></form>`);
    }
    // 아래 JSON 엔드포인트는 학교처럼 404 상태코드로 정상 JSON 을 준다
    if (endpoint === 'resveSetup') {
      return json(
        [
          {
            resveTm: SLOTS.join(','),
            posblDay: opts.posblDay ?? '월,화,수,목,금',
            posblBgnde: '20260101',
            posblEndde: '20261231',
            posblTm: 1,
            posblTerm: termMin,
            resveGroupSeq: 5,
          },
        ],
        404,
      );
    }
    if (endpoint === 'artclSetupList') {
      const space = (spaces[key] ?? []).find((s) => String(s.id) === form.get('resveSpceSeq'));
      return json([{ groupNm: '상상파크', spceNm: space?.name ?? '', mngr: '홍담당', telno: '02-760-4800', identityCode: 'IDENTITY_00007,IDENTITY_00008' }], 404);
    }
    if (endpoint === 'itemList') {
      return json(opts.items && opts.items.length > 0 ? opts.items : [{ itemNm: '', mustYn: '' }], 404);
    }
    if (endpoint === 'resveList') {
      const booked = opts.booked?.[`${key}|${form.get('resveSpceSeq')}|${form.get('resveDeStr')}`] ?? [];
      return json(booked.map((t) => ({ resveTm: t })), 404);
    }

    // 여기부터는 로그인이 필요하다
    const id = who(req);
    if (endpoint === 'artclView.do') {
      if (!id) return redirect(`/hnuLogin/${site}/loginView.do`);
      const page = Number(form.get('page') ?? '1');
      const all = mineRows(site, fn, id);
      const rows = all.slice((page - 1) * pageSize, page * pageSize);
      const tr = rows.length === 0
        ? '<tr class="no-data"><td colspan="8">신청내역이 없습니다.</td></tr>'
        : rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('');
      return html(`<table><tbody>${tr}</tbody></table>`);
    }
    if (endpoint === 'artclRegistView.do') {
      if (!id) return redirect(`/hnuLogin/${site}/loginView.do`);
      return redirect(`/resve/${site}/${fn}/artclRegistWrap.do`);
    }
    if (endpoint === 'artclRegistWrap.do') {
      if (!id) return html('<html>login</html>');
      const name = names[id] ?? opts.defaultName ?? '홍길동';
      return html(
        `<form name="actionForm" method="post">
           <input type="hidden" name="layout" value="abc123"/>
           <input type="text" name="userNm" value="${name}" />
           <input type="text" name="hakbun" value="${id}" />
           <input type="text" name="telno" value="010-1111-2222" />
           <input type="text" name="email" value="a&amp;b@hansung.ac.kr" />
         </form>`,
      );
    }
    if (endpoint === 'artclRegist.do') {
      if (!id) return redirect(`/hnuLogin/${site}/loginView.do`);
      const pairs = [...new URLSearchParams(req.body).entries()] as [string, string][];
      const ajax = req.headers['x-requested-with'] === 'XMLHttpRequest';
      state.registPosts.push({ ajax, pairs, referer: req.headers.referer ?? '' });
      if (ajax) return { status: 200, headers: { 'content-type': 'application/json;charset=UTF-8' }, body: opts.validationBody ?? '[]' };
      if (!opts.dropBooking) {
        const times = pairs.filter(([k]) => k === 'resveTm').map(([, v]) => v);
        const day = pairs.find(([k]) => k === 'resveDeStr')?.[1] ?? '';
        const spaceId = pairs.find(([k]) => k === 'resveSpceSeq')?.[1];
        const space = (spaces[key] ?? []).find((s) => String(s.id) === spaceId)?.name ?? '';
        const startH = Number(times[0].slice(0, 2));
        const end = `${String(startH + (times.length * termMin) / 60).padStart(2, '0')}:00`;
        mineRows(site, fn, id).push([String(++nextNo), space, day, `${times[0]}~${end}`, names[id] ?? '홍길동', id, '2026-10-08', '승인대기']);
      }
      return redirect(`/resve/${site}/${fn}/artclView.do`);
    }
    return null;
  }

  function handleInfo(req: FakeReq, url: URL): FakeRes | null {
    if (url.pathname === '/' && req.method === 'GET') {
      if (opts.maintenance) return html('점검 중', 503);
      return { status: 200, headers: { 'content-type': 'text/html', 'set-cookie': ['JSESSIONID=i1; Path=/'] }, body: '<html>main</html>' };
    }
    if (url.pathname === '/servlet/s_gong.gong_login_ssl') {
      state.infoLogins += 1;
      const r = login(req, 'id', 'passwd');
      if (!r.ok) return redirect('/');
      const token = `tok-info-${r.id}`;
      tokens.set(token, r.id);
      return redirect('/h_dae/dae_main.html', [`ssotoken=${token}; Path=/`]);
    }
    if (url.pathname === '/jsp_21/index.jsp') {
      const id = who(req);
      if (!id) return redirect('/');
      const name = names[id] ?? opts.defaultName ?? '홍길동';
      return euckr(
        `<html><div class="info">AI응용학과<br/>   <a href="/x">${name}</a></div><a href="/jsp/haksang_sajin.jsp?hakbun=${id}">사진</a></html>`,
        'text/html;charset=EUC-KR',
      );
    }
    if (url.pathname === '/jsp_21/student/kyomu/dae_sigan_main_data.jsp') {
      const id = who(req);
      if (!id) return euckr('<html>로그인 필요</html>', 'text/html;charset=EUC-KR');
      const events = opts.timetable ?? [
        { title: '자료구조(01)\n김교수\n공학관 B101', start: '2026-10-12T09:15:00', end: '2026-10-12T10:45:00' },
        { title: '자료구조(01)\n김교수\n공학관 B101', start: '2026-10-19T09:15:00', end: '2026-10-19T10:45:00' },
        { title: '운영체제(02)\n이교수\n상상관 201', start: '2026-10-14T13:00:00', end: '2026-10-14T15:00:00' },
        { title: '주말특강(01)\n박교수\n상상관 301', start: '2026-10-17T10:00:00', end: '2026-10-17T12:00:00' },
      ];
      return euckr(JSON.stringify(events), 'text/html;charset=EUC-KR');
    }
    return null;
  }

  function handle(req: FakeReq): FakeRes {
    state.calls.push({ method: req.method, path: req.path.split('?')[0] });
    const url = new URL(req.path, 'http://fake.school');
    return handleInfo(req, url) ?? handleResve(req, url) ?? { status: 404, body: 'not found' };
  }

  const fetch: FetchLike = async (input, init) => {
    const url = new URL(input);
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries((init.headers ?? {}) as Record<string, string>)) headers[k.toLowerCase()] = v;
    const req: FakeReq = {
      method: (init.method ?? 'GET').toUpperCase(),
      path: url.pathname + url.search,
      headers,
      body: typeof init.body === 'string' ? init.body : '',
    };
    if (opts.failNetwork?.(req)) {
      state.calls.push({ method: req.method, path: url.pathname });
      throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET' } });
    }
    const res = handle(req);
    const h = new Headers();
    for (const [k, v] of Object.entries(res.headers ?? {})) {
      for (const one of Array.isArray(v) ? v : [v]) h.append(k, one);
    }
    const body = res.body === undefined ? null : typeof res.body === 'string' ? res.body : res.body;
    return new Response(body as BodyInit | null, { status: res.status, headers: h });
  };

  return { handle, fetch, state, loginCalls, users, tokens };
}
