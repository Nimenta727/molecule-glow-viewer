// Real-browser check of the Studio's template -> work chain and the new authoring conveniences: a local file is imported as a template with a stated licence, a work is made from it, the work keeps the template's
// licence, credit and scientific card in its resource record (read back from the exported package), the work number can be set (and bad ones are refused with the reason), the file is named after it, and the usual
// shortcuts (Delete, Ctrl+Z) and the File menu work. Usage: node tools/studio-template-work-check.cjs [structures-dir]   (Playwright with Chromium; fixtures from tools/fetch-smoke-structures.mjs)
const { chromium } = require('playwright'); const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), assert = require('node:assert/strict');
const ROOT = path.resolve(__dirname, '..'), ORIGIN = 'http://localhost:8765', FIX = path.resolve(process.argv[2] || path.join(ROOT, 'desktop/dist/smoke-structures'));
const TYPES = { '.html': 'text/html', '.mjs': 'text/javascript', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.glow': 'application/json', '.png': 'image/png' };
(async () => {
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] }), context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  await context.route('**/*', (route) => { const url = new URL(route.request().url()), cdn = /^https:\/\/cdn\.jsdelivr\.net\/npm\/three@0\.160\.0\/(.+)$/.exec(url.href);
    if (cdn) { const f = [path.join(ROOT, 'desktop/vendor/three', cdn[1]), path.join(ROOT, 'desktop/node_modules/three', cdn[1])].find((x) => fs.existsSync(x)) ?? ''; return fs.existsSync(f) ? route.fulfill({ status: 200, contentType: 'text/javascript', body: fs.readFileSync(f) }) : route.abort(); }
    if (url.origin !== ORIGIN) return route.abort(); const file = path.join(ROOT, decodeURIComponent(url.pathname));
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return route.fulfill({ status: 404, body: 'nf' }); route.fulfill({ status: 200, contentType: TYPES[path.extname(file)] ?? 'application/octet-stream', body: fs.readFileSync(file) }); });
  const page = await context.newPage(), errors = []; page.on('pageerror', (e) => errors.push(e.message));
  const status = () => page.$eval('#status', (n) => n.textContent), rows = () => page.$$eval('#scene-tree li', (l) => l.length);
  await page.goto(ORIGIN + '/apps/studio-web/index.html'); await page.waitForSelector('#workshop', { timeout: 30000 }); await page.waitForTimeout(1200);

  // the File menu: the import/open actions live in it; Escape closes it
  assert.equal(await page.isVisible('#import-structure'), false, 'the import action is inside the closed File menu'); await page.click('#menu-file > summary'); assert.equal(await page.isVisible('#import-structure'), true);
  await page.keyboard.press('Escape'); assert.equal(await page.isVisible('#import-structure'), false, 'Escape closes the menu');
  assert.equal(await page.isVisible('#export-scene'), true, 'the primary actions stay on the bar');

  // a local file becomes a template with a stated licence ...
  await page.click('#workshop'); await page.waitForSelector('.workshop-card'); await page.click('#workshop-tab-mine'); await page.waitForSelector('.workshop-template-form');
  await page.evaluate(() => { document.querySelector('.workshop-template-form').open = true; }); const form = page.locator('.workshop-template-form');
  await form.locator('input[type=file]').setInputFiles(path.join(FIX, '4AKE.cif')); await form.locator('select').selectOption('CC-BY-4.0'); await form.locator('input[aria-label="署名"]').fill('测试实验室 2026');
  await form.locator('button', { hasText: '导入' }).click(); await page.waitForSelector('.workshop-template');
  // ... and a work is made from it
  await page.locator('.workshop-template button', { hasText: '用此模板新建作品' }).click(); await page.waitForFunction(() => /已用模板/.test(document.querySelector('#status').textContent), null, { timeout: 90000 });
  await page.waitForFunction(() => document.querySelectorAll('#scene-tree li').length >= 2, null, { timeout: 60000 }); await page.waitForTimeout(1500);

  // the work number: generated at first, bad ones refused with the reason, a good one applied
  await page.click('#tab-publish'); const generated = await page.inputValue('#pub-id'); assert.match(generated, /^4ake-[0-9a-f-]{36}$/, `a generated number: ${generated}`);
  for (const [bad, pattern] of [['AB', /小写字母/], ['official.mine', /official/], ['x', /小写字母/]]) { await page.fill('#pub-id', bad); await page.click('#pub-id-apply'); assert.match(await page.$eval('#pub-note', (n) => n.textContent), pattern, bad); assert.equal(await page.$eval('#scene-picker', (n) => n.value), generated, 'the number did not change'); }
  await page.fill('#pub-id', 'adk-open-copy'); await page.click('#pub-id-apply'); await page.waitForFunction(() => /作品编号已设为 adk-open-copy/.test(document.querySelector('#status').textContent));
  assert.equal(await page.$eval('#scene-picker', (n) => n.value), 'adk-open-copy', 'the scene is listed under the new number'); assert.equal(await rows(), 2, 'its parts came along'); assert.equal(await page.inputValue('#pub-id'), 'adk-open-copy');
  assert.equal(await page.$eval('#undo', (n) => n.disabled), true, 'the undo history started again (said in the hint)');

  // shortcuts: Delete removes the selected part, Ctrl+Z brings it back
  await page.click('#add-box'); await page.waitForFunction(() => document.querySelectorAll('#scene-tree li').length === 3); await page.locator('#scene-tree').click({ position: { x: 3, y: 3 }, force: true }).catch(() => {});
  await page.evaluate(() => document.activeElement?.blur?.()); await page.keyboard.press('Delete'); await page.waitForFunction(() => document.querySelectorAll('#scene-tree li').length === 2, null, { timeout: 5000 });
  await page.keyboard.press('Control+z'); await page.waitForFunction(() => document.querySelectorAll('#scene-tree li').length === 3, null, { timeout: 5000 });
  await page.fill('#project-title', 'x'); await page.press('#project-title', 'Backspace'); assert.equal(await rows(), 3, 'Backspace in a text field does not delete a part');
  await page.click('#undo'); await page.waitForFunction(() => document.querySelectorAll('#scene-tree li').length === 2);

  // publish: fill in and export; the file is named after the number
  await page.click('#pub-catalog'); await page.waitForFunction(() => /已读取工坊目录/.test(document.querySelector('#pub-note').textContent), null, { timeout: 20000 });
  await page.fill('#pub-author', '测试者'); await page.selectOption('#pub-license', 'CC-BY-4.0'); await page.selectOption('#pub-topic', 'protein'); await page.fill('#pub-description', '用模板做的作品，检查授权和科研信息是否带过来。'); await page.click('#pub-today');
  await page.click('#pub-check'); await page.waitForTimeout(500); const check = await page.$eval('#pub-note', (n) => n.textContent); assert.match(check, /检查通过/, check);
  const [download] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), page.click('#pub-export')]); assert.equal(download.suggestedFilename(), 'adk-open-copy.glow', 'the file is named after the work number');
  const file = path.join(os.tmpdir(), `check-${process.pid}.glow`); await download.saveAs(file);
  const { readScenePackage } = await import(path.join(ROOT, 'packages/schema/archive.mjs')); const { scene } = await readScenePackage(new Uint8Array(fs.readFileSync(file)));
  assert.equal(scene.id, 'adk-open-copy'); const [record] = scene.resources;
  assert.deepEqual(record.attribution, { license: 'CC-BY-4.0', credit: '测试实验室 2026', embedAllowed: true }, 'the licence the person chose for the template travelled into the work');
  assert.equal(record.card.method, 'X-RAY DIFFRACTION'); assert.equal(record.card.resolution, '2.2 Å'); assert.equal(record.card.species, 'Escherichia coli'); assert.match(record.card.chains, /ADENYLATE KINASE 214 aa/);
  assert.ok(scene.assets.some((a) => a.kind === 'file' && a.resource?.id === record.id), 'the structure file is embedded (the licence allows it)');
  console.log('exported', download.suggestedFilename(), '| card:', JSON.stringify(record.card).slice(0, 160));
  assert.deepEqual(errors, [], 'no page errors'); await browser.close(); console.log('studio template work: ok');
})().catch((e) => { console.error(e); process.exit(1); });
