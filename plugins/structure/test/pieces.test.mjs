import assert from 'node:assert/strict';
import test from 'node:test';
import { parsePdb } from '../parser.mjs';
import { buildPieces, computeInterfaces, partnersOf, interfaceResidues, assemblyOrder, pieceOffset } from '../pieces.mjs';

const line = (rec, serial, name, res, chain, seq, x, y, el) =>
  `${rec.padEnd(6)}${String(serial).padStart(5)} ${name.padEnd(4)} ${res.padStart(3)} ${chain}${String(seq).padStart(4)}    ${x.toFixed(3).padStart(8)}${y.toFixed(3).padStart(8)}${(0).toFixed(3).padStart(8)}  1.00  0.00          ${el.padStart(2)}`;
const chain = (id, seqStart, x0, y, count) => Array.from({ length: count }, (_, i) => line('ATOM', 0, 'CA', 'ALA', id, seqStart + i, x0 + 3.8 * i, y, 'C'));
// A: 5 residues y=0, B: 4 residues y=6 (touching A), C: 3 residues far away, D: 2 residues (too small to be a piece); ligand near B
const PDB = [...chain('A', 1, 0, 0, 5), ...chain('B', 1, 0, 6, 4), ...chain('C', 1, 200, 0, 3), ...chain('D', 1, 400, 0, 2),
  line('HETATM', 99, 'FE', 'HEM', 'E', 1, 3, 10, 'FE'), 'END'].map((l, i) => l.replace(/^(ATOM  |HETATM)(\s*\d+)/, (m, a) => a + String(i + 1).padStart(5))).join('\n');
const model = buildPieces(parsePdb(PDB));
computeInterfaces(model);

test('pieces: chains with at least three residues, biggest first, ligand attached to the nearest piece', () => {
  assert.deepEqual(model.pieces.map((p) => `${p.chain}:${p.residues.length}`), ['A:5', 'B:4', 'C:3']);
  assert.deepEqual(model.pieces.map((p) => p.ligands.length), [0, 1, 0]);
});

test('interfaces count residues of each side separately, and only between touching chains', () => {
  const [a, b, c] = model.pieces;
  assert.ok(a.partners.get(b.index).n > 0 && b.partners.get(a.index).n > 0);
  assert.equal(a.partners.has(c.index), false);
  assert.deepEqual(partnersOf(model, a).map(({ piece }) => piece.chain), ['B']);
  assert.deepEqual(partnersOf(model, c), []);
  const footprint = interfaceResidues(a, b);
  assert.ok(footprint.length > 0 && footprint.every((r) => r.chain === 'A'));
});

test('greedy assembly order starts with the biggest piece and follows the largest interface', () => {
  const { order, estimated } = assemblyOrder(model);
  assert.equal(estimated, true);
  assert.deepEqual(order.map((p) => p.chain), ['A', 'B', 'C']);
  const preset = assemblyOrder(model, { keywords: ['C', 'A'], match: (piece, key) => piece.chain === key });
  assert.equal(preset.estimated, false);
  assert.deepEqual(preset.order.map((p) => p.chain), ['C', 'A', 'B']);
});

test('offsets: zero when assembled (exact restore), growing with explode, further when pulled', () => {
  for (const piece of model.pieces) assert.deepEqual(pieceOffset(model, piece, 0, 0), [0, 0, 0]);
  const [a] = model.pieces;
  const half = Math.hypot(...pieceOffset(model, a, 0.5)), full = Math.hypot(...pieceOffset(model, a, 1));
  assert.ok(full > half && half > 0);
  assert.ok(Math.hypot(...pieceOffset(model, a, 1, 1)) > full);
});
