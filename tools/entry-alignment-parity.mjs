// Differential test (needs the network): plugins/simulation/entry-alignment.mjs against the classic alignEntry of src/data/extra-entries.js. The block of alignEntry that fits an entry onto the scene
// by its reference chain (iterative rejection, residues matched by label or author numbering) is cut out of the source by its markers and run unchanged in a vm on the same real atoms: the 23S
// rRNA of the scene (4V6F) and the 23S rRNA of 4V5L (EF-Tu ternary complex) / 4V9H (EF-G) / 4V7P (RF1), fetched from RCSB's ModelServer exactly as the classic does.
// Usage: node tools/entry-alignment-parity.mjs <structures-dir> [--three <three.module.js>] [--output file]   (structures-dir holds 4V6F.cif)
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { pathToFileURL } from 'node:url';
import { parseMmcif } from '../plugins/structure/parser.mjs';
import { selectionSpace } from '../plugins/structure/selection.mjs';
import { loadAlignedEntry } from '../plugins/simulation/entry-alignment.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : null);
const dir = process.argv[2], out = arg('--output');
if (!dir) { console.error('usage: node tools/entry-alignment-parity.mjs <structures-dir> [--three file] [--output file]'); process.exit(2); }
const THREE = await import(pathToFileURL(arg('--three') ?? path.join(ROOT, 'desktop/node_modules/three/build/three.module.js')));
const lines = []; let bad = 0, total = 0;
const check = (what, same, detail) => { total++; if (!same) bad++; lines.push(`${same ? 'ok  ' : 'DIFF'} ${what}${same ? '' : ' — ' + detail}`); };
const fetchText = async (url) => { const r = await fetch(url); if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`); return r.text(); };
const graphql = async (query) => (await fetch('https://data.rcsb.org/graphql', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query }) })).json();

const space = selectionSpace(parseMmcif(fs.readFileSync(path.join(dir, '4V6F.cif'), 'utf8')));
const first23 = space.residues.find((r) => /23s/i.test(r.entity) && r.nucleic)?.labelAsym;
const scene = space.residues.filter((r) => /23s/i.test(r.entity) && r.nucleic && r.labelAsym === first23).map((r) => ({ p: [...r.position], seq: r.labelSeq, aseq: String(r.authSeq) }));
lines.push(`scene: ${scene.length} residues of the 23S rRNA of 4V6F (chain ${first23})`);

const src = fs.readFileSync(path.join(ROOT, 'src/data/extra-entries.js'), 'utf8'), a = src.indexOf('const fit = (keyOf) => {'), endMark = 'const { f } = best;', b = src.indexOf(endMark) + endMark.length;
if (a < 0 || b < endMark.length) throw new Error('classic fit block not found');
const sandbox = vm.createContext({ THREE, Math, String, Error, superpose: null });
vm.runInContext(fs.readFileSync(path.join(ROOT, 'src/derived/geometry.js'), 'utf8'), sandbox);
vm.runInContext(`function classicFit(opts, refRows, id) { const V = (r) => new THREE.Vector3(r.x, r.y, r.z); ${src.slice(a, b)}; return { best, f }; }`, sandbox);

// the fetchers the loader needs: GraphQL by POST (the loader passes the query text), ModelServer by GET
const loader = (id) => loadAlignedEntry(id, { ref: '23S', refAtoms: scene }, { fetchText, fetchJson: (query) => graphql(query) });
for (const id of ['4V5L', '4V9H', '4V7P']) {
  let mine;
  try { mine = await loader(id); } catch (error) { check(`${id}: loaded and aligned`, false, error.message); continue; }
  const asym = mine.refAsym, text = await fetchText(`https://models.rcsb.org/v1/${id.toLowerCase()}/atoms?label_asym_id=${asym}&label_atom_id=P&encoding=cif&copy_all_categories=false`);
  const refRows = parseMmcif(text).atoms.filter((x) => x.element !== 'H' && (!x.altLoc || ['.', '?', 'A'].includes(x.altLoc))).map((x) => ({ x: x.position[0], y: x.position[1], z: x.position[2], seq: Number.parseInt(x.labelSeqId, 10), aseq: x.authSeqId }));
  sandbox.__opts = { refAtoms: scene.map((s) => ({ p: new THREE.Vector3(...s.p), seq: s.seq, aseq: s.aseq })) }; sandbox.__rows = refRows;
  const classic = vm.runInContext(`classicFit(__opts, __rows, ${JSON.stringify(id)})`, sandbox), c = classic.best;
  check(`${id}: ${mine.nFit}/${mine.nOf} reference residues kept, matched by ${mine.key} numbering, RMSD ${mine.rmsd.toFixed(3)} Å: the same fit as the classic (${c.n}/${c.of}, ${c.key}, ${c.rmsd.toFixed(3)} Å)`, mine.nFit === c.n && mine.nOf === c.of && mine.key === c.key && Math.abs(mine.rmsd - c.rmsd) < 1e-9, `${mine.nFit}/${mine.nOf} ${mine.key} ${mine.rmsd} vs ${c.n}/${c.of} ${c.key} ${c.rmsd}`);
  const probes = [[0, 0, 0], [50, -20, 80], [-100, 30, 10]].map((p) => [p, classic.f(new THREE.Vector3(...p)), mine.f(p)]);
  check(`${id}: the transform sends points to the same places (within 1e-7 Å)`, probes.every(([, cv, mv]) => Math.hypot(cv.x - mv[0], cv.y - mv[1], cv.z - mv[2]) < 1e-7), JSON.stringify(probes.map(([, cv, mv]) => [cv.x, mv[0]])));
}
const report = `${lines.join('\n')}\n${total - bad}/${total} identical\n`;
console.log(report); if (out) fs.writeFileSync(out, report);
process.exit(bad ? 1 : 0);
