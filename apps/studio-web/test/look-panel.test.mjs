import assert from 'node:assert/strict';
import test from 'node:test';
import { describeRules, withoutRule } from '../look-panel.mjs';

const state = () => ({
  colors: { scheme: 'chain', chains: { A: '#e05a4a' }, residues: [{ expr: 'chain B and resi 1-20', color: '#4e79a7' }, { expr: 'all', scheme: 'hydrophobicity' }] },
  styles: [{ expr: 'resi 1-5', style: 'hidden' }, { expr: 'ligands', style: 'blob' }],
});

test('the rules are listed in the order they act, each readable', () => {
  const items = describeRules(state());
  assert.deepEqual(items.map((i) => i.kind), ['scheme', 'chain', 'color', 'color', 'style', 'style']);
  assert.deepEqual(items.map((i) => i.text), ['颜色 · 全部链 → 按链', '颜色 · 链 A → #e05a4a', '颜色 · chain B and resi 1-20 → #4e79a7', '颜色 · all → 疏水性', '样式 · resi 1-5 → 隐藏', '样式 · ligands → 团块']);
  assert.deepEqual(describeRules({ colors: { scheme: 'entity', chains: {}, residues: [] }, styles: [] }), [], 'the default state has no rules');
});

test('removing one rule leaves the others as they were and never changes the input', () => {
  const before = JSON.stringify(state()), items = describeRules(state());
  const without = (kind, index) => withoutRule(state(), items.find((i) => i.kind === kind && (index === undefined || i.index === index)));
  assert.equal(without('scheme').colors.scheme, 'entity'); assert.deepEqual(without('scheme').colors.chains, { A: '#e05a4a' });
  assert.deepEqual(without('chain').colors.chains, {}); assert.equal(without('chain').colors.scheme, 'chain');
  assert.deepEqual(without('color', 0).colors.residues, [{ expr: 'all', scheme: 'hydrophobicity' }]); assert.deepEqual(without('color', 1).colors.residues, [{ expr: 'chain B and resi 1-20', color: '#4e79a7' }]);
  assert.deepEqual(without('style', 0).styles, [{ expr: 'ligands', style: 'blob' }]); assert.deepEqual(without('style', 0).colors, state().colors, 'styles and colours are independent');
  assert.equal(JSON.stringify(state()), before);
});
