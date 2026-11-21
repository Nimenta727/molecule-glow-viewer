import assert from 'node:assert/strict';
import test from 'node:test';
import { parsePdb } from '../parser.mjs';
import { rotateVector } from '../alignment.mjs';
import { matchByNumber, matchBySequence, fitOnto, findClashes, composeAssembly, AssemblyError } from '../assembly-compose.mjs';
import { selectionSpace, evaluateSelection } from '../selection.mjs';

function atomLine(serial, chain, resn, seq, [x, y, z]) {
  const c = Array(80).fill(' '), put = (start, text) => { for (let i = 0; i < text.length; i++) c[start + i] = text[i]; };
  put(0, 'ATOM'); put(6, String(serial).padStart(5)); put(12, ' CA '); put(17, resn.padEnd(3)); c[21] = chain; put(22, String(seq).padStart(4));
  put(30, x.toFixed(3).padStart(8)); put(38, y.toFixed(3).padStart(8)); put(46, z.toFixed(3).padStart(8)); put(54, '  1.00'); put(60, ' 10.00'); c[77] = 'C';
  return c.join('');
}
const RESN = ['ALA', 'GLY', 'LEU', 'SER', 'VAL', 'LYS', 'GLU', 'THR'];
/** A chain of CA atoms on a wide helix (every position distinct in 3D, so a superposition is unambiguous). */
const helix = (n, { chain = 'A', first = 1, radius = 6, rise = 1.6, resn = (i) => RESN[i % RESN.length] } = {}) => Array.from({ length: n }, (_, i) => ({ chain, seq: first + i, resn: resn(i), p: [radius * Math.cos(i * 0.6) + 0.37 * i, radius * Math.sin(i * 0.6) - 0.21 * i, i * rise + 0.5 * Math.sin(i * 1.3)] }));
const make = (atoms) => parsePdb(atoms.map((a, i) => atomLine(i + 1, a.chain, a.resn, a.seq, a.p)).join('\n') + '\n');
const QUARTER = [0, 0, Math.SQRT1_2, Math.SQRT1_2], rotate = (p) => rotateVector(p, QUARTER), SHIFT = [12, -7, 30];
const moved = (atoms, map = {}) => atoms.map((a) => ({ ...a, ...map, p: rotate(a.p).map((v, k) => v + SHIFT[k]) }));
const RES = { id: 'res.test.base', version: 'aaaaaaaa', sha256: 'a'.repeat(64) }, RES2 = { id: 'res.test.other', version: 'bbbbbbbb', sha256: 'b'.repeat(64) };

// base entry: a 40-residue chain A (the shared subunit) and a chain B (the partner) sitting off to one side
const shared = helix(40), partner = helix(15, { chain: 'B', first: 1, radius: 4 }).map((a) => ({ ...a, p: [a.p[0] + 20, a.p[1] + 3, a.p[2]] }));
const baseModel = make([...shared, ...partner]);
// the other entry saw the shared subunit alone (chain A) and a different component (chain C), all in its own frame
const extra = helix(12, { chain: 'C', first: 500, radius: 3 }).map((a) => ({ ...a, p: [a.p[0] - 18, a.p[1] + 25, a.p[2] + 2] }));
const otherEntry = (map) => make([...moved(shared, map), ...moved(extra)]);

test('residues are matched by number or by sequence alignment', () => {
  const space = selectionSpace(baseModel), a = evaluateSelection('chain A', space).residues, other = selectionSpace(otherEntry()), b = evaluateSelection('chain A', other).residues;
  assert.equal(matchByNumber(a, b).length, 40);
  const renumbered = selectionSpace(otherEntry({ seq: undefined })); // numbering is unchanged here: now shift it
  const shifted = make(moved(shared).map((x) => ({ ...x, seq: x.seq + 100 }))), s = evaluateSelection('chain A', selectionSpace(shifted)).residues;
  assert.equal(matchByNumber(a, s).length, 0, 'different numbering: nothing by number'); assert.equal(matchBySequence(a, s).length, 40, 'the sequence alignment still finds them all');
  assert.ok(renumbered);
  // a deletion in the middle of one chain: the alignment skips it
  const gapped = make(moved(shared).filter((x) => x.seq < 15 || x.seq > 18)), g = evaluateSelection('chain A', selectionSpace(gapped)).residues;
  assert.equal(matchBySequence(a, g).length, 36);
  assert.throws(() => matchBySequence(new Array(5000).fill(a[0]), a), /序列太长/);
});

test('fitting recovers the rigid motion exactly, by number and by sequence, and the carried chain lands where it belongs', () => {
  for (const mode of ['number', 'sequence']) {
    const added = mode === 'number' ? otherEntry() : make([...moved(shared).map((x) => ({ ...x, seq: x.seq + 100 })), ...moved(extra)]);
    const fit = fitOnto({ base: baseModel, added, baseSelection: 'chain A', addSelection: 'chain A', mode });
    assert.ok(fit.rmsd < 1e-6, `${mode}: rmsd ${fit.rmsd}`); assert.equal(fit.matched, 40); assert.ok(Math.abs(fit.identity - 1) < 1e-9);
    // a point of the other entry's frame goes back to the base frame: the carried chain C must be where the original extra chain is
    const R = fit.transform.rotation, place = (p) => rotateVector(p, R).map((v, k) => v + fit.transform.position[k]);
    for (const original of extra) { const back = place(rotate(original.p).map((v, k) => v + SHIFT[k])); assert.ok(back.every((v, k) => Math.abs(v - original.p[k]) < 1e-6), 'chain C returns to its base-frame position'); }
  }
});

test('too little to fit on, a poor fit, an empty selection and an unknown mode are refused with the reason', () => {
  const added = otherEntry(), fail = (options, pattern) => assert.throws(() => fitOnto({ base: baseModel, added, baseSelection: 'chain A', addSelection: 'chain A', ...options }), (e) => e instanceof AssemblyError && pattern.test(e.message));
  fail({ addSelection: 'chain C' }, /只匹配到 0 对/); fail({ baseSelection: 'chain Z' }, /基座里“chain Z”没有选中/); fail({ addSelection: 'chain Z' }, /新增结构里/); fail({ mode: 'magic' }, /number 或 sequence/);
  // the same residue names and numbers but a different shape: matched, then rejected for the fit
  const warped = make(moved(shared).map((x, i) => ({ ...x, p: [x.p[0] + 8 * Math.sin(i), x.p[1] + 8 * Math.cos(1.7 * i), x.p[2] + 8 * Math.sin(2.3 * i)] })));
  assert.throws(() => fitOnto({ base: baseModel, added: warped, baseSelection: 'chain A', addSelection: 'chain A', maxRmsd: 1 }), /RMSD 是 .*超过上限 1 Å/);
});

test('clashes: none when the carried chain sits clear of the base, some (with the closest pair named) when it overlaps', () => {
  const added = otherEntry(), fit = fitOnto({ base: baseModel, added, baseSelection: 'chain A', addSelection: 'chain A' });
  const clear = findClashes({ base: baseModel, added, carry: ['C'], transform: fit.transform }); assert.equal(clear.count, 0); assert.equal(clear.minDistance, null);
  const overlap = findClashes({ base: baseModel, added, carry: ['A'], transform: fit.transform }); assert.equal(overlap.count, 40, 'carrying the fitted chain itself puts every atom on top of its twin');
  assert.ok(overlap.minDistance < 1e-6); assert.ok(overlap.examples.length === 5 && overlap.examples[0].base.startsWith('A:'));
});

test('composing an assembly gives a valid complex whose placements carry derived evidence with the fit quality on the record', () => {
  const added = otherEntry(), { complex, reports } = composeAssembly({ id: 'cx.demo', title: '示例装配', base: { model: baseModel, resource: RES }, additions: [{ model: added, resource: RES2, baseSelection: 'chain A', addSelection: 'chain A', carry: ['C'], name: '新增组分' }] });
  assert.equal(complex.members.length, 3); const last = complex.members.at(-1); assert.equal(last.name, '新增组分'); assert.deepEqual(last.placements[0].chains, ['C']);
  const evidence = complex.evidence[last.placements[0].evidence]; assert.equal(evidence.type, 'derived'); assert.match(evidence.citation, /40 对残基，RMSD 0\.00 Å/); assert.equal(evidence.resource.id, RES2.id);
  assert.equal(complex.members[0].placements[0].evidence, 0, 'the base keeps its own experimental evidence'); assert.equal(complex.evidence[0].type, 'experimental');
  assert.ok(reports[0].fit.rmsd < 1e-6 && reports[0].clashes.count === 0);
  assert.throws(() => composeAssembly({ id: 'cx.x', title: 't', base: { model: baseModel, resource: RES }, additions: [{ model: added, resource: RES2, baseSelection: 'chain A', addSelection: 'chain A', carry: [] }] }), /carry/);
});
