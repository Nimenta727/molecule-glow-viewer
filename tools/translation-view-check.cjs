// Real-browser check of the translation work's ribosome view: opens official.translation.work, plays it, prints the view's status (tRNAs, chain, mRNA) every 2 s and the particle sets drawn,
// and saves screenshots with the automatic cutaway. Usage: node tools/translation-view-check.cjs official.translation.work <unused> (fixtures: 4V6F and the ten factor/antibiotic entries in desktop/dist/smoke-structures)
// Opens a workshop work, presses the timeline's play button and screenshots it at two later times (for works whose playback is the timeline, not the data-animation panel).
// Usage: node tools/timeline-shot.cjs <work-id> [output-dir] [fixtures-dir]
// Opens a workshop work in the real Viewer (Playwright + Chromium, the repository served by request interception, structures from the pinned fixtures), runs its animation for a few seconds and
// saves screenshots: the whole page and the animation panel (counters, energy strip, read-outs). For looking at what the notes say nobody has seen yet.
// SHOT_W / SHOT_H set the page size (a smaller page renders faster), SHOT_PACE the animation pace (0.3-3).
// Usage: node tools/work-shot.cjs <work-id> [output-dir] [seconds] [fixtures-dir]     e.g.  node tools/work-shot.cjs official.respiratory-chain.work docs/images 6
const { chromium } = require('playwright'); const fs = require('node:fs'), path = require('node:path');
const ROOT = path.resolve(__dirname, '..'), ORIGIN = 'http://localhost:8765', ID = process.argv[2], OUT = path.resolve(process.argv[3] || path.join(ROOT, 'docs/images')), SECONDS = 0, FIXTURES = path.resolve(process.argv[5] || path.join(ROOT, 'desktop/dist/smoke-structures'));
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
  const page = await context.newPage(); page.on('pageerror', (e) => console.log('pageerror', e.message.slice(0, 300))); page.on('requestfailed', (r) => console.log('FAILED REQ', r.url().slice(0, 150))); page.on('response', (r) => { if (r.status() === 404) console.log('404', r.url().slice(0, 150)); }); page.on('console', (m) => { if (m.type() === 'error') console.log('console.error', m.text().slice(0, 200)); });
  await page.goto(`${ORIGIN}/apps/viewer-web/index.html?startup=skip&work=${encodeURIComponent(ID)}`);
  for (let i = 0; i < 120; i++) { await page.evaluate(() => document.querySelectorAll('details').forEach((d) => { d.open = true; })); if (await page.locator('#process-play').isVisible()) break; await page.waitForTimeout(2000); }
  await page.waitForFunction(() => /就绪/.test(document.querySelector('#status').textContent), null, { timeout: 300000 });
  const info = async (label) => console.log(label, '|', await page.$eval('#status', (n) => n.textContent), '|', JSON.stringify(await page.evaluate(() => window.__glowStats())).slice(0, 300), '| closeup visible:', await page.$eval('#ribosome-closeup', (n) => !n.hidden));
  await info('loaded');
  await page.check('#process-play'); for (let i = 0; i < 6; i++) { await page.waitForTimeout(2000); console.log('t', 2 * i + 2, JSON.stringify((await page.evaluate(() => window.__glowStats())).ribosome), JSON.stringify((await page.evaluate(() => window.__glowStats())).clouds)); }
  console.log('clipping after load', JSON.stringify(await page.evaluate(() => window.glow.clip())).slice(0, 160));
  await page.screenshot({ path: require('node:os').tmpdir() + '/translation-auto-cut.png' }); await info('auto cut');
  console.log('focus', JSON.stringify(await page.evaluate(() => window.glow.camera({ focus: 'entity "tRNA"' }).catch((e) => e.message))).slice(0, 200));
  await page.waitForTimeout(6000); await page.screenshot({ path: require('node:os').tmpdir() + '/translation-focus.png' }); await info('focused');
  console.log('readout', await page.$eval('#process-readout', (n) => n.innerText.replace(/\s+/g, ' ').slice(0, 200)));
  console.log('errors:'); await browser.close();
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
