// 화면 확인용 공용 도구. 개발 서버(npm run dev 또는 아래 README 의 두 명령)가 떠 있어야 한다.
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

export const BASE = process.env.BASE_URL ?? 'http://localhost:5273';
export const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? 'Test1234!';
/** 라운지 개발용 시드(POST /api/lounge/dev/seed)가 만드는 데모 사용자 demo1~8 의 비밀번호 */
export const DEMO_PASSWORD = process.env.DEMO_PASSWORD ?? 'Demo1234!';

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

/** API 로 로그인해 쿠키를 얻는다. (시연 계정 admin1~3, 라운지 데모 계정 demo1~8 — @hansung.ac.kr) */
export async function login(page, who = 'admin1') {
  const email = who.includes('@') ? who : `${who}@hansung.ac.kr`;
  const pw = who.startsWith('demo') ? DEMO_PASSWORD : ADMIN_PASSWORD;
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
    { email, password: pw },
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

/**
 * 이미 연 브라우저에서 사용자 한 명 분의 독립된 컨텍스트(쿠키·localStorage 분리)와 페이지를 연다.
 * 접속자·단톡방처럼 여러 사람이 동시에 쓰는 화면을 확인할 때 쓴다:
 *   const { browser } = await launch();  const a = await openAs(browser, 'demo1');  const b = await openAs(browser, 'demo2');
 */
export async function openAs(browser, who, { width = 390, height = 844, dsf = 2, touch = true } = {}) {
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: dsf,
    isMobile: touch,
    hasTouch: touch,
    locale: 'ko-KR',
    timezoneId: 'Asia/Seoul',
  });
  const page = await context.newPage();
  page.on('pageerror', (err) => console.error(`[${who} pageerror]`, err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') console.error(`[${who} console.error]`, msg.text());
  });
  await login(page, who);
  return { context, page };
}
