import assert from 'node:assert/strict';
import test from 'node:test';
import { createLegacyLayout, legacyColor, matchesPart } from '../legacy-layout.mjs';

const group = (name, points) => ({ name, part: name, points });
const closeTo = (actual, expected) => {
  assert.ok(actual.every((value, index) => Math.abs(value - expected[index]) < 1e-9),
    `expected ${actual} to match ${expected}`);
};

test('v1 part matching supports named groups and anchored literals', () => {
  assert.ok(matchesPart('Cytochrome f', '/^Cytochrome f$/'));
  assert.ok(!matchesPart('Cytochrome f chain A', '/^Cytochrome f$/'));
  assert.ok(!matchesPart('Cytochrome f', '/(Cytochrome.+)+/'));
  assert.equal(legacyColor({ '/^复合体 III$/': '#e64fc8' }, 'Cytochrome b', '复合体 III'), '#e64fc8');
});

test('v1 ring and helix copies use Angstrom offsets and preserve anchor height', () => {
  const warnings = [];
  const layout = createLegacyLayout([group('anchor', [[0, -1, 0], [0, 1, 0]])], { axis: 'native' }, warnings);
  const rotor = [group('rotor', [[0, 0, 0]])];
  const ring = layout.place(rotor, {
    id: '1ABC', anchor: 'anchor', side: 'above', gap: 10, arrange: { kind: 'ring', n: 4, radius: 40 },
  });
  closeTo(ring[0].position, [2, 1.5, 0]);
  closeTo(ring[1].position, [0, 1.5, 2]);
  const helix = layout.place(rotor, { id: '1ABC', arrange: { kind: 'helix', n: 3, rise: 4, twist: 60 } });
  closeTo(helix[2].position, [0, 0.4, 0]);
  closeTo(helix[2].rotation, [0, -Math.sqrt(3) / 2, 0, 0.5]);
  assert.deepEqual(warnings, []);
});

test('v1 explicit axis aligns named groups and row components clear the primary bounds', () => {
  const layout = createLegacyLayout([
    group('base', [[0, 0, 0], [0, 0, 0]]),
    group('head', [[2, 0, 0], [2, 0, 0]]),
  ], { axisFrom: ['base', 'head'] }, []);
  closeTo(layout.primary.rotation, [0, 0, Math.SQRT1_2, Math.SQRT1_2]);
  const component = layout.place([group('neighbor', [[-1, 0, 0], [1, 0, 0]])], {
    id: '1ABC', axis: 'native', beside: { dir: 'row', gap: 20 },
  });
  assert.ok(Math.hypot(component[0].position[0], component[0].position[2]) >= 2 - 1e-9);
});

test('the v1 broadside camera looks across the static row of structures', () => {
  const layout = createLegacyLayout([
    group('main', [[-8, 0, 0], [8, 0, 0]]),
  ], { axis: 'native', camera: { broadside: true, el: 0, dist: 0.92 } }, []);
  const other = [group('other', [[-2, 0, 0], [2, 0, 0]])];
  layout.include(other, layout.place(other, { id: '1ABC', axis: 'native', beside: { dir: 'row' } }));
  closeTo(layout.camera().direction, [0, 0, 1]);
  assert.equal(layout.camera().distanceScale, 0.92);
});

test('a cell corner puts the channel in the plane of the view, 60 Å above the ribosome and 0.3 radius left of its centre (the classic rule)', () => {
  const scale = 0.05, ribosome = []; for (let i = -5; i <= 5; i++) for (let j = -5; j <= 5; j++) for (let k = -5; k <= 5; k++) if (i * i + j * j + k * k <= 25) ribosome.push([i * 20 * scale, j * 20 * scale, k * 20 * scale]);   // radius 100 Å in metres
  const channel = [group('KcsA', [[8, 8, 8], [9, 8, 8], [8, 9, 8], [8, 8, 9]])];
  const layout = createLegacyLayout([group('ribosome', ribosome)], { axis: 'native', process: 'cellCorner', camera: { az: 0 } }, []);
  const [pose] = layout.place(channel, { id: '1K4C', axis: 'native' });
  const turn = (v, q) => { const t = [q[1] * v[2] - q[2] * v[1], q[2] * v[0] - q[0] * v[2], q[0] * v[1] - q[1] * v[0]].map((x) => 2 * x); return [v[0] + q[3] * t[0] + (q[1] * t[2] - q[2] * t[1]), v[1] + q[3] * t[1] + (q[2] * t[0] - q[0] * t[2]), v[2] + q[3] * t[2] + (q[0] * t[1] - q[1] * t[0])]; };
  const mean = [0, 1, 2].map((i) => channel[0].points.reduce((sum, p) => sum + p[i], 0) / 4), turned = turn(mean, pose.rotation), centre = turned.map((v, i) => v + pose.position[i]);
  const top = Math.max(...ribosome.map((p) => p[1]));
  assert.ok(Math.abs(centre[1] - (top + 60 * scale)) < 1e-9, 'the membrane height: the top of the ribosome plus 60 Å');
  assert.ok(Math.abs(centre[0] + 100 * 0.3 * scale) < 1e-9, 'with the view along -z the plane is z = 0 and left is -x: 0.3 of the radius');
  assert.ok(Math.abs(centre[2]) < 1e-9, 'in the plane through the ribosome centre');
  const second = layout.place(channel, { id: '1K4C', axis: 'native', beside: { dir: 'row', gap: 20 } });
  assert.ok(second[0].position[1] !== pose.position[1] || second[0].position[0] !== pose.position[0], 'only the first component is the channel; later ones use their own rules');
  const plain = createLegacyLayout([group('ribosome', ribosome)], { axis: 'native' }, []).place(channel, { id: '1K4C', axis: 'native' });
  assert.notDeepEqual(plain[0].position, pose.position, 'without the cell corner declaration the generic rule applies');
});
