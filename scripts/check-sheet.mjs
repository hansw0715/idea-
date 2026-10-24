// npm exec playwright install webkit chromium && node scripts/check-sheet.mjs
// 실제 공용 Sheet를 API/로그인 없이 WebKit·Chromium에서 검증한다.
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { chromium, webkit } from 'playwright';

const entry = '/__sheet-check.tsx';
const server = await createServer({
  configFile: false,
  root: process.cwd(),
  server: { host: '127.0.0.1', port: 0 },
  plugins: [{
    name: 'sheet-check',
    resolveId(id) { if (id === entry) return entry; },
    load(id) {
      if (id !== entry) return;
      return `
        import React, {useState} from 'react';
        import {createRoot} from 'react-dom/client';
        import {Sheet} from '/client/src/ui/Sheet.tsx';
        import '/client/src/styles/tokens.css';
        import '/client/src/styles/base.css';
        import '/client/src/styles/components.css';
        function App() {
          const [open, setOpen] = useState(false);
          const [full, setFull] = useState(false);
          const [nested, setNested] = useState(false);
          return <div className="app-frame has-tabbar">
            <button onClick={() => {setFull(false); setOpen(true)}}>Open sheet</button>
            <button onClick={() => {setFull(true); setOpen(true)}}>Open full</button>
            <Sheet open={open} onClose={() => setOpen(false)} title="Sheet test" full={full}
              footer={<button onClick={() => setOpen(false)}>Done</button>}>
              <input aria-label="Input" />
              <button onClick={() => setNested(true)}>Open nested</button>
              {Array.from({length: 70}, (_, i) => <p key={i}>Row {i}</p>)}
              <Sheet open={nested} onClose={() => setNested(false)} title="Nested test">
                <p>Short content</p>
              </Sheet>
            </Sheet>
          </div>;
        }
        createRoot(document.getElementById('root')).render(<App />);
      `;
    },
    configureServer(s) {
      s.middlewares.use((req, res, next) => {
        if (req.url !== '/__sheet-check') return next();
        res.setHeader('Content-Type', 'text/html');
        res.end(`<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
          <div id="root"></div><script type="module" src="${entry}"></script>`);
      });
    },
  }],
  esbuild: { jsx: 'automatic' },
});

await server.listen();
const url = `http://127.0.0.1:${server.httpServer.address().port}/__sheet-check`;
try {
  for (const engine of [webkit, chromium]) {
    const browser = await engine.launch();
    try {
      for (const reducedMotion of ['no-preference', 'reduce']) {
        const page = await browser.newPage({
          viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion,
        });
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.goto(url);
        async function checkBounds(title) {
          const dialog = page.getByRole('dialog', { name: title, exact: true });
          await dialog.waitFor({ state: 'visible' });
          await page.waitForTimeout(500);
          const bounds = await dialog.boundingBox();
          assert(bounds && bounds.height > 60 && bounds.y >= -1, `${title}: missing or clipped top`);
          assert(bounds.y + bounds.height <= page.viewportSize().height + 1, `${title}: clipped bottom`);
          return dialog;
        }
        for (const name of ['Open sheet', 'Open full']) {
          await page.getByRole('button', { name, exact: true }).click();
          const dialog = await checkBounds('Sheet test');
          assert.equal(await dialog.locator('input').evaluate(el => el === document.activeElement), false);
          const body = dialog.locator(':scope > .sheet__body');
          assert(await body.evaluate(el => el.scrollHeight > el.clientHeight), 'long content must scroll');
          const done = dialog.getByRole('button', { name: 'Done', exact: true });
          const footerBounds = await done.boundingBox();
          assert(footerBounds && footerBounds.y >= 0 && footerBounds.y + footerBounds.height <= page.viewportSize().height + 1,
            'footer must be visible');
          await dialog.getByRole('button', { name: 'Open nested', exact: true }).click();
          const nested = await checkBounds('Nested test');
          await nested.getByRole('button', { name: '닫기', exact: true }).click();
          await page.waitForTimeout(500);
          assert(await dialog.evaluate(el => el.matches(':modal')), 'parent must stay modal');
          // 모바일 키보드는 layout viewport를 유지하고 visual viewport만 줄인다.
          await page.evaluate(() => {
            Object.defineProperty(visualViewport, 'height', { configurable: true, value: 460 });
            Object.defineProperty(visualViewport, 'offsetTop', { configurable: true, value: 60 });
            visualViewport.dispatchEvent(new Event('resize'));
          });
          await page.waitForTimeout(100);
          const keyboardBounds = await dialog.boundingBox();
          const keyboardFooter = await done.boundingBox();
          assert(keyboardBounds.y >= 59 && keyboardBounds.y + keyboardBounds.height <= 521,
            'sheet must fit above keyboard, including viewport offset');
          assert(keyboardFooter.y + keyboardFooter.height <= 521, 'footer must stay above keyboard');
          await page.evaluate(() => {
            delete visualViewport.height;
            delete visualViewport.offsetTop;
            visualViewport.dispatchEvent(new Event('resize'));
          });
          await page.setViewportSize({ width: 390, height: 500 });
          await checkBounds('Sheet test');
          await done.click();
          await page.waitForTimeout(500);
          assert.equal(await page.locator('dialog[open]').count(), 0);
          await page.setViewportSize({ width: 390, height: 844 });
        }
        assert.deepEqual(errors, []);
        await page.close();
        console.log(`${engine.name()} / ${reducedMotion}: open, reopen, full, nested, scroll, footer, keyboard, viewport PASS`);
      }
    } finally { await browser.close(); }
  }
} finally { await server.close(); }
