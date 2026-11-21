// Measures what the renderer is asked to draw for real works: the last frame's triangles, points, lines and draw calls (hardware independent; frame rates are not, and software rendering says
// nothing about a GPU). Used to size the cell-level plan (docs/PLUGIN_ROADMAP.md). Usage: node tools/render-cost.cjs <work-id>...   (Playwright with Chromium; structures from node tools/fetch-smoke-structures.mjs)
const { chromium } = require('playwright'); const fs = require('node:fs'), path = require('node:path');
const ROOT = path.resolve(__dirname, '..'), ORIGIN = 'http://localhost:8765', FIXTURES = path.join(ROOT, 'desktop/dist/smoke-structures'), IDS = process.argv.slice(2);
const TYPES = { '.html': 'text/html', '.mjs': 'text/javascript', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.glow': 'application/json' };
(async () => {
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await context.route('**/*', (route) => {
    const url = new URL(route.request().url()), cdn = /^https:\/\/cdn\.jsdelivr\.net\/npm\/three@0\.160\.0\/(.+)$/.exec(url.href), rcsb = /^https:\/\/files\.rcsb\.org\/download\/([0-9A-Za-z]{4})\.cif$/.exec(url.href);
    if (cdn) { const f = [path.join(ROOT, 'desktop/vendor/three', cdn[1]), path.join(ROOT, 'desktop/node_modules/three', cdn[1])].find((file) => fs.existsSync(file)) ?? ''; return fs.existsSync(f) ? route.fulfill({ status: 200, contentType: 'text/javascript', body: fs.readFileSync(f) }) : route.abort(); }
    if (rcsb) { const f = path.join(FIXTURES, rcsb[1].toUpperCase() + '.cif'); return fs.existsSync(f) ? route.fulfill({ status: 200, contentType: 'text/plain', body: fs.readFileSync(f) }) : route.fulfill({ status: 404, body: 'not pinned' }); }
    if (url.origin !== ORIGIN) return route.abort();
    const file = path.join(ROOT, decodeURIComponent(url.pathname));
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return route.fulfill({ status: 404, body: 'not found' });
    route.fulfill({ status: 200, contentType: TYPES[path.extname(file)] ?? 'application/octet-stream', body: fs.readFileSync(file) });
  });
  for (const id of IDS) {
    const page = await context.newPage();
    try {
      await page.goto(`${ORIGIN}/apps/viewer-web/index.html?startup=skip&work=${encodeURIComponent(id)}`);
      await page.waitForFunction(() => window.__glowStats, null, { timeout: 30000 });
      await page.waitForFunction(() => window.glow.info().then((i) => i && i.title), null, { timeout: 180000 }).catch(() => {});
      await page.waitForFunction(() => window.__glowStats().objects > 20, null, { timeout: 280000 }).catch(() => {});   // big structures take a while to parse in software
      await page.waitForTimeout(8000);
      const s = await page.evaluate(() => window.__glowStats());
      console.log(id.padEnd(40), JSON.stringify(s));
    } catch (e) { console.log(id, 'ERR', e.message.slice(0, 100)); }
    await page.close();
  }
  await browser.close();
})();
