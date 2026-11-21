// Real-browser check of the workshop's plugin zone in the Viewer: the tab lists the 17 packaged plugins with what each adds and how to use it, a switchable plugin can be turned off (its glow command then
// refuses and says where to turn it back on) and on again, and a plugin whose entry is a tool preset has no switch. Usage: node tools/plugin-zone-check.cjs [output-dir]   (Playwright; Chromium)
const { chromium } = require('playwright'); const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const ROOT = path.resolve(__dirname, '..'), ORIGIN = 'http://localhost:8765', OUT = process.argv[2] || 'docs/images';
const TYPES = { '.html': 'text/html', '.mjs': 'text/javascript', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg' };
(async () => {
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const context = await browser.newContext({ viewport: { width: 1100, height: 900 } });
  await context.route('**/*', (route) => {
    const url = new URL(route.request().url()), cdn = /^https:\/\/cdn\.jsdelivr\.net\/npm\/three@0\.160\.0\/(.+)$/.exec(url.href);
    if (cdn) { const f = [path.join(ROOT, 'desktop/vendor/three', cdn[1]), path.join(ROOT, 'desktop/node_modules/three', cdn[1])].find((file) => fs.existsSync(file)) ?? ''; return fs.existsSync(f) ? route.fulfill({ status: 200, contentType: 'text/javascript', body: fs.readFileSync(f) }) : route.abort(); }
    if (url.origin !== ORIGIN) return route.abort();
    const file = path.join(ROOT, decodeURIComponent(url.pathname));
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return route.fulfill({ status: 404, body: 'not found' });
    route.fulfill({ status: 200, contentType: TYPES[path.extname(file)] ?? 'application/octet-stream', body: fs.readFileSync(file) });
  });
  const page = await context.newPage(), errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(ORIGIN + '/apps/viewer-web/index.html?startup=skip'); await page.waitForFunction(() => window.glow, null, { timeout: 30000 });
  await page.click('#workshop'); await page.waitForSelector('.workshop-card'); await page.click('#workshop-tab-plugins'); await page.waitForSelector('.workshop-plugin');
  assert.equal(await page.$$eval('.workshop-plugin', (n) => n.length), 17, 'all seventeen plugins are listed');
  const embed = page.locator('.workshop-plugin[data-entry="org.glow.plugin.membrane-embedding"]'), text = await embed.innerText();
  for (const word of ['增加的功能', '用法', '入口', '权限', '验证程度', '局限', 'glow.embed()']) assert.ok(text.includes(word), `the card shows ${word}`);
  assert.equal(await page.locator('.workshop-plugin[data-entry="org.glow.plugin.data-sources"]').innerText().then((t) => t.includes('联网')), true, 'the data-source plugin states its network permission');
  assert.equal(await page.locator('.workshop-plugin[data-entry="org.glow.plugin.motor"] button').count(), 0, 'a tool-preset plugin has no switch');
  await page.fill('input[type=search]', 'smoluchowski'); assert.equal(await page.$$eval('.workshop-plugin', (n) => n.length), 1, 'search reads what a plugin adds'); await page.fill('input[type=search]', '');
  await embed.scrollIntoViewIfNeeded(); await page.screenshot({ path: path.join(OUT, 'workshop-plugins.png') });
  // switch it off: the command refuses; on again: it gets past the gate (and then refuses only for lack of a structure)
  await embed.locator('button', { hasText: '停用' }).click();
  const off = await page.evaluate(() => window.glow.embed({ shape: { kind: 'sphere', radius: 100 }, copies: 3 }).then(() => null, (e) => e.message)); assert.match(off, /已停用.*插件区/);
  assert.match(await embed.innerText(), /已停用/);
  await embed.locator('button', { hasText: '启用' }).click();
  const on = await page.evaluate(() => window.glow.embed({ shape: { kind: 'sphere', radius: 100 }, copies: 3 }).then(() => null, (e) => e.message)); assert.doesNotMatch(on, /已停用/); assert.match(on, /请先|场景/);
  await page.setViewportSize({ width: 390, height: 800 }); await page.screenshot({ path: path.join(OUT, 'workshop-plugins-narrow.png') });
  assert.deepEqual(errors, [], 'no page errors'); await browser.close(); console.log('plugin zone: ok');
})().catch((e) => { console.error(e); process.exit(1); });
