// Differential test: plugins/structure/membrane-placement.mjs against the classic membrane finder (hydroSlab and autoMembrane in src/sim/processes/auto.js, cut out of the source
// and run unchanged in a vm with the real jacobi / applyTf of src/derived/geometry.js). Same coarse structures (one point per residue of the fixture structures); the
// transmembrane segments are written by hand from the published KcsA topology (they stand in for the OPM / PDBTM annotation the classic downloads), so nothing is fetched.
// Compared: the result record (source, number of segments, half thickness, Lys/Arg counts, which side, pore axes) and every point after the move. Soluble proteins are negative controls.
// Usage: node tools/membrane-parity.mjs <structures-dir> [--output file]
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { pathToFileURL } from 'node:url';
import { parseMmcif } from '../plugins/structure/parser.mjs';
import { selectionSpace } from '../plugins/structure/selection.mjs';
import { placeMembrane, applyPlacement, hydrophobicBelt } from '../plugins/structure/membrane-placement.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const dir = process.argv[2], out = process.argv.includes('--output') ? process.argv[process.argv.indexOf('--output') + 1] : null;
if (!dir) { console.error('usage: node tools/membrane-parity.mjs <structures-dir> [--output file]'); process.exit(2); }
const THREE = await import(pathToFileURL(path.join(ROOT, 'desktop/node_modules/three/build/three.module.js')));
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const lines = []; let bad = 0, total = 0;
const check = (what, same, detail) => { total++; if (!same) bad++; lines.push(`${same ? 'ok  ' : 'DIFF'} ${what}${same ? '' : ' — ' + detail}`); };

const ctx = vm.createContext({ THREE, Math, console: { log() {}, warn() {}, error() {} } });
const auto = read('src/sim/processes/auto.js'), a = auto.indexOf('/* hydrophobic belt'), b = auto.indexOf('const niceTitle');
const hydro = read('src/ui/take-apart.js').split('\n').find((l) => l.startsWith('const HYDRO_RES'));
vm.runInContext(read('src/derived/geometry.js') + '\n' + hydro + '\n' + auto.slice(a, b), ctx);
const run = (code) => vm.runInContext(code, ctx);

const coarse = (id) => selectionSpace(parseMmcif(read ? fs.readFileSync(path.join(dir, id + '.cif'), 'utf8') : '')).residues.map((r) => ({ position: [...r.position], asym: r.asym, seq: r.labelSeq, nucleic: r.nucleic, resn: r.resn, entity: r.entity }));
const classicAtoms = (atoms) => atoms.map((x) => ({ p: new THREE.Vector3(...x.position), asym: x.asym, seq: x.seq, na: x.nucleic, resn: x.resn, ent: x.entity }));
const same = (x, y) => JSON.stringify(x) === JSON.stringify(y);

async function compare(label, id, info, { expectFound = true, kcsaOnly = false } = {}) {
  let atoms = coarse(id);
  if (kcsaOnly) atoms = atoms.filter((x) => x.entity.includes('potassium') || x.entity.includes('voltage'));
  const classicInfo = info && { ...info, topo: info.topo?.map((t) => ({ ent: t.entity, b: t.b, e: t.e, side: t.side })) };
  ctx.__atoms = classicAtoms(atoms); ctx.__info = classicInfo ?? null;
  const classic = run(`(() => { const main = { atoms: __atoms, ligands: [] }; const r = autoMembrane(main, __info); return { r, pts: main.atoms.map((a) => [a.p.x, a.p.y, a.p.z]) }; })()`);
  const mine = placeMembrane(atoms, info);
  if (!classic.r || !mine) { check(`${label}: ${classic.r ? 'classic finds a membrane, new code does not' : mine ? 'new code finds a membrane, classic does not' : 'no membrane found (' + atoms.length + ' residues), as in the classic'}`, !classic.r && !mine && !expectFound, `${!!classic.r}/${!!mine}`); return; }
  const rec = (r) => ({ y: r.y, half: r.half, src: r.src, nSeg: r.nSeg, krIn: r.krIn, krOut: r.krOut, how: r.how, axes: r.axes, sideSure: r.sideSure });
  const moved = applyPlacement(atoms.map((x) => x.position), mine.placement);
  let worst = 0; moved.forEach((p, i) => { for (let k = 0; k < 3; k++) worst = Math.max(worst, Math.abs(p[k] - classic.pts[i][k])); });
  const exact = moved.every((p, i) => p.every((v, k) => v === classic.pts[i][k] || Math.abs(v - classic.pts[i][k]) === 0));
  check(`${label}: ${atoms.length} residues → membrane from ${mine.src} (${mine.nSeg} segments), half thickness ${mine.half.toFixed(1)} Å, Lys/Arg ${mine.krIn} inside / ${mine.krOut} outside (${mine.how}${mine.sideSure ? ', sure' : ', unsure'}), ${mine.axes.length} pore axes: record ${same(rec(classic.r), rec(mine)) ? 'equal' : 'DIFFERENT'}, all points after the move differ by at most ${worst.toExponential(1)}`,
    same(rec(classic.r), rec(mine)) && worst < 1e-9 && expectFound, JSON.stringify([rec(classic.r), rec(mine)]).slice(0, 300) + ' ' + worst);
}

// KcsA topology (UniProt P0A334 / 1K4C numbering): N-terminus inside 1–22, TM1 23–51, outer loop with the pore helix and selectivity filter 52–85, TM2 86–112, C-terminus inside 113–
const kcsa = (asyms) => asyms.flatMap((asym) => [{ asym, b: 23, e: 51 }, { asym, b: 86, e: 112 }]);
const space = selectionSpace(parseMmcif(fs.readFileSync(path.join(dir, '1K4C.cif'), 'utf8')));
const chains = [...new Set(space.residues.filter((r) => r.entity.includes('potassium') || r.entity.includes('voltage')).map((r) => r.asym))];
const entityOf = space.residues.find((r) => chains.includes(r.asym))?.entity;
const topo = [{ entity: entityOf, b: 1, e: 22, side: -1 }, { entity: entityOf, b: 52, e: 85, side: 1 }, { entity: entityOf, b: 113, e: 160, side: -1 }];
await compare('1K4C KcsA, segments and UniProt topology', '1K4C', { segs: kcsa(chains), segSrc: 'OPM', memAnn: true, topo });
await compare('1K4C KcsA, segments only (positive-inside rule)', '1K4C', { segs: kcsa(chains), segSrc: 'PDBTM', memAnn: true, topo: [] });
await compare('2HVK KcsA, segments (another entry, another state)', '2HVK', { segs: kcsa([...new Set(selectionSpace(parseMmcif(fs.readFileSync(path.join(dir, '2HVK.cif'), 'utf8'))).residues.filter((r) => r.entity.includes('potassium') || r.entity.includes('voltage')).map((r) => r.asym))]), segSrc: 'MemProtMD', memAnn: true, topo: [] });
await compare('1K4C single chain, membrane annotation but no segments: the scan finds no belt on one subunit', '1K4C', { segs: [], memAnn: true, topo: [] }, { expectFound: false });
await compare('6ZPO ATP synthase, membrane annotation only (scan over the whole complex)', '6ZPO', { segs: [], memAnn: true, topo: [] });
await compare('4AKE adenylate kinase, soluble, no annotation: left alone', '4AKE', { segs: [], memAnn: false, topo: [] }, { expectFound: false });
await compare('4AKE soluble with a (wrong) membrane label: the scan finds no belt', '4AKE', { segs: [], memAnn: true, topo: [] }, { expectFound: false });
{
  const prot = coarse('1K4C').filter((x) => !x.nucleic); ctx.__prot = classicAtoms(prot);
  const c = run('(() => { const h = hydroSlab(__prot); return h && { n: [h.n.x, h.n.y, h.n.z], count: h.atoms.length }; })()'), m = hydrophobicBelt(prot);
  check(`hydrophobic belt of 1K4C alone: ${m ? m.atoms.length + ' belt residues' : 'none'}: normal and belt size equal to the classic`, same(c, m && { n: m.normal, count: m.atoms.length }), JSON.stringify([c, m && m.atoms.length]));
}

console.log(lines.join('\n') + `\n\n${total - bad}/${total} identical`);
if (out) fs.writeFileSync(out, lines.join('\n') + `\n\n${total - bad}/${total} identical\n`);
process.exitCode = bad ? 1 : 0;
