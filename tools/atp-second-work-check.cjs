// 4.4.8 for the rotary ATP synthase tool, real browser end to end: a second, different enzyme (Bacillus PS3 F1Fo, 6N2Y, c10 ring) is made a work from data only — Studio imports the structure, adds the
// rotary-ATPase tool with its PS3 preset, exports; a fresh Viewer opens the package and runs one turn. One turn of a c10 ring is 10 H+ for 3 ATP (bovine 6ZPO's c8 ring: 8 for 3), and the panel carries the work's
// own wording. Usage: node tools/atp-second-work-check.cjs [structures-dir] [out-dir]   (structures from node tools/fetch-smoke-structures.mjs; Playwright with Chromium; no server process)
const { chromium } = require('playwright'); const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), assert = require('node:assert/strict');
const ROOT = path.resolve(__dirname, '..'), ORIGIN = 'http://localhost:8765', FIXTURES = path.resolve(process.argv[2] || path.join(ROOT, 'desktop/dist/smoke-structures')), OUT = path.resolve(process.argv[3] || path.join(ROOT, 'docs/images'));
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
  const errors = [];
  const studio = await context.newPage(); studio.on('pageerror', (e) => errors.push('studio: ' + e.message));
  await studio.goto(ORIGIN + '/apps/studio-web/index.html'); await studio.waitForSelector('#tab-tools', { timeout: 30000 }); await studio.waitForTimeout(3000);
  await studio.setInputFiles('#structure-file', path.join(FIXTURES, '6N2Y.cif'));
  await studio.waitForFunction(() => /已导入 6N2Y/.test(document.querySelector('#status').textContent), null, { timeout: 240000 });
  await studio.click('#tab-tools');
  await studio.waitForFunction(() => [...document.querySelectorAll('#tool-add-select option')].some((o) => /PS3/.test(o.textContent)), null, { timeout: 60000 });
  const preset = await studio.$$eval('#tool-add-select option', (o) => o.find((x) => /PS3/.test(x.textContent)).value);
  assert.match(preset, /\nps3$/); await studio.selectOption('#tool-add-select', preset); await studio.click('#tool-add-button');
  await studio.waitForFunction(() => /已添加工具/.test(document.querySelector('#status').textContent), null, { timeout: 30000 });
  const applicability = await studio.$eval('#tool-config', (n) => n.textContent);
  assert.match(applicability, /适用于此场景/, 'the tool finds the c10 ring and the three beta subunits by the preset\'s part names: ' + applicability.slice(0, 400));
  const [download] = await Promise.all([studio.waitForEvent('download', { timeout: 120000 }), studio.click('#export-scene')]);
  const pack = path.join(os.tmpdir(), 'atp-ps3-' + process.pid + '.glow'); await download.saveAs(pack); await studio.close();

  const page = await context.newPage(); page.on('pageerror', (e) => errors.push('viewer: ' + e.message));
  await page.goto(ORIGIN + '/apps/viewer-web/index.html?startup=skip'); await page.waitForFunction(() => window.glow, null, { timeout: 30000 });
  await page.evaluate(() => document.querySelector('#structure-enabled').click()); await page.waitForFunction(() => !document.querySelector('#rcsb-load').disabled, null, { timeout: 30000 });
  await page.setInputFiles('#file', pack);
  await page.waitForFunction(() => !document.querySelector('#mechanism-controls').hidden, null, { timeout: 240000 });
  const title = await page.$eval('#mechanism-title', (n) => n.textContent), evidence = await page.$eval('#mechanism-evidence', (n) => n.textContent);
  assert.equal(title, 'ATP 合酶（细菌 PS3，c10）'); assert.match(evidence, /6N2Y/); assert.doesNotMatch(evidence, /6ZPO|牛/);
  assert.match(await page.$eval('#info-panel', (n) => n.textContent), /组成（31 个部件）/, 'the whole structure is in the system view (an imported scene is flat; the Viewer gives it a root group), not just the first rotor chain');
  const info = await page.evaluate(() => window.glow.animate({ time: 4 }));
  console.log('after one turn:', JSON.stringify(info.counters));
  assert.equal(info.counters.ATP, 3, '3 ATP per turn (three catalytic sites)'); assert.equal(info.counters['H⁺'], 10, '10 H+ per turn: the ring has ten c subunits');
  const time = (await page.evaluate(() => window.glow.info())).time;
  await page.evaluate(() => window.glow.animate({ pause: false }));
  await page.waitForFunction((t) => window.glow.info().then((i) => i.time > t + 0.05), time, { timeout: 30000 }); await page.evaluate(() => window.glow.animate({ pause: true }));
  await page.evaluate(() => window.glow.animate({ time: 1.3 })); await page.evaluate(() => window.glow.select('none')); await page.click('#reset-camera').catch(() => {}); await page.waitForTimeout(2500);
  await page.screenshot({ path: path.join(OUT, 'atp-ps3-work-opened.png') });
  fs.rmSync(pack, { force: true });
  assert.deepEqual(errors, [], 'no script errors');
  await browser.close(); console.log('ok: Bacillus PS3 c10 ATP synthase authored from a preset in Studio, opened and run in the Viewer');
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
