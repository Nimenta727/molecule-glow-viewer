// Real-browser leak check for the Viewer (4.4.8 "repeated load stability"; also the first step of 4.7): the same scenes are opened again and again, and what the renderer holds (GPU geometries,
// textures, compiled programs, objects in the scene graph) and the JS heap (after a forced collection) must not grow from one round to the next: a settled scene is the same size however many
// scenes were opened before it. Structures are served from the pinned fixtures (node tools/fetch-smoke-structures.mjs --dir desktop/dist/smoke-structures); no server process, no network.
// Usage: node tools/viewer-stability-check.cjs [fixtures-dir] [rounds]   (needs Playwright with Chromium). Exits 1 with the numbers when something grows.
const { chromium } = require('playwright'); const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const ROOT = path.resolve(__dirname, '..'), ORIGIN = 'http://localhost:8765', FIXTURES = path.resolve(process.argv[2] || path.join(ROOT, 'desktop/dist/smoke-structures')), ROUNDS = Number(process.argv[3] || 6);
const TYPES = { '.html': 'text/html', '.mjs': 'text/javascript', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.glow': 'application/json', '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml' };
(async () => {
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--enable-precise-memory-info', '--js-flags=--expose-gc'] });
  const context = await browser.newContext({ viewport: { width: 900, height: 700 }, deviceScaleFactor: 1 });
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
  const cdp = await context.newCDPSession(page);
  await page.goto(ORIGIN + '/apps/viewer-web/index.html?startup=skip'); await page.waitForFunction(() => window.glow && window.__glowStats, null, { timeout: 30000 });
  const settle = async () => { await page.waitForTimeout(600); await cdp.send('HeapProfiler.collectGarbage'); await cdp.send('HeapProfiler.collectGarbage'); await page.waitForTimeout(200); };
  const measure = async () => { await settle(); return page.evaluate(() => ({ ...window.__glowStats(), heap: performance.memory.usedJSHeapSize })); };
  const scenes = ['1K4C', '6ZPO', '4AKE'], seen = Object.fromEntries(scenes.map((id) => [id, []]));
  for (let round = 0; round < ROUNDS; round++) for (const id of scenes) {
    await page.evaluate(async (pdb) => { await window.glow.load({ pdb }); await window.glow.represent('blob'); await window.glow.represent('cartoon'); }, id);
    seen[id].push(await measure());
  }
  await page.evaluate(() => window.glow.load({ pdb: '1K4C' }).then(() => window.glow.select('chain A and resi 1-20'))); const final = await measure();
  console.log(JSON.stringify(Object.fromEntries(Object.entries(seen).map(([id, list]) => [id, list.map(({ geometries, textures, programs, objects, heap }) => `${geometries}g ${textures}t ${programs}p ${objects}o ${(heap / 1048576).toFixed(1)}MB`)])), null, 1));
  for (const [id, list] of Object.entries(seen)) {
    const [first, ...rest] = list.slice(1);   // round 1 includes one-time costs (programs compiled, caches filled): the comparison starts from round 2
    for (const m of rest) for (const key of ['geometries', 'textures', 'programs', 'objects']) assert.ok(m[key] <= first[key], `${id}: ${key} grew from ${first[key]} to ${m[key]} over repeated loads`);
    const last = rest.at(-1) ?? first; assert.ok(last.heap <= first.heap * 1.25 + 4 * 1048576, `${id}: JS heap grew from ${(first.heap / 1048576).toFixed(1)} to ${(last.heap / 1048576).toFixed(1)} MB over repeated loads`);
  }
  assert.deepEqual(errors, [], 'no script errors'); assert.ok(final.objects > 0);
  await browser.close(); console.log(`ok: ${ROUNDS} rounds x ${scenes.length} scenes, nothing grows`);
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
