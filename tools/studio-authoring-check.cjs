// Real-browser check of the Studio authoring path added in 4.5.2: the publish tab (publication block, derivation, publish check) and draft recovery (autosave, banner, restore, discard).
// Usage: node tools/studio-authoring-check.cjs [output-dir]   (needs Playwright with Chromium; no server process: the repository is served to the page by request interception,
// the vendored desktop/vendor/three stands in for the CDN copy of Three.js). Exits 1 with the failed expectation.
const { chromium } = require('playwright'); const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const ROOT = path.resolve(__dirname, '..'), ORIGIN = 'http://localhost:8765', OUT = process.argv[2] || path.join(ROOT, 'docs/images');
const TYPES = { '.html': 'text/html', '.mjs': 'text/javascript', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.glow': 'application/json', '.jpg': 'image/jpeg', '.png': 'image/png', '.cif': 'text/plain', '.svg': 'image/svg+xml' };
(async () => {
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
  await context.route('**/*', (route) => {
    const url = new URL(route.request().url()), cdn = /^https:\/\/cdn\.jsdelivr\.net\/npm\/three@0\.160\.0\/(.+)$/.exec(url.href);
    if (cdn) { const f = path.join(ROOT, 'desktop/vendor/three', cdn[1]); return fs.existsSync(f) ? route.fulfill({ status: 200, contentType: 'text/javascript', body: fs.readFileSync(f) }) : route.abort(); }
    if (url.origin !== ORIGIN) return route.abort();
    const file = path.join(ROOT, decodeURIComponent(url.pathname));
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return route.fulfill({ status: 404, body: 'not found' });
    route.fulfill({ status: 200, contentType: TYPES[path.extname(file)] ?? 'application/octet-stream', body: fs.readFileSync(file) });
  });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const open = async () => { await page.goto(ORIGIN + '/apps/studio-web/index.html'); await page.waitForSelector('#tab-publish', { timeout: 30000 }); await page.waitForTimeout(800); };
  const text = (selector) => page.$eval(selector, (n) => n.textContent), shown = (selector) => page.$eval(selector, (n) => !n.hidden);

  await open();
  assert.equal(await shown('#recovery-banner'), false, 'a fresh profile has no draft to offer');
  // the publish tab: derive from an official work (CC BY): CC0 is closed, BY and BY-SA stay open
  await page.click('#tab-publish'); await page.click('#pub-catalog');
  await page.waitForFunction(() => /已读取工坊目录/.test(document.querySelector('#pub-note').textContent), null, { timeout: 15000 });
  await page.selectOption('#pub-derived', { index: 2 });
  const licenses = await page.$$eval('#pub-license option', (o) => o.map((x) => [x.value, x.disabled]));
  assert.deepEqual(licenses, [['CC0-1.0', true], ['CC-BY-4.0', false], ['CC-BY-SA-4.0', false]]);
  await page.click('#pub-save'); assert.match(await text('#pub-note'), /作者名/, 'saving without an author says so');
  await page.fill('#pub-author', 'Tester'); await page.selectOption('#pub-topic', 'mechanism'); await page.fill('#pub-description', 'A derived lab.'); await page.click('#pub-today');
  await page.click('#pub-check'); await page.waitForTimeout(400);
  assert.match(await text('#pub-note'), /检查通过/); assert.ok((await page.$$eval('#pub-results li', (l) => l.map((x) => x.textContent))).some((t) => /证据/.test(t)), 'a scene without evidence is warned about');
  await page.screenshot({ path: path.join(OUT, 'studio-publish.png') });
  await page.selectOption('#pub-license', 'CC-BY-SA-4.0'); await page.click('#pub-check'); await page.waitForTimeout(300);
  assert.match(await text('#pub-note'), /检查通过/, 'a BY-SA derivative of a BY work passes');

  // draft recovery: the saved publication survives a reload through the autosaved draft
  await page.waitForTimeout(4000);
  await open();
  assert.equal(await shown('#recovery-banner'), true, 'the draft is offered after a reload');
  await page.click('#recovery-restore'); await page.waitForTimeout(1500); await page.click('#tab-publish');
  assert.equal(await page.$eval('#pub-author', (n) => n.value), 'Tester'); assert.equal(await page.$eval('#pub-description', (n) => n.value), 'A derived lab.');
  assert.equal(await page.$eval('#pub-license', (n) => n.value), 'CC-BY-SA-4.0'); assert.match(await page.$eval('#pub-derived', (n) => n.value), /@1$/);
  await page.fill('#pub-description', 'Second draft.'); await page.click('#pub-save'); await page.waitForTimeout(4000);
  await open(); await page.click('#recovery-discard'); await page.waitForTimeout(400); await open();
  assert.equal(await shown('#recovery-banner'), false, 'a discarded draft is not offered again');
  assert.deepEqual(errors, [], 'no script errors');
  await browser.close(); console.log('ok: publish tab and draft recovery');
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
