import assert from 'node:assert/strict';
import test from 'node:test';
import { interactionsBetween, InteractionError, CUTOFFS } from '../interactions.mjs';

let serial = 1;
const atom = (chain, seq, residueName, name, element, position) => ({ record: 'ATOM', serial: serial++, element, name, residueName, authChainId: chain, labelChainId: chain, authSeqId: String(seq), labelSeqId: String(seq), insertionCode: '', altLoc: '', modelId: '1', position });
// chain A: ASP 1 (carboxylate O at 0,0,0), SER 2 (OG at 20,0,0), LEU 3 (CD1 at 40,0,0), GLY 4 (N at 60,0,0), VAL 5 (CG1 at 80,0,0)
// chain B: LYS 1 (NZ 3.0 Å from the Asp O → salt), ASN 2 (OD1 2.8 Å from the Ser OG → hbond), ILE 3 (CD1 3.8 Å from the Leu CD1 → hydrophobic), PRO 4 (N 2.9 Å from Gly N: donor–donor → none), SER 5 (OG 2.0 Å from VAL CG1: too close for a pair of N/O, and not a pair of kinds → none)
const model = () => ({ format: 'pdb', atoms: [
  atom('A', 1, 'ASP', 'CA', 'C', [0, 1.5, 0]), atom('A', 1, 'ASP', 'OD1', 'O', [0, 0, 0]), atom('A', 2, 'SER', 'CA', 'C', [20, 1.5, 0]), atom('A', 2, 'SER', 'OG', 'O', [20, 0, 0]),
  atom('A', 3, 'LEU', 'CA', 'C', [40, 1.5, 0]), atom('A', 3, 'LEU', 'CD1', 'C', [40, 0, 0]), atom('A', 4, 'GLY', 'CA', 'C', [60, -1.5, 0]), atom('A', 4, 'GLY', 'N', 'N', [60, 0, 0]), atom('A', 5, 'VAL', 'CA', 'C', [80, -1.5, 0]), atom('A', 5, 'VAL', 'CG1', 'C', [80, 0, 0]),
  atom('B', 1, 'LYS', 'CA', 'C', [3, 1.5, 0]), atom('B', 1, 'LYS', 'NZ', 'N', [3, 0, 0]), atom('B', 2, 'ASN', 'CA', 'C', [20, 4, 0]), atom('B', 2, 'ASN', 'OD1', 'O', [20, 2.8, 0]),
  atom('B', 3, 'ILE', 'CA', 'C', [40, 5, 0]), atom('B', 3, 'ILE', 'CD1', 'C', [40, 3.8, 0]), atom('B', 4, 'PRO', 'CA', 'C', [60, 6, 0]), atom('B', 4, 'PRO', 'N', 'N', [60, 2.9, 0]), atom('B', 5, 'SER', 'CA', 'C', [80, 6, 0]), atom('B', 5, 'SER', 'OG', 'O', [80, 2.0, 0]) ] });

test('a salt bridge, a hydrogen bond and a hydrophobic contact are told apart; donor–donor and wrong-kind close pairs are not interactions', () => {
  const out = interactionsBetween(model(), 'chain A', 'chain B');
  assert.deepEqual(out.counts, { salt: 1, hbond: 1, hydrophobic: 1 });
  assert.deepEqual(out.interactions.map((i) => [i.type, `${i.a.resn}${i.a.authSeq}.${i.atomA}`, `${i.b.resn}${i.b.authSeq}.${i.atomB}`, i.distance.toFixed(1)]), [['salt', 'ASP1.OD1', 'LYS1.NZ', '3.0'], ['hbond', 'SER2.OG', 'ASN2.OD1', '2.8'], ['hydrophobic', 'LEU3.CD1', 'ILE3.CD1', '3.8']]);
  assert.deepEqual([out.sizeA, out.sizeB], [5, 5]);
});

test('residues next to each other in one chain are skipped, shared residues never pair, cut-offs are the documented ones, and bad input says why', () => {
  const m = model(); m.atoms.push(atom('A', 6, 'LYS', 'CA', 'C', [0, 0, 6]), atom('A', 6, 'LYS', 'NZ', 'N', [0, 0, 3.0])); // next to nothing in A; pairs with Asp O of A itself only when parts overlap
  const same = interactionsBetween(m, 'chain A and resi 1', 'chain A and resi 6'); assert.equal(same.counts.salt, 1, 'two residues of one chain that are not neighbours can interact');
  const pair = (seq) => ({ format: 'pdb', atoms: [atom('A', 1, 'GLY', 'CA', 'C', [0, 5, 0]), atom('A', 1, 'GLY', 'O', 'O', [0, -3.0, 0]), atom('A', seq, 'SER', 'CA', 'C', [0, -9, 0]), atom('A', seq, 'SER', 'N', 'N', [0, -6.0, 0])] });
  assert.equal(interactionsBetween(pair(2), 'chain A and resi 1', 'chain A and resi 2').counts.hbond, 0, 'sequence neighbours are skipped');
  assert.equal(interactionsBetween(pair(5), 'chain A and resi 1', 'chain A and resi 5').counts.hbond, 1, 'the same atoms three residues apart do bond: only the neighbour rule hid them');
  assert.equal(interactionsBetween(model(), 'chain A', 'chain A').interactions.length, 0, 'a residue is never paired with itself');
  assert.deepEqual([CUTOFFS.hbond, CUTOFFS.salt, CUTOFFS.hydrophobic], [3.5, 4, 4]);
  assert.throws(() => interactionsBetween(model(), 'resi 99', 'chain B'), (e) => e instanceof InteractionError && /A 部分.*没有选中/.test(e.message)); assert.throws(() => interactionsBetween(model(), 'chain A', 'banana'), /B 部分：/);
});

test('within: true finds the hydrogen bonds inside one part once each, and the default still keeps shared residues out', () => {
  // inside chain C: a backbone N (residue 1) and a backbone O (residue 4) 2.9 A apart — a helix-like hydrogen bond between residues that are not neighbours
  const m = { format: 'pdb', atoms: [
    atom('C', 1, 'ALA', 'N', 'N', [0, 0, 0]), atom('C', 1, 'ALA', 'CA', 'C', [1.4, 0.5, 0]), atom('C', 2, 'ALA', 'CA', 'C', [8, 3, 0]), atom('C', 3, 'ALA', 'CA', 'C', [16, 3, 0]),
    atom('C', 4, 'ALA', 'O', 'O', [2.9, 0, 0]), atom('C', 4, 'ALA', 'CA', 'C', [3.5, 4, 0]),
  ] };
  const inside = interactionsBetween(m, 'chain C', 'chain C', { within: true });
  assert.equal(inside.counts.hbond, 1, 'one hydrogen bond, reported once');
  assert.equal(interactionsBetween(m, 'chain C and resi 1', 'chain C and resi 1-4').counts.hbond, 0, 'without within the shared residues are skipped, as before');
});
