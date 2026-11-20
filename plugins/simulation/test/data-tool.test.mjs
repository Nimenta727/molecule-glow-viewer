import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { createPluginHost } from '../../../packages/plugin-host/index.mjs';
import { authorFields, editAuthorField, getPath } from '../../../packages/plugin-host/tool-model.mjs';
import { structurePlugin } from '../../structure/index.mjs';
import { toolPlugins, toolEntriesForScene, dataAnimationEntry, toolTitle, DATA_TOOL } from '../../mechanism-catalog.mjs';
import { normalizeDataConfig, DATA_TEMPLATE } from '../data-tool.mjs';

const packScene = (name) => JSON.parse(fs.readFileSync(new URL(`../../../workshop/official/packs/official.${name}.glow`, import.meta.url), 'utf8')).scene;
async function tool() {
  const host = createPluginHost({ getScene: () => null, dispatch: () => {} });
  await host.activate(structurePlugin);
  for (const plugin of toolPlugins) await host.activate(plugin);
  return { host, tool: host.getTool(DATA_TOOL) };
}

test('the simulation plugin registers the data animation tool for both front ends; deactivating it removes the tool', async () => {
  const { host, tool: t } = await tool();
  assert.equal(t.runtime, 'layer-v1'); assert.deepEqual([...t.audience], ['view', 'author']); assert.ok(t.model.assumptions.length >= 3);
  assert.ok(host.listTools({ audience: 'author' }).some(({ id }) => id === DATA_TOOL)); assert.equal(toolTitle(DATA_TOOL), t.title);
  await host.deactivate('org.glow.simulation'); assert.equal(host.getTool(DATA_TOOL), undefined);
});

test('a classic scene that carries an animation gets the tool entry: declaration, axis and membrane placement become its configuration', () => {
  const kcsa = dataAnimationEntry({ legacy: { scene: packScene('kcsa-data') } }), adk = dataAnimationEntry({ legacy: { scene: packScene('adk-reaction-data') } });
  assert.equal(kcsa.tool.id, DATA_TOOL); assert.equal(kcsa.config.axis, 'sym'); assert.deepEqual(kcsa.config.membranes, [{ at: '', offset: 0 }]); assert.equal(kcsa.config.animation.flows[0].counter, 'K⁺ 外流');
  assert.equal(adk.config.axis, 'long'); assert.equal(adk.config.animation.reactions[0].counter, 'ADP 生成');
  assert.deepEqual(toolEntriesForScene({ legacy: { scene: packScene('kcsa-data') } }).map((e) => e.tool.id), [DATA_TOOL]);
  assert.equal(dataAnimationEntry({ legacy: { scene: { animation: { version: 1, pools: [{ species: 'X', in: '没有这个区室' }] } } } }), undefined, 'a declaration the engine cannot run is not turned into a tool entry');
  assert.equal(dataAnimationEntry({}), undefined);
});

test('the tool validates the whole configuration: references must resolve, the rest is clamped', () => {
  assert.throws(() => normalizeDataConfig({ animation: { version: 1, pools: [{ species: 'X', in: '不存在' }] } }), /不存在的区室/);
  assert.throws(() => normalizeDataConfig(null), /必须是一个对象/);
  const c = normalizeDataConfig({ animation: DATA_TEMPLATE.animation, axis: 'weird', membranes: [{ at: 'a', offset: 9999 }, {}, {}], seed: 1.5, scale: 'x' });
  assert.deepEqual([c.axis, c.membranes.length, c.membranes[0].offset, c.seed, c.scale], ['sym', 2, 500, 7, 'slow']);
  assert.deepEqual(normalizeDataConfig(c), c, 'idempotent');
});

test('Studio-style editing through the generic tool model: pool size, flow rate, reaction text, run settings; a bad edit is refused and changes nothing', async () => {
  const { tool: t } = await tool();
  let config = dataAnimationEntry({ legacy: { scene: packScene('adk-reaction-data') } }).config;
  const paths = authorFields(t, config).map((f) => f.path);
  for (const p of ['seed', 'scale', 'axis', 'animation.pools.0.n', 'animation.pools.2.species', 'animation.reactions.0.rate', 'animation.reactions.0.text']) assert.ok(paths.includes(p), p);
  config = editAuthorField(t, config, 'animation.pools.0.n', '9'); assert.equal(config.animation.pools[0].n, 9);
  config = editAuthorField(t, config, 'animation.reactions.0.rate', '0.8'); assert.equal(config.animation.reactions[0].rate, 0.8);
  config = editAuthorField(t, config, 'animation.reactions.0.text', 'ATP + AMP → 2 ADP'); assert.equal(config.animation.reactions[0].text, 'ATP + AMP → 2 ADP');
  config = editAuthorField(t, config, 'axis', 'short'); config = editAuthorField(t, config, 'scale', 'fast'); config = editAuthorField(t, config, 'seed', '42');
  assert.deepEqual([config.axis, config.scale, config.seed], ['short', 'fast', 42]);
  assert.throws(() => editAuthorField(t, config, 'animation.pools.0.n', '999'), /0–200/); assert.throws(() => editAuthorField(t, config, 'axis', 'diagonal'), /可选项/);
  assert.throws(() => editAuthorField(t, config, 'animation.pools.0.species', ''), /不能为空/);
  assert.equal(getPath(config, 'animation.pools.0.n'), 9);
  const kc = dataAnimationEntry({ legacy: { scene: packScene('kcsa-data') } }).config, kp = authorFields(t, kc).map((f) => f.path);
  assert.ok(kp.includes('membranes.0.offset') && kp.includes('animation.flows.0.rate') && kp.includes('animation.flows.0.name'));
  const inComp = authorFields(t, kc).find((f) => f.path === 'animation.pools.0.in'); assert.deepEqual(inComp.options.map((o) => o.value), ['胞内', '胞外']);
});

const kinetics = { version: 1, inputs: { effluxed: 'K⁺ 外流' }, constants: { Ki0: 140, Ko0: 5 }, state: { drift: 0 },
  controls: [{ id: 'scale', type: 'range', label: '每次外流的浓度变化', min: 0.1, max: 2, step: 0.1, default: 0.6, unit: 'mM' }],
  step: [{ let: 'ki', expr: 'Ki0 - scale * effluxed' }, { let: 'ko', expr: 'Ko0 + scale * effluxed' }],
  series: [{ label: 'E_K', range: [-120, 0], expr: '25.69 * log(ko / ki)', format: { digits: 1, unit: ' mV' } }], dots: [{ label: 'K⁺', comp: '胞外', max: 30, count: 'ko' }], warmup: false };

test('the tool keeps and checks an optional compartment model: pure data, names real compartments, constants and start values are editable fields', async () => {
  const { tool: t } = await tool();
  const base = dataAnimationEntry({ legacy: { scene: packScene('kcsa-data') } }).config;
  let config = normalizeDataConfig({ ...base, kinetics });
  assert.deepEqual(config.kinetics, kinetics); assert.equal(normalizeDataConfig(base).kinetics, undefined, 'optional');
  assert.throws(() => normalizeDataConfig({ ...base, kinetics: { ...kinetics, dots: [{ label: 'K⁺', comp: '不存在', max: 3, count: 'ko' }] } }), /不存在的区室“不存在”/);
  assert.throws(() => normalizeDataConfig({ ...base, kinetics: { ...kinetics, step: [{ let: 'a', expr: 'zzz' }] } }), /没有定义“zzz”/);
  assert.throws(() => normalizeDataConfig({ ...base, kinetics: { ...kinetics, step: [{ let: 'a', expr: '1' }], series: [], big: 'x'.repeat(250000) } }) || normalizeDataConfig({ ...base, kinetics: { version: 1, constants: { A: 1 }, state: {}, step: [{ let: 'b', expr: 'A' }], pad: 'x'.repeat(250000) } }), /太大/);
  const paths = authorFields(t, config).map((f) => f.path);
  for (const p of ['kinetics.constants.Ki0', 'kinetics.constants.Ko0', 'kinetics.state.drift']) assert.ok(paths.includes(p), p);
  config = editAuthorField(t, config, 'kinetics.constants.Ko0', '4.5'); assert.equal(config.kinetics.constants.Ko0, 4.5);
  assert.throws(() => editAuthorField(t, config, 'kinetics.constants.Ko0', '1e9'), /之间/); assert.equal(getPath(config, 'kinetics.constants.Ko0'), 4.5);
});
