import assert from 'node:assert/strict';
import test from 'node:test';
import { lookFor, propertyColors, applyStyle, validateStyles, LookError, PROPERTY_SCHEMES } from '../look.mjs';
import { selectionSpace, evaluateSelection } from '../selection.mjs';
import { buildRepresentations } from '../representation.mjs';

// chain A: ILE(hydrophobic) ASP(acid) LYS(base) GLY ARG(base) VAL; B-factors rise along the chain; a helix over residues 2-3 and a sheet over 5-6
const SEQ = ['ILE', 'ASP', 'LYS', 'GLY', 'ARG', 'VAL'];
function model() {
  return {
    format: 'pdb',
    atoms: SEQ.map((resn, i) => ({ record: 'ATOM', serial: i + 1, element: 'C', name: 'CA', authAtomId: 'CA', labelAtomId: 'CA', residueName: resn, authChainId: 'A', labelChainId: 'A',
      authSeqId: String(i + 1), labelSeqId: String(i + 1), insertionCode: '', altLoc: '', modelId: '1', position: [i * 3.8, 0, 0], bFactor: 10 + i * 10 })),
    secondaryStructure: [{ type: 'helix', chainId: 'A', from: '2', to: '3', numbering: 'auth' }, { type: 'sheet', chainId: 'A', from: '5', to: '6', numbering: 'auth' }],
  };
}
const residues = (m, expr = 'all') => evaluateSelection(expr, selectionSpace(m)).residues;
const colorsBy = (m, scheme) => { const c = propertyColors(m, residues(m), scheme), id = [...c.keys()]; return residues(m).map((r) => c.get(id.find((k) => k.includes(`\u0001${r.authSeq}\u0001`)))); };

test('hydrophobicity: hydrophobic residues warm, charged ones cool, quantised to a few bands', () => {
  const [ile, asp, lys, gly, arg, val] = colorsBy(model(), 'hydrophobicity');
  assert.notEqual(ile, asp); assert.ok(lys !== undefined && arg !== undefined);
  const warm = (c) => parseInt(c.slice(1, 3), 16) - parseInt(c.slice(5, 7), 16);   // red minus blue: positive = warm
  assert.ok(warm(ile) > 0 && warm(val) > 0, 'Ile and Val are warm'); assert.ok(warm(asp) < 0 && warm(lys) < 0 && warm(arg) < 0, 'Asp, Lys and Arg are cool'); assert.ok(warm(ile) > warm(gly), 'Gly (-0.4) is cooler than Ile (4.5)');
  assert.ok(new Set(colorsBy(model(), 'hydrophobicity')).size <= 6, 'at most one colour per residue, and the bands keep the number of layers low');
});

test('charge: acidic red, basic blue, histidine light blue, the rest neutral; secondary structure follows the deposited ranges', () => {
  assert.deepEqual(colorsBy(model(), 'charge'), ['#d9dbe0', '#d6453d', '#4e79a7', '#d9dbe0', '#4e79a7', '#d9dbe0']);
  assert.deepEqual(colorsBy(model(), 'secondary'), ['#607f91', '#d47770', '#d47770', '#607f91', '#d6a94f', '#d6a94f']);
});

test('B-factor: low to high is blue to red over the selected residues; rainbow runs N to C along the chain; one value everywhere gives one colour', () => {
  const b = colorsBy(model(), 'bfactor'), r = colorsBy(model(), 'rainbow');
  for (const list of [b, r]) { assert.equal(new Set(list).size, 6, 'a distinct colour per residue here'); assert.ok(parseInt(list[0].slice(5, 7), 16) > parseInt(list[0].slice(1, 3), 16), 'the first is bluish'); assert.ok(parseInt(list[5].slice(1, 3), 16) > parseInt(list[5].slice(5, 7), 16), 'the last is reddish'); }
  assert.deepEqual(b, r, 'here B rises along the chain, so both agree');
  const flat = model(); flat.atoms.forEach((a) => { a.bFactor = 20; }); assert.equal(new Set(colorsBy(flat, 'bfactor')).size, 1);
  const none = model(); none.atoms.forEach((a) => { delete a.bFactor; }); assert.equal(propertyColors(none, residues(none), 'bfactor').size, 0, 'no B-factors, no colours (the layer keeps its colour)');
});

test('rules are applied in order and the later one wins; a scheme rule colours only what its selection picks', () => {
  const m = model(), look = lookFor(m, { colors: { residues: [{ expr: 'all', color: '#111111' }, { expr: 'resi 2-3', scheme: 'charge' }, { expr: 'resi 3', color: '#222222' }] }, styles: [{ expr: 'resi 1-2', style: 'blob' }, { expr: 'resi 2', style: 'hidden' }] });
  const atom = (n) => m.atoms[n - 1];
  assert.deepEqual([1, 2, 3, 4].map((n) => look.colorOf(atom(n))), ['#111111', '#d6453d', '#222222', '#111111']);
  assert.deepEqual([1, 2, 3].map((n) => look.styleOf(atom(n))), ['blob', 'hidden', undefined]);
  assert.equal(lookFor(m, {}), null, 'no rules, no look'); assert.equal(lookFor(m, { colors: { residues: [] }, styles: [] }), null);
  assert.equal(lookFor(m, {}, { base: new Map([['k', '#abcdef']]) }).styleOf, undefined, 'a base colour alone gives colours only');
});

test('the look reaches the drawing: the coloured residues of a real build are their own pinned layer', () => {
  const m = model(), look = lookFor(m, { colors: { residues: [{ expr: 'resi 4-6', color: '#e05a4a' }] }, styles: [{ expr: 'resi 1', style: 'hidden' }] });
  const [group] = buildRepresentations(m, { style: 'cartoon', look }); const red = group.layers.find((l) => l.color === '#e05a4a');
  assert.ok(red && red.pinned && red.mode === 'triangles' && red.normals.length === red.positions.length, 'a pinned layer of smooth 3D cartoon');
  const reds = (layer) => { let n = 0; for (let i = 0; i < layer.positions.length; i += 3) n++; return n; }; assert.ok(reds(red) > 0 && reds(red) < reds(group.layers.find((l) => l.mode === 'triangles' && l !== red)) + reds(red), 'the coloured stretch is only part of the chain');
  assert.equal(group.pointTargets[group.layers.findIndex((l) => l.mode === 'points')].length, 5, 'residue 1 is hidden and not pickable');
});

test('style rules: validated, refused with the reason, capped', () => {
  const check = (expr) => residues(model(), expr).length;
  const { styles, note } = applyStyle([], 'chain A and resi 1-3', 'cartoon', { check }); assert.deepEqual(styles, [{ expr: 'chain A and resi 1-3', style: 'cartoon' }]); assert.match(note, /3 个残基.*卡通/);
  assert.throws(() => applyStyle([], 'resi 99', 'blob', { check }), (e) => e instanceof LookError && /没有选中任何残基/.test(e.message)); assert.throws(() => applyStyle([], 'resi 1', 'spaghetti', { check }), /样式应为/);
  assert.match(applyStyle([], 'resi 1', 'sticks', { check }).note, /价键/); assert.throws(() => applyStyle([], 'all', 'sticks', { check: () => 30001 }), /最多 30000 个残基/);
  assert.doesNotThrow(() => applyStyle([], 'all', 'sticks', { check: () => 5000 }), 'the bond model of a whole protein is allowed'); assert.throws(() => applyStyle([], 'all', 'ballstick', { check: () => 6001 }), /球棍.*最多 6000 个残基/);
  assert.throws(() => applyStyle([], 'banana', 'blob', { check }), /无法读取选择/ ); assert.throws(() => applyStyle(Array.from({ length: 64 }, () => ({ expr: 'all', style: 'blob' })), 'all', 'blob', { check }), /最多 64/);
  assert.deepEqual(validateStyles([{ expr: 'all', style: 'hidden' }]), [{ expr: 'all', style: 'hidden' }]); assert.deepEqual(validateStyles(undefined), []);
  assert.throws(() => validateStyles([{ expr: '', style: 'blob' }]), LookError); assert.throws(() => validateStyles([{ expr: 'all', style: 'x' }]), LookError); assert.throws(() => validateStyles('x'), LookError);
  assert.deepEqual(Object.keys(PROPERTY_SCHEMES), ['bfactor', 'hydrophobicity', 'charge', 'secondary', 'rainbow']);
});

test('with several structures a colour rule is for the structure it names, everything else for the first', () => {
  const colors = { scheme: 'entity', chains: {}, residues: [{ expr: 'all', color: '#111111' }, { expr: 'all', color: '#222222', structure: 's1' }] };
  const colorsOf = (sourceId) => { const look = lookFor(model(), { colors, styles: [{ expr: 'resi 1', style: 'hidden' }] }, { sourceId, primaryId: 'first' }); return look ? [look.colorOf?.(model().atoms[0]), look.styleOf?.(model().atoms[0])] : null; };
  const m = model(), first = lookFor(m, { colors }, { sourceId: 'first', primaryId: 'first' }), second = lookFor(m, { colors }, { sourceId: 's1', primaryId: 'first' }), other = lookFor(m, { colors }, { sourceId: 's2', primaryId: 'first' });
  assert.equal(first.colorOf(m.atoms[0]), '#111111'); assert.equal(second.colorOf(m.atoms[0]), '#222222'); assert.equal(other, null, 'a structure no rule names has no look');
  assert.deepEqual(colorsOf('first'), ['#111111', 'hidden'], 'style rules are for the first structure'); assert.equal(colorsOf('s1')[1], undefined);
  assert.ok(lookFor(m, { colors }) !== null, 'without a source id every rule applies (older callers)');
});
