// Real-browser check of "导出发布包" in the Studio publish tab: a structure imported from a local file has no source to come back from, so the export is refused and says which asset;
// no package is offered. (The reference path itself, for RCSB-sourced structures, is covered by packages/schema/test/export-policy.test.mjs.)
// Usage: node tools/studio-export-check.cjs [structures-dir]   (the pinned fixtures: node tools/fetch-smoke-structures.mjs --dir desktop/dist/smoke-structures)
const { chromium } = require('playwright'); const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const ROOT = path.resolve(__dirname, '..'), ORIGIN = 'http://localhost:8765', FIXTURES = path.resolve(process.argv[2] || path.join(ROOT, 'desktop/dist/smoke-structures'));
const TYPES = { '.html': 'text/html', '.mjs': 'text/javascript', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.glow': 'application/json' };
(async () => {
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
  await context.route('**/*', (route) => {
    const url = new URL(route.request().url()), cdn = /^https:\/\/cdn\.jsdelivr\.net\/npm\/three@0\.160\.0\/(.+)$/.exec(url.href);
    if (cdn) { const f = [path.join(ROOT, 'desktop/vendor/three', cdn[1]), path.join(ROOT, 'desktop/node_modules/three', cdn[1])].find((file) => fs.existsSync(file)) ?? ''; return fs.existsSync(f) ? route.fulfill({ status: 200, contentType: 'text/javascript', body: fs.readFileSync(f) }) : route.abort(); }
    if (url.origin !== ORIGIN) return route.abort();
    const file = path.join(ROOT, decodeURIComponent(url.pathname));
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return route.fulfill({ status: 404, body: 'not found' });
    route.fulfill({ status: 200, contentType: TYPES[path.extname(file)] ?? 'application/octet-stream', body: fs.readFileSync(file) });
  });
  const page = await context.newPage(), errors = []; let downloads = 0;
  page.on('pageerror', (e) => errors.push(e.message)); page.on('download', () => { downloads += 1; });
  await page.goto(ORIGIN + '/apps/studio-web/index.html'); await page.waitForSelector('#tab-publish', { timeout: 30000 });
  await page.setInputFiles('#structure-file', path.join(FIXTURES, '1K4C.cif'));
  await page.waitForTimeout(6000);
  await page.waitForFunction(() => /已导入|导入/.test(document.querySelector('#status').textContent) && !/正在导入/.test(document.querySelector('#status').textContent), null, { timeout: 90000 });
  await page.click('#tab-publish');
  await page.fill('#pub-author', 'Tester'); await page.selectOption('#pub-topic', 'protein'); await page.fill('#pub-description', 'Local structure.'); await page.click('#pub-today');
  await page.click('#pub-export'); await page.waitForTimeout(800);
  const lines = await page.$$eval('#pub-results li', (l) => l.map((x) => x.textContent));
  assert.ok(lines.some((t) => /不允许嵌入.*没有可重新取回/.test(t)), 'the blocked asset is named: ' + JSON.stringify(lines));
  assert.equal(downloads, 0, 'no package is offered');
  assert.match(await page.$eval('#status', (n) => n.textContent), /没有生成发布包/);
  assert.deepEqual(errors, [], 'no script errors');
  await browser.close(); console.log('ok: a local structure cannot be published as a reference');
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
