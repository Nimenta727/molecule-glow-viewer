import assert from 'node:assert/strict';
import test from 'node:test';
import { measure, measurePoint, distance, angle, MeasureError } from '../measure.mjs';
import { describeChannel } from '../site-analysis.mjs';

const residue = (chain, authSeq, resn, position) => ({ chain, authSeq, resn, position, asym: chain, labelAsym: chain, labelSeq: authSeq, insertion: '', nucleic: false, entity: '', atom: {} });
const space = { residues: [residue('A', 1, 'GLY', [0, 0, 0]), residue('A', 2, 'ALA', [3, 4, 0]), residue('A', 3, 'SER', [3, 4, 5])], ligands: [{ comp: 'ATP', asym: 'B', labelAsym: 'B', chain: 'B', atom: {}, atoms: [{ position: [10, 0, 0] }, { position: [12, 0, 0] }] }] };

test('two single selections give a distance, three give the angle at the middle one', () => {
  const d = measure(space, ['chain A and resi 1', 'chain A and resi 2']);
  assert.equal(d.distance, 5); assert.equal(d.unit, 'Å'); assert.deepEqual(d.points, ['GLY A:1 Cα', 'ALA A:2 Cα']);
  const a = measure(space, ['chain A and resi 1', 'chain A and resi 2', 'chain A and resi 3']);
  assert.ok(Math.abs(a.angle - 90) < 1e-12 && a.unit === '°', 'the two directions from the middle residue are perpendicular');
  assert.ok(Math.abs(angle([1, 0, 0], [0, 0, 0], [0, 1, 0]) - 90) < 1e-12);
  assert.ok(Math.abs(angle([1, 0, 0], [0, 0, 0], [-1, 0, 0]) - 180) < 1e-12);
});

test('a ligand is its centre; anything but exactly one object is refused with a clear message', () => {
  assert.deepEqual(measurePoint(space, 'ligand ATP').position, [11, 0, 0]);
  assert.equal(measurePoint(space, 'ligand ATP').name, 'ATP 中心');
  assert.throws(() => measure(space, ['chain A', 'ligand ATP']), (e) => e instanceof MeasureError && /选中了 3 个/.test(e.message));
  assert.throws(() => measure(space, ['chain A and resi 1']), /两个/);
  assert.throws(() => measure(space, ['chain A and resi 1', 'chain Z']), /选中了 0 个/);
  assert.equal(distance([0, 0, 0], [0, 0, 0]), 0);
});

test('a channel report names its length, the narrowest point and the residues lining it', () => {
  const path = [{ p: [0, 0, 0], r: 8 }, { p: [0, 0, 3], r: 2.2 }, { p: [0, 0, 6], r: 7 }];
  const r = describeChannel(path, space.residues);
  assert.equal(r.length, 6); assert.equal(r.narrowest, 2.2); assert.deepEqual(r.narrowestAt, [0, 0, 3]);
  assert.equal(r.lining[0].residue.authSeq, 1, 'the nearest residue first'); assert.equal(r.lining.length, 3);
  assert.equal(describeChannel(null, []), null);
});
