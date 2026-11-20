// Differential test: the data kinetic model (plugins/simulation/kinetic-model.mjs with the data models of plugins/simulation/test/models.mjs) against the classic
// compartment simulation: the process definitions `cell: { init, step, controls, series, comps, dots, explain }` of src/sim/processes/respiratory-chain.js and
// chloroplast.js, driven by the classic runtime src/sim/cell-kinetics.js (`updateCellSim`, `drawCellHud`) run unchanged in a vm with only the DOM stubbed.
// Both are stepped through the same frames and the same schedule of switch changes; compared at every frame: the state variables, the fluxes, the pools'
// target counts, the pH of the compartments, and (each time the classic draws its panel) the read-outs, the curves and the explanation text.
// Usage: node tools/kinetics-parity.mjs [--output file]
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { pathToFileURL } from 'node:url';
import { KineticSimulation, phColour } from '../plugins/simulation/kinetic-model.mjs';
import { respiratoryChain, chloroplast } from '../plugins/simulation/test/models.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const out = process.argv.includes('--output') ? process.argv[process.argv.indexOf('--output') + 1] : null;
const THREE = await import(pathToFileURL(path.join(ROOT, 'desktop/node_modules/three/build/three.module.js')));
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const lines = []; let bad = 0, total = 0;
const check = (what, same, detail) => { total++; if (!same) bad++; lines.push(`${same ? 'ok  ' : 'DIFF'} ${what}${same ? '' : ' — ' + detail}`); };

function classicWorld(file, name) {
  const ctx = vm.createContext({ THREE, console: { log() {}, warn() {}, error() {} }, Math });
  vm.runInContext(`
    const elements = {};
    const fakeContext = new Proxy({}, { get: (t, k) => (k in t ? t[k] : () => {}), set: (t, k, v) => { t[k] = v; return true; } });
    const $ = (id) => elements[id] ??= { id, textContent: '', style: {}, width: 240, height: 40, getContext: () => fakeContext, classList: { add() {}, toggle() {} } };
    const illustrative = () => false, V3n = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
    var proc = null, PROCESSES = {}, ATP_PER_NADH = '';   // a text constant the process file appends to its energy notes; not used by the cell model
  `, ctx);
  vm.runInContext(read('src/sim/cell-kinetics.js'), ctx);
  vm.runInContext(`Object.assign(PROCESSES, {${read(file)}\n});`, ctx);
  vm.runInContext(`var def = PROCESSES.${name}.cell;`, ctx);
  return ctx;
}
const run = (ctx, code) => vm.runInContext(code, ctx);
const startClassic = (ctx) => run(ctx, `
  var sim = { def, st: def.init(), ctrl: Object.fromEntries(def.controls.filter((c) => c.id).map((c) => [c.id, c.type === 'range' || c.type === 'select' ? c.value : c.on])), hist: def.series.map(() => []),
    t: 0, tH: 0, flux: { rate: 1, rotor: 1 }, objs: [], labs: [], panels: [], dots: def.dots.map((sp) => ({ sp, pool: { n: 0, fill() {} } })) };
  if (!def.noWarmup) for (let i = 0; i < 40; i++) sim.flux = def.step(sim.st, 0.05, sim.ctrl) || sim.flux;
  cellSim = sim; 0`);

// a deterministic schedule of switch changes (the same for both)
function schedule(ids, seed) {
  let a = seed; const rnd = () => { a = (a * 1664525 + 1013904223) >>> 0; return a / 4294967296; };
  return Array.from({ length: 40 }, (_, k) => ({ at: 1 + k * 1.5, id: ids[Math.floor(rnd() * ids.length)], value: rnd() < 0.5 }));
}

async function compare(label, file, name, model, { dt = 1 / 60, seconds = 60, seed = 5 } = {}) {
  const ctx = classicWorld(file, name);
  startClassic(ctx);
  const mine = new KineticSimulation(model);
  const ids = run(ctx, 'def.controls.filter((c) => c.id).map((c) => c.id)'), plan = schedule(ids, seed);
  const frames = Math.round(seconds / dt);
  let worstState = 0, worstFlux = 0, dotMismatch = 0, phWorst = 0, colourMismatch = 0, readMismatch = 0, textMismatch = 0, histMismatch = 0, hud = 0, texts = new Set();
  let next = 0;
  for (let f = 0; f < frames; f++) {
    const now = f * dt;
    while (next < plan.length && plan[next].at <= now) { const { id, value } = plan[next++]; run(ctx, `sim.ctrl[${JSON.stringify(id)}] = ${value}`); mine.setControl(id, value); }
    run(ctx, `updateCellSim(${dt})`); mine.update(dt);
    const st = JSON.parse(run(ctx, 'JSON.stringify(sim.st)')), flux = JSON.parse(run(ctx, 'JSON.stringify(sim.flux)'));
    for (const [k, v] of Object.entries(st)) worstState = Math.max(worstState, Math.abs(v - mine.state[k]));
    // the classic flux field `pmf` is the value before the step; the data model names that local pmf0 (pmf is its state variable)
    for (const [k, v] of Object.entries(flux)) worstFlux = Math.max(worstFlux, Math.abs(v - (k in mine.flux ? mine.flux[k] : mine.flux[k + '0'])));
    const dots = run(ctx, 'sim.dots.map((d) => d.pool.n)'), mineDots = mine.dots();
    dots.forEach((n, i) => { if (n !== mineDots[i].count) dotMismatch++; });
    const comps = run(ctx, 'def.comps(sim.st, sim.flux).map((c) => [c.name, c.pH, phColour(c.pH).getHexString()])'), mineComps = mine.compartments();
    comps.forEach(([n, pH, hex], i) => { phWorst = Math.max(phWorst, Math.abs(pH - mineComps[i].pH)); if (n !== mineComps[i].name || '#' + hex !== mineComps[i].colour) colourMismatch++; });
    if (run(ctx, 'sim.tH') === 0 && f > 0) {   // the classic just redrew its panel
      hud++;
      const readout = mine.readout();
      readout.forEach((r, i) => { if (run(ctx, `$('cv${i}').textContent`) !== r.text) readMismatch++; });
      const text = run(ctx, "$('cellNote').textContent"); texts.add(text);
      if (text !== mine.explain()) textMismatch++;
    }
  }
  const histClassic = JSON.parse(run(ctx, 'JSON.stringify(sim.hist)'));
  histClassic.forEach((h, i) => { if (h.length !== mine.hist[i].length || h.some((v, k) => v !== mine.hist[i][k])) histMismatch++; });
  check(`${label}: ${frames} frames of ${(dt * 1000).toFixed(1)} ms (${seconds} s, ${plan.length} switch changes); ${hud} panel redraws, ${texts.size} different explanations: state differs by ${worstState.toExponential(1)}, fluxes ${worstFlux.toExponential(1)}, pH ${phWorst.toExponential(1)}; ${dotMismatch} pool-count, ${colourMismatch} colour, ${readMismatch} read-out, ${textMismatch} text and ${histMismatch} curve disagreements`,
    worstState === 0 && worstFlux === 0 && phWorst === 0 && !dotMismatch && !colourMismatch && !readMismatch && !textMismatch && !histMismatch, `${worstState}/${worstFlux}/${phWorst}/${dotMismatch}/${colourMismatch}/${readMismatch}/${textMismatch}/${histMismatch}`);
}

await compare('respiratory chain', 'src/sim/processes/respiratory-chain.js', 'respiratoryChain', respiratoryChain);
await compare('respiratory chain, 50 ms frames', 'src/sim/processes/respiratory-chain.js', 'respiratoryChain', respiratoryChain, { dt: 0.05, seconds: 90, seed: 9 });
await compare('chloroplast', 'src/sim/processes/chloroplast.js', 'chloroplast', chloroplast);
await compare('chloroplast, 50 ms frames', 'src/sim/processes/chloroplast.js', 'chloroplast', chloroplast, { dt: 0.05, seconds: 90, seed: 11 });

// phColour on its own: the classic function against the data one over the whole range
{
  const ctx = classicWorld('src/sim/processes/chloroplast.js', 'chloroplast'); let bad = 0, n = 0;
  for (let pH = 4; pH <= 9.5; pH += 0.01) { n++; if ('#' + run(ctx, `phColour(${pH}).getHexString()`) !== phColour(pH)) bad++; }
  check(`pH colours: ${n} values from pH 4 to 9.5 give the same colour as the classic (${bad} differences)`, bad === 0, `${bad}`);
}

console.log(lines.join('\n') + `\n\n${total - bad}/${total} identical`);
if (out) fs.writeFileSync(out, lines.join('\n') + `\n\n${total - bad}/${total} identical\n`);
process.exitCode = bad ? 1 : 0;
