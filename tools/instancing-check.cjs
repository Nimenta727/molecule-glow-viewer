// Real-browser check of instancing with levels of detail (packages/render-three/lod.mjs, instance-set.mjs; docs/PLUGIN_ROADMAP.md B1): a real structure (6N2Y, Bacillus PS3 ATP synthase) is copied 400 times with
// glow.instances; the triangles the scene really holds (counted from the scene, instances included) are read at several camera distances and with a budget. Frame rates are not measured (software rendering).
// Usage: node tools/instancing-check.cjs [structures-dir]   (node tools/fetch-smoke-structures.mjs --dir desktop/dist/smoke-structures; Playwright with Chromium; no server process)
const { chromium } = require('playwright'); const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const ROOT = path.resolve(__dirname, '..'), ORIGIN = 'http://localhost:8765', FIXTURES = path.resolve(process.argv[2] || path.join(ROOT, 'desktop/dist/smoke-structures'));
const TYPES = { '.html': 'text/html', '.mjs': 'text/javascript', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
(async () => {
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const context = await browser.newContext({ viewport: { width: 1000, height: 700 } });
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
  const stats = () => page.evaluate(() => window.__glowStats()), settle = (ms = 700) => page.waitForTimeout(ms);
  const base = await stats(); console.log('one structure, drawn as blobs:', base.triangles, 'triangles');
  assert.ok(base.triangles > 1000, 'the structure is drawn');

  const COPIES = 400;
  const info = await page.evaluate((copies) => window.glow.instances({ copies, layout: 'sphere' }), COPIES);
  console.log('tint', info.tint, '| levels (triangles each):', info.levelTriangles.join(' / '), '| radius', info.prototypeRadius.toFixed(3), '| without levels:', info.withoutLevels, '| first frame:', JSON.stringify(info.plan));
  const [full, blobs, ellipsoid, marker] = info.levelTriangles;
  assert.ok(full > blobs && blobs > ellipsoid && ellipsoid > marker, 'each level is cheaper than the one before');
  assert.equal(info.plan.instances, COPIES); assert.equal(info.plan.counts.reduce((a, b) => a + b, 0) + info.plan.culled, COPIES, 'every copy is at a level or culled');
  assert.ok(info.plan.triangles < info.withoutLevels / 10, `levels make the first frame at least ten times cheaper than drawing every copy in full (${info.plan.triangles} vs ${info.withoutLevels})`);

  const R = info.prototypeRadius, at = async (z, y = 0) => { await page.evaluate(({ z, y }) => window.glow.camera({ position: [0, y, z], target: [0, 0, 0] }), { z, y }); await settle(); return stats(); };
  const far = await at(400 * R), mid = await at(40 * R), near = await at(14 * R);
  const drawn = (s) => s.triangles - base.triangles;   // what the instance set adds to the structure that was already there
  console.log('instance triangles drawn at 400 R / 40 R / 14 R away:', drawn(far), drawn(mid), drawn(near));
  // (14 R is inside the shell of copies, so only the copies in front are in view: that is why it is not the most expensive of the three)
  assert.ok(drawn(far) < drawn(mid) && drawn(far) < drawn(near), 'from far away the fewest triangles');
  assert.equal(drawn(far), COPIES * info.levelTriangles[3], 'far away every copy is its marker: 400 x 8 triangles');
  assert.ok(drawn(far) < info.withoutLevels / 50, `from far away a tiny fraction of the full cost (${drawn(far)} vs ${info.withoutLevels})`);
  assert.ok(drawn(mid) < info.withoutLevels / 3, `at middle distance clearly cheaper than all in full (${drawn(mid)} vs ${info.withoutLevels})`);

  // a budget is kept (at 40 R the frame costs about a million triangles; the budget is half of that)
  const BUDGET = 500_000, uncapped = drawn(mid);
  assert.ok(uncapped > BUDGET, 'the test needs a frame that is over the budget');
  await page.evaluate(({ copies, budget }) => window.glow.instances({ copies, layout: 'sphere', budget }), { copies: COPIES, budget: BUDGET });
  const capped = await at(40 * R);
  console.log('at 40 R, no budget:', uncapped, '| budget', BUDGET, ':', drawn(capped));
  assert.ok(drawn(capped) <= BUDGET, 'the budget holds'); assert.ok(drawn(capped) > BUDGET * 0.5, 'and it is used, not undershot by a wide margin');
  const roomy = await page.evaluate(({ copies, budget }) => window.glow.instances({ copies, layout: 'sphere', budget }), { copies: COPIES, budget: 50_000_000 });
  assert.equal(roomy.plan.demoted, 0, 'a budget that is not reached demotes nothing');

  // look at it: 400 copies, levels mixed by distance
  await page.evaluate((copies) => window.glow.instances({ copies, layout: 'sphere' }), COPIES); await at(40 * R); await settle(1200);
  await page.screenshot({ path: path.join(ROOT, 'docs/images/instancing-400.png') });
  // grid layout, clearing, and no leak
  await page.evaluate(() => window.glow.instances({ copies: 125, layout: 'grid' })); await settle();
  await page.evaluate(() => window.glow.instances('clear')); await settle(1000);
  const after = await stats();
  assert.equal(after.triangles, base.triangles, 'clearing takes every instance away again'); assert.ok(after.geometries <= base.geometries + 2, `no geometry left behind (${after.geometries} vs ${base.geometries})`);
  assert.deepEqual(errors, [], 'no script errors');
  await browser.close(); console.log('ok: 400 copies of a real complex with levels of detail');
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
