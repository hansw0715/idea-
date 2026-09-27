/**
 * 한성대 학습공간 예약 현황을 읽어온다.
 *
 * 학교 공식 '학습공간' 안내에 실린 온라인 예약 공간 중, 팀 단위로 쓸 수 있는
 * 세 시스템(학술정보관 / 상상베이스 / 상상파크플러스)을 대상으로 한다.
 * 세 곳 모두 같은 예약 위젯을 쓰기 때문에 조회 방식이 동일하다.
 *
 * 로그인 없이 공개된 조회 페이지만 읽으며, robots.txt는 관리자(/*Mngr)와
 * 로그인(/topLogin, /jwadLogin) 경로만 제한하므로 이 페이지는 대상이 아니다.
 * 학교 페이지 구조가 바뀌면 예외 대신 '정보 없음'으로 처리해 앱은 계속 동작한다.
 */

// HTTP 헤더는 ASCII만 허용되므로 한글을 넣지 않는다.
const USER_AGENT =
  'Mozilla/5.0 (compatible; CampusSpace/1.0; campus facility scheduling helper)';

export interface CampusSystem {
  key: string;
  label: string;
  /** 세션 쿠키를 받고 Referer로 쓸 공개 페이지 */
  listPage: string;
  endpoint: string;
  layout: string;
  siteId: string;
  /** 학생이 실제 신청하러 갈 페이지 */
  reserveUrl: string;
  contact: string;
}

export const CAMPUS_SYSTEMS: CampusSystem[] = [
  {
    key: 'hsel',
    label: '학술정보관',
    listPage: 'https://hansung.ac.kr/hsel/2153/subview.do',
    endpoint: 'https://hansung.ac.kr/resve/hsel/14/artclList.do',
    layout: '6873656c4040323135334040666e637431',
    siteId: 'hsel',
    reserveUrl: 'https://hansung.ac.kr/hsel/2153/subview.do',
    contact: '02-760-5667, 02-760-5695',
  },
  {
    key: 'onestop',
    label: '상상베이스',
    listPage: 'https://hansung.ac.kr/onestop/5920/subview.do',
    endpoint: 'https://hansung.ac.kr/resve/onestop/16/artclList.do',
    layout: '6f6e6573746f704040353932304040666e637431',
    siteId: 'onestop',
    reserveUrl: 'https://hansung.ac.kr/onestop/5920/subview.do',
    contact: '02-760-8000',
  },
  {
    key: 'cncschool',
    label: '상상파크플러스',
    listPage: 'https://hansung.ac.kr/cncschool/4181/subview.do',
    endpoint: 'https://hansung.ac.kr/resve/cncschool/2/artclList.do',
    layout: '636e637363686f6f6c4040343138314040666e637431',
    siteId: 'cncschool',
    reserveUrl: 'https://hansung.ac.kr/cncschool/4181/subview.do',
    contact: '02-760-4800',
  },
  {
    // 같은 cncschool 사이트지만 예약 위젯이 달라 별도 시스템으로 다룬다.
    key: 'codinglounge',
    label: '코딩라운지',
    listPage: 'https://hansung.ac.kr/cncschool/4182/subview.do',
    endpoint: 'https://hansung.ac.kr/resve/cncschool/7/artclList.do',
    layout: '636e637363686f6f6c4040343138324040666e637431',
    siteId: 'cncschool',
    reserveUrl: 'https://hansung.ac.kr/cncschool/4182/subview.do',
    contact: '02-760-8021',
  },
];

export interface BusyBlock {
  systemKey: string;
  /** 학교 시스템에 표시되는 공간 이름 (매칭 키) */
  campusName: string;
  date: string; // YYYY-MM-DD
  startMin: number;
  endMin: number;
  /** 'reserved' = 이미 예약됨, 'closed' = 휴무·점검으로 신청 불가 */
  reason: 'reserved' | 'closed';
}

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

const TIME_RE = /(\d{2}):(\d{2})~(\d{2}):(\d{2})/g;

/**
 * 달력 HTML을 셀 단위로 훑어 예약/신청불가 구간을 뽑는다.
 * 셀 안 공백이 많아 거리 기반 매칭은 불안정하므로 셀·박스 단위로 나눠 읽는다.
 */
function parseBusy(html: string, systemKey: string, year: number, month: number): BusyBlock[] {
  const blocks: BusyBlock[] = [];

  for (const cell of html.split(/<td[^>]*>/).slice(1)) {
    const dayMatch = cell.match(/<span>(\d{1,2})<\/span>/);
    if (!dayMatch) continue;
    const day = Number(dayMatch[1]);
    if (!Number.isInteger(day) || day < 1 || day > 31) continue;
    const fallbackDate = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

    for (const box of cell.matchAll(/<div class="conBox"[^>]*>([\s\S]*?)<\/div>/g)) {
      const raw = box[1];
      const isClosed = raw.includes('신청불가');

      // 예약 항목은 주석에 정확한 날짜가 들어 있어 그대로 쓴다.
      const dated = raw.match(/<!--\s*#\d+_[^_]*_(\d{4}-\d{2}-\d{2})/);
      const date = dated ? dated[1] : fallbackDate;

      // 주석 안의 '-'와 날짜가 이름·시각 추출을 방해하므로 먼저 제거한다.
      const inner = raw.replace(/<!--[\s\S]*?-->/g, '');

      // 공간 이름: 예약은 "- 이름<br>", 신청불가는 첫 시각 앞의 텍스트.
      let campusName: string;
      if (isClosed) {
        const head = inner.replace(/<[^>]*>/g, ' ').split(/\d{2}:\d{2}~\d{2}:\d{2}/)[0];
        campusName = head.replace(/\s+/g, ' ').trim();
      } else {
        const named = inner.match(/-\s*([^<]+?)\s*<br>/);
        if (!named) continue;
        campusName = named[1].trim();
      }
      if (!campusName) continue;

      TIME_RE.lastIndex = 0;
      for (const t of inner.matchAll(TIME_RE)) {
        blocks.push({
          systemKey,
          campusName,
          date,
          startMin: toMinutes(`${t[1]}:${t[2]}`),
          endMin: toMinutes(`${t[3]}:${t[4]}`),
          reason: isClosed ? 'closed' : 'reserved',
        });
      }
    }
  }

  return blocks;
}

async function fetchSystem(
  system: CampusSystem,
  year: number,
  month: number,
): Promise<BusyBlock[]> {
  // 세션 쿠키 없이 조회하면 302로 튕긴다.
  const pageRes = await fetch(system.listPage, { headers: { 'User-Agent': USER_AGENT } });
  const cookie = (pageRes.headers.getSetCookie?.() ?? [])
    .map((c) => c.split(';')[0])
    .join('; ');

  // resveSpceSeq를 비우면 해당 시스템의 전 공간을 한 번에 받는다.
  const body = new URLSearchParams({
    layout: system.layout,
    siteId: system.siteId,
    year: String(year),
    month: String(month),
    resveSpceSeq: '',
  });
  const res = await fetch(system.endpoint, {
    method: 'POST',
    headers: {
      'User-Agent': USER_AGENT,
      Referer: system.listPage,
      Cookie: cookie,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`${system.label} 조회 실패: HTTP ${res.status}`);
  return parseBusy(await res.text(), system.key, year, month);
}

interface CacheEntry {
  fetchedAt: number;
  blocks: BusyBlock[];
}

const CACHE_TTL_MS = 15 * 60 * 1000;
const cache = new Map<string, CacheEntry>();

/**
 * 해당 연·월의 학교 예약/휴무 현황을 돌려준다.
 * 전부 실패하면 null을 돌려주며, 일부만 실패하면 성공한 시스템 결과만 담는다.
 */
export async function getCampusBusy(year: number, month: number): Promise<BusyBlock[] | null> {
  const key = `${year}-${month}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.fetchedAt < CACHE_TTL_MS) return hit.blocks;

  const results = await Promise.allSettled(
    CAMPUS_SYSTEMS.map((s) => fetchSystem(s, year, month)),
  );
  const blocks: BusyBlock[] = [];
  let ok = 0;
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') {
      blocks.push(...r.value);
      ok += 1;
    } else {
      console.error(`[campus] ${CAMPUS_SYSTEMS[i].label} 예약 현황 조회 실패:`, r.reason);
    }
  });

  if (ok === 0) {
    // 오래된 캐시라도 있으면 아무것도 없는 것보다 낫다.
    return hit ? hit.blocks : null;
  }
  cache.set(key, { fetchedAt: Date.now(), blocks });
  return blocks;
}
