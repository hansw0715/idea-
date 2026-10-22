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
  for (const [width, size] of [[1280,10],[1440,10],[390,10],[320,20],[1280,20]]) {
    await page.setViewportSize({width, height: 844});
    await page.goto(BASE, {waitUntil:'networkidle'});
    await page.evaluate(s => document.documentElement.style.fontSize = s + 'px', size);
    await page.waitForTimeout(400);
    assert.equal((await horizontalOverflow(page)).overflow, false);
    const layout = await page.evaluate(() => {
      const box = s => { const r = document.querySelector(s).getBoundingClientRect(); return {x:r.x,y:r.y,bottom:r.bottom,width:r.width}; };
      return {lecture:box('.home-area--eclass'),agenda:box('.home-agenda'),res:box('.home-area--res'),meet:box('.home-area--meet'),open:document.querySelector('.home-area--meet').open};
    });
    console.log(width,size,JSON.stringify(layout));
    if (width >=1280 && size===10) {
      assert.ok(layout.agenda.x > layout.lecture.x + layout.lecture.width);
      assert.ok(layout.open);
      assert.ok(layout.meet.y-layout.res.bottom <40);
    } else { assert.ok(layout.res.y >= layout.lecture.bottom); assert.equal(layout.open,false); }
    await shot(page,'home-columns-'+width+'-'+size,{full:true});
    await page.locator('.home-area--res > .btn').click();
    assert.equal(await page.locator('.home-reservations > li').count(),6);
    await page.locator('.home-area--res > .btn').click();
  }
  assert.deepEqual(errors,[]);
  console.log('Home responsive layout and reservation controls: PASS');
} finally { await browser.close(); }
