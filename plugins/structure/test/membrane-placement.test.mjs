import assert from 'node:assert/strict';
import test from 'node:test';
import { placeMembrane, applyPlacement, undoPlacement, membraneInfoFromRcsb, MEMBRANE_QUERY } from '../membrane-placement.mjs';

// a bundle of 6 helices (1.5 Å per residue, 25 residues each) standing along a tilted axis, with Lys/Arg loops hanging at one end only
function bundle(axis) {
  const n = Math.hypot(...axis), a = axis.map((v) => v / n), pick = Math.abs(a[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const u = [a[1] * pick[2] - a[2] * pick[1], a[2] * pick[0] - a[0] * pick[2], a[0] * pick[1] - a[1] * pick[0]], un = Math.hypot(...u), U = u.map((v) => v / un);
  const V = [a[1] * U[2] - a[2] * U[1], a[2] * U[0] - a[0] * U[2], a[0] * U[1] - a[1] * U[0]], atoms = [];
  for (let h = 0; h < 6; h++) {
    const phi = h / 6 * Math.PI * 2, cx = 9 * Math.cos(phi), cy = 9 * Math.sin(phi);
    for (let r = 0; r < 25 + 12; r++) {
      const t = (r - 18) * 1.5, inHelix = r < 25, lysLoop = r >= 25;
      atoms.push({ position: [0, 1, 2].map((k) => a[k] * (lysLoop ? -20 - (r - 25) * 1.5 : t) + U[k] * cx + V[k] * cy), asym: 'A', seq: h * 40 + r + 1, nucleic: false, resn: lysLoop ? 'LYS' : inHelix ? 'LEU' : 'ALA', entity: 'x' });
    }
  }
  return atoms;
}
const segs = [...Array(6)].map((_, h) => ({ asym: 'A', b: h * 40 + 1, e: h * 40 + 25 }));

test('the normal of the segments goes to +Y, the centre to y = 0, and the side with Lys/Arg is the inside (below)', () => {
  const atoms = bundle([0.4, 0.3, 0.86]), r = placeMembrane(atoms, { segs, segSrc: 'OPM', memAnn: true, topo: [] });
  assert.equal(r.src, 'OPM'); assert.equal(r.nSeg, 6);
  const moved = applyPlacement(atoms.map((a) => a.position), r.placement);
  const helix = moved.filter((_, i) => atoms[i].resn === 'LEU'), ys = helix.map((p) => p[1]);
  assert.ok(Math.abs(Math.max(...ys) + Math.min(...ys)) < 6, 'the helix region is centred on y = 0');
  assert.ok(Math.max(...ys) - Math.min(...ys) > 30, 'the helices stand along Y');
  assert.ok(Math.max(...helix.map((p) => Math.hypot(p[0], p[2]))) < 11, 'and are vertical');
  const lys = moved.filter((_, i) => atoms[i].resn === 'LYS');
  assert.ok(lys.every((p) => p[1] < 0), 'the Lys loops hang below: that side is the inside');
  assert.ok(r.krIn > r.krOut && r.sideSure);
  assert.ok(r.half >= 12 && r.half <= 20);
});

test('undoPlacement returns to the original coordinates; a soluble protein and a too-small one have no membrane', () => {
  const atoms = bundle([1, 0, 0]), r = placeMembrane(atoms, { segs, segSrc: 'OPM', memAnn: true });
  const back = undoPlacement(applyPlacement(atoms.map((a) => a.position), r.placement), r.placement);
  back.forEach((p, i) => p.forEach((v, k) => assert.ok(Math.abs(v - atoms[i].position[k]) < 1e-9)));
  assert.equal(placeMembrane(atoms, { segs: [], memAnn: false }), null, 'no annotation: left alone');
  assert.equal(placeMembrane(atoms.slice(0, 20), { segs, segSrc: 'OPM', memAnn: true }), null);
});

test('the RCSB answer: segments from the first source that has any, and the membrane annotation', () => {
  const feature = (source, b, e) => ({ type: 'MEMBRANE_SEGMENT', provenance_source: source, feature_positions: [{ beg_seq_id: b, end_seq_id: e }] });
  const response = { data: { entry: { polymer_entities: [{ rcsb_polymer_entity_annotation: [{ type: 'GO', name: 'plasma membrane' }, { type: 'GO', name: 'membrane-bounded organelle' }],
    polymer_entity_instances: [{ rcsb_polymer_entity_instance_container_identifiers: { asym_id: 'A' }, rcsb_polymer_instance_feature: [feature('PDBTM', 5, 30), feature('OPM', 23, 51), { type: 'OTHER' }] }] }] } } };
  const info = membraneInfoFromRcsb(response);
  assert.deepEqual(info.segs, [{ asym: 'A', b: 23, e: 51 }]); assert.equal(info.segSrc, 'OPM'); assert.equal(info.memAnn, true);
  assert.equal(membraneInfoFromRcsb({ data: { entry: null } }), null);
  assert.equal(membraneInfoFromRcsb({ data: { entry: { polymer_entities: [{ rcsb_polymer_entity_annotation: [{ type: 'GO', name: 'membrane-bounded organelle' }] }] } } }).memAnn, false);
  assert.throws(() => MEMBRANE_QUERY('nope'), /PDB/);
  assert.match(MEMBRANE_QUERY('1k4c'), /1K4C/);
});
