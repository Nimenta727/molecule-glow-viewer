// Differential test: the anchors of the respiratory-chain relay (plugins/simulation/works/respiratory-relay.mjs, found in the structure by what the cofactors are) against the classic
// setup of src/sim/processes/respiratory-chain.js, which is cut out of the source by its own markers and run unchanged in a vm on the same points: the Fe-S chain of complex I, N2, the
// quinone site, CuA / CuB, hemes a / a3, c1, bL, bH, the Rieske cluster, Qo / Qi and the four proton paths along the membrane arm. The real 5GUP, in the frame the work uses.
// Usage: node tools/relay-parity.mjs <structures-dir> [--three <three.module.js>] [--output file]   (structures-dir holds 5GUP.cif)
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { pathToFileURL } from 'node:url';
import { parseMmcif } from '../plugins/structure/parser.mjs';
import { selectionSpace } from '../plugins/structure/selection.mjs';
import { orientedFrame, kwMatch } from '../plugins/simulation/structure-frame.mjs';
import { DataAnimation } from '../plugins/simulation/data-animation.mjs';
import { RESPIRATORY_ANCHORS } from '../plugins/simulation/works/respiratory-relay.mjs';
import { mechanismWorkConfig } from '../plugins/simulation/works/mechanism-works.mjs';
import { normalizeDataConfig } from '../plugins/simulation/data-tool.mjs';
import { seededRng } from '../plugins/motion/particles.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : null);
const dir = process.argv[2], out = arg('--output');
if (!dir) { console.error('usage: node tools/relay-parity.mjs <structures-dir> [--three file] [--output file]'); process.exit(2); }
const THREE = await import(pathToFileURL(arg('--three') ?? path.join(ROOT, 'desktop/node_modules/three/build/three.module.js')));
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const lines = []; let bad = 0, total = 0;
const check = (what, same, detail) => { total++; if (!same) bad++; lines.push(`${same ? 'ok  ' : 'DIFF'} ${what}${same ? '' : ' — ' + detail}`); };
const eq = (a, b) => a.length === b.length && a.every((v, i) => Object.is(v, b[i]) || v === b[i]);

// the 5GUP scene as the pack declares it
const SCENE = { axis: 'short', axisFit: ['NADH-ubiquinone oxidoreductase chain', '/^Cytochrome b$/', 'Cytochrome c oxidase subunit 1', 'Cytochrome c oxidase subunit 3'], up: 'flavoprotein 1', membranes: [{ at: '/^Cytochrome b$/', offset: 0 }],
  groupParts: [['复合体 IV', 'oxidase'], ['复合体 III', 'b-c1', '/^Cytochrome b$/', 'Cytochrome c1'], ['复合体 I', 'NADH', 'Acyl carrier']] };
const groupOf = (entity) => { const g = SCENE.groupParts.find((grp) => grp.slice(1).some((k) => kwMatch(entity, k))); return g ? g[0] : entity; };
const space = selectionSpace(parseMmcif(read === null ? '' : fs.readFileSync(path.join(dir, '5GUP.cif'), 'utf8')));
const residues = space.residues.map((r) => ({ position: r.position, entity: r.entity, authSeq: r.authSeq, insertion: r.insertion, labelSeq: r.labelSeq, chain: r.chain, labelAsym: r.labelAsym }));
const frame = orientedFrame({ residues, ligands: space.ligands, config: SCENE });
const S = frame.structure, ym = S.membraneY[0];
lines.push(`5GUP: ${residues.length} residues, ${S.ligands.length} small molecules, membrane at y = ${ym.toFixed(3)} in the work's frame`);

// --- the classic, unchanged ---
// One deliberate difference from the classic: the Fe–S wire of complex I is made of the [4Fe-4S] clusters (see respiratory-relay.mjs), so the classic's `c.comp === 'SF4' || c.comp === 'FES'` is narrowed to SF4.
const src = read('src/sim/processes/respiratory-chain.js').replace("c.comp === 'SF4' || c.comp === 'FES'", "c.comp === 'SF4'"), a = src.indexOf("const V3 = (x, y, z) => new THREE.Vector3(x, y, z), all = ctx.allAtoms;"), endMark = 'ctx.markHot([...chain, cuA, cuB, this.a3, this.ha, c1, bL, bH, isp], 7);', b = src.indexOf(endMark);
if (a < 0 || b < 0) throw new Error('classic setup block not found');
const sandbox = vm.createContext({ THREE, Math, console: { log() {}, warn() {}, error() {} } });
vm.runInContext(read('src/derived/geometry.js'), sandbox);
vm.runInContext(`function classicSetup(ctx) { const self = {}; ${src.slice(a, b).replaceAll('this.', 'self.').replaceAll('Object.assign(this,', 'Object.assign(self,')}; return self; }`, sandbox);
const V = (p) => new THREE.Vector3(p[0], p[1], p[2]);
const atoms = S.points.map((p, i) => ({ p: V(p), part: groupOf(residues[i].entity) }));
sandbox.__ctx = {
  allAtoms: atoms, membraneY: [ym], theta: 0, counters: {}, hideLigand() {},
  ligands: S.ligands.map((l) => ({ comp: l.comp, centre: V(l.centre), atoms: [{ p: V(l.centre), name: 'X' }] })),
  atomsOf: (re) => atoms.filter((x) => re.test(x.part)),
};
const classic = vm.runInContext('classicSetup(__ctx)', sandbox), near = (x, y) => x.length === y.length && x.every((v, i) => Math.abs(v - y[i]) < 1e-9), arr = (v) => { if (!v) throw new Error('classic value missing; keys: ' + Object.keys(classic)); return [v.x, v.y, v.z]; };

// --- the anchors ---
const raw = { version: 1, compartments: { top: { side: 'above', membrane: 0, gap: 30 }, bot: { side: 'below', membrane: 0, gap: 30 } }, anchors: RESPIRATORY_ANCHORS, pools: [], flows: [], reactions: [] };
const engine = new DataAnimation(raw, S), at = (name) => engine.anchor({ ref: name });
const one = (name, classicValue, tolerance = false) => { const mine = at(name)[0]; check(`${name}: same point as the classic${tolerance ? ' (within 1e-9 Å: the centre of the residues is summed in another order)' : ' to the last bit'}`, (tolerance ? near : eq)(arr(classicValue), mine), `${arr(classicValue)} vs ${mine}`); };
const chain = at('feI');
check(`Fe–S chain of complex I: ${classic.chainI.length} [4Fe-4S] clusters, same path and points`, classic.chainI.length === chain.length && classic.chainI.every((v, i) => eq(arr(v), chain[i])), `${classic.chainI.length} vs ${chain.length}`);
one('nadh', classic.nadh); one('qI', classic.qI); one('cuA', classic.cuA); one('cuB', classic.cuB); one('a3', classic.a3); one('ha', classic.ha);
one('c1', classic.c1); one('bL', classic.bL); one('bH', classic.bH); one('isp', classic.isp); one('Qo', classic.Qo); one('Qi', classic.Qi); one('dock1', classic.dock1); one('dock2', classic.dock2);
['pump1', 'pump2', 'pump3', 'pump4'].forEach((name, i) => one(name, classic.pumpI[i], true));
const fallbacks = engine.warnings.filter((w) => w.includes('改用模型中心') || w.includes('沿用它的中心'));
check('no anchor fell back to the middle of the model', fallbacks.length === 0, fallbacks.join('；'));

// --- the whole relay on the real structure: the shipped work configuration, run with the compartment model ---
{
  const config = normalizeDataConfig(mechanismWorkConfig({ process: 'respiratoryChain', ...SCENE }));
  const run = new DataAnimation(config.animation, S, { rng: seededRng(7), kinetics: config.kinetics }), stages = new Set();
  for (let i = 0; i < 30 * 300; i++) { if (i === 30 * 120) run.relays[0].rate = 0; run.step(1 / 30); if (run.stage !== null) stages.add(run.stage); }
  const n = run.relays[0].n, c = run.summary().counters, bad2 = run.warnings.filter((w) => w.includes('改用模型中心') || w.includes('沿用它的中心'));
  check(`the shipped work on 5GUP: no anchor fell back (${bad2.length})`, bad2.length === 0, bad2.join('；'));
  check(`${n} NADH cycles: ${c['H⁺ 泵出（复合体 I / IV）']} H⁺ pumped (6 per NADH), ${c['H⁺ 释放到膜间隙（Q 循环）']} released by the Q cycle (4 per NADH), ${c['O₂ → H₂O']} O₂ → 2 H₂O (1 per 2 NADH)`,
    n >= 3 && run.relays[0].busy === 0 && c['H⁺ 泵出（复合体 I / IV）'] === 6 * n && c['H⁺ 释放到膜间隙（Q 循环）'] === 4 * n && c['O₂ → H₂O'] === Math.floor(n / 2), JSON.stringify(c));
  check(`steps of the energy strip reached: ${[...stages].sort().join(' ')}`, [...stages].sort().join('') === '0123456', [...stages].join(' '));
  const bal = Object.entries(run.balance()).filter(([, v]) => v.expected !== v.actual);
  check('the metering of every species balances', bal.length === 0, JSON.stringify(bal));
}

const report = `${lines.join('\n')}\n${total - bad}/${total} identical\n`;
console.log(report); if (out) fs.writeFileSync(out, report);
process.exit(bad ? 1 : 0);
