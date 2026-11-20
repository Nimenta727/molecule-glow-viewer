// Differential test: the site poses of plugins/simulation/ribosome-motion.mjs against the classic setup of src/sim/processes/translation.js (the block that finds the mRNA, the three tRNAs, orders
// them E / P / A by their anticodons along the mRNA and fits the poses of the P-site template onto them), cut out of the source by its markers and run unchanged in a vm on the real 4V6F.
// Usage: node tools/ribosome-parity.mjs <structures-dir> [--three <three.module.js>] [--output file]   (structures-dir holds 4V6F.cif)
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { pathToFileURL } from 'node:url';
import { parseMmcif } from '../plugins/structure/parser.mjs';
import { selectionSpace } from '../plugins/structure/selection.mjs';
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

const space = selectionSpace(parseMmcif(read === null ? '' : fs.readFileSync(path.join(dir, '4V6F.cif'), 'utf8')));
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
const report = `${lines.join('\n')}\n${total - bad}/${total} identical\n`;
console.log(report); if (out) fs.writeFileSync(out, report);
process.exit(bad ? 1 : 0);
