import assert from 'node:assert/strict';
import test from 'node:test';
import { createPluginHost } from '../index.mjs';
import { validateToolDescriptor } from '../tool-descriptor.mjs';
import { toolControls, defaultValues, validateToolValues, getPath, setPath, authorFields, coerceField, editAuthorField, toolRoles, checkApplicability, autoBindings } from '../tool-model.mjs';

const number = (extra = {}) => ({ type: 'number', label: '速度', min: 0, max: 10, step: 0.5, default: 1, ...extra });
const authorBlock = () => ({
  template: { title: 'T', count: 4, color: '#112233', steps: [{ t: 'a' }, { t: 'b' }] },
  fields: (config) => [
    { path: 'title', type: 'text', label: '标题', maxLength: 10 },
    { path: 'count', type: 'number', integer: true, nullable: true, min: 2, max: 9, step: 1, label: '数量' },
    { path: 'color', type: 'color', label: '颜色' },
    ...config.steps.map((_, i) => ({ path: `steps.${i}.t`, type: 'text', label: `步骤${i + 1}`, group: '步骤' })),
  ],
  validate(config) {
    if (config.title === 'bad') throw new TypeError('tool refused the title');
    return { ...config };
  },
});
const descriptor = (extra = {}) => ({ version: '1.0.0', title: '示例工具', audience: ['view', 'author'], runtime: 'player-v1',
  parameters: { speed: number(), flag: { type: 'boolean', label: '开关', default: false, audience: ['author'] },
    mode: { type: 'select', label: '模式', options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }], default: 'a' } },
  author: authorBlock(), model: { kind: 'demo', assumptions: ['教学示意'] }, ...extra });
const plugin = (id, tool, capabilities = ['tools']) => ({ manifest: { id, version: '1.0.0', apiVersion: 1, dependencies: [], capabilities },
  activate(context) { context.registerTool(`${id}.tool`, tool); } });
const host = () => createPluginHost({ getScene: () => null, dispatch: () => {} });

test('a valid descriptor is accepted and frozen; malformed ones are refused with the field named', () => {
  const ok = validateToolDescriptor('t', descriptor());
  assert.ok(Object.isFrozen(ok) && Object.isFrozen(ok.parameters.speed));
  assert.deepEqual(ok.parameters.flag.audience, ['author']);
  assert.deepEqual(ok.parameters.speed.audience, ['view', 'author'], 'parameters default to the tool\'s audience');
  const bad = (change, pattern) => assert.throws(() => validateToolDescriptor('t', descriptor(change)), pattern);
  bad({ version: '1.0' }, /exact x\.y\.z/);
  bad({ audience: [] }, /audience/);
  bad({ audience: ['view', 'view'] }, /audience/);
  bad({ audience: ['edit'] }, /audience/);
  bad({ runtime: 'worker' }, /runtime/);
  bad({ title: '' }, /title/);
  bad({ parameters: { 'bad key': number() } }, /not valid/);
  bad({ parameters: { x: { ...number(), min: 5, max: 1 } } }, /min <= max/);
  bad({ parameters: { x: number({ default: 99 }) } }, /x\.default/);
  bad({ parameters: { x: number({ integer: true, default: 1.5 }) } }, /x\.default/);
  bad({ parameters: { x: { type: 'select', label: 's', options: [], default: 'a' } } }, /options/);
  bad({ parameters: { x: { type: 'color', label: 'c', default: 'red' } } }, /x\.default/);
  bad({ parameters: { x: { type: 'banana', label: 'c', default: 1 } } }, /unknown type/);
  bad({ parameters: { x: number({ audience: ['view'] }) }, audience: ['author'], author: authorBlock() }, /audience/);
  bad({ audience: ['view'], parameters: { speed: number() } }, /author block needs "author"/);
  bad({ author: { template: {}, fields: () => [] } }, /fields\(\) and validate\(\)/);
  bad({ model: { kind: 'x' } }, /assumptions/);
});

test('the host registers tools under a tools capability, lists them by audience, and removes them on deactivation', async () => {
  const h = host();
  await h.activate(plugin('demo.view', descriptor({ audience: ['view'], author: undefined, parameters: { speed: number() } })));
  await h.activate(plugin('demo.author', descriptor({ audience: ['author'], parameters: undefined })));
  await h.activate(plugin('demo.both', descriptor()));
  assert.deepEqual(h.listTools().map(({ id }) => id), ['demo.author.tool', 'demo.both.tool', 'demo.view.tool']);
  assert.deepEqual(h.listTools({ audience: 'view' }).map(({ id }) => id), ['demo.both.tool', 'demo.view.tool'], 'the Viewer never sees author-only tools');
  assert.deepEqual(h.listTools({ audience: 'author' }).map(({ id }) => id), ['demo.author.tool', 'demo.both.tool']);
  assert.equal(h.getTool('demo.both.tool').title, '示例工具');
  await h.deactivate('demo.both');
  assert.equal(h.getTool('demo.both.tool'), undefined);
  assert.deepEqual(h.listTools().map(({ id }) => id), ['demo.author.tool', 'demo.view.tool']);
});

test('registration is refused without the capability, with an invalid descriptor, or twice', async () => {
  await assert.rejects(host().activate(plugin('demo.a', descriptor(), ['players'])), /lacks tools capability/);
  await assert.rejects(host().activate(plugin('demo.b', descriptor({ version: 'x' }))), /exact x\.y\.z/);
  const h = host();
  await h.activate(plugin('demo.c', descriptor()));
  const clash = { manifest: { id: 'demo.d', version: '1.0.0', apiVersion: 1, dependencies: [], capabilities: ['tools'] }, activate(context) { context.registerTool('demo.c.tool', descriptor()); } };
  await assert.rejects(h.activate(clash), /Registration collision/);
});

test('front ends get exactly the controls of their audience, in declaration order', () => {
  const tool = validateToolDescriptor('t', descriptor());
  assert.deepEqual(toolControls(tool, 'view').map(({ key }) => key), ['speed', 'mode']);
  assert.deepEqual(toolControls(tool, 'author').map(({ key }) => key), ['speed', 'flag', 'mode']);
  assert.deepEqual(toolControls(validateToolDescriptor('t', descriptor({ audience: ['author'] })), 'view'), [], 'a tool outside the audience contributes nothing');
  assert.deepEqual(defaultValues(tool, 'view'), { speed: 1, mode: 'a' });
});

test('runtime values are validated by the descriptor: range, integer, type, choice and unknown keys', () => {
  const tool = validateToolDescriptor('t', descriptor({ parameters: { speed: number(), n: number({ integer: true, min: 1, max: 5, step: 1, default: 2 }), mode: descriptor().parameters.mode, flag: { type: 'boolean', label: 'f', default: true } } }));
  assert.deepEqual(validateToolValues(tool, { speed: 2.5, n: 3, mode: 'b', flag: false }, 'view'), { speed: 2.5, n: 3, mode: 'b', flag: false });
  for (const value of [{ speed: 11 }, { speed: -1 }, { speed: NaN }, { n: 2.5 }, { mode: 'c' }, { flag: 1 }, { unknown: 1 }]) assert.throws(() => validateToolValues(tool, value, 'view'));
  assert.throws(() => validateToolValues(tool, [], 'view'), /需要对象/);
  const authorOnly = validateToolDescriptor('t', descriptor());
  assert.throws(() => validateToolValues(authorOnly, { flag: true }, 'view'), /参数 flag 无效/, 'an author-only parameter is not accepted from the Viewer');
  assert.deepEqual(validateToolValues(authorOnly, { flag: true }, 'author'), { flag: true });
});

test('config paths read and write immutably, address arrays by index, and refuse prototype tricks', () => {
  const config = { a: { b: [{ c: 1 }] } };
  assert.equal(getPath(config, 'a.b.0.c'), 1);
  assert.equal(getPath(config, 'a.x.y'), undefined);
  const next = setPath(config, 'a.b.0.c', 2);
  assert.equal(config.a.b[0].c, 1);
  assert.equal(next.a.b[0].c, 2);
  assert.deepEqual(setPath({}, 'x.0.y', 1), { x: [{ y: 1 }] });
  for (const path of ['__proto__.x', 'a.constructor', 'a..b', '']) assert.throws(() => setPath(config, path, 1), /Invalid config path/);
  assert.equal({}.polluted, undefined);
});

test('author edits are coerced to the field type, then accepted or refused by the tool\'s own validator', () => {
  const tool = validateToolDescriptor('t', descriptor());
  const config = tool.author.template;
  assert.deepEqual(authorFields(tool, config).map(({ path }) => path), ['title', 'count', 'color', 'steps.0.t', 'steps.1.t']);
  assert.equal(authorFields(tool, config).find(({ path }) => path === 'steps.1.t').group, '步骤');
  assert.equal(editAuthorField(tool, config, 'title', '新标题').title, '新标题');
  assert.equal(editAuthorField(tool, config, 'count', '7').count, 7);
  assert.equal(editAuthorField(tool, config, 'count', '').count, null, 'nullable numbers accept an empty entry');
  assert.equal(editAuthorField(tool, config, 'color', '#ff0000').color, '#ff0000');
  assert.equal(editAuthorField(tool, config, 'steps.1.t', '第二').steps[1].t, '第二');
  assert.equal(config.title, 'T', 'the given configuration is never modified');
  assert.throws(() => editAuthorField(tool, config, 'count', '1'), /应在 2–9/);
  assert.throws(() => editAuthorField(tool, config, 'count', '2.5'), /需要整数/);
  assert.throws(() => editAuthorField(tool, config, 'color', 'red'), /#rrggbb/);
  assert.throws(() => editAuthorField(tool, config, 'title', ''), /不能为空/);
  assert.throws(() => editAuthorField(tool, config, 'title', 'x'.repeat(11)), /太长/);
  assert.throws(() => editAuthorField(tool, config, 'title', 'bad'), /tool refused the title/, 'the tool has the last word');
  assert.throws(() => editAuthorField(tool, config, 'nothing', 'x'), /没有可编辑的配置项/);
  assert.deepEqual(authorFields(validateToolDescriptor('t', descriptor({ audience: ['view'], author: undefined, parameters: undefined })), config), [], 'no author block, no fields');
  assert.equal(coerceField({ type: 'boolean', label: 'b' }, 'true'), true);
  assert.equal(coerceField({ type: 'select', label: 's', options: [{ value: 'a', label: 'A' }] }, 'a'), 'a');
  assert.throws(() => coerceField({ type: 'select', label: 's', options: [{ value: 'a', label: 'A' }] }, 'z'), /不是可选项/);
});

// ---- aliases, player ids, inputs (roles and applicability) ----------------------------------------------------

const roleCheck = (scene) => {
  const matching = scene.nodes.filter((node) => /ring/i.test(node.name)).map(({ id }) => id);
  return { problems: matching.length ? [] : ['没有环部件'], candidates: { ring: matching, hub: scene.nodes.filter((node) => /hub/i.test(node.name)).map(({ id }) => id) } };
};
const withInputs = (extra = {}) => descriptor({ inputs: { roles: { ring: { label: '环', min: 2, max: 4 }, hub: { label: '轴', min: 1, max: 1 } }, check: roleCheck }, ...extra });
const sceneWith = (names) => ({ nodes: names.map((name, i) => ({ id: `n${i}`, name })) });

test('aliases, the player id and inputs are validated and frozen', () => {
  const tool = validateToolDescriptor('t', withInputs({ aliases: ['old.id'], player: 'old.player' }));
  assert.deepEqual(tool.aliases, ['old.id']);
  assert.equal(tool.player, 'old.player');
  assert.deepEqual(Object.keys(tool.inputs.roles), ['ring', 'hub']);
  assert.deepEqual([tool.inputs.roles.ring.min, tool.inputs.roles.ring.max, tool.inputs.roles.hub.max], [2, 4, 1]);
  assert.ok(Object.isFrozen(tool.inputs.roles.ring));
  const bad = (change, pattern) => assert.throws(() => validateToolDescriptor('t', withInputs(change)), pattern);
  bad({ aliases: ['t'] }, /aliases/);
  bad({ aliases: ['a', 'a'] }, /aliases/);
  bad({ aliases: ['bad id'] }, /aliases/);
  bad({ player: 3 }, /player/);
  bad({ inputs: { roles: {}, check: roleCheck } }, /inputs needs/);
  bad({ inputs: { roles: { ring: { label: 'r' } } } }, /check\(\)/);
  bad({ inputs: { roles: { 'bad role': { label: 'r' } }, check: roleCheck } }, /role name/);
  bad({ inputs: { roles: { ring: { label: 'r', min: 3, max: 2 } }, check: roleCheck } }, /min >= 0 and max >= min/);
  bad({ inputs: { roles: { ring: { label: '' } }, check: roleCheck } }, /label/);
});

test('a tool answers to its aliases and its player id; those markers are not tools of their own', async () => {
  const h = host();
  const named = { manifest: { id: 'demo.alias', version: '1.0.0', apiVersion: 1, dependencies: [], capabilities: ['tools'] },
    activate(context) { context.registerTool('org.glow.tool.demo', descriptor({ aliases: ['old.demo'], player: 'old.demo.player' })); } };
  await h.activate(named);
  const tool = h.getTool('org.glow.tool.demo');
  assert.equal(h.getTool('old.demo'), tool);
  assert.equal(h.getTool('old.demo.player'), tool);
  assert.deepEqual([h.resolveToolId('old.demo'), h.resolveToolId('old.demo.player'), h.resolveToolId('org.glow.tool.demo'), h.resolveToolId('nothing')],
    ['org.glow.tool.demo', 'org.glow.tool.demo', 'org.glow.tool.demo', undefined]);
  assert.deepEqual(h.listTools().map(({ id }) => id), ['org.glow.tool.demo'], 'listed once, under its own id');
  assert.deepEqual(h.listTools({ audience: 'view' }).map(({ id }) => id), ['org.glow.tool.demo']);
  await h.deactivate('demo.alias');
  assert.deepEqual([h.getTool('old.demo'), h.getTool('org.glow.tool.demo'), h.resolveToolId('old.demo.player')], [undefined, undefined, undefined]);
});

test('an alias cannot shadow another tool or alias', async () => {
  const h = host();
  await h.activate(plugin('demo.first', descriptor({ aliases: ['shared.old'] })));
  await assert.rejects(h.activate(plugin('demo.second', descriptor({ aliases: ['shared.old'] }))), /Registration collision/);
  await assert.rejects(h.activate(plugin('demo.third', descriptor({ aliases: ['demo.first.tool'] }))), /Registration collision/);
  assert.equal(h.listTools().length, 1, 'the failed activations left nothing behind');
});

test('applicability: the tool proposes candidates and problems, saved bindings win, counts are checked against each role', () => {
  const tool = validateToolDescriptor('t', withInputs());
  assert.deepEqual(toolRoles(tool).map(({ role, label, min, max }) => [role, label, min, max]), [['ring', '环', 2, 4], ['hub', '轴', 1, 1]]);
  const scene = sceneWith(['ring 1', 'ring 2', 'ring 3', 'hub', 'other']);
  const ok = checkApplicability(tool, scene, { config: {} });
  assert.equal(ok.applicable, true);
  assert.deepEqual(ok.bindings, { ring: ['n0', 'n1', 'n2'], hub: ['n3'] });
  assert.deepEqual(autoBindings(tool, scene, {}), { ring: ['n0', 'n1', 'n2'], hub: ['n3'] });
  // saved bindings win over the proposal
  assert.deepEqual(checkApplicability(tool, scene, { bindings: { ring: ['n1', 'n2'], hub: ['n4'] } }).bindings, { ring: ['n1', 'n2'], hub: ['n4'] });
  // too few, too many, and bindings that name nodes the scene no longer has
  const few = checkApplicability(tool, sceneWith(['ring 1', 'hub']), {});
  assert.equal(few.applicable, false);
  assert.match(few.problems.join('|'), /环：需要至少 2 个对象，当前 1 个/);
  assert.deepEqual(few.unbound, ['ring']);
  assert.match(checkApplicability(tool, sceneWith(['ring 1', 'ring 2', 'ring 3', 'ring 4', 'ring 5', 'hub']), {}).problems.join('|'), /环：最多 4 个对象，当前 5 个/);
  const stale = checkApplicability(tool, scene, { bindings: { ring: ['n0', 'gone'], hub: ['n3'] } });
  assert.match(stale.problems.join('|'), /环：绑定的对象已不在场景中（1 个）/);
  assert.deepEqual(stale.bindings.ring, ['n0'], 'only existing nodes are used');
  // the tool's own problems are reported as they are
  assert.match(checkApplicability(tool, sceneWith(['hub']), {}).problems.join('|'), /没有环部件/);
  // a tool without roles is always applicable
  const plain = validateToolDescriptor('t', descriptor());
  assert.deepEqual(checkApplicability(plain, scene, {}), { applicable: true, problems: [], candidates: {}, bindings: {}, unbound: [] });
  assert.deepEqual(autoBindings(plain, scene, {}), {});
  // autoBindings respects each role's maximum and leaves out roles with no candidates
  assert.deepEqual(autoBindings(tool, sceneWith(['ring 1', 'ring 2', 'ring 3', 'ring 4', 'ring 5']), {}), { ring: ['n0', 'n1', 'n2', 'n3'] });
});

test('outputs and dependencies are validated, frozen and optional', () => {
  const ok = validateToolDescriptor('t', descriptor({ outputs: [{ key: 'n', label: '计数', kind: 'count', unit: '个' }, { key: 'c', label: '曲线', kind: 'series' }],
    dependencies: [{ id: 'org.glow.structure', version: '1.0.0' }] }));
  assert.equal(ok.outputs.length, 2); assert.ok(Object.isFrozen(ok.outputs[0])); assert.deepEqual(ok.dependencies, [{ id: 'org.glow.structure', version: '1.0.0' }]);
  assert.equal(validateToolDescriptor('t', descriptor()).outputs, undefined);
  const bad = (change, pattern) => assert.throws(() => validateToolDescriptor('t', descriptor(change)), pattern);
  bad({ outputs: [{ key: 'n', label: 'x', kind: 'nope' }] }, /kind must be one of/);
  bad({ outputs: [{ key: 'n', label: 'x', kind: 'count' }, { key: 'n', label: 'y', kind: 'count' }] }, /unique valid key/);
  bad({ dependencies: [{ id: 'org.glow.structure', version: '1' }] }, /exact x\.y\.z/);
  bad({ dependencies: [{ id: 'a', version: '1.0.0' }, { id: 'a', version: '1.0.0' }] }, /unique valid id/);
});

test('a work records the plugins its tools declare, keeping what is already there', async () => {
  const { mergeToolDependencies, descriptorsForScene } = await import('../tool-model.mjs');
  const tool = validateToolDescriptor('t', descriptor({ dependencies: [{ id: 'org.glow.structure', version: '1.0.0' }, { id: 'org.glow.motion', version: '1.0.0' }] }));
  const plain = validateToolDescriptor('p', descriptor());
  const existing = [{ id: 'org.glow.structure', version: '1.0.0', optional: true }];
  const merged = mergeToolDependencies(existing, [tool, plain, undefined]);
  assert.deepEqual(merged, [{ id: 'org.glow.structure', version: '1.0.0', optional: true }, { id: 'org.glow.motion', version: '1.0.0', optional: false }]);
  assert.deepEqual(existing, [{ id: 'org.glow.structure', version: '1.0.0', optional: true }], 'the input is not changed');
  assert.deepEqual(mergeToolDependencies(undefined, []), []);
  assert.deepEqual(descriptorsForScene({ tools: [{ tool: { id: 'a' } }, { tool: { id: 'b' } }] }, (id) => (id === 'a' ? tool : undefined)), [tool, undefined]);
});
