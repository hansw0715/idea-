/**
 * 학교 응답 파서 · 변환 (순수 함수 — 네트워크·DB·시간·랜덤 의존 없음).
 * 원본: .tmp/reference/school-py (hansung_info / hansung_timetable / hansung_facility).
 * 구조가 달라서 읽지 못하면 null 을 돌려준다 — 호출하는 쪽(info.ts, resve.ts)이 SchoolUnavailable 로 바꾼다.
 *
 * 학교 응답 본문은 이 파일 밖으로 나가는 오류 메시지에 넣지 않는다.
 */
import type { BookItem, SchoolClass, SchoolReservation } from '../../shared/school/types.js';
import { CLOSE_MIN, OPEN_MIN, STEP_MIN } from '../constants.js';

export const WEEKDAYS_KO = ['월', '화', '수', '목', '금', '토', '일'] as const;

/** 신청 대상 코드 → 이름 (hansung_facility.py 의 IDENTITY) */
export const IDENTITY_NAMES: Record<string, string> = {
  IDENTITY_00001: '교수',
  IDENTITY_00002: '직원',
  IDENTITY_00003: '조교',
  IDENTITY_00004: '강사',
  IDENTITY_00005: '학술연구원',
  IDENTITY_00006: '기타교수',
  IDENTITY_00007: '학사(재학생)',
  IDENTITY_00008: '학사(졸업생)',
  IDENTITY_00009: '대학원(재학생)',
  IDENTITY_00010: '대학원(졸업생)',
};

// ── 문자열 도구 ───────────────────────────────────────────────────

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

/** HTML 엔티티 풀기 (python html.unescape 중 이 응답들에 나오는 것) */
export function unescapeHtml(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, body: string) => {
    if (body[0] === '#') {
      const code = body[1].toLowerCase() === 'x' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      try {
        return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
      } catch {
        return whole;
      }
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? whole;
  });
}

/**
 * 태그 제거. `s.replace(/<[^>]+>/g, '')` 와 결과가 같다: '<' 에서 시작해 처음 나오는 '>' 까지(사이에 한 글자 이상)를 지운다.
 * 정규식은 '>' 가 없을 때 '<' 마다 끝까지 훑어 2차 시간이 된다(학교 응답에 '<' 만 계속되면 서버가 멈춘다).
 * 여기서는 '>' 가 더는 없으면 그 뒤의 '<' 도 지울 수 없으므로 거기서 멈춘다 — 한 번만 훑는다(선형).
 */
function stripTags(s: string): string {
  let out = '';
  let i = 0;
  for (;;) {
    const lt = s.indexOf('<', i);
    if (lt < 0) return out + s.slice(i);
    const gt = s.indexOf('>', lt + 1);
    if (gt < 0) return out + s.slice(i);
    if (gt === lt + 1) {
      // "<>" 는 태그가 아니다 (정규식은 한 글자 이상을 요구한다)
      out += s.slice(i, lt + 1);
      i = lt + 1;
    } else {
      out += s.slice(i, lt);
      i = gt + 1;
    }
  }
}

/**
 * `<a …>` 시작 태그만 지운다 (`s.replace(/<a[^>]*>/g, '')` 와 같다). `[^>]*` 정규식은 '>' 가 없을 때 2차 시간이므로 선형으로.
 * `<abbr>` 처럼 a 로 시작하는 다른 태그도 지워지지만, 어차피 뒤이어 cleanText 가 모든 태그를 지운다.
 */
function removeAnchorOpenTags(s: string): string {
  let out = '';
  let i = 0;
  for (;;) {
    const a = s.indexOf('<a', i);
    if (a < 0) return out + s.slice(i);
    const gt = s.indexOf('>', a + 2);
    if (gt < 0) return out + s.slice(i);
    out += s.slice(i, a);
    i = gt + 1;
  }
}

/**
 * `<태그 …>…</태그>` 덩어리의 안쪽 글을 차례로 돌려준다 (`/<tag[^>]*>([\s\S]*?)<\/tag>/g` 와 같은 뜻, 태그 이름 경계만 엄격하다).
 * 정규식의 `[\s\S]*?` 는 닫는 태그가 없으면 시작 위치마다 끝까지 훑어 2차 시간이다. 여기서는 앞으로만 나아가고,
 * 열린 태그의 '>' 나 닫는 태그가 더는 없으면 뒤의 것도 없으므로 거기서 멈춘다.
 */
function* blocks(html: string, tag: string): Generator<string> {
  const open = `<${tag}`;
  const close = `</${tag}>`;
  let from = 0;
  for (;;) {
    const start = html.indexOf(open, from);
    if (start < 0) return;
    const after = html.charAt(start + open.length);
    if (after !== '>' && after !== '/' && !/\s/.test(after)) {
      from = start + 1; // <track> 처럼 이름이 더 이어지면 이 태그가 아니다
      continue;
    }
    const gt = html.indexOf('>', start + open.length);
    if (gt < 0) return;
    const end = html.indexOf(close, gt + 1);
    if (end < 0) return;
    yield html.slice(gt + 1, end);
    from = end + close.length;
  }
}

/** 처음 나오는 `ch` 의 위치를 캐시해, 앞으로만 나아가는 탐색이 같은 구간을 되풀이해 훑지 않게 한다 */
function nextFinder(str: string, ch: string): (from: number) => number {
  let cachedFrom = 0;
  let cached = -2; // -2: 아직 찾지 않음
  return (from) => {
    if (cached !== -2 && from >= cachedFrom && (cached === -1 || from <= cached)) return cached;
    cachedFrom = from;
    cached = str.indexOf(ch, from);
    return cached;
  };
}

const collapse = (s: string): string => s.replace(/\s+/g, ' ').trim();
/** 태그 제거 → 엔티티 풀기 → 공백 정리 (python: re.sub(r"\s+", " ", unescape(re.sub(r"<[^>]+>", "", c))).strip()) */
const cleanText = (s: string): string => collapse(unescapeHtml(stripTags(s)));

export const pad2 = (n: number): string => String(n).padStart(2, '0');

/** 분 → "HH:mm" */
export function fmtHm(min: number): string {
  return `${pad2(Math.floor(min / 60))}:${pad2(min % 60)}`;
}

/** "HH:mm" → 분. 형식이 다르면 null */
export function parseHm(text: string): number | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(text.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  return h <= 24 && mi < 60 ? h * 60 + mi : null;
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** 실존하는 달력 날짜인가 ('YYYY-MM-DD'). 자동 이월(2026-09-32 → 10-02)을 거부한다 */
export function isRealDate(s: string): boolean {
  const m = DATE_RE.exec(s);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

/** 'YYYY-MM-DD' 의 요일 인덱스 (0=월 ~ 6=일). 시간대와 무관하게 달력만으로 계산한다 */
export function weekdayIndex(date: string): number {
  const m = DATE_RE.exec(date);
  if (!m) return -1;
  return (new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).getUTCDay() + 6) % 7;
}

/** 코드포인트 기준으로 자르기 (한글·이모지가 반쪽 나지 않게) */
export function truncate(s: string, max: number): string {
  const chars = Array.from(s);
  return chars.length <= max ? s : chars.slice(0, max).join('');
}

// ── info.hansung.ac.kr ────────────────────────────────────────────

export type ParsedProfile = { studentId: string; name: string; department: string };

/**
 * 학교 응답에서 읽는 글의 길이 상한. 학교(또는 중간자)가 비정상적으로 큰 값을 주어도 처리 시간과 우리 응답·DB 가 커지지 않게 한다.
 * 정상 값은 훨씬 짧다 (프로필 영역 수백 자, 이름·학과 수십 자, 신청내역 칸 수십 자).
 */
export const PROFILE_BLOCK_MAX = 20_000;
export const PROFILE_FIELD_MAX = 100;
export const CELL_RAW_MAX = 5_000;
export const CELL_MAX = 200;

/**
 * 포털 첫 화면(`/jsp_21/index.jsp`)에서 학번·이름·학과를 읽는다.
 * 학번 = haksang_sajin.jsp?hakbun=…, 이름·학과 = `<div class="info">…</a>` 안을 `<a …>` 제거 후 `<br>` 로 나눈 것:
 * 마지막 줄이 이름, 그 앞 줄이 학과.
 */
export function parseProfile(html: string): ParsedProfile | null {
  const id = /haksang_sajin\.jsp\?hakbun=(\w+)/.exec(html);
  if (!id) return null;
  // `/<div class="info">([\s\S]*?)<\/a>/` 와 같다 (처음 시작 뒤에 `</a>` 가 없으면 이후 시작에도 없다)
  const OPEN = '<div class="info">';
  const start = html.indexOf(OPEN);
  const end = start < 0 ? -1 : html.indexOf('</a>', start + OPEN.length);
  if (end < 0) return null;
  const block = html.slice(start + OPEN.length, Math.min(end, start + OPEN.length + PROFILE_BLOCK_MAX));
  const parts = removeAnchorOpenTags(block).split(/<br\s*\/?>/i);
  const name = truncate(cleanText(parts[parts.length - 1] ?? ''), PROFILE_FIELD_MAX);
  const department = parts.length > 1 ? truncate(cleanText(parts[parts.length - 2]), PROFILE_FIELD_MAX) : '';
  if (!name) return null;
  return { studentId: id[1], name, department };
}

/**
 * 학번 앞자리로 입학년도를 추정한다. 8자리 이상이면 앞 4자리(예: 2021…), 6~7자리면 앞 2자리(21… → 2021).
 * 범위(2000~올해)를 벗어나면 모른다고 본다.
 */
export function admissionYearOf(studentId: string, currentYear: number): number | null {
  const year = studentId.length >= 8 ? Number(studentId.slice(0, 4)) : 2000 + Number(studentId.slice(0, 2));
  return Number.isInteger(year) && year >= 2000 && year <= currentYear ? year : null;
}

export type ParsedTimetable = {
  classes: SchoolClass[];
  skipped: { subject: string; reason: string }[];
};

const ISO_LOCAL = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})/;

/**
 * 개인시간표 응답(FullCalendar 이벤트 JSON 배열)을 수업 목록으로.
 *  - `start`/`end` 의 날짜·시각을 문자열 그대로 읽는다 (시간대 변환 없음 — 파이썬 fromisoformat 과 같은 결과).
 *  - 월~금만 수업으로 두고 주말은 skipped 에 이유를 남긴다.
 *  - `title` = "과목(분반)\n교수\n강의실". 같은 (요일·시작·끝·과목)은 하나로.
 * JSON 이 아니거나 배열이 아니거나, 이벤트가 있는데 하나도 읽지 못하면 null.
 */
export function parseTimetable(text: string): ParsedTimetable | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text.trim());
  } catch {
    return null;
  }
  if (!Array.isArray(raw)) return null;

  const classes: SchoolClass[] = [];
  const skipped: ParsedTimetable['skipped'] = [];
  const seen = new Set<string>();
  let readable = 0;

  for (const e of raw as Record<string, unknown>[]) {
    if (!e || typeof e.title !== 'string' || typeof e.start !== 'string' || typeof e.end !== 'string') continue;
    const s = ISO_LOCAL.exec(e.start);
    const en = ISO_LOCAL.exec(e.end);
    if (!s || !en) continue;
    readable += 1;

    const [subjectRaw = '', professor = '', room = ''] = e.title.split(/\r?\n/);
    const m = /^(.*?)\(([^()]*)\)$/s.exec(subjectRaw.trim());
    const subject = (m ? m[1] : subjectRaw).trim();
    const section = m ? m[2] : '';

    const day = weekdayIndex(s[1]);
    if (day < 0) continue;
    if (day > 4) {
      skipped.push({ subject: subject || '(이름 없음)', reason: '주말 수업은 시간표에 넣을 수 없어요.' });
      continue;
    }
    const start = `${s[2]}:${s[3]}`;
    const end = `${en[2]}:${en[3]}`;
    const key = `${day}|${start}|${end}|${subject}`;
    if (seen.has(key)) continue;
    seen.add(key);
    classes.push({ day, start, end, subject, section, professor: professor.trim(), room: room.trim() });
  }
  if (raw.length > 0 && readable === 0) return null;
  classes.sort((a, b) => a.day - b.day || a.start.localeCompare(b.start));
  return { classes, skipped };
}

// ── 시간표 → 우리 30분 격자 (설계 §6) ──────────────────────────────

export type GridEntry = { day: number; startMin: number; endMin: number; title: string; place: string };

export const TITLE_MAX = 30;
export const PLACE_MAX = 30;

/**
 * 학교 수업을 우리 시간표 격자(30분 단위, 09:00~22:00)에 맞춘다.
 *  - 시작은 내림, 끝은 올림, 범위 밖은 잘라서 넣는다. 그래도 길이가 0 이면 건너뛰고 이유를 남긴다.
 *  - 조정(내림·올림·자르기)한 수업 수를 adjusted 로 센다.
 *  - 격자에 맞춘 뒤 (요일·시작·끝·이름)이 같은 것은 하나로 합친다.
 * 수업 이름·강의실은 시간표 API 와 같은 길이(30자)로 자른다.
 */
export function toGrid(classes: SchoolClass[]): {
  entries: GridEntry[];
  adjusted: number;
  skipped: { subject: string; reason: string }[];
} {
  const entries: GridEntry[] = [];
  const skipped: { subject: string; reason: string }[] = [];
  const seen = new Set<string>();
  let adjusted = 0;

  for (const c of classes) {
    const label = c.subject || '(이름 없음)';
    const s0 = parseHm(c.start);
    const e0 = parseHm(c.end);
    if (!Number.isInteger(c.day) || c.day < 0 || c.day > 4) {
      skipped.push({ subject: label, reason: '주말 수업은 시간표에 넣을 수 없어요.' });
      continue;
    }
    if (s0 === null || e0 === null || e0 <= s0) {
      skipped.push({ subject: label, reason: '수업 시간을 읽을 수 없어요.' });
      continue;
    }
    if (!c.subject.trim()) {
      skipped.push({ subject: label, reason: '수업 이름이 없어요.' });
      continue;
    }
    const startMin = Math.max(Math.floor(s0 / STEP_MIN) * STEP_MIN, OPEN_MIN);
    const endMin = Math.min(Math.ceil(e0 / STEP_MIN) * STEP_MIN, CLOSE_MIN);
    if (endMin <= startMin) {
      skipped.push({ subject: label, reason: `시간표 운영 시간(${fmtHm(OPEN_MIN)}~${fmtHm(CLOSE_MIN)}) 밖이에요.` });
      continue;
    }
    const title = truncate(c.subject.trim(), TITLE_MAX);
    const key = `${c.day}|${startMin}|${endMin}|${title}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (startMin !== s0 || endMin !== e0) adjusted += 1;
    entries.push({ day: c.day, startMin, endMin, title, place: truncate(c.room.trim(), PLACE_MAX) });
  }
  return { entries, adjusted, skipped };
}

// ── hansung.ac.kr/resve (시설 예약) ───────────────────────────────

export type Space = { id: number; name: string };

/**
 * `artclList.do` 응답의 `<select id="resveSpceSeq">` 옵션을 공간 목록으로.
 * select 자체가 없으면 null (구조 변경), 옵션이 하나도 없으면 빈 배열.
 */
export function parseSpaces(html: string): Space[] | null {
  const i = html.indexOf('id="resveSpceSeq"');
  if (i < 0) return null;
  const end = html.indexOf('</select>', i);
  const sel = html.slice(i, end < 0 ? undefined : end);
  const out: Space[] = [];
  // `/<option value="(\d+)"[^>]*>([^<]+)<\/option>/g` 와 같은 뜻을 한 번만 훑어 읽는다 (정규식은 '>' 가 없으면 2차 시간)
  const OPEN = '<option value="';
  const CLOSE = '</option>';
  const nextGt = nextFinder(sel, '>');
  const nextLt = nextFinder(sel, '<');
  let from = 0;
  for (;;) {
    const s = sel.indexOf(OPEN, from);
    if (s < 0) break;
    from = s + OPEN.length;
    let q = from;
    while (q < sel.length && sel.charCodeAt(q) >= 48 && sel.charCodeAt(q) <= 57) q++;
    if (q === from || sel.charAt(q) !== '"') continue;
    const gt = nextGt(q + 1);
    if (gt < 0) break;
    const lt = nextLt(gt + 1);
    if (lt < 0) break;
    if (lt === gt + 1 || !sel.startsWith(CLOSE, lt)) continue; // 이름이 비었거나 </option> 이 아니다
    out.push({ id: Number(sel.slice(from, q)), name: unescapeHtml(sel.slice(gt + 1, lt)).trim() });
    from = lt + CLOSE.length;
  }
  return out;
}

/** 두 이름을 같은 공간으로 볼지 비교할 때 쓰는 정규화 (공백 정리) */
export const normalizeName = (s: string): string => collapse(unescapeHtml(s));

/** `resveSetup` 의 한 줄. 파이썬이 쓰는 필드만, 쓰기 쉬운 모양으로. */
export type ResveSetup = {
  /** 슬롯 시작 시각들 ("10:00") */
  slots: string[];
  /** 운영 요일 원문 ("월,화,수,목,금") — 신청 폼에 그대로 보낸다 */
  posblDay: string;
  /** 운영 기간 YYYYMMDD */
  posblBgnde: string;
  posblEndde: string;
  /** 신청은 시작 몇 시간 전까지 (리드타임) */
  posblTm: number;
  /** 슬롯 단위 (분) — 신청 폼에 그대로 보낸다 */
  posblTerm: string;
  termMin: number;
  resveGroupSeq: string;
};

const SLOT_RE = /^\d{2}:\d{2}$/;

export function normalizeSetup(row: unknown): ResveSetup | null {
  if (!row || typeof row !== 'object') return null;
  const r = row as Record<string, unknown>;
  if (typeof r.resveTm !== 'string' || typeof r.posblDay !== 'string') return null;
  const slots = r.resveTm.split(',').map((t) => t.trim()).filter(Boolean);
  const termMin = Number(r.posblTerm);
  const bgnde = String(r.posblBgnde ?? '');
  const endde = String(r.posblEndde ?? '');
  if (slots.length === 0 || !slots.every((t) => SLOT_RE.test(t))) return null;
  if (!Number.isInteger(termMin) || termMin <= 0 || termMin > 24 * 60) return null;
  if (!/^\d{8}$/.test(bgnde) || !/^\d{8}$/.test(endde)) return null;
  const lead = Number(r.posblTm ?? 0) || 0;
  return {
    slots,
    posblDay: r.posblDay,
    posblBgnde: bgnde,
    posblEndde: endde,
    posblTm: Number.isFinite(lead) && lead > 0 ? lead : 0,
    posblTerm: String(termMin),
    termMin,
    resveGroupSeq: String(r.resveGroupSeq ?? ''),
  };
}

/** `artclSetupList` 의 한 줄 (공간 정보) */
export type ResveInfo = { groupNm: string; spceNm: string; mngr: string; telno: string; identityCode: string };

export function normalizeInfo(row: unknown): ResveInfo {
  const r = (row && typeof row === 'object' ? row : {}) as Record<string, unknown>;
  const s = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v));
  return { groupNm: s(r.groupNm), spceNm: s(r.spceNm), mngr: s(r.mngr), telno: s(r.telno), identityCode: s(r.identityCode) };
}

/** 추가 항목. mustYn 은 신청 폼에 그대로 보낸다 */
export type ResveItem = { name: string; mustYn: string };

/** `itemList` 응답. 항목이 없으면 itemNm 이 빈 placeholder 가 와서 걸러야 한다 */
export function normalizeItems(rows: unknown[]): ResveItem[] {
  const out: ResveItem[] = [];
  for (const r of rows) {
    if (!r || typeof r !== 'object') continue;
    const o = r as Record<string, unknown>;
    if (typeof o.itemNm !== 'string' || !o.itemNm) continue;
    out.push({ name: o.itemNm, mustYn: o.mustYn == null ? 'N' : String(o.mustYn) });
  }
  return out;
}

export const toBookItems = (items: ResveItem[]): BookItem[] =>
  items.map((i) => ({ name: i.name, required: i.mustYn === 'Y' }));

/** `identityCode`("IDENTITY_00007,…") → 이름들. 모르는 코드는 그대로 */
export function identityNames(code: string): string[] {
  return code
    .split(',')
    .map((c) => c.trim())
    .filter(Boolean)
    .map((c) => IDENTITY_NAMES[c] ?? c);
}

/** `resveList` 응답 → 예약된 슬롯 시작 시각 집합 */
export function bookedSet(rows: unknown[]): Set<string> {
  const out = new Set<string>();
  for (const r of rows) {
    const v = (r as { resveTm?: unknown } | null)?.resveTm;
    if (typeof v !== 'string') continue;
    const t = v.trim();
    out.add(/^\d{2}:\d{2}/.test(t) ? t.slice(0, 5) : t);
  }
  return out;
}

export type MineRow = {
  no: string;
  space: string;
  date: string;
  time: string;
  /** 신청자 이름·학번은 우리 응답에 쓰지 않는다 (본인 것이지만 필요 없다) */
  applied: string;
  status: string;
};

/** 내 신청내역 표(`<tr>`/`<td>`) 읽기. `no-data` 행과 칸이 8개 미만인 행은 건너뛴다 */
export function parseMine(html: string): MineRow[] {
  const out: MineRow[] = [];
  for (const tr of blocks(html, 'tr')) {
    if (tr.includes('no-data')) continue;
    const cells = [...blocks(tr, 'td')].map((c) => truncate(cleanText(c.slice(0, CELL_RAW_MAX)), CELL_MAX));
    if (cells.length >= 8) {
      out.push({ no: cells[0], space: cells[1], date: cells[2], time: cells[3], applied: cells[6], status: cells[7] });
    }
  }
  return out;
}

export const toSchoolReservation = (facility: string, facilityLabel: string, r: MineRow): SchoolReservation => ({
  facility,
  facilityLabel,
  no: r.no,
  space: r.space,
  date: r.date,
  time: r.time,
  status: r.status,
  applied: r.applied,
});

// ── 슬롯 상태 · 펼치기 ────────────────────────────────────────────

export type SlotState = 'available' | 'booked' | 'closed';
export type SlotInfo = { start: string; state: SlotState };

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** 'YYYY-MM-DD' + 'HH:mm' → 한국 시각을 UTC 로 읽은 "분" (두 값을 서로 비교하기 위한 값) */
function wallMinutes(date: string, hm: string): number {
  const m = DATE_RE.exec(date)!;
  const t = parseHm(hm) ?? 0;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 60000 + t;
}

/** epoch ms → 한국 시각의 'YYYY-MM-DD' */
export function kstDate(nowMs: number): string {
  const d = new Date(nowMs + KST_OFFSET_MS);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

/**
 * 슬롯별 상태 (hansung_facility.py 의 slot_states).
 * 운영 요일·기간 밖이거나 `시작 < 지금 + 리드타임(posblTm 시간)` 이면 닫힘, 예약 집합에 있으면 예약됨, 아니면 가능.
 * 시각 비교는 모두 한국 시각이다.
 */
export function slotStates(setup: ResveSetup, booked: Set<string>, date: string, nowMs: number): SlotInfo[] {
  const ymd = date.replace(/-/g, '');
  const dayName = WEEKDAYS_KO[weekdayIndex(date)];
  const openDay =
    dayName !== undefined &&
    setup.posblDay.split(',').map((d) => d.trim()).includes(dayName) &&
    setup.posblBgnde <= ymd &&
    ymd <= setup.posblEndde;
  const earliest = (nowMs + KST_OFFSET_MS) / 60000 + setup.posblTm * 60;
  return setup.slots.map((start) => {
    const state: SlotState =
      !openDay || wallMinutes(date, start) < earliest ? 'closed' : booked.has(start) ? 'booked' : 'available';
    return { start, state };
  });
}

export type ExpandResult = { ok: true; times: string[] } | { ok: false; reason: string };

/**
 * 우리 예약 `[startMin, endMin)` 을 학교 슬롯 시작 시각들로 펼친다.
 * 슬롯 단위(termMin)로 딱 나누어떨어져야 하고, 각 시작 시각이 이 공간의 슬롯이어야 한다.
 */
export function expandSlots(startMin: number, endMin: number, setup: ResveSetup): ExpandResult {
  const span = endMin - startMin;
  if (!Number.isInteger(startMin) || !Number.isInteger(endMin) || span <= 0) {
    return { ok: false, reason: '예약 시간이 올바르지 않아요.' };
  }
  if (span % setup.termMin !== 0) {
    return {
      ok: false,
      reason: `이 공간은 ${setup.termMin}분 단위로만 신청할 수 있어서 ${fmtHm(startMin)}~${fmtHm(endMin)}(${span}분)은 신청할 수 없어요. 예약 시간을 ${setup.termMin}분 단위로 바꿔 주세요.`,
    };
  }
  const times: string[] = [];
  for (let m = startMin; m < endMin; m += setup.termMin) {
    const t = fmtHm(m);
    if (!setup.slots.includes(t)) {
      return {
        ok: false,
        reason: `${t}은(는) 이 공간의 신청 시간이 아니에요. 신청할 수 있는 시작 시각: ${setup.slots.join(', ')}`,
      };
    }
    times.push(t);
  }
  return { ok: true, times };
}

/** "10월 12일 (월) 10:00~12:00 (60분 × 2칸)" */
export function formatWhen(date: string, times: string[], termMin: number): string {
  const m = DATE_RE.exec(date)!;
  const end = fmtHm((parseHm(times[times.length - 1]) ?? 0) + termMin);
  return `${Number(m[2])}월 ${Number(m[3])}일 (${WEEKDAYS_KO[weekdayIndex(date)]}) ${times[0]}~${end} (${termMin}분 × ${times.length}칸)`;
}

// ── 신청 폼 ───────────────────────────────────────────────────────

/** 로그인한 신청 화면(`artclRegistView.do`)에서 `<input name="…">` 의 value 를 읽는다. 없으면 빈 문자열 */
export function inputValue(html: string, name: string): string {
  const needle = `name="${name}"`;
  // `html.match(/<input[^>]*>/g)` 와 같다 (정규식은 '>' 가 없으면 2차 시간이라 앞으로만 훑는다)
  let from = 0;
  for (;;) {
    const start = html.indexOf('<input', from);
    if (start < 0) return '';
    const gt = html.indexOf('>', start + 6);
    if (gt < 0) return '';
    const tag = html.slice(start, gt + 1);
    if (tag.includes(needle)) {
      const m = /value="([^"]*)"/.exec(tag);
      return m ? unescapeHtml(m[1]) : '';
    }
    from = gt + 1;
  }
}

/** 신청 폼을 만드는 데 필요한 모든 정보 */
export type BookingContext = {
  /** "<사이트>/<기능번호>" */
  key: string;
  site: string;
  fn: string;
  space: Space;
  /** YYYY-MM-DD */
  day: string;
  setup: ResveSetup;
  info: ResveInfo;
  /** 신청 대상 이름들 (파이썬은 이 이름들을 identityCode 로 그대로 보낸다) */
  identities: string[];
  items: ResveItem[];
  /** 신청 화면의 최종 주소 (Referer) */
  regUrl: string;
  layout: string;
  userNm: string;
  hakbun: string;
  telno: string;
  email: string;
};

/**
 * `artclRegist.do` 폼 데이터. **필드 순서까지 파이썬 build_payload 와 같다** (서버가 순서에 민감할 수 있다).
 * `resveTm` 은 슬롯마다 한 번씩 반복되고, 추가 항목은 번호(1부터)를 붙여 (MustYn, 값) 쌍으로 이어진다.
 */
export function buildPayload(
  ctx: BookingContext,
  times: string[],
  given: Record<string, string>,
  tel?: string,
  email?: string,
): [string, string][] {
  const { setup, info, space, items } = ctx;
  const payload: [string, string][] = [
    ['layout', ctx.layout],
    ['siteId', ctx.site],
    ['fnctNo', ctx.fn],
    ['lmttYn', 'N'],
    ['groupNm', info.groupNm],
    ['spceNm', info.spceNm || space.name],
    ['selDay', WEEKDAYS_KO[weekdayIndex(ctx.day)]],
    ['posblDay', setup.posblDay],
    ['posblTerm', setup.posblTerm],
    ['posblBgnde', setup.posblBgnde],
    ['posblEndde', setup.posblEndde],
    ['resveGroupSeq', setup.resveGroupSeq],
    ['userNm', ctx.userNm],
    ['hakbun', ctx.hakbun],
    ['addItemCnt', String(items.length)],
    ['group', setup.resveGroupSeq],
    ['resveSpceSeq', String(space.id)],
    ['mngr', info.mngr],
    ['mngrTelno', info.telno],
    ['resveDeStr', ctx.day],
    ['identityCode', ctx.identities.join(',')],
  ];
  for (const t of [...new Set(times)].sort()) payload.push(['resveTm', t]);
  payload.push(['telno', tel ?? ctx.telno], ['email', email ?? ctx.email]);
  items.forEach((it, i) => {
    payload.push([`addItemMustYn${i + 1}`, it.mustYn], [`addItem${i + 1}`, given[it.name] ?? '']);
  });
  return payload;
}

/** AJAX 서버 검증용 폼: 첫 필드(layout)를 비운다 (파이썬: [("layout", "")] + payload[1:]) */
export const validationPayload = (payload: [string, string][]): [string, string][] => [['layout', ''], ...payload.slice(1)];

export type ServerCheck =
  | { kind: 'ok' }
  | { kind: 'errors'; messages: string[] }
  /** 읽을 수 없는 응답 — 통과로 보지 않고 제출하지 않는다 */
  | { kind: 'unreadable' };

/**
 * AJAX 서버 검증 응답 해석. 통과 = 빈 본문 · `[]` · `null`. 오류 = 비어 있지 않은 배열 (각 오류 객체의 값들이 문장).
 * 그 밖의(HTML·객체 등) 응답은 'unreadable' — 파이썬은 이 경우를 통과로 보지만, 우리는 신청을 보내지 않는다.
 */
export function parseServerCheck(text: string): ServerCheck {
  const t = text.trim();
  if (t === '') return { kind: 'ok' };
  let json: unknown;
  try {
    json = JSON.parse(t);
  } catch {
    return { kind: 'unreadable' };
  }
  if (json === null) return { kind: 'ok' };
  if (!Array.isArray(json)) return { kind: 'unreadable' };
  if (json.length === 0) return { kind: 'ok' };
  const messages: string[] = [];
  for (const e of json) {
    if (e && typeof e === 'object') {
      for (const v of Object.values(e as Record<string, unknown>)) {
        if (typeof v === 'string' && v.trim()) messages.push(truncate(cleanText(v), 200));
      }
    } else if (typeof e === 'string' && e.trim()) {
      messages.push(truncate(cleanText(e), 200));
    }
  }
  return { kind: 'errors', messages: messages.length > 0 ? messages : ['학교 서버가 신청을 받아들이지 않았어요.'] };
}

/** 제출 응답의 `alert('…')` 문구 (학교가 사용자에게 보여 주려던 문장) */
export function extractAlerts(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/alert\(['"](.*?)['"]/g)) {
    const msg = truncate(cleanText(m[1]), 200);
    if (msg) out.push(msg);
  }
  return out.slice(0, 3);
}


// ── 신청 취소 (학교 신청내역 행에서 "취소" 컨트롤 찾기) ───────────────

/** 내 신청내역의 한 행: 읽은 값 + 그 행의 원본 HTML(취소 컨트롤을 찾는 데만 쓴다. 응답·로그에 내보내지 않는다) */
export type MineRowRaw = { row: MineRow; html: string };

export function parseMineRaw(html: string): MineRowRaw[] {
  const out: MineRowRaw[] = [];
  for (const tr of blocks(html, 'tr')) {
    if (tr.includes('no-data')) continue;
    const cells = [...blocks(tr, 'td')].map((c) => truncate(cleanText(c.slice(0, CELL_RAW_MAX)), CELL_MAX));
    if (cells.length >= 8) {
      out.push({ row: { no: cells[0], space: cells[1], date: cells[2], time: cells[3], applied: cells[6], status: cells[7] }, html: tr });
    }
  }
  return out;
}

/** 학교가 그 행에 보여 주는 "취소" 컨트롤. 앱이 알아볼 수 있는 방식(주소가 있는 링크·폼)만 따라간다. */
export type CancelControl =
  | { kind: 'link'; href: string }
  | { kind: 'form'; action: string; method: 'get' | 'post'; fields: [string, string][] }
  | { kind: 'script' }; // onclick 스크립트뿐이라 어떤 요청인지 알 수 없다 → 앱이 대신 보내지 않는다

const attr = (tag: string, name: string): string | null => {
  const m = new RegExp(String.raw`\b${name}\s*=\s*("([^"]*)"|'([^']*)')`, 'i').exec(tag);
  return m ? unescapeHtml(m[2] ?? m[3] ?? '') : null;
};

export function findCancelControl(rowHtml: string): CancelControl | null {
  // ① 취소라고 적힌 폼(숨은 입력값 포함)
  for (const m of rowHtml.matchAll(/(<form\b[^>]*>)([\s\S]*?)<\/form>/gi)) {
    const tag = m[1];
    const body = m[2];
    if (!/취소/.test(body)) continue;
    const action = attr(tag, 'action');
    if (!action) continue;
    const fields: [string, string][] = [];
    for (const inp of body.matchAll(/<input\b[^>]*>/gi)) {
      const name = attr(inp[0], 'name');
      if (name && (attr(inp[0], 'type') ?? 'text').toLowerCase() === 'hidden') fields.push([name, attr(inp[0], 'value') ?? '']);
    }
    return { kind: 'form', action, method: (attr(tag, 'method') ?? 'post').toLowerCase() === 'get' ? 'get' : 'post', fields };
  }
  // ② 취소라고 적힌 링크·버튼
  for (const m of rowHtml.matchAll(/<(a|button|input)\b([^>]*)>([\s\S]*?)(?:<\/\1>|(?=<))/gi)) {
    const tag = m[2];
    const label = `${cleanText(m[3] ?? '')} ${attr(tag, 'title') ?? ''} ${attr(tag, 'value') ?? ''} ${attr(tag, 'aria-label') ?? ''}`;
    if (!/취소/.test(label)) continue;
    const href = attr(tag, 'href');
    if (m[1].toLowerCase() === 'a' && href && !/^(javascript:|#)/i.test(href.trim())) return { kind: 'link', href: href.trim() };
    return { kind: 'script' };
  }
  return null;
}
