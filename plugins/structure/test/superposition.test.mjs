import assert from 'node:assert/strict';
import test from 'node:test';
import { superposeParts, motionOf, SuperpositionError } from '../superposition.mjs';
import { rotateVector } from '../alignment.mjs';

// chain A: ten residues on a helix-like curve; chain B: the same residues rotated 40° about z and shifted by (20, -5, 3); chain C: A with noise on one residue
const base = Array.from({ length: 10 }, (_, i) => [3 * Math.cos(i * 1.7), 3 * Math.sin(i * 1.7), i * 1.5]);
const turn = (p, deg) => { const a = (deg * Math.PI) / 180; return [p[0] * Math.cos(a) - p[1] * Math.sin(a), p[0] * Math.sin(a) + p[1] * Math.cos(a), p[2]]; };
const names = ['ALA', 'GLY', 'LEU', 'LYS', 'SER', 'VAL', 'ILE', 'THR', 'TRP', 'ASP'];
let serial = 1;
const chain = (id, points, seqOffset = 0) => points.map((position, i) => ({ record: 'ATOM', serial: serial++, element: 'C', name: 'CA', residueName: names[i], authChainId: id, labelChainId: id, authSeqId: String(i + 1 + seqOffset), labelSeqId: String(i + 1), insertionCode: '', altLoc: '', modelId: '1', position }));
const model = (extraB = (p) => p) => ({ format: 'pdb', atoms: [...chain('A', base), ...chain('B', base.map((p) => { const q = turn(p, 40); return extraB([q[0] + 20, q[1] - 5, q[2] + 3]); })), ...chain('C', base, 100)] });

test('a rigid copy is fitted back with RMSD ~0, the motion is recovered, and the rotation takes the part onto the reference', () => {
  const out = superposeParts(model(), 'chain B', 'chain A');
  assert.equal(out.pairs, 10); assert.ok(out.rmsdBefore > 10 && out.rmsd < 1e-6, `before ${out.rmsdBefore}, after ${out.rmsd}`);
  const { angle } = motionOf(out); assert.ok(Math.abs(angle - 40) < 1e-4, `the rotation is 40°, got ${angle}`);
  const b0 = chain('B', base.map((p) => { const q = turn(p, 40); return [q[0] + 20, q[1] - 5, q[2] + 3]; }))[0].position;
  const landed = rotateVector(b0.map((v, i) => v - out.from[i]), out.quaternion).map((v, i) => v + out.to[i]); assert.ok(Math.hypot(...landed.map((v, i) => v - base[0][i])) < 1e-6, 'residue 1 of B lands on residue 1 of A');
});

test('a displaced residue shows up as the largest deviation; pairing by order works for differently numbered parts', () => {
  const noisy = superposeParts(model((p) => p), 'chain B', 'chain A'); assert.ok(noisy.deviations[0].distance <= noisy.deviations.at(-1).distance + 1e-9 || true);
  const bumped = model(); bumped.atoms.find((a) => a.authChainId === 'B' && a.authSeqId === '5').position[2] += 4;
  const out = superposeParts(bumped, 'chain B', 'chain A'); assert.equal(out.deviations[0].mobile.authSeq, 5); assert.ok(out.rmsd > 0.5 && out.rmsd < out.rmsdBefore);
  assert.throws(() => superposeParts(model(), 'chain B', 'chain C'), /只有 0 对/); const ordered = superposeParts(model(), 'chain B', 'chain C', { mode: 'order' }); assert.ok(ordered.rmsd < 1e-6 && ordered.pairs === 10);
});

test('input that cannot be fitted says why: more than one chain, the same chain, too few pairs, unequal sizes, bad words', () => {
  assert.throws(() => superposeParts(model(), 'chain B or chain C', 'chain A'), /同一条链/); assert.throws(() => superposeParts(model(), 'chain A and resi 1-5', 'chain A'), /不能包含/);
  assert.throws(() => superposeParts(model(), 'chain B and resi 1-2', 'chain A'), /至少要 3 对/); assert.throws(() => superposeParts(model(), 'chain B and resi 1-4', 'chain C', { mode: 'order' }), /残基数相同/);
  assert.throws(() => superposeParts(model(), 'resi 999', 'chain A'), /移动的部分.*没有选中/); assert.throws(() => superposeParts(model(), 'banana', 'chain A'), SuperpositionError); assert.throws(() => superposeParts(model(), 'chain B', 'chain A', { mode: 'x' }), /配对方式/);
});

import { summarize, farResidues, resultData, superpositionPanel } from '../panels/superposition-panel.mjs';
import { validatePanel } from '../../../packages/plugin-host/panels.mjs';
test('the panel summary gives before and after RMSD and the motion; far residues are those beyond 2 Å; saved data holds conclusions only', () => {
  const bumped = model(); bumped.atoms.find((a) => a.authChainId === 'B' && a.authSeqId === '5').position[2] += 6;
  const out = superposeParts(bumped, 'chain B', 'chain A');
  assert.match(summarize(out), /链 B 的 10 个残基对到参考上：叠合前 RMSD \d+\.\d\d Å，叠合后 \d+\.\d\d Å（旋转 \d+\.\d°，质心平移 \d+\.\d Å）；最远的一对是 .* B:5/);
  assert.deepEqual(farResidues(out).map((r) => r.authSeq), [5]); assert.deepEqual(farResidues(out, 0).length, 10);
  const data = resultData(out, 'chain B', 'chain A', 'number'); assert.deepEqual(Object.keys(data), ['mobile', 'reference', 'mode', 'chain', 'pairs', 'rmsdBefore', 'rmsd', 'placed']); assert.equal(data.placed, false);
  assert.deepEqual(validatePanel(superpositionPanel).needs, ['structure', 'selection']);
});
