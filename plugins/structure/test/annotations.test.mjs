import assert from 'node:assert/strict';
import test from 'node:test';
import { validateMeasures, validateLabels, computeAnnotations, AnnotationError } from '../annotations.mjs';

// chain A: five residues on a line, 10 Å apart, then a bend: residue 5 is 10 Å up from residue 4
const model = () => ({ format: 'pdb', atoms: [[0, 0, 0], [10, 0, 0], [20, 0, 0], [30, 0, 0], [30, 10, 0]].map((position, i) => ({ record: 'ATOM', serial: i + 1, element: 'C', name: 'CA', residueName: ['ALA', 'GLY', 'SER', 'LEU', 'VAL'][i],
  authChainId: 'A', labelChainId: 'A', authSeqId: String(i + 1), labelSeqId: String(i + 1), insertionCode: '', altLoc: '', modelId: '1', position })) });

test('a distance and an angle are computed from selections, drawn as segments, and valued at the middle of the first', () => {
  const out = computeAnnotations(model(), { measures: [{ points: ['resi 1', 'resi 4'] }, { points: ['resi 3', 'resi 4', 'resi 5'] }] });
  assert.deepEqual(out.problems, []); assert.equal(out.lines.length, 3, 'one segment for the distance, two for the angle');
  assert.deepEqual(out.texts.map((t) => [t.kind, t.text]), [['measure', '30.00 Å'], ['measure', '90.0°']]);
  assert.deepEqual(out.texts[0].position, [15, 0, 0], 'the value sits between the two residues'); assert.deepEqual(out.lines[0], { a: [0, 0, 0], b: [30, 0, 0] });
});

test('a label sits at the centre of the part it names: a residue by its name, several by their count, with the author’s own text when given', () => {
  const out = computeAnnotations(model(), { labels: [{ expr: 'resi 2' }, { expr: 'resi 1-3', text: '前三个' }, { expr: 'resi 1-5' }] });
  assert.deepEqual(out.texts.map((t) => t.text), ['GLY A:2', '前三个', '5 个部分']); assert.deepEqual(out.texts[0].position, [10, 0, 0]); assert.deepEqual(out.texts[1].position, [10, 0, 0]); assert.deepEqual(out.texts[2].position, [18, 2, 0]);
});

test('what cannot be drawn is reported with its place and the reason, and never guessed; the rest still draws', () => {
  const out = computeAnnotations(model(), { measures: [{ points: ['resi 1-2', 'resi 4'] }, { points: ['resi 1', 'resi 4'] }], labels: [{ expr: 'resi 99' }, { expr: 'banana' }, { expr: 'resi 5' }] });
  assert.deepEqual(out.problems.map((p) => [p.kind, p.index]), [['measure', 0], ['label', 0], ['label', 1]]); assert.match(out.problems[0].message, /选中了 2 个/); assert.match(out.problems[1].message, /没有选中任何东西/); assert.match(out.problems[2].message, /不认识/);
  assert.deepEqual(out.texts.map((t) => t.text), ['30.00 Å', 'VAL A:5'], 'the valid measurement and label are still there');
  assert.deepEqual(computeAnnotations(null, { labels: [{ expr: 'all' }] }), { lines: [], texts: [], problems: [] }); assert.deepEqual(computeAnnotations(model()), { lines: [], texts: [], problems: [] });
});

test('measurements and labels are validated: shape, length, counts', () => {
  assert.deepEqual(validateMeasures([{ points: [' resi 1 ', 'resi 2'] }]), [{ points: ['resi 1', 'resi 2'] }]); assert.deepEqual(validateMeasures(undefined), []);
  for (const bad of [[{ points: ['a'] }], [{ points: ['a', 'b', 'c', 'd'] }], [{ points: ['a', ''] }], [{}], 'x', Array.from({ length: 25 }, () => ({ points: ['a', 'b'] }))]) assert.throws(() => validateMeasures(bad), AnnotationError);
  assert.deepEqual(validateLabels([{ expr: 'resi 1' }, { expr: 'chain A', text: '  链 A ' }]), [{ expr: 'resi 1' }, { expr: 'chain A', text: '链 A' }]);
  for (const bad of [[{ expr: '' }], [{ expr: 'a', text: 'x'.repeat(61) }], [null], 'x', Array.from({ length: 49 }, () => ({ expr: 'a' }))]) assert.throws(() => validateLabels(bad), AnnotationError);
});

import { validateBonds } from '../annotations.mjs';
test('typed bonds between two named atoms are drawn as coloured lines with the distance on pointing; wrong residue counts, atoms or types are reported', () => {
  const m = model(), bond = (a, b, type = 'hbond') => ({ a: { expr: a, atom: 'CA' }, b: { expr: b, atom: 'CA' }, type });
  const out = computeAnnotations(m, { bonds: [bond('resi 1', 'resi 2'), bond('resi 1', 'resi 2', 'salt'), bond('resi 1-2', 'resi 3'), { a: { expr: 'resi 1', atom: 'XX' }, b: { expr: 'resi 2', atom: 'CA' }, type: 'hbond' }] });
  assert.deepEqual(out.lines.map((l) => [l.a, l.b, l.color, l.kind]), [[[0, 0, 0], [10, 0, 0], '#2f9bff', 'bond'], [[0, 0, 0], [10, 0, 0], '#ff4fa3', 'bond']]);
  assert.deepEqual(out.texts.map((t) => [t.text, t.quiet]), [['氢键 10.00 Å', true], ['盐桥 10.00 Å', true]]);
  assert.deepEqual(out.problems.map((p) => [p.kind, p.index]), [['bond', 2], ['bond', 3]]); assert.match(out.problems[0].message, /应正好选中一个残基/); assert.match(out.problems[1].message, /没有原子 XX/);
  assert.deepEqual(validateBonds([bond('resi 1', 'resi 2')]), [bond('resi 1', 'resi 2')]); assert.deepEqual(validateBonds(undefined), []);
  for (const bad of [[{ ...bond('a', 'b'), type: 'magic' }], [{ a: { expr: 'a', atom: '' }, b: { expr: 'b', atom: 'CA' }, type: 'hbond' }], [{ a: { expr: '', atom: 'CA' }, b: { expr: 'b', atom: 'CA' }, type: 'hbond' }], 'x', Array.from({ length: 201 }, () => bond('a', 'b'))]) assert.throws(() => validateBonds(bad), AnnotationError);
});
