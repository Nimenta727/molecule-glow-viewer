import test from 'node:test';
import assert from 'node:assert/strict';
import { validateComplex, stoichiometry, resolveComplex, diagnoseComplex, complexFromStructure, isIdentity } from '../complex.mjs';

const HASH = 'a'.repeat(64), REF = { id: 'res.rcsb.XXXX', version: 'aaaaaaaa', sha256: HASH };
const IDENT = { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] };
const model = () => ({
  atoms: ['A', 'B', 'C', 'D', 'E', 'W'].map((c) => ({ labelChainId: c, position: [0, 0, 0] })),
  chainNames: { A: 'Subunit alpha', B: 'Subunit alpha', C: 'Subunit alpha', D: 'Subunit beta', E: 'Some ligand', W: 'water' },
});
const make = () => complexFromStructure({ model: model(), resource: REF, id: 'cx.demo', title: '示例复合体', citation: 'Demo et al.' });

test('a complex made from one structure groups chains by the name the entry gives them and keeps its coordinates', () => {
  const cx = make();
  assert.deepEqual([...stoichiometry(cx)], [['Subunit alpha', 3], ['Subunit beta', 1], ['Some ligand', 1]], 'water is left out; three alpha chains are one member with three copies');
  const alpha = cx.members[0];
  assert.deepEqual(alpha.placements.map((p) => p.chains), [['A'], ['B'], ['C']]); assert.ok(alpha.placements.every((p) => isIdentity(p.transform) && p.evidence === 0));
  assert.equal(cx.evidence[0].type, 'experimental'); assert.equal(cx.version, REF.version);
  assert.deepEqual(validateComplex(cx), cx, 'and it validates unchanged');
});

test('member ids are unique even when two names would give the same id', () => {
  const m = { atoms: ['A', 'B'].map((c) => ({ labelChainId: c })), chainNames: { A: 'Subunit c', B: 'Subunit C' } };
  const cx = complexFromStructure({ model: m, resource: REF, id: 'cx.x', title: 't' });
  assert.deepEqual(cx.members.map(({ id }) => id), ['subunit-c', 'subunit-c-2']);
});

test('validation says which rule is broken', () => {
  const bad = (change, pattern) => { const cx = make(); change(cx); assert.throws(() => validateComplex(cx), pattern); };
  bad((cx) => { cx.members[0].copies = 2; }, /3 placements|2 copies but 3 placements/);
  bad((cx) => { cx.members[1].id = cx.members[0].id; }, /duplicate member id/);
  bad((cx) => { cx.members[0].placements[0].evidence = 5; }, /evidence 5, which does not exist/);
  bad((cx) => { cx.members[0].placements[0].transform.rotation = [0, 0, 0, 2]; }, /unit quaternion/);
  bad((cx) => { cx.members[0].placements[0].transform.scale = [1, 0, 1]; }, /scale must be positive/);
  bad((cx) => { cx.members[0].placements[0].chains = ['A', 'A']; }, /listed twice/);
  bad((cx) => { cx.evidence[0].type = 'guess'; }, /Complex/);
  bad((cx) => { cx.members[0].resource.sha256 = 'xyz'; }, /Complex/);
  assert.throws(() => complexFromStructure({ model: { atoms: [{ labelChainId: 'W' }], chainNames: { W: 'water' } }, resource: REF, id: 'cx.e', title: 't' }), /没有可以登记/);
});

test('resolving gives one instance per copy with its evidence, and reports missing or mismatched resources instead of dropping them', () => {
  const cx = make(), held = new Map([[`${REF.id}@${REF.version}`, HASH]]);
  const ok = resolveComplex(cx, held);
  assert.equal(ok.instances.length, 5); assert.deepEqual(ok.missing, []); assert.deepEqual(ok.mismatched, []);
  assert.deepEqual(ok.instances[1], { memberId: 'subunit-alpha', name: 'Subunit alpha', resource: REF, chains: ['B'], copy: 1, transform: IDENT, evidence: { index: 0, type: 'experimental', citation: 'Demo et al.' } });
  const none = resolveComplex(cx, new Map());
  assert.equal(none.instances.length, 0); assert.equal(none.missing.length, 3);
  const wrong = resolveComplex(cx, new Map([[`${REF.id}@${REF.version}`, 'b'.repeat(64)]]));
  assert.equal(wrong.mismatched.length, 3); assert.equal(wrong.instances.length, 0);
});

test('the author is told about missing resources, hash mismatches, illustrative placements and missing measured evidence', () => {
  const cx = make(), codes = (list) => list.map(({ code }) => code).sort();
  assert.deepEqual(codes(diagnoseComplex(cx, new Map([[`${REF.id}@${REF.version}`, HASH]]))), []);
  assert.deepEqual(codes(diagnoseComplex(cx, new Map())), ['frame-missing', 'resource-missing', 'resource-missing', 'resource-missing']);
  assert.deepEqual(codes(diagnoseComplex(cx, new Map([[`${REF.id}@${REF.version}`, 'c'.repeat(64)]]))), ['resource-hash', 'resource-hash', 'resource-hash']);
  const lay = make(); lay.evidence = [{ type: 'illustrative', citation: '示意摆放' }];
  assert.deepEqual(codes(diagnoseComplex(lay, new Map([[`${REF.id}@${REF.version}`, HASH]]))), ['illustrative', 'no-measured-evidence']);
});
