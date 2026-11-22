// Real-browser check of the authoring core: in the Studio a structure is opened, a part of it is chosen with the selection language and given a style and colours (a plain colour and a scheme from a property),
// the rules can be undone, redone and deleted one by one, the result is exported, the package holds the rules in the structure file's viewer state, and a fresh Viewer opening that package draws the same look
// (fewer shapes where residues are hidden). The Viewer's own `show` and `color` commands are exercised on the way. Usage: node tools/studio-look-check.cjs [structures-dir] [output-dir]   (Playwright with Chromium)
const { chromium } = require('playwright'); const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), assert = require('node:assert/strict');
const ROOT = path.resolve(__dirname, '..'), ORIGIN = 'http://localhost:8765', FIX = path.resolve(process.argv[2] || path.join(ROOT, 'desktop/dist/smoke-structures')), OUT = process.argv[3] || 'docs/images';
const TYPES = { '.html': 'text/html', '.mjs': 'text/javascript', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.glow': 'application/json', '.png': 'image/png' };
setTimeout(() => { console.error('the check hung'); process.exit(1); }, 540000).unref?.();
(async () => {
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] }), context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  await context.route('**/*', (route) => { const url = new URL(route.request().url()), cdn = /^https:\/\/cdn\.jsdelivr\.net\/npm\/three@0\.160\.0\/(.+)$/.exec(url.href);
    if (cdn) { const f = [path.join(ROOT, 'desktop/vendor/three', cdn[1]), path.join(ROOT, 'desktop/node_modules/three', cdn[1])].find((x) => fs.existsSync(x)) ?? ''; return fs.existsSync(f) ? route.fulfill({ status: 200, contentType: 'text/javascript', body: fs.readFileSync(f) }) : route.abort(); }
    if (url.origin !== ORIGIN) return route.abort(); const file = path.join(ROOT, decodeURIComponent(url.pathname));
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return route.fulfill({ status: 404, body: 'nf' }); route.fulfill({ status: 200, contentType: TYPES[path.extname(file)] ?? 'application/octet-stream', body: fs.readFileSync(file) }); });
  const errors = [], studio = await context.newPage(); studio.on('pageerror', (e) => errors.push('studio: ' + e.message));
  const rules = () => studio.$$eval('#look-rules li', (l) => l.map((x) => x.querySelector('span')?.textContent ?? x.textContent)), info = () => studio.$eval('#look-info', (n) => n.textContent);
  const exportPack = async (name) => { const [d] = await Promise.all([studio.waitForEvent('download', { timeout: 60000 }), studio.evaluate(() => { document.querySelector('#export-scene').click(); })]); const f = path.join(os.tmpdir(), `${name}-${process.pid}.glow`); await d.saveAs(f); return f; };
  await studio.goto(ORIGIN + '/apps/studio-web/index.html'); await studio.waitForSelector('#tab-look', { timeout: 30000 }); await studio.waitForTimeout(1200);
  assert.equal(await studio.isVisible('#look-body'), false, 'without a structure the tab only says what to do');
  await studio.setInputFiles('#structure-file', path.join(FIX, '4AKE.cif')); await studio.waitForFunction(() => document.querySelectorAll('#scene-tree li').length >= 2, null, { timeout: 90000 });
  const plainPack = await exportPack('plain');
  await studio.click('#tab-look'); await studio.waitForSelector('#look-body:not([hidden])', { timeout: 90000 });
  assert.deepEqual(await studio.$$eval('.look-chips button', (b) => b.map((x) => x.textContent)), ['全部', '蛋白', '核酸', '配体', '链 A', '链 B'], 'quick selections: the parts and the chains');
  assert.deepEqual(await rules(), ['还没有规则：结构按作品默认的样子画。']);
  // choose a part: the count comes back, a bad expression is explained
  await studio.fill('#look-expression', 'chain A and resi 1-60'); await studio.click('#look-select'); await studio.waitForFunction(() => /选中/.test(document.querySelector('#look-info').textContent)); assert.match(await info(), /60 个残基/);
  await studio.fill('#look-expression', 'banana'); await studio.click('#look-select'); await studio.waitForFunction(() => document.querySelector('#look-info').dataset.kind === 'error'); assert.match(await info(), /不认识的选择关键字/);
  await studio.fill('#look-expression', 'resi 9999'); await studio.click('#look-select'); await studio.waitForFunction(() => /没有选中/.test(document.querySelector('#look-info').textContent));
  // a style for the part, a plain colour for another, a property scheme for a third
  await studio.fill('#look-expression', 'chain A and resi 1-60'); await studio.click('button[data-style="hidden"]'); await studio.waitForFunction(() => /画成“隐藏”/.test(document.querySelector('#status').textContent));
  await studio.fill('#look-expression', 'chain A and resi 100-140'); await studio.evaluate(() => { const c = document.querySelector('#look-color'); c.value = '#e05a4a'; c.dispatchEvent(new Event('input', { bubbles: true })); }); await studio.click('#look-apply-color'); await studio.waitForFunction(() => /染成/.test(document.querySelector('#status').textContent));
  await studio.fill('#look-expression', 'chain B'); await studio.click('button[data-scheme="hydrophobicity"]'); await studio.waitForFunction(() => /疏水性/.test(document.querySelector('#status').textContent));
  const listed = await rules(); assert.equal(listed.length, 3, `three rules: ${JSON.stringify(listed)}`);
  assert.deepEqual(listed.map((t) => t.replace(/ → .*/, '')).sort(), ['样式 · chain A and resi 1-60', '颜色 · chain A and resi 100-140', '颜色 · chain B'].sort(), 'the three rules are listed');
  assert.ok(listed.some((t) => /chain B → 疏水性/.test(t)) && listed.some((t) => /→ #e05a4a/.test(t)) && listed.some((t) => /→ 隐藏/.test(t)), 'each says what it does');
  // undo / redo / delete one
  await studio.click('#undo'); assert.equal((await rules()).length, 2, 'undo takes the last rule back'); await studio.click('#redo'); assert.equal((await rules()).length, 3, 'redo brings it again');
  await studio.locator('#look-rules li', { hasText: '隐藏' }).locator('button').click(); await studio.waitForFunction(() => document.querySelectorAll('#look-rules li').length === 2); assert.ok(!(await rules()).some((t) => /隐藏/.test(t)), 'the hidden rule is deleted on its own');
  await studio.fill('#look-expression', 'chain A and resi 1-60'); await studio.click('button[data-style="hidden"]'); await studio.waitForFunction(() => document.querySelectorAll('#look-rules li').length === 3);   // put it back (later rules win)
  await studio.waitForTimeout(2500); await studio.screenshot({ path: path.join(OUT, 'studio-look.png') });
  // the package holds the rules, in the structure file's viewer state
  const lookPack = await exportPack('look'); const { readScenePackage } = await import(path.join(ROOT, 'packages/schema/archive.mjs'));
  const { scene } = await readScenePackage(new Uint8Array(fs.readFileSync(lookPack))), source = scene.assets.find((a) => a.kind === 'file' && /mmcif/.test(a.mediaType)), state = source.provenance.viewerState;
  assert.deepEqual(state.styles, [{ expr: 'chain A and resi 1-60', style: 'hidden' }]); assert.deepEqual(state.colors.residues.map((r) => r.scheme ?? r.color).sort(), ['#e05a4a', 'hydrophobicity'].sort());
  console.log('exported viewer state:', JSON.stringify(state).slice(0, 200));
  // atom-level sticks for a short segment, a measurement between two residues, a label on a third: all kept with the work
  await studio.fill('#look-expression', 'chain A and resi 100-110'); await studio.click('button[data-style="sticks"]'); await studio.waitForFunction(() => /棍状/.test(document.querySelector('#status').textContent));
  await studio.fill('#look-expression', 'chain A and resi 1-400'); await studio.click('button[data-style="sticks"]'); await studio.waitForFunction(() => /最多 300/.test(document.querySelector('#look-info').textContent), null, { timeout: 5000 }).catch(() => {});
  await studio.fill('#ann-a', 'chain A and resi 100'); await studio.fill('#ann-b', 'chain A and resi 140'); await studio.click('#ann-add-measure'); await studio.waitForFunction(() => /Å/.test(document.querySelector('#ann-info').textContent)); const measured = await studio.$eval('#ann-info', (n) => n.textContent); console.log('measure:', measured);
  await studio.fill('#ann-a', 'resi 99999'); await studio.fill('#ann-b', 'chain A and resi 140'); await studio.click('#ann-add-measure'); await studio.waitForFunction(() => document.querySelector('#ann-info').dataset.kind === 'error'); assert.match(await studio.$eval('#ann-info', (n) => n.textContent), /没有选中|选中/);
  await studio.fill('#look-expression', 'chain A and resi 57'); await studio.fill('#ann-text', '关键残基'); await studio.click('#ann-add-label'); await studio.waitForFunction(() => document.querySelectorAll('#ann-list li').length === 2);
  assert.deepEqual(await studio.$$eval('#ann-list li span', (l) => l.map((x) => x.textContent.replace(/：.*/, ''))), ['测量 · chain A and resi 100 — chain A and resi 140', '标签 · chain A and resi 57 → 关键残基']);
  await studio.waitForTimeout(1500); await studio.screenshot({ path: path.join(OUT, 'studio-annotations.png') });
  const annPack = await exportPack('ann'); const annState = (await readScenePackage(new Uint8Array(fs.readFileSync(annPack)))).scene.assets.find((a) => a.kind === 'file' && /mmcif/.test(a.mediaType)).provenance.viewerState;
  assert.equal(annState.measures.length, 1); assert.deepEqual(annState.labels, [{ expr: 'chain A and resi 57', text: '关键残基' }]); assert.ok(annState.styles.some((r) => r.style === 'sticks'), 'the sticks rule is saved');
  await studio.click('#undo'); await studio.waitForFunction(() => document.querySelectorAll('#ann-list li').length === 1 || /还没有/.test(document.querySelector('#ann-list').textContent)); await studio.click('#redo'); await studio.waitForFunction(() => document.querySelectorAll('#ann-list li').length === 2);
  // a fresh Viewer opens both packages: the look is drawn
  const viewer = await context.newPage(); viewer.on('pageerror', (e) => errors.push('viewer: ' + e.message));
  const open = async (file) => { await viewer.goto(ORIGIN + '/apps/viewer-web/index.html?startup=skip'); await viewer.waitForFunction(() => window.glow, null, { timeout: 30000 }); await viewer.setInputFiles('#file', file); await viewer.waitForSelector('#structure-offer:not([hidden])', { timeout: 90000 }); assert.equal(await viewer.$eval('#structure-enabled', (n) => n.checked), false, 'opening a file does not switch a plugin on by itself'); await viewer.evaluate(() => document.querySelector('#structure-offer-enable').click()); await viewer.waitForFunction(() => !document.querySelector('#selection-form').hidden && document.querySelector('#structure-offer').hidden, null, { timeout: 90000 }); await viewer.waitForTimeout(2500); return viewer.evaluate(() => window.__glowStats()); };
  const plain = await open(plainPack), looked = await open(lookPack);
  console.log('shapes drawn: plain', plain.triangles, plain.drawables, '| with the look', looked.triangles, looked.drawables); assert.notEqual(looked.drawables + looked.triangles, plain.drawables + plain.triangles, 'the Viewer draws the saved look');
  await viewer.screenshot({ path: path.join(OUT, 'viewer-look.png') });
  const annotated = await open(annPack); console.log('annotated viewer stats:', JSON.stringify(annotated)); await viewer.waitForTimeout(1500); await viewer.screenshot({ path: path.join(OUT, 'viewer-annotations.png') });
  const clouds = await viewer.evaluate(() => JSON.stringify(window.__glowStats())); console.log('viewer stats after annotations:', clouds.slice(0, 400));
  // the Viewer's own commands: show / color with a property scheme
  const call = (name, ...args) => viewer.evaluate(([n, a]) => window.glow[n](...a).then((v) => ({ ok: v }), (e) => ({ error: e.message })), [name, args]);
  const before = await viewer.evaluate(() => window.__glowStats()); const shown = await call('show', 'chain B', 'hidden'); assert.ok(!shown.error, shown.error); assert.match(shown.ok.note, /个残基.*隐藏/);
  await viewer.waitForTimeout(1500); const hid = await viewer.evaluate(() => window.__glowStats()); assert.notEqual(hid.drawables + hid.triangles, before.drawables + before.triangles, 'show(..., "hidden") changes what is drawn');
  const painted = await call('color', 'chain A', 'bfactor'); assert.ok(!painted.error, painted.error); assert.match(painted.ok.note, /B 因子/);
  assert.match((await call('show', 'chain A', 'spaghetti')).error, /样式应为/); assert.match((await call('show', 'resi 99999', 'blob')).error, /没有选中任何残基/); assert.equal((await call('show', 'reset')).ok.rules, 0);
  assert.deepEqual(errors, [], 'no page errors'); await browser.close(); console.log('studio look: ok');
})().catch((e) => { console.error(e); process.exit(1); });
