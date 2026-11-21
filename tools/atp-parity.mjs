// Differential test of the ATP synthase event schedule: the classic PROCESSES.atpSynthase.update (src/sim/processes/atp-synthase.js) run unchanged in a vm over a rotor turning at fixed steps,
// against the rotary conformation machine of plugins/motion (the ATP player's time and state side). The classic needs a loaded structure for its setup; here its sites are filled with minimal stand-ins
// (the positions are not part of the schedule), so what is compared is *when* the classic forms ATP, counts protons and changes stage, as a function of the rotor angle.
// Usage: node tools/atp-parity.mjs [--three <three.module.js>] [--output file]
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { pathToFileURL } from 'node:url';
import { createMachine, normalizeMachine } from '../plugins/motion/conformation-machine.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : null);
const THREE = await import(pathToFileURL(arg('--three') ?? path.join(ROOT, 'desktop/node_modules/three/build/three.module.js')));
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const lines = []; let bad = 0, total = 0;
const check = (what, same, detail) => { total++; if (!same) bad++; lines.push(`${same ? 'ok  ' : 'DIFF'} ${what}${same ? '' : ' - ' + detail}`); };

const sandbox = vm.createContext({ THREE, Math, console: { log() {}, warn() {}, error() {} } });
vm.runInContext(read('src/derived/geometry.js'), sandbox);
// the stand-ins for what the classic update calls out to: the rendering helpers and the free-molecule pools (they only hand back placeholder objects)
vm.runInContext(`
  const mk = () => ({ position: new THREE.Vector3(), quaternion: new THREE.Quaternion(), userData: { alpha: 1 }, parent: null, visible: true });
  const pool = () => ({ col: 0, make: mk, take: mk, give() {}, region: { sample: () => new THREE.Vector3() } });
  var procRoot = { add() {} }, fastMode = () => true, eventTag = () => {}, labelObj = () => {}, setAlpha = () => {}, V3n = (x, y, z) => new THREE.Vector3(x, y, z),
      brownPath = (a, b) => [a, b], travel = () => Promise.resolve(), $ = () => ({ value: 1 }), cellSim = null;
  ${read('src/sim/processes/atp-synthase.js')}};
  var counters = { ATP: 0, 'H⁺': 0 }, ctxRef = { counters };
  var classic = PROCESSES.atpSynthase;
  classic.flows = () => {};
  classic.pools = () => ({ adp: pool(), pi: pool(), atp: pool(), hIn: pool(), hOut: pool() });
  const key = () => ({ q: new THREE.Quaternion(), t: new THREE.Vector3() });
  const P = () => ({ atp: key(), adp: key(), mg: null, pi: new THREE.Vector3(), piOut: new THREE.Vector3() });
  // three sites on three chains; chain B is the open one, C loose, D tight at rotor angle 0 (as a real entry orders them)
  classic.chains = ['B', 'C', 'D']; classic.next = { B: 'C', C: 'D', D: 'B' }; classic.role = { B: 'open', C: 'loose', D: 'tight' };
  classic.sites = classic.chains.map((k) => ({ k, P: { B: P(), C: P(), D: P() }, S: new THREE.Vector3(), D: new THREE.Vector3(1, 0, 0), entr: new THREE.Vector3(), mg: { visible: true } }));
  classic.ctx = ctxRef; classic.bg = {}; classic.f = 0; classic.lastK = 0; classic.tpl = {}; classic.mgOff = {};
  var ctx = { theta: 0, counters, setChainBlend() {}, pace: () => 1 };
  var stageAt = (theta) => { ctx.theta = theta; classic.update(ctx, 0.01); return { stage: classic.stage(ctx), atp: counters.ATP, h: counters['H⁺'], f: classic.f }; };
`, sandbox);
const run = (theta) => vm.runInContext(`stageAt(${theta})`, sandbox);

// the candidate: the rotary machine with the template's constants, 3 sites, 8 c subunits; one turn per second
const machine = createMachine(normalizeMachine({ kind: 'rotary', sites: 3, speed: { min: 0.05, max: 3, default: 1, label: 'speed' }, stageAt: [0.1, 0.25, 0.8, 0.93], morph: { start: 0.25, span: 0.6 }, stepPhases: [0, 0.17, 0.5, 0.86, 0.96],
  counters: { cycles: 'ATP', unit: 'H⁺' }, eventLabel: 'release' }, 'atp-parity'), { time: 0, speed: 1, seed: 7 }, { seed: 7, units: 8 });
const cand = (turns) => { machine.seek(turns); const s = machine.snapshot(); return { stage: s.stage, atp: s.counters.ATP, h: s.counters['H⁺'] }; };

let hSame = true, atpLead = true, atpEqualOutsideWindow = true, firstH = null, firstAtpClassic = null, firstAtpCand = null, stageRows = [];
const samples = []; for (let i = 0; i <= 360; i++) samples.push(i / 120);   // turns, 0..3 in steps of 1/120 (1/40 of a site cycle)
for (const turns of samples) {
  const c = run(2 * Math.PI * turns + 1e-9), k = cand(turns), f = (turns * 3) % 1;
  if (c.h !== k.h) { hSame = false; if (firstH === null) firstH = { turns, classic: c.h, candidate: k.h }; }
  const window = f >= 0.88 - 1e-9 && f < 1 - 1e-9;
  if (c.atp !== k.atp + (window ? 1 : 0)) { atpEqualOutsideWindow = false; if (firstAtpCand === null) firstAtpCand = { turns, f, classic: c.atp, candidate: k.atp }; }
  if (turns > 0 && c.atp < k.atp) atpLead = false;
  stageRows.push([f, c.stage, k.stage]);
}
check(`H⁺ count equals floor(rotor angle / (pi/4)) in classic and floor(turns x 8) in the candidate at all ${samples.length} sample angles (0..3 turns)`, hSame, JSON.stringify(firstH));
check('ATP count: the classic forms an ATP when a loose site closes (f > 0.88 of a 120 degree step); the candidate counts completed site cycles. Equal at every sample except inside that 12 % window, where the classic is exactly one ahead', atpEqualOutsideWindow, JSON.stringify(firstAtpCand));
check('the classic never counts fewer ATP than the candidate at the same angle', atpLead, 'candidate ahead');
const c3 = run(2 * Math.PI * 3 + 1e-9), k3 = cand(3);
check(`after three exact turns: classic ${c3.atp} ATP / ${c3.h} H⁺, candidate ${k3.atp} ATP / ${k3.h} H⁺ (9 ATP, 24 H⁺ per three turns, the 8 : 3 stoichiometry of the bovine c8 ring)`, c3.h === 24 && k3.h === 24 && k3.atp === 9 && c3.atp === 9, '');
// the stage boundaries over one site cycle, swept at 1/2000 (the first cycle of the classic: its sites are already placed at their roles)
const sweep = (fn) => { const out = []; let last = fn(0); for (let i = 1; i <= 1999; i++) { const f = i / 2000, v = fn(f); if (v !== last) { out.push(+f.toFixed(4)); last = v; } } return out; };
const cb = sweep((f) => run(2 * Math.PI * (f / 3 + 3) + 1e-9).stage), kb = sweep((f) => cand(f / 3 + 3).stage);
lines.push(`stage boundaries (fraction of one 120 degree site cycle): classic ${JSON.stringify(cb)}, candidate ${JSON.stringify(kb)}`);
const has = (list, v) => list.some((x) => Math.abs(x - v) <= 1 / 2000 + 1e-9);   // the sweep step
check('the two late boundaries agree (within the 1/2000 sweep step): stage changes at f = 0.8 and f = 0.93 in both', [0.8, 0.93].every((v) => has(cb, v) && has(kb, v)), `classic ${cb}, candidate ${kb}`);
check('known difference, recorded: the classic has stages 1-4 with its first boundary at f = 0.15; the candidate has stages 0-4 with boundaries at 0.1 and 0.25 (so the candidate lights step 2 from f = 0.25, the classic from 0.15)', has([cb[0]], 0.15) && has([kb[0]], 0.1) && has([kb[1]], 0.25), `classic ${cb}, candidate ${kb}`);
lines.push(`${total - bad} of ${total} agree${bad ? `, ${bad} differ` : ''}`);
const text = lines.join('\n') + '\n';
if (arg('--output')) fs.writeFileSync(arg('--output'), text);
process.stdout.write(text);
if (bad) process.exitCode = 1;
