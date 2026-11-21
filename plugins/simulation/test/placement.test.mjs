import assert from 'node:assert/strict';
import test from 'node:test';
import { matrixFromQuaternion, quaternionFromMatrix, rigidFromSteps, embedTransform, embedCopies, volumeFromMass, volumeRegion, planComposition } from '../placement.mjs';
import { midSurface } from '../../structure/membrane-builder.mjs';
import { rotateVector } from '../../structure/alignment.mjs';

const near = (a, b, eps = 1e-9) => a.every((v, k) => Math.abs(v - b[k]) < eps);
const apply = (t, p) => rotateVector(p, t.rotation).map((v, k) => v + t.position[k]);
const quat = (axis, angle) => { const n = Math.hypot(...axis), s = Math.sin(angle / 2) / n; return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(angle / 2)]; };
// a structure whose membrane placement took two steps: centre it at (1, 2, 3) and turn it; then shift the mid-plane to y = 0
const STEPS = [{ centre: [1, 2, 3], q: quat([1, 1, 0], 0.7) }, { centre: [0, 4, 0], q: [0, 0, 0, 1] }];
const canonical = (p) => STEPS.reduce((q, { centre, q: r }) => rotateVector(q.map((v, k) => v - centre[k]), r), p);

test('quaternions and matrices convert both ways, and the steps of a placement collapse to one rigid motion', () => {
  for (const q of [quat([1, 2, 3], 1.1), quat([0, 0, 1], 3.0), quat([1, 0, 0], 0), quat([0, 1, 0], Math.PI)]) { const back = quaternionFromMatrix(matrixFromQuaternion(q)); assert.ok(near(back, q[3] < 0 ? q.map((v) => -v) : q, 1e-9), `round trip ${q}`); }
  const { R, t } = rigidFromSteps(STEPS);
  for (const p of [[0, 0, 0], [5, -3, 2], [10, 10, 10]]) { const direct = canonical(p), viaMatrix = [0, 1, 2].map((i) => R[i][0] * p[0] + R[i][1] * p[1] + R[i][2] * p[2] + t[i]); assert.ok(near(direct, viaMatrix, 1e-9), 'same as applying the steps one by one'); }
});

test('C2: embedding puts the structure\'s membrane mid-plane point on the chosen point and its membrane axis along the chosen normal', () => {
  const point = [100, -50, 20], normal = [1, 2, -2], up = normal.map((v) => v / 3);
  for (const spin of [0, 1.3, 4]) {
    const tf = embedTransform(STEPS, { point, normal, spin });
    assert.ok(near(apply(tf, [1, 2 + 4, 3]).map((v) => v), apply(tf, [1, 6, 3])), 'sanity');
    // the canonical origin is the structure point that canonical() sends to (0,0,0): find it by inversion of the steps and check it lands on `point`
    const origin = [0, 0, 0]; let p = origin; for (const { centre, q } of [...STEPS].reverse()) p = rotateVector(p, [-q[0], -q[1], -q[2], q[3]]).map((v, k) => v + centre[k]);
    assert.ok(near(apply(tf, p), point, 1e-9), `the canonical origin lands on the point (spin ${spin})`);
    // and the canonical +y axis (a unit step along it) points along the normal
    let q2 = [0, 1, 0]; for (const { centre, q } of [...STEPS].reverse()) q2 = rotateVector(q2, [-q[0], -q[1], -q[2], q[3]]).map((v, k) => v + centre[k]);
    const axis = apply(tf, q2).map((v, k) => v - point[k]); assert.ok(near(axis, up, 1e-9), `the membrane axis follows the normal (spin ${spin})`);
  }
  const deep = embedTransform(STEPS, { point, normal, depth: 5 }), flat = embedTransform(STEPS, { point, normal }); assert.ok(near(deep.position.map((v, k) => v - flat.position[k]), up.map((v) => 5 * v), 1e-9), 'depth slides along the normal');
  assert.ok(Math.abs(Math.hypot(...deep.rotation) - 1) < 1e-9);
});

test('C2: copies on a vesicle sit on its surface, face outward (or inward), stay apart and are reproducible', () => {
  const surface = midSurface({ kind: 'sphere', radius: 300 }), run = (extra) => embedCopies({ steps: STEPS, surface, count: 40, radius: 25, seed: 3, ...extra });
  const out = run(), again = run(); assert.deepEqual(out, again); assert.ok(out.placed > 20 && out.placed <= 40, `${out.placed} of ${out.requested}`);
  for (const { point, normal } of out.placements) { assert.ok(Math.abs(Math.hypot(...point) - 300) < 1e-6, 'on the surface'); assert.ok(near(normal, point.map((v) => v / 300), 1e-9), 'facing outward'); }
  for (const [i, a] of out.placements.entries()) for (const b of out.placements.slice(i + 1)) assert.ok(Math.hypot(...a.point.map((v, k) => v - b.point[k])) >= 50, 'bounding spheres do not overlap');
  const inward = run({ inward: true }); assert.ok(inward.placements.every(({ point, normal }) => near(normal, point.map((v) => -v / 300), 1e-9)), 'inward: the membrane axis points to the centre');
});

test('C3: a composition is placed without overlaps, membrane components on the membrane, with the counts and the shortfalls reported', () => {
  const region = volumeRegion({ kind: 'sphere', radius: 700 }, { inset: 30 }), membrane = { surface: midSurface({ kind: 'sphere', radius: 700 }) };   // a vesicle 1.4 um across
  const components = [
    { id: 'ribosome', copies: 30, radius: 125, where: 'volume', basis: 'estimated', volume: volumeFromMass(2.5e6) },
    { id: 'enzyme', copies: 300, radius: 25, where: 'volume', basis: 'illustrative' },
    { id: 'channel', copies: 40, radius: 30, where: 'membrane', basis: 'measured' },
    { id: 'too-many', copies: 3000, radius: 120, where: 'volume' },
  ];
  const plan = planComposition({ region, membrane, components, seed: 2 }), again = planComposition({ region, membrane, components, seed: 2 });
  assert.deepEqual(plan, again, 'same inputs, same plan');
  const byId = (id) => plan.report.find((r) => r.id === id);
  assert.equal(byId('ribosome').placed, 30); assert.equal(byId('enzyme').placed, 300); assert.equal(byId('channel').placed, 40); assert.ok(byId('too-many').placed < 3000 && plan.crowded.includes('too-many'), 'what does not fit is said');
  assert.equal(byId('channel').basis, 'measured'); assert.deepEqual(plan.report.map((r) => r.id), components.map((c) => c.id), 'the report keeps the order of the table');
  const radii = new Map(components.map((c) => [c.id, c.radius]));
  for (const [i, a] of plan.placements.entries()) for (const b of plan.placements.slice(i + 1)) assert.ok(Math.hypot(...a.position.map((v, k) => v - b.position[k])) >= radii.get(a.component) + radii.get(b.component) - 1e-9, 'no two bodies overlap');
  assert.ok(plan.placements.filter((p) => p.component === 'channel').every((p) => Math.abs(Math.hypot(...p.position) - 700) < 1e-6), 'channels are on the membrane');
  assert.ok(plan.placements.filter((p) => p.component !== 'channel').every((p) => region.contains(p.position)), 'the rest are inside the region');
  assert.ok(plan.occupancy > 0 && plan.occupancy < 1 && plan.membraneCoverage > 0 && plan.membraneCoverage < 1);
  assert.ok(plan.placements.every(({ transform }) => Math.abs(Math.hypot(...transform.rotation) - 1) < 1e-9), 'every orientation is a unit quaternion');
  assert.throws(() => planComposition({ region, components: [{ id: 'x', copies: 1, radius: 5, where: 'membrane' }] }), /no membrane was given/);
});

test('regions and the mass-to-volume estimate', () => {
  assert.ok(Math.abs(volumeRegion({ kind: 'sphere', radius: 100 }).volume - (4 / 3) * Math.PI * 1e6) < 1e-3); assert.ok(Math.abs(volumeRegion({ kind: 'box', width: 10, height: 20, depth: 30 }).volume - 6000) < 1e-9);
  assert.ok(Math.abs(volumeRegion({ kind: 'capsule', radius: 10, length: 40 }).volume - (Math.PI * 100 * 40 + (4 / 3) * Math.PI * 1000)) < 1e-6); assert.ok(volumeRegion({ kind: 'capsule', radius: 10, length: 40 }).contains([0, 0, 29]) && !volumeRegion({ kind: 'capsule', radius: 10, length: 40 }).contains([0, 0, 31]), 'the capsule reaches z = 20 + 10 = 30');
  assert.ok(volumeRegion({ kind: 'sphere', radius: 100 }, { inset: 20 }).contains([79, 0, 0]) && !volumeRegion({ kind: 'sphere', radius: 100 }, { inset: 20 }).contains([81, 0, 0]));
  assert.throws(() => volumeRegion({ kind: 'sphere', radius: 10 }, { inset: 10 }), /nothing/); assert.throws(() => volumeRegion({ kind: 'cone' }), /unknown region shape/);
  assert.ok(Math.abs(volumeFromMass(100000) - 121000) < 1e-6);
});
