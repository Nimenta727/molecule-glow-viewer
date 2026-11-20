import assert from 'node:assert/strict';
import test from 'node:test';
import { parsePdb } from '../parser.mjs';
import { selectionSpace, evaluateSelection } from '../selection.mjs';
import { sequenceRows, rangeExpression, selectedCells } from '../sequence.mjs';

const line = (rec, serial, name, res, chain, seq, x, el) =>
  `${rec.padEnd(6)}${String(serial).padStart(5)} ${name.padEnd(4)} ${res.padStart(3)} ${chain}${String(seq).padStart(4)}    ${x.toFixed(3).padStart(8)}${(0).toFixed(3).padStart(8)}${(0).toFixed(3).padStart(8)}  1.00  0.00          ${el.padStart(2)}`;
const PDB = [
  line('ATOM', 1, 'CA', 'MET', 'A', 1, 0, 'C'), line('ATOM', 2, 'CA', 'LYS', 'A', 2, 3.8, 'C'),
  line('ATOM', 3, 'CA', 'GLY', 'A', 6, 7.6, 'C'), line('ATOM', 4, 'CA', 'ALA', 'A', 7, 11.4, 'C'),
  line('ATOM', 5, 'CA', 'SER', 'B', 1, 40, 'C'), line('ATOM', 6, 'CA', 'XYZ', 'B', 2, 43, 'C'), 'END',
].join('\n');
const model = parsePdb(PDB);

test('rows follow chains, with one-letter codes and gaps for missing residues', () => {
  const { rows, hidden } = sequenceRows(model);
  assert.equal(hidden, 0);
  assert.deepEqual(rows.map((r) => r.chain), ['A', 'B']);
  assert.equal(rows[0].cells.map((c) => c.code).join(''), 'MKGA');
  assert.equal(rows[1].cells.map((c) => c.code).join(''), 'SX');
  assert.deepEqual(rows[0].cells[2].gapBefore, { count: 3, from: 3, to: 5 });
  assert.equal(rows[0].cells[1].gapBefore, null);
});

test('rows are capped and the remainder is counted', () => {
  assert.equal(sequenceRows(model, { maxRows: 1 }).hidden, 1);
});

test('a drag maps to an exact expression and back to the same cells', () => {
  const { rows } = sequenceRows(model);
  const expression = rangeExpression(rows[0], 3, 1);
  assert.equal(expression, 'asym A and label_seq 2-7');
  const result = evaluateSelection(expression, selectionSpace(model));
  const flags = selectedCells(rows, result);
  assert.deepEqual(flags[0], [false, true, true, true]);
  assert.deepEqual(flags[1], [false, false]);
});
