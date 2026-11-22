const { chromium } = require('playwright'); const fs = require('node:fs'), path = require('node:path');
const ROOT = path.resolve(__dirname, '..'), ORIGIN = 'http://localhost:8765', FIX = path.join(ROOT, 'desktop/dist/smoke-structures'), OUT = process.argv[2] || '/tmp/claude-0/shots/ui';
const TYPES = { '.html': 'text/html', '.mjs': 'text/javascript', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.glow': 'application/json', '.png': 'image/png' };
fs.mkdirSync(OUT, { recursive: true });
(async () => {
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] }), context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.route('**/*', (route) => { const url = new URL(route.request().url()), cdn = /^https:\/\/cdn\.jsdelivr\.net\/npm\/three@0\.160\.0\/(.+)$/.exec(url.href), rcsb = /^https:\/\/files\.rcsb\.org\/download\/([0-9A-Za-z]{4})\.cif$/.exec(url.href);
    if (cdn) { const f = [path.join(ROOT, 'desktop/vendor/three', cdn[1]), path.join(ROOT, 'desktop/node_modules/three', cdn[1])].find((x) => fs.existsSync(x)) ?? ''; return fs.existsSync(f) ? route.fulfill({ status: 200, contentType: 'text/javascript', body: fs.readFileSync(f) }) : route.abort(); }
    if (rcsb) { const f = path.join(FIX, rcsb[1].toUpperCase() + '.cif'); return fs.existsSync(f) ? route.fulfill({ status: 200, contentType: 'text/plain', body: fs.readFileSync(f) }) : route.fulfill({ status: 404, body: 'x' }); }
    if (url.origin !== ORIGIN) return route.abort(); const file = path.join(ROOT, decodeURIComponent(url.pathname));
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return route.fulfill({ status: 404, body: 'nf' }); route.fulfill({ status: 200, contentType: TYPES[path.extname(file)] ?? 'application/octet-stream', body: fs.readFileSync(file) }); });
  const v = await context.newPage(); await v.goto(ORIGIN + '/apps/viewer-web/index.html?startup=skip'); await v.waitForFunction(() => window.glow, null, { timeout: 30000 });
  await v.evaluate(() => window.glow.load({ pdb: '6N2Y' })); await v.waitForTimeout(2500);
  await v.screenshot({ path: path.join(OUT, 'viewer-collapsed.png') });
  await v.evaluate(() => document.querySelectorAll('details').forEach((d) => { d.open = true; })); await v.waitForTimeout(500);
  await v.screenshot({ path: path.join(OUT, 'viewer-expanded.png'), fullPage: false });
  console.log('viewer panel height', await v.evaluate(() => { const p = document.querySelector('#panel, .panel, aside'); return p ? [p.id || p.className, p.scrollHeight, p.clientHeight] : null; }));
  const s = await context.newPage(); await s.goto(ORIGIN + '/apps/studio-web/index.html'); await s.waitForSelector('#tab-tools', { timeout: 30000 }); await s.waitForTimeout(1500);
  await s.screenshot({ path: path.join(OUT, 'studio.png') });
  for (const t of ['tab-tools', 'tab-story', 'tab-publish']) { await s.click('#' + t); await s.evaluate(() => document.querySelectorAll('details').forEach((d) => { d.open = true; })); await s.waitForTimeout(300); await s.screenshot({ path: path.join(OUT, `studio-${t}.png`) }); }
  await browser.close(); console.log('shots in', OUT);
})().catch((e) => { console.error(e); process.exit(1); });
