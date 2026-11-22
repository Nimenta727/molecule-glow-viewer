import assert from 'node:assert/strict';
import test from 'node:test';
import { contactsBetween, expressionsFor, ContactError, residueName } from '../contacts.mjs';
import { selectionSpace, evaluateSelection } from '../selection.mjs';

// chain A: residues 1-3 along x (each with CA and a side atom 1 Å up); chain B: residues 1-3 placed 4 Å above chain A's, but residue 3 of B is far away
let serial = 1;
const atoms = (chain, seq, x, y, far = false) => [['CA', 'C', 0], ['CB', 'C', 1]].map(([name, element, dy]) => ({ record: 'ATOM', serial: serial++, element, name, residueName: 'ALA', authChainId: chain, labelChainId: chain, authSeqId: String(seq), labelSeqId: String(seq), insertionCode: '', altLoc: '', modelId: '1', position: [x, y + dy + (far ? 100 : 0), 0] }));
const model = () => ({ format: 'pdb', atoms: [1, 2, 3].flatMap((s) => atoms('A', s, s * 6, 0)).concat([1, 2, 3].flatMap((s) => atoms('B', s, s * 6, 4.0 - 1, s === 3))) });

test('residues of two parts within the cutoff are paired, nearest first, with the closest atoms named; far residues are not', () => {
  const out = contactsBetween(model(), 'chain A', 'chain B');
  assert.equal(out.pairs.length, 2, 'A1–B1 and A2–B2 only (B3 is 100 Å away; neighbours are 6 Å apart in x)');
  assert.deepEqual(out.pairs.map((p) => [residueName(p.a), residueName(p.b)]), [['ALA A:1', 'ALA B:1'], ['ALA A:2', 'ALA B:2']]);
  assert.equal(out.pairs[0].distance.toFixed(2), '2.00', 'the nearest heavy atoms are A:CB and B:CA'); assert.deepEqual([out.pairs[0].atomA, out.pairs[0].atomB], ['CB', 'CA']);
  assert.deepEqual([out.residuesA.length, out.residuesB.length, out.sizeA, out.sizeB], [2, 2, 3, 3]);
  assert.equal(contactsBetween(model(), 'chain A', 'chain B', { cutoff: 1 }).pairs.length, 0, 'nothing within 1 Å');
});

test('a residue in both parts is never paired with itself; bad input says what is wrong', () => {
  const out = contactsBetween(model(), 'chain A or chain B', 'chain B'); assert.equal(out.pairs.length, 0, 'residues of B are in both parts');
  assert.throws(() => contactsBetween(model(), 'resi 99', 'chain B'), (e) => e instanceof ContactError && /A 部分.*没有选中/.test(e.message));
  assert.throws(() => contactsBetween(model(), 'banana', 'chain B'), /A 部分：/); assert.throws(() => contactsBetween(model(), 'chain A', 'chain B', { cutoff: 9 }), /0–8/); assert.throws(() => contactsBetween(model(), 'chain A', 'chain B', { cutoff: 0 }), ContactError);
});

test('residues are written back as short selection expressions that pick exactly them', () => {
  const m = model(), space = selectionSpace(m), all = evaluateSelection('chain A or chain B', space).residues;
  const picked = all.filter((r) => !(r.chain === 'A' && r.authSeq === 2) && !(r.chain === 'B' && r.authSeq === 1));
  const expressions = expressionsFor(picked); assert.deepEqual(expressions, ['chain A and resi 1,3', 'chain B and resi 2-3']);
  const back = expressions.flatMap((e) => evaluateSelection(e, space).residues); assert.equal(back.length, picked.length);
  const many = Array.from({ length: 300 }, (_, i) => ({ chain: 'A', authSeq: i * 2, insertion: '' })); const split = expressionsFor(many); assert.ok(split.length > 1 && split.every((e) => e.length <= 380), 'long lists are split');
  assert.deepEqual(expressionsFor([{ chain: 'A', authSeq: 52, insertion: 'A' }, { chain: 'A', authSeq: 53, insertion: '' }]), ['chain A and resi 52A,53']);
});
