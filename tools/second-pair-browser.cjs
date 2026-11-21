// 4.3 completion gate in a real browser: the conformation pair is set up for the SECOND real structure pair (maltose-binding protein, 1OMP open / 1ANF closed) through the same panel
// the first pair uses, configuration only: previewed, saved to a package, closed, opened again, and the domain numbers and the picture come back identical.
// Usage: node tools/second-pair-browser.cjs [structures-dir] [out-dir]   (needs Playwright with Chromium; structures from node tools/fetch-smoke-structures.mjs; no server process)
const { chromium } = require('playwright'); const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), assert = require('node:assert/strict');
const ROOT = path.resolve(__dirname, '..'), ORIGIN = 'http://localhost:8765', FIXTURES = path.resolve(process.argv[2] || path.join(ROOT, 'desktop/dist/smoke-structures')), OUT = path.resolve(process.argv[3] || path.join(ROOT, 'docs/images'));
const TYPES = { '.html': 'text/html', '.mjs': 'text/javascript', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.glow': 'application/json' };
const CORE = 'chain A and resi 1-109,264-309', DOMAINS = 'C: chain A and resi 114-259,317-370\nhinge: chain A and resi 110-113,260-263,310-316';
(async () => {
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const context = await browser.newContext({ viewport: { width: 1100, height: 800 }, deviceScaleFactor: 1, acceptDownloads: true });
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
  const boot = async () => { await page.goto(ORIGIN + '/apps/viewer-web/index.html?startup=skip'); await page.waitForFunction(() => window.glow, null, { timeout: 30000 }); };
  const info = () => page.$eval('#morph-info', (n) => n.textContent);
  await boot();
  await page.evaluate(() => window.glow.load({ pdb: '1OMP' }));
  await page.waitForSelector('#morph-controls:not([hidden])', { state: 'attached', timeout: 60000 });
  await page.evaluate(() => { document.querySelector('#structure-tools').open = true; });
  await page.fill('#morph-accession', '1ANF'); await page.click('#morph-load');
  await page.waitForSelector('#morph-panel:not([hidden])', { timeout: 60000 });
  await page.evaluate(() => { document.querySelector('.morph-settings').open = true; });
  await page.fill('#morph-core', CORE); await page.fill('#morph-domains', DOMAINS); await page.click('#morph-apply');
  await page.waitForTimeout(2000);
  await page.$eval('#morph-fraction', (n) => { n.value = '1'; n.dispatchEvent(new Event('input', { bubbles: true })); }); await page.waitForTimeout(1500);
  const before = await info(); console.log('before:', before);
  assert.match(before, /C 转 3[5-7]\.\d°/, 'the C domain turns about 36°'); assert.match(before, /RMSD/);
  const CLIP = { x: 330, y: 80, width: 700, height: 600 };   // the molecule's area: the title and the panel scroll differ with the file name
  await page.screenshot({ path: path.join(OUT, 'second-pair-mbp.png') }); const shot1 = await page.screenshot({ clip: CLIP });
  // save to a package, open the page again, open the package
  const [download] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), page.click('#save')]);
  const file = path.join(os.tmpdir(), 'second-pair-' + process.pid + '.glow'); await download.saveAs(file);
  await boot();   // a fresh page: the official structure plugin is switched on first, as for any package
  await page.evaluate(() => document.querySelector('#structure-enabled').click()); await page.waitForFunction(() => !document.querySelector('#rcsb-load').disabled, null, { timeout: 30000 });
  await page.setInputFiles('#file', file);
  await page.waitForSelector('#morph-controls:not([hidden])', { state: 'attached', timeout: 60000 }); await page.evaluate(() => { document.querySelector('#structure-tools').open = true; });
  await page.waitForSelector('#morph-panel:not([hidden])', { timeout: 60000 }); await page.waitForTimeout(2500);
  const after = await info(); console.log('after: ', after);
  assert.equal(after, before, 'the domain numbers come back identical after reopening');
  assert.equal(await page.$eval('#morph-core', (n) => n.value), CORE); assert.equal(await page.$eval('#morph-domains', (n) => n.value), DOMAINS);
  assert.equal(await page.$eval('#morph-fraction', (n) => n.value), '1');
  const shot2 = await page.screenshot({ clip: CLIP });
  assert.ok(shot1.equals(shot2), 'the molecule is drawn pixel for pixel the same after reopening'); console.log('molecule area pixel-identical after reopen: true');
  fs.rmSync(file, { force: true });
  assert.deepEqual(errors, [], 'no script errors');
  await browser.close(); console.log('ok: second structure pair (MBP) previewed, saved, reopened with configuration only');
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
