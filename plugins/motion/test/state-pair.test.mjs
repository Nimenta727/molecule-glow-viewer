import assert from 'node:assert/strict';
import test from 'node:test';
import { parsePdb } from '../../structure/parser.mjs';
import { matchStates, fitStates, stateTargets, stateLigands, interpolate, ease, pingPong, visibleState, StatePairError } from '../state-pair.mjs';
import { displaceVertices, displaceVerticesGrid, nearestAnchors, sumOfSquares } from '../conformation.mjs';

const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);
const line = (rec, serial, name, res, chain, seq, [x, y, z], el) =>
  `${rec.padEnd(6)}${String(serial).padStart(5)} ${name.padEnd(4)} ${res.padStart(3)} ${chain}${String(seq).padStart(4)}    ${x.toFixed(3).padStart(8)}${y.toFixed(3).padStart(8)}${z.toFixed(3).padStart(8)}  1.00  0.00          ${el.padStart(2)}`;
// a bent chain of 8 residues; state B = the second half rotated 60° about the z axis through residue 4
const base = Array.from({ length: 8 }, (_, i) => [3.8 * i, 0.4 * (i % 2), 0]);
const bend = (p, i) => { if (i < 4) return p; const [dx, dy] = [p[0] - base[3][0], p[1]], c = Math.cos(Math.PI / 3), s = Math.sin(Math.PI / 3); return [base[3][0] + dx * c - dy * s, dx * s + dy * c, 0]; };
const pdb = (coords, ligand) => [...coords.map((p, i) => line('ATOM', i + 1, 'CA', 'ALA', 'A', i + 1, p, 'C')), ...(ligand ? [line('HETATM', 99, 'FE', 'HEM', 'B', 1, ligand, 'FE')] : []), 'END'].join('\n');
const A = parsePdb(pdb(base)), B = parsePdb(pdb(base.map(bend), [10, 10, 0]));

test('residues are matched by chain and label sequence, in the order of A', () => {
  const pairs = matchStates(A, B);
  assert.equal(pairs.length, 8);
  assert.ok(pairs.every(({ a, b }) => a.labelSeq === b.labelSeq && a.asym === b.asym));
  const partial = parsePdb(pdb(base.slice(0, 5)));
  assert.equal(matchStates(A, partial).length, 5);
});

test('the fit moves B onto A over all matched residues; what remains is the real difference between the states', () => {
  const fit = fitStates(A, B);
  assert.equal(fit.matched, 8);
  assert.ok(fit.rmsdAfter < fit.rmsdBefore, 'fitting reduces the deviation');
  assert.ok(fit.maxShift > 2 && fit.shifts.length === 8, 'a bent half cannot be fitted away');
  const targets = stateTargets(fit);
  assert.equal(targets.size, 8);
  const residue = fit.pairs[3].a;
  near(Math.hypot(...targets.get(residue).map((v, i) => v - residue.position[i])), fit.shifts[3]);
});

test('identical states have zero shift; too few matches are refused with a clear message', () => {
  const same = fitStates(A, A);
  assert.ok(same.maxShift < 1e-6 && same.rmsdAfter < 1e-6);
  assert.throws(() => fitStates(A, parsePdb(pdb(base.slice(0, 2)))), StatePairError);
});

test("B's small molecules are carried into A's frame", () => {
  const fit = fitStates(A, B), ligands = stateLigands(B, fit);
  assert.equal(ligands.length, 1);
  assert.notDeepEqual(ligands[0].atoms[0].position, [10, 10, 0]);
});

test('interpolation, easing and the back-and-forth', () => {
  assert.deepEqual(interpolate([0, 0, 0], [10, 20, 30], 0.5), [5, 10, 15]);
  assert.equal(ease(-1), 0); assert.equal(ease(2), 1); assert.equal(ease(0.5), 0.5);
  assert.equal(pingPong(-Math.PI / 2), 0, 'holds at the first state');
  assert.equal(pingPong(Math.PI / 2), 1, 'holds at the second state');
  assert.ok(pingPong(0) > 0.4 && pingPong(0) < 0.6);
  assert.deepEqual([visibleState(0.1), visibleState(0.5), visibleState(0.9)], ['A', null, 'B']);
});

test('the grid-accelerated displacement equals the brute-force one', () => {
  let seed = 12345;
  const random = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const anchors = Array.from({ length: 300 }, () => { const at = [random() * 40, random() * 40, random() * 40]; return { at, from: at.map((v) => v * 20), shift: [random() * 3, random() * 3, random() * 3] }; });
  const positions = Array.from({ length: 900 }, () => random() * 44 - 2);
  const resolve = (anchor) => anchor.from.map((v, i) => v + anchor.shift[i]);
  const [slow] = displaceVertices(positions, anchors, [resolve], { scale: 0.05 });
  const [fast] = displaceVerticesGrid(positions, anchors, [resolve], { scale: 0.05, cell: 3 });
  assert.equal(slow.length, fast.length);
  slow.forEach((v, i) => assert.ok(Math.abs(v - fast[i]) < 1e-12, `vertex ${i}: ${v} vs ${fast[i]}`));
  const few = anchors.slice(0, 3);   // fewer anchors than neighbours
  assert.deepEqual(displaceVerticesGrid(positions.slice(0, 30), few, [resolve], { scale: 1 })[0].length, 30);
  assert.equal(nearestAnchors([0, 0, 0], few, 4, sumOfSquares).length, 3);
});

import { conformationLayers, stateAnchors, displayCenter } from '../state-pair.mjs';
import { buildRepresentations, PRESENTATION_METERS_PER_ANGSTROM } from '../../structure/representation.mjs';

test('layers get a second state in which the points sit where the fitted residues sit', () => {
  const fit = fitStates(A, B), targets = stateTargets(fit);
  const center = displayCenter(A), anchors = stateAnchors(fit, center, PRESENTATION_METERS_PER_ANGSTROM);
  const groups = buildRepresentations(A, { style: 'blob' });
  const decorated = conformationLayers(groups[0].layers, anchors, targets, PRESENTATION_METERS_PER_ANGSTROM);
  const spheres = decorated.find((layer) => layer.mode === 'spheres');
  assert.equal(spheres.conformations.length, 2);
  assert.equal(spheres.conformations[1].length, spheres.positions.length);
  // each blob sits on its residue: the second state is that residue's fitted target (within the weighting of its neighbours)
  const moved = spheres.positions.map((v, i) => spheres.conformations[1][i] - v);
  assert.ok(Math.max(...moved.map(Math.abs)) > 0.05, 'the second state differs from the first');
  assert.equal(decorated.filter((layer) => !layer.positions?.length).length, 0);
  assert.deepEqual(conformationLayers([{ mode: 'points' }], anchors, targets, 0.05), [{ mode: 'points' }]);
});

import { domainMotions } from '../state-pair.mjs';
import { evaluateSelection } from '../../structure/selection.mjs';
import { selectionSpace } from '../../structure/selection.mjs';

test('fitting on a core shows the other domain as its own rotation, instead of spreading the deviation', () => {
  const space = selectionSpace(A), pick = (expression) => new Set(evaluateSelection(expression, space).residues);
  const core = pick('chain A and resi 1-4'), moving = pick('chain A and resi 5-8');
  const fit = fitStates(A, B, { core });
  assert.equal(fit.coreCount, 4);
  assert.ok(fit.rmsdCore < 1e-6, 'the rigid half superposes exactly');
  assert.ok(fit.rmsdAfter > 1, 'the rest of the chain does not');
  const [motion] = domainMotions(fit, [{ name: 'tail', residues: moving }], 1);
  assert.ok(Math.abs(motion.angle - 60) < 1e-2, `domain turns by the 60 degrees it was bent: ${motion.angle}`);
  const [half] = domainMotions(fit, [{ name: 'tail', residues: moving }], 0.5);
  assert.ok(Math.abs(half.angle - 30) < 1e-2, `half way: ${half.angle}`);
  assert.deepEqual(domainMotions(fit, [{ name: 'few', residues: pick('resi 1-2') }])[0].angle, null, 'too few residues: no number');
});

test('a core with too few matched residues is refused', () => {
  const space = selectionSpace(A);
  assert.throws(() => fitStates(A, B, { core: new Set(evaluateSelection('resi 1-2', space).residues) }), StatePairError);
});
