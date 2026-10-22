// 학과별 공지 게시판 목록을 한성대 홈페이지에서 읽어 shared/notices/boards.ts 로 저장한다.
// 단과대학 사이트 상단 메뉴(학부 → 학과·트랙 → 공지사항/게시판)를 따라가 게시판 번호(bbs)를 찾는다.
//   - 학부는 아래 트랙들의 게시판을 모두 묶는다 (포털 소속이 "사회과학부"처럼 학부까지만 나오는 학생용)
//   - 자기 게시판이 없는 학과는 그 단과대학의 공지(정보마당 공지사항 등)를 쓴다
// 학과 개편으로 메뉴가 바뀌면 다시 실행한다. 사용: node scripts/crawl-notice-boards.mjs
import { writeFileSync } from 'node:fs';
import { load } from 'cheerio';

const ORIGIN = 'https://hansung.ac.kr';
/** 학과가 모여 있는 단과대학 사이트 */
const COLLEGE_SITES = ['HmnArt', 'SclScn', 'Design', 'Engineering', 'CreCon', 'global', 'futureplus', 'LibArt'];
/** 학과 메뉴 안에서 공지 게시판으로 쓰는 메뉴 이름 (앞쪽이 우선) */
const NOTICE_MENU = ['공지사항', '학과공지', '학부공지', '게시판'];
/** 단과대학 전체 공지로 쓰는 메뉴 이름 */
const COLLEGE_NOTICE_MENU = ['공지사항', '전체공지'];

const clean = (s) => s.replace(/\s+/g, '').trim();
/** 학과가 아닌 상단 메뉴 묶음 */
const NOT_DEPARTMENT_GROUP = new Set(['대학소개', '학사안내', '정보마당', '입학안내', '이용안내', '사이트맵']);

async function get(path) {
  const res = await fetch(ORIGIN + path, { headers: { 'User-Agent': 'Mozilla/5.0 sangsang-booke' } });
  if (!res.ok) throw new Error(`${res.status} ${path}`);
  return res.text();
}

const bbsCache = new Map();
/** 메뉴 페이지(subview)에 붙은 게시판 번호: /bbs/<site>/<bbs>/... */
async function boardOf(site, menuPath) {
  if (!bbsCache.has(menuPath)) {
    const html = await get(menuPath).catch(() => '');
    const m = html.match(new RegExp(`/bbs/${site}/(\\d+)/`));
    bbsCache.set(menuPath, m ? Number(m[1]) : null);
  }
  return bbsCache.get(menuPath);
}

const isMenuPath = (href) => /^\/[A-Za-z]+\/\d+\/subview\.do$/.test(href);

/** 링크 목록에서 공지 메뉴 하나 고르기 */
function pick(links, names) {
  return names.map((t) => links.find((l) => l.text === t)).find((l) => l && isMenuPath(l.href));
}

const entries = [];
for (const site of COLLEGE_SITES) {
  let html;
  try {
    html = await get(`/${site}/index.do`);
  } catch (err) {
    console.warn(`건너뜀 ${site}: ${err.message}`);
    continue;
  }
  const $ = load(html);
  const linksIn = (el, sel) =>
    $(el)
      .find(sel)
      .toArray()
      .map((a) => ({ text: clean($(a).text()), href: $(a).attr('href') ?? '' }));

  // 단과대학 전체 공지 (정보마당 > 공지사항 등)
  const collegeMenu = pick(linksIn('#top_k2wiz_GNB', 'li.li_2 > a'), COLLEGE_NOTICE_MENU);
  const collegeBbs = collegeMenu ? await boardOf(site, collegeMenu.href) : null;
  const collegeBoard = collegeBbs ? { bbs: collegeBbs, url: ORIGIN + collegeMenu.href } : null;

  const siteEntries = [];
  for (const li1 of $('#top_k2wiz_GNB > li.li_1').toArray()) {
    const groupName = clean($(li1).children('a').first().text());
    if (NOT_DEPARTMENT_GROUP.has(groupName)) continue;
    const groupBoards = [];
    for (const li2 of $(li1).find('li.li_2').toArray()) {
      const name = clean($(li2).children('a').first().text()).replace(/\(계약학과\)$/, '');
      const subs = linksIn(li2, 'li.li_3 > a');
      if (subs.length === 0) continue; // 하위 메뉴가 없는 칸(정보마당의 공지사항 등)은 학과가 아니다
      const menu = pick(subs, NOTICE_MENU);
      const bbs = menu ? await boardOf(site, menu.href) : null;
      const own = bbs ? { bbs, url: ORIGIN + menu.href } : null;
      if (own) groupBoards.push(own);
      siteEntries.push({ name, group: groupName, own });
    }
    // 학부 이름(li_1) 자체: 트랙 게시판을 모두 묶는다. "학과 소개"처럼 학과 묶음 이름인 칸은 건너뛴다
    if (/(학부|학과)$/.test(groupName) && !siteEntries.some((e) => e.name === groupName && e.group === groupName)) {
      siteEntries.push({ name: groupName, group: groupName, own: null, children: groupBoards });
    }
  }

  for (const e of siteEntries) {
    const list = e.own ? [e.own] : e.children?.length ? e.children : collegeBoard ? [collegeBoard] : [];
    const unique = [...new Map(list.map((b) => [b.bbs, b])).values()];
    if (unique.length === 0) continue;
    entries.push({
      name: e.name,
      site,
      boards: unique.map((b) => b.bbs),
      url: unique[0].url,
      ...(e.own ? {} : { shared: e.children?.length ? 'tracks' : 'college' }),
    });
  }
}

// 같은 이름이 여러 번 나오면(학부 칸과 같은 이름의 학과 칸) 게시판을 합친다
const merged = new Map();
for (const e of entries) {
  const key = `${e.site}|${e.name}`;
  const prev = merged.get(key);
  if (prev) prev.boards = [...new Set([...prev.boards, ...e.boards])];
  else merged.set(key, e);
}
const out = [...merged.values()];
for (const e of out) console.log(`${e.name.padEnd(18)} ${e.site}/${e.boards.join(',')}${e.shared ? `  (${e.shared})` : ''}`);

const header = `// 자동 생성 파일 — 손으로 고치지 말고 node scripts/crawl-notice-boards.mjs 를 다시 실행한다. (${new Date().toISOString().slice(0, 10)})
import type { DepartmentBoard } from './types.js';

export const DEPARTMENT_BOARDS: DepartmentBoard[] = `;
writeFileSync(new URL('../shared/notices/boards.ts', import.meta.url), header + JSON.stringify(out, null, 2) + ';\n');
console.log(`\n${out.length}개 학과·트랙 게시판을 저장했습니다.`);
