// Isolated UI review: synthetic credentials and intercepted API; no server writes.
import { launch, shot, horizontalOverflow, BASE } from './lib.mjs';
const { browser, context, page } = await launch();
const errors = [];
page.on('pageerror', e => errors.push(e.message));
await context.route('**/api/**', async route => {
  const p = new URL(route.request().url()).pathname;
  if (p.endsWith('/auth/me')) return route.fulfill({ status: 401, json: { error: 'Review guest' } });
  const json = p.endsWith('/school-verify')
    ? { ticket: 'layout-review-only', hint: '24****', profile: { name: '김상상', department: '디자인학부', admissionYear: 2024 } }
    : p.includes('/username-available') ? { available: true }
    : p.endsWith('/signup') ? { id: 99, username: 'layout_review', name: '김상상', school: { hint: '24****', department: '디자인학부', admissionYear: 2024 } }
    : { linked: false };
  return route.fulfill({ json });
});
async function capture(name) {
  await page.waitForTimeout(450);
  const overflow = await horizontalOverflow(page);
  const side = await page.locator('.signup-side').evaluateAll(nodes => nodes.map(n => ({ top: n.getBoundingClientRect().top, height: n.getBoundingClientRect().height, position: getComputedStyle(n).position })));
  const columns = await page.locator('.auth-split').evaluate(n => getComputedStyle(n).gridTemplateColumns);
  console.log(name, JSON.stringify({ ...overflow, side, columns }));
  if (overflow.overflow) errors.push(`${name}: horizontal overflow`);
  await shot(page, name, { full: true });
}
try {
  for (const [width, font] of [[1280, 10], [390, 10], [320, 20], [1280, 20]]) {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: font === 20 ? 'reduce' : 'no-preference' });
    const prefix = `auth-review-${width}-${font * 10}pct`;
    await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
    await page.evaluate(f => { document.documentElement.style.fontSize = `${f}px`; }, font);
    await capture(`${prefix}-login`);
    await page.goto(`${BASE}/signup`, { waitUntil: 'networkidle' });
    await page.evaluate(f => { document.documentElement.style.fontSize = `${f}px`; }, font);
    await capture(`${prefix}-school`);
    await page.locator('input[name="school-id"]').fill('2499999');
    await page.locator('input[name="school-pw"]').fill('ReviewOnly123!');
    await page.locator('form button[type="submit"]').click();
    await page.locator('input[name="username"]').waitFor();
    await capture(`${prefix}-account`);
    await page.locator('input[name="username"]').fill('layout_review');
    await page.locator('input[name="new-password"]').fill('ReviewOnly123!');
    await page.locator('input[name="confirm-password"]').fill('ReviewOnly123!');
    await page.getByRole('button', { name: '다음', exact: true }).click();
    await page.locator('#signup-consent-notice').waitFor();
    await capture(`${prefix}-consent`);
    await page.evaluate(() => window.scrollTo(0, 300));
    console.log('Scrolled side:', await page.locator('.signup-side').evaluate(n => n.getBoundingClientRect().top));
    await page.locator('input[name="school-consent"]').check();
    await page.getByRole('button', { name: '가입 완료', exact: true }).click();
    await page.getByRole('button', { name: '지금 가져오기', exact: true }).waitFor({ timeout: 30000 });
    await capture(`${prefix}-done`);
  }
  console.log('Runtime/layout errors:', JSON.stringify(errors));
  if (errors.length) process.exitCode = 1;
} finally { await browser.close(); }
