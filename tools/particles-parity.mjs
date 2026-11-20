// Differential test: plugins/motion/particles.mjs against the classic motion kit (src/sim/motion-kit.js), run unchanged in a vm with only the rendering helpers
// stubbed. Both sides get the same seeded random streams, so the occupancy hash, Brownian bridge, curves, regions, pools (diffusing, taking, giving) and flow
// streams must produce the same numbers. Usage: node tools/particles-parity.mjs <structures-dir> [--output file]
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { pathToFileURL } from 'node:url';
import { parseMmcif } from '../plugins/structure/parser.mjs';
import { selectionSpace } from '../plugins/structure/selection.mjs';
import { createOccupancy, brownPath, catmullRom, boxRegion, shellRegion, ParticlePool, FlowStream, seededRng } from '../plugins/motion/particles.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const dir = process.argv[2], out = process.argv.includes('--output') ? process.argv[process.argv.indexOf('--output') + 1] : null;
if (!dir) { console.error('usage: node tools/particles-parity.mjs <structures-dir> [--output file]'); process.exit(2); }
const THREE = await import(pathToFileURL(path.join(ROOT, 'desktop/node_modules/three/build/three.module.js')));
const V = (p) => new THREE.Vector3(...p);

const ctx = vm.createContext({ THREE, console, Math });
const stub = `
const makeTag = (text, o) => ({ el: { style: {}, textContent: text }, on: false, set() {}, remove() {}, o });
const makeParticle = (col, r) => { const m = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ color: col })); m.scale.setScalar(r); return m; };
const procRoot = new THREE.Group(), world = new THREE.Group();
const illustrative = () => false, anim = () => Promise.resolve(), ease = (u) => u, eventLog = [];
const U = { uTime: { value: 0 } };
const PARTICLE_GEO = new THREE.BufferGeometry();
const _cv = new THREE.Vector3(), _tp = new THREE.Vector3(), _tm4 = new THREE.Matrix4(), _tq0 = new THREE.Quaternion(), _tsv = new THREE.Vector3();
let model = null, cellSim = null, rand = Math.random, randVis = Math.random;
`;
vm.runInContext(stub, ctx);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'src/sim/motion-kit.js'), 'utf8'), ctx);
const classic = (expr) => vm.runInContext(expr, ctx);
const setStreams = (seed) => { const r = seededRng(seed); ctx.__sim = r.sim; ctx.__vis = r.vis; classic('rand = __sim; randVis = __vis;'); return seededRng(seed); };

const lines = []; let bad = 0, total = 0;
const check = (what, same, detail) => { total++; if (!same) bad++; lines.push(`${same ? 'ok  ' : 'DIFF'} ${what}${same ? '' : ' — ' + detail}`); };
const TOL = 1e-9;
const close = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

// 1. curves ---------------------------------------------------------------------------------------------------------------------------------------------
{
  let worst = 0, lenWorst = 0, n = 0;
  const gen = seededRng(5).vis;
  for (let c = 0; c < 30; c++) {
    const pts = Array.from({ length: 3 + (c % 6) }, () => [gen() * 200 - 100, gen() * 200 - 100, gen() * 200 - 100]);
    const mine = catmullRom(pts), theirs = new THREE.CatmullRomCurve3(pts.map(V), false, 'centripetal');
    for (let i = 0; i <= 40; i++) { const t = i / 40; worst = Math.max(worst, close(mine.point(t), theirs.getPoint(t).toArray())); n++; }
    lenWorst = Math.max(lenWorst, Math.abs(mine.length() - theirs.getLength()));
  }
  check(`Catmull-Rom curves: ${n} points on 30 paths of 3-8 points, largest difference ${worst.toExponential(1)} Å, length ${lenWorst.toExponential(1)} Å`, worst < TOL && lenWorst < TOL, `${worst} / ${lenWorst}`);
  // Two-point paths are a deliberate difference: three.js reuses one scratch vector for the extrapolated first and last control point, so a two-point path
  // bulges into a curve. The module keeps it a straight line (the right answer for two points); the bulge is measured and recorded here.
  let straight = 0, bulge = 0;
  for (let c = 0; c < 20; c++) {
    const a = [gen() * 100, gen() * 100, gen() * 100], b = [gen() * 100, gen() * 100, gen() * 100], mine = catmullRom([a, b]), theirs = new THREE.CatmullRomCurve3([V(a), V(b)], false, 'centripetal');
    for (let i = 0; i <= 20; i++) { const t = i / 20; straight = Math.max(straight, close(mine.point(t), a.map((v, k) => v + (b[k] - v) * t))); bulge = Math.max(bulge, close(mine.point(t), theirs.getPoint(t).toArray())); }
  }
  check(`two-point paths are straight lines (largest departure ${straight.toExponential(1)} Å); the classic curve bulges by up to ${bulge.toFixed(1)} Å (three.js scratch-vector quirk, not reproduced)`, straight < TOL, `${straight}`);
}

for (const id of ['6ZPO', '1K4C', '4AKE']) {
  const parsed = parseMmcif(fs.readFileSync(path.join(dir, id + '.cif'), 'utf8'));
  const points = selectionSpace(parsed).residues.map((r) => r.position);
  const centre = points.reduce((s, p) => [s[0] + p[0] / points.length, s[1] + p[1] / points.length, s[2] + p[2] / points.length], [0, 0, 0]);
  ctx.__atoms = points.map((p) => ({ p: V(p) })); classic('model = { allAtoms: __atoms }');
  const occupancy = createOccupancy(points);
  const probe = seededRng(11).vis;

  // 2. occupancy: busy / clearance / push on random probe points near the structure ----------------------------------------------------------------------
  {
    let mismatch = 0, worst = 0, pushWorst = 0, count = 0;
    for (let i = 0; i < 800; i++) {
      const base = points[Math.floor(probe() * points.length)], p = [base[0] + (probe() - 0.5) * 30, base[1] + (probe() - 0.5) * 30, base[2] + (probe() - 0.5) * 30], R = [6, 7.5, 8.5, 12][i % 4];
      ctx.__p = V(p); ctx.__R = R;
      const classicBusy = classic('occBusy(__p, __R)'), classicClear = classic('atomClear(__p, __R)'), cp = classic('_push').toArray();
      const myBusy = occupancy.busy(p, R), myClear = occupancy.clearance(p, R);
      if (classicBusy !== myBusy) mismatch++;
      if (classicClear !== myClear && !(Number.isFinite(classicClear) && Math.abs(classicClear - myClear) < TOL)) mismatch++;
      else if (Number.isFinite(classicClear)) { worst = Math.max(worst, Math.abs(classicClear - myClear)); pushWorst = Math.max(pushWorst, close(cp, occupancy.push)); }
      count++;
    }
    check(`${id}: occupancy of ${points.length} residue atoms, ${count} probes (busy / clearance / push-away direction): ${mismatch} disagreements, largest difference ${worst.toExponential(1)} Å, push ${pushWorst.toExponential(1)}`, mismatch === 0 && pushWorst < TOL, `${mismatch} / ${pushWorst}`);
  }

  // 3. Brownian bridge with protein avoidance -------------------------------------------------------------------------------------------------------------
  {
    let worst = 0, n = 0, avoided = 0, total_pts = 0;
    for (let k = 0; k < 40; k++) {
      const a = points[Math.floor(probe() * points.length)], b = points[Math.floor(probe() * points.length)];
      const A = [a[0] + 12, a[1], a[2]], B = [b[0], b[1] + 12, b[2]];
      const opts = [{}, { free1: 6 }, { free0: 6, free1: 0 }, { n: 30, wander: 0.5, clear: 7 }][k % 4];
      const rng = setStreams(100 + k);
      const theirs = classic('(() => { const A = new THREE.Vector3(' + A + '), B = new THREE.Vector3(' + B + '); return brownPath(A, B, ' + JSON.stringify(opts) + '); })()');
      const mine = brownPath(A, B, opts, { rng, occupancy });
      if (theirs.length !== mine.length) { worst = Infinity; continue; }
      theirs.forEach((p, i) => { worst = Math.max(worst, close(p.toArray(), mine[i])); n++; total_pts++; if (!occupancy.busy(mine[i], 4)) avoided++; });
    }
    check(`${id}: 40 Brownian bridges through the structure (${n} points; four option sets): largest difference ${worst.toExponential(1)} Å; ${Math.round(100 * avoided / total_pts)}% of the points clear every residue by 4 Å`, worst < 1e-6, `${worst}`);
  }

  // 4. regions + pools: fill, diffuse, take, give --------------------------------------------------------------------------------------------------------
  {
    const c = V(centre), cArr = centre;
    ctx.__c = c;
    const box = { c: [cArr[0], cArr[1], cArr[2]], d: [1, 0, 0], n: [0, 0, 1], ulo: -120, uhi: 120, vlo: -120, vhi: 120, ym: cArr[1] };
    ctx.__B = { c: V(box.c), d: V(box.d), n: V(box.n), ulo: box.ulo, uhi: box.uhi, vlo: box.vlo, vhi: box.vhi, ym: box.ym };
    let worst = 0, samples = 0, mismatch = 0;
    for (const kind of ['box', 'shell']) {
      const rng = setStreams(7);
      const mineRegion = kind === 'box' ? boxRegion(box, cArr[1] + 20, cArr[1] + 140, { rng, occupancy }) : shellRegion(cArr, 40, 120, (p) => p[1] > cArr[1], { rng, occupancy });
      const theirRegion = classic(kind === 'box' ? `boxRegion(__B, ${cArr[1] + 20}, ${cArr[1] + 140})` : `shellRegion(__c, 40, 120, (p) => p.y > ${cArr[1]})`);
      for (let i = 0; i < 120; i++) {
        const edge = i % 3 === 0, a = theirRegion.sample(edge), b = mineRegion.sample(edge);
        if ((a == null) !== (b == null)) { mismatch++; continue; }
        if (a) { worst = Math.max(worst, close(a.toArray(), b)); samples++;
          if (theirRegion.inside(a) !== mineRegion.inside(b) || Math.abs(theirRegion.depth(a) - mineRegion.depth(b)) > TOL) mismatch++; }
      }
    }
    check(`${id}: bulk regions (compartment box and machine shell), ${samples} sampled spots plus inside / depth: ${mismatch} disagreements, largest difference ${worst.toExponential(1)} Å`, mismatch === 0 && worst < TOL, `${mismatch} / ${worst}`);

    // pool: both sides start from the same seed; 240 steps of dt 1/30 with a take and a give every 40 steps and the count changed once
    for (const tumble of [false, true]) {
      const rng = setStreams(21), region = boxRegion(box, cArr[1] + 20, cArr[1] + 140, { rng, occupancy });
      const pool = new ParticlePool({ name: 'H⁺', col: 0xfff27a, r: 2.2, region, n: 24, tumble }, { rng, occupancy });
      pool.fill();
      classic(`var __pool = new MolPool({ label: 'H⁺', col: 0xfff27a, region: boxRegion(__B, ${cArr[1] + 20}, ${cArr[1] + 140}), n: 24, tumble: ${tumble}, make: () => makeParticle(0xfff27a, 2.2) }); __pool.fill(); 0`);
      let worstPos = 0, countMismatch = 0, modeMismatch = 0, taken = 0;
      const near = [cArr[0] + 30, cArr[1] + 60, cArr[2] - 20]; ctx.__near = V(near);
      for (let step = 0; step < 240; step++) {
        if (step === 100) { pool.n = 30; classic('__pool.n = 30'); } if (step === 170) { pool.n = 18; classic('__pool.n = 18'); }
        if (step && step % 40 === 0) {
          const item = pool.take(near), obj = classic('__pool.take(__near)'); taken++;
          worstPos = Math.max(worstPos, close(obj.position.toArray(), item.position));
          ctx.__obj = obj; pool.give(item); classic('__pool.give(__obj)');
        }
        pool.update(1 / 30); classic('__pool.update(1 / 30)');
        const theirs = classic('__pool.items.map((i) => [i.obj.position.x, i.obj.position.y, i.obj.position.z, i.mode, i.a])');
        if (theirs.length !== pool.items.length) { countMismatch++; continue; }
        theirs.forEach((t, i) => { const m = pool.items[i]; worstPos = Math.max(worstPos, close(t, m.position)); if (t[3] !== m.mode || Math.abs(t[4] - m.alpha) > TOL) modeMismatch++; });
      }
      check(`${id}: pool of 24 H⁺ (${tumble ? 'tumbling' : 'plain'}) over 240 steps with ${taken} take/give and the count raised then lowered: ${pool.items.length} left; largest position difference ${worstPos.toExponential(1)} Å, ${countMismatch} count and ${modeMismatch} mode/alpha disagreements`, worstPos < 1e-6 && !countMismatch && !modeMismatch, `${worstPos}`);
    }
  }
}

// 5. flow streams ------------------------------------------------------------------------------------------------------------------------------------------
{
  const paths = [
    [[0, 0, 0], [20, 10, 0], [40, 5, 15], [60, 30, 10]],
    [[0, 5, 0], [30, 5, 5], [70, 20, 0]],
    [[10, 0, 10], [10, 20, 14], [10, 40, 10]],
  ];
  const mk = (def, seed) => { const rng = setStreams(seed); return { rng, stream: new FlowStream(def, { rng }) }; };
  for (const def of [{ label: 'H⁺', col: 0xfff27a, r: 2.2, paths, per: 6, v: 60 }, { label: 'K⁺', col: 0xb98cff, r: 2.0, paths: [paths[0]], per: 3, v: 40, spread: 3, max: 20 }]) {
    const { stream } = mk(def, 31);
    ctx.__def = { ...def, paths: def.paths.map((P) => P.map(V)) };
    classic('var __flow = new FlowLayer([__def]); 0');
    let worst = 0, scaleWorst = 0, countMismatch = 0, peak = 0;
    for (let step = 0; step < 300; step++) {
      const cps = step < 150 ? 1.5 : 0.4; stream.update(1 / 30, cps); ctx.__cps = cps; classic('__flow.update(1 / 30, __cps)');
      const mesh = classic('__flow.S[0].mesh'), mine = stream.snapshot(); peak = Math.max(peak, mine.length);
      if (mesh.count !== mine.length) { countMismatch++; continue; }
      for (let i = 0; i < mine.length; i++) {
        const e = mesh.instanceMatrix.array; worst = Math.max(worst, close([e[16 * i + 12], e[16 * i + 13], e[16 * i + 14]], mine[i].position));
        scaleWorst = Math.max(scaleWorst, Math.abs(e[16 * i] - mine[i].scale));
      }
    }
    check(`flow of ${def.label}: 300 steps, up to ${peak} particles on ${def.paths.length} path(s): ${stream.emitted} emitted / ${stream.finished} finished; largest position difference ${worst.toExponential(1)} Å, scale ${scaleWorst.toExponential(1)}, ${countMismatch} count disagreements`, worst < 1e-3 && scaleWorst < 1e-5 && !countMismatch, `${worst} / ${scaleWorst} / ${countMismatch}`);
    classic('__flow.dispose(); 0');
  }
}

// 6. every particle is named --------------------------------------------------------------------------------------------------------------------------------
{
  let refused = 0;
  const rng = seededRng(1), region = { sample: () => [0, 0, 0], inside: () => true, depth: () => 1 };
  for (const spec of [{ region }, { region, name: '  ' }, { region, label: '' }]) { try { new ParticlePool(spec, { rng }); } catch { refused++; } }
  try { new FlowStream({ paths: [[[0, 0, 0], [1, 1, 1]]], per: 1 }, { rng }); } catch { refused++; }
  check(`unnamed pools and flows are refused: ${refused}/4`, refused === 4, `${refused}`);
}

console.log(lines.join('\n') + `\n\n${total - bad}/${total} identical`);
if (out) fs.writeFileSync(out, lines.join('\n') + `\n\n${total - bad}/${total} identical\n`);
process.exitCode = bad ? 1 : 0;
