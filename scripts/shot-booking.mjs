// 예약 흐름(드래그 → 날짜 → 시설)까지 진행한 화면을 캡처한다.
// 사용: node scripts/shot-booking.mjs <이메일> <회의id> <저장파일>
import { chromium } from 'playwright';

const [email, meetingId, out] = process.argv.slice(2);
const BASE = 'http://localhost:5173';

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1000, height: 2400 },
  deviceScaleFactor: 2,
});

await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await page.evaluate(async (mail) => {
  await fetch('/api/auth/login', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: mail, password: 'test1234!' }),
  });
}, email);

await page.goto(`${BASE}/meetings/${meetingId}`, { waitUntil: 'networkidle' });
await page.waitForTimeout(2000);
await page.getByRole('button', { name: '회의 예약', exact: true }).first().click();
await page.waitForTimeout(4000);

// 월요일 16:00~17:30 드래그
await page.evaluate(() => {
  const grid = [...document.querySelectorAll('.tt')].pop();
  const col = grid.querySelectorAll('.tt-col')[0];
  const rect = col.getBoundingClientRect();
  const yFor = (m) => rect.top + ((m - 540) / 780) * rect.height;
  const opt = (y) => ({
    bubbles: true,
    clientX: rect.left + rect.width / 2,
    clientY: y,
    pointerId: 1,
    pointerType: 'mouse',
    isPrimary: true,
  });
  col.dispatchEvent(new PointerEvent('pointerdown', opt(yFor(960))));
  col.dispatchEvent(new PointerEvent('pointermove', opt(yFor(1050))));
  col.dispatchEvent(new PointerEvent('pointerup', opt(yFor(1050))));
});
await page.waitForTimeout(1500);

// 첫 날짜 선택 → 시설 목록 로딩
await page.evaluate(() => {
  const chip = [...document.querySelectorAll('.chip')].find((c) => /\d+월 \d+일/.test(c.textContent));
  if (chip) chip.click();
});
await page.waitForTimeout(9000);

await page.screenshot({ path: out, fullPage: true });
console.log('저장:', out);
await browser.close();
