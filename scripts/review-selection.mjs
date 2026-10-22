// Isolated API fixtures; no school requests or form submissions reach a server.
import assert from 'node:assert/strict';
import { launch, shot, horizontalOverflow, BASE } from './lib.mjs';
const { browser, context, page } = await launch();
const members = Array.from({ length: 8 }, (_, i) => ({ id: i + 1, name: `팀원 ${i + 1}`, isOwner: i === 0 ? 1 : 0 }));
const errors = [];
page.on('pageerror', e => errors.push(e.message));
// UI-only preview of the booking sheet, without creating real school credentials.
await context.route('**/school/SchoolContext.tsx*', async route => {
  const response = await route.fetch();
  const source = await response.text();
  assert.ok(source.includes('canUse: Boolean(current?.status.linked && current.keyOk)'));
  await route.fulfill({ response, body: source.replace('canUse: Boolean(current?.status.linked && current.keyOk)', 'canUse: true') });
});
await context.route('**/api/**', async route => {
  const p = new URL(route.request().url()).pathname.replace(/^\/api/, '');
  let body = [];
  if (p === '/auth/me') body = { id: 1, name: '김상상', username: 'review' };
  else if (p === '/meetings/1') body = { id: 1, name: '팀원 선택 검토', code: '2048', ownerId: 1, members };
  else if (p === '/meetings/1/timetable') body = members.map((m, i) => ({ id: i + 1, day: 1, startMin: 600, endMin: 720, title: '수업', memberId: m.id, repeatKind: 'weekly' }));
  else if (p === '/school/link') body = { linked: true, canUse: true, storage: 'server' };
  else if (p.endsWith('/free-slots')) body = [{ day: 1, start: 540, end: 720 }, { day: 2, start: 600, end: 720 }];
  else if (p === '/lounge/me') body = { needsProfile: false, profile: { userId: '1', nickname: '상상', avatarColor: 'm1', department: '디자인학부', studentYear: '24', temperature: 36.5, banned: false } };
  else if (p.startsWith('/lounge/')) body = { gatherings: [], blocked: [] };
  await route.fulfill({ json: body });
});
async function positions(selector) {
  return page.locator(selector).evaluateAll(nodes => nodes.map(n => {
    const r = n.getBoundingClientRect();
    const origin = nodes[0].getBoundingClientRect();
    return [r.x - origin.x, r.y - origin.y, r.width, r.height].map(v => Math.round(v * 10) / 10);
  }));
}
try {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (const [width, text] of [[1280, 10], [390, 10], [320, 20]]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`${BASE}/meetings/1`, { waitUntil: 'networkidle' });
    await page.evaluate(size => document.documentElement.style.fontSize = `${size}px`, text);
    await page.locator('.mtg-chip').first().waitFor();
    for (const contrast of ['normal', 'high']) {
      await page.evaluate(value => document.documentElement.dataset.contrast = value, contrast);
      const before = await positions('.mtg-chip');
      await page.locator('.mtg-chip').first().click();
      await page.waitForTimeout(200);
      assert.deepEqual(await positions('.mtg-chip'), before, `Chip moved: ${width}/${contrast}`);
      assert.equal((await horizontalOverflow(page)).overflow, false);
      await shot(page, `selection-${width}-${contrast}`, { full: true });
      await page.locator('.mtg-chip').first().click();
    }
    if (width === 1280) {
      // Preview the proposed token without changing the production palette.
      await page.evaluate(() => document.documentElement.style.setProperty('--m-5', '#0f766e'));
      await shot(page, 'selection-proposed-teal', { full: true });
      console.log('Teal comparison:', await page.locator('.mtg-legend__dot').evaluateAll(nodes => nodes.map(n => getComputedStyle(n).backgroundColor)));
      await page.evaluate(() => document.documentElement.style.removeProperty('--m-5'));
    }
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${BASE}/meetings/1`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: '회의 예약하기', exact: true }).click();
  const slots = page.locator('.mtg-slot');
  await slots.first().waitFor();
  const before = await positions('.mtg-slot');
  await slots.nth(1).click();
  await page.waitForTimeout(200);
  assert.deepEqual(await positions('.mtg-slot'), before);
  await shot(page, 'selection-booking-time', { full: true });
  await page.getByRole('button', { name: '다음', exact: true }).click();
  await page.locator('.mtg-date').first().waitFor();
  const dates = await positions('.mtg-date');
  await page.locator('.mtg-date').last().click();
  await page.waitForTimeout(200);
  assert.deepEqual(await positions('.mtg-date'), dates);
  await shot(page, 'selection-booking-date', { full: true });
  await page.goto(`${BASE}/lounge/meetup`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: '미팅 자리 만들기' }).click();
  await shot(page, 'selection-lounge-create', { full: true });
  assert.equal((await horizontalOverflow(page)).overflow, false);
  assert.deepEqual(errors, []);
  console.log('Selection geometry, normal/high contrast, booking and lounge: PASS');
} finally { await browser.close(); }
