// Real-browser check of the structure superposition panel: chain B of 4AKE is fitted onto chain A and moved; the exported node transform, applied to the deposited coordinates, must reproduce the RMSD the panel reported; reset, undo, evidence and panel data are checked.
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
  const FIX = path.resolve(process.argv[2] || path.join(ROOT, 'desktop/dist/smoke-structures'));
  const errors = [], studio = await context.newPage(); studio.on('pageerror', (e) => errors.push('studio: ' + e.message));
  const exportPack = async (name) => { const [d] = await Promise.all([studio.waitForEvent('download', { timeout: 60000 }), studio.evaluate(() => { document.querySelector('#export-scene').click(); })]); const f = path.join(os.tmpdir(), `${name}-${process.pid}.glow`); await d.saveAs(f); return f; };
  await studio.goto(ORIGIN + '/apps/studio-web/index.html'); await studio.waitForSelector('#tab-analysis', { timeout: 30000 }); await studio.waitForTimeout(1200);
  await studio.setInputFiles('#structure-file', path.join(FIX, '4AKE.cif')); await studio.waitForFunction(() => document.querySelectorAll('#scene-tree li').length >= 2, null, { timeout: 90000 });
  await studio.click('#tab-look'); await studio.waitForSelector('#look-body:not([hidden])', { timeout: 90000 });
  await studio.fill('#look-expression', 'chain A'); await studio.click('#look-select'); await studio.waitForFunction(() => /选中/.test(document.querySelector('#look-info').textContent));
  await studio.click('#tab-analysis'); await studio.waitForSelector('#superposition-run', { timeout: 10000 });
  // chain B onto chain A (the reference is taken from the selection box)
  await studio.fill('#superposition-mobile', 'chain B'); await studio.click('#superposition-run'); await studio.waitForFunction(() => /叠合后/.test(document.querySelector('#superposition-out').textContent), null, { timeout: 15000 });
  const summary = await studio.$eval('#superposition-out', (n) => n.textContent); console.log(summary);
  const m = /(\d+) 个残基对到参考上：叠合前 RMSD ([\d.]+) Å，叠合后 ([\d.]+) Å/.exec(summary); assert.ok(m, 'the summary has the numbers'); const [pairs, before, after] = [Number(m[1]), Number(m[2]), Number(m[3])]; assert.ok(pairs > 150 && after < before, `fit improves: ${before} -> ${after}`);
  await studio.fill('#superposition-mobile', 'chain A'); await studio.click('#superposition-run'); assert.match(await studio.$eval('#superposition-out', (n) => n.textContent), /不能包含/); await studio.fill('#superposition-mobile', 'chain B');
  await studio.click('#superposition-run'); await studio.click('#superposition-place'); await studio.waitForFunction(() => /已移动画面里的链 B/.test(document.querySelector('#superposition-out').textContent));
  await studio.click('#superposition-far').catch(() => {}); await studio.click('#superposition-record'); await studio.waitForFunction(() => /证据记入作品/.test(document.querySelector('#superposition-out').textContent));
  await studio.waitForTimeout(1500); await studio.screenshot({ path: path.join(os.tmpdir(), 'superposition-placed.png') });
  // the placement is the chain's transform; applied to the deposited coordinates of chain B it must land on chain A with the reported RMSD (checks the frame conversion Å -> scene -> node transform)
  const pack = await exportPack('superposed'); const { readScenePackage } = await import(path.join(ROOT, 'packages/schema/archive.mjs'));
  const { scene, resources } = await readScenePackage(new Uint8Array(fs.readFileSync(pack))), source = scene.assets.find((a) => a.kind === 'file' && /mmcif/.test(a.mediaType));
  const nodeB = scene.nodes.find((n) => n.extensions?.['org.glow.structure']?.chainId === 'B'), nodeA = scene.nodes.find((n) => n.extensions?.['org.glow.structure']?.chainId === 'A'); assert.ok(nodeB && nodeA);
  assert.notDeepEqual(nodeB.transform.rotation, [0, 0, 0, 1], 'chain B was rotated'); assert.deepEqual(nodeA.transform.rotation, [0, 0, 0, 1], 'chain A stays');
  const { parseMmcif } = await import(path.join(ROOT, 'plugins/structure/parser.mjs')), { centerAndScale, selectCoordinateAtoms } = await import(path.join(ROOT, 'plugins/structure/representation.mjs')), { rotateVector } = await import(path.join(ROOT, 'plugins/structure/alignment.mjs'));
  const bytes = resources instanceof Map ? resources.get(source.path) : resources[source.path]; const model = parseMmcif(Buffer.from(bytes).toString('utf8')), centred = centerAndScale(selectCoordinateAtoms(model)), k = 0.05;
  const ca = (chain) => model.atoms.filter((a) => a.name === 'CA' && a.authChainId === chain && !a.altLoc.trim().replace('A', '')).sort((p, q) => Number(p.authSeqId) - Number(q.authSeqId));
  const A = ca('A'), B = ca('B'), t = nodeB.transform; const key = (a) => `${a.authSeqId}|${a.residueName}`; const byA = new Map(A.map((a) => [key(a), a]));
  let sum = 0, n = 0; for (const b of B) { const a = byA.get(key(b)); if (!a) continue; const s = centred.point(b.position), moved = rotateVector(s, t.rotation).map((v, i) => v + t.position[i]), back = moved.map((v, i) => v / k + centred.center[i]); sum += (back[0] - a.position[0]) ** 2 + (back[1] - a.position[1]) ** 2 + (back[2] - a.position[2]) ** 2; n++; }
  const rmsd = Math.sqrt(sum / n); console.log('RMSD recomputed from the exported node transform:', rmsd.toFixed(3), 'over', n, 'pairs (panel said', after, ')'); assert.ok(Math.abs(rmsd - after) < 0.02, 'the transform of the node reproduces the fit the panel reported');
  const data = (await readScenePackage(new Uint8Array(fs.readFileSync(pack)))).scene.assets.find((a) => a.kind === 'file' && /mmcif/.test(a.mediaType)).provenance.viewerState.plugins['org.glow.panel.superposition']; assert.equal(data.placed, true); assert.equal(data.chain, 'B');
  assert.equal(scene.evidence.filter((e) => e.source === 'org.glow.panel.superposition' && e.type === 'derived').length, 1);
  // reset puts it back, undo/redo move it again
  await studio.click('#superposition-reset'); await studio.waitForFunction(() => /已还原/.test(document.querySelector('#superposition-out').textContent)); const afterReset = await exportPack('reset');
  assert.deepEqual((await readScenePackage(new Uint8Array(fs.readFileSync(afterReset)))).scene.nodes.find((x) => x.extensions?.['org.glow.structure']?.chainId === 'B').transform.rotation, [0, 0, 0, 1], 'reset puts chain B back');
  await studio.click('#undo'); const undone = await exportPack('undone'); assert.notDeepEqual((await readScenePackage(new Uint8Array(fs.readFileSync(undone)))).scene.nodes.find((x) => x.extensions?.['org.glow.structure']?.chainId === 'B').transform.rotation, [0, 0, 0, 1], 'undo of the reset brings the placement back');
  assert.deepEqual(errors, [], 'no page errors'); await browser.close(); console.log('superposition: ok');
})().catch((e) => { console.error(e); process.exit(1); });
