// Differential test: chemical components (plugins/structure/chemical-component.mjs) against the classic getTemplate / bondsFromTemplate / bondsOf
// (src/data/rcsb.js, src/repr/molecules.js). Templates come from recorded CCD files; ligands are the real ones of the fixture structures.
// Usage: node tools/chemcomp-parity.mjs <structures-dir> [--output file]
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { pathToFileURL } from 'node:url';
import { parseMmcif } from '../plugins/structure/parser.mjs';
import { selectionSpace } from '../plugins/structure/selection.mjs';
import { valenceGeometry } from '../packages/render-three/molecule-geometry.mjs';
import { loadChemComp, clearChemCompCache, bondsFromTemplate, bondsByDistance } from '../plugins/structure/chemical-component.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const FIX = path.join(ROOT, 'plugins/structure/test/fixtures');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const dir = process.argv[2], out = process.argv.includes('--output') ? process.argv[process.argv.indexOf('--output') + 1] : null;
if (!dir) { console.error('usage: node tools/chemcomp-parity.mjs <structures-dir> [--output file]'); process.exit(2); }
const THREE = await import(pathToFileURL(path.join(ROOT, 'desktop/node_modules/three/build/three.module.js')));

const between = (src, a, b) => { const i = src.indexOf(a), j = src.indexOf(b, i); if (i < 0 || j < 0) throw new Error('marker not found: ' + a); return src.slice(i, j); };
const rcsb = read('src/data/rcsb.js'), molecules = read('src/repr/molecules.js'), palettes = read('src/repr/palettes.js');
const recorded = (url) => {
  const m = /ligands\/view\/([A-Za-z0-9_]+)\.(cif|sdf)/.exec(url);
  const f = path.join(FIX, `ccd-${m[1]}.${m[2]}`);
  if (!fs.existsSync(f)) throw new Error('no fixture ' + m[1]);
  return fs.readFileSync(f, 'utf8');
};
const ctx = vm.createContext({ THREE, console: { log() {}, warn() {} }, Math, Map, Set, Array, Object, Number, String, JSON, Promise, isFinite, fetchText: async (url) => recorded(url), IGNORE_LIGANDS: new Set(['HOH', 'WAT']) });
vm.runInContext(palettes, ctx);
vm.runInContext(read('src/data/parse.js'), ctx);
vm.runInContext(between(rcsb, 'function parseLoop', '/* small-molecule template'), ctx);
vm.runInContext(between(rcsb, 'const templates = {};', '/* rigid pose'), ctx);
vm.runInContext(between(molecules, 'const SPH', 'function bondsOf'), ctx);
vm.runInContext(between(molecules, 'function bondsOf', 'const ligStyle'), ctx);
ctx.ligandMaterial = () => new THREE.MeshBasicMaterial(); ctx.illustrative = () => false; ctx.$ = () => ({ value: 'valence' }); ctx.outlineOf = () => new THREE.Group();
vm.runInContext(between(molecules, 'const VDW_R', '/* one movable molecule'), ctx);   // buildMolecules (the classic valence drawing)

const lines = []; let bad = 0, total = 0;
const check = (what, same, detail) => { total++; if (!same) bad++; lines.push(`${same ? 'ok  ' : 'DIFF'} ${what}${same ? '' : ' — ' + detail}`); };
const fetchText = async (url) => recorded(url);

for (const comp of ['ATP', 'HEM', 'F09', 'K']) {
  clearChemCompCache();
  const classic = await ctx.getTemplate(comp), mine = await loadChemComp(comp, { fetchText });
  const atomsSame = classic.atoms.length === mine.atoms.length && classic.atoms.every((a, i) => a.name === mine.atoms[i].name && a.el === mine.atoms[i].element
    && Math.hypot(a.p.x - mine.atoms[i].position[0], a.p.y - mine.atoms[i].position[1], a.p.z - mine.atoms[i].position[2]) < 1e-9);
  check(`${comp}: template atoms (${mine.atoms.length}: names, elements, centred ideal coordinates)`, atomsSame, 'atoms differ');
  check(`${comp}: template bonds and orders (${mine.bonds.length})`, JSON.stringify(classic.bonds) === JSON.stringify(mine.bonds), 'bonds differ');
}
// the SDF fallback: the classic code falls back when the CCD file is missing
{
  clearChemCompCache();
  const only = async (url) => { if (url.endsWith('.cif')) throw new Error('404'); return recorded(url); };
  vm.runInContext('for (const k of Object.keys(templates)) delete templates[k]', ctx);
  ctx.fetchText = only;
  const classic = await ctx.getTemplate('ATP'), mine = await loadChemComp('ATP', { fetchText: only });
  check(`ATP via SDF fallback: atoms and bonds (${mine.atoms.length}/${mine.bonds.length})`, classic.atoms.length === mine.atoms.length
    && JSON.stringify(classic.bonds) === JSON.stringify(mine.bonds)
    && classic.atoms.every((a, i) => a.el === mine.atoms[i].element && Math.hypot(a.p.x - mine.atoms[i].position[0], a.p.y - mine.atoms[i].position[1], a.p.z - mine.atoms[i].position[2]) < 1e-9), 'SDF templates differ');
  ctx.fetchText = async (url) => recorded(url);
  vm.runInContext('for (const k of Object.keys(templates)) delete templates[k]', ctx);   // the SDF template has no atom names: do not let it leak into the name matching below
  clearChemCompCache();
}

// valence drawing: the classic buildMolecules (style 'valence', scale 1) against valenceGeometry, compared by what is drawn where
{
  // the classic instance matrices are float32: points match one-to-one within 1e-3 Å
  const points = (mesh) => { const m = new THREE.Matrix4(), v = new THREE.Vector3(), r = []; for (let i = 0; i < mesh.count; i++) { mesh.getMatrixAt(i, m); v.setFromMatrixPosition(m); r.push([v.x, v.y, v.z]); } return r; };
  const samePoints = (a, b) => { if (a.length !== b.length) return false; const used = new Set(); return a.every((p) => { const k = b.findIndex((q, i) => !used.has(i) && Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) < 1e-3); if (k < 0) return false; used.add(k); return true; }); };
  for (const comp of ['ATP', 'HEM', 'F09']) {
    const tpl = await loadChemComp(comp, { fetchText }), classicTpl = await ctx.getTemplate(comp);
    const group = ctx.buildMolecules([{ atoms: classicTpl.atoms, bonds: classicTpl.bonds, centre: new THREE.Vector3() }], 1, undefined, 'valence');
    const [balls, sticks, dashes] = group.children;
    const mine = valenceGeometry(tpl.atoms.map((a) => ({ position: a.position, color: '#fff', radius: 1 })), tpl.bonds, 1);
    const halves = mine.sticks.flatMap((s) => { const mid = s.a.map((v, k) => (v + s.b[k]) / 2); return [s.a.map((v, k) => (v + mid[k]) / 2), s.b.map((v, k) => (v + mid[k]) / 2)]; });
    const dashMids = mine.dashes.map((d) => d.a.map((v, k) => (v + d.b[k]) / 2));
    const okBalls = samePoints(points(balls), mine.balls.map((b) => b.position)), okSticks = samePoints(points(sticks), halves), okDashes = samePoints(dashes ? points(dashes) : [], dashMids);
    check(`${comp}: valence drawing — ${mine.balls.length} joints/balls, ${mine.sticks.length} sticks, ${mine.dashes.length} dashes at the same places`, okBalls && okSticks && okDashes, `balls ${okBalls}, sticks ${okSticks}, dashes ${okDashes}`);
  }
}

// real ligands
for (const id of fs.readdirSync(dir).filter((f) => f.endsWith('.cif')).map((f) => f.slice(0, -4))) {
  const text = fs.readFileSync(path.join(dir, id + '.cif'), 'utf8');
  const entry = ctx.rowsToEntry(ctx.parseAtomSite(text), {});
  const mine = selectionSpace(parseMmcif(text)).ligands;
  check(`${id}: same ligands (${entry.ligands.length})`, entry.ligands.length === mine.length, `classic ${entry.ligands.length} vs new ${mine.length}`);
  const bad0 = bad;
  entry.ligands.forEach((L, k) => {
    const M = mine[k];
    const atomsA = L.atoms.map((a) => ({ name: a.name, el: a.el, p: a.p })), atomsB = M.atoms.map((a) => ({ name: a.name, element: a.element, position: a.position }));
    const distA = ctx.bondsOf(atomsA), distB = bondsByDistance(atomsB);
    const same = JSON.stringify(distA) === JSON.stringify(distB);
    total++; if (!same) { bad++; lines.push(`DIFF ${id} ${L.comp}: distance bonds classic ${distA.length} vs new ${distB.length}`); }
  });
  if (bad === bad0) lines.push(`ok   ${id}: distance-based bonds identical for all ${entry.ligands.length} ligands`);
}
// template bonds matched by name onto real ligands (ligands whose component is recorded)
for (const id of ['6ZPO', '1K4C', '2ITD', '5VK6']) {
  const text = fs.readFileSync(path.join(dir, id + '.cif'), 'utf8'), entry = ctx.rowsToEntry(ctx.parseAtomSite(text), {}), mine = selectionSpace(parseMmcif(text)).ligands;
  for (const comp of ['ATP', 'HEM', 'F09', 'K']) {
    const classicTpl = await ctx.getTemplate(comp), tpl = await loadChemComp(comp, { fetchText });
    entry.ligands.forEach((L, k) => {
      if (L.comp !== comp) return;
      const a = ctx.bondsFromTemplate(L.atoms.map((x) => ({ name: x.name, el: x.el, p: x.p })), classicTpl), b = bondsFromTemplate(mine[k].atoms, tpl);
      check(`${id} ${comp} #${k}: bonds matched by atom name (${b?.length ?? 0})`, JSON.stringify(a) === JSON.stringify(b), `classic ${a?.length} vs new ${b?.length}`);
    });
  }
}
console.log(lines.join('\n') + `\n\n${total - bad}/${total} identical`);
if (out) fs.writeFileSync(out, lines.join('\n') + `\n\n${total - bad}/${total} identical\n`);
process.exitCode = bad ? 1 : 0;
