const { chromium } = require('playwright'); const fs = require('node:fs'), path = require('node:path');
// Every official protein template must offer the four ways of showing a protein (cartoon, backbone, blob, bond model) for the whole structure. Opens each template of workshop/official in the Viewer
// (structures from a local folder of RCSB files), asks for each way on "all" and records whether it was drawn; writes a picture of each template in the bond model.
//   node tools/template-modes-check.cjs <folder of PDB .cif files> <out-dir>        (ONLY=<part of a pack file name> checks one)
const ROOT = require('node:path').resolve(__dirname, '..'), ORIGIN = 'http://localhost:8765', FIXTURES = process.argv[2], OUT = process.argv[3];
const TYPES = { '.html': 'text/html', '.mjs': 'text/javascript', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
(async () => {
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] }), context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await context.route('**/*', (route) => { const url = new URL(route.request().url()), cdn = /^https:\/\/cdn\.jsdelivr\.net\/npm\/three@0\.160\.0\/(.+)$/.exec(url.href);
    if (cdn) { const f = [path.join(ROOT, 'desktop/vendor/three', cdn[1]), path.join(ROOT, 'desktop/node_modules/three', cdn[1])].find((x) => fs.existsSync(x)) ?? ''; return fs.existsSync(f) ? route.fulfill({ status: 200, contentType: 'text/javascript', body: fs.readFileSync(f) }) : route.abort(); }
    const rc = /^https:\/\/files\.rcsb\.org\/download\/([0-9A-Za-z]{4})\.cif$/.exec(url.href); if (rc) { const f = path.join(FIXTURES, rc[1].toUpperCase() + '.cif'); return fs.existsSync(f) ? route.fulfill({ status: 200, contentType: 'text/plain', body: fs.readFileSync(f) }) : route.fulfill({ status: 404, body: 'nf' }); }
    if (url.origin !== ORIGIN) return route.abort(); const file = path.join(ROOT, decodeURIComponent(url.pathname));
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) return route.fulfill({ status: 404, body: 'nf' }); route.fulfill({ status: 200, contentType: TYPES[path.extname(file)] ?? 'application/octet-stream', body: fs.readFileSync(file) }); });
  const index = JSON.parse(fs.readFileSync(path.join(ROOT, 'workshop/official/index.json'), 'utf8')), report = [];
  fs.mkdirSync(OUT, { recursive: true });
  for (const pack of index.packs.filter((p) => p.zone === 'template' && (!process.env.ONLY || p.file.includes(process.env.ONLY)))) {
    const page = await context.newPage(), errors = []; page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(ORIGIN + '/apps/viewer-web/index.html?startup=skip'); await page.waitForFunction(() => window.glow, null, { timeout: 30000 });
    await page.click('#panel-tab-structure'); await page.check('#structure-enabled'); await page.waitForTimeout(1000);
    const t0 = Date.now(); await page.setInputFiles('#file', path.join(ROOT, 'workshop/official', pack.file));
    const ready = await page.waitForFunction(() => !document.getElementById('view-controls').hidden, null, { timeout: 240000 }).then(() => true, () => false);
    const row = { template: pack.title, pdb: pack.pdb, opened: ready, seconds: Math.round((Date.now() - t0) / 1000), modes: {} };
    if (ready) {
      await page.waitForTimeout(3000);
      for (const style of ['cartoon', 'backbone', 'blob', 'sticks']) {
        row.modes[style] = await page.evaluate((s) => window.glow.show(['all', s]).then(() => 'ok', (e) => e.message), style);
        await page.waitForTimeout(style === 'sticks' ? 6000 : 2500);
      }
      await page.screenshot({ path: path.join(OUT, `${pack.file.split('/').pop().replace('.glow', '')}-sticks.png`) });
    }
    row.errors = errors; report.push(row); console.log(JSON.stringify(row)); await page.close();
  }
  fs.writeFileSync(path.join(OUT, 'template-modes.json'), JSON.stringify(report, null, 1));
  const bad = report.filter((r) => !r.opened || Object.values(r.modes).some((v) => v !== 'ok') || r.errors.length);
  console.log(bad.length ? `${bad.length} templates are missing a way of showing` : 'every template shows all four ways'); if (bad.length) process.exitCode = 1;
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
