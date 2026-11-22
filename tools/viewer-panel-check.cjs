// Real-browser check of the Viewer's left panel as pages (apps/viewer-web/panel-tabs.mjs): no control lost (every id in the HTML is still in the document), the pages appear and disappear with what is open,
// a mechanism work brings the 动画 page to the front, a page is short (the old single column was 3400 px), and the keyboard moves between pages. Screenshots of each page go to the output folder.
// Usage: node tools/viewer-panel-check.cjs [output-dir] [structures-dir]   (node tools/fetch-smoke-structures.mjs --dir desktop/dist/smoke-structures; Playwright with Chromium)
const { chromium } = require('playwright'); const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const ROOT = path.resolve(__dirname, '..'), ORIGIN = 'http://localhost:8765', OUT = process.argv[2] || 'docs/images', FIX = path.resolve(process.argv[3] || path.join(ROOT, 'desktop/dist/smoke-structures'));
const TYPES = { '.html': 'text/html', '.mjs': 'text/javascript', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.glow': 'application/json', '.png': 'image/png' };
const htmlIds = [...fs.readFileSync(path.join(ROOT, 'apps/viewer-web/index.html'), 'utf8').matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
setTimeout(() => { console.error('the check hung (a frozen page does not answer Playwright\'s own timeouts)'); process.exit(1); }, 420000).unref?.();
(async () => {
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] }), context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.route('**/*', (route) => { const url = new URL(route.request().url()), cdn = /^https:\/\/cdn\.jsdelivr\.net\/npm\/three@0\.160\.0\/(.+)$/.exec(url.href), rcsb = /^https:\/\/files\.rcsb\.org\/download\/([0-9A-Za-z]{4})\.cif$/.exec(url.href);
    if (cdn) { const f = [path.join(ROOT, 'desktop/vendor/three', cdn[1]), path.join(ROOT, 'desktop/node_modules/three', cdn[1])].find((x) => fs.existsSync(x)) ?? ''; return fs.existsSync(f) ? route.fulfill({ status: 200, contentType: 'text/javascript', body: fs.readFileSync(f) }) : route.abort(); }
    if (rcsb) { const f = path.join(FIX, rcsb[1].toUpperCase() + '.cif'); return fs.existsSync(f) ? route.fulfill({ status: 200, contentType: 'text/plain', body: fs.readFileSync(f) }) : route.fulfill({ status: 404, body: 'x' }); }
    if (url.origin !== ORIGIN) return route.abort(); const file = path.join(ROOT, decodeURIComponent(url.pathname));
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return route.fulfill({ status: 404, body: 'nf' }); route.fulfill({ status: 200, contentType: TYPES[path.extname(file)] ?? 'application/octet-stream', body: fs.readFileSync(file) }); });
  const page = await context.newPage(), errors = []; page.on('pageerror', (e) => errors.push(e.message));
  const tabs = () => page.$$eval('.panel-tabs button', (b) => b.map((x) => ({ id: x.id.replace('panel-tab-', ''), label: x.textContent, hidden: x.hidden, on: x.getAttribute('aria-selected') === 'true' })));
  const visibleTabs = async () => (await tabs()).filter((t) => !t.hidden).map((t) => t.label);
  await page.goto(ORIGIN + '/apps/viewer-web/index.html?startup=skip'); await page.waitForFunction(() => window.glow, null, { timeout: 30000 });
  // nothing lost
  const present = await page.evaluate((ids) => ids.filter((id) => !document.getElementById(id)), htmlIds); assert.deepEqual(present, [], 'every control of the HTML is still in the document');
  assert.equal(await page.$('#structure-tools') !== null, true, 'the old accordion element is kept (its open state is still read)');
  // empty: only the pages that have something
  assert.deepEqual(await visibleTabs(), ['场景', '结构'], 'with nothing open: the scene page (hint) and the structure page (open a structure)');
  assert.equal(await page.locator('#panel-pane-structure #rcsb-form').count(), 1, 'the RCSB form lives on the structure page');
  await page.screenshot({ path: path.join(OUT, 'viewer-panel-empty.png') });
  // a structure
  await page.evaluate(() => window.glow.load({ pdb: '4AKE' })); await page.waitForFunction(() => !document.querySelector('#selection-form').hidden, null, { timeout: 60000 }); await page.waitForTimeout(800);
  const labels = await visibleTabs(); assert.ok(labels.includes('选择') && labels.includes('结构'), `pages after a structure: ${labels}`);
  let tallest = 0;
  for (const tab of await tabs()) {
    if (tab.hidden) continue; await page.click(`#panel-tab-${tab.id}`);
    assert.equal(await page.$eval(`#panel-pane-${tab.id}`, (n) => !n.hidden), true); assert.equal(await page.$$eval('.panel-pane', (p) => p.filter((n) => !n.hidden).length), 1, 'one page at a time');
    const h = await page.$eval(`#panel-pane-${tab.id}`, (n) => n.scrollHeight); tallest = Math.max(tallest, h); console.log(`page ${tab.label}: ${h} px of content`);
    await page.screenshot({ path: path.join(OUT, `viewer-panel-${tab.id}.png`) });
  }
  assert.ok(tallest < 1500, `the tallest page is ${tallest} px (the old column was 3389)`);
  // keyboard
  await page.click('#panel-tab-structure'); await page.focus('#panel-tab-structure'); await page.keyboard.press('ArrowRight');
  assert.equal((await tabs()).find((t) => t.on).id, 'select', 'the right arrow moves to the next page');
  // a selection comes to the structure page
  await page.evaluate(() => window.glow.select({ chainId: 'A', residueId: '30' })); await page.waitForTimeout(500);
  assert.equal((await tabs()).find((t) => t.on).id, 'structure', 'picking a residue shows the structure page (its card is there)');
  // a mechanism work brings the animation page
  await page.goto(ORIGIN + '/apps/viewer-web/index.html?startup=skip&work=official.adenylate-kinase.work'); await page.waitForFunction(() => window.glow, null, { timeout: 30000 });
  await page.waitForFunction(() => !document.querySelector('#mechanism-controls').hidden, null, { timeout: 120000 }); await page.waitForTimeout(500);
  assert.equal((await tabs()).find((t) => t.on).id, 'animate', 'a mechanism work opens the animation page'); await page.screenshot({ path: path.join(OUT, 'viewer-panel-mechanism.png') });
  assert.deepEqual(errors, [], 'no page errors'); await browser.close(); console.log('viewer panel: ok');
})().catch((e) => { console.error(e); process.exit(1); });
