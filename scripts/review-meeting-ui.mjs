import { createRequire } from 'node:module';
import { webcrypto } from 'node:crypto';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const baseline = process.argv.includes('--before');
const out = new URL('../.tmp/meeting-ui/', import.meta.url);
await fs.mkdir(out, { recursive: true });
const user = { id: 90001, username: 'meeting-preview', name: '박민재' };
const members = [{ id: user.id, name: user.name, isOwner: 1 }, { id: 90002, name: '이윤수', isOwner: 0 }];
const meeting = { id: 1, name: '캡스톤 회의', code: '1682', ownerId: user.id, createdAt: '2026-10-27', members };
const classes = [
  { id: 1, memberId: user.id, day: 1, startMin: 540, endMin: 660, title: '데이터베이스', place: '공학관 302', repeatKind: 'weekly' },
  { id: 2, memberId: 90002, day: 1, startMin: 600, endMin: 720, title: '웹 프로그래밍', place: '공학관 401', repeatKind: 'weekly' },
  { id: 3, memberId: user.id, day: 2, startMin: 780, endMin: 900, title: '캡스톤 디자인', place: '상상관 502', repeatKind: 'weekly' },
  { id: 4, memberId: 90002, day: 3, startMin: 600, endMin: 720, title: '자료구조', place: '공학관 302', repeatKind: 'weekly' },
];
const bytes = webcrypto.getRandomValues(new Uint8Array(32));
const key = await webcrypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt']);
const iv = webcrypto.getRandomValues(new Uint8Array(12));
const ct = await webcrypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode('sangsang-booke:school:v2:' + user.username) }, key, new TextEncoder().encode(JSON.stringify({ studentId: '00000000', password: 'local-preview-only' })));
const cipher = { v: 2, iv: Buffer.from(iv).toString('base64'), ct: Buffer.from(ct).toString('base64') };
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const reports = [];
async function setup(width = 390, theme = 'dark') {
  const context = await browser.newContext({ viewport: { width, height: 844 }, colorScheme: theme, locale: 'ko-KR', timezoneId: 'Asia/Seoul', serviceWorkers: 'block', reducedMotion: 'reduce', permissions: ['clipboard-read', 'clipboard-write'] });
  await context.addInitScript(({ user, raw }) => {
    const matchMedia = window.matchMedia.bind(window);
    window.matchMedia = (query) => {
      const result = matchMedia(query);
      if (query.includes('display-mode: standalone')) Object.defineProperty(result, 'matches', { value: true });
      return result;
    };
    localStorage.setItem('sangsang-booke:use-web', '1');
    localStorage.setItem('sangsang-booke-user', JSON.stringify(user));
    localStorage.setItem('sangsang-booke:school-key:' + user.id, raw);
  }, { user, raw: Buffer.from(bytes).toString('base64') });
  const page = await context.newPage();
  page.setDefaultTimeout(12000);
  console.log('Opening fixture', width, theme);
  await page.clock.install({ time: new Date('2026-10-27T04:00:00Z') });
  const state = { members: [...members], entries: [...classes], freeFailure: false, empty: false, delay: 0, requests: [], facilityRequests: [], submissions: [], submitFailure: false, reservations: [] };
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    const p = url.pathname.slice(4);
    let body = {}, status = 200;
    if (p === '/auth/me') body = user;
    else if (p === '/school/link') body = { linked: true, cipher, hint: '***000', linkedAt: '2026-10-27', profileHint: null };
    else if (p === '/meetings/1') body = { ...meeting, members: [...state.members] };
    else if (p === '/meetings/1/timetable') body = [...state.entries];
    else if (p === '/reservations/meeting/1') body = [...state.reservations];
    else if (p === '/meetings/1/free-slots') {
      state.requests.push(url.searchParams.get('members'));
      const ids = (url.searchParams.get('members') ?? '').split(',').map(Number);
      const excluded = !ids.includes(90002);
      body = state.empty ? [] : [
        { day: 1, start: excluded ? 660 : 720, end: 1080 },
        { day: 2, start: 540, end: 780 },
        { day: 3, start: 720, end: 1080 },
      ];
      if (state.freeFailure) { status = 503; body = { error: '연결을 확인한 뒤 다시 시도해 주세요.' }; }
      if (state.delay) await new Promise(r => setTimeout(r, state.delay));
    } else if (p === '/facilities') { state.facilityRequests.push(Object.fromEntries(url.searchParams)); body = { facilities: [{ id: 1, name: '상상관 스터디룸', building: '상상관', minCapacity: 1, capacity: 6, available: true, systemLabel: '상상베이스', description: null }], campusStatus: 'ok' }; }
    else if (p === '/reservations' && route.request().method() === 'POST') {
      const data = route.request().postDataJSON();
      state.submissions.push(data);
      if (state.submitFailure) { status = 409; body = { error: '다른 예약이 생겼습니다. 시간을 다시 선택해 주세요.' }; }
      else { body = { ...data, id: 10, facilityName: '시설 없이', building: '', meetingName: meeting.name, userId: user.id, userName: user.name }; state.reservations.push(body); }
    } else if (p === '/meetings') body = [{ ...meeting, memberCount: state.members.length }];
    else if (p === '/timetable') body = [];
    else if (p === '/lounge/me') body = { profile: null, needsProfile: true, isAdmin: false };
    await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  });
  await page.goto((process.env.MEETING_UI_URL ?? 'http://127.0.0.1:5273') + '/meetings/1');
  await page.getByRole('heading', { name: meeting.name }).waitFor().catch(async e => {
    console.log('Fixture error:', errors, (await page.locator('body').innerText()).slice(0, 1700));
    throw e;
  });
  await page.waitForFunction(() => !document.querySelector('.mtg-result'));
  return { context, page, state, errors };
}
async function shot(page, name) {
  await page.screenshot({ path: new URL(name + '.png', out).pathname.replace(/^\//, ''), fullPage: false });
}
async function checkLayout(page) {
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'horizontal overflow');
  const dialog = page.getByRole('dialog', { name: '회의 예약', exact: true });
  if (await dialog.count()) {
    const foot = await dialog.locator(':scope > .sheet__foot').boundingBox();
    assert(foot && foot.y + foot.height <= 845, 'footer remains visible');
  }
}
async function dragRange(page, dialog, day, startMin, endMin) {
  await dialog.locator(':scope > .sheet__body').evaluate(el => { el.scrollTop = 0; });
  const column = dialog.locator('.tt-col').nth(day);
  let box = await column.boundingBox();
  assert(box);
  const footer = await dialog.locator(':scope > .sheet__foot').boundingBox();
  const finish = box.y + box.height * (endMin - 540 - 5) / 780;
  if (footer && finish > footer.y - 12) {
    await dialog.locator(':scope > .sheet__body').evaluate((el, offset) => el.scrollBy(0, offset), finish - footer.y + 24);
    box = await column.boundingBox();
  }
  const x = box.x + box.width / 2;
  await page.mouse.move(x, box.y + box.height * (startMin - 540 + 5) / 780);
  await page.mouse.down();
  await page.mouse.move(x, box.y + box.height * (endMin - 540 - 5) / 780, { steps: 10 });
  await page.mouse.up();
}
try {
  const a = await setup();
  const grid = a.page.locator('#mtg-tt-title').locator('..').locator('..').locator('.tt-grid');
  assert.equal(await grid.locator('.tt-entry').count(), 3);
  await a.page.locator('.mtg-members').getByRole('button', { name: /이윤수/ }).click();
  assert.equal(await grid.locator('.tt-entry').count(), 2);
  a.state.members.push({ id: 90003, name: '김한성', isOwner: 0 });
  a.state.entries.push({ id: 5, memberId: 90003, day: 1, startMin: 780, endMin: 840, title: '새 팀원 수업', repeatKind: 'weekly' });
  await a.page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await a.page.locator('.mtg-members').getByRole('button', { name: '김한성', exact: true }).waitFor();
  assert.equal(await a.page.locator('.mtg-members').getByRole('button', { name: /이윤수/ }).getAttribute('aria-pressed'), 'false');
  a.state.members = [...members]; a.state.entries = [...classes];
  await a.page.reload();
  await a.page.waitForFunction(() => !document.querySelector('.mtg-result'));
  await shot(a.page, 'meeting-after');
  await a.page.getByRole('button', { name: '회의 예약하기', exact: true }).click();
  const dialog = a.page.getByRole('dialog', { name: '회의 예약', exact: true });
  await dialog.locator('.tt-col.is-selectable').first().waitFor();
  await checkLayout(a.page);
  assert.equal(await dialog.locator('.stepper__step').count(), 3);
  assert.equal(await dialog.getByRole('combobox').count(), 0);
  assert.equal(await dialog.getByText('빈 시간 목록', { exact: true }).count(), 0);
  assert.equal(await dialog.getByRole('button', { name: '날짜 선택', exact: true }).count(), 0);
  assert.equal(await dialog.locator('.tt-entry--meeting').evaluateAll(nodes => nodes.every(node => node.textContent.trim() === '')), true);
  await dialog.getByRole('button', { name: /팀원 일정, 화요일/ }).click();
  const overlapInfo = a.page.getByRole('dialog', { name: '팀원 일정', exact: true });
  await overlapInfo.getByRole('list', { name: '겹치는 일정' }).waitFor();
  assert.equal(await overlapInfo.locator('.tt-overlap-details > li').count(), 2);
  assert.match(await overlapInfo.innerText(), /박민재/);
  assert.match(await overlapInfo.innerText(), /이윤수/);
  await overlapInfo.getByRole('button', { name: '닫기', exact: true }).last().click();
  await overlapInfo.waitFor({ state: 'hidden' });
  // The date comes from this exact week's Tuesday column, without another date screen.
  await dragRange(a.page, dialog, 1, 840, 960);
  assert.match(await dialog.locator('.mtg-foot__hint').innerText(), /10월 27일.*14:00.*16:00/);
  await shot(a.page, 'booking-after');
  await dialog.getByRole('button', { name: '시설 선택', exact: true }).click();
  await dialog.getByRole('heading', { name: '시설 선택', exact: true }).waitFor();
  assert.equal(a.state.facilityRequests.at(-1).date, '2026-10-27');
  await dialog.getByRole('button', { name: /시설 없이 예약하기/ }).click();
  await dialog.getByRole('button', { name: '예약 확인', exact: true }).click();
  assert.equal(await dialog.locator('[aria-current="step"]').innerText(), '3\n확인');
  await shot(a.page, 'booking-confirm');
  a.state.submitFailure = true;
  await dialog.getByRole('button', { name: '예약하기', exact: true }).click();
  await dialog.getByText('예약하지 못했습니다.', { exact: true }).waitFor();
  assert.equal(a.state.submissions.length, 1);
  assert.equal(await dialog.getByRole('button', { name: '예약하기', exact: true }).evaluate(el => el === document.activeElement), true);
  a.state.submitFailure = false;
  await dialog.getByRole('button', { name: '예약하기', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
  assert.deepEqual(a.state.submissions.at(-1).memberIds, [90001, 90002]);
  assert.equal(a.state.submissions.at(-1).date, '2026-10-27');
  assert.equal(a.state.submissions.at(-1).startMin, 840);
  assert.equal(a.state.submissions.at(-1).endMin, 960);
  assert.deepEqual(a.errors, []);
  await a.context.close();
  reports.push('three-step booking, removed lists/inputs/date step, exact grid date and range in facility request and reservation, submit failure/retry/focus');

  for (const [width, theme] of [[360, 'dark'], [390, 'light'], [1280, 'light']]) {
    const b = await setup(width, theme);
    await b.page.getByRole('button', { name: '회의 예약하기', exact: true }).click();
    const d = b.page.getByRole('dialog', { name: '회의 예약', exact: true });
    await d.locator('.tt-col.is-selectable').first().waitFor();
    // Past times cannot silently turn into the following week's same weekday.
    await dragRange(b.page, d, 1, 720, 780);
    await d.getByText('이미 지난 시간입니다.', { exact: false }).waitFor();
    assert.equal(await d.getByRole('button', { name: '시설 선택', exact: true }).isDisabled(), true);
    await dragRange(b.page, d, 1, 840, 960);
    assert.equal(await d.getByRole('button', { name: '시설 선택', exact: true }).isEnabled(), true);
    await d.getByRole('button', { name: '다음 주', exact: true }).click();
    assert.equal(await d.getByRole('button', { name: '시설 선택', exact: true }).isDisabled(), true);
    await d.locator('.tt-col.is-selectable').first().waitFor();
    await dragRange(b.page, d, 1, 840, 960);
    assert.match(await d.locator('.mtg-foot__hint').innerText(), /11월 3일.*14:00.*16:00/);
    await d.getByRole('button', { name: '시설 선택', exact: true }).click();
    await d.getByRole('heading', { name: '시설 선택', exact: true }).waitFor();
    assert.equal(b.state.facilityRequests.at(-1).date, '2026-11-03');
    await d.getByRole('button', { name: '이전', exact: true }).click();
    await d.getByRole('button', { name: /참여 인원 변경/ }).click();
    await d.locator('.mtg-members').getByRole('button', { name: /이윤수/ }).click();
    await b.page.waitForFunction(() => !document.querySelector('[aria-busy="true"]'));
    assert.equal(await d.locator('.tt-entry').count(), 2);
    assert.equal(b.state.requests.at(-1), '90001');
    assert.equal(await d.getByRole('button', { name: '시설 선택', exact: true }).isDisabled(), true);
    await dragRange(b.page, d, 1, 840, 960);
    b.state.delay = 400;
    await d.locator('.mtg-members').getByRole('button', { name: /이윤수/ }).click();
    assert.equal(await d.getByRole('button', { name: '시설 선택', exact: true }).isDisabled(), true);
    await d.locator('.mtg-members').getByRole('button', { name: /박민재/ }).click();
    await d.locator('.mtg-members').getByRole('button', { name: /이윤수/ }).click();
    assert.equal(await d.locator('.tt-entry').count(), 0);
    await d.locator('.mtg-members').getByRole('button', { name: /박민재/ }).click();
    b.state.freeFailure = true;
    await d.locator('.mtg-members').getByRole('button', { name: /이윤수/ }).click();
    await d.getByText('빈 시간을 불러오지 못했습니다.', { exact: true }).waitFor();
    b.state.freeFailure = false; b.state.empty = true;
    await d.getByRole('button', { name: '다시 시도하기' }).click();
    await d.getByText('함께 비는 시간이 없습니다.', { exact: false }).waitFor();
    await checkLayout(b.page);
    await b.page.keyboard.press('Escape');
    await d.waitFor({ state: 'hidden' });
    assert.equal(await b.page.getByRole('button', { name: '회의 예약하기', exact: true }).evaluate(el => el === document.activeElement), true);
    assert.deepEqual(b.errors, []);
    reports.push(width + 'px ' + theme + ': drag ranges, past time blocked, next-week exact date, member edits/reset, error/retry/empty, layout, Escape/focus');
    await b.context.close();
  }
  await fs.writeFile(new URL('verification.json', out), JSON.stringify(reports, null, 2));
  console.log(JSON.stringify({ passed: reports }, null, 2));
} finally { await browser.close(); }
