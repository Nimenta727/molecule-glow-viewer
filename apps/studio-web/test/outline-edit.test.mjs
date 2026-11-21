import test from 'node:test';
import assert from 'node:assert/strict';
import { clickSelection, topLevel, reparentPlan, groupPlan, removePlan } from '../outline-edit.mjs';

// root: a (b (c), d), e
const nodes = [{ id: 'a', parentId: null }, { id: 'b', parentId: 'a' }, { id: 'c', parentId: 'b' }, { id: 'd', parentId: 'a' }, { id: 'e', parentId: null }];
const order = ['a', 'b', 'c', 'd', 'e'];

test('click selection: plain, ctrl-toggle and shift-range, always in row order', () => {
  let s = clickSelection({ order, selected: [], anchor: null }, 'b');
  assert.deepEqual(s, { selected: ['b'], anchor: 'b' });
  s = clickSelection({ order, ...s }, 'e', { toggle: true }); assert.deepEqual(s.selected, ['b', 'e']);
  s = clickSelection({ order, ...s }, 'b', { toggle: true }); assert.deepEqual(s.selected, ['e']);
  s = clickSelection({ order, selected: ['b'], anchor: 'b' }, 'd', { shift: true }); assert.deepEqual(s, { selected: ['b', 'c', 'd'], anchor: 'b' });
  s = clickSelection({ order, selected: ['d'], anchor: 'd' }, 'b', { shift: true }); assert.deepEqual(s.selected, ['b', 'c', 'd'], 'a range upwards works too');
  assert.deepEqual(clickSelection({ order, selected: ['x', 'b'], anchor: 'b' }, 'zz'), { selected: ['b'], anchor: 'b' }, 'unknown rows are ignored');
});

test('only the top-level selected nodes stand for the selection', () => {
  assert.deepEqual(topLevel(nodes, ['b', 'c', 'e']), ['b', 'e']);
  assert.deepEqual(topLevel(nodes, ['c', 'zz']), ['c']);
});

test('moving a selection under a target gives one update per top-level node and skips no-ops', () => {
  const plan = reparentPlan(nodes, ['c', 'e'], 'd');
  assert.deepEqual(plan.commands, [{ type: 'updateNode', id: 'c', patch: { parentId: 'd' } }, { type: 'updateNode', id: 'e', patch: { parentId: 'd' } }]);
  assert.deepEqual(reparentPlan(nodes, ['b', 'c'], null).commands, [{ type: 'updateNode', id: 'b', patch: { parentId: null } }], 'the child travels with its parent');
  assert.deepEqual(reparentPlan(nodes, ['b'], 'a').commands, [], 'already there: nothing to do');
});

test('a move that would make a cycle, or point nowhere, is refused', () => {
  assert.match(reparentPlan(nodes, ['a'], 'c').error, /自己或它的子对象/);
  assert.match(reparentPlan(nodes, ['b'], 'b').error, /自己/);
  assert.match(reparentPlan(nodes, ['b'], 'nope').error, /不存在/);
  assert.deepEqual(reparentPlan(nodes, ['a'], 'c').commands, []);
});

test('grouping and removing work on top-level nodes only', () => {
  const plan = groupPlan(nodes, ['b', 'c', 'e'], { id: 'g', name: '组', assetId: null, visible: true });
  assert.equal(plan.commands[0].node.parentId, 'a', 'the group goes where the first selected node is');
  assert.deepEqual(plan.commands.slice(1).map(({ id }) => id), ['b', 'e']);
  assert.match(groupPlan(nodes, [], { id: 'g' }).error, /没有/);
  assert.deepEqual(removePlan(nodes, ['b', 'c', 'e']), [{ type: 'removeNode', id: 'b' }, { type: 'removeNode', id: 'e' }]);
});

test('a node added while an older row is selected becomes the whole selection: remove then acts on the new node, not on the older one', async () => {
  const { reconcileSelection } = await import('../outline-edit.mjs');
  // before the fix: the new node was "shown" but the older row stayed selected too
  assert.deepEqual(reconcileSelection({ selection: 'new', multi: ['old'], ids: ['old', 'new'] }), { selection: 'new', multi: ['new'] });
  // a real multi-selection that includes the shown node is left alone
  assert.deepEqual(reconcileSelection({ selection: 'b', multi: ['a', 'b'], ids: ['a', 'b', 'c'] }), { selection: 'b', multi: ['a', 'b'] });
  // removed nodes drop out of both; nothing shown when the shown node is gone
  assert.deepEqual(reconcileSelection({ selection: 'gone', multi: ['gone', 'a'], ids: ['a'] }), { selection: null, multi: ['a'] });
  assert.deepEqual(reconcileSelection({ selection: null, multi: [], ids: ['a'] }), { selection: null, multi: [] });
});
