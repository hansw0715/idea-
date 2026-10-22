// Visual review with isolated sample API responses; never writes to the server.
import { launch, shot, horizontalOverflow, BASE } from './lib.mjs';
const user = { id: 1, username: 'design-review', name: '김상상' };
const meetings = [{ id: 1, name: '졸업 전시 준비', code: '2048', ownerId: 1, memberCount: 3, createdAt: '2026-10-20' }, { id: 2, name: '서비스 디자인 스터디', code: '5612', ownerId: 2, memberCount: 4, createdAt: '2026-10-20' }];
const reservations = [{ id: 1, date: '2026-10-23', startMin: 840, endMin: 960, facilityId: 1, facilityName: '그룹 스터디룸 3', building: '학술정보관', meetingId: 1, meetingName: meetings[0].name, userId: 1, userName: user.name, schoolStatus: 'planned' }];
const timetable = [{ id: 1, day: 1, startMin: 600, endMin: 720, title: '서비스 디자인', place: '상상관 305', repeatKind: 'weekly' }];
const members = ['김상상', '이한성', '박디자인', '정기획', '최개발'].map((name, i) => ({ id: i + 1, name, isOwner: i === 0 ? 1 : 0 }));
const { browser, context, page } = await launch();
const errors = [];
const overflows = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', message => { if (message.type() === 'error' && message.text().includes('TypeError:')) errors.push(message.text()); });
await context.route('**/api/**', async route => {
  const p = new URL(route.request().url()).pathname.replace(/^\/api/, '');
  let body = [];
  if (p === '/auth/me') body = user;
  else if (p === '/dashboard') body = { meetings, reservations, timetable, weekReservations: [] };
  else if (p === '/meetings') body = meetings;
  else if (p === '/meetings/1') {
    await new Promise(resolve => setTimeout(resolve, 500));
    body = { ...meetings[0], members };
  }
  else if (p === '/meetings/1/timetable') body = members.map((m, i) => ({ ...timetable[0], id: i + 1, memberId: m.id }));
  else if (p === '/reservations/meeting/1') body = reservations;
  else if (p === '/school/link') body = { linked: false };
  else if (p === '/lounge/me') body = { needsProfile: false, profile: { userId: '1', nickname: '상상', avatarColor: 'm1', department: '디자인학부', studentYear: '24', temperature: 36.5, banned: false } };
  else if (p.startsWith('/lounge/')) body = { gatherings: [], blocked: [] };
  await route.fulfill({ json: body });
});
try {
  // Exercise a client-side transition with both a cold lazy module and delayed data.
  await context.route('**/pages/MeetingDetail.tsx*', async route => {
    await new Promise(resolve => setTimeout(resolve, 400));
    await route.continue();
  });
  await page.goto(`${BASE}/meetings`, { waitUntil: 'networkidle' });
  await page.locator('.meet-ul a').first().click();
  await page.waitForFunction(() => document.activeElement?.matches('main h1'));
  console.log('Delayed route focus:', await page.evaluate(() => ({ text: document.activeElement.textContent, title: document.title })));
  await page.goto(`${BASE}/meetings`, { waitUntil: 'networkidle' });
  await page.locator('.meet-ul a').first().click();
  await page.locator('.loading-block').waitFor();
  await page.keyboard.press('Tab');
  const focusAfterTab = await page.evaluate(() => { window.reviewFocus = document.activeElement; return document.activeElement?.outerHTML; });
  await page.locator('main h1').waitFor();
  if (!await page.evaluate(() => document.activeElement === window.reviewFocus)) errors.push('Late content stole focus after keyboard interaction');
  console.log('Focus preserved after Tab:', focusAfterTab);
  for (const route of (process.argv.length > 2 ? process.argv.slice(2) : ['/', '/meetings', '/meetings/1', '/timetable', '/account', '/lounge'])) {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`${BASE}${route}`, { waitUntil: 'networkidle' });
    await page.evaluate(() => { document.documentElement.style.fontSize = '10px'; });
    await page.waitForTimeout(500);
    const desktop = await horizontalOverflow(page);
    console.log(route, '1280px', desktop);
    if (desktop.overflow) overflows.push(`${route}:desktop`);
    console.log('Grid columns:', await page.locator('.home-workspace, .meet-ul, .mtg-workspace, .tt-workspace').evaluateAll(nodes => nodes.map(n => ({ class: n.className, columns: getComputedStyle(n).gridTemplateColumns }))));
    await page.keyboard.press('Tab');
    await page.locator('.tabbar__item').last().focus();
    console.log('Rail focus:', await page.locator('.tabbar__item').last().evaluate(n => ({ visible: n.matches(':focus-visible'), outline: getComputedStyle(n).outline, shadow: getComputedStyle(n).boxShadow })));
    await shot(page, `redesign-desktop-${route.replaceAll('/', '-') || 'home'}`, { full: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${BASE}${route}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(500);
    await shot(page, `redesign-${route.replaceAll('/', '-') || 'home'}`, { full: true });
    console.log(route, '390px', await horizontalOverflow(page));
    if (route === '/') {
      // Desktop browser: explicitly simulate the CSS safe inset; this is not a physical iPhone test.
      await page.evaluate(() => document.documentElement.style.setProperty('--safe-bottom', '34px'));
      const inset = await page.locator('.tabbar').evaluate(n => {
        const bar = n.getBoundingClientRect();
        const indicator = n.querySelector('.tabbar__pill').getBoundingClientRect();
        return { paddingBottom: getComputedStyle(n).paddingBottom, indicatorBottom: indicator.bottom, insetTop: bar.bottom - 34 };
      });
      console.log('Simulated 34px safe inset:', inset);
      if (inset.indicatorBottom > inset.insetTop) errors.push('Tab indicator overlaps safe inset');
      await page.evaluate(() => document.documentElement.style.removeProperty('--safe-bottom'));
    }
    await page.setViewportSize({ width: 320, height: 844 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.evaluate(() => { document.documentElement.style.fontSize = '20px'; });
    await page.waitForTimeout(100);
    const expanded = await horizontalOverflow(page);
    console.log('Expanded active tab:', await page.locator('.tabbar__item[aria-current="page"]').evaluate(n => ({ width: n.clientWidth, scroll: n.scrollWidth, labelWidth: n.querySelector('.tabbar__label')?.getBoundingClientRect().width })));
    console.log(route, '320px / 200% text', expanded);
    if (expanded.overflow) overflows.push(route);
    if (expanded.overflow) console.log('Overflow elements:', await page.locator('main *').evaluateAll(nodes => nodes.filter(n => n.getBoundingClientRect().right > document.documentElement.clientWidth + 1 || n.scrollWidth > n.clientWidth + 1).map(n => ({ tag: n.tagName, class: n.className, right: Math.round(n.getBoundingClientRect().right), scroll: n.scrollWidth, width: n.clientWidth })).slice(0, 20)));
    await shot(page, `redesign-expanded-${route.replaceAll('/', '-') || 'home'}`, { full: true });
  }
  console.log('Runtime errors:', JSON.stringify(errors));
  if (errors.length || overflows.length) process.exitCode = 1;
} finally { await browser.close(); }
