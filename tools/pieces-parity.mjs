// Differential test: take-apart model (plugins/structure/pieces.mjs) against the classic take-apart code (src/ui/take-apart.js), run on real
// structures. Compares pieces, residue-level interfaces (per-residue nearest foreign point), ligand attachment, assembly order and the
// explode/pull offsets. Usage: node tools/pieces-parity.mjs <structures-dir> [--output file]
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { pathToFileURL } from 'node:url';
import { parseMmcif } from '../plugins/structure/parser.mjs';
import { applyBiologicalAssembly } from '../plugins/structure/assembly.mjs';
import { buildPieces, computeInterfaces, assemblyOrder, pieceOffset } from '../plugins/structure/pieces.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const dir = process.argv[2], out = process.argv.includes('--output') ? process.argv[process.argv.indexOf('--output') + 1] : null;
if (!dir) { console.error('usage: node tools/pieces-parity.mjs <structures-dir> [--output file]'); process.exit(2); }
const THREE = await import(pathToFileURL(path.join(ROOT, 'desktop/node_modules/three/build/three.module.js')));

const src = read('src/ui/take-apart.js');
const between = (a, b) => { const i = src.indexOf(a), j = src.indexOf(b, i); if (i < 0 || j < 0) throw new Error('marker not found: ' + a); return src.slice(i, j); };
const ctx = vm.createContext({
  THREE, console, Math, Map, Set, Array, Object, Number, String, JSON,
  $: () => ({ value: 'x' }), PALETTES: { x: ['#888888'] }, illustrative: () => false, findKey: () => null, kwMatch: () => false,
  LRU: class { constructor() {} get() {} set() {} }, LIPIDS: new Set(['POPC', 'POPE', 'CLR']), current: { notes: {} }, groups: [], model: null,
});
vm.runInContext(between('const HYDRO_RES', 'function kitColours'), ctx);   // kitShort, kitBuildPieces, kitContacts, kitOrder
vm.runInContext('IGNORE_LIGANDS = new Set(["HOH","WAT"]);', ctx);
vm.runInContext(read('src/data/parse.js'), ctx);
const attachSnippet = between('const byPc = new Map();', 'for (const [pc, mols] of byPc)');
const dirSnippet = between('const v = pc.c.clone().sub(kit.C);', 'kitColours(pc)');
const posSnippet = between('pc.obj.position.copy(pc.v)', '\n  }\n  /* interface bands');
vm.runInContext(`function attachLigands(P){ ${attachSnippet}; return byPc; }`, ctx);
vm.runInContext(`function placement(pc,i,kit){ ${dirSnippet} }`, ctx);
vm.runInContext(`function offsetOf(pc,kit){ ${posSnippet.trim().replace(/;?\s*$/, '')}; return pc.obj.position; }`, ctx);

const lines = []; let bad = 0, total = 0;
const check = (id, what, same, detail) => { total++; if (!same) bad++; lines.push(`${same ? 'ok  ' : 'DIFF'} ${id} ${what}${same ? '' : ' — ' + detail}`); };
for (const id of fs.readdirSync(dir).filter((f) => f.endsWith('.cif')).map((f) => f.slice(0, -4))) {
  const text = fs.readFileSync(path.join(dir, id + '.cif'), 'utf8');
  const entry = ctx.rowsToEntry(ctx.parseAtomSite(text), {});
  for (const a of entry.atoms) a.src = id;
  for (const L of entry.ligands) { L.centre = L.atoms.reduce((s, x) => s.add(x.p), new THREE.Vector3()).multiplyScalar(1 / L.atoms.length); L.hidden = false; L.state = 0; }
  ctx.groups = [{ visible: true, name: 'all', atoms: entry.atoms }]; ctx.model = { ligands: entry.ligands }; ctx.current = { notes: {} };
  const P = ctx.kitBuildPieces(); ctx.kitContacts(P);
  const next = buildPieces(parseMmcif(text)); computeInterfaces(next);

  // pieces: same chains, same residue counts, same order
  const sig = (list) => list.map((p) => `${p.asym}:${p.atoms?.length ?? p.residues.length}`);
  const sameOrder = JSON.stringify(sig(P)) === JSON.stringify(sig(next.pieces));
  check(id, `${P.length} pieces (chain:residues, biggest first)`, sameOrder, `classic ${sig(P).join()} vs new ${sig(next.pieces).join()}`);
  if (!sameOrder) continue;

  // interfaces: partner counts and per-residue nearest-foreign distance
  let partnerDiff = 0, nearDiff = 0, maxDelta = 0;
  P.forEach((pc, i) => {
    const q = next.pieces[i];
    const a = [...pc.partners].map(([j, e]) => `${j}:${e.n}`).sort().join(), b = [...q.partners].map(([j, e]) => `${j}:${e.n}`).sort().join();
    if (a !== b) partnerDiff++;
    pc.near.forEach((n, k) => { const m = q.near[k]; if (!!n !== !!m || (n && (n.pj !== m.pj || n.bj !== m.rj))) nearDiff++; else if (n) maxDelta = Math.max(maxDelta, Math.abs(n.d - m.d)); });
  });
  check(id, 'interface partners and per-residue nearest foreign residue', !partnerDiff && !nearDiff && maxDelta < 1e-6, `pieces with different partners ${partnerDiff}, residues with different nearest ${nearDiff}, max distance delta ${maxDelta}`);

  // ligand attachment
  const byPc = ctx.attachLigands(P);
  const la = P.map((pc) => (byPc.get(pc) || []).map((L) => L.comp).sort().join()).join('|'), lb = next.pieces.map((p) => p.ligands.map((L) => L.comp).sort().join()).join('|');
  const nLig = next.pieces.reduce((n, p) => n + p.ligands.length, 0);
  check(id, `ligand attachment (${nLig} attached)`, la === lb, `classic ${la} vs new ${lb}`);

  // assembly order (greedy)
  const oa = ctx.kitOrder(P).order.map((pc) => pc.asym).join(), ob = assemblyOrder(next).order.map((p) => p.asym).join();
  check(id, 'greedy assembly order', oa === ob, `classic ${oa} vs new ${ob}`);

  // explode / pull offsets in the same (raw) frame
  const kit = { C: new THREE.Vector3(...next.centre), P };
  let maxOffset = 0;
  P.forEach((pc, i) => {
    pc.c = pc.c; placement(pc, i, kit);
    for (const [e, pull] of [[0, 0], [0.6, 0], [1, 1], [0.3, 1]]) {
      pc.e = e; pc.pull = pull; pc.obj = { position: new THREE.Vector3() };
      const o = ctx.offsetOf(pc, kit), n = pieceOffset(next, next.pieces[i], e, pull);
      maxOffset = Math.max(maxOffset, Math.abs(o.x - n[0]), Math.abs(o.y - n[1]), Math.abs(o.z - n[2]));
    }
  });
  check(id, 'explode/pull offsets (Å)', maxOffset < 1e-6, `max delta ${maxOffset}`);
  check(id, 'restore: offsets at explode 0, pull 0 are exactly zero', next.pieces.every((p) => pieceOffset(next, p, 0, 0).every((v) => v === 0)), 'non-zero offset');
}
function placement(pc, i, kit) { vm.runInContext('0', ctx); ctx.__pc = pc; ctx.__i = i; ctx.__kit = kit; ctx.placement(pc, i, kit); }
console.log(lines.join('\n') + `\n\n${total - bad}/${total} identical`);
if (out) fs.writeFileSync(out, lines.join('\n') + `\n\n${total - bad}/${total} identical\n`);
process.exitCode = bad ? 1 : 0;
