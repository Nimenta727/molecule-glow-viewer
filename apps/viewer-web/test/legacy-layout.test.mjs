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
