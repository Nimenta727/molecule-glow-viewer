// Differential test: rotation axes and spin placement of plugins/motion/rotation.mjs against the classic code (src/derived/geometry.js orientTransform for the
// axis modes, src/repr/rebuild.js spinPose for the placement of a spinning part about a pivot), on the real chains of the fixture structures.
// Usage: node tools/rotation-parity.mjs <structures-dir> [--output file]
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { pathToFileURL } from 'node:url';
import { parseMmcif } from '../plugins/structure/parser.mjs';
import { selectionSpace } from '../plugins/structure/selection.mjs';
import { chooseAxis, rotateAbout } from '../plugins/motion/rotation.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const dir = process.argv[2], out = process.argv.includes('--output') ? process.argv[process.argv.indexOf('--output') + 1] : null;
if (!dir) { console.error('usage: node tools/rotation-parity.mjs <structures-dir> [--output file]'); process.exit(2); }
const THREE = await import(pathToFileURL(path.join(ROOT, 'desktop/node_modules/three/build/three.module.js')));
const ctx = vm.createContext({ THREE, console, Math, theta: 0 });
vm.runInContext(read('src/derived/geometry.js'), ctx);
const rebuild = read('src/repr/rebuild.js'), spinSource = rebuild.slice(rebuild.indexOf('function spinPose'), rebuild.indexOf('const REPS'));
vm.runInContext(spinSource, ctx);

const lines = []; let bad = 0, total = 0;
const check = (what, same, detail) => { total++; if (!same) bad++; lines.push(`${same ? 'ok  ' : 'DIFF'} ${what}${same ? '' : ' — ' + detail}`); };
const V = (p) => new THREE.Vector3(...p);

for (const id of ['6ZPO', '1K4C', '4AKE']) {
  const model = parseMmcif(fs.readFileSync(path.join(dir, id + '.cif'), 'utf8'));
  const byChain = new Map();
  for (const r of selectionSpace(model).residues) { if (!byChain.has(r.asym)) byChain.set(r.asym, []); byChain.get(r.asym).push(r.position); }
  const sets = [...byChain.entries()].filter(([, pts]) => pts.length >= 30).slice(0, 8);
  if (id === '6ZPO') sets.push(['all chains', [...byChain.values()].flat()]);
  let worst = 0, centreWorst = 0, count = 0;
  for (const [, points] of sets) {
    for (const mode of ['long', 'short', 'sym']) {
      const tf = ctx.orientTransform(points.map(V), mode);
      const classic = new THREE.Vector3(0, 1, 0).applyQuaternion(tf.q.clone().invert());
      const mine = chooseAxis(mode, { points });
      worst = Math.max(worst, 1 - Math.abs(classic.x * mine.direction[0] + classic.y * mine.direction[1] + classic.z * mine.direction[2]));
      centreWorst = Math.max(centreWorst, Math.hypot(tf.centre.x - mine.point[0], tf.centre.y - mine.point[1], tf.centre.z - mine.point[2]));
      count++;
    }
  }
  check(`${id}: ${count} axes (long / short / symmetry of ${sets.length} point sets): direction off by ${worst.toExponential(1)}, centre off by ${centreWorst.toExponential(1)} Å`, worst < 1e-9 && centreWorst < 1e-9, `${worst} / ${centreWorst}`);
}

// the classic spin: a mesh turned about Y by theta around the pivot (x, z)
let spinWorst = 0, spinCount = 0;
for (const pivot of [{ x: 0, y: 0 }, { x: 12.5, y: -7.25 }, { x: -30, y: 41 }]) for (const th of [0.3, 1.7, -2.4, 6.1]) {
  const g = { spin: true, pivot, mesh: new THREE.Object3D() };
  ctx.theta = th; ctx.spinPose(g); g.mesh.updateMatrix();
  for (const p of [[3, 4, 5], [-20, 9, 33], [0, 0, 0], [12.5, 8, -7.25]]) {
    const classic = V(p).applyMatrix4(g.mesh.matrix), mine = rotateAbout(p, { point: [pivot.x, 0, pivot.y], direction: [0, 1, 0] }, th);
    spinWorst = Math.max(spinWorst, Math.hypot(classic.x - mine[0], classic.y - mine[1], classic.z - mine[2]));
    spinCount++;
  }
}
check(`spin placement about a vertical pivot: ${spinCount} points, largest difference ${spinWorst.toExponential(1)} Å`, spinWorst < 1e-9, `${spinWorst}`);
console.log(lines.join('\n') + `\n\n${total - bad}/${total} identical`);
if (out) fs.writeFileSync(out, lines.join('\n') + `\n\n${total - bad}/${total} identical\n`);
process.exitCode = bad ? 1 : 0;
