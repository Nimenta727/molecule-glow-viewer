// 4.4.8 "resource + work configuration" in a real browser, end to end, with no new code for the protein: in the Studio a structure (1OMP) is imported, the two-state conformation tool is added
// with its maltose-binding-protein preset, the work is exported as a package; in a fresh Viewer the package is opened and the player runs the 1OMP -> 1ANF closure. The numbers shown are the ones
// computed from the coordinates (tools/second-pair-check.mjs), and the panel carries the work's own wording, not the adenylate kinase text.
// Usage: node tools/mbp-work-check.cjs [structures-dir] [out-dir]   (Playwright with Chromium; structures from node tools/fetch-smoke-structures.mjs; no server process)
const { chromium } = require('playwright'); const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), assert = require('node:assert/strict');
const ROOT = path.resolve(__dirname, '..'), ORIGIN = 'http://localhost:8765', FIXTURES = path.resolve(process.argv[2] || path.join(ROOT, 'desktop/dist/smoke-structures')), OUT = path.resolve(process.argv[3] || path.join(ROOT, 'docs/images'));
const TYPES = { '.html': 'text/html', '.mjs': 'text/javascript', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.glow': 'application/json' };
(async () => {
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
  await context.route('**/*', (route) => {
    const url = new URL(route.request().url()), cdn = /^https:\/\/cdn\.jsdelivr\.net\/npm\/three@0\.160\.0\/(.+)$/.exec(url.href), rcsb = /^https:\/\/files\.rcsb\.org\/download\/([0-9A-Za-z]{4})\.cif$/.exec(url.href);
    if (cdn) { const f = [path.join(ROOT, 'desktop/vendor/three', cdn[1]), path.join(ROOT, 'desktop/node_modules/three', cdn[1])].find((file) => fs.existsSync(file)) ?? ''; return fs.existsSync(f) ? route.fulfill({ status: 200, contentType: 'text/javascript', body: fs.readFileSync(f) }) : route.abort(); }
    if (rcsb) { const f = path.join(FIXTURES, rcsb[1].toUpperCase() + '.cif'); return fs.existsSync(f) ? route.fulfill({ status: 200, contentType: 'text/plain', body: fs.readFileSync(f) }) : route.fulfill({ status: 404, body: 'not pinned' }); }
    if (url.origin !== ORIGIN) return route.abort();
    const file = path.join(ROOT, decodeURIComponent(url.pathname));
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return route.fulfill({ status: 404, body: 'not found' });
    route.fulfill({ status: 200, contentType: TYPES[path.extname(file)] ?? 'application/octet-stream', body: fs.readFileSync(file) });
  });
  const errors = [];
  // ---- Studio: import, add the tool with its preset, export ------------------------------------------------------------------------------------------------
  const studio = await context.newPage(); studio.on('pageerror', (e) => errors.push('studio: ' + e.message));
  await studio.goto(ORIGIN + '/apps/studio-web/index.html'); await studio.waitForSelector('#tab-tools', { timeout: 30000 }); await studio.waitForTimeout(3000);
  await studio.setInputFiles('#structure-file', path.join(FIXTURES, '1OMP.cif'));
  await studio.waitForFunction(() => /已导入 1OMP/.test(document.querySelector('#status').textContent), null, { timeout: 120000 });
  await studio.click('#tab-tools');
  await studio.waitForFunction(() => [...document.querySelectorAll('#tool-add-select option')].some((o) => /麦芽糖结合蛋白/.test(o.textContent)), null, { timeout: 60000 });
  const preset = await studio.$$eval('#tool-add-select option', (o) => o.find((x) => /麦芽糖结合蛋白/.test(x.textContent)).value);
  assert.match(preset, /^org\.glow\.tool\.conformation-pair\nmbp$/, 'the preset is offered next to the default template');
  await studio.selectOption('#tool-add-select', preset); await studio.click('#tool-add-button');
  await studio.waitForFunction(() => /已添加工具/.test(document.querySelector('#status').textContent), null, { timeout: 30000 });
  const applicability = await studio.$eval('#tool-config', (n) => n.textContent);
  assert.match(applicability, /适用于此场景/, 'the tool finds the maltose-binding protein chain by the preset\'s name pattern: ' + applicability.slice(0, 300));
  // a domain's residue range is edited in the panel: a malformed entry is refused with a reason and changes nothing; a valid one is kept and drives the measurement
  const ranges = studio.locator('#tool-config input[data-path="domains.1.ranges"]');
  await studio.locator('#tool-config details', { hasText: '域残基范围' }).first().evaluate((n) => { n.open = true; });
  assert.equal(await ranges.inputValue(), '114-259, 317-370', 'the C domain range is shown the way people write it');
  await ranges.fill('9-3'); await ranges.dispatchEvent('change'); await studio.waitForTimeout(500);
  assert.match(await studio.$eval('#status', (n) => n.textContent), /起 ≤ 止/, 'a bad range is refused with the reason');
  assert.equal(await studio.locator('#tool-config input[data-path="domains.1.ranges"]').inputValue(), '114-259, 317-370', 'and the old value is put back');
  await studio.locator('#tool-config details', { hasText: '域残基范围' }).first().evaluate((n) => { n.open = true; });
  await studio.locator('#tool-config input[data-path="domains.1.ranges"]').fill('114-259'); await studio.locator('#tool-config input[data-path="domains.1.ranges"]').dispatchEvent('change');
  await studio.waitForFunction(() => /已更新工具配置/.test(document.querySelector('#status').textContent), null, { timeout: 30000 });
  assert.equal(await studio.locator('#tool-config input[data-path="domains.1.ranges"]').inputValue(), '114-259');
  const [download] = await Promise.all([studio.waitForEvent('download', { timeout: 60000 }), studio.click('#export-scene')]);
  const pack = path.join(os.tmpdir(), 'mbp-work-' + process.pid + '.glow'); await download.saveAs(pack);
  await studio.close();
  // ---- Viewer: open the package, run the closure ----------------------------------------------------------------------------------------------------------
  const page = await context.newPage(); page.on('pageerror', (e) => errors.push('viewer: ' + e.message));
  await page.goto(ORIGIN + '/apps/viewer-web/index.html?startup=skip'); await page.waitForFunction(() => window.glow, null, { timeout: 30000 });
  await page.evaluate(() => document.querySelector('#structure-enabled').click()); await page.waitForFunction(() => !document.querySelector('#rcsb-load').disabled, null, { timeout: 30000 });
  await page.setInputFiles('#file', pack);
  await page.waitForFunction(() => !document.querySelector('#mechanism-controls').hidden, null, { timeout: 120000 });
  const title = await page.$eval('#mechanism-title', (n) => n.textContent), evidence = await page.$eval('#mechanism-evidence', (n) => n.textContent);
  assert.equal(title, '麦芽糖结合蛋白', 'the panel carries the work\'s own title'); assert.match(evidence, /1OMP/); assert.doesNotMatch(evidence + title, /AdK|腺苷酸/, 'no adenylate kinase wording');
  const { parseMmcif } = await import('../plugins/structure/parser.mjs'), { selectionSpace, evaluateSelection } = await import('../plugins/structure/selection.mjs'), { fitStates, domainMotions } = await import('../plugins/motion/state-pair.mjs');
  const A = parseMmcif(fs.readFileSync(path.join(FIXTURES, '1OMP.cif'), 'utf8')), B = parseMmcif(fs.readFileSync(path.join(FIXTURES, '1ANF.cif'), 'utf8')), space = selectionSpace(A), res = (e) => new Set(evaluateSelection(e, space).residues);
  const expected = domainMotions(fitStates(A, B, { core: res('chain A and resi 1-109,264-309') }), [{ name: 'C', residues: res('chain A and resi 114-259') }], 1)[0];   // the C domain as edited: 114-259 only
  const info = await page.evaluate(() => window.glow.animate({ morph: 1 }));
  const c = info.domainMeasurements.find(({ name }) => name === 'C'), h = info.domainMeasurements.find(({ name }) => name === '铰链');
  console.log('C domain', c.angle.toFixed(2), '°', c.shift.toFixed(2), 'Å; hinge', h.angle.toFixed(2), '°');
  assert.ok(Math.abs(c.angle - expected.angle) < 1e-6 && Math.abs(c.shift - expected.shift) < 1e-6, `the edited C range gives the numbers of the independent computation (${expected.angle.toFixed(3)}° / ${expected.shift.toFixed(3)} Å)`);
  assert.ok(Math.abs(c.angle - 36.2124) > 1e-3 || Math.abs(c.shift - 10.2115) > 1e-3, 'and they differ from the unedited domain, so the edit really reached the player');
  assert.ok(Math.abs(h.angle - 17.41) < 0.05, 'the untouched hinge is unchanged');
  await page.waitForTimeout(1500);
  assert.match(await page.$eval('#mechanism-metrics', (n) => n.textContent), /N 叠合 RMSD 0\.721 Å/);
  const time = (await page.evaluate(() => window.glow.info())).time;
  await page.evaluate(() => window.glow.animate({ morph: 'auto' })); await page.evaluate(() => window.glow.animate({ pause: false }));
  await page.waitForFunction((t) => window.glow.info().then((i) => i.time > t + 0.05), time, { timeout: 30000 }); await page.evaluate(() => window.glow.animate({ pause: true }));
  await page.evaluate(() => window.glow.animate({ morph: 1 })); await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(OUT, 'mbp-work-opened.png') });
  fs.rmSync(pack, { force: true });
  assert.deepEqual(errors, [], 'no script errors');
  await browser.close(); console.log('ok: maltose-binding protein work authored in Studio from a preset, opened and run in the Viewer');
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
