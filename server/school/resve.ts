/**
 * 시설 예약 `hansung.ac.kr/resve/<사이트>/<기능번호>/…` — 공개 조회 · 사이트별 로그인 · 내 신청내역 · 신청.
 * 원본: .tmp/reference/school-py/hansung_facility.py
 *
 * 규칙
 *  - 인스턴스 하나 = 쿠키 jar 하나 = (보통) 사이트 하나. 같은 사이트의 여러 예약 시스템 키는 로그인을 공유한다.
 *  - **로그인은 인스턴스당 사이트마다 최대 1회.** 한 번 실패한 사이트는 같은 오류를 그대로 다시 던질 뿐 학교에 다시 요청하지 않는다.
 *  - 사용자 입력은 화이트리스트(예약 시스템 키)·정수(공간 id)·검증된 날짜(YYYY-MM-DD)·슬롯 시각(HH:mm)·폼 값뿐이고
 *    URL·호스트로 쓰이지 않는다.
 *  - 평문(학번·비밀번호)·학교 응답 본문은 오류·로그에 넣지 않는다.
 */
import type { SchoolCredentials } from '../../shared/school/types.js';
import { SchoolAuthFailed, SchoolRejected, SchoolUnavailable } from './http.js';
import type { SchoolHttp, SchoolResponse } from './http.js';
import { RESERVE_SYSTEMS, sitesOf, systemByKey } from './facilityMap.js';
import type { ReserveSystem } from './facilityMap.js';
import {
  bookedSet,
  extractAlerts,
  inputValue,
  isRealDate,
  normalizeInfo,
  normalizeItems,
  normalizeSetup,
  findCancelControl,
  parseMine,
  parseMineRaw,
  parseServerCheck,
  parseSpaces,
  validationPayload,
} from './parse.js';
import type { MineRow, ResveInfo, ResveItem, ResveSetup, Space } from './parse.js';

const SSO_COOKIE = 'ssotoken';
const MINE_MAX_PAGES = 20;
const AJAX = { 'X-Requested-With': 'XMLHttpRequest' };
const ALLOWED_SITES = new Set(sitesOf(RESERVE_SYSTEMS));

function requireSystem(key: string): ReserveSystem {
  const system = systemByKey(key);
  if (!system) throw new Error('지원하지 않는 예약 시스템입니다.');
  return system;
}

/** 점검·차단(4xx/5xx)은 비밀번호 판정이 아니므로 로그인 실패로 세지 않는다 */
function assertReachable(res: SchoolResponse): void {
  if (res.status >= 400) throw new SchoolUnavailable();
}

/** 신청 화면에서 읽은 값 */
export type Registration = {
  regUrl: string;
  layout: string;
  userNm: string;
  hakbun: string;
  telno: string;
  email: string;
};

export type SendResult = { status: number; location: string; alerts: string[] };

export class ResveClient {
  /** 이 인스턴스에서 로그인에 성공한 사이트 */
  private readonly loggedIn = new Set<string>();
  /** 이 인스턴스에서 이미 로그인을 **시도한** 사이트 → 결과(성공이면 null, 실패면 그 오류). 같은 사이트로 다시 요청하지 않는다 */
  private readonly attempted = new Map<string, Error | null>();
  /** 테스트·점검용: 실제로 학교에 로그인 요청을 보낸 횟수 */
  loginRequests = 0;

  constructor(readonly http: SchoolHttp) {}

  // ── 로그인 ─────────────────────────────────────────────────────

  /**
   * 사이트별 로그인: `GET /hnuLogin/<사이트>/loginView.do` → `POST …/loginProcess.do`.
   * 성공 = 302 + `ssotoken` 쿠키. 실패하면 SchoolAuthFailed (재시도 없음), 점검·차단이면 SchoolUnavailable.
   */
  async login(site: string, creds: SchoolCredentials): Promise<void> {
    if (!ALLOWED_SITES.has(site)) throw new Error('지원하지 않는 예약 사이트입니다.');
    if (this.attempted.has(site)) {
      const earlier = this.attempted.get(site);
      if (earlier) throw earlier;
      return;
    }
    this.loginRequests += 1;
    try {
      const viewPath = `/hnuLogin/${site}/loginView.do`;
      assertReachable(await this.http.get(viewPath));
      const res = await this.http.post(
        `/hnuLogin/${site}/loginProcess.do`,
        [
          ['siteId', site],
          ['returnUrl', ''],
          ['referer', ''],
          ['userId', creds.studentId],
          ['inputUserId', creds.studentId],
          ['inputUserPwd', creds.password],
        ],
        { headers: { Referer: this.http.url(viewPath), Origin: this.http.origin }, follow: false },
      );
      assertReachable(res);
      if (res.status !== 302 || !this.http.hasCookie(SSO_COOKIE)) throw new SchoolAuthFailed();
    } catch (err) {
      this.attempted.set(site, err as Error);
      throw err;
    }
    this.attempted.set(site, null);
    this.loggedIn.add(site);
  }

  hasLoggedIn(site: string): boolean {
    return this.loggedIn.has(site);
  }

  private requireLogin(system: ReserveSystem): void {
    if (!this.loggedIn.has(system.site)) throw new Error('먼저 학교에 로그인해야 합니다.');
  }

  // ── 공개 조회 (로그인 불필요) ───────────────────────────────────

  /** JSON 을 돌려주는 AJAX 엔드포인트. 서버가 404 상태코드로 정상 JSON 을 주므로 상태코드는 무시한다 */
  private async api(key: string, endpoint: string, data: [string, string][]): Promise<unknown[]> {
    const { site, fn } = requireSystem(key);
    const res = await this.http.post(`/resve/${site}/${fn}/${endpoint}`, data, { headers: AJAX });
    let json: unknown;
    try {
      json = JSON.parse(res.text);
    } catch {
      throw new SchoolUnavailable();
    }
    if (!Array.isArray(json)) throw new SchoolUnavailable();
    return json;
  }

  /** 공간 목록 (`artclList.do` 의 `<select id="resveSpceSeq">`) */
  async spaces(key: string): Promise<Space[]> {
    const { site, fn } = requireSystem(key);
    const res = await this.http.post(`/resve/${site}/${fn}/artclList.do`, [['siteId', site]]);
    assertReachable(res);
    const spaces = parseSpaces(res.text);
    if (!spaces) throw new SchoolUnavailable('학교 예약 화면에서 공간 목록을 읽지 못했어요. 화면 구조가 바뀌었을 수 있어요.');
    return spaces;
  }

  /** 예약 설정. 설정이 없는 공간이면 null */
  async setup(key: string, spaceId: number): Promise<ResveSetup | null> {
    const rows = await this.api(key, 'resveSetup', [['resveSpceSeq', String(requireSpaceId(spaceId))]]);
    if (rows.length === 0) return null;
    const setup = normalizeSetup(rows[0]);
    if (!setup) throw new SchoolUnavailable('학교 예약 설정을 읽지 못했어요. 응답 형식이 바뀌었을 수 있어요.');
    return setup;
  }

  /** 공간 정보 (이름·담당·연락처·신청 대상 코드) */
  async info(key: string, spaceId: number): Promise<ResveInfo> {
    const rows = await this.api(key, 'artclSetupList', [['resveSpceSeq', String(requireSpaceId(spaceId))]]);
    return normalizeInfo(rows[0]);
  }

  /** 추가 항목 (항목이 없을 때 오는 빈 placeholder 는 걸러진다) */
  async items(key: string, spaceId: number): Promise<ResveItem[]> {
    return normalizeItems(await this.api(key, 'itemList', [['resveSpceSeq', String(requireSpaceId(spaceId))]]));
  }

  /** 그날 이미 예약된 슬롯 시작 시각들 */
  async booked(key: string, spaceId: number, day: string): Promise<Set<string>> {
    if (!isRealDate(day)) throw new Error('날짜 형식이 올바르지 않습니다.');
    return bookedSet(
      await this.api(key, 'resveList', [
        ['resveSpceSeq', String(requireSpaceId(spaceId))],
        ['resveDeStr', day],
      ]),
    );
  }

  // ── 내 신청내역 (로그인 필요) ───────────────────────────────────

  /**
   * 내 신청내역. `artclView.do` 를 page=1.. 반복 (최대 20쪽, 첫 행 번호가 이미 본 번호면 중단).
   * 로그인 세션이 아니거나 화면 구조가 달라서 표 자체를 찾을 수 없으면 SchoolUnavailable —
   * "신청내역이 없다"고 잘못 알려 주지 않기 위해서다.
   */
  async mine(key: string): Promise<MineRow[]> {
    const system = requireSystem(key);
    this.requireLogin(system);
    const out: MineRow[] = [];
    const seen = new Set<string>();
    for (let page = 1; page <= MINE_MAX_PAGES; page++) {
      const res = await this.http.post(`/resve/${system.site}/${system.fn}/artclView.do`, [
        ['page', String(page)],
        ['prgrsCd', ''],
      ]);
      assertReachable(res);
      const rows = parseMine(res.text);
      if (page === 1 && rows.length === 0 && !/no-data|<table|<tbody/i.test(res.text)) {
        throw new SchoolUnavailable('학교 예약 화면에서 신청내역 표를 찾지 못했어요. 화면 구조가 바뀌었을 수 있어요.');
      }
      if (rows.length === 0 || seen.has(rows[0].no)) break;
      seen.add(rows[0].no);
      out.push(...rows);
    }
    return out;
  }

  // ── 신청 취소 ──────────────────────────────────────────────────

  /** 내 신청내역의 원본 행들 (취소 컨트롤을 찾으려고 HTML 을 함께 가진다) */
  private async mineRaw(key: string): Promise<{ row: MineRow; html: string }[]> {
    const system = requireSystem(key);
    this.requireLogin(system);
    const out: { row: MineRow; html: string }[] = [];
    const seen = new Set<string>();
    for (let page = 1; page <= MINE_MAX_PAGES; page++) {
      const res = await this.http.post(`/resve/${system.site}/${system.fn}/artclView.do`, [
        ['page', String(page)],
        ['prgrsCd', ''],
      ]);
      assertReachable(res);
      const rows = parseMineRaw(res.text);
      if (rows.length === 0 || seen.has(rows[0].row.no)) break;
      seen.add(rows[0].row.no);
      out.push(...rows);
    }
    return out;
  }

  /**
   * 내 신청내역에서 (날짜·공간·시작 시각)이 맞고 아직 취소·거절되지 않은 행을 찾아, 학교가 그 행에 보여 주는 "취소" 컨트롤을 따라간다.
   * 앱이 알아볼 수 있는 방식(주소가 있는 링크·폼)일 때만 보내고, 주소는 `/resve/` 아래로만 허용한다.
   * 어떤 요청인지 알 수 없는 경우(스크립트뿐)나 취소 컨트롤이 없으면 아무것도 보내지 않고 SchoolUnavailable.
   * 보낸 뒤 신청내역을 다시 읽어 취소된 것이 확인될 때만 성공이다. 자동 재시도는 없다.
   * 반환: 'cancelled' | 'not-found'(학교 신청내역에 그 신청이 없다)
   */
  async cancelMine(key: string, want: { date: string; space: string; startHm: string }): Promise<'cancelled' | 'not-found'> {
    const system = requireSystem(key);
    const matches = (r: MineRow) =>
      r.date.includes(want.date) && r.space.includes(want.space) && r.time.includes(want.startHm) && !/취소|거절|반려/.test(r.status);
    const rows = await this.mineRaw(key);
    const hit = rows.find((r) => matches(r.row));
    if (!hit) return 'not-found';

    const control = findCancelControl(hit.html);
    if (!control || control.kind === 'script') {
      throw new SchoolUnavailable(
        '학교 신청내역에서 앱이 쓸 수 있는 취소 방법을 찾지 못했어요. 학교 사이트의 내 신청내역에서 직접 취소해 주세요.',
      );
    }
    const base = `/resve/${system.site}/${system.fn}/`;
    const toPath = (raw: string): string => {
      const path = raw.startsWith('/') ? raw : base + raw.replace(/^\.\//, '');
      if (!path.startsWith('/resve/') || path.includes('..') || /^[a-z]+:/i.test(raw)) {
        throw new SchoolUnavailable('학교 취소 주소를 확인하지 못해서 보내지 않았어요. 학교 사이트에서 직접 취소해 주세요.');
      }
      return path;
    };
    const res =
      control.kind === 'link'
        ? await this.http.get(toPath(control.href))
        : control.method === 'get'
          ? await this.http.get(`${toPath(control.action)}?${new URLSearchParams(control.fields).toString()}`)
          : await this.http.post(toPath(control.action), control.fields);
    assertReachable(res);
    const alerts = extractAlerts(res.text);
    if (alerts.length > 0 && /불가|실패|오류|없습니다|할 수 없/.test(alerts.join(' '))) throw new SchoolRejected(alerts.join(' / '));

    const after = (await this.mineRaw(key)).find((r) => r.row.no === hit.row.no);
    if (after && !/취소/.test(after.row.status)) {
      throw new SchoolUnavailable('취소 요청을 보냈지만 학교 신청내역에서 취소된 것을 확인하지 못했어요. 학교 사이트의 내 신청내역을 확인해 주세요.');
    }
    return 'cancelled';
  }

  // ── 신청 ───────────────────────────────────────────────────────

  /**
   * 신청 화면 `artclRegistView.do` 를 열어 로그인한 사용자의 이름·학번·연락처를 읽는다 (래퍼 페이지로 리다이렉트됨 —
   * 최종 주소가 Referer). `actionForm` 이 없으면 로그인 세션 문제이거나 구조가 바뀐 것이다.
   */
  async fetchRegistration(key: string): Promise<Registration> {
    const system = requireSystem(key);
    this.requireLogin(system);
    const res = await this.http.get(`/resve/${system.site}/${system.fn}/artclRegistView.do?`);
    assertReachable(res);
    if (!res.text.includes('actionForm')) {
      throw new SchoolUnavailable('학교 예약 신청 화면을 불러오지 못했어요. 로그인 세션이나 화면 구조를 확인해야 해요.');
    }
    return {
      regUrl: res.url,
      layout: inputValue(res.text, 'layout'),
      userNm: inputValue(res.text, 'userNm'),
      hakbun: inputValue(res.text, 'hakbun'),
      telno: inputValue(res.text, 'telno'),
      email: inputValue(res.text, 'email'),
    };
  }

  /**
   * ③ AJAX 서버 검증: 같은 주소에 `layout=""` + 나머지를 보낸다. 응답이 비어 있어야 통과.
   * 오류면 SchoolRejected(학교가 준 문장), 읽을 수 없는 응답이면 SchoolUnavailable — 어느 쪽이든 **본 제출은 하지 않는다.**
   */
  async validate(key: string, regUrl: string, payload: [string, string][]): Promise<void> {
    const system = requireSystem(key);
    this.requireLogin(system);
    const res = await this.http.post(`/resve/${system.site}/${system.fn}/artclRegist.do`, validationPayload(payload), {
      headers: { ...AJAX, Referer: regUrl },
    });
    const check = parseServerCheck(res.text);
    if (check.kind === 'errors') throw new SchoolRejected(check.messages.join(' / '));
    if (check.kind === 'unreadable') {
      throw new SchoolUnavailable('학교 서버의 검증 응답을 읽지 못해서 신청하지 않았어요. 학교 사이트에서 직접 신청해 주세요.');
    }
  }

  /**
   * ④ 본 제출: 같은 주소에 일반 POST (리다이렉트를 따라가지 않는다). 응답 코드만 믿지 않고 호출한 쪽이 `mine` 으로 다시 확인한다.
   * 이 호출 뒤에는 어떤 오류가 나도 "이미 보냈을 수 있다"고 봐야 한다.
   */
  async send(key: string, regUrl: string, payload: [string, string][]): Promise<SendResult> {
    const system = requireSystem(key);
    this.requireLogin(system);
    const res = await this.http.post(`/resve/${system.site}/${system.fn}/artclRegist.do`, payload, {
      headers: { Referer: regUrl, Origin: this.http.origin },
      follow: false,
    });
    return { status: res.status, location: res.location ?? '', alerts: extractAlerts(res.text) };
  }
}

function requireSpaceId(id: number): number {
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error('공간 번호가 올바르지 않습니다.');
  return id;
}
