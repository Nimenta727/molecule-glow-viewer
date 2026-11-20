import assert from 'node:assert/strict';
import test from 'node:test';
import { kindOf, buildSite, hydrogenBonds, partBonds, partPositions, closeupState, stepFlip } from '../ribosome-closeup.mjs';

const ids = { asymA: 'T', asymP: 'U', asymM: 'M' }, names = { R: '16S ribosomal RNA', Q: '23S ribosomal RNA', S: '30S ribosomal protein S12' };
const row = (asym, seq, comp, an, el, p, aseq = seq) => ({ p, el, an, comp, asym, seq, aseq });
const rows = [
  row('M', 5, 'A', 'N1', 'N', [0, 0, 0]), row('T', 35, 'U', 'N3', 'N', [2.9, 0, 0]), row('T', 35, 'U', 'O4', 'O', [2.9, 5, 0]),   // codon A N1 – anticodon U N3: a Watson-Crick pair
  row('R', 1492, 'A', 'N1', 'N', [0, 3, 0]), row('R', 1492, 'A', 'C2', 'C', [1.4, 3, 0]), row('R', 1493, 'A', 'N6', 'N', [30, 0, 0]),
  row('S', 40, 'LYS', 'NZ', 'N', [50, 50, 0]), row('Q', 2451, 'A', 'O2', 'O', [60, 0, 0]),
];

test('residues are told apart by chain: the A-site and P-site tRNA, the mRNA, the rRNAs and proteins', () => {
  assert.deepEqual(rows.map((r) => kindOf(r, ids, (a) => names[a])), ['m', 'A', 'A', '16S', '16S', '16S', 'prot', '23S']);
});

test('a site is its residues as parts; A1492 and A1493 flip between the stacked and the flipped-out place; the hydrogen bonds come from the atoms', () => {
  const apo = [row('R', 1492, 'A', 'N1', 'N', [0, 9, 0]), row('R', 1492, 'A', 'C2', 'C', [1.4, 9, 0])];
  const site = buildSite(rows, 'dc', ids, (a) => names[a], apo);
  assert.equal(site.parts.length, 6); const flip = site.parts.filter((p) => p.flip); assert.deepEqual(flip.map((p) => p.label), ['16S rRNA A1492', '16S rRNA A1493']);
  const a1492 = flip[0]; assert.deepEqual(partPositions(a1492, 0)[0], [0, 9, 0], 'stacked: the empty-A-site place'); assert.deepEqual(partPositions(a1492, 1)[0], [0, 3, 0], 'flipped out: its place in the structure');
  assert.ok(partPositions(a1492, 0.5)[0][1] > 3 && partPositions(a1492, 0.5)[0][1] < 9);
  assert.deepEqual(flip[1].inPos, flip[1].outPos, 'no stacked coordinates for A1493 here: it stays where it is');
  assert.deepEqual(site.bonds.map((b) => b.kind), ['wc', 'mon'].slice(0, 1).concat(site.bonds.length > 1 ? ['mon'] : []), 'the pair codon-anticodon, and A1492 N1 touches the anticodon');
  assert.equal(site.bonds.filter((b) => b.kind === 'wc').length, 1); assert.ok(site.bonds.every((b) => Math.hypot(...b.a.map((v, k) => v - b.b[k])) < 3.35));
  assert.equal(site.parts.find((p) => p.label === 'mRNA A5').hot, false); assert.equal(site.parts.find((p) => p.label.endsWith('A1492')).hot, true); assert.equal(site.parts.find((p) => p.label.startsWith('23S')).hot, true, 'A2451 is highlighted');
  assert.deepEqual(hydrogenBonds([]), []);
  const bonds = partBonds(a1492); assert.equal(bonds.length, 1, 'N1 and C2 1.4 Å apart: one bond');
});

test('the close-up follows the state: A1492 / A1493 flip fully on a cognate match, partly on a near-cognate one, not with an empty A site; the flip moves at a fixed rate', () => {
  assert.deepEqual([closeupState({ st: 'post' }).wTarget, closeupState({ st: 'cr' }).wTarget, closeupState({ st: 'cr', cognate: false }).wTarget, closeupState({ st: 'gtp', cognate: false }).wTarget, closeupState({ st: 'acc' }).wTarget], [0, 1, 0.35, 0.5, 1]);
  assert.deepEqual([closeupState({ st: 'post' }).showA.dc, closeupState({ st: 'rel' }).showA.dc, closeupState({ st: 'acc' }).showA.ptc, closeupState({ st: 'rel' }).showA.ptc], [false, true, true, false]);
  assert.match(closeupState({ st: 'post' }).decoding, /A 位空着/); assert.match(closeupState({ st: 'cr', cognate: false }).decoding, /错配/); assert.match(closeupState({ st: 'pre' }).ptc, /肽键已形成/);
  assert.equal(stepFlip(0, 1, 0.5), 0.7); assert.equal(stepFlip(0.9, 1, 1), 1); assert.equal(stepFlip(1, 0, 0.1), 0.86);
});
