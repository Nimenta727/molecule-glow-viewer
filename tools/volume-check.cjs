// Real-browser check of density maps (docs/PLUGIN_ROADMAP.md A2 + B2). No real EMDB map is reachable from here, so the map is SIMULATED: the real alpha-carbon coordinates of E. coli adenylate kinase
// (4AKE chain A) blurred with 5 Å gaussians onto a 2 Å grid and written as an MRC file. It is a test of the software (reading the file, placing the surface in the structure's frame, the level, a slice,
// clearing), not of any experiment. Usage: node tools/volume-check.cjs [structures-dir]   (node tools/fetch-smoke-structures.mjs --dir desktop/dist/smoke-structures; Playwright with Chromium)
const { chromium } = require('playwright'); const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), assert = require('node:assert/strict');
const ROOT = path.resolve(__dirname, '..'), ORIGIN = 'http://localhost:8765', FIXTURES = path.resolve(process.argv[2] || path.join(ROOT, 'desktop/dist/smoke-structures'));
const TYPES = { '.html': 'text/html', '.mjs': 'text/javascript', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
function simulatedMap() {
  const atoms = fs.readFileSync(path.join(FIXTURES, '4AKE.cif'), 'utf8').split('\n').filter((l) => /^ATOM\s/.test(l)).map((l) => l.trim().split(/\s+/)).filter((f) => f[3] === 'CA' && f[6] === 'A').map((f) => [Number(f[10]), Number(f[11]), Number(f[12])]);
  assert.equal(atoms.length, 214);
  const lo = [0, 1, 2].map((k) => Math.min(...atoms.map((a) => a[k])) - 12), hi = [0, 1, 2].map((k) => Math.max(...atoms.map((a) => a[k])) + 12), voxel = 2, dims = [0, 1, 2].map((k) => Math.ceil((hi[k] - lo[k]) / voxel) + 1), sigma = 5;
  const data = new Float32Array(dims[0] * dims[1] * dims[2]), reach = Math.ceil(3 * sigma / voxel);
  for (const a of atoms) { const c = [0, 1, 2].map((k) => Math.round((a[k] - lo[k]) / voxel)); for (let z = c[2] - reach; z <= c[2] + reach; z++) for (let y = c[1] - reach; y <= c[1] + reach; y++) for (let x = c[0] - reach; x <= c[0] + reach; x++) {
    if (x < 0 || y < 0 || z < 0 || x >= dims[0] || y >= dims[1] || z >= dims[2]) continue;
    const d2 = (lo[0] + x * voxel - a[0]) ** 2 + (lo[1] + y * voxel - a[1]) ** 2 + (lo[2] + z * voxel - a[2]) ** 2; data[x + dims[0] * (y + dims[1] * z)] += Math.exp(-d2 / (2 * sigma * sigma)); } }
  const out = new Uint8Array(1024 + data.length * 4), view = new DataView(out.buffer);
  dims.forEach((n, k) => { view.setInt32(4 * k, n, true); view.setInt32(28 + 4 * k, n, true); view.setFloat32(40 + 4 * k, n * voxel, true); view.setFloat32(52 + 4 * k, 90, true); view.setInt32(64 + 4 * k, k + 1, true); view.setFloat32(196 + 4 * k, lo[k], true); });
  view.setInt32(12, 2, true); out.set([0x44, 0x44, 0, 0], 212); out.set(new TextEncoder().encode('simulated from 4AKE CA, sigma 5 A'), 224);
  data.forEach((v, i) => view.setFloat32(1024 + 4 * i, v, true));
  return { bytes: out, dims, max: Math.max(...data) };
}
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
  const sim = simulatedMap(), file = path.join(os.tmpdir(), 'simulated-' + process.pid + '.mrc'); fs.writeFileSync(file, sim.bytes); console.log('simulated map', sim.dims.join('x'), 'voxels, max density', sim.max.toFixed(2));
  await page.evaluate(() => window.glow.load({ pdb: '4AKE' })); await page.evaluate(() => window.glow.represent('backbone')); await page.waitForTimeout(1200);
  const noMap = await page.evaluate(() => window.glow.volume({ level: 0.5 }).then(() => null, (e) => e.message)); assert.match(noMap, /还没有加载体积/, 'a level without a map says there is none yet');
  // load the file the way a user does
  const before = (await page.evaluate(() => window.__glowStats())).triangles;
  await page.setInputFiles('#file', file); await page.waitForFunction(() => /体积/.test(document.querySelector('#status').textContent), null, { timeout: 60000 }).catch(async () => { throw new Error('status: ' + await page.$eval('#status', (n) => n.textContent)); });
  console.log('status:', await page.$eval('#status', (n) => n.textContent));
  const withSurface = (await page.evaluate(() => window.__glowStats())).triangles; assert.ok(withSurface > before + 1000, `the isosurface is in the scene (${withSurface} vs ${before})`);
  // a level and a slice
  const info = await page.evaluate((level) => window.glow.volume({ level, opacity: 0.4, slice: { axis: 2, index: 20 } }), sim.max * 0.3);
  console.log('level', info.level.toFixed(3), 'triangles', info.triangles, 'slice', JSON.stringify(info.slice));
  assert.ok(!info.auto && info.triangles > 500 && info.slice.layer === 20 && info.slice.of === sim.dims[2]);
  await page.waitForTimeout(1500); await page.screenshot({ path: path.join(ROOT, 'docs/images/volume-overlay.png') });
  const high = await page.evaluate((level) => window.glow.volume({ level }), sim.max * 2); assert.equal(high.triangles, 0); assert.match(high.note, /没有等值面/);
  const bad = await page.evaluate(() => window.glow.volume({ map: 'AAAA' }).then(() => null, (e) => e.message)); assert.match(bad, /太短|MRC/, 'garbage is refused with a reason');
  await page.evaluate(() => window.glow.volume('clear')); await page.waitForTimeout(800);
  assert.equal((await page.evaluate(() => window.__glowStats())).triangles, before, 'clearing removes the surface and the slice');
  fs.rmSync(file, { force: true });
  assert.deepEqual(errors, [], 'no script errors');
  await browser.close(); console.log('ok: a simulated density map over a real structure: surface, level, slice, refusal, clear');
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
