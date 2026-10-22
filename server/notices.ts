import { Router } from 'express';
import { load } from 'cheerio';
import { get } from './db.js';
import { requireAuth, userId, wrap } from './auth.js';
import { findDepartmentBoard } from '../shared/notices/match.js';
import type { NoticeItem, NoticeSection, NoticesResponse } from '../shared/notices/types.js';

/**
 * 홈의 "학교 공지 · 학과 공지" — 한성대 홈페이지 게시판 목록을 읽어 가장 최근에 올라온 글 NOTICE_LIMIT 개를 돌려준다.
 * 게시판마다 RSS 를 켜 둔 곳과 아닌 곳이 섞여 있어, 모든 게시판에 있는 목록 화면(artclList.do)을 읽는다.
 */

const ORIGIN = 'https://hansung.ac.kr';
const USER_AGENT = 'Mozilla/5.0 (compatible; sangsang-booke)';
/** 학교·학과 공지를 각각 몇 개 보여 줄지 (가장 최근 순) */
export const NOTICE_LIMIT = 5;
const FETCH_TIMEOUT_MS = 8000;
/** 학교 홈페이지는 동시에 서너 건 이상 물으면 한 건에 8초씩 늦어진다. 한 번에 두 건까지만 묻는다 */
const MAX_CONCURRENT = 2;
/** 같은 게시판을 여러 사람이 열어도 학교 홈페이지에는 10분에 한 번만 묻는다 */
const CACHE_TTL_MS = 10 * 60 * 1000;

const SCHOOL = { site: 'hansung', bbs: 2127, url: `${ORIGIN}/hansung/6172/subview.do` };

interface Row extends NoticeItem {
  /** 목록 위에 고정된 공지 — 날짜 순서와 상관없이 맨 위에 있다 */
  pinned: boolean;
}

/** "2026.10.07" → "2026-10-07" */
function toDate(raw: string): string | null {
  const m = raw.trim().match(/^(\d{4})[.-](\d{1,2})[.-](\d{1,2})/);
  return m ? `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}` : null;
}

/** 게시판 목록 화면 한 쪽에서 글 줄을 뽑는다 */
export function parseNoticeList(html: string, site: string, bbs: number): Row[] {
  const $ = load(html);
  const rows: Row[] = [];
  $('tbody tr').each((_, tr) => {
    const a = $(tr).find('td.td-title a').first();
    const href = a.attr('href') ?? '';
    const id = href.match(new RegExp(`/bbs/${site}/${bbs}/(\\d+)/artclView\\.do`))?.[1];
    const date = toDate($(tr).find('td.td-date').text());
    // "새글" 같은 표시 글자를 빼고 제목만
    const title = (a.find('strong').text() || a.text()).replace(/\s+/g, ' ').replace(/\s*새글\s*$/, '').trim();
    if (!id || !date || !title) return;
    rows.push({
      id: `${site}-${bbs}-${id}`,
      title,
      date,
      writer: $(tr).find('td.td-write').text().replace(/\s+/g, ' ').trim(),
      url: `${ORIGIN}/bbs/${site}/${bbs}/${id}/artclView.do`,
      pinned: $(tr).hasClass('notice'),
    });
  });
  return rows;
}

let running = 0;
const waiting: (() => void)[] = [];

/** 동시에 MAX_CONCURRENT 건까지만 실행하고 나머지는 차례를 기다린다 */
async function limited<T>(task: () => Promise<T>): Promise<T> {
  if (running >= MAX_CONCURRENT) await new Promise<void>((resolve) => waiting.push(resolve));
  running++;
  try {
    return await task();
  } finally {
    running--;
    waiting.shift()?.();
  }
}

/** 학교 홈페이지가 가끔 응답을 놓친다. 시간 초과·연결 오류면 한 번만 다시 묻는다 */
async function fetchPage(site: string, bbs: number, page: number): Promise<string> {
  try {
    return await limited(() => fetchPageNow(site, bbs, page));
  } catch {
    return limited(() => fetchPageNow(site, bbs, page));
  }
}

async function fetchPageNow(site: string, bbs: number, page: number): Promise<string> {
  const res = await fetch(`${ORIGIN}/bbs/${site}/${bbs}/artclList.do?page=${page}`, {
    headers: { 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`공지 목록 조회 실패: HTTP ${res.status}`);
  return res.text();
}

interface Cached {
  fetchedAt: number;
  items: NoticeItem[];
}
const cache = new Map<string, Cached>();

/** 최신순 정렬 (같은 날이면 글 번호가 큰 것 = 나중 글이 먼저) */
const newestFirst = (a: NoticeItem, b: NoticeItem) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id);

/**
 * 게시판 하나의 가장 최근 글 NOTICE_LIMIT 개. 첫 쪽(약 10~20건)만 읽는다.
 * 위에 고정된 오래된 공지는 날짜로 다시 정렬하면 뒤로 밀려 자연스럽게 빠진다.
 */
async function latestFromBoard(site: string, bbs: number): Promise<NoticeItem[]> {
  const key = `${site}/${bbs}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.fetchedAt < CACHE_TTL_MS) return hit.items;

  const rows = parseNoticeList(await fetchPage(site, bbs, 1), site, bbs);
  const unique = new Map(rows.map(({ pinned: _pinned, ...item }) => [item.id, item]));
  const items = [...unique.values()].sort(newestFirst).slice(0, NOTICE_LIMIT);
  cache.set(key, { fetchedAt: Date.now(), items });
  return items;
}

/** 여러 게시판(학부의 트랙 게시판들)을 합쳐 하나의 목록으로. 하나라도 읽으면 성공으로 본다 */
async function section(name: string, url: string, site: string, boards: number[]): Promise<NoticeSection> {
  const results = await Promise.allSettled(boards.map((bbs) => latestFromBoard(site, bbs)));
  const ok = results.filter((r): r is PromiseFulfilledResult<NoticeItem[]> => r.status === 'fulfilled');
  if (ok.length === 0) return { name, url, items: [], failed: true };
  // 같은 글이 여러 트랙 게시판에 올라오면 제목·날짜가 같다 — 한 번만 보여 준다
  const seen = new Set<string>();
  const items = ok
    .flatMap((r) => r.value)
    .sort(newestFirst)
    .filter((it) => {
      const k = `${it.date}|${it.title}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .slice(0, NOTICE_LIMIT);
  return { name, url, items };
}

export const noticesRouter = Router();

noticesRouter.use(requireAuth);

noticesRouter.get(
  '/',
  wrap(async (_req, res) => {
    const uid = userId(res);
    // 학교 계정 연동 때 포털에서 읽은 소속이 먼저, 없으면 라운지 프로필의 학과
    const row = await get<{ department: string | null }>(
      `SELECT COALESCE(NULLIF(school_department, ''), NULLIF(department, '')) AS department FROM users WHERE id = ?`,
      [uid],
    );
    const departmentName = row?.department?.trim() ?? '';
    const board = findDepartmentBoard(departmentName);

    const [school, department] = await Promise.all([
      section('학교 공지', SCHOOL.url, SCHOOL.site, [SCHOOL.bbs]),
      board ? section(departmentName, board.url, board.site, board.boards) : Promise.resolve(null),
    ]);

    const body: NoticesResponse = { limit: NOTICE_LIMIT, school, department, departmentName };
    // 사람마다 학과가 달라 브라우저에 남겨 두지 않는다 (같은 브라우저에서 계정을 바꾸면 남의 학과가 보인다)
    res.set('Cache-Control', 'no-store');
    res.json(body);
  }),
);
