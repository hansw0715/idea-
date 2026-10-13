/**
 * e-class(Moodle) HTML 해석 — 순수 함수. 서버는 이 결과만 믿고, 원본 HTML 은 응답·로그에 내보내지 않는다.
 * 원본: 팀이 먼저 만든 e-class 조회 프로토타입의 파서를 가져와, 주소(origin)를 주입할 수 있게 하고 우리 연동 흐름에 맞춰 정리했다.
 * 실제 학교 화면으로는 아직 확인하지 못했다 — 형식을 못 알아보면 "완료"로 추측하지 않고 unknown/경고로 남긴다.
 */
import { load } from 'cheerio';
import type { CheerioAPI } from 'cheerio';
import type { EclassCompletion, EclassItem } from '../../shared/school/eclass.js';

export interface EclassCourse {
  id: string;
  name: string;
  url: string;
  /** 커뮤니티(비교과) 강좌 — 출석부(_a)를 쓸 수 없어 학습 진도 표로만 판단한다 */
  community?: boolean;
}

/** 출석부 표 한 줄 (user_progress_a.php 또는 user_progress.php) */
export interface VodAttendanceRow {
  title: string;
  isAttendance: string;
  weeklyAttendance: string;
  week: number;
  requiredTime?: string;
  watchedTime?: string;
}

export interface VodListEntry {
  week: number;
  title: string;
  url: string;
  cmid: string | null;
  availableAt: string | null;
  dueAt: string | null;
}

export interface AssignListEntry {
  title: string;
  url: string;
  id: string | null;
  dueAt: string | null;
  completion: EclassCompletion;
}

const tidy = (value: string) => value.replace(/\s+/g, ' ').trim();

/** `origin`(예: https://learn.hansung.ac.kr)에 묶인 해석기. origin 밖의 주소는 모두 null 로 거른다. */
export function createEclassParser(origin: string) {
  /** Never trust URLs supplied by remote HTML, including protocol-relative links. */
  function eclassUrl(value: string, base = `${origin}/`): URL | null {
    try {
      const url = new URL(value, base);
      return url.origin === origin && !url.username && !url.password ? url : null;
    } catch { return null; }
  }

  function hasLoginForm(html: string): boolean {
    const $ = load(html);
    return $('form').toArray().some((form) => $(form).find('input[name="username"]').length > 0
      && $(form).find('input[name="password"]').length > 0);
  }

  function isAuthenticatedPage(html: string): boolean {
    const $ = load(html);
    if (hasLoginForm(html) || $('body.notloggedin, body.guestuser').length) return false;
    return $('a[href]').toArray().some((anchor) => {
      const url = eclassUrl($(anchor).attr('href') ?? '');
      return url?.pathname === '/login/logout.php';
    });
  }

  function parseLoginForm(html: string): { action: string; fields: URLSearchParams } | null {
    const $ = load(html);
    const form = $('form').filter((_, node) => $(node).find('input[name="username"]').length > 0
      && $(node).find('input[name="password"]').length > 0).first();
    const action = eclassUrl(form.attr('action') ?? '');
    if (!form.length || form.attr('method')?.toLowerCase() !== 'post' || action?.pathname !== '/login/index.php') return null;
    const fields = new URLSearchParams();
    form.find('input[type="hidden"][name], input[type="submit"][name]').each((_, node) => {
      const name = $(node).attr('name');
      if (name) fields.set(name, $(node).attr('value') ?? '');
    });
    // Coursemos uses a named submit button; do not enable rememberusername.
    fields.set('loginbutton', fields.get('loginbutton') ?? '로그인');
    fields.delete('rememberusername');
    return { action: action.href, fields };
  }

  function parseCourses(html: string): { courses: EclassCourse[]; recognized: boolean } {
    const $ = load(html);
    const containers = $('.my-course-lists, .course-list, .course_list, .coursebox, .block_myoverview, [data-region="myoverview"], #course_list, .course_lists');
    // The dedicated My Course page is itself a scoped list, unlike global navigation.
    const scope = containers.length ? containers : $('body[id="page-local-ubion-user-index"] #region-main, body[id="page-my-index"] #region-main');
    const courses = new Map<string, EclassCourse>();
    scope.find('a[href]').addBack('a[href]').each((_, node) => {
      const anchor = $(node);
      if (anchor.closest('.dimmed, .hidden, [hidden], [aria-hidden="true"]').length) return;
      const url = eclassUrl(anchor.attr('href') ?? '');
      const id = url?.searchParams.get('id');
      if (url?.pathname !== '/course/view.php' || !id || !/^\d+$/.test(id)) return;
      // 강좌 카드의 제목 줄(h1~h3)만 쓴다 — 카드에는 교수 이름·NEW 표시가 함께 들어 있다
      const heading = anchor.find('.course-title h1, .course-title h2, .course-title h3').first().clone();
      heading.find('.new, .label, .badge').remove();
      const headingText = tidy(heading.text().replace(/new/gi, ''));
      const name = headingText || tidy(anchor.attr('title') || anchor.find('.coursename, .course-title, .title').first().text() || anchor.text());
      // course_label_ec = 커뮤니티(비교과) 강좌 — 클래스로 구분해 언어와 상관없이 동작한다
      const community = anchor.closest('li').hasClass('course_label_ec');
      if (name) courses.set(id, { id, name, url: `${origin}/course/view.php?id=${id}`, ...(community && { community: true }) });
    });
    const explicitEmpty = /(?:수강\s*중인|등록된|참여\s*중인|진행\s*중인)\s*(?:강좌|과목|강의)가?\s*없|no courses (?:to show|available|enrolled)/i.test(tidy(scope.text() || $('#region-main').text()));
    // Empty layout containers may await AJAX; only explicit empty state is authoritative.
    return { courses: [...courses.values()], recognized: courses.size > 0 || explicitEmpty };
  }

  /** Moodle's dates use the site timezone. Never depend on the server's timezone. */
  function parseSeoulDate(value: string): string | null {
    const text = tidy(value);
    const iso = text.match(/\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})\b/);
    if (iso) {
      const parsed = new Date(iso[0]);
      return Number.isNaN(parsed.valueOf()) ? null : parsed.toISOString();
    }
    const match = text.match(/(20\d{2})\s*(?:년|[.\/-])\s*(\d{1,2})\s*(?:월|[.\/-])\s*(\d{1,2})(?:\s*일|\.)?(?:\s*\([^)]*\)|\s+[월화수목금토일]요일)?\s*[, ]?\s*(?:(오전|오후|AM|PM)\s*)?(\d{1,2})\s*:\s*(\d{2})(?::\s*(\d{2}))?(?:\s*(AM|PM))?/i);
    if (!match) return null; // A date without a time is not an exact deadline.
    const [, year, month, day, prefix, hours, minutes, seconds = '0', suffix] = match;
    let hour = Number(hours);
    const meridiem = (prefix || suffix || '').toLowerCase();
    if (meridiem && (hour < 1 || hour > 12)) return null;
    if (meridiem === '오후' || meridiem === 'pm') hour = hour % 12 + 12;
    if (meridiem === '오전' || meridiem === 'am') hour %= 12;
    if (hour > 23 || Number(minutes) > 59 || Number(seconds) > 59 || Number(month) < 1 || Number(month) > 12 || Number(day) < 1 || Number(day) > 31) return null;
    const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), hour - 9, Number(minutes), Number(seconds)));
    const seoul = new Date(date.valueOf() + 9 * 60 * 60_000);
    if (seoul.getUTCFullYear() !== Number(year) || seoul.getUTCMonth() + 1 !== Number(month) || seoul.getUTCDate() !== Number(day)) return null;
    return date.toISOString();
  }

  // ── 한성대 e-class 화면 구조(dotbugi 방식) ────────────────────────────────────────────────
  // 출석     : /report/ubcompletion/user_progress_a.php 의 .user_progress_table — 헤더 글자("출석", "주차 출석", "출석인정 요구시간")로 열 위치를 찾는다.
  // 대체     : /report/ubcompletion/user_progress.php 의 .user_progress — 총 학습시간 ≥ 출석인정 요구시간이면 출석(커뮤니티 강좌·_a 실패 때).
  // 강의 목록: 강좌 페이지 section-N 안의 li.modtype_vod:not(.dimmed) — 제목(.instancename), 기간(.text-ubstrap).
  // 과제     : /mod/assign/index.php 의 표 — .cell.c0 주, .c1 제목, .c2 종료 일시, .c3 제출 상태.
  // 강의 영상 페이지(/mod/vod)는 열지 않는다(열기만 해도 출석·진도가 기록될 수 있다) — 주소만 읽어 둔다.

  const COL_WEEKLY_ATTENDANCE = ['주차 출석', 'Week attendance'];
  const COL_ATTENDANCE = ['출석', 'Attendance'];
  const COL_REQUIRED_TIME = ['출석인정 요구시간', 'Required'];
  const BULK_APPROVED = ['일괄출석인정', 'Batch attendance'];
  const NOT_SUBMITTED = ['미제출', 'Not submitted', '提出なし', '没有作业'];
  const TIME_ONLY = /^\d{1,2}:\d{2}(?::\d{2})?$/;

  /** "2023年04月24日 … 10:50" 같은 표기를 "2023-04-24 10:50" 으로 맞춘다 (한국어·영어 표기는 그대로) */
  function normalizeLmsDate(raw: string): string {
    const text = tidy(raw);
    if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text;
    const m = text.match(/(\d{4})年\s*(\d{2})月\s*(\d{2})日.*?(\d{2}:\d{2})/);
    return m ? `${m[1]}-${m[2]}-${m[3]} ${m[4]}` : text;
  }

  /** "시작 ~ 종료" 기간 문자열 → 시작·종료 시각(ISO). 읽지 못하면 null */
  function parseRange(raw: string | null): { availableAt: string | null; dueAt: string | null } {
    if (!raw || !raw.includes('~')) return { availableAt: null, dueAt: null };
    const [start, end] = raw.split('~');
    return { availableAt: parseSeoulDate(normalizeLmsDate(start ?? '')), dueAt: parseSeoulDate(normalizeLmsDate(end ?? '')) };
  }

  /** 출석부 형식을 못 읽었을 때 원인 확인용: 표 머리글 글자만 짧게(본문·개인 정보는 담지 않는다) */
  function describeTables(html: string): string {
    const $ = load(html);
    const heads = $('table')
      .toArray()
      .slice(0, 2)
      .map((table) => $(table).find('tr').first().find('th, td').toArray().slice(0, 8).map((c) => tidy($(c).text()).slice(0, 12)).join('|'));
    return heads.filter(Boolean).join(' / ') || '표 없음';
  }

  /** 출석부에서 읽을 수 있는 줄이 없을 때 원인 확인용: 머리글과 첫 줄의 칸 글자만 짧게 */
  function describeAttendanceRows(html: string): string {
    const $ = load(html);
    const head = $('.user_progress_table > thead > tr > th').toArray().slice(0, 8).map((c) => tidy($(c).text()).slice(0, 10)).join('|');
    const first = $('.user_progress_table > tbody > tr').first().children('td, th').toArray().slice(0, 8)
      .map((c) => (tidy($(c).text()) || tidy($(c).find('img').first().attr('alt') ?? '') || '·').slice(0, 10)).join('|');
    return `머리글 ${head || '없음'} / 첫 줄 ${first || '없음'}`;
  }

  function secondsOf(time: string): number {
    const parts = time.split(':').map(Number);
    if (parts.some((n) => !Number.isFinite(n))) return 0;
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    return 0;
  }

  /** 출석 칸 표시를 o / x 로 맞춘다 (O, ○, ◯ / X, ×, 결석 …). 모르는 표시는 소문자 글자 그대로 */
  function mark(raw: string): string {
    const v = tidy(raw).toLowerCase().replace(/[[\]()]/g, '');
    if (/^(o|0|ο|○|◯|〇|⭕|출석|출석\s*인정|인정|present|attended)$/.test(v)) return 'o';
    if (/^(x|×|✕|✗|✖|❌|결석|미출석|absent)$/.test(v)) return 'x';
    return v;
  }

  /** "42:201회 열람" 같은 칸에서 앞의 시간만 */
  function extractTime(raw: string | null | undefined): string {
    return raw?.match(/^(\d{1,2}:\d{2}(?::\d{2})?)/)?.[1] ?? '';
  }

  /** 출석부(_a)의 열 위치. "출석인정 요구시간"·"주차 출석"도 "출석"을 포함하므로 구체적인 글자를 먼저 잡는다. */
  function detectColumns($: CheerioAPI) {
    // "강의 자료" 머리글이 주차·제목 두 열에 걸쳐 있을 수 있으니 colspan 만큼 펼쳐서 열 위치를 센다
    const headers: string[] = [];
    $('.user_progress_table > thead > tr').first().children('th, td').each((_, cell) => {
      const span = Math.max(1, Math.min(20, parseInt($(cell).attr('colspan') || '1', 10) || 1));
      for (let i = 0; i < span; i++) headers.push(tidy($(cell).text()));
    });
    if (headers.length < 4) return null;
    let weekly = -1;
    let required: number | null = null;
    const taken = new Set<number>();
    headers.forEach((text, i) => {
      if (COL_WEEKLY_ATTENDANCE.some((k) => text.includes(k))) {
        weekly = i;
        taken.add(i);
      } else if (COL_REQUIRED_TIME.some((k) => text.includes(k))) {
        required = i;
        taken.add(i);
      }
    });
    const attendance = headers.findIndex((text, i) => !taken.has(i) && COL_ATTENDANCE.some((k) => text.includes(k)));
    if (attendance < 0 || weekly < 0) return null;
    return { week: 0, title: 1, required, watched: attendance - 1, attendance, weekly };
  }

  /** rowspan/colspan 을 펼쳐 한 줄을 칸 값 배열로 */
  function flattenRow($: CheerioAPI, row: Parameters<CheerioAPI>[0], pending: Array<number | undefined>, spanValues: Array<string | null>): Array<string | null> {
    const cells = $(row).find('td').toArray();
    const out: Array<string | null> = [];
    let col = 0;
    const consume = () => {
      while (pending[col] && pending[col]! > 0) {
        out.push(spanValues[col] || null);
        pending[col]! -= 1;
        col++;
      }
    };
    consume();
    for (const cell of cells) {
      consume();
      const rowspan = Math.max(1, Math.min(500, parseInt($(cell).attr('rowspan') || '1', 10) || 1));
      const colspan = Math.max(1, Math.min(50, parseInt($(cell).attr('colspan') || '1', 10) || 1));
      const img = $(cell).find('img').first();
      const content = tidy($(cell).text()) || tidy(img.attr('alt') ?? img.attr('title') ?? '');
      for (let i = 0; i < colspan; i++) {
        out.push(content);
        if (rowspan > 1) {
          pending[col] = rowspan - 1;
          spanValues[col] = content;
        } else {
          spanValues[col] = null;
        }
        col++;
      }
    }
    while (col < pending.length) {
      if (pending[col] && pending[col]! > 0) {
        out.push(spanValues[col] || null);
        pending[col]! -= 1;
      } else {
        out.push(null);
      }
      col++;
    }
    return out;
  }

  /** 온라인 출석부(user_progress_a.php) 표. 표 머리글을 못 알아보면 null (형식이 달라졌다는 뜻) */
  function parseAttendancePage(html: string): VodAttendanceRow[] | null {
    const $ = load(html);
    const col = detectColumns($);
    if (!col) return null;
    const pending: Array<number | undefined> = [];
    const spanValues: Array<string | null> = [];
    const rows: VodAttendanceRow[] = [];
    let week = 0;
    let lastWeekly = '';
    $('.user_progress_table > tbody > tr').each((_, row) => {
      const cells = flattenRow($, row, pending, spanValues);
      const title = cells[col.title] || '';
      const isAttendance = mark(cells[col.attendance] || '');
      let weekly = mark(cells[col.weekly] || '');
      if (weekly) lastWeekly = weekly;
      else weekly = lastWeekly;
      if (BULK_APPROVED.some((k) => weekly.includes(k.toLowerCase()))) weekly = 'o';
      const parsedWeek = parseInt(cells[col.week] || '', 10);
      if (!Number.isNaN(parsedWeek)) week = parsedWeek;
      if (!title || !isAttendance) return;
      const required = col.required !== null ? cells[col.required] || '' : '';
      const watched = extractTime(cells[col.watched]);
      rows.push({ title, isAttendance, weeklyAttendance: weekly, week, ...(required && { requiredTime: required }), ...(watched && { watchedTime: watched }) });
    });
    return rows;
  }

  /** 학습 진도(user_progress.php) 표: 총 학습시간이 출석인정 요구시간 이상이면 출석으로 본다. 표가 없으면 null */
  function parseProgressPage(html: string): VodAttendanceRow[] | null {
    const $ = load(html);
    if ($('.user_progress').length === 0) return null;
    const rows: VodAttendanceRow[] = [];
    let week = 0;
    $('.user_progress > tbody > tr').each((_, row) => {
      const cells = $(row).find('td').toArray();
      if (cells.length === 0) return;
      const sectionTitle = $(row).find('.sectiontitle').first();
      if (sectionTitle.length) {
        const parsed = parseInt(tidy(sectionTitle.text()), 10);
        if (!Number.isNaN(parsed)) week = parsed;
      }
      const titleCell = cells.find((c) => $(c).find('img[src*="vod"]').length > 0);
      if (!titleCell) return;
      const title = tidy($(titleCell).text());
      if (!title) return;
      const timeCells = cells.filter((c) => TIME_ONLY.test(tidy($(c).text())));
      let requiredTime = '';
      let watchedTime = '';
      if (timeCells.length >= 1) requiredTime = tidy($(timeCells[0]).text());
      const detail = $(row).find('.track_detail').first();
      if (detail.length) {
        const parent = detail.closest('td');
        const text = parent
          .contents()
          .toArray()
          .filter((n) => n.type === 'text')
          .map((n) => tidy($(n).text()))
          .find((t) => TIME_ONLY.test(t));
        if (text) watchedTime = text;
      } else if (timeCells.length >= 2) {
        watchedTime = tidy($(timeCells[1]).text());
      }
      const attended = requiredTime && watchedTime && secondsOf(watchedTime) >= secondsOf(requiredTime);
      rows.push({ title, isAttendance: attended ? 'o' : 'x', weeklyAttendance: '', week, requiredTime, watchedTime });
    });
    // 주차 출석: 그 주차의 모든 강의가 출석이면 o
    const byWeek = new Map<number, VodAttendanceRow[]>();
    for (const r of rows) byWeek.set(r.week, [...(byWeek.get(r.week) ?? []), r]);
    for (const group of byWeek.values()) {
      const all = group.every((r) => r.isAttendance === 'o');
      for (const r of group) r.weeklyAttendance = all ? 'o' : 'x';
    }
    return rows;
  }

  /** 강좌 페이지의 강의(영상) 목록 — 숨겨진(.dimmed) 강의는 제외한다 */
  function parseVodList(html: string): { vods: VodListEntry[]; recognized: boolean } {
    const $ = load(html);
    const sections = $('li[id^="section-"]');
    const vods: VodListEntry[] = [];
    sections.each((_, section) => {
      const week = Number($(section).attr('id')?.match(/section-(\d+)/)?.[1] ?? 0);
      $(section)
        .find('li.modtype_vod:not(.dimmed) .activityinstance')
        .each((__, activity) => {
          const nameNode = $(activity).find('.instancename').first().clone();
          nameNode.find('.accesshide').remove();
          const title = tidy(nameNode.text());
          const url = eclassUrl($(activity).find('a[href]').first().attr('href') ?? '');
          if (!title || !url) return;
          const range = parseRange(tidy($(activity).find('.text-ubstrap').first().text()) || null);
          vods.push({ week, title, url: `${origin}${url.pathname}${url.search}`, cmid: url.searchParams.get('id'), ...range });
        });
    });
    // 같은 강의가 "이번 주 강의" 요약과 주차 목록에 겹쳐 나오거나 구역이 중첩돼 두 번 읽힐 수 있다 — 활동 id 로 한 번만 둔다
    const unique = new Map<string, VodListEntry>();
    for (const vod of vods) {
      const key = vod.cmid ?? vod.url;
      const prev = unique.get(key);
      if (!prev || (prev.week === 0 && vod.week > 0)) unique.set(key, vod);
    }
    return { vods: [...unique.values()], recognized: sections.length > 0 || $('.course-content, #region-main').length > 0 };
  }

  function dedupeAssignments(list: AssignListEntry[]): AssignListEntry[] {
    const seen = new Set<string>();
    return list.filter((a) => {
      const key = a.id ?? a.url;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  /** 과제 목록(/mod/assign/index.php)의 표 */
  function parseAssignList(html: string): { assignments: AssignListEntry[]; recognized: boolean; note?: string } {
    const $ = load(html);
    const table = $('table.generaltable');
    const assignments: AssignListEntry[] = [];
    table.find('tbody tr').each((_, row) => {
      const link = $(row).find('.cell.c1 a').first();
      const url = eclassUrl(link.attr('href') ?? '');
      const title = tidy(link.text());
      if (!title || !url) return;
      const rawDue = tidy($(row).find('.cell.c2').first().text());
      const submit = tidy($(row).find('.cell.c3').first().text());
      const completion: EclassCompletion = !submit
        ? 'unknown'
        : NOT_SUBMITTED.some((k) => submit.includes(k))
          ? 'pending'
          : 'completed';
      assignments.push({
        title,
        url: `${origin}${url.pathname}${url.search}`,
        id: url.searchParams.get('id'),
        dueAt: rawDue && rawDue !== '-' ? parseSeoulDate(normalizeLmsDate(rawDue)) : null,
        completion,
      });
    });
    if (table.length > 0) return { assignments: dedupeAssignments(assignments), recognized: true };
    // 표가 없을 때: "과제가 없습니다" 같은 안내면 과제 없음, 그 밖이면 형식을 못 읽은 것이다
    const main = tidy($('#region-main').text() || $('body').text());
    return { assignments, recognized: /없습니다|없어요|없음|no assignments|nothing to display/i.test(main), note: main.slice(0, 50) };
  }

  /**
   * 강의 목록 + 출석 자료를 "제목-주차"로 맞춘다. 출석 자료가 있는데 표에 없는 강의(출석 대상이 아닌 자료)는 빼고,
   * 출석 자료를 아예 못 읽었으면 완료 여부를 "확인 필요(unknown)"로 둔다.
   */
  /** 제목 비교용: 공백·대소문자 차이를 없앤다 */
  const squash = (value: string) => value.replace(/\s+/g, '').toLowerCase();

  /** 수강 여부는 온라인 출석부 표로만 판단한다 (강좌 페이지의 다른 표시는 사용자 확장 프로그램이 넣은 것일 수 있어 보지 않는다). */
  function mergeLectures(course: EclassCourse, vods: VodListEntry[], attendance: VodAttendanceRow[] | null, now = Date.now()): EclassItem[] {
    const byKey = new Map<string, VodAttendanceRow>();
    for (const row of attendance ?? []) byKey.set(`${squash(row.title)}-${row.week}`, row);
    const items: EclassItem[] = [];
    for (const vod of vods) {
      let row = byKey.get(`${squash(vod.title)}-${vod.week}`);
      if (attendance && !row) {
        // 주차 표기가 다르면 제목이 표 안에서 하나뿐일 때만 맞춘다
        const sameTitle = attendance.filter((r) => squash(r.title) === squash(vod.title));
        if (sameTitle.length === 1) row = sameTitle[0];
      }
      // 출석을 따지는 강의가 아닌 것: 출석부(읽은 경우)에 줄이 없다
      if (attendance && !row) continue;
      const tableAttended = row ? row.isAttendance.trim().toLowerCase() === 'o' || row.weeklyAttendance.trim().toLowerCase() === 'o' : false;
      const attended = tableAttended;
      const started = vod.availableAt === null || Date.parse(vod.availableAt) <= now;
      let completion: EclassItem['completion'];
      if (attended) completion = 'completed';
      else if (row) completion = 'pending';
      else if (!started) completion = 'pending'; // 아직 시작 전인 강의는 당연히 출석 전이다
      else completion = 'unknown';
      const required = row?.requiredTime ? secondsOf(row.requiredTime) : 0;
      const watched = row?.watchedTime ? secondsOf(row.watchedTime) : 0;
      items.push({
        id: `lecture:${vod.cmid ?? `${course.id}:${vod.week}:${vod.title}`}`,
        courseId: course.id,
        courseName: course.name,
        title: vod.title,
        kind: 'lecture',
        url: vod.url,
        completion,
        // 출석으로 확인된 것만 "출석"으로 적는다 — 아직 안 본 강의를 결석이라고 단정하지 않는다
        attendance: attended ? 'present' : 'unknown',
        dueAt: vod.dueAt,
        availableAt: vod.availableAt,
        progress: required > 0 && watched >= 0 && row?.watchedTime ? Math.min(100, Math.round((watched / required) * 100)) : null,
      });
    }
    return items;
  }

  function mergeAssignments(course: EclassCourse, list: AssignListEntry[]): EclassItem[] {
    return list.map((a, i) => ({
      id: `assignment:${a.id ?? `${course.id}:${i}:${a.title}`}`,
      courseId: course.id,
      courseName: course.name,
      title: a.title,
      kind: 'assignment' as const,
      url: a.url,
      completion: a.completion,
      attendance: 'not_applicable' as const,
      dueAt: a.dueAt,
      availableAt: null,
      progress: null,
    }));
  }

  return {
    eclassUrl, hasLoginForm, isAuthenticatedPage, parseLoginForm, parseCourses, parseSeoulDate,
    parseAttendancePage, parseProgressPage, parseVodList, parseAssignList, mergeLectures, mergeAssignments, describeTables, describeAttendanceRows,
  };
}
