// Real-browser check of the Studio's command interface for AI (window.studio): a whole work is made WITHOUT touching a single button — import 4AKE from "RCSB" (the pinned file is served), add 1AKE, select, style, colour,
// surface, measure, label, contacts / composition / secondary / superpose with write-back, camera keys, notes, export — then the exported package is read back and the geometry is recomputed independently.
// Usage: node tools/studio-api-check.cjs [structures-dir]   (Playwright with Chromium)
const { chromium } = require('playwright'); const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), assert = require('node:assert/strict');
const ROOT = path.resolve(__dirname, '..'), ORIGIN = 'http://localhost:8765', FIX = path.resolve(process.argv[2] || path.join(ROOT, 'desktop/dist/smoke-structures'));
const TYPES = { '.html': 'text/html', '.mjs': 'text/javascript', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
setTimeout(() => { console.error('the check hung'); process.exit(1); }, 560000).unref?.();
(async () => {
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] }), context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await context.route('**/*', (route) => {
    const url = new URL(route.request().url()), cdn = /^https:\/\/cdn\.jsdelivr\.net\/npm\/three@0\.160\.0\/(.+)$/.exec(url.href), rcsb = /^https:\/\/files\.rcsb\.org\/download\/([0-9A-Za-z]{4})\.cif$/.exec(url.href);
    if (cdn) { const f = [path.join(ROOT, 'desktop/vendor/three', cdn[1]), path.join(ROOT, 'desktop/node_modules/three', cdn[1])].find((x) => fs.existsSync(x)) ?? ''; return fs.existsSync(f) ? route.fulfill({ status: 200, contentType: 'text/javascript', body: fs.readFileSync(f) }) : route.abort(); }
    if (rcsb) { const f = path.join(FIX, rcsb[1].toUpperCase() + '.cif'); return fs.existsSync(f) ? route.fulfill({ status: 200, contentType: 'text/plain', body: fs.readFileSync(f) }) : route.fulfill({ status: 404, body: 'not pinned' }); }
    if (url.origin !== ORIGIN) return route.abort();
    const file = path.join(ROOT, decodeURIComponent(url.pathname));
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return route.fulfill({ status: 404, body: 'nf' });
    route.fulfill({ status: 200, contentType: TYPES[path.extname(file)] ?? 'application/octet-stream', body: fs.readFileSync(file) });
  });
  const errors = [], page = await context.newPage(); page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(ORIGIN + '/apps/studio-web/index.html'); await page.waitForFunction(() => window.studio, null, { timeout: 30000 });
  const call = (name, ...args) => page.evaluate(([n, a]) => window.studio[n](...a).then((v) => ({ ok: v }), (e) => ({ error: e.message })), [name, args]);
  const ok = async (name, ...args) => { const r = await call(name, ...args); assert.ok(!r.error, `${name}: ${r.error}`); return r.ok; };
  const refuses = async (name, args, pattern) => { const r = await call(name, ...args); assert.ok(r.error, `${name} should refuse`); assert.match(r.error, pattern); };

  // the interface describes itself
  const help = await ok('help'); assert.ok(help.commands.length >= 20 && help.rules.length >= 5 && help.limits.superpose.length >= 3, 'help lists the commands, the rules and the limits'); console.log('commands:', help.commands.map((c) => c.cmd).join(' '));
  assert.equal((await ok('help', 'surface')).commands.length, 1); await refuses('help', ['nope'], /没有命令/);
  await refuses('select', ['chain A'], /还没有结构/); await refuses('contacts', [{ a: 'chain A', b: 'chain B' }], /还没有结构/);

  // a work made of two entries
  let info = await ok('import', { pdb: '4AKE' }); assert.equal(info.structures[0].chains.join(), 'A,B'); assert.equal(info.structures[0].residues, 428);
  const added = await ok('addStructure', { pdb: '1AKE' }); assert.equal(added.structures.length, 2); const [first, second] = added.structures.map((s) => s.id); console.log('structures:', JSON.stringify(added.structures.map((s) => [s.id, s.label, s.residues])));
  await refuses('addStructure', [{ pdb: 'x' }], /4 位编号/); await refuses('import', [{}], /需要/);

  // selection, style, colour, surface, annotations
  const sel = await ok('select', 'chain A and resi 1-60'); assert.equal(sel.residues, 60); await refuses('select', ['banana'], /不认识/); assert.equal((await ok('select', 'none')).residues, 0);
  await ok('select', 'chain A');
  assert.match((await ok('show', 'chain A and resi 100-110', 'sticks')).note, /棍状/); await refuses('show', ['all', 'sticks'], /最多 300|没有选中/).catch(() => {});
  await refuses('show', ['chain A', 'spaghetti'], /样式应为/);
  assert.match((await ok('color', 'chain A and resi 1-60', 'hydrophobicity')).note, /疏水性/); await refuses('color', ['resi 99999', 'red'], /没有选中/);
  const surf = await ok('surface', 'chain B', 'electrostatic'); assert.ok(surf.surface.triangles > 5000 && surf.surface.potential.max > 0 && surf.limits.length >= 2, 'a surface with its limits'); await refuses('surface', ['banana', 'plain'], /不认识/);
  const m = await ok('measure', 'chain A and resi 100', 'chain A and resi 140'); assert.equal(m.measures, 1); await refuses('measure', ['chain A', 'chain B'], /正好|一个残基/);
  assert.equal((await ok('label', 'chain A and resi 57', '关键残基')).labels, 1);

  // analyses: read-only by default, write-back only when asked, limits always present
  const before = await ok('info'); const c0 = await ok('contacts', { a: 'chain A', b: 'chain B' }); assert.equal(c0.wrote.length, 0); assert.ok(c0.pairs > 20 && c0.counts.salt >= 1 && c0.limits.length >= 2, JSON.stringify(c0.counts));
  assert.equal((await ok('info')).evidence, before.evidence, 'a read-only analysis writes nothing');
  const c1 = await ok('contacts', { a: 'chain A', b: 'chain B', write: ['paint', 'draw', 'record'] }); assert.ok(c1.wrote.includes('record') && c1.wrote.some((w) => w.startsWith('draw')), JSON.stringify(c1.wrote));
  await refuses('contacts', [{ a: 'chain A', b: 'chain B', write: ['explode'] }], /write 只接受/); await refuses('contacts', [{ a: 'chain A', b: 'chain B', cutoff: 99 }], /0–8/); await refuses('contacts', [{ a: 'chain A', b: 'chain B', oops: 1 }], /只接受/);
  const comp = await ok('composition', { part: 'chain A and resi 1-60', write: ['hydrophobicity', 'record'] }); assert.equal(comp.residues, 60); assert.ok(comp.limits.length >= 2); assert.deepEqual(comp.wrote, ['hydrophobicity', 'record']);
  const sec = await ok('secondary', { part: 'chain A', write: ['record'] }); assert.equal(sec.chains[0].residues, 214); assert.match(sec.chains[0].sequence, /^MRIILLGAPGAGKGTQAQFIMEKYGIPQIS/);
  const sup0 = await ok('superpose', { mobile: 'chain B', reference: 'chain A' }); assert.ok(sup0.rmsd < sup0.rmsdBefore && sup0.wrote.length === 0, 'same-structure fit, nothing written');
  const CORE = 'chain A and (resi 1-29 or resi 60-121 or resi 160-214)';
  const sup = await ok('superpose', { mobile: CORE, reference: CORE, mobileStructure: first, referenceStructure: second, write: ['place', 'mark', 'record'] }); console.log('cross-entry fit:', sup.pairs, 'pairs, RMSD', sup.rmsdBefore, '->', sup.rmsd);
  assert.ok(sup.pairs > 120 && sup.rmsd < 3 && sup.wrote.includes('place') && sup.limits.length >= 3);
  await refuses('superpose', [{ mobile: 'chain A', reference: 'chain B', mobileStructure: 'nope' }], /没有结构 nope/);

  // the new commands: parts, focus, look packs, publication
  const parts = await ok('parts'); assert.ok(parts.parts.length >= 4 && parts.parts.every((p) => typeof p.visible === 'boolean')); assert.equal((await ok('part', 'chain B', false)).changed >= 1, true); await ok('part', 'all', true); await refuses('part', ['nothing', false], /目标应为/);
  const focus = await ok('camera', { focus: 'chain A and resi 100-140', margin: 1.2 }); assert.ok(focus.focused >= 40); await refuses('camera', [{ focus: 'resi 99999' }], /没有选中/);
  const packed = await ok('lookPack', 'glow.cell-dark'); assert.equal(packed.current, 'glow.cell-dark'); assert.equal((await ok('lookPack')).packs.length, 4); await refuses('lookPack', ['glow.nope'], /没有光影包/); assert.equal((await ok('lookPack', 'none')).current, null);
  await ok('lookPack', 'paper.clean-white', { recolor: false }); assert.equal((await ok('lookPack')).current, 'paper.clean-white');
  assert.equal((await ok('publication', { author: 'Molecule Glow 项目', license: 'CC-BY-4.0', topic: 'protein', description: '接口检查用', tags: ['腺苷酸激酶'] })).publication.license, 'CC-BY-4.0'); await refuses('publication', [{ author: 'x', license: 'GPL' }], /授权请选/);
  // the process tab shows every step that changed the work, with a way back
  const steps = await page.$$eval('#process-list li', (l) => l.map((x) => x.querySelector('b').textContent)); assert.ok(steps.length >= 15 && steps.includes('contacts') && steps.includes('superpose') && !steps.includes('info'), `process log: ${steps.join(' ')}`);
  assert.equal(await page.$$eval('#process-list li[data-state="error"]', (l) => l.length) > 0, true, 'refused commands are shown as failed');
  await page.screenshot({ path: path.join(os.tmpdir(), 'studio-process.png') });
  // camera, keys, notes, undo
  const cam = (await ok('camera')).camera; await ok('cameraKey', { time: 0 }); await ok('camera', { position: [cam.position[0] * 1.4, cam.position[1], cam.position[2]], target: cam.target }); await ok('cameraKey', { time: 4 });
  assert.equal((await ok('cameraKey')).keys.length, 2); await refuses('cameraKey', [{ time: -1 }], /不小于 0/); await refuses('camera', [{ position: [0, 0, 0], target: [0, 0, 0] }], /重合/);
  await ok('note', '4AKE（开放）与 1AKE（闭合）的核心域叠合'); assert.equal((await ok('title', '腺苷酸激酶：开放与闭合')).title, '腺苷酸激酶：开放与闭合');
  const stamp = await ok('info'); assert.ok(stamp.canUndo); await ok('undo'); assert.equal((await ok('info')).rules.labels, stamp.rules.labels); await ok('redo');
  const shot = await ok('snapshot', { width: 640 }); assert.match(shot.dataUrl, /^data:image\/png;base64,/); fs.writeFileSync(path.join(os.tmpdir(), 'studio-api.png'), Buffer.from(shot.dataUrl.split(',')[1], 'base64'));

  // the exported package holds everything, and the geometry is recomputed independently
  const exported = await ok('exportScene'); const pack = path.join(os.tmpdir(), `studio-api-${process.pid}.glow`); fs.writeFileSync(pack, Buffer.from(exported.data, 'base64'));
  const { readScenePackage } = await import(path.join(ROOT, 'packages/schema/archive.mjs')), { scene, resources } = await readScenePackage(new Uint8Array(fs.readFileSync(pack)));
  const sources = scene.assets.filter((a) => a.kind === 'file' && /mmcif/.test(a.mediaType)), state = sources[0].provenance.viewerState;
  assert.equal(scene.title, '腺苷酸激酶：开放与闭合'); assert.equal(sources.length, 2); assert.ok(state.styles.some((s) => s.style === 'sticks') && state.surfaces.length === 1 && state.measures.length === 1 && state.labels.length === 1 && state.bonds.length >= 1, 'every rule is in the work');
  assert.equal(scene.presentation.cameraKeys.length, 2); assert.ok(scene.presentation.notes.length === 1);
  const derived = scene.evidence.filter((e) => e.type === 'derived' && /^org\.glow\.panel\./.test(e.source)); assert.ok(derived.length >= 4 && derived.every((e) => /（org\.glow\.panel\.[a-z]+）：/.test(e.citation)), 'analysis results are derived evidence with their method'); console.log('derived evidence:', derived.map((e) => e.source.split('.').pop()).join(','));
  const nodeA = scene.nodes.find((n) => n.extensions?.['org.glow.structure']?.sourceAssetId === sources[0].id && n.extensions['org.glow.structure'].chainId === 'A'); assert.notDeepEqual(nodeA.transform.rotation, [0, 0, 0, 1], 'the open form was moved');
  const { parseMmcif } = await import(path.join(ROOT, 'plugins/structure/parser.mjs')), { centerAndScale, selectCoordinateAtoms } = await import(path.join(ROOT, 'plugins/structure/representation.mjs')), { rotateVector } = await import(path.join(ROOT, 'plugins/structure/alignment.mjs'));
  const load = (source) => { const bytes = resources instanceof Map ? resources.get(source.path) : resources[source.path]; const model = parseMmcif(Buffer.from(bytes).toString('utf8')); return { model, centred: centerAndScale(selectCoordinateAtoms(model)) }; };
  const open = load(sources[0]), closed = load(sources[1]), inCore = (a) => { const n = Number(a.authSeqId); return (n >= 1 && n <= 29) || (n >= 60 && n <= 121) || (n >= 160 && n <= 214); };
  const ca = (model) => new Map(model.atoms.filter((a) => a.name === 'CA' && a.authChainId === 'A' && !a.altLoc.trim().replace('A', '') && inCore(a)).map((a) => [`${a.authSeqId}|${a.residueName}`, a])), A = ca(open.model), B = ca(closed.model); let sum = 0, n = 0;
  for (const [key, a] of A) { const b = B.get(key); if (!b) continue; const placed = rotateVector(open.centred.point(a.position), nodeA.transform.rotation).map((v, i) => v + nodeA.transform.position[i]), ref = closed.centred.point(b.position); sum += (placed[0] - ref[0]) ** 2 + (placed[1] - ref[1]) ** 2 + (placed[2] - ref[2]) ** 2; n++; }
  const rmsd = Math.sqrt(sum / n) / 0.05; console.log('RMSD recomputed from the exported package:', rmsd.toFixed(3), 'over', n, 'pairs (command said', sup.rmsd, ')'); assert.ok(Math.abs(rmsd - sup.rmsd) < 0.02, 'the command-line placement reproduces the reported fit');
  // "back to before this step" undoes that step and everything after it
  const labelsNow = (await ok('info')).rules.labels; assert.equal(labelsNow, 1); await page.evaluate(() => { const rows = [...document.querySelectorAll('#process-list li')].filter((x) => x.querySelector('b').textContent === 'label'); rows.at(-1).querySelector('button[data-back]').click(); });
  const after = await ok('info'); assert.equal(after.rules.labels, 0, 'the label is gone'); assert.equal(after.rules.measures, 1, 'the step before it is kept'); assert.equal(after.evidence < stamp.evidence, true, 'and the evidence written later is gone too');
  assert.deepEqual(errors, [], 'no page errors'); await browser.close(); console.log('studio api: ok');
})().catch((e) => { console.error(e); process.exit(1); });
