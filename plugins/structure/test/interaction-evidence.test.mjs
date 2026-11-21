import assert from 'node:assert/strict';
import test from 'node:test';
import { parsePdb } from '../parser.mjs';
import { interfaceBetween, pairEvidence, interactionsOfComplex, degrees, EVIDENCE_LEVELS } from '../interaction-evidence.mjs';
import { complexFromStructure } from '../../../packages/schema/complex.mjs';

function line(serial, chain, seq, [x, y, z], name = 'CA', resn = 'GLY') {
  const c = Array(80).fill(' '), put = (s, t) => { for (let i = 0; i < t.length; i++) c[s + i] = t[i]; };
  put(0, 'ATOM'); put(6, String(serial).padStart(5)); put(12, name.padStart(name.length === 1 ? 2 : 3).padEnd(4)); put(17, resn.padEnd(3)); c[21] = chain; put(22, String(seq).padStart(4));
  put(30, x.toFixed(3).padStart(8)); put(38, y.toFixed(3).padStart(8)); put(46, z.toFixed(3).padStart(8)); put(54, '  1.00'); put(60, ' 10.00'); c[77] = 'C';
  return c.join('');
}
const chain = (id, atoms) => atoms.map((p, i) => line(0, id, i + 1, p));
// chain A: a row of 20 atoms 3 A apart along x; chain B: the same row 4 A above it; chain C: 30 A above (far)
const row = (y, n = 20) => Array.from({ length: n }, (_, i) => [i * 3, y, 0]);
const model = parsePdb([...chain('A', row(0)), ...chain('B', row(4)), ...chain('C', row(30))].map((l, i) => l.slice(0, 6) + String(i + 1).padStart(5) + l.slice(11)).join('\n') + '\n');
const RES = { id: 'res.test.one', version: 'aaaaaaaa', sha256: 'a'.repeat(64) };

test('the interface of two chains: atom pairs within the cutoff and the residues on both sides', () => {
  const near = interfaceBetween({ modelA: model, chainsA: ['A'], modelB: model, chainsB: ['B'] });
  assert.equal(near.minDistance, 4); assert.equal(near.residuesA.length, 20); assert.equal(near.residuesB.length, 20); assert.ok(near.contacts >= 20, `${near.contacts} pairs`);
  assert.equal(interfaceBetween({ modelA: model, chainsA: ['A'], modelB: model, chainsB: ['C'] }).contacts, 0, '30 A apart: nothing');
  assert.ok(interfaceBetween({ modelA: model, chainsA: ['A'], modelB: model, chainsB: ['B'], cutoff: 3.9 }).contacts === 0, 'a tighter cutoff finds nothing at 4 A');
  assert.deepEqual(near.residuesA[0].split(' ')[1], 'GLY');
});

test('a transform moves one side: moving chain C next to chain A makes it an interface', () => {
  const moved = { position: [0, -26, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] };   // C goes from y = 30 to y = 4
  const out = interfaceBetween({ modelA: model, chainsA: ['A'], modelB: model, chainsB: ['C'], transformB: moved }); assert.equal(out.minDistance, 4); assert.ok(out.contacts >= 20);
});

test('the evidence of a pair is the weaker of its two sides, with the reasons', () => {
  const cx = complexFromStructure({ model, resource: RES, id: 'cx.t', title: 't', citation: 'entry' });
  const [a, b] = cx.members, pa = a.placements[0], pb = b.placements[0];
  assert.equal(pairEvidence(cx, pa, pb, { memberA: a, memberB: b }).level, 'experimental');
  cx.evidence.push({ type: 'derived', citation: '叠合 X，RMSD 0.5 Å', resource: RES }); const derived = { ...pb, evidence: cx.evidence.length - 1 };
  const r = pairEvidence(cx, pa, derived, { memberA: a, memberB: b }); assert.equal(r.level, 'derived'); assert.match(r.reasons[0], /位置是推导的：叠合 X/);
  cx.evidence.push({ type: 'illustrative', citation: '示意' }); assert.equal(pairEvidence(cx, { ...pa, evidence: cx.evidence.length - 1 }, derived, { memberA: a, memberB: b }).level, 'illustrative', 'the weakest side decides');
  const kinds = new Map([[`${RES.id}@${RES.version}`, 'predicted-structure']]); assert.equal(pairEvidence(cx, pa, pb, { memberA: a, memberB: b, kinds }).level, 'predicted');
  assert.deepEqual(EVIDENCE_LEVELS, ['experimental', 'derived', 'predicted', 'modelled', 'illustrative']);
});

test('the interactions of a complex: only touching pairs, sorted strongest evidence first, missing models reported, degrees counted', () => {
  const cx = complexFromStructure({ model, resource: RES, id: 'cx.t', title: 't', citation: 'entry' }), models = new Map([[`${RES.id}@${RES.version}`, model]]);
  const out = interactionsOfComplex({ complex: cx, models }); assert.equal(out.interactions.length, 1, 'A touches B; C touches neither'); assert.deepEqual([out.interactions[0].a.chains, out.interactions[0].b.chains], [['A'], ['B']]);
  assert.equal(out.interactions[0].level, 'experimental'); assert.equal(out.checked, 3); assert.deepEqual(out.missing, []);
  const d = degrees(out.interactions); assert.equal(d.get('chain-a#0') ?? d.get([...d.keys()][0]), 1);
  assert.deepEqual(interactionsOfComplex({ complex: cx, models: new Map() }).missing, [`${RES.id}@${RES.version}`], 'a member without its model is said, not dropped');
  assert.equal(interactionsOfComplex({ complex: cx, models, minContacts: 10000 }).interactions.length, 0);
  assert.throws(() => interactionsOfComplex({ complex: cx, models, maxPairs: 1 }), /too many pairs/);
});
