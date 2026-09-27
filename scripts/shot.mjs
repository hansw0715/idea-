// 로그인 상태로 페이지를 캡처해 PNG로 저장한다.
// 사용: node scripts/shot.mjs <이메일> <경로> <저장파일> [높이]
import { chromium } from 'playwright';

const [email, path, out, height = '2400'] = process.argv.slice(2);
if (!email || !path || !out) {
  console.error('사용법: node scripts/shot.mjs <email> <path> <out.png> [height]');
  process.exit(1);
}

const BASE = 'http://localhost:5173';

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1000, height: Number(height) },
  deviceScaleFactor: 2,
});

await page.goto(BASE, { waitUntil: 'domcontentloaded' });
const status = await page.evaluate(async (mail) => {
  const r = await fetch('/api/auth/login', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: mail, password: 'test1234!' }),
  });
  return r.status;
}, email);
if (status !== 200) {
  console.error('로그인 실패:', status);
  await browser.close();
  process.exit(1);
}

await page.goto(BASE + path, { waitUntil: 'networkidle' });
await page.waitForTimeout(2500);

// 예약 패널이 있으면 펼쳐서 시설 목록까지 담는다.
const openBtn = page.getByRole('button', { name: '회의 예약', exact: true });
if (await openBtn.count()) {
  await openBtn.first().click();
  await page.waitForTimeout(4000);
}

await page.screenshot({ path: out, fullPage: true });
console.log('저장:', out);
await browser.close();
