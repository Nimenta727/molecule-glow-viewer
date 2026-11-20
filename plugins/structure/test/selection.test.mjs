import assert from 'node:assert/strict';
import test from 'node:test';
import { parsePdb } from '../parser.mjs';
import { parseSelection, selectionSpace, evaluateSelection, describeSelection, SelectionError } from '../selection.mjs';

const line = (rec, serial, name, res, chain, seq, ins, x, el) =>
  `${rec.padEnd(6)}${String(serial).padStart(5)} ${name.padEnd(4)} ${res.padStart(3)} ${chain}${String(seq).padStart(4)}${ins}   ${x.toFixed(3).padStart(8)}${(0).toFixed(3).padStart(8)}${(0).toFixed(3).padStart(8)}  1.00  0.00          ${el.padStart(2)}`;
const PDB = [
  line('ATOM', 1, 'CA', 'HIS', 'A', 10, ' ', 0, 'C'), line('ATOM', 2, 'CA', 'CYS', 'A', 11, ' ', 3.8, 'C'),
  line('ATOM', 3, 'CA', 'GLY', 'A', 52, ' ', 7.6, 'C'), line('ATOM', 4, 'CA', 'GLY', 'A', 52, 'A', 11.4, 'C'),
  line('ATOM', 5, 'CA', 'ALA', 'B', 1, ' ', 50, 'C'), line('ATOM', 6, 'P', '  A', 'C', 1, ' ', 100, 'P'),
  line('HETATM', 7, 'FE', 'HEM', 'A', 200, ' ', 1, 'FE'), line('HETATM', 8, 'O', 'HOH', 'A', 300, ' ', 2, 'O'), 'END',
].join('\n');
const space = selectionSpace(parsePdb(PDB));
const pick = (e, previous) => evaluateSelection(e, space, { previous });

test('residues and ligands are enumerated, water excluded', () => {
  assert.equal(space.residues.length, 6);
  assert.deepEqual(space.ligands.map((x) => x.comp), ['HEM']);
});

test('basic selectors', () => {
  assert.equal(pick('all').residues.length, 6);
  assert.equal(pick('none').residues.length, 0);
  assert.equal(pick('nucleic').residues.length, 1);
  assert.equal(pick('protein').residues.length, 5);
  assert.equal(pick('chain A').residues.length, 4);
  assert.equal(pick('chain A,B').residues.length, 5);
  assert.equal(pick('resn HIS,cys').residues.length, 2);
  assert.equal(pick('ligand hem').ligands.length, 1);
  assert.equal(pick('ligands').residues.length, 0);
});

test('resi ranges honour insertion codes', () => {
  assert.equal(pick('resi 10-11').residues.length, 2);
  assert.equal(pick('resi 52').residues.length, 1);
  assert.equal(pick('resi 52A').residues.length, 1);
  assert.equal(pick('resi 50-52').residues.length, 2);
  assert.equal(pick('resi 52A-60').residues.length, 1);
});

test('boolean logic, parentheses, sele and within', () => {
  assert.equal(pick('chain A and not resn GLY').residues.length, 2);
  assert.equal(pick('(resn HIS or resn CYS) and chain A').residues.length, 2);
  const first = pick('resi 10');
  assert.equal(pick('sele or resi 11', first).residues.length, 2);
  assert.equal(pick('sele', undefined).residues.length, 0);
  const near = pick('within 5 of resi 10');
  assert.deepEqual(near.residues.map((r) => r.authSeq), [11]);
  assert.equal(near.ligands.length, 1);
  assert.equal(pick('within 5 of none').residues.length, 0);
});

test('errors are Chinese and specific', () => {
  for (const bad of ['', 'foo', 'chain', '(chain A', 'chain A )', 'within x of all', 'within 5 all', 'resi ab']) {
    assert.throws(() => parseSelection(bad), SelectionError, bad);
  }
  assert.match(describeSelection(pick('chain A')), /4 个残基/);
  assert.equal(describeSelection(pick('none')), '没有选中任何对象');
});
