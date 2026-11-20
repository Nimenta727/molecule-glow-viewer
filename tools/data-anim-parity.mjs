// Differential test: plugins/simulation/data-animation.mjs against the classic data animation engine (PROCESSES.dataAnim in src/sim/data-anim.js on top of
// src/sim/motion-kit.js and src/sim/anim-runner.js), run unchanged in a vm with only the rendering helpers stubbed. Both get the same seed, the same structure
// (the real residue positions of a fixture structure, with the K / AP5 ligands and the membrane the packs name placed on it) and the same official data packs,
// and are stepped the way the classic frame loop does (process update, anim tick, pools, then promise continuations). Compared at every step: the pools'
// molecules, the molecules on a journey, the counters, the event log and, on the fast scale, the particle streams.
// Usage: node tools/data-anim-parity.mjs <structures-dir> [--output file]
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { pathToFileURL } from 'node:url';
import { parseMmcif } from '../plugins/structure/parser.mjs';
import { selectionSpace } from '../plugins/structure/selection.mjs';
import { seededRng } from '../plugins/motion/particles.mjs';
import { DataAnimation } from '../plugins/simulation/data-animation.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const dir = process.argv[2], out = process.argv.includes('--output') ? process.argv[process.argv.indexOf('--output') + 1] : null;
if (!dir) { console.error('usage: node tools/data-anim-parity.mjs <structures-dir> [--output file]'); process.exit(2); }
const THREE = await import(pathToFileURL(path.join(ROOT, 'desktop/node_modules/three/build/three.module.js')));
const V = (p) => new THREE.Vector3(...p);
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const pack = (name) => JSON.parse(read(`workshop/official/packs/official.${name}.glow`)).scene.animation;
const flush = () => new Promise((r) => setImmediate(r));

const lines = []; let bad = 0, total = 0;
const check = (what, same, detail) => { total++; if (!same) bad++; lines.push(`${same ? 'ok  ' : 'DIFF'} ${what}${same ? '' : ' — ' + detail}`); };
const close = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

function classicWorld() {
  const ctx = vm.createContext({ THREE, console: { log() {}, warn() {}, error() {} }, Math });
  vm.runInContext(`
    const makeTag = (text, o) => ({ el: { style: {}, textContent: text }, on: false, text, set(t) { this.text = t; }, remove() {}, o });
    const makeParticle = (col, r, label, name) => { const m = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ color: col })); m.scale.setScalar(r); procRoot.add(m); if (label) labelObj(m, label, col); m.userData.name = name || label || null; return m; };
    const procRoot = new THREE.Group(), world = new THREE.Group();
    const illustrative = () => false;
    class Stale extends Error {}
    const addEventListener = () => {};
    const U = { uTime: { value: 0 } };
    const PARTICLE_GEO = new THREE.BufferGeometry();
    const _cv = new THREE.Vector3(), _tp = new THREE.Vector3(), _tm4 = new THREE.Matrix4(), _tq0 = new THREE.Quaternion(), _tsv = new THREE.Vector3();
    var PROCESSES = {}, current = null;
    let model = null, cellSim = null, rand = Math.random, randVis = Math.random;
  `, ctx);
  const geo = read('src/derived/geometry.js'), utils = read('src/core/utils.js');
  vm.runInContext(geo.split('\n').find((l) => l.startsWith('const ease = ')), ctx);
  vm.runInContext(utils.split('\n').slice(utils.split('\n').findIndex((l) => l.startsWith('const kwMatch = ')), utils.split('\n').findIndex((l) => l.startsWith('const kwMatch = ')) + 4).join('\n'), ctx);
  for (const f of ['src/sim/anim-runner.js', 'src/sim/motion-kit.js', 'src/sim/data-anim.js']) vm.runInContext(read(f), ctx);
  return ctx;
}
const run = (ctx, code) => vm.runInContext(code, ctx);

/** The same structure for both engines: residue positions as the atoms, ligands and a membrane placed relative to the middle. */
function structureFor(id, { rotate = false } = {}) {
  const parsed = parseMmcif(fs.readFileSync(path.join(dir, id + '.cif'), 'utf8')), points = selectionSpace(parsed).residues.map((r) => r.position);
  const c = points.reduce((s, p) => [s[0] + p[0] / points.length, s[1] + p[1] / points.length, s[2] + p[2] / points.length], [0, 0, 0]);
  const ligands = [-12, -4, 4, 12].map((y) => ({ comp: 'K', centre: [c[0], c[1] + y, c[2]] })).concat([{ comp: 'AP5', centre: [c[0] + 8, c[1], c[2] + 3] }, { comp: 'AP5', centre: [c[0] + 8, c[1], c[2] + 3] }]);
  return { points, ligands, membraneY: [c[1]], centre: c, rotate };
}

async function compare(label, id, animationName, { scale = 'slow', steps = 600, seed = 7, spec } = {}) {
  const animation = spec ?? pack(animationName), structure = structureFor(id);
  delete animation.orient;   // the half turn of the whole structure is the host's job (the engine only exposes flipAboutHorizontal)
  const ctx = classicWorld();
  ctx.__atoms = structure.points.map((p) => ({ p: V(p), part: '', aseq: '1', seq: 1 }));
  ctx.__ligs = structure.ligands.map((l) => ({ comp: l.comp, centre: V(l.centre), atoms: [{ p: V(l.centre) }] }));
  ctx.__mem = structure.membraneY; ctx.__animation = animation;
  const r = seededRng(seed); ctx.__sim = r.sim; ctx.__vis = r.vis;
  run(ctx, `rand = __sim; randVis = __vis; model = { allAtoms: __atoms, ligands: __ligs }; current = { animation: __animation }; timeScale = ${JSON.stringify(scale)};
    var __ctx = { allAtoms: __atoms, ligands: __ligs, membraneY: __mem.slice(), counters: {}, partGroups: () => [], markHot() {}, pace: () => 1 };
    var __proc = PROCESSES.dataAnim; 0`);
  await run(ctx, '__proc.setup(__ctx)');
  const mine = new DataAnimation(structuredClone(animation), { points: structure.points, ligands: structure.ligands, membraneY: structure.membraneY }, { rng: seededRng(seed), scale: () => scale });
  let worst = 0, mismatches = 0, countMismatch = 0, flyMismatch = 0, counterMismatch = 0, eventMismatch = 0, streamWorst = 0, streamMismatch = 0, peakFlying = 0, compared = 0;
  const keyed = () => run(ctx, '[...scenePools.entries()].map(([k, p]) => [k, p.items.map((i) => [i.obj.position.x, i.obj.position.y, i.obj.position.z, i.mode, i.a])])');
  for (let step = 0; step < steps; step++) {
    const dt = 1 / 30;
    run(ctx, `U.uTime.value += ${dt}; __proc.update(__ctx, ${dt}); tickAnims(${dt}); updatePools(${dt}); 0`);
    await flush();
    mine.step(dt);
    // pools
    const theirPools = new Map(keyed());
    for (const [key, pool] of mine.pools.pools) {
      const theirs = theirPools.get(key) ?? [];
      if (theirs.length !== pool.items.length) { countMismatch++; continue; }
      theirs.forEach((t, i) => { const m = pool.items[i]; worst = Math.max(worst, close(t, m.position)); compared++; if (t[3] !== m.mode || Math.abs(t[4] - m.alpha) > 1e-9) mismatches++; });
    }
    if (theirPools.size !== mine.pools.pools.size) countMismatch++;
    // molecules on a journey: the overlay children
    const flyingTheirs = run(ctx, 'procRoot.children.filter((o) => !o.isInstancedMesh && (o.userData.name || o.userData.tag)).map((o) => [o.position.x, o.position.y, o.position.z, o.userData.name || o.userData.tag?.text, o.userData.alpha ?? 1, o.userData.tag?.text])');
    const flyingMine = [...mine.flying]; peakFlying = Math.max(peakFlying, flyingMine.length);
    const used = new Set();
    if (process.env.PARITY_DEBUG && flyingTheirs.length !== flyingMine.length && !globalThis.__dbg) { globalThis.__dbg = 1; console.log('DBG step', step, JSON.stringify(flyingTheirs), JSON.stringify(flyingMine.map((m) => [m.position, m.name, m.alpha]))); }
    if (flyingTheirs.length !== flyingMine.length) flyMismatch++;
    else for (const t of flyingTheirs) {
      const j = flyingMine.findIndex((m, i) => !used.has(i) && m.name === t[3] && close(t, m.position) < 2e-3);   // 2e-3 A: the classic fades molecules in and out along a 0.01 A two-point path, which three.js bends by < 1e-3 A (the module keeps two-point paths straight)
      if (j < 0) { flyMismatch++; if (process.env.PARITY_DEBUG && !globalThis.__dbg2) { globalThis.__dbg2 = 1; console.log('DBG2 step', step, JSON.stringify(t), JSON.stringify(flyingMine.map((m) => [m.position, m.name, m.alpha]))); } } else used.add(j);
    }
    // counters and events
    const theirCounters = run(ctx, 'JSON.stringify(__ctx.counters)');
    if (theirCounters !== JSON.stringify(mine.counters)) counterMismatch++;
    const theirEvents = run(ctx, 'eventLog.map((e) => e.t + " " + e.text).join("|")'), myEvents = mine.events.list().map((e) => e.t + ' ' + e.text).join('|');
    if (theirEvents !== myEvents) eventMismatch++;
    // streams (fast scale)
    if (scale === 'fast' && mine.layer) {
      const meshes = run(ctx, '__proc.layer.S.map((s) => ({ n: s.mesh.count, m: Array.from(s.mesh.instanceMatrix.array.slice(0, 16 * s.mesh.count)) }))');
      if (meshes.length !== mine.layer.length) streamMismatch++;
      else meshes.forEach((mesh, si) => {
        const snap = mine.layer[si].stream.snapshot();
        if (mesh.n !== snap.length) { streamMismatch++; return; }
        for (let i = 0; i < snap.length; i++) { streamWorst = Math.max(streamWorst, close([mesh.m[16 * i + 12], mesh.m[16 * i + 13], mesh.m[16 * i + 14]], snap[i].position)); }
      });
    }
  }
  const fin = mine.summary();
  const extra = scale === 'fast' ? `, streams ${streamWorst.toExponential(1)} Å / ${streamMismatch} count disagreements` : '';
  check(`${label}: ${steps} steps (${scale}, seed ${seed}); ${compared} pool-molecule comparisons, up to ${peakFlying} on a journey; counters ${JSON.stringify(fin.counters)}, ${fin.events.length} events: position difference ${worst.toExponential(1)} Å, ${mismatches} mode/alpha, ${countMismatch} pool-count, ${flyMismatch} journey, ${counterMismatch} counter and ${eventMismatch} event-log disagreements${extra}`,
    worst < 1e-6 && !mismatches && !countMismatch && !flyMismatch && !counterMismatch && !eventMismatch && streamWorst < 1e-3 && !streamMismatch, `${worst}/${mismatches}/${countMismatch}/${flyMismatch}/${counterMismatch}/${eventMismatch}/${streamWorst}/${streamMismatch}`);
}

await compare('AdK reaction pack on 4AKE', '4AKE', 'adk-reaction-data', { steps: 900 });
await compare('KcsA data pack on 1K4C', '1K4C', 'kcsa-data', { steps: 1200 });
await compare('KcsA data pack on 6ZPO', '6ZPO', 'kcsa-data', { steps: 600, seed: 3 });
await compare('KcsA data pack, fast scale', '1K4C', 'kcsa-data', { scale: 'fast', steps: 500 });
await compare('AdK reaction pack, fast scale', '4AKE', 'adk-reaction-data', { scale: 'fast', steps: 500 });
await compare('source-less flow (molecules created and removed)', '1K4C', null, { steps: 500, spec: { version: 1, compartments: { 溶液: {} }, pools: [{ species: 'e⁻', in: '溶液', n: 4 }],
  flows: [{ name: '电子流', species: 'e⁻', via: [{ ligand: 'AP5' }, [0, 20, 0], { ligands: 'K', order: 'up' }], rate: 1.2, counter: '电子', labelVia: '电子（传递）', events: [{ at: 1, text: '传递中' }, { at: 2, text: '到达' }] }] } });

console.log(lines.join('\n') + `\n\n${total - bad}/${total} identical`);
if (out) fs.writeFileSync(out, lines.join('\n') + `\n\n${total - bad}/${total} identical\n`);
process.exitCode = bad ? 1 : 0;
