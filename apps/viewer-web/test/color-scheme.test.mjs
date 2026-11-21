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
  assert.throws(() => applyColor(createColorState(), 'chain A and resi 1-10', 'red', chains), /整条链/);
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
