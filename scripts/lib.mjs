// 화면 확인용 공용 도구. 개발 서버(npm run dev 또는 아래 README 의 두 명령)가 떠 있어야 한다.
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

export const BASE = process.env.BASE_URL ?? 'http://localhost:5273';
export const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? 'Test1234!';

/** 설치된 Edge(없으면 Chrome)로 모바일 환경을 흉내 낸다. 기본 390×844 (iPhone 14 급). */
export async function launch({ width = 390, height = 844, dsf = 2, touch = true } = {}) {
  let browser;
  try {
    browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL ?? 'msedge' });
  } catch {
    browser = await chromium.launch({ channel: 'chrome' });
  }
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: dsf,
    isMobile: touch,
    hasTouch: touch,
    locale: 'ko-KR',
    timezoneId: 'Asia/Seoul',
  });
  const page = await context.newPage();
  page.on('pageerror', (err) => console.error('[pageerror]', err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') console.error('[console.error]', msg.text());
  });
  return { browser, context, page };
}

/** API 로 로그인해 쿠키를 얻는다. (시연 계정 admin1~3@hansung.ac.kr) */
export async function login(page, who = 'admin1') {
  const email = who.includes('@') ? who : `${who}@hansung.ac.kr`;
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
  const status = await page.evaluate(
    async ({ email, password }) => {
      const r = await fetch('/api/auth/login', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      return r.status;
    },
    { email, password: ADMIN_PASSWORD },
  );
  if (status !== 200) throw new Error(`로그인 실패(${status}): ${email}`);
}

/** 스크린샷을 shots/ 아래에 저장하고 경로를 돌려준다. */
export async function shot(page, name, { full = false } = {}) {
  const file = path.resolve('shots', name.endsWith('.png') ? name : `${name}.png`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  await page.screenshot({ path: file, fullPage: full });
  return file;
}

/** 가로 스크롤(넘침)이 생겼는지 점검 — 모바일에서 가장 흔한 깨짐 */
export async function horizontalOverflow(page) {
  return page.evaluate(() => {
    const de = document.documentElement;
    return { scrollWidth: de.scrollWidth, clientWidth: de.clientWidth, overflow: de.scrollWidth > de.clientWidth + 1 };
  });
}
