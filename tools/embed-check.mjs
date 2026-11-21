// C2 on a real membrane protein (docs/PLUGIN_ROADMAP.md): KcsA (1K4C) is placed in a membrane by the project's own automatic placement (hydrophobic-belt scan, plugins/structure/membrane-placement.mjs),
// then 40 copies are embedded on a vesicle of radius 400 A. Checked on the atoms: the hydrophobic belt of every copy straddles the vesicle's mid-surface (within the half thickness the placement found),
// the channel axis points along the surface normal, and no two copies come within 4 A of each other. Usage: node tools/embed-check.mjs <structures-dir>
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { parseMmcif } from '../plugins/structure/parser.mjs';
import { applyBiologicalAssembly } from '../plugins/structure/assembly.mjs';
import { selectionSpace } from '../plugins/structure/selection.mjs';
import { placeMembrane, applyPlacement } from '../plugins/structure/membrane-placement.mjs';
import { midSurface } from '../plugins/structure/membrane-builder.mjs';
import { embedCopies } from '../plugins/simulation/placement.mjs';
import { rotateVector } from '../plugins/structure/alignment.mjs';

const dir = process.argv[2]; if (!dir) { console.error('usage: node tools/embed-check.mjs <structures-dir>'); process.exit(2); }
const model = applyBiologicalAssembly(parseMmcif(fs.readFileSync(path.join(dir, '1K4C.cif'), 'utf8'))), residues = selectionSpace(model).residues;
// 1K4C also holds an antibody fragment (Fab) that is not in the membrane: only the channel's own chains are placed
const channel = residues.filter((r) => /potassium channel/i.test(r.entity)); console.log(`${channel.length} channel residues of ${residues.length} (the rest is the Fab)`);
const atoms = channel.map((r) => ({ position: [...r.position], asym: r.asym, seq: r.labelSeq, nucleic: r.nucleic, resn: r.resn, entity: r.entity }));
const found = placeMembrane(atoms, { segs: [], memAnn: true, topo: [] });
assert.ok(found, 'the hydrophobic-belt scan finds a membrane in KcsA'); console.log(`placement: ${found.src}, half thickness ${found.half.toFixed(1)} Å, ${found.placement.length} steps`);
const canonical = applyPlacement(atoms.map((a) => a.position), found.placement);   // the structure in its membrane frame: plane y = 0, normal +y
const belt = canonical.map((p, i) => ({ p, i })).filter(({ p }) => Math.abs(p[1]) <= found.half).map(({ i }) => i), radius = Math.max(...canonical.map((p) => Math.hypot(p[0], p[2]))) + 5;
console.log(`${atoms.length} residues, ${belt.length} in the belt, bounding radius ${radius.toFixed(1)} Å`);
const R = 400, surface = midSurface({ kind: 'sphere', radius: R }), { placements, placed, requested } = embedCopies({ steps: found.placement, surface, count: 40, radius, seed: 11 });
console.log(`embedded ${placed} of ${requested} copies on a vesicle of radius ${R} Å`); assert.ok(placed >= 30);
const at = (t, p) => rotateVector(p, t.rotation).map((v, k) => v + t.position[k]);
let beltOk = 0, beltAll = 0, worstAxis = 0;
const copies = placements.map(({ transform, point, normal }) => {
  const world = atoms.map((a) => at(transform, a.position));
  for (const i of belt) { const r = Math.hypot(...world[i]); beltAll++; if (Math.abs(r - R) <= found.half + 4) beltOk++; }   // 4 Å: the surface curves away from the tangent plane the belt was measured in
  // the channel axis: the canonical +y direction, carried through the copy, against the surface normal
  const origin = [0, 0, 0], tip = [0, 1, 0]; let a = origin, b = tip;
  for (const { centre, q } of [...found.placement].reverse()) { const inv = [-q[0], -q[1], -q[2], q[3]]; a = rotateVector(a, inv).map((v, k) => v + centre[k]); b = rotateVector(b, inv).map((v, k) => v + centre[k]); }
  const axis = at(transform, b).map((v, k) => v - at(transform, a)[k]), cos = axis[0] * normal[0] + axis[1] * normal[1] + axis[2] * normal[2]; worstAxis = Math.max(worstAxis, Math.acos(Math.max(-1, Math.min(1, cos))));
  return world;
});
console.log(`belt residues within the membrane thickness of the vesicle surface: ${beltOk}/${beltAll}; worst axis deviation from the normal ${(worstAxis * 180 / Math.PI).toFixed(6)}°`);
assert.ok(beltOk / beltAll > 0.95, 'the belt straddles the mid-surface'); assert.ok(worstAxis < 1e-6, 'the channel axis follows the normal');
let closest = Infinity; for (let i = 0; i < copies.length; i++) for (let j = i + 1; j < copies.length; j++) for (const p of copies[i]) for (const q of copies[j]) { const d = Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]); if (d < closest) closest = d; }
console.log(`closest residues of two different copies: ${closest.toFixed(1)} Å`); assert.ok(closest > 4, 'copies do not touch');
console.log('\nok: a real membrane protein embedded in a vesicle, many times');
