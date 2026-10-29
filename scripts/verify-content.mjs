// Runs /verify.html in headless Chromium against a running dev server (npm run dev).
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
const base = process.env.URL ?? 'http://localhost:5173';
const only = process.argv[2] ? `?only=${encodeURIComponent(process.argv[2])}` : '';
const browser = await chromium.launch();
const page = await browser.newPage();
page.on('pageerror', (e) => console.error('PAGEERROR', e.message));
await page.goto(`${base}/verify.html${only}`);
await page.waitForFunction(() => /VERIFY: (PASSED|FAILED|CRASHED)/.test(document.getElementById('out')?.textContent ?? ''), null, { timeout: 300000 });
const text = await page.textContent('#out');
console.log(text);
await browser.close();
process.exit(/VERIFY: PASSED/.test(text) ? 0 : 1);
