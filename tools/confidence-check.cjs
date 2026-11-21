// Real-browser check of residue colouring and predicted structures (docs/PLUGIN_ROADMAP.md A1). The AlphaFold database is not reachable from here, so the "predicted" file is SYNTHETIC: real alpha-carbon
// coordinates of E. coli adenylate kinase (4AKE chain A) written as an mmCIF that declares a pLDDT quality metric, with an invented confidence per residue (very low 1-20, confident 21-60, very high 61-150,
// low 151-190, confident after). What is checked is the software: the file is recognised as predicted, "confidence" colours the four bands, a selection rule colours exactly its residues, an experimental
// structure refuses "confidence", and nothing is left behind. It says nothing about any real prediction.
// Usage: node tools/confidence-check.cjs [structures-dir]   (node tools/fetch-smoke-structures.mjs --dir desktop/dist/smoke-structures; Playwright with Chromium; no server process)
const { chromium } = require('playwright'); const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), assert = require('node:assert/strict');
const ROOT = path.resolve(__dirname, '..'), ORIGIN = 'http://localhost:8765', FIXTURES = path.resolve(process.argv[2] || path.join(ROOT, 'desktop/dist/smoke-structures'));
const TYPES = { '.html': 'text/html', '.mjs': 'text/javascript', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const plddt = (seq) => (seq <= 20 ? 40 : seq <= 60 ? 75 : seq <= 150 ? 95 : seq <= 190 ? 60 : 85);
function syntheticPrediction() {
  const lines = fs.readFileSync(path.join(FIXTURES, '4AKE.cif'), 'utf8').split('\n').filter((l) => /^ATOM\s/.test(l)), rows = [];
  // atom_site columns of a RCSB mmCIF: group id type label_atom label_alt label_comp label_asym label_entity label_seq ins x y z occ B auth_seq auth_comp auth_asym auth_atom model
  for (const l of lines) { const f = l.trim().split(/\s+/); if (f[3] === 'CA' && f[6] === 'A') rows.push({ seq: Number(f[8]), x: f[10], y: f[11], z: f[12] }); }
  assert.equal(rows.length, 214, '4AKE chain A has 214 residues');
  const atoms = rows.map((r, i) => `ATOM ${i + 1} C CA GLY A ${r.seq} ${r.x} ${r.y} ${r.z} ${plddt(r.seq)}.00`).join('\n');
  return `data_SYNTHETIC_PREDICTION\nloop_\n_ma_qa_metric.id\n_ma_qa_metric.name\n_ma_qa_metric.mode\n1 pLDDT global\n2 pLDDT local\nloop_\n_atom_site.group_PDB\n_atom_site.id\n_atom_site.type_symbol\n_atom_site.label_atom_id\n_atom_site.label_comp_id\n_atom_site.label_asym_id\n_atom_site.label_seq_id\n_atom_site.Cartn_x\n_atom_site.Cartn_y\n_atom_site.Cartn_z\n_atom_site.B_iso_or_equiv\n${atoms}\n`;
}
(async () => {
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const context = await browser.newContext({ viewport: { width: 1100, height: 760 } });
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
  await page.goto(ORIGIN + '/apps/viewer-web/index.html?startup=skip'); await page.waitForFunction(() => window.glow, null, { timeout: 30000 });

  // an experimental structure refuses "confidence" and says why
  await page.evaluate(() => window.glow.load({ pdb: '4AKE' })); await page.evaluate(() => window.glow.represent('blob')); await page.waitForTimeout(1200);
  const refused = await page.evaluate(() => window.glow.color('confidence').then(() => null, (e) => e.message)); assert.match(refused, /不是预测结构/, 'an experimental structure has no confidence to colour by');
  // a selection colours exactly its residues (blob representation)
  const spheresOf = async () => (await page.evaluate(() => window.__glowStats())).drawables;
  const before = await spheresOf();
  const note = await page.evaluate(() => window.glow.color('chain A and resi 30-59', '#ff0000')); console.log('rule:', note.note);
  assert.match(note.note, /30 个残基/); assert.equal(note.residues, 1);
  await page.waitForTimeout(1200); assert.ok((await spheresOf()) > before, 'the sphere layer was split by colour (more drawable objects)');
  const bad = await page.evaluate(() => window.glow.color('resi 9999', '#ff0000').then(() => null, (e) => e.message)); assert.match(bad, /没有选中任何残基/);
  const bad2 = await page.evaluate(() => window.glow.color('((', '#ff0000').then(() => null, (e) => e.message)); assert.match(bad2, /无法读取选择/);
  await page.evaluate(() => window.glow.color('reset')); await page.waitForTimeout(800); assert.equal(await spheresOf(), before, 'reset puts the single layer back');

  // the synthetic predicted structure: recognised from the file, coloured by its four bands
  const file = path.join(os.tmpdir(), 'synthetic-prediction-' + process.pid + '.cif'); fs.writeFileSync(file, syntheticPrediction());
  await page.evaluate(() => { const box = document.querySelector('#structure-enabled'); if (!box.checked) box.click(); });
  await page.setInputFiles('#file', file); await page.waitForTimeout(4000);
  await page.evaluate(() => window.glow.represent('blob')); await page.waitForTimeout(1500);
  const info = await page.evaluate(() => window.glow.info()); const kinds = (info.resources ?? []).map((r) => r.kind); console.log('resource kinds:', kinds.join(', '));
  assert.ok(kinds.includes('predicted-structure'), 'the file declares pLDDT, so its resource is a predicted structure');
  const plain = await spheresOf();
  const c = await page.evaluate(() => window.glow.color('confidence')); assert.equal(c.scheme, 'confidence'); assert.match(c.note, /pLDDT/);
  await page.waitForTimeout(1500);
  const banded = await spheresOf(); console.log('drawable objects: plain', plain, '-> by confidence', banded);
  assert.ok(banded >= plain + 3, 'four bands present: the sphere layer became at least four layers');
  await page.screenshot({ path: path.join(ROOT, 'docs/images/confidence-coloring.png') });
  // the state survives a save and reopen
  const pack = await page.evaluate(() => window.glow.exportPack()); assert.equal(pack.format, 'glow-v2');
  await page.evaluate(() => window.glow.color('reset')); await page.waitForTimeout(800);
  await page.evaluate((p) => window.glow.load(p), pack); await page.waitForTimeout(4000);
  assert.equal((await page.evaluate(() => window.glow.info())).colors.scheme, 'confidence', 'the colour scheme is saved with the work');
  fs.rmSync(file, { force: true });
  assert.deepEqual(errors, [], 'no script errors');
  await browser.close(); console.log('ok: residue colouring and the confidence scheme (synthetic predicted file)');
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
