// Real-browser check of the workshop's "我的模板" zone in the Viewer: a real structure file is imported with a stated licence (and refused without one), the card shows what the file says, the template opens as a
// structure, it survives a reload (IndexedDB), a PDB entry is added by its code, a template package is exported and imported back, and a template is deleted.
// Usage: node tools/template-zone-check.cjs [output-dir] [structures-dir]   (node tools/fetch-smoke-structures.mjs --dir desktop/dist/smoke-structures; Playwright with Chromium)
const { chromium } = require('playwright'); const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), assert = require('node:assert/strict');
const ROOT = path.resolve(__dirname, '..'), ORIGIN = 'http://localhost:8765', OUT = process.argv[2] || 'docs/images', FIXTURES = path.resolve(process.argv[3] || path.join(ROOT, 'desktop/dist/smoke-structures'));
const TYPES = { '.html': 'text/html', '.mjs': 'text/javascript', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg' };
(async () => {
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const context = await browser.newContext({ viewport: { width: 1100, height: 1000 }, acceptDownloads: true });
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
  const openZone = async () => { await page.click('#workshop'); await page.waitForSelector('.workshop-card'); await page.click('#workshop-tab-mine'); await page.waitForSelector('.workshop-template-form'); };
  const openForm = () => page.evaluate(() => { document.querySelector('.workshop-template-form').open = true; });
  const note = () => page.$eval('.workshop-note', (n) => n.textContent);
  await page.goto(ORIGIN + '/apps/viewer-web/index.html?startup=skip'); await page.waitForFunction(() => window.glow, null, { timeout: 30000 });
  await openZone();
  assert.equal(await page.$eval('#workshop-tab-templates', (n) => n.textContent), '静态作品', 'the old "模板区" is now called 静态作品');
  assert.match(await page.$eval('.workshop-empty', (n) => n.textContent), /还没有模板/);
  await openForm();
  const form = page.locator('.workshop-template-form');
  // 1. a real file, no licence: refused with the reason
  await form.locator('input[type=file]').setInputFiles(path.join(FIXTURES, '4AKE.cif')); await form.locator('button', { hasText: '导入' }).click();
  await page.waitForFunction(() => /请选择授权方式/.test(document.querySelector('.workshop-note').textContent)); assert.equal(await page.locator('.workshop-template').count(), 0, 'nothing was added');
  // 2. with CC BY but no credit: refused; with credit: added
  await form.locator('select').selectOption('CC-BY-4.0'); await form.locator('button', { hasText: '导入' }).click();
  await page.waitForFunction(() => /要求署名/.test(document.querySelector('.workshop-note').textContent));
  await form.locator('input[aria-label="署名"]').fill('测试者 2026'); await form.locator('input[aria-label="名称"]').fill('我的腺苷酸激酶'); await form.locator('textarea').fill('张开态，来自 PDB 的副本');
  await form.locator('button', { hasText: '导入' }).click(); await page.waitForSelector('.workshop-template');
  const card = page.locator('.workshop-template').first(), text = await card.innerText();
  for (const word of ['我的腺苷酸激酶', 'X-RAY DIFFRACTION', '2.2 Å', 'Escherichia coli', 'ADENYLATE KINASE', 'CC BY 4.0', '署名：测试者 2026', '可嵌入作品', '本机文件', '张开态，来自 PDB 的副本']) assert.ok(text.includes(word), `the card shows ${word}`);
  assert.equal(await card.locator('a[href^="https://doi.org/10.1016/S0969-2126"]').count(), 1, 'the DOI links to the paper');
  await page.screenshot({ path: path.join(OUT, 'workshop-my-templates.png') });
  // 3. the same file again is the same template
  await form.locator('input[type=file]').setInputFiles(path.join(FIXTURES, '4AKE.cif')); await form.locator('button', { hasText: '导入' }).click();
  await page.waitForFunction(() => /已经在模板库里了/.test(document.querySelector('.workshop-note').textContent)); assert.equal(await page.locator('.workshop-template').count(), 1);
  // 4. it opens as a structure
  await card.locator('button', { hasText: '打开结构' }).click(); await page.waitForFunction(() => !document.querySelector('dialog.workshop')?.open, null, { timeout: 60000 }).catch(async () => { throw new Error('open failed, note: ' + await note()); });
  await page.waitForFunction(() => window.glow.info().scene && /4ake|adenylate/i.test(JSON.stringify(window.glow.info())), null, { timeout: 60000 }).catch(() => {});
  const info = await page.evaluate(() => window.glow.info()); assert.ok(info.scene || info.sceneId || info.title, 'a scene is open'); console.log('opened:', JSON.stringify(info).slice(0, 160));
  // 5. a reload keeps it
  await page.reload(); await page.waitForFunction(() => window.glow, null, { timeout: 30000 }); await openZone(); await page.waitForSelector('.workshop-template');
  assert.equal(await page.locator('.workshop-template h3').first().innerText(), '我的腺苷酸激酶', 'the template survived a reload');
  // 6. a PDB entry by its code (CC0, from the PDB)
  await openForm(); await page.fill('input[aria-label="PDB 编号"]', '1ake'); await page.locator('button', { hasText: '从 PDB 添加' }).click();
  await page.waitForFunction(() => document.querySelectorAll('.workshop-template').length === 2, null, { timeout: 60000 });
  const pdbCard = page.locator('.workshop-template', { hasText: '来自 PDB' }).first(); assert.ok((await pdbCard.innerText()).includes('CC0'), 'a PDB entry is CC0');
  // 7. export a package, delete the template, import the package back
  const [download] = await Promise.all([page.waitForEvent('download'), pdbCard.locator('button', { hasText: '导出模板包' }).click()]);
  const packFile = path.join(os.tmpdir(), `check-${process.pid}.glowtpl`); await download.saveAs(packFile); assert.match(download.suggestedFilename(), /^1AKE\.glowtpl$/); assert.equal(fs.readFileSync(packFile).subarray(0, 2).toString(), 'PK');
  await pdbCard.locator('button.workshop-danger').click(); await pdbCard.locator('button.workshop-danger').click(); await page.waitForFunction(() => document.querySelectorAll('.workshop-template').length === 1);
  await openForm(); await form.locator('input[type=file]').setInputFiles(packFile); await form.locator('button', { hasText: '导入' }).click();
  await page.waitForFunction(() => document.querySelectorAll('.workshop-template').length === 2, null, { timeout: 30000 });
  const back = page.locator('.workshop-template', { hasText: '来自模板包' }).first(); const backText = await back.innerText(); assert.ok(backText.includes('模板包自称来源'), 'a package’s claim of origin is kept as a claim'); assert.ok(!backText.includes('来自 PDB'), 'and not as the real thing');
  // 8. search
  await page.fill('input[type=search]', 'escherichia'); await page.waitForFunction(() => document.querySelectorAll('.workshop-template').length === 2); await page.fill('input[type=search]', 'zzzz'); await page.waitForSelector('.workshop-empty');
  // 9. a file that is not a structure
  await page.fill('input[type=search]', ''); fs.writeFileSync(path.join(os.tmpdir(), 'notes.cif'), 'hello, this is not a structure\n'); await form.locator('input[type=file]').setInputFiles(path.join(os.tmpdir(), 'notes.cif')); await form.locator('select').selectOption('CC0-1.0'); await form.locator('button', { hasText: '导入' }).click();
  await page.waitForFunction(() => /没有读到|不像|没有从文件里读到/.test(document.querySelector('.workshop-note').textContent));
  await page.setViewportSize({ width: 390, height: 900 }); await page.screenshot({ path: path.join(OUT, 'workshop-my-templates-narrow.png') });
  assert.deepEqual(errors, [], 'no page errors'); await browser.close(); console.log('template zone: ok');
})().catch((e) => { console.error(e); process.exit(1); });
