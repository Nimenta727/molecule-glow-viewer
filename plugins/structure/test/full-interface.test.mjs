import assert from 'node:assert/strict';
import test from 'node:test';
import { parsePdb } from '../parser.mjs';
import { buildPieces, computeInterfaces, partnersOf } from '../pieces.mjs';
import { chainAtoms, classifyContacts, fullInterface, hasSideChains } from '../full-interface.mjs';

const atom = (name, resn, seq, position, element = name[0]) => ({ name, resn, labelSeq: seq, authSeq: String(seq), insertion: '', element, position });

test('hydrogen bond, salt bridge, disulfide, hydrophobic and clash are told apart', () => {
  const mine = [
    atom('NZ', 'LYS', 1, [0, 0, 0]), atom('N', 'GLY', 2, [20, 0, 0]), atom('SG', 'CYS', 3, [40, 0, 0]),
    atom('CG', 'LEU', 4, [60, 0, 0]), atom('O', 'GLY', 5, [80, 0, 0]),
  ];
  const other = [
    atom('OD1', 'ASP', 11, [3, 0, 0]), atom('O', 'GLY', 12, [22.9, 0, 0]), atom('SG', 'CYS', 13, [42, 0, 0]),
    atom('CD1', 'ILE', 14, [63, 0, 0]), atom('N', 'GLY', 15, [81.5, 0, 0]),
  ];
  const r = classifyContacts(mine, other);
  assert.deepEqual([r.salt.length, r.hbond.length, r.ss.length, r.hydro.length, r.clash.size], [1, 1, 1, 1, 1]);
  assert.equal(r.salt[0].a.resn, 'LYS');
  assert.ok(Math.abs(r.hbond[0].d - 2.9) < 1e-9 && r.hbond[0].a.labelSeq === 2);
});

test('a salt bridge is counted once, not also as an H-bond', () => {
  const r = classifyContacts([atom('NZ', 'LYS', 1, [0, 0, 0])], [atom('OD1', 'ASP', 2, [2.8, 0, 0])]);
  assert.equal(r.salt.length, 1);
  assert.equal(r.hbond.length, 0);
});

test('backbone-only contacts are not hydrophobic, distant atoms are ignored', () => {
  const r = classifyContacts([atom('CA', 'LEU', 1, [0, 0, 0]), atom('CB', 'LEU', 2, [30, 0, 0])], [atom('CA', 'ILE', 3, [3.5, 0, 0]), atom('CB', 'ILE', 4, [36, 0, 0])]);
  assert.equal(r.hydro.length, 0);
});

test('a Cα-only chain cannot be classified, and says so', () => {
  const line = (serial, name, seq, x) => `ATOM  ${String(serial).padStart(5)} ${name.padEnd(4)} ALA ${'A'}${String(seq).padStart(4)}    ${x.toFixed(3).padStart(8)}${(0).toFixed(3).padStart(8)}${(0).toFixed(3).padStart(8)}  1.00  0.00           C`;
  const text = [1, 2, 3].map((n) => line(n, 'CA', n, n * 3.8)).join('\n') + '\n' + [4, 5, 6].map((n) => line(n, 'CA', n, 20 + n * 3.8).replace(' A ', ' B ')).join('\n') + '\nEND';
  const model = parsePdb(text), built = buildPieces(model);
  computeInterfaces(built);
  assert.equal(hasSideChains([...chainAtoms(model).values()][0]), false);
  const result = fullInterface(model, built.pieces[0], [built.pieces[1]]);
  assert.match(result.unavailable, /侧链/);
});
