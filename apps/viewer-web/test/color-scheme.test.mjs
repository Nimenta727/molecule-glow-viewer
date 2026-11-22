import test from 'node:test';
import assert from 'node:assert/strict';
import { applyColor, createColorState, resolveColor, parseColor, validateColorState, isDefault, CHAIN_PALETTE } from '../color-scheme.mjs';

const chains = ['A', 'B', 'C'];
test('colours are parsed from hex and names; garbage is refused', () => {
  assert.equal(parseColor('#ABC'), '#aabbcc'); assert.equal(parseColor(' Red '), '#e05a4a'); assert.equal(parseColor('#112233'), '#112233');
  for (const bad of ['', 'chartreuse', '#12', '#gggggg', 5, null]) assert.throws(() => parseColor(bad), /颜色/);
});
test('schemes: the default keeps the plugin palette, chain gives each chain its own colour, rainbow runs blue to red', () => {
  const base = createColorState(); assert.ok(isDefault(base));
  assert.equal(resolveColor(base, 'A', 0, 3), undefined);
  const byChain = applyColor(base, 'chain', undefined, chains).state;
  assert.deepEqual(chains.map((c, i) => resolveColor(byChain, c, i, 3)), CHAIN_PALETTE.slice(0, 3));
  const rainbow = applyColor(base, 'rainbow', undefined, chains).state, [a, b, c] = chains.map((id, i) => resolveColor(rainbow, id, i, 3));
  assert.match(a, /^#[0-9a-f]{6}$/); assert.notEqual(a, b); assert.notEqual(b, c);
  assert.ok(parseInt(a.slice(5), 16) > parseInt(a.slice(1, 3), 16), 'first is bluish'); assert.ok(parseInt(c.slice(1, 3), 16) > parseInt(c.slice(5), 16), 'last is reddish');
});
test('a single chain or all chains can be coloured; explicit colours win over the scheme; reset restores', () => {
  let { state } = applyColor(createColorState(), 'chain B', 'red', chains);
  assert.deepEqual(state.chains, { B: '#e05a4a' });
  state = applyColor(state, 'chain', undefined, chains).state;   // a scheme change clears explicit colours, as in the classic
  assert.deepEqual(state.chains, {});
  state = applyColor(state, { target: 'a', color: '#00ff00' }, undefined, chains).state;
  assert.equal(resolveColor(state, 'A', 0, 3), '#00ff00'); assert.equal(resolveColor(state, 'B', 1, 3), CHAIN_PALETTE[1]);
  state = applyColor(state, 'blue', undefined, chains).state;
  assert.deepEqual(Object.keys(state.chains), chains);
  assert.ok(isDefault(applyColor(state, 'reset', undefined, chains).state));
});
test('a target that is not a whole chain, or a missing chain, is refused with a reason', () => {
  assert.throws(() => applyColor(createColorState(), 'chain A and resi 1-10', 'red', chains), /整条链或 all 可以直接上色/, 'without a selection checker a residue target is refused and the way to do it is named');
  assert.throws(() => applyColor(createColorState(), 'within 5 of ligands', 'red', chains), /整条链/);
  assert.throws(() => applyColor(createColorState(), 'chain Z', 'red', chains), /没有链 Z/);
  assert.throws(() => applyColor(createColorState(), { scheme: 'neon' }, undefined, chains), /配色方式/);
});
test('a saved colour state is validated on the way back in', () => {
  const state = applyColor(createColorState(), 'chain B', 'red', chains).state;
  assert.deepEqual(validateColorState(JSON.parse(JSON.stringify(state))), state);
  assert.throws(() => validateColorState({ scheme: 'x', chains: {} }), /配色方式/);
  assert.throws(() => validateColorState({ scheme: 'chain', chains: { A: 'nope' } }), /颜色/);
  assert.throws(() => validateColorState([]), /对象/);
});

test('residue targets: with a selection checker a selection becomes a rule; unreadable or empty selections are refused; later rules win and are saved with the state', () => {
  const chains = ['A', 'B'], check = (expr) => { if (/bad/.test(expr)) throw new Error('语法错误'); return /none/.test(expr) ? 0 : 7; };
  let { state, note } = applyColor(createColorState(), 'chain A and resi 1-10', 'red', chains, { check });
  assert.deepEqual(state.residues, [{ expr: 'chain A and resi 1-10', color: '#e05a4a' }]); assert.match(note, /7 个残基/); assert.ok(!isDefault(state));
  ({ state } = applyColor(state, 'resi 5-8', '#00ff00', chains, { check })); assert.equal(state.residues.length, 2); assert.equal(state.residues[1].color, '#00ff00');
  assert.throws(() => applyColor(state, 'bad bad', 'red', chains, { check }), /无法读取选择“bad bad”：语法错误/);
  assert.throws(() => applyColor(state, 'none here', 'red', chains, { check }), /没有选中任何残基/);
  assert.throws(() => applyColor(state, 'chain A and '.repeat(40), 'red', chains, { check }), /太长/);
  assert.deepEqual(validateColorState(JSON.parse(JSON.stringify(state))), state, 'saved and restored unchanged');
  assert.throws(() => validateColorState({ scheme: 'entity', chains: {}, residues: [{ expr: '', color: 'red' }] }), /选择表达式无效/);
  assert.throws(() => validateColorState({ scheme: 'entity', chains: {}, residues: Array.from({ length: 65 }, () => ({ expr: 'all', color: 'red' })) }), /64 条/);
  assert.ok(isDefault(applyColor(state, 'reset', undefined, chains).state), 'reset clears the rules too');
  let many = createColorState(); for (let i = 0; i < 64; i++) many = applyColor(many, `resi ${i + 1}`, 'red', chains, { check }).state;
  assert.throws(() => applyColor(many, 'resi 99', 'red', chains, { check }), /最多 64 条/);
  assert.deepEqual(validateColorState({ scheme: 'chain', chains: {} }).residues, [], 'an older saved state without rules still loads');
});

test('the confidence scheme is refused unless the structure is a predicted one', () => {
  const chains = ['A'];
  assert.throws(() => applyColor(createColorState(), 'confidence', undefined, chains), /不是预测结构/);
  assert.throws(() => applyColor(createColorState(), 'confidence', undefined, chains, { confidence: false }), /不是预测结构/);
  const { state, note } = applyColor(createColorState(), 'confidence', undefined, chains, { confidence: true });
  assert.equal(state.scheme, 'confidence'); assert.match(note, /pLDDT/); assert.equal(resolveColor(state, 'A', 0, 1), undefined, 'chains keep their own colour; residues carry the confidence');
});

test('a property scheme colours a selection as a rule: color("hydrophobicity"), color("chain A", "bfactor"); refused without a structure or with an empty selection', async () => {
  const { applyColor, validateColorState, createColorState } = await import('../color-scheme.mjs');
  const check = (expr) => (expr === 'resi 99' ? 0 : expr === 'chain A' || expr === 'all' ? 10 : (() => { throw new Error('读不懂'); })());
  const all = applyColor(createColorState(), 'hydrophobicity', undefined, ['A', 'B'], { check });
  assert.deepEqual(all.state.residues, [{ expr: 'all', scheme: 'hydrophobicity' }]); assert.match(all.note, /10 个残基.*疏水性/);
  const one = applyColor(all.state, 'chain A', 'bfactor', ['A', 'B'], { check }); assert.deepEqual(one.state.residues.at(-1), { expr: 'chain A', scheme: 'bfactor' }); assert.equal(one.state.residues.length, 2);
  assert.deepEqual(applyColor(createColorState(), 'chain A', 'rainbow', ['A'], { check }).state.residues, [{ expr: 'chain A', scheme: 'rainbow' }], 'rainbow over a target is a rule; alone it stays the global scheme');
  assert.equal(applyColor(createColorState(), 'rainbow', undefined, ['A'], { check }).state.scheme, 'rainbow');
  assert.throws(() => applyColor(createColorState(), 'charge', undefined, ['A'], {}), /先打开结构/); assert.throws(() => applyColor(createColorState(), 'resi 99', 'charge', ['A'], { check }), /没有选中任何残基/); assert.throws(() => applyColor(createColorState(), 'banana', 'charge', ['A'], { check }), /无法读取选择/);
  assert.deepEqual(validateColorState(one.state).residues, one.state.residues, 'a saved state with scheme rules reads back');
  assert.deepEqual(validateColorState({ scheme: 'entity', chains: {}, residues: [{ expr: 'all', color: '#E05A4A' }] }).residues, [{ expr: 'all', color: '#e05a4a' }], 'an older state with colour rules still reads');
  assert.throws(() => validateColorState({ scheme: 'entity', chains: {}, residues: [{ expr: 'all', scheme: 'sparkle' }] }), /配色方案应为/);
});
