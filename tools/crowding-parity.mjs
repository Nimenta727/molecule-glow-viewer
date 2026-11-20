// Differential test: plugins/simulation/crowding.mjs against the classic crowd builder (buildCrowd in src/repr/crowding.js), run unchanged in a vm with only the
// scene helpers stubbed. Both get the same random stream, the same box, the same atoms to keep clear and the same structures (the real residue positions of the fixture
// structures); compared: the coarse shapes, the copies wanted and placed per type, every placed copy (type, centre, orientation, drift phase), the volume fraction, and
// the blob positions of the drifting copies at two times. Usage: node tools/crowding-parity.mjs <structures-dir> [--output file]
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { pathToFileURL } from 'node:url';
import { parseMmcif } from '../plugins/structure/parser.mjs';
import { selectionSpace } from '../plugins/structure/selection.mjs';
import { seededRng } from '../plugins/motion/particles.mjs';
import { placeCrowd, coarseShape, bodyBlobs } from '../plugins/simulation/crowding.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const dir = process.argv[2], out = process.argv.includes('--output') ? process.argv[process.argv.indexOf('--output') + 1] : null;
if (!dir) { console.error('usage: node tools/crowding-parity.mjs <structures-dir> [--output file]'); process.exit(2); }
const THREE = await import(pathToFileURL(path.join(ROOT, 'desktop/node_modules/three/build/three.module.js')));
const V = (p) => new THREE.Vector3(...p);
const lines = []; let bad = 0, total = 0;
const check = (what, same, detail) => { total++; if (!same) bad++; lines.push(`${same ? 'ok  ' : 'DIFF'} ${what}${same ? '' : ' — ' + detail}`); };
const points = (id) => selectionSpace(parseMmcif(fs.readFileSync(path.join(dir, id + '.cif'), 'utf8'))).residues.map((r) => r.position);
const close = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

const scene = points('1K4C'), structures = { '6ZPO': points('6ZPO'), '4AKE': points('4AKE'), '2HVK': points('2HVK'), '1K4C': scene };

async function compare(label, seed, make) {
  const { spec, classicSpec } = make();
  const ctx = vm.createContext({ THREE, Math, console: { log() {}, warn() {}, error() {} } });
  vm.runInContext(`var randVis = Math.random, model = { allAtoms: [] }, KNOWN_ORG = {}, cutPlane = new THREE.Plane(), world = new THREE.Group(), procWorld = [], loadEntry = async (id) => ({ atoms: __entries[id].map((p) => ({ p: p.clone() })), prov: {} });`, ctx);
  ctx.__entries = Object.fromEntries(Object.entries(structures).map(([id, pts]) => [id, pts.map(V)]));
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'src/repr/crowding.js'), 'utf8'), ctx);
  const rng = seededRng(seed);
  ctx.__vis = rng.vis; ctx.__atoms = scene.map((p) => ({ p: V(p) })); ctx.__spec = classicSpec;
  vm.runInContext('randVis = __vis; model = { allAtoms: __atoms };', ctx);
  const classic = await vm.runInContext('buildCrowd(__spec)', ctx);
  const mine = placeCrowd({ ...spec, clear: scene }, seededRng(seed).vis);
  let worst = 0, mismatches = 0;
  if (classic.bodies.length !== mine.bodies.length) mismatches++;
  classic.bodies.forEach((b, i) => { const m = mine.bodies[i]; if (!m) return; if (b.i !== m.type) mismatches++;
    worst = Math.max(worst, close(b.c.toArray(), m.center), close(b.c0.toArray(), m.home), Math.abs(b.ph - m.phase), Math.hypot(b.q.x - m.quaternion[0], b.q.y - m.quaternion[1], b.q.z - m.quaternion[2], b.q.w - m.quaternion[3])); });
  const typeMismatch = classic.types.reduce((n, s, i) => n + (s.expect !== mine.types[i].expect || s.placed !== mine.types[i].placed ? 1 : 0), 0);
  let shapeWorst = 0; classic.types.forEach((s, i) => { const t = mine.types[i]; if (s.pts.length !== t.pts.length) shapeWorst = Infinity; else s.pts.forEach((p, k) => { shapeWorst = Math.max(shapeWorst, close(p.toArray(), t.pts[k])); }); shapeWorst = Math.max(shapeWorst, Math.abs(s.r - t.r), Math.abs(s.vol - t.vol), Math.abs(s.R - t.R)); });
  // blobs of the drifting copies at two times
  let blobWorst = 0;
  for (const time of [0, 12.3]) {
    classic.draw(time);
    const meshes = classic.root.children, counters = classic.types.map(() => 0);
    for (const b of mine.bodies) { const e = meshes[b.type].instanceMatrix.array; for (const p of bodyBlobs(b, mine.types[b.type], time)) { const o = 16 * counters[b.type]++; blobWorst = Math.max(blobWorst, close([e[o + 12], e[o + 13], e[o + 14]], p)); } }
  }
  const total = mine.bodies.length, per = mine.types.map((t) => `${t.label} ${t.placed}/${t.expect}`).join(', ');
  check(`${label}: ${total} copies placed (${per}), volume fraction ${(100 * mine.phi).toFixed(1)}% (classic ${(100 * classic.phi).toFixed(1)}%): centres/orientations/phases differ by ${worst.toExponential(1)}, shapes ${shapeWorst.toExponential(1)}, blobs (two times, float32 matrices) ${blobWorst.toExponential(1)}; ${mismatches} type and ${typeMismatch} count disagreements`,
    mismatches === 0 && typeMismatch === 0 && worst < 1e-9 && shapeWorst < 1e-9 && blobWorst < 1e-2 && Math.abs(mine.phi - classic.phi) < 1e-12 && Math.abs(mine.scale - classic.scale) < 1e-12 && total > 0, `${mismatches}/${typeMismatch}/${worst}/${shapeWorst}/${blobWorst}`);
}

const centre = scene.reduce((s, p) => [s[0] + p[0] / scene.length, s[1] + p[1] / scene.length, s[2] + p[2] / scene.length], [0, 0, 0]);
const typesFor = (list) => list.map(([id, label, perCell, fill, opts]) => ({ id, label, perCell, fill, opts }));
const build = (extra = {}, cut = true, types = [['6ZPO', 'ATP 合酶', 25000, 0, {}], ['2HVK', '钾通道', 60000, 0, {}], ['4AKE', '腺苷酸激酶', 0, 1, {}], ['1K4C', 'KcsA', 0, 1, {}]]) => () => {
  const box = { min: [centre[0] - 300, centre[1] - 200, centre[2] - 300], max: [centre[0] + 300, centre[1] + 150, centre[2] + 300] };
  const keepSide = cut ? { n: [0, 0, -1], d: -(centre[2] + 6) } : undefined;
  const spec = { box, keepSide, phi: 0.16, cellVol: 7e11, ...extra, types: typesFor(types).map((t) => ({ id: t.id, label: t.label, perCell: t.perCell, fill: t.fill, shape: coarseShape(structures[t.id], extra.ptsPer ? { ptsPer: extra.ptsPer, maxPts: extra.maxPts } : {}) })) };
  const classicSpec = { box: { min: V(box.min), max: V(box.max) }, keepSide: keepSide && { n: V(keepSide.n), d: keepSide.d }, phi: spec.phi, cellVol: spec.cellVol, ...Object.fromEntries(['cell', 'ptsPer', 'maxPts', 'maxFill'].filter((k) => k in extra).map((k) => [k, extra[k]])),
    ...(extra.keepFn ? { keepFn: (p) => extra.keepFn([p.x, p.y, p.z]) } : {}), types: typesFor(types).map((t) => ({ id: t.id, label: t.label, perCell: t.perCell, fill: t.fill })) };
  return { spec, classicSpec };
};

await compare('behind a cut plane, the classic defaults', 1, build());
await compare('another seed, coarser shapes (one blob per ~12 residues, at most 30)', 2, build({ ptsPer: 12, maxPts: 30 }));
await compare('an arbitrary volume (a ball, estimated by Monte Carlo), 6 Å grid', 3, build({ keepFn: (p) => Math.hypot(p[0] - centre[0], p[1] - centre[1] + 20, p[2] - centre[2] - 80) < 260, cell: 6, ptsPer: 10, maxPts: 24 }, false));
await compare('crowded to 30% with a bigger fill limit', 4, build({ phi: 0.3, maxFill: 6000, ptsPer: 20, maxPts: 16 }));

console.log(lines.join('\n') + `\n\n${total - bad}/${total} identical`);
if (out) fs.writeFileSync(out, lines.join('\n') + `\n\n${total - bad}/${total} identical\n`);
process.exitCode = bad ? 1 : 0;
