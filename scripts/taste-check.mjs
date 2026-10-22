import fs from 'node:fs';
import { launch, login, BASE, horizontalOverflow } from './lib.mjs';
import { probe, layout, app } from '../.taste-skill-src/scripts/lib/probe.mjs';
import { judge, judgeLayout, judgeApp, APP_SKIP } from '../.taste-skill-src/scripts/lib/rules.mjs';

// Use the project's working Playwright transport with the skill's own probes and rules.
const out = '.taste-skill/after';
fs.mkdirSync(out, { recursive: true });
const { browser, context, page } = await launch({ dsf: 1, touch: false });
const results = [];
try {
  await login(page);
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(600);
    const m = await page.evaluate(probe);
    const l = await page.evaluate(layout);
    const a = await page.evaluate(app);
    const findings = [
      ...judge(m, { width }).filter(f => !APP_SKIP.has(f.id) && f.id !== 'small-title'),
      ...judgeLayout(l, { width }).filter(f => !APP_SKIP.has(f.id) && f.id !== 'small-title'),
      ...judgeApp(a, m, { width }),
    ];
    await page.screenshot({ path: `${out}/${width}.png`, fullPage: true });
    results.push({ width, findings, overflow: await horizontalOverflow(page), metrics: m, app: a });
    console.log(width, JSON.stringify(findings));
  }
  await page.goto(`${BASE}/meetings`, { waitUntil: 'networkidle' });
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.locator('.tabbar__item[href="/"]').click();
  const positions = [];
  for (let i = 0; i < 12; i++) {
    positions.push(await page.locator('.tabbar__pill').evaluate(el => ({ y: el.getBoundingClientRect().top, transform: getComputedStyle(el).transform })));
    await page.waitForTimeout(20);
  }
  fs.writeFileSync(`${out}/tab-motion.json`, JSON.stringify(positions, null, 2));
  for (const route of ['/timetable', '/meetings', '/lounge', '/account']) {
    await page.goto(`${BASE}${route}`, { waitUntil: 'networkidle' });
    console.log(route, await page.locator('#main').count(), JSON.stringify(await horizontalOverflow(page)));
  }
} finally {
  fs.writeFileSync(`${out}/report.json`, JSON.stringify(results, null, 2));
  await context.close();
  await browser.close();
}
