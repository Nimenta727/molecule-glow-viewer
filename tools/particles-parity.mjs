// Differential test: plugins/motion/particles.mjs against the classic motion kit (src/sim/motion-kit.js), run unchanged in a vm with only the rendering helpers
// stubbed. Both sides get the same seeded random streams, so the occupancy hash, Brownian bridge, curves, regions, pools (diffusing, taking, giving) and flow
// streams must produce the same numbers. Usage: node tools/particles-parity.mjs <structures-dir> [--output file]
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { pathToFileURL } from 'node:url';
import { parseMmcif } from '../plugins/structure/parser.mjs';
import { selectionSpace } from '../plugins/structure/selection.mjs';
import { Journey, Motion, EventLog, membraneCrossing, ease as myEase } from '../plugins/motion/journey.mjs';
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
const illustrative = () => false;
class Stale extends Error {}
const addEventListener = () => {};
const U = { uTime: { value: 0 } };
const PARTICLE_GEO = new THREE.BufferGeometry();
const _cv = new THREE.Vector3(), _tp = new THREE.Vector3(), _tm4 = new THREE.Matrix4(), _tq0 = new THREE.Quaternion(), _tsv = new THREE.Vector3();
let model = null, cellSim = null, rand = Math.random, randVis = Math.random;
`;
vm.runInContext(stub, ctx);
const geo = fs.readFileSync(path.join(ROOT, 'src/derived/geometry.js'), 'utf8');
vm.runInContext(geo.split('\n').find((l) => l.startsWith('const ease = ')), ctx);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'src/sim/anim-runner.js'), 'utf8'), ctx);
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

// 6b. travel, events, membrane crossing ----------------------------------------------------------------------------------------------------------------------
{
  const flush = () => new Promise((r) => setImmediate(r)), DT = 1 / 60;
  // travel: every leg option, one tick at a time against the classic runner
  let worst = 0, alphaWorst = 0, rotWorst = 0, ticks = 0, endMismatch = 0;
  const variants = [{}, { ease: true }, { fadeIn: 0.3 }, { fadeOut: 0.25 }, { fadeIn: 0.2, fadeOut: 0.2, ease: true }, { tumble: true }];
  for (const [vi, opt] of variants.entries()) for (const a0 of [1, 0.05]) {
    const rngA = seededRng(50 + vi), pts = brownPath([0, 0, 0], [60, 20, -10], {}, { rng: rngA }), dur = 1.3;
    ctx.__P = pts.map(V); ctx.__opt = opt; ctx.__a0 = a0;
    classic('var __o = new THREE.Object3D(); __o.userData.alpha = __a0; var __done = false; travel(__o, __P, 1.3, __opt).then(() => { __done = true; }); 0');
    const item = { name: 'x', position: [0, 0, 0], alpha: a0, rotation: [0, 0, 0] }, j = new Journey(item, [{ path: pts, dur, ...opt }]);
    for (let k = 0; k < 120 && !j.finished; k++) {
      j.step(DT); classic(`tickAnims(${DT})`); await flush(); ticks++;
      const o = classic('__o'), alpha = o.userData.alpha ?? 1;
      worst = Math.max(worst, close(o.position.toArray(), item.position));
      if (opt.fadeIn || opt.fadeOut) alphaWorst = Math.max(alphaWorst, Math.abs(alpha - item.alpha));
      if (opt.tumble) rotWorst = Math.max(rotWorst, Math.abs(o.rotation.x - item.rotation[0]), Math.abs(o.rotation.y - item.rotation[1]));
    }
    if (classic('__done') !== true || !j.finished) endMismatch++;
  }
  check(`travel: ${variants.length * 2} legs (plain / eased / fade in / fade out / both / tumbling, from full and from 5% alpha), ${ticks} ticks at 60 fps: largest position difference ${worst.toExponential(1)} Å, alpha ${alphaWorst.toExponential(1)}, tumble ${rotWorst.toExponential(1)} rad, ${endMismatch} legs ending on different ticks`, worst < 1e-9 && alphaWorst < 1e-12 && rotWorst < 1e-9 && !endMismatch, `${worst}/${alphaWorst}/${rotWorst}/${endMismatch}`);
  const m = [0, 0.4, 0.5, 1, 1.2, -0.1].map((t) => [t, myEase(t), classic(`ease(${t})`)]);
  check(`ease: smoothstep equals the classic one on ${m.length} inputs`, m.every(([, a, b]) => a === b), JSON.stringify(m));

  // event log
  const log = new EventLog(() => 12.34567), eventsBefore = classic('eventLog.length');
  ctx.__tp = V([1, 2, 3]); classic('U.uTime.value = 12.34567; eventTag("ADP + Pi → <b>ATP</b>", __tp, 2)');
  log.add('ADP + Pi → <b>ATP</b>', [1, 2, 3], 2);
  const cl = classic('eventLog[eventLog.length - 1]');
  for (let i = 0; i < 520; i++) log.add('e' + i, [0, 0, 0]);
  check(`event log: entry equals the classic one ("${log.events[0] && cl.text}", t ${cl.t}), stripped of markup, capped at ${log.events.length}`, cl.t === 12.346 && cl.text === 'ADP + Pi → ATP' && log.events.length === 500 && eventsBefore === 0, JSON.stringify(cl));

  // proton across a membrane through a channel, whole thing, both engines from the same seed; pools on both sides
  let posWorst = 0, tickCount = 0, poolMismatch = 0, labelMismatch = 0, runs = 0;
  for (const id of ['6ZPO', '1K4C']) {
    const parsed = parseMmcif(fs.readFileSync(path.join(dir, id + '.cif'), 'utf8')), pts = selectionSpace(parsed).residues.map((r) => r.position);
    const c = pts.reduce((s, p) => [s[0] + p[0] / pts.length, s[1] + p[1] / pts.length, s[2] + p[2] / pts.length], [0, 0, 0]);
    ctx.__atoms = pts.map((p) => ({ p: V(p) })); classic('model = { allAtoms: __atoms }');
    const occupancy = createOccupancy(pts);
    for (const opts of [{}, { label: 'H⁺ in', tIn: 1, tChan: 0.6, tOut: 0.9 }]) {
      const rng = setStreams(77 + runs++);
      const mk = (y0, y1) => ({ c: [c[0], c[1], c[2]], d: [1, 0, 0], n: [0, 0, 1], ulo: -150, uhi: 150, vlo: -150, vhi: 150, ym: c[1], y0, y1 });
      const topBox = mk(c[1] + 25, c[1] + 140), botBox = mk(c[1] - 140, c[1] - 25);
      const chan = [[c[0], c[1] + 30, c[2]], [c[0] + 3, c[1] + 8, c[2] + 2], [c[0] + 1, c[1] - 8, c[2] - 2], [c[0], c[1] - 30, c[2]]];
      const mineTop = new ParticlePool({ name: 'H⁺', region: boxRegion(topBox, topBox.y0, topBox.y1, { rng, occupancy }), n: 8 }, { rng, occupancy }); mineTop.fill();
      const mineBot = new ParticlePool({ name: 'H⁺', region: boxRegion(botBox, botBox.y0, botBox.y1, { rng, occupancy }), n: 0 }, { rng, occupancy });
      ctx.__chan = chan.map(V); ctx.__opts = opts;
      const clsBox = (b) => `{ c: new THREE.Vector3(${b.c}), d: new THREE.Vector3(1,0,0), n: new THREE.Vector3(0,0,1), ulo: -150, uhi: 150, vlo: -150, vhi: 150, ym: ${c[1]} }`;
      classic(`var __top = new MolPool({ label: 'H⁺', col: 1, region: boxRegion(${clsBox(topBox)}, ${topBox.y0}, ${topBox.y1}), n: 8, make: () => makeParticle(1, 2) }); __top.fill();
               var __bot = new MolPool({ label: 'H⁺', col: 1, region: boxRegion(${clsBox(botBox)}, ${botBox.y0}, ${botBox.y1}), n: 0, make: () => makeParticle(1, 2) }); var __h = null;
               var __cross = protonAcross(__top, __bot, __chan, __opts).then(() => { __fin = true; }); var __fin = false; 0`);
      const motion = new Motion(), journey = membraneCrossing(motion, mineTop, mineBot, chan, opts, { rng, occupancy });
      // the classic took its particle synchronously too: find it as the one object parented to the overlay
      const theirObj = classic('procRoot.children[procRoot.children.length - 1]');
      for (let k = 0; k < 400 && motion.running; k++) {
        motion.tick(DT); classic(`tickAnims(${DT})`); await flush(); tickCount++;
        posWorst = Math.max(posWorst, close(theirObj.position.toArray(), journey.item.position));
      }
      await flush();
      const fin = classic('__fin') === true, theirBot = classic('__bot.items.length'), theirTop = classic('__top.items.length');
      if (!fin || mineBot.items.length !== theirBot || mineTop.items.length !== theirTop) poolMismatch++;
      if (journey.item.label !== (opts.label ? 'H⁺' : 'H⁺')) labelMismatch++;
      classic('procRoot.children.length = 0; 0');
    }
  }
  check(`proton across a membrane (4 runs on 6ZPO / 1K4C, default and custom timings, ${tickCount} ticks): largest position difference ${posWorst.toExponential(1)} Å, ${poolMismatch} runs ending with different pool contents, ${labelMismatch} label slips`, posWorst < 1e-6 && !poolMismatch && !labelMismatch, `${posWorst}/${poolMismatch}/${labelMismatch}`);
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
