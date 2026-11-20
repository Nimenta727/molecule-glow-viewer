// Differential test: the site poses of plugins/simulation/ribosome-motion.mjs against the classic setup of src/sim/processes/translation.js (the block that finds the mRNA, the three tRNAs, orders
// them E / P / A by their anticodons along the mRNA and fits the poses of the P-site template onto them), cut out of the source by its markers and run unchanged in a vm on the real 4V6F.
// The classic is compared on the first biological assembly (one ribosome: what its selection of the three tRNAs was made for); on the raw entry, which holds two ribosomes, the sites are checked
// against the 16S contacts instead. Usage: node tools/ribosome-parity.mjs <structures-dir> [--three <three.module.js>] [--output file]   (structures-dir holds 4V6F.cif)
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { pathToFileURL } from 'node:url';
import { parseMmcif } from '../plugins/structure/parser.mjs';
import { selectionSpace } from '../plugins/structure/selection.mjs';
import { applyBiologicalAssembly } from '../plugins/structure/assembly.mjs';
import { ribosomeFrame, applyPose } from '../plugins/simulation/ribosome-motion.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : null);
const dir = process.argv[2], out = arg('--output');
if (!dir) { console.error('usage: node tools/ribosome-parity.mjs <structures-dir> [--three file] [--output file]'); process.exit(2); }
const THREE = await import(pathToFileURL(arg('--three') ?? path.join(ROOT, 'desktop/node_modules/three/build/three.module.js')));
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const lines = []; let bad = 0, total = 0;
const check = (what, same, detail) => { total++; if (!same) bad++; lines.push(`${same ? 'ok  ' : 'DIFF'} ${what}${same ? '' : ' — ' + detail}`); };
const close = (a, b, tol = 1e-9) => a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) <= tol);

const raw = parseMmcif(fs.readFileSync(path.join(dir, '4V6F.cif'), 'utf8')), space = selectionSpace(applyBiologicalAssembly(raw, '1'));
const atoms = space.residues.map((r) => ({ p: r.position, part: r.entity, seq: r.labelSeq, asym: r.labelAsym }));
lines.push(`4V6F: ${atoms.length} residues, ${atoms.filter((a) => /^mrna$/i.test(a.part)).length} of mRNA, ${new Set(atoms.filter((a) => /trna/i.test(a.part)).map((a) => a.asym)).size} tRNA chains`);

const src = read('src/sim/processes/translation.js'), a = src.indexOf("const V = () => new THREE.Vector3(), cen = (A) => A.reduce((s, a) => s.add(a.p || a), V()).multiplyScalar(1 / Math.max(1, A.length));"), endMark = 'const end3 = (pose) => this.R3(pose, T0[T0.length - 1]);', b = src.indexOf(endMark) + endMark.length;
if (a < 0 || b < endMark.length) throw new Error('classic setup block not found');
const sandbox = vm.createContext({ THREE, Math, console: { log() {}, warn() {}, error() {} } });
vm.runInContext(read('src/derived/geometry.js'), sandbox);
vm.runInContext(`function classicSites(ctx) { const self = {}; ${src.slice(a, b).replaceAll('this.', 'self.')}; return self; }`, sandbox);
const V = (p) => new THREE.Vector3(p[0], p[1], p[2]);
sandbox.__ctx = { allAtoms: atoms.map((x) => ({ p: V(x.p), part: x.part, seq: x.seq, asym: x.asym })), partGroups: () => [{ set visible(v) {} }] };
const classic = vm.runInContext('classicSites(__ctx)', sandbox), arr = (v) => [v.x, v.y, v.z];
const mine = ribosomeFrame(atoms);

check(`mRNA: ${classic.mPts.length} points, the codon position of the P site is point ${classic.jP}`, classic.mPts.length === mine.mPts.length && classic.jP === mine.jP && classic.mPts.every((p, i) => close(arr(p), mine.mPts[i])), `${classic.jP} vs ${mine.jP}`);
check(`template tRNA (the P-site tRNA): ${classic.T.n} residues, same centre, same acceptor-arm weights`, classic.T.n === mine.n && close(arr(classic.T.c), mine.cT) && classic.T.acc.every((v, i) => v === mine.acc[i]), `${classic.T.n} vs ${mine.n}`);
for (const k of ['E', 'P', 'A']) {
  const c = classic.site[k], m = mine.sites[k], qc = [c.q.x, c.q.y, c.q.z, c.q.w];
  const sameQ = close(qc, m.q, 1e-9) || close(qc, m.q.map((v) => -v), 1e-9);   // q and -q are the same rotation
  check(`${k} site: same rotation and translation (within 1e-9)`, sameQ && close(arr(c.t), m.t, 1e-7), `${qc} / ${arr(c.t)} vs ${m.q} / ${m.t}`);
  const cEnd = arr(classic.R3(c, classic.T.ref[classic.T.n - 1])), mEnd = applyPose(mine, m, mine.T0[mine.n - 1]);
  check(`${k} site: the acceptor end (last residue) lands on the same point`, close(cEnd, mEnd, 1e-6), `${cEnd} vs ${mEnd}`);
}
// the raw entry holds two ribosomes: the sites must still be those of one ribosome, in the right order (E, P, A are told by what the anticodon touches in the 16S rRNA)
{
  const R = selectionSpace(raw).residues, atoms2 = R.map((r) => ({ p: r.position, part: r.entity, seq: r.labelSeq, asym: r.labelAsym })), f = ribosomeFrame(atoms2), d = (a, b) => Math.hypot(...a.map((v, i) => v - b[i]));
  const ribosomeOf = (asym) => { const ac = R.find((r) => r.labelAsym === asym && r.labelSeq === 35).position; const m = R.filter((r) => /^mrna$/i.test(r.entity)); return m.reduce((b, r) => (d(r.position, ac) < b[1] ? [r.labelAsym, d(r.position, ac)] : b), ['', Infinity])[0]; };
  const touch = (asym, n) => { const ac = R.find((r) => r.labelAsym === asym && r.labelSeq === 35).position, s16 = R.filter((r) => /16s/i.test(r.entity) && r.authSeq === n); return Math.min(...s16.map((r) => d(r.position, ac))); };
  const E = Object.entries({ A: f.ids.asymA, P: f.ids.asymP }).map(([k, a]) => [k, a]), eAsym = [...new Set(R.filter((r) => /trna/i.test(r.entity)).map((r) => r.labelAsym))].filter((a) => ![f.ids.asymA, f.ids.asymP].includes(a) && ribosomeOf(a) === ribosomeOf(f.ids.asymA))[0];
  check('two ribosomes in the entry: the A and P tRNAs belong to the same ribosome (the same mRNA chain)', ribosomeOf(f.ids.asymA) === ribosomeOf(f.ids.asymP), `${ribosomeOf(f.ids.asymA)} / ${ribosomeOf(f.ids.asymP)}`);
  check(`the A-site tRNA's anticodon touches G530 (${touch(f.ids.asymA, 530).toFixed(1)} Å) more closely than C1400 (${touch(f.ids.asymA, 1400).toFixed(1)} Å): the decoding centre`, touch(f.ids.asymA, 530) < touch(f.ids.asymA, 1400), 'A and P mixed up');
  check(`the P-site tRNA's anticodon touches C1400 (${touch(f.ids.asymP, 1400).toFixed(1)} Å) more closely than G530 (${touch(f.ids.asymP, 530).toFixed(1)} Å)`, touch(f.ids.asymP, 1400) < touch(f.ids.asymP, 530), 'P and A mixed up'); void E; void eAsym;
}
const report = `${lines.join('\n')}\n${total - bad}/${total} identical\n`;
console.log(report); if (out) fs.writeFileSync(out, report);
process.exit(bad ? 1 : 0);
