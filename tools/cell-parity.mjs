// Differential test: plugins/simulation/cell-geometry.mjs against the classic whole-cell geometry (ECOLI and capsuleGeo in src/sim/processes/whole-cell.js, run unchanged in
// a vm): the constants, and every vertex and index of the capsule surface for several cell frames, radii and resolutions. Usage: node tools/cell-parity.mjs [--output file]
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { pathToFileURL } from 'node:url';
import { ECOLI, capsuleFrame, capsuleSurface, cellFrameAt } from '../plugins/simulation/cell-geometry.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const out = process.argv.includes('--output') ? process.argv[process.argv.indexOf('--output') + 1] : null;
const THREE = await import(pathToFileURL(path.join(ROOT, 'desktop/node_modules/three/build/three.module.js')));
const V = (p) => new THREE.Vector3(...p);
const lines = []; let bad = 0, total = 0;
const check = (what, same, detail) => { total++; if (!same) bad++; lines.push(`${same ? 'ok  ' : 'DIFF'} ${what}${same ? '' : ' — ' + detail}`); };

const ctx = vm.createContext({ THREE, Math, console: { log() {}, warn() {}, error() {} } });
vm.runInContext('var PROCESSES = { cellCorner: {} }; var cutPlane = new THREE.Plane();', ctx);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'src/sim/processes/whole-cell.js'), 'utf8'), ctx);
check('cell constants (inner membrane radius, envelope, length, corner offset, region size): identical to the classic ECOLI', JSON.stringify(vm.runInContext('ECOLI', ctx)) === JSON.stringify(ECOLI), 'a constant differs');

for (const [name, o, az, R, H, nP, nT] of [['axis along x', [0, -4000, 0], 0, 4240, 5000, 160, 128], ['turned 0.7 rad', [120, -3900, -3000], 0.7, 4240, 4980, 80, 64], ['a small cell', [5, 5, 5], 2.1, 900, 300, 30, 24]]) {
  const e1 = [Math.cos(az), 0, -Math.sin(az)], ey = [0, 1, 0], e3 = [Math.sin(az), 0, Math.cos(az)];
  ctx.__F = { o: V(o), e1: V(e1), ey: V(ey), e3: V(e3) }; ctx.__args = [R, H, nP, nT];
  vm.runInContext('__F.at = (u, th, r) => __F.o.clone().addScaledVector(__F.e1, u).addScaledVector(__F.ey, r * Math.cos(th)).addScaledVector(__F.e3, r * Math.sin(th)); __g = capsuleGeo(__F, ...__args);', ctx);
  const g = vm.runInContext('__g', ctx), pos = g.getAttribute('position').array, idx = Array.from(g.getIndex().array), mine = capsuleSurface(capsuleFrame(o, e1, ey, e3), R, H, nP, nT);
  let worst = 0; for (let i = 0; i < pos.length; i++) worst = Math.max(worst, Math.abs(pos[i] - mine.positions[i]));
  const sameIdx = idx.length === mine.indices.length && idx.every((v, i) => v === mine.indices[i]);
  check(`capsule surface, ${name}: ${pos.length / 3} vertices and ${idx.length / 3} triangles, largest position difference ${worst.toExponential(1)} Å, indices ${sameIdx ? 'identical' : 'DIFFERENT'}`, pos.length === mine.positions.length && worst === 0 && sameIdx, `${worst}/${sameIdx}`);
}
// the cell placement of the classic setup: o = top - ey * Rim - e1 * uF
{
  const top = [10, 20, 30], e1 = [0.6, 0, -0.8], ey = [0, 1, 0], e3 = [0.8, 0, 0.6], r = cellFrameAt(top, e1, ey, e3);
  const classic = vm.runInContext('(() => { const C = ECOLI, t = new THREE.Vector3(10, 20, 30), e1 = new THREE.Vector3(0.6, 0, -0.8), ey = new THREE.Vector3(0, 1, 0); const o = t.clone().addScaledVector(ey, -C.Rim).addScaledVector(e1, -C.uF); const Rom = C.Rim + C.env; return { o: o.toArray(), Rom, H: C.L / 2 - Rom - 20 }; })()', ctx);
  check('cell placement under the corner (origin, outer radius, half length): identical to the classic setup', classic.o.every((v, i) => v === r.frame.o[i]) && classic.Rom === r.Rom && classic.H === r.H, JSON.stringify([classic, r.frame.o, r.Rom, r.H]));
}
console.log(lines.join('\n') + `\n\n${total - bad}/${total} identical`);
if (out) fs.writeFileSync(out, lines.join('\n') + `\n\n${total - bad}/${total} identical\n`);
process.exitCode = bad ? 1 : 0;
