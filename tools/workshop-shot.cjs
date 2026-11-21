// Usage: node tools/workshop-shot.cjs [output-dir]   (needs Playwright; Chromium; the vendored desktop/vendor/three stands in for the CDN copy)
// Serves the repository to a headless browser through request interception (no server process), opens the Viewer's workshop dialog, expands a work's details and screenshots it.
const { chromium } = require('playwright'); const fs = require('node:fs'), path = require('node:path');
const ROOT = path.resolve(__dirname, '..'), ORIGIN = 'http://localhost:8765', OUT = process.argv[2] || 'docs/images';
const TYPES = { '.html': 'text/html', '.mjs': 'text/javascript', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.glow': 'application/json', '.jpg': 'image/jpeg', '.png': 'image/png', '.cif': 'text/plain', '.svg': 'image/svg+xml' };
(async () => {
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const context = await browser.newContext({ viewport: { width: 1100, height: 900 }, deviceScaleFactor: 1 });
  await context.route('**/*', (route) => {
    const url = new URL(route.request().url());
    const cdn = /^https:\/\/cdn\.jsdelivr\.net\/npm\/three@0\.160\.0\/(.+)$/.exec(url.href);   // the same Three.js version, from the vendored copy
    if (cdn) { const f = path.join(ROOT, 'desktop/vendor/three', cdn[1]); return fs.existsSync(f) ? route.fulfill({ status: 200, contentType: 'text/javascript', body: fs.readFileSync(f) }) : route.abort(); }
    if (url.origin !== ORIGIN) { console.log('ABORT', url.href.slice(0, 120)); return route.abort(); }
    const file = path.join(ROOT, decodeURIComponent(url.pathname));
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { console.log('404', url.pathname); return route.fulfill({ status: 404, body: 'not found' }); }
    route.fulfill({ status: 200, contentType: TYPES[path.extname(file)] ?? 'application/octet-stream', body: fs.readFileSync(file) });
  });
  const page = await context.newPage(); const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(ORIGIN + '/apps/viewer-web/index.html?startup=skip');
  try { await page.waitForFunction(() => window.glow, null, { timeout: 20000 }); } catch (e) { console.log('boot failed; errors:', errors, 'status:', await page.$eval('#status', (n) => n.textContent).catch(() => '?')); process.exit(1); }
  const open = await page.$('#workshop');
  if (!open) { console.log('no #workshop button; buttons:', await page.$$eval('button', (b) => b.map((x) => x.id).filter(Boolean).slice(0, 60))); process.exit(1); }
  await open.click();
  await page.waitForSelector('.workshop-card', { timeout: 15000 });
  await page.click('#workshop-tab-works');
  await page.waitForSelector('.workshop-card');
  const first = await page.$('.workshop-card .workshop-more'); await first.click();
  await page.waitForSelector('.workshop-details');
  const text = await page.$eval('.workshop-details', (n) => n.innerText);
  console.log(text);
  await page.screenshot({ path: path.join(OUT, 'workshop-details.png') });
  await page.click('#workshop-tab-resources'); await page.waitForSelector('.workshop-card'); await (await page.$('.workshop-card .workshop-more')).click();
  console.log('--- resource ---\n' + await page.$eval('.workshop-card .workshop-details', (n) => n.innerText));
  await page.setViewportSize({ width: 390, height: 800 }); await page.screenshot({ path: path.join(OUT, 'workshop-details-narrow.png') });
  console.log('errors:', errors.slice(0, 5)); await browser.close();
})().catch((e) => { console.error(e.message); process.exit(1); });
