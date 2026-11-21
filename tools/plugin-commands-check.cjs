// Real-browser check of the seven commands the packaged plugins add (complex, assemble, embed, compose, interactions, binding, source): each is called through window.glow the way a user's script would,
// with real coordinates from the pinned fixtures (node tools/fetch-smoke-structures.mjs --dir desktop/dist/smoke-structures). The data source has no network here, so only its refusal path is exercised.
// Usage: node tools/plugin-commands-check.cjs [structures-dir]   (Playwright with Chromium)
const { chromium } = require('playwright'); const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), assert = require('node:assert/strict');
const ROOT = path.resolve(__dirname, '..'), ORIGIN = 'http://localhost:8765', FIXTURES = path.resolve(process.argv[2] || path.join(ROOT, 'desktop/dist/smoke-structures'));
const TYPES = { '.html': 'text/html', '.mjs': 'text/javascript', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
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
  const call = (name, arg) => page.evaluate(([n, a]) => window.glow[n](a).then((v) => ({ ok: v }), (e) => ({ error: e.message, stack: e.stack })), [name, arg]);
  const ok = async (name, arg) => { const r = await call(name, arg); assert.ok(!r.error, `${name}: ${r.error} ${r.stack}`); return r.ok; };
  const refuses = async (name, arg, pattern) => { const r = await call(name, arg); assert.ok(r.error, `${name} should refuse`); assert.match(r.error, pattern); };

  // refusals that need no structure
  await refuses('binding', { box: 100 }, /超出范围|应为/); await refuses('source', { source: 'alphafold', accession: '../etc' }, /accession/);
  await refuses('embed', { shape: { kind: 'sphere', radius: 100 }, copies: 3 }, /请先|场景/);

  // 4AKE: complex record, interactions, assemble 1AKE onto it
  await page.evaluate(() => window.glow.load({ pdb: '4AKE' })); await page.waitForTimeout(1200);
  const cx = await ok('complex', { record: true }); console.log('complex', JSON.stringify({ members: cx.members, copies: cx.copies, stoichiometry: cx.stoichiometry }));
  assert.ok(cx.members >= 1 && cx.copies >= 1 && cx.record, 'a complex record is made'); assert.equal(cx.record.evidence[0].type, 'experimental', 'the coordinates are an experimental source');
  await refuses('complex', { bogus: 1 }, /只接受/);
  const it = await ok('interactions', {}); console.log('interactions', it.total, 'pairs of', it.copies, 'copies'); assert.ok(Array.isArray(it.interactions) && it.note);
  const asm = await ok('assemble', { pdb: '1AKE', baseSelection: 'chain A', addSelection: 'chain A', carry: 'chain A', maxRmsd: 8 });
  console.log('assemble', JSON.stringify({ rmsd: asm.rmsd, matched: asm.matched, clashes: asm.clashes?.count }));
  assert.ok(asm.rmsd > 0 && asm.rmsd < 8 && asm.matched > 100 && asm.evidence.type === 'derived', 'open and closed adenylate kinase superpose and the result is marked derived');
  await refuses('assemble', { pdb: '1AKE', baseSelection: 'chain A', addSelection: 'chain Z', carry: 'chain A' }, /没有选中/);

  // composition: spheres in a sphere, below the packing limit, then cleared
  const comp = await ok('compose', { region: { kind: 'sphere', radius: 400 }, components: [{ id: 'a', copies: 60, radius: 25, color: '#e15759' }, { id: 'b', copies: 120, radius: 12 }], seed: 3 });
  console.log('compose', JSON.stringify({ placed: comp.placed, occupancy: comp.occupancy })); assert.equal(comp.placed, 180); assert.ok(comp.occupancy > 0 && comp.occupancy < 0.74, 'occupancy is below the packing limit');
  await refuses('compose', { region: { kind: 'sphere', radius: 400 }, components: [{ id: 'a', copies: 1, radius: 5 }, { id: 'a', copies: 1, radius: 5 }] }, /不重复/);
  await ok('compose', null);

  // Brownian binding against the Smoluchowski rate (constant bath)
  const bind = await ok('binding', { box: 60, particles: 40, D: 100, radius: 2, microseconds: 60, dt: 0.002, seed: 4, reinject: true });
  console.log('binding', JSON.stringify({ rate: bind.rate, theory: bind.smoluchowskiRate, ratio: bind.ratio })); assert.ok(bind.ratio > 0.6 && bind.ratio < 1.5, `the rate is within range of the Smoluchowski rate (${bind.ratio})`);
  await refuses('binding', { box: 60, particles: 20000, D: 100, radius: 2, microseconds: 1e5, dt: 0.0001 }, /计算量太大|dt/);

  // the data source has no network here: it must refuse cleanly, not hang
  const src = await call('source', { source: 'alphafold', accession: 'P69441' }); assert.ok(src.error || src.ok, 'source answers'); console.log('source', src.error ?? 'ok');

  // 1K4C: a potassium channel; embed copies into a sphere membrane
  await page.evaluate(() => window.glow.load({ pdb: '1K4C', assembly: true })); await page.waitForTimeout(1500);
  const emb = await call('embed', { shape: { kind: 'sphere', radius: 400 }, copies: 40, seed: 11 });
  console.log('embed', JSON.stringify(emb.error ?? { placed: emb.ok.placed, thickness: emb.ok.membrane.thicknessFromStructure, plan: !!emb.ok.plan }));
  assert.ok(!emb.error, emb.error); assert.equal(emb.ok.placed, 40); assert.ok(emb.ok.membrane.thicknessFromStructure > 20 && emb.ok.membrane.thicknessFromStructure < 45);
  await page.waitForTimeout(500); await page.screenshot({ path: path.join(os.tmpdir(), 'plugin-embed.png') });
  await ok('embed', null);
  assert.deepEqual(errors, [], 'no page errors'); await browser.close(); console.log('plugin commands: ok');
})().catch((e) => { console.error(e); process.exit(1); });
