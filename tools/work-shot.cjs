// Opens a workshop work in the real Viewer (Playwright + Chromium, the repository served by request interception, structures from the pinned fixtures), runs its animation for a few seconds and
// saves screenshots: the whole page and the animation panel (counters, energy strip, read-outs). For looking at what the notes say nobody has seen yet.
// SHOT_W / SHOT_H set the page size (a smaller page renders faster), SHOT_PACE the animation pace (0.3-3).
// Usage: node tools/work-shot.cjs <work-id> [output-dir] [seconds] [fixtures-dir]     e.g.  node tools/work-shot.cjs official.respiratory-chain.work docs/images 6
const { chromium } = require('playwright'); const fs = require('node:fs'), path = require('node:path');
const ROOT = path.resolve(__dirname, '..'), ORIGIN = 'http://localhost:8765', ID = process.argv[2], OUT = path.resolve(process.argv[3] || path.join(ROOT, 'docs/images')), SECONDS = Number(process.argv[4] || 6), FIXTURES = path.resolve(process.argv[5] || path.join(ROOT, 'desktop/dist/smoke-structures'));
if (!ID) { console.error('usage: node tools/work-shot.cjs <work-id> [output-dir] [seconds] [fixtures-dir]'); process.exit(2); }
const TYPES = { '.html': 'text/html', '.mjs': 'text/javascript', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.glow': 'application/json', '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml' };
(async () => {
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const context = await browser.newContext({ viewport: { width: Number(process.env.SHOT_W || 1360), height: Number(process.env.SHOT_H || 900) }, deviceScaleFactor: 1 });
  await context.route('**/*', (route) => {
    const url = new URL(route.request().url()), cdn = /^https:\/\/cdn\.jsdelivr\.net\/npm\/three@0\.160\.0\/(.+)$/.exec(url.href), rcsb = /^https:\/\/files\.rcsb\.org\/download\/([0-9A-Za-z]{4})\.cif$/.exec(url.href);
    if (cdn) { const f = [path.join(ROOT, 'desktop/vendor/three', cdn[1]), path.join(ROOT, 'desktop/node_modules/three', cdn[1])].find((file) => fs.existsSync(file)) ?? ''; return fs.existsSync(f) ? route.fulfill({ status: 200, contentType: 'text/javascript', body: fs.readFileSync(f) }) : route.abort(); }
    if (rcsb) { const f = path.join(FIXTURES, rcsb[1].toUpperCase() + '.cif'); if (fs.existsSync(f)) return route.fulfill({ status: 200, contentType: 'text/plain', body: fs.readFileSync(f) }); console.log('not pinned:', rcsb[1]); return route.fulfill({ status: 404, body: 'not pinned' }); }
    if (url.origin !== ORIGIN) return route.abort();
    const file = path.join(ROOT, decodeURIComponent(url.pathname));
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return route.fulfill({ status: 404, body: 'not found' });
    route.fulfill({ status: 200, contentType: TYPES[path.extname(file)] ?? 'application/octet-stream', body: fs.readFileSync(file) });
  });
  const page = await context.newPage(), errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${ORIGIN}/apps/viewer-web/index.html?startup=skip&work=${encodeURIComponent(ID)}`);
  await page.waitForFunction(() => window.glow, null, { timeout: 30000 });
  await page.waitForFunction(() => document.querySelector('#data-play') && !document.querySelector('#data-play').closest('[hidden]'), null, { timeout: 120000 }).catch(() => console.log('the animation panel did not appear'));
  console.log('status:', await page.$eval('#status', (n) => n.textContent).catch(() => '?'));
  await page.screenshot({ path: path.join(OUT, `${ID}-opened.png`) });
  await page.evaluate(() => document.querySelectorAll('details').forEach((d) => { d.open = true; }));   // the animation panel sits in a collapsed section
  if (process.env.SHOT_PACE) await page.evaluate((v) => { const el = document.querySelector('#data-pace'); el.value = v; el.dispatchEvent(new Event('change', { bubbles: true })); }, process.env.SHOT_PACE);   // software rendering makes few frames a second; a higher pace shows more of the cycle in the time given
  const play = await page.$('#data-play');
  if (play && await play.isVisible()) { await play.click(); const lit = []; for (let i = 0; i < SECONDS; i++) { await page.waitForTimeout(1000); lit.push(await page.$eval('#energy-strip', (n) => n.querySelector('[aria-current="true"], .on, .lit, [data-lit="true"]')?.textContent?.trim() ?? '?').catch(() => '?')); } console.log('lit step per second:', lit.join(' | ')); console.log('clock:', await page.$eval('#data-time', (n) => n.textContent).catch(() => '?'), '| play button:', await page.$eval('#data-play', (n) => n.textContent).catch(() => '?')); await play.click().catch(() => {}); }
  await page.screenshot({ path: path.join(OUT, `${ID}-running.png`) });
  const panel = await page.$('#data-counters'); if (panel) console.log('counters:', (await panel.innerText()).replace(/\n+/g, ' | ').slice(0, 300));
  const strip = await page.$('#energy-strip'); if (strip) console.log('energy strip:', (await strip.innerText()).replace(/\n+/g, ' | ').slice(0, 300));
  console.log('warnings:', JSON.stringify((await page.evaluate(() => window.glow.info())).warnings).slice(0, 400)); console.log('errors:', errors.slice(0, 5));
  await browser.close();
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
