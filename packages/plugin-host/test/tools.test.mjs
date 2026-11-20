import assert from 'node:assert/strict';
import test from 'node:test';
import { createPluginHost } from '../index.mjs';
import { validateToolDescriptor } from '../tool-descriptor.mjs';
import { toolControls, defaultValues, validateToolValues, getPath, setPath, authorFields, coerceField, editAuthorField } from '../tool-model.mjs';

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
