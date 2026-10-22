// Read-only UI fixtures: no school or account mutations.
import assert from 'node:assert/strict';
import { launch, shot, horizontalOverflow, BASE } from './lib.mjs';
const { browser, context, page } = await launch();
const errors = [];
page.on('pageerror', e => errors.push(e.message));
const meetings = Array.from({ length: 18 }, (_, i) => ({ id: i + 1, name: `디자인 스터디 ${i + 1}`, code: '2048', ownerId: 1, memberCount: 3 }));
const reservations = Array.from({ length: 6 }, (_, i) => ({ id: i + 1, date: '2026-10-24', startMin: 840, endMin: 900, facilityId: 1, facilityName: '스터디룸 3', building: '학술정보관', meetingId: 1, meetingName: meetings[0].name, userId: 1, schoolStatus: 'planned' }));
await context.addInitScript(() => {
  localStorage.setItem('sangsang-booke:eclass:1', JSON.stringify({
    syncedAt: new Date().toISOString(), courseCount: 3, warnings: [],
    items: Array.from({ length: 5 }, (_, i) => ({ id: String(i), courseId: '1', courseName: '서비스 디자인', title: `${i + 1}차시 사용자 조사`, kind: i === 4 ? 'assignment' : 'lecture', url: 'https://learn.hansung.ac.kr/', completion: 'pending', attendance: 'unknown', dueAt: new Date(Date.now() + 86400000).toISOString(), availableAt: null, progress: 0 })),
  }));
});
await context.route('**/api/**', async route => {
  const p = new URL(route.request().url()).pathname.replace(/^\/api/, '');
  let body = [];
  if (p === '/auth/me') body = { id: 1, name: '김상상', username: 'review' };
  else if (p === '/dashboard') body = { meetings, reservations };
  else if (p === '/meetings') body = meetings;
  else if (p === '/meetings/1') body = { ...meetings[0], members: [{ id: 1, name: '김상상', isOwner: 1 }] };
  else if (p === '/reservations/meeting/1') body = reservations;
  else if (p === '/school/link') body = { linked: true, cipher: null, hint: '***123' };
  else if (p === '/lounge/me') body = { needsProfile: false, profile: { userId: '1', nickname: '상상', avatarColor: 'm1', department: '디자인학부', studentYear: '24', temperature: 36.5, banned: false } };
  else if (p.startsWith('/lounge/')) body = { gatherings: [], blocked: [] };
  await route.fulfill({ json: body });
});
try {
  for (const [width, size] of [[390, 10], [320, 20], [1280, 10]]) {
    if (process.env.REVIEW_WIDTH && width !== Number(process.env.REVIEW_WIDTH)) continue;
    await page.setViewportSize({ width, height: 844 });
    for (const route of ['/', '/meetings/1', '/account']) {
      await page.goto(`${BASE}${route}`, { waitUntil: 'networkidle' });
      await page.evaluate(s => document.documentElement.style.fontSize = `${s}px`, size);
      await page.waitForTimeout(350);
      if ((await horizontalOverflow(page)).overflow) console.log('Overflow nodes', await page.locator('body *').evaluateAll(nodes => nodes.filter(n => n.getBoundingClientRect().right > document.documentElement.clientWidth + 1).map(n => ({ tag: n.tagName, class: n.className, right: n.getBoundingClientRect().right, width: n.getBoundingClientRect().width })).slice(0, 20)));
      assert.equal((await horizontalOverflow(page)).overflow, false, `Overflow ${route}/${width}`);
      if (route === '/') {
        assert.equal(await page.locator('.home-reservations > li').count(), 1);
        assert.equal(await page.locator('.school-eclass__item').count(), 1);
        const bounds = await page.evaluate(() => ({ tally: document.querySelector('.school-eclass__tally').getBoundingClientRect().bottom, reservation: document.querySelector('.home-area--res').getBoundingClientRect().bottom, bar: document.querySelector('.tabbar').getBoundingClientRect().top }));
        console.log('First screen', width, size, bounds);
        if (width === 390) assert.ok(bounds.reservation <= bounds.bar, 'Next reservation below tab bar');
        await shot(page, `compact-initial-${width}`);
        await page.getByRole('button', { name: /미제출 과제/ }).click();
        assert.match(await page.locator('.school-eclass__title').innerText(), /5차시/);
        await page.getByRole('button', { name: /이번 주 완료 보기/ }).click();
        assert.equal(await page.locator('.school-eclass__item').count(), 0);
        await page.getByRole('button', { name: /미완료 보기/ }).click();
        assert.equal(await page.locator('.school-eclass__item').count(), 1);
        await page.getByRole('button', { name: /미수강 강의/ }).click();
        await page.getByRole('button', { name: '예약 5건 더 보기' }).click();
        assert.equal(await page.locator('.home-reservations > li').count(), 6);
        await page.getByRole('button', { name: '예약 접기' }).click();
        await page.locator('.home-area--meet > summary').focus();
        await page.keyboard.press('Enter');
        assert.ok(await page.locator('.home-area--meet').getAttribute('open') !== null);
      }
      if (route === '/meetings/1') {
        assert.equal(await page.locator('.mtg-res-list > li').count(), 1);
        assert.ok(await page.locator('.mtg-workspace').evaluate(n => n.firstElementChild.classList.contains('mtg-workspace-reservations')));
        await page.getByRole('button', { name: '예약 5건 더 보기' }).click();
        assert.equal(await page.locator('.mtg-res-list > li').count(), 6);
        await page.getByRole('button', { name: '예약 접기' }).click();
      }
      await shot(page, `compact-${width}-${route.replaceAll('/', '-') || 'home'}`, { full: true });
    }
    // Measure the moving indicator on every frame during a scroll-to-top route change.
    for (const source of ['/', '/meetings']) {
      await page.goto(`${BASE}${source}`, { waitUntil: 'networkidle' });
      if (source === '/') await page.getByRole('button', { name: '예약 5건 더 보기' }).click();
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      await page.waitForTimeout(150);
      assert.ok(await page.evaluate(() => window.scrollY > 0));
      await page.evaluate(() => {
        window.indicatorFrames = [];
        const until = performance.now() + 700;
        const sample = () => {
          const nav = document.querySelector('.tabbar').getBoundingClientRect();
          document.querySelectorAll('.tabbar__pill').forEach(n => {
            const r = n.getBoundingClientRect();
            window.indicatorFrames.push({ top: r.top, bottom: r.bottom, navTop: nav.top, navBottom: nav.bottom });
          });
          if (performance.now() < until) requestAnimationFrame(sample);
        };
        requestAnimationFrame(sample);
      });
      await page.locator('.tabbar__item[href="/account"]').click();
      await page.waitForTimeout(750);
      const frames = await page.evaluate(() => window.indicatorFrames);
      assert.ok(frames.length > 10);
      const escaped = frames.filter(r => r.top < r.navTop - 2 || r.bottom > r.navBottom + 2);
      console.log('Indicator scroll transition', width, source, frames.length, 'escaped:', escaped.length);
      assert.equal(escaped.length, 0, 'Indicator moved outside fixed navigation');
    }
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  assert.deepEqual(errors, []);
  console.log('Compact layout, disclosures, indicator frames and runtime: PASS');
} finally { await browser.close(); }
