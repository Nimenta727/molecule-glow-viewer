const { chromium } = require('playwright'); const fs = require('node:fs'), path = require('node:path');
// Real-browser check of the local works in the Viewer (and, with STUDIO=1, in the Studio): open a .glow, see it in the workshop's 本地 zone by its name, open it again from there, export it under its name, rename and remove it.
//   node tools/local-works-check.cjs <work.glow> <out.png>
const ROOT = require('node:path').resolve(__dirname, '..'), ORIGIN = 'http://localhost:8765', FILE = process.argv[2], OUT = process.argv[3];
const TYPES = { '.html': 'text/html', '.mjs': 'text/javascript', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
(async () => {
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] }), context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await context.route('**/*', (route) => { const url = new URL(route.request().url()), cdn = /^https:\/\/cdn\.jsdelivr\.net\/npm\/three@0\.160\.0\/(.+)$/.exec(url.href);
    if (cdn) { const f = [path.join(ROOT, 'desktop/vendor/three', cdn[1]), path.join(ROOT, 'desktop/node_modules/three', cdn[1])].find((x) => fs.existsSync(x)) ?? ''; return fs.existsSync(f) ? route.fulfill({ status: 200, contentType: 'text/javascript', body: fs.readFileSync(f) }) : route.abort(); }
    if (url.origin !== ORIGIN) return route.abort(); const file = path.join(ROOT, decodeURIComponent(url.pathname));
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) return route.fulfill({ status: 404, body: 'nf' }); route.fulfill({ status: 200, contentType: TYPES[path.extname(file)] ?? 'application/octet-stream', body: fs.readFileSync(file) }); });
  const page = await context.newPage(), errors = []; page.on('pageerror', (e) => errors.push(e.message)); page.on('console', (m) => { if (m.type() === 'warning' && !/GL Driver/.test(m.text())) console.log('warn', m.text().slice(0, 160)); });
  const assert = require('node:assert/strict');
  if (process.env.STUDIO) {
    await page.goto(ORIGIN + '/apps/studio-web/index.html'); await page.waitForFunction(() => window.studio, null, { timeout: 30000 });
    await page.setInputFiles('#package-file', FILE);
    await page.waitForFunction(() => /本地/.test(document.getElementById('status')?.textContent ?? ''), null, { timeout: 120000 });
    await page.click('#workshop'); await page.waitForSelector('#workshop-tab-local', { timeout: 10000 }); await page.click('#workshop-tab-local'); await page.waitForTimeout(800);
    const names = await page.evaluate(() => [...document.querySelectorAll('.workshop-local-item h3')].map((n) => n.textContent)); console.log('studio local zone names:', JSON.stringify(names)); assert.equal(names.length, 1);
    await page.locator('.workshop-local-item button', { hasText: '打开' }).click(); await page.waitForFunction(() => !document.querySelector('dialog.workshop')?.open, null, { timeout: 120000 });
    console.log('studio scenes after reopen:', await page.evaluate(() => window.studio.info().then((r) => r.scene.title))); console.log('errors', JSON.stringify(errors)); if (errors.length) process.exitCode = 1;
    await browser.close(); return;
  }
  await page.addInitScript(() => { const click = HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click = function () { if (this.download) window.__download = this.download; return click.call(this); }; });   // what name the page asked for (the headless browser reports non-ASCII names as just "download")
  await page.goto(ORIGIN + '/apps/viewer-web/index.html?startup=skip'); await page.waitForFunction(() => window.glow, null, { timeout: 30000 });
  await page.click('#panel-tab-structure'); await page.check('#structure-enabled'); await page.waitForTimeout(1500);
  const status = () => page.evaluate(() => document.querySelector('#status')?.textContent);
  await page.setInputFiles('#file', FILE);
  await page.waitForFunction(() => /本地/.test(document.querySelector('#status')?.textContent ?? ''), null, { timeout: 120000 });
  console.log('status after open:', await status());
  await page.click('#workshop'); await page.waitForSelector('#workshop-tab-local', { timeout: 10000 }); await page.click('#workshop-tab-local'); await page.waitForTimeout(800);
  const names = await page.evaluate(() => [...document.querySelectorAll('.workshop-local-item h3')].map((n) => n.textContent)); console.log('local zone names:', JSON.stringify(names));
  assert.ok(names.length === 1 && names[0].length > 2, 'the opened work is listed by its name');
  console.log('meta:', await page.evaluate(() => document.querySelector('.workshop-local-item .workshop-meta').textContent));
  await page.screenshot({ path: OUT });
  await page.locator('.workshop-local-item button', { hasText: '导出' }).click(); await page.waitForTimeout(1500);
  const asked = await page.evaluate(() => window.__download); console.log('export file name asked for:', asked);
  assert.ok(asked?.endsWith('.glow') && !/[0-9a-f]{8}-[0-9a-f]{4}/.test(asked) && asked.startsWith('T7'), 'named after the title, not the id');
  page.once('dialog', (d) => d.accept('我改的名字'));
  await page.locator('.workshop-local-item button', { hasText: '改名' }).click(); await page.waitForTimeout(800);
  console.log('after rename:', JSON.stringify(await page.evaluate(() => [...document.querySelectorAll('.workshop-local-item h3')].map((n) => n.textContent))));
  await page.locator('.workshop-local-item button', { hasText: '打开' }).click(); await page.waitForFunction(() => !document.querySelector('dialog.workshop')?.open, null, { timeout: 120000 }); await page.waitForTimeout(3000);
  console.log('status after reopen from 本地:', await status());
  await page.click('#workshop'); await page.click('#workshop-tab-local'); await page.waitForTimeout(500);
  page.once('dialog', (d) => d.accept()); await page.locator('.workshop-local-item button', { hasText: '删除' }).click(); await page.waitForTimeout(800);
  console.log('after remove:', await page.evaluate(() => document.querySelector('.workshop-list').textContent.slice(0, 40)));
  console.log('errors', JSON.stringify(errors)); if (errors.length) process.exitCode = 1;
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
