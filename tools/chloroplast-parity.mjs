// Differential test: the anchors of the light-reactions relay (plugins/simulation/works/chloroplast-relay.mjs, found in the structures by what the cofactors are) against the classic setup of
// src/sim/processes/chloroplast.js, cut out of the source by its markers and run unchanged in a vm on the same points, on the real PSII (3JCU), cytochrome b6f (6RQF) and PSI (5L8R). Each component
// is put in the frame the work uses for it (membrane normal vertical, stroma up); where the classic relates the components (the PSII monomer facing b6f, cytochrome f facing PSI) both sides are
// given the same fixed reference point, since the components of this test are separate files. Then the whole relay is run on the real PSII + b6f + PSI placed side by side: stoichiometry per NADPH.
// Usage: node tools/chloroplast-parity.mjs <structures-dir> [--three <three.module.js>] [--output file]   (structures-dir holds 3JCU 6RQF 5L8R 6FKF 1FNB .cif)
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { pathToFileURL } from 'node:url';
import { parseMmcif } from '../plugins/structure/parser.mjs';
import { selectionSpace } from '../plugins/structure/selection.mjs';
import { orientedFrame, kwMatch } from '../plugins/simulation/structure-frame.mjs';
import { DataAnimation } from '../plugins/simulation/data-animation.mjs';
import { CHLOROPLAST_ANCHORS } from '../plugins/simulation/works/chloroplast-relay.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : null);
const dir = process.argv[2], out = arg('--output');
if (!dir) { console.error('usage: node tools/chloroplast-parity.mjs <structures-dir> [--three file] [--output file]'); process.exit(2); }
const THREE = await import(pathToFileURL(arg('--three') ?? path.join(ROOT, 'desktop/node_modules/three/build/three.module.js')));
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const lines = []; let bad = 0, total = 0;
const check = (what, same, detail) => { total++; if (!same) bad++; lines.push(`${same ? 'ok  ' : 'DIFF'} ${what}${same ? '' : ' — ' + detail}`); };
const eq = (a, b) => a.length === b.length && a.every((v, i) => Object.is(v, b[i]) || v === b[i]);

const src = read('src/sim/processes/chloroplast.js'), a = src.indexOf('const V3 = (x, y, z) => new THREE.Vector3(x, y, z), all = ctx.allAtoms, ym = this.ym = ctx.membraneY[0] ?? 0;'),
  endMark = 'Object.assign(this, { oex, tyrZ, P680, pheo, QA, fe2, QB, f, bL, bH, cn, isp, Qo: bL.clone().lerp(isp, 0.45), Qi: cn.clone().lerp(bH, 0.3), P700, A0, A1, FX, FA, FB });';
const b = src.indexOf(endMark) + endMark.length, c = src.indexOf('this.ant2 = ', b), d = src.indexOf('\n', src.indexOf('this.ant1 = ', b));
if (a < 0 || b < endMark.length || c < 0 || d < 0) throw new Error('classic setup block not found');
const sandbox = vm.createContext({ THREE, Math, console: { log() {}, warn() {}, error() {} } });
vm.runInContext(read('src/derived/geometry.js'), sandbox);
vm.runInContext(`function classicSetup(ctx) { const self = {}, rand = Math.random; ${src.slice(a, d).replaceAll('this.', 'self.').replaceAll('Object.assign(this,', 'Object.assign(self,')}; return self; }`, sandbox);

const V = (p) => new THREE.Vector3(p[0], p[1], p[2]), arr = (v) => [v.x, v.y, v.z];
const GROUPS = { '3JCU': [['放氧复合体蛋白', 'Oxygen-evolving'], ['LHCII 天线', 'Chlorophyll a-b binding'], ['PSII 核心', '/./']] };
const SCENES = {
  '3JCU': { label: null, config: { axis: 'short', axisFit: ['Photosystem II protein D1', 'D2 protein', 'CP47', 'CP43'], down: 'Oxygen-evolving enhancer protein 1', membranes: [{ at: 'Photosystem II protein D1', offset: 0 }] } },
  '6RQF': { label: 'Cyt b6f', config: { axis: 'long', membranes: [{ at: '/^cytochrome b6$/', offset: 0 }] } },   // a frame in which the lumen heme of one cytochrome f lies below the membrane (what is compared is the same in both)
  '5L8R': { label: 'PSI-LHCI', config: { axis: 'short', axisFit: ['photosystem i p700 chlorophyll a apoprotein'], up: 'photosystem i iron-sulfur center', membranes: [{ at: 'photosystem i p700 chlorophyll a apoprotein a1', offset: 0 }] } },
};
const model = (id) => parseMmcif(fs.readFileSync(path.join(dir, id + '.cif'), 'utf8'));
const REF_B6F = [180, 20, -40], REF_PSI = [-200, 10, 60];   // where the other components are, for the relations the classic takes between them (the same for both sides)

function load(id) {
  const m = model(id), space = selectionSpace(m), scene = SCENES[id];
  const residues = space.residues.map((r) => ({ position: r.position, entity: r.entity, authSeq: r.authSeq, insertion: r.insertion, labelSeq: r.labelSeq, chain: r.chain, labelAsym: r.labelAsym }));
  const frame = orientedFrame({ residues, ligands: space.ligands, config: scene.config });
  return { m, space, frame, scene, residues };
}
function classicRun(id, env) {
  const { m, space, frame, scene, residues } = env, S = frame.structure, groupOf = (name) => { const g = (GROUPS[id] ?? []).find((grp) => grp.slice(1).some((k) => kwMatch(name, k))); return g ? g[0] : (scene.label ?? name); };
  const atoms = space.residues.map((r, i) => ({ p: V(S.points[i]), part: groupOf(m.chainNames?.[r.labelAsym] ?? r.entity), entName: m.chainNames?.[r.labelAsym] ?? r.entity, resn: r.resn, aseq: r.authSeq }));
  // the other components, as one atom each at the reference points
  atoms.push({ p: V(REF_B6F), part: 'Cyt b6f', entName: '', resn: 'X', aseq: 0 }, { p: V(REF_PSI), part: 'PSI-LHCI', entName: '', resn: 'X', aseq: 0 });
  const ligands = space.ligands.map((l, i) => ({ comp: l.comp, compLabel: scene.label ?? undefined, centre: V(S.ligands[i].centre), atoms: l.atoms.map((x) => ({ name: x.name, p: V(frame.fromNative(x.position)) })) }));
  sandbox.__ctx = { allAtoms: atoms, membraneY: [S.membraneY[0]], theta: 0, counters: {}, hideLigand() {}, rowDir: V([1, 0, 0]), ligands, atomsOf: (re) => atoms.filter((x) => re.test(x.part)), makeParticle: () => ({ position: V([0, 0, 0]), scale: { setScalar() {} } }) };
  return vm.runInContext('classicSetup(__ctx)', sandbox);
}
const mine = (env, extra = {}) => {
  const raw = { version: 1, compartments: { top: { side: 'above', membrane: 0, gap: 30 }, bot: { side: 'below', membrane: 0, gap: 30 } }, anchors: { ...CHLOROPLAST_ANCHORS, b6C: REF_B6F, psiC: REF_PSI, ...extra }, pools: [], flows: [], reactions: [] };
  const engine = new DataAnimation(raw, env.frame.structure);
  return { at: (name, cycle = 0) => engine.anchor({ ref: name }, { cycle }), engine };
};
const compare = (what, c, m, tolerance = 1e-9) => !c ? check(`${what}: the classic finds none, and so does the relay (the path skips it)`, m === undefined, `mine ${m}`) : check(`${what}: same point as the classic (within ${tolerance} Å: ring centres are summed in another order)`, m && (m.length === 3 && m.every((v, i) => Math.abs(v - arr(c)[i]) < tolerance)), `${c ? arr(c) : 'none'} vs ${m}`);
const hits = (env, sets) => sets.length;

const results = {};
for (const id of Object.keys(SCENES)) {
  const env = load(id), S = env.frame.structure;
  lines.push(`${id}: ${env.residues.length} residues, ${S.ligands.length} small molecules, membrane at y = ${S.membraneY[0].toFixed(3)} in the work's frame`);
  const classic = classicRun(id, env), { at, engine } = mine(env);
  results[id] = { classic, at, engine, env };
  const names = { '3JCU': ['oex', 'pheo', 'P680', 'tyrZ', 'fe2', 'QA', 'QB'], '6RQF': ['f', 'bL', 'bH', 'cn', 'isp', 'Qo', 'Qi'], '5L8R': ['P700', 'A1', 'A0', 'FX', 'FA', 'FB'] }[id];
  for (const n of names) compare(`${id} ${n}`, classic[n], at(n)[0]);   // `undefined` = no point
  if (id === '3JCU') check('3JCU antenna chlorophylls around P680 (25–70 Å): same set', setsEqual(classic.ant2, antenna(at, 'ant2')), `${classic.ant2.length} vs ${antenna(at, 'ant2').length}`);
  if (id === '5L8R') {
    // the Lhca2 protein carries the same name as the PSII's LHCII, so its chlorophylls are not told from the LHCII's by name and are left out of the PSI antenna set
    const mineSet = antenna(at, 'ant1'), key = (p) => p.map((v) => v.toFixed(9)).join(','), have = new Set(mineSet.map(key));
    const left = classic.ant1.filter((v) => !have.has(key(arr(v)))), extra = mineSet.filter((p) => !classic.ant1.some((v) => key(arr(v)) === key(p)));
    const ambiguous = left.every((v) => { const l = env.frame.structure.ligands.find((x) => key(x.ring) === key(arr(v))); return l && l.part === 'chlorophyll a-b binding protein, chloroplastic'; });
    check(`5L8R antenna chlorophylls of PSI (> 25 Å from P700): the classic's ${classic.ant1.length}, of which ${mineSet.length} are found (the ${left.length} left are those of the protein named like the PSII's LHCII), none extra`, extra.length === 0 && ambiguous, `extra ${extra.length}, ambiguous ${ambiguous}`);
  }
  const fb = engine.warnings.filter((w) => w.includes('改用模型中心') && !/PS[I2]|FAD|FNR|plastocyanin|ferredoxin|OEX|PHO|subunit|CL0|CLA|PQN|SF4|HEC|HEM|FES|FE2|PL9/.test('x') && names.some(() => false));
}
function antenna(at, name) { const seen = new Map(); for (let cycle = 0; cycle < 400; cycle++) { const p = at(name, cycle)[0]; seen.set(p.join(','), p); } return [...seen.values()]; }
function setsEqual(classicList, mineList) { const key = (p) => p.map((v) => v.toFixed(9)).join(','); const A = new Set(classicList.map((v) => key(arr(v)))), B = new Set(mineList.map(key)); return A.size === B.size && [...A].every((k) => B.has(k)); }

// FNR (1FNB): the FAD; the CF1Fo ATP synthase (6FKF): the a-subunit proton path and the CF1 exit, found by part name
{
  const sceneOf = (id, config) => { const sp = selectionSpace(parseMmcif(fs.readFileSync(path.join(dir, id + '.cif'), 'utf8'))); const rs = sp.residues.map((r) => ({ position: r.position, entity: r.entity, authSeq: r.authSeq, insertion: r.insertion, labelSeq: r.labelSeq, chain: r.chain, labelAsym: r.labelAsym })); return orientedFrame({ residues: rs, ligands: sp.ligands, config }).structure; };
  const raw = (anchors) => ({ version: 1, compartments: { top: { side: 'above', membrane: 0, gap: 30 }, bot: { side: 'below', membrane: 0, gap: 30 } }, anchors, pools: [], flows: [], reactions: [] });
  const fnr = new DataAnimation(raw({ b6C: [0, 0, 0], psiC: [0, 0, 0], fnrC: CHLOROPLAST_ANCHORS.fnrC, fad: CHLOROPLAST_ANCHORS.fad }), sceneOf('1FNB', { axis: 'sym' }));
  const fad = fnr.anchor({ ref: 'fad' })[0], c = fnr.anchor({ ref: 'fnrC' })[0];
  check('1FNB: the FAD is found in the FNR (ring-atom centre) and lies inside the protein', fnr.warnings.filter((w) => w.includes('改用模型中心')).length === 0 && Math.hypot(fad[0] - c[0], fad[1] - c[1], fad[2] - c[2]) < 40, fnr.warnings.join('；'));
  const atp = new DataAnimation(raw(CHLOROPLAST_ANCHORS), sceneOf('6FKF', { axis: 'sym', membranes: [{ at: 'subunit c', offset: 0 }] })), names = ['atpH0', 'atpH1', 'atpH2', 'atpH3', 'atpOut'];
  for (const n of names) atp.anchor({ ref: n });
  check('6FKF: the five CF1Fo anchors (a-subunit proton path, CF1 exit) are found by part name', atp.warnings.filter((w) => w.includes('改用模型中心') && /subunit/.test(w)).length === 0, atp.warnings.join('；'));
}
for (const [id, r] of Object.entries(results)) for (const w of r.engine.warnings.filter((x) => !x.includes('没有任何池'))) lines.push(`--   ${id} warning: ${w}`);
const report = `${lines.join('\n')}\n${total - bad}/${total} identical\n`;
console.log(report); if (out) fs.writeFileSync(out, report);
process.exit(bad ? 1 : 0);
