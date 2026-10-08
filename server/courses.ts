/**
 * 한성대 공개 강의시간표(시간표 및 수업계획서조회)를 읽어 과목 검색을 제공한다.
 *
 * 로그인 없이 공개된 조회 API만 사용하며 학생 계정 정보를 다루지 않는다.
 * 개인 시간표(종합정보시스템)는 로그인이 필요해 가져오지 않고,
 * 학생이 자기 과목을 검색해 직접 담는 방식으로 대체한다.
 */

const BASE = 'https://info.hansung.ac.kr/jsp/haksa';
const PAGE = `${BASE}/siganpyo_aui.jsp`;
const DATA = `${BASE}/siganpyo_aui_data.jsp`;
const USER_AGENT =
  'Mozilla/5.0 (compatible; CampusSpace/1.0; campus facility scheduling helper)';

const DAY_CHARS = '월화수목금토일';

export interface CourseSlot {
  day: number; // 0=월
  startMin: number;
  endMin: number;
}

export interface Course {
  code: string;
  name: string;
  category: string; // 이수구분 (전선/교필/선필교 …)
  credit: string;
  grade: string; // 학년 (전학년 등)
  professor: string;
  room: string;
  /** 대면 수업 시간대. 온라인 전용 과목은 빈 배열 */
  slots: CourseSlot[];
  /** 온라인 강좌가 섞여 있으면 원문 표기 (예: '온라인강좌 1.5시간') */
  onlineNote: string | null;
}

/**
 * 교시 → 시각 변환.
 * 회원 실제 시간표와 공식 데이터 6과목을 대조해 확인한 규칙:
 *   N교시는 (N+8)시 정각에 시작하고 30분짜리다.
 *   'M'이 붙으면 그 30분 뒤 칸(N시 30분~N+1시)을 뜻한다.
 *   'A~B'는 A 시작부터 B 끝까지를 가리킨다.
 * 예) 화1~3M = 09:00~12:00, 목4~5 = 12:00~13:30, 금7~9M = 15:00~18:00
 */
function periodStart(period: number): number {
  return (period + 8) * 60;
}

function parseDayToken(token: string, fallbackDay: number): CourseSlot | null {
  const m = token.match(/^([월화수목금토일])?(\d+)(M?)~(\d+)(M?)$/);
  if (!m) return null;
  const day = m[1] ? DAY_CHARS.indexOf(m[1]) : fallbackDay;
  if (day < 0) return null;
  const startMin = periodStart(Number(m[2])) + (m[3] ? 30 : 0);
  const endMin = periodStart(Number(m[4])) + (m[5] ? 60 : 30);
  if (endMin <= startMin) return null;
  return { day, startMin, endMin };
}

/** '온라인강좌 1시간 / 공학관315  화5~6M' → 강의실과 대면 시간대 */
export function parseClassroom(raw: string): {
  room: string;
  slots: CourseSlot[];
  onlineNote: string | null;
} {
  const text = raw.trim();
  const onlineMatch = text.match(/온라인강좌[^/]*/);
  const onlineNote = onlineMatch ? onlineMatch[0].trim() : null;

  // 온라인 표기 뒤(마지막 '/' 뒤)가 대면 부분이다.
  const offline = text.includes('/') ? text.slice(text.lastIndexOf('/') + 1).trim() : text;
  if (!offline || /^온라인/.test(offline)) return { room: '', slots: [], onlineNote };

  const dayIndex = offline.search(new RegExp(`[${DAY_CHARS}]`));
  if (dayIndex < 0) return { room: offline, slots: [], onlineNote };

  const room = offline.slice(0, dayIndex).trim();
  const tokens = offline.slice(dayIndex).replace(/\s+/g, '').split(',');

  const slots: CourseSlot[] = [];
  let lastDay = 0;
  for (const token of tokens) {
    const slot = parseDayToken(token, lastDay);
    if (!slot) continue;
    lastDay = slot.day;
    slots.push(slot);
  }
  return { room, slots, onlineNote };
}

function cdata(row: string, tag: string): string {
  const m = row.match(new RegExp(`<${tag}><!\\[CDATA\\[([\\s\\S]*?)\\]\\]></${tag}>`));
  return m ? m[1].trim() : '';
}

async function postForm(url: string, body: Record<string, string>): Promise<string> {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'User-Agent': USER_AGENT,
      Referer: PAGE,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(body),
  });
  if (!res.ok) throw new Error(`강의 정보 조회 실패: HTTP ${res.status}`);
  // 학교 시스템은 EUC-KR로 응답한다.
  return new TextDecoder('euc-kr').decode(await res.arrayBuffer());
}

interface Cached<T> {
  fetchedAt: number;
  value: T;
}

const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 강의시간표는 자주 바뀌지 않는다
const courseCache = new Map<string, Cached<Course[]>>();
let optionCache: Cached<{ terms: Option[]; majors: Option[] }> | null = null;

export interface Option {
  code: string;
  name: string;
}

/** <item><tcd>코드</tcd><tnm>이름</tnm></item> 목록을 파싱한다. */
function parseItems(xml: string): Option[] {
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)]
    .map((m) => ({
      code: cdata(m[1], 'tcd'),
      // '[P012] 영미언어정보트랙' 처럼 코드가 앞에 붙어 있어 떼어 낸다.
      name: cdata(m[1], 'tnm').replace(/^\[[^\]]*\]\s*/, ''),
    }))
    .filter((o) => o.code && o.name);
}

/**
 * 학기·전공 선택지를 읽어 온다.
 * 선택지는 페이지 HTML이 아니라 별도 조회 API로 채워진다.
 */
export async function getOptions(): Promise<{ terms: Option[]; majors: Option[] }> {
  if (optionCache && Date.now() - optionCache.fetchedAt < CACHE_TTL_MS) return optionCache.value;

  const termXml = await postForm(`${DATA}?gubun=yearhakgilist`, {});
  const allTerms = parseItems(termXml);
  // 학기 코드는 'YYYYS' 형태다. 지난 학기까지 다 보여줄 필요가 없으므로
  // 가장 최근 학년도만 남긴다. (해가 바뀌면 자동으로 따라간다)
  const latestYear = allTerms.reduce((max, t) => {
    const year = t.code.slice(0, 4);
    return year > max ? year : max;
  }, '');
  const terms = allTerms.filter((t) => t.code.startsWith(latestYear));
  const latest = terms[0]?.code ?? '';
  const majorXml = await postForm(`${DATA}?gubun=jungonglist`, { syearhakgi: latest });

  // 검색 대상은 전공과 교양(교양필수·선택필수교양·일반교양)으로 한정한다.
  // M* 는 C&C School·전문과정 등 비교과 과정, L11H/L330 은 일반선택·학점인정이라 제외한다.
  const isSearchable = (code: string) => !/^M/.test(code) && !['L11H', 'L330'].includes(code);

  const value = { terms, majors: parseItems(majorXml).filter((o) => isSearchable(o.code)) };
  optionCache = { fetchedAt: Date.now(), value };
  return value;
}

/** 특정 학기·전공의 강의 목록. */
export async function getCourses(term: string, major: string): Promise<Course[]> {
  const key = `${term}|${major}`;
  const hit = courseCache.get(key);
  if (hit && Date.now() - hit.fetchedAt < CACHE_TTL_MS) return hit.value;

  const xml = await postForm(DATA, { gubun: 'history', syearhakgi: term, sjungong: major });
  const courses: Course[] = [];
  for (const m of xml.matchAll(/<row>([\s\S]*?)<\/row>/g)) {
    const row = m[1];
    const { room, slots, onlineNote } = parseClassroom(cdata(row, 'classroom'));
    courses.push({
      code: cdata(row, 'kwamokcode'),
      name: cdata(row, 'kwamokname'),
      category: cdata(row, 'isugubun'),
      credit: cdata(row, 'hakjum'),
      grade: cdata(row, 'haknean'),
      professor: cdata(row, 'prof'),
      room,
      slots,
      onlineNote,
    });
  }
  courseCache.set(key, { fetchedAt: Date.now(), value: courses });
  return courses;
}
