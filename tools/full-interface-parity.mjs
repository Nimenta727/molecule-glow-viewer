// Differential test: all-atom interface classification (plugins/structure/full-interface.mjs) against the classic kitFullAtom
// (src/ui/take-apart.js), on real structures. The classic code downloads atoms from RCSB; here its download step is replaced by the same atoms read
// from the local file, so both sides classify identical coordinates. Usage: node tools/full-interface-parity.mjs <structures-dir> [--output file] [--pieces N]
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { pathToFileURL } from 'node:url';
import { parseMmcif } from '../plugins/structure/parser.mjs';
import { buildPieces, computeInterfaces, partnersOf } from '../plugins/structure/pieces.mjs';
import { fullInterface } from '../plugins/structure/full-interface.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined);
const dir = process.argv[2], out = arg('--output'), perStructure = +(arg('--pieces') ?? 4);
if (!dir) { console.error('usage: node tools/full-interface-parity.mjs <structures-dir> [--output file] [--pieces N]'); process.exit(2); }
const THREE = await import(pathToFileURL(path.join(ROOT, 'desktop/node_modules/three/build/three.module.js')));

const src = read('src/ui/take-apart.js');
const between = (a, b) => { const i = src.indexOf(a), j = src.indexOf(b, i); if (i < 0 || j < 0) throw new Error('marker not found: ' + a); return src.slice(i, j); };
const ctx = vm.createContext({
  THREE, console, Math, Map, Set, Array, Object, Number, String, JSON, Promise,
  $: () => ({ value: 'x' }), PALETTES: { x: ['#888888'] }, illustrative: () => false, findKey: () => null, kwMatch: () => false,
  LRU: class { constructor() {} get() {} set() {} }, LIPIDS: new Set(), current: { notes: {} }, groups: [], model: null, kit: null,
  status: () => {}, kitInfo: () => {}, kitLinksResidue: () => {}, kitChainAtoms: null,
});
vm.runInContext(between('const HYDRO_RES', 'function kitColours'), ctx);                       // kitBuildPieces, kitContacts
vm.runInContext(between('/* partners of a piece, both directions', 'function kitLinksResidue'), ctx);   // kitPartnersOf
vm.runInContext(between('async function kitFullAtom', 'function kitPlay'), ctx);
vm.runInContext('IGNORE_LIGANDS = new Set(["HOH","WAT"]);', ctx);
vm.runInContext(read('src/data/parse.js'), ctx);

const lines = []; let bad = 0, total = 0;
const norm = (c) => JSON.stringify(['ss', 'salt', 'hbond', 'hydro'].map((t) => c[t].map((v) => [v.x?.seq ?? v.a.labelSeq, v.y?.seq ?? v.b.labelSeq, (v.x?.an ?? v.a.name), (v.y?.an ?? v.b.name), +v.d.toFixed(5)]).sort()).concat([c.clash.size]));
for (const id of fs.readdirSync(dir).filter((f) => f.endsWith('.cif')).map((f) => f.slice(0, -4))) {
  const text = fs.readFileSync(path.join(dir, id + '.cif'), 'utf8');
  const entry = ctx.rowsToEntry(ctx.parseAtomSite(text), {});
  for (const a of entry.atoms) a.src = id;
  ctx.groups = [{ visible: true, name: 'all', atoms: entry.atoms }]; ctx.model = { ligands: [] }; ctx.current = { notes: {} };
  const P = ctx.kitBuildPieces(); ctx.kitContacts(P);
  ctx.kit = { P, sel: null, links: [] };
  const rows = ctx.parseAtomSite(text).filter((r) => r.g === 'ATOM' && r.el !== 'H' && r.el !== 'D' && (!r.alt || r.alt === '.' || r.alt === '?' || r.alt === 'A'));
  ctx.kitChainAtoms = async (pc) => (pc.atoms.length > 2500 ? null : rows.filter((r) => r.asym === pc.asym0).map((r) => ({ ...r, p: new THREE.Vector3(r.x, r.y, r.z) })));
  const model = parseMmcif(text), built = buildPieces(model); computeInterfaces(built);
  // the pieces with the most interface partners are the interesting ones
  const chosen = P.map((pc, i) => [pc, i]).filter(([pc]) => pc.atoms.length <= 2500).sort((a, b) => ctx.kitPartnersOf(b[0]).length - ctx.kitPartnersOf(a[0]).length).slice(0, perStructure);
  for (const [pc, i] of chosen) {
    await ctx.kitFullAtom(pc);
    if (!pc.full) { lines.push(`skip ${id} chain ${pc.asym}: classic could not compute`); continue; }
    const piece = built.pieces[i], partners = partnersOf(built, piece).map((x) => x.piece);
    const mine = fullInterface(model, piece, partners);
    let diffs = [], compared = 0, contacts = 0;
    for (const [pj, c] of pc.full.by) {
      const m = mine.byPartner.get(pj);
      compared++;
      contacts += c.ss.length + c.salt.length + c.hbond.length + c.hydro.length;
      if (!m || norm(c) !== norm(m)) diffs.push(`partner ${P[pj].asym}: classic ${norm(c)} vs new ${m ? norm(m) : 'missing'}`);
    }
    total++;
    if (diffs.length) bad++;
    lines.push(`${diffs.length ? 'DIFF' : 'ok  '} ${id} chain ${pc.asym}: ${compared} partners, ${contacts} classified contacts${diffs.length ? ' — ' + diffs.join('; ').slice(0, 400) : ''}`);
  }
}
console.log(lines.join('\n') + `\n\n${total - bad}/${total} identical`);
if (out) fs.writeFileSync(out, lines.join('\n') + `\n\n${total - bad}/${total} identical\n`);
process.exitCode = bad ? 1 : 0;
