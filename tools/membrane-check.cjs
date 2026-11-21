// Real-browser check of the membrane builder (docs/PLUGIN_ROADMAP.md B3): a bilayer is drawn as two translucent leaflets around a real structure (KcsA, 1K4C), in several shapes, refused when wrong, and cleared.
// Usage: node tools/membrane-check.cjs [structures-dir]   (node tools/fetch-smoke-structures.mjs --dir desktop/dist/smoke-structures; Playwright with Chromium)
const { chromium } = require('playwright'); const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const ROOT = path.resolve(__dirname, '..'), ORIGIN = 'http://localhost:8765', FIXTURES = path.resolve(process.argv[2] || path.join(ROOT, 'desktop/dist/smoke-structures'));
const TYPES = { '.html': 'text/html', '.mjs': 'text/javascript', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
(async () => {
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const context = await browser.newContext({ viewport: { width: 1100, height: 760 } });
  await context.route('**/*', (route) => {
    const url = new URL(route.request().url()), cdn = /^https:\/\/cdn\.jsdelivr\.net\/npm\/three@0\.160\.0\/(.+)$/.exec(url.href), rcsb = /^https:\/\/files\.rcsb\.org\/download\/([0-9A-Za-z]{4})\.cif$/.exec(url.href);
    if (cdn) { const f = [path.join(ROOT, 'desktop/vendor/three', cdn[1]), path.join(ROOT, 'desktop/node_modules/three', cdn[1])].find((file) => fs.existsSync(file)) ?? ''; return fs.existsSync(f) ? route.fulfill({ status: 200, contentType: 'text/javascript', body: fs.readFileSync(f) }) : route.abort(); }
    if (rcsb) { const f = path.join(FIXTURES, rcsb[1].toUpperCase() + '.cif'); return fs.existsSync(f) ? route.fulfill({ status: 200, contentType: 'text/plain', body: fs.readFileSync(f) }) : route.fulfill({ status: 404, body: 'not pinned' }); }
    if (url.origin !== ORIGIN) return route.abort();
    const file = path.join(ROOT, decodeURIComponent(url.pathname));
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return route.fulfill({ status: 404, body: 'not found' });
    route.fulfill({ status: 200, contentType: TYPES[path.extname(file)] ?? 'application/octet-stream', body: fs.readFileSync(file) });
  });
  const page = await context.newPage(), errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(ORIGIN + '/apps/viewer-web/index.html?startup=skip'); await page.waitForFunction(() => window.glow, null, { timeout: 30000 });
  await page.evaluate(() => window.glow.load({ pdb: '1K4C' })); await page.evaluate(() => window.glow.represent('blob')); await page.waitForTimeout(1500);
  const stats = () => page.evaluate(() => window.__glowStats()), base = await stats();
  const bad = await page.evaluate(() => window.glow.membrane({ shape: { kind: 'cube' } }).then(() => null, (e) => e.message)); assert.match(bad, /shape\.kind/);
  const bad2 = await page.evaluate(() => window.glow.membrane({ shape: { kind: 'sphere', radius: -3 } }).then(() => null, (e) => e.message)); assert.match(bad2, /超出范围/);
  // a flat bilayer 40 A thick through the channel, its normal along the channel axis (KcsA's four-fold axis is close to the y axis of the entry)
  const plane = await page.evaluate(() => window.glow.membrane({ shape: { kind: 'plane', width: 160, height: 160 }, normal: [0, 0, 1] }));
  console.log('plane:', JSON.stringify(plane)); assert.equal(plane.shape, 'plane'); assert.ok(Math.abs(plane.area - 25600) < 1e-6); assert.match(plane.note, /默认的 40 Å/, 'the default thickness says it is unchecked');
  await page.waitForTimeout(1000); const withPlane = await stats(); assert.ok(withPlane.triangles - base.triangles >= 2 * 2 * 48 * 48, `two leaflets of 4608 triangles (${withPlane.triangles - base.triangles})`);
  const own = await page.evaluate(() => window.glow.membrane({ shape: { kind: 'sphere', radius: 120 }, thickness: 36, opacity: 0.3 })); assert.equal(own.note, '', 'a thickness the author gave needs no warning');
  await page.waitForTimeout(1500); await page.screenshot({ path: path.join(ROOT, 'docs/images/membrane-vesicle.png') });
  await page.evaluate(() => window.glow.membrane('clear')); await page.waitForTimeout(800); assert.equal((await stats()).triangles, base.triangles, 'clearing removes both leaflets');
  assert.deepEqual(errors, [], 'no script errors');
  await browser.close(); console.log('ok: membrane shapes drawn as two leaflets, refused when wrong, cleared');
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
