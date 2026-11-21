// Differential test of plugins/simulation/corner-layout.mjs against the classic setup of the cell corner (src/sim/processes/cell-corner.js): the statements that find the membrane height, the
// channel's target and the crowd box are cut out of the source by their markers and run unchanged in a vm on the real 4V6F ribosome and the real 1K4C channel; the azimuth is the one the
// translation setup gives the camera (E -> A to the right), from the same site poses (ribosome-motion.mjs, equal to the classic, tools/ribosome-parity.mjs).
// Usage: node tools/corner-parity.mjs <structures-dir> [--three <three.module.js>] [--output file]   (structures-dir holds 4V6F.cif and 1K4C.cif)
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { pathToFileURL } from 'node:url';
import { parseMmcif } from '../plugins/structure/parser.mjs';
import { selectionSpace } from '../plugins/structure/selection.mjs';
import { applyBiologicalAssembly } from '../plugins/structure/assembly.mjs';
import { ribosomeFrame } from '../plugins/simulation/ribosome-motion.mjs';
import { cornerLayout } from '../plugins/simulation/corner-layout.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : null);
const dir = process.argv[2], out = arg('--output');
if (!dir) { console.error('usage: node tools/corner-parity.mjs <structures-dir> [--three file] [--output file]'); process.exit(2); }
const THREE = await import(pathToFileURL(arg('--three') ?? path.join(ROOT, 'desktop/node_modules/three/build/three.module.js')));
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const lines = []; let bad = 0, total = 0;
const check = (what, same, detail) => { total++; if (!same) bad++; lines.push(`${same ? 'ok  ' : 'DIFF'} ${what}${same ? '' : ' - ' + detail}`); };
const close = (a, b, tol = 1e-9) => a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) <= tol);

const space = selectionSpace(applyBiologicalAssembly(parseMmcif(fs.readFileSync(path.join(dir, '4V6F.cif'), 'utf8')), '1'));
const atoms = space.residues.map((r) => ({ p: r.position, part: r.entity, seq: r.labelSeq, asym: r.labelAsym }));
const channelSpace = selectionSpace(parseMmcif(fs.readFileSync(path.join(dir, '1K4C.cif'), 'utf8')));
const chain = channelSpace.residues.filter((r) => r.chain === 'C').map((r) => r.position);
lines.push(`4V6F: ${atoms.length} residues; 1K4C chain C: ${chain.length} residues`);

// the translation setup: the sites give E -> A (the camera azimuth) and the ribosome without tRNAs and mRNA gives the radius
const frame = ribosomeFrame(atoms), eA = [frame.sites.A.t[0] - frame.sites.E.t[0], frame.sites.A.t[1] - frame.sites.E.t[1], frame.sites.A.t[2] - frame.sites.E.t[2]];
const body = atoms.filter((a) => !/TRNA|^MRNA$/i.test(a.part)).map((a) => [...a.p]);
const mine = cornerLayout({ ribosome: atoms.map((a) => [...a.p]), body, eToA: eA, channel: chain });

// the classic statements, unchanged
const src = read('src/sim/processes/cell-corner.js');
const cut = (from, to) => { const a = src.indexOf(from), b = src.indexOf(to, a); if (a < 0 || b < 0) throw new Error('classic block not found: ' + from.slice(0, 40)); return src.slice(a, b); };
const placement = cut('const cR = cen(rib); let top = -1e9;', 'for (const a of kg.atoms) a.p.add(d);');
const crowd = cut('let botC = 1e9; for (const a of rib) botC = Math.min(botC, a.p.y);', 'this.crowd = await buildCrowd');
const sandbox = vm.createContext({ THREE, Math });
const V = (p) => new THREE.Vector3(p[0], p[1], p[2]);
// the crowd statement assigns to this.crowdBox: run the statements as a method with a `this` we can read
const run = (az, Rr) => {
  const body2 = placement + '\n' + crowd + '\nreturn { az, right, ym, d, top, cR, botC, crowdBox: this.crowdBox };';
  const fn = vm.runInContext(`(function (rib, kgAtoms, Rr, current) { const V = THREE.Vector3, cen = (A) => A.reduce((s, a) => s.add(a.p), new V()).multiplyScalar(1 / Math.max(1, A.length)), kg = { atoms: kgAtoms }, tl = { Rr }, all = rib.concat(kgAtoms);
    const fcc = null; ${body2.replace('const vdir = new V(Math.sin(az), 0, Math.cos(az)), nBack = vdir.clone().negate(), fcc = cen(all), Hx = tl.Rr + 170;', 'const vdir = new V(Math.sin(az), 0, Math.cos(az)), nBack = vdir.clone().negate(), Hx = tl.Rr + 170;')} })`, sandbox);
  return fn.call({}, atoms.map((a) => ({ p: V(a.p) })), chain.map((p) => ({ p: V(p) })), Rr, { camera: { az } });
};
// the classic's radius: the statement of the translation setup that finds the ribosome (without tRNAs and mRNA), its centre and the farthest distance from it
const translation = read('src/sim/processes/translation.js'), a = translation.indexOf('const rib = all.filter(a => !/TRNA|^MRNA$/i.test(a.part));'), b = translation.indexOf('/* exit tunnel', a);
if (a < 0 || b < 0) throw new Error('classic radius statement not found');
const classicRadius = vm.runInContext(`(function (all) { const V = THREE.Vector3, cen = (A) => A.reduce((s, a) => s.add(a.p), new V()).multiplyScalar(1 / Math.max(1, A.length)); ${translation.slice(a, b).replaceAll('this.', 'self.')}; return self.Rr; }).bind({})`.replace('(function (all) {', '(function (all) { const self = {};'), sandbox)(atoms.map((x) => ({ p: V(x.p), part: x.part })));
const classic = run(mine.az, classicRadius), arr = (v) => [v.x, v.y, v.z];

check(`azimuth: atan2(-eA.z, eA.x) = ${mine.az.toFixed(4)} rad (the camera the translation setup gives, E -> A to the right)`, Math.abs(classic.az - mine.az) < 1e-12, `${classic.az} vs ${mine.az}`);
check(`ribosome radius ${mine.radius.toFixed(3)} Å = the classic's Rr (the farthest residue of the ribosome without tRNAs and mRNA from its centre)`, Math.abs(classicRadius - mine.radius) < 1e-9, `${classicRadius} vs ${mine.radius}`);
check(`membrane height: ${mine.membraneY.toFixed(3)} Å = top of the ribosome (${mine.top.toFixed(3)}) + 60`, Math.abs(classic.ym - mine.membraneY) < 1e-9 && Math.abs(classic.top - mine.top) < 1e-9, `${classic.ym} vs ${mine.membraneY}`);
check('ribosome centre (the plane the channel is moved into)', close(arr(classic.cR), mine.centre), `${arr(classic.cR)} vs ${mine.centre}`);
check(`channel shift: [${mine.shift.map((v) => v.toFixed(3)).join(', ')}] Å (centroid of the channel to 60 Å above the ribosome, 0.3 of the radius left of its centre)`, close(arr(classic.d), mine.shift, 1e-9), `${arr(classic.d)} vs ${mine.shift}`);
check('bottom of the ribosome', Math.abs(classic.botC - mine.bottom) < 1e-9, `${classic.botC} vs ${mine.bottom}`);
check('crowd box: below the membrane (34 Å under it), 70 Å under the ribosome, ±(radius + 170) Å around its centre', close(arr(classic.crowdBox.min), mine.crowdBox.min) && close(arr(classic.crowdBox.max), mine.crowdBox.max), `${arr(classic.crowdBox.min)}|${arr(classic.crowdBox.max)} vs ${mine.crowdBox.min}|${mine.crowdBox.max}`);
// the channel really ends up in the cut plane: after the shift its centroid lies on the ribosome-centre plane at the membrane height
const moved = chain.map((p) => [p[0] + mine.shift[0], p[1] + mine.shift[1], p[2] + mine.shift[2]]), mc = moved.reduce((s, p) => s.map((v, i) => v + p[i] / moved.length), [0, 0, 0]);
check('after the shift the channel centroid is at the membrane height and 0.3 radius to the left of the ribosome centre, in the plane of the view', Math.abs(mc[1] - mine.membraneY) < 1e-9 && Math.abs((mc[0] - mine.centre[0]) * mine.right[0] + (mc[2] - mine.centre[2]) * mine.right[2] + mine.radius * 0.3) < 1e-9 && Math.abs((mc[0] - mine.centre[0]) * Math.sin(mine.az) + (mc[2] - mine.centre[2]) * Math.cos(mine.az)) < 1e-9, mc.join(','));
lines.push(`${total - bad} of ${total} agree${bad ? `, ${bad} differ` : ''}`);
const text = lines.join('\n') + '\n';
if (out) fs.writeFileSync(out, text);
process.stdout.write(text);
if (bad) process.exitCode = 1;
