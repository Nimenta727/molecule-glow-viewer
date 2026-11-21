// Real-browser check of the on-machine benchmark (docs/PLUGIN_ROADMAP.md B4). In this container WebGL is a software rasteriser, so what is checked is that the benchmark runs, reads the real renderer string,
// says plainly that the numbers are software, and returns a budget. The numbers for a real GPU have to come from the author's own machine: open the Viewer there and run  await glow.benchmark()  in the console.
// Usage: node tools/benchmark-check.cjs [structures-dir]   (node tools/fetch-smoke-structures.mjs --dir desktop/dist/smoke-structures; Playwright with Chromium)
const { chromium } = require('playwright'); const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const ROOT = path.resolve(__dirname, '..'), ORIGIN = 'http://localhost:8765', FIXTURES = path.resolve(process.argv[2] || path.join(ROOT, 'desktop/dist/smoke-structures'));
const TYPES = { '.html': 'text/html', '.mjs': 'text/javascript', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
(async () => {
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const context = await browser.newContext({ viewport: { width: 900, height: 650 } });
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
  await page.evaluate(() => window.glow.load({ pdb: '6N2Y' })); await page.evaluate(() => window.glow.represent('blob')); await page.waitForTimeout(1500);
  const bad = await page.evaluate(() => window.glow.benchmark({ seconds: 99 }).then(() => null, (e) => e.message)); assert.match(bad, /超出范围/);
  const report = await page.evaluate(() => window.glow.benchmark({ seconds: 3, targetFps: 30 }));
  console.log(JSON.stringify({ renderer: report.renderer, software: report.software, fps: +report.stats.fps.toFixed(2), frames: report.stats.frames, triangles: report.triangles, budget: report.budget, tier: report.tier }));
  console.log(report.advice.join(' | '));
  assert.equal(report.software, true, 'this container renders in software, and the report says so'); assert.equal(report.tier, 'software'); assert.match(report.advice[0], /软件渲染/);
  assert.ok(report.stats.frames >= 1 && report.stats.fps > 0 && report.triangles > 1e6, 'frames were measured on a real scene'); assert.ok(report.budget >= 20000);
  assert.ok(/swiftshader/i.test(report.renderer), 'the renderer string is the real one WebGL reports');
  const after = await page.evaluate(() => window.__glowStats()); assert.equal(after.triangles, report.triangles, 'the benchmark leaves the scene as it was');
  assert.deepEqual(errors, [], 'no script errors');
  await browser.close(); console.log('ok: benchmark measured frames, named the software renderer, gave a budget');
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
