import assert from 'node:assert/strict';
import test from 'node:test';
import { createPluginHost } from '../../../packages/plugin-host/index.mjs';
import { authorFields, editAuthorField, getPath, checkApplicability } from '../../../packages/plugin-host/tool-model.mjs';
import { structurePlugin } from '../../structure/index.mjs';
import { toolPlugins, toolTitle, SOLUTION_TOOL } from '../../mechanism-catalog.mjs';
import { normalizeSolutionConfig, solutionSpec, SOLUTION_TEMPLATE, NONE } from '../solution-tool.mjs';

async function hostWithMotion() {
  const host = createPluginHost({ getScene: () => null, dispatch: () => {} });
  await host.activate(structurePlugin);
  for (const plugin of toolPlugins) await host.activate(plugin);
  return host;
}
const edit = (tool, config, path, raw) => editAuthorField(tool, config, path, raw);

test('the motion plugin registers the solution tool for both front ends and releases it when deactivated', async () => {
  const host = await hostWithMotion(), tool = host.getTool(SOLUTION_TOOL);
  assert.equal(tool.runtime, 'layer-v1'); assert.deepEqual([...tool.audience], ['view', 'author']);
  assert.deepEqual(host.listTools({ audience: 'author' }).map(({ id }) => id), [SOLUTION_TOOL]);
  assert.ok(tool.model.assumptions.length >= 3, 'states the limits of its model');
  assert.equal(toolTitle(SOLUTION_TOOL), tool.title);
  await assert.rejects(() => host.deactivate('org.glow.structure'), /required by/);
  await host.deactivate('org.glow.motion'); assert.equal(host.getTool(SOLUTION_TOOL), undefined);
});

test('the configuration is validated by the tool: clamped, capped, unfinished entries kept, removed species dropped', () => {
  assert.deepEqual(normalizeSolutionConfig(null), { seed: 7, scale: 'slow', pools: [], flows: [] });
  const c = normalizeSolutionConfig({ seed: 5, scale: 'fast', pools: [{ species: 'K⁺', n: 9999 }, { species: NONE, n: 3 }, { species: 'Pi' }, { n: 4 }, null],
    flows: [{ species: 'H⁺', from: ' chain A ' }, { species: 'K⁺', from: 'a', to: 'b', cps: 50 }, { species: NONE, from: 'x', to: 'y' }] });
  assert.deepEqual(c, { seed: 5, scale: 'fast', pools: [{ species: 'K⁺', n: 200 }, { species: 'Pi', n: 20 }],
    flows: [{ species: 'H⁺', from: 'chain A', to: '', cps: 1 }, { species: 'K⁺', from: 'a', to: 'b', cps: 3 }] });
  assert.deepEqual(solutionSpec(c).flows.map((f) => f.species), ['K⁺'], 'what runs is only the finished flow');
  assert.deepEqual(normalizeSolutionConfig(c), normalizeSolutionConfig(JSON.parse(JSON.stringify(normalizeSolutionConfig(c)))), 'idempotent');
});

test('Studio-style editing through the generic tool model: a blank slot adds, a species change edits, removal drops', async () => {
  const tool = (await hostWithMotion()).getTool(SOLUTION_TOOL);
  let config = JSON.parse(JSON.stringify(SOLUTION_TEMPLATE));
  let fields = authorFields(tool, config).map((f) => f.path);
  assert.deepEqual(fields.slice(0, 2), ['seed', 'scale']); assert.ok(fields.includes('pools.0.n') && fields.includes('pools.1.species') && fields.includes('flows.0.species'), 'one blank slot of each kind');
  assert.ok(!fields.includes('pools.1.n'), 'the blank slot offers only the species choice');
  config = edit(tool, config, 'pools.1.species', 'K⁺'); assert.deepEqual(config.pools[1], { species: 'K⁺', n: 20 });
  config = edit(tool, config, 'pools.1.n', '45'); assert.equal(config.pools[1].n, 45);
  config = edit(tool, config, 'flows.0.species', 'H⁺'); assert.deepEqual(config.flows[0], { species: 'H⁺', from: '', to: '', cps: 1 });
  config = edit(tool, config, 'flows.0.from', 'chain A'); config = edit(tool, config, 'flows.0.to', 'chain B'); config = edit(tool, config, 'flows.0.cps', '2.5');
  assert.deepEqual(config.flows[0], { species: 'H⁺', from: 'chain A', to: 'chain B', cps: 2.5 });
  assert.equal(solutionSpec(config).flows.length, 1);
  config = edit(tool, config, 'scale', 'fast'); assert.equal(config.scale, 'fast');
  config = edit(tool, config, 'pools.0.species', NONE); assert.deepEqual(config.pools.map((p) => p.species), ['K⁺'], 'removed, the rest shifts up');
  assert.throws(() => edit(tool, config, 'pools.0.n', '0'), /1–200/); assert.throws(() => edit(tool, config, 'flows.0.cps', '9'), /0–3/); assert.throws(() => edit(tool, config, 'scale', 'medium'), /可选项/);
  assert.throws(() => edit(tool, config, 'flows.0.from', ''), /不能为空/);
  assert.equal(getPath(config, 'flows.0.to'), 'chain B', 'a refused edit leaves the configuration alone');
});

test('a species the work defines itself stays editable, and the field list fills up to the limits', async () => {
  const tool = (await hostWithMotion()).getTool(SOLUTION_TOOL);
  const config = { pools: [{ species: 'MyDrug', n: 5 }] };
  const species = authorFields(tool, config).find((f) => f.path === 'pools.0.species');
  assert.ok(species.options.some((o) => o.value === 'MyDrug'));
  const full = { pools: Array.from({ length: 8 }, () => ({ species: 'H⁺', n: 1 })), flows: Array.from({ length: 4 }, () => ({ species: 'H⁺', from: 'a', to: 'b' })) };
  const paths = authorFields(tool, full).map((f) => f.path);
  assert.ok(!paths.includes('pools.8.species') && !paths.includes('flows.4.species'), 'no blank slot beyond the limits');
});

test('no node roles are needed: the tool applies to any scene', async () => {
  const tool = (await hostWithMotion()).getTool(SOLUTION_TOOL);
  const result = checkApplicability(tool, { nodes: [], assets: [] }, { config: SOLUTION_TEMPLATE });
  assert.equal(result.applicable, true);
});
