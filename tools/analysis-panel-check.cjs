// Real-browser check of the first analysis panel (interface contacts): part A comes from the selection, part B is typed; the interface is computed, painted and recorded as derived evidence; the export holds the colour rules, the panel data and the evidence.
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
  const FIX = path.resolve(process.argv[2] || path.join(ROOT, "desktop/dist/smoke-structures"));
  const errors = [], studio = await context.newPage(); studio.on('pageerror', (e) => errors.push('studio: ' + e.message));
  const exportPack = async (name) => { const [d] = await Promise.all([studio.waitForEvent('download', { timeout: 60000 }), studio.evaluate(() => { document.querySelector('#export-scene').click(); })]); const f = path.join(os.tmpdir(), `${name}-${process.pid}.glow`); await d.saveAs(f); return f; };
  await studio.goto(ORIGIN + '/apps/studio-web/index.html'); await studio.waitForSelector('#tab-analysis', { timeout: 30000 }); await studio.waitForTimeout(1200);
  await studio.click('#tab-analysis'); assert.match(await studio.$eval('#pane-analysis', (n) => n.textContent), /先导入或打开一个结构/, 'without a structure the panel says what to do first');
  await studio.setInputFiles('#structure-file', path.join(FIX, '4AKE.cif')); await studio.waitForFunction(() => document.querySelectorAll('#scene-tree li').length >= 2, null, { timeout: 90000 });
  await studio.click('#tab-look'); await studio.waitForSelector('#look-body:not([hidden])', { timeout: 90000 });
  await studio.click('#tab-analysis'); assert.match(await studio.$eval('#pane-analysis', (n) => n.textContent), /先在“外观”页用选择语言选出/, 'a selection is needed too');
  await studio.click('#tab-look'); await studio.fill('#look-expression', 'chain A'); await studio.click('#look-select'); await studio.waitForFunction(() => /选中/.test(document.querySelector('#look-info').textContent));
  await studio.click('#tab-analysis'); await studio.waitForSelector('#contacts-run', { timeout: 10000 });
  await studio.fill('#contacts-b', 'chain A'); await studio.click('#contacts-run');
  assert.match(await studio.$eval('#contacts-out', (n) => n.textContent), /没有 ≤|0 对|接触/, 'A and B are the same part: nothing pairs');
  await studio.fill('#contacts-b', 'chain B'); await studio.click('#contacts-run'); await studio.waitForFunction(() => /共 \d+ 对残基接触/.test(document.querySelector('#contacts-out').textContent), null, { timeout: 15000 });
  const summary = await studio.$eval('#contacts-out', (n) => n.textContent); console.log(summary);
  const shown = (await studio.$$('#contacts-list li')).length; assert.ok(shown >= 1 && shown <= 10);
  await studio.fill('#contacts-b', 'banana'); await studio.click('#contacts-run'); assert.match(await studio.$eval('#contacts-out', (n) => n.textContent), /B 部分：.*不认识/);
  await studio.fill('#contacts-b', 'chain B'); await studio.click('#contacts-run');
  await studio.click('#contacts-paint'); await studio.waitForFunction(() => /已涂色/.test(document.querySelector('#contacts-out').textContent));
  await studio.click('#contacts-record'); await studio.waitForFunction(() => /证据记入作品/.test(document.querySelector('#contacts-out').textContent));
  // the second panel: composition of a part, coloured by hydrophobicity, recorded
  await studio.fill('#composition-part', 'chain A and resi 1-60'); await studio.click('#composition-run'); await studio.waitForFunction(() => /60 个氨基酸残基/.test(document.querySelector('#composition-out').textContent), null, { timeout: 15000 });
  const comp = await studio.$eval('#composition-out', (n) => n.textContent); console.log(comp.slice(0, 260)); assert.match(comp, /GRAVY：-?\d+\.\d\d.*净电荷：[+-]?\d+/);
  await studio.fill('#composition-part', 'banana'); await studio.click('#composition-run'); assert.match(await studio.$eval('#composition-out', (n) => n.textContent), /不认识/); await studio.fill('#composition-part', 'chain A and resi 1-60'); await studio.click('#composition-run');
  await studio.click('#composition-hydro'); await studio.waitForFunction(() => /已按疏水性涂色/.test(document.querySelector('#composition-out').textContent));
  await studio.click('#composition-record'); await studio.waitForFunction(() => /证据记入作品/.test(document.querySelector('#composition-out').textContent));
  // the third panel: sequence and secondary structure
  await studio.fill('#secondary-part', 'chain A'); await studio.click('#secondary-run'); await studio.waitForSelector('#secondary-out pre', { timeout: 15000 });
  const seqText = await studio.$eval('#secondary-out', (n) => n.textContent); assert.match(seqText, /链 A：214 个残基，螺旋 \d+%，折叠 \d+%/); assert.match(seqText, /MRIILLGAPGAGKGTQAQFIMEKYGIPQIS/, '4AKE chain A starts with its known sequence');
  const segs = await studio.$$('#secondary-out button[data-expr]'); assert.ok(segs.length >= 5, 'helix and strand segments are listed'); await studio.evaluate(() => document.querySelector('#secondary-out button[data-expr]').click());
  await studio.fill('#secondary-part', 'banana'); await studio.click('#secondary-run'); assert.match(await studio.$eval('#secondary-out', (n) => n.textContent), /不认识/); await studio.fill('#secondary-part', 'chain A'); await studio.click('#secondary-run'); await studio.waitForSelector('#secondary-out pre');
  await studio.click('#secondary-paint'); await studio.waitForFunction(() => /已按二级结构涂色/.test(document.querySelector('#secondary-out').textContent));
  await studio.click('#secondary-record'); await studio.waitForFunction(() => /证据记入作品/.test(document.querySelector('#secondary-out').textContent));
  await studio.evaluate(() => document.querySelector('[data-panel="org.glow.panel.secondary"]').scrollIntoView()); await studio.waitForTimeout(1200); await studio.screenshot({ path: path.join(os.tmpdir(), 'analysis-panel.png') });
  const pack = await exportPack('contacts'); const { readScenePackage } = await import(path.join(ROOT, 'packages/schema/archive.mjs'));
  const { scene } = await readScenePackage(new Uint8Array(fs.readFileSync(pack))), state = scene.assets.find((a) => a.kind === 'file' && /mmcif/.test(a.mediaType)).provenance.viewerState;
  const colours = state.colors.residues.map((r) => r.color); assert.ok(colours.includes('#e1873a') && colours.includes('#3b9ae6'), 'both sides are painted');
  const data = state.plugins['org.glow.panel.contacts']; assert.deepEqual([data.a, data.b, data.cutoff], ['chain A', 'chain B', 4.5]);
  const evidence = scene.evidence.filter((e) => e.source === 'org.glow.panel.contacts'); assert.equal(evidence.length, 1); assert.equal(evidence[0].type, 'derived'); assert.match(evidence[0].citation, /界面接触.*chain A 与 chain B.*≤ 4\.5 Å/);
  assert.ok(state.colors.residues.some((r) => r.scheme === 'hydrophobicity' && r.expr === 'chain A and resi 1-60'), 'the part is coloured by hydrophobicity');
  const cdata = state.plugins['org.glow.panel.composition']; assert.deepEqual([cdata.part, cdata.residues], ['chain A and resi 1-60', 60]); assert.equal(scene.evidence.filter((e) => e.source === 'org.glow.panel.composition' && e.type === 'derived').length, 1);
  assert.ok(state.colors.residues.some((r) => r.scheme === 'secondary'), 'the part is coloured by secondary structure'); const sdata = state.plugins['org.glow.panel.secondary']; assert.equal(sdata.chains[0].residues, 214); assert.ok(sdata.chains[0].helix > 0);
  assert.equal(scene.evidence.filter((e) => e.source === 'org.glow.panel.secondary' && e.type === 'derived').length, 1);
  await studio.click('#undo'); await studio.click('#undo'); await studio.click('#redo'); await studio.click('#redo');
  const viewer = await context.newPage(); viewer.on('pageerror', (e) => errors.push('viewer: ' + e.message));
  await viewer.goto(ORIGIN + '/apps/viewer-web/index.html?startup=skip'); await viewer.waitForFunction(() => window.glow, null, { timeout: 30000 }); await viewer.setInputFiles('#file', pack); await viewer.waitForTimeout(3000);
  assert.deepEqual(errors, [], 'no page errors'); await browser.close(); console.log('analysis panel: ok');
})().catch((e) => { console.error(e); process.exit(1); });
