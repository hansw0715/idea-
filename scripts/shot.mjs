// 사용: node scripts/shot.mjs <경로> <저장이름> [--user=admin1] [--width=390] [--height=844] [--full] [--zoom=1.3] [--contrast=high] [--click="버튼 이름"]
// 예)  node scripts/shot.mjs /timetable timetable --user=admin1 --full
import { BASE, launch, login, shot, horizontalOverflow } from './lib.mjs';

const args = process.argv.slice(2);
const [rawRoute = '/', name = 'shot'] = args.filter((a) => !a.startsWith('--'));
// Git Bash 는 "/" 로 시작하는 인자를 "C:/Program Files/Git/" 으로 바꿔 버린다. 그 경우도 복원한다.
// 경로는 'timetable' 처럼 앞의 / 없이 써도 된다. ('home' 또는 빈 값 = 홈)
const route =
  '/' +
  rawRoute
    .replace(/^[A-Za-z]:[\/]Program Files[\/]Git[\/]?/, '')
    .replace(/^\/+/, '')
    .replace(/^home$/, '');
const opt = Object.fromEntries(
  args
    .filter((a) => a.startsWith('--'))
    .map((a) => {
      const [k, v = 'true'] = a.slice(2).split('=');
      return [k, v];
    }),
);

const { browser, context, page } = await launch({
  width: Number(opt.width ?? 390),
  height: Number(opt.height ?? 844),
});

try {
  if (opt.user !== 'none') await login(page, opt.user ?? 'admin1');
  if (opt.zoom || opt.contrast) {
    await context.addInitScript(
      ({ zoom, contrast }) => {
        localStorage.setItem(
          'sangsang-booke-display',
          JSON.stringify({ zoom: Number(zoom ?? 1), contrast: contrast ?? 'normal' }),
        );
      },
      { zoom: opt.zoom, contrast: opt.contrast },
    );
  }
  await page.goto(`${BASE}${route}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(Number(opt.wait ?? 1200));
  if (opt.click) {
    await page.getByRole('button', { name: opt.click }).first().click();
    await page.waitForTimeout(800);
  }
  const file = await shot(page, name, { full: Boolean(opt.full) });
  const overflow = await horizontalOverflow(page);
  console.log('saved:', file);
  console.log('overflow:', JSON.stringify(overflow));
} finally {
  await browser.close();
}
