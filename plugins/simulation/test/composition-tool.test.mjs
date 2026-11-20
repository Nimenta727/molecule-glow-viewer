import assert from 'node:assert/strict';
import test from 'node:test';
import { createPluginHost } from '../../../packages/plugin-host/index.mjs';
import { authorFields, editAuthorField } from '../../../packages/plugin-host/tool-model.mjs';
import { structurePlugin } from '../../structure/index.mjs';
import { toolPlugins, toolTitle, COMPOSITION_TOOL } from '../../mechanism-catalog.mjs';
import { normalizeCompositionConfig, compositionBuild, COMPOSITION_TEMPLATE, createComposition } from '../composition-tool.mjs';
import { createMarkovRun } from '../markov-model.mjs';
import { translationModel, ORFS } from '../translation.mjs';

async function tool() {
  const host = createPluginHost({ getScene: () => null, dispatch: () => {} });
  await host.activate(structurePlugin); for (const plugin of toolPlugins) await host.activate(plugin);
  return { host, tool: host.getTool(COMPOSITION_TOOL) };
}
const json = (x) => JSON.stringify(x);
const run = (config) => { const b = compositionBuild(normalizeCompositionConfig(config)); return createComposition({ members: b.members, controls: b.controls }); };

test('the simulation plugin registers the multi-process tool; deactivating it removes it; the template runs two stations at once', async () => {
  const { host, tool: t } = await tool();
  assert.equal(t.runtime, 'layer-v1'); assert.deepEqual([...t.audience], ['view', 'author']); assert.ok(t.model.assumptions.length >= 3); assert.equal(toolTitle(COMPOSITION_TOOL), t.title);
  const c = run(COMPOSITION_TEMPLATE), s = c.at(30);
  assert.ok(s.counters['ribosome.codAll'] > 100 && s.counters['channel.openings'] > 5, JSON.stringify(s.counters));
  await host.deactivate('org.glow.simulation'); assert.equal(host.getTool(COMPOSITION_TOOL), undefined);
});

test('the configuration is validated by building the composition: members, kinds, clocks, controls and what they point at', () => {
  const ok = normalizeCompositionConfig(COMPOSITION_TEMPLATE);
  assert.deepEqual(ok.members.map((m) => [m.id, m.kind, m.timeScale]), [['ribosome', 'translation', 1], ['channel', 'process', 1]]); assert.equal(ok.members[0].sequence, ORFS.ubq); assert.deepEqual(normalizeCompositionConfig(ok), ok, 'idempotent');
  const bad = (patch, re) => assert.throws(() => normalizeCompositionConfig({ ...COMPOSITION_TEMPLATE, ...patch }), re);
  bad({ members: [] }, /1–4/); bad({ members: [{ id: '9x', kind: 'process' }] }, /不合法/); bad({ members: [{ ...COMPOSITION_TEMPLATE.members[0], kind: 'weird' }] }, /种类/);
  bad({ members: [{ ...COMPOSITION_TEMPLATE.members[0], timeScale: 0 }] }, /时间比例/); bad({ members: [COMPOSITION_TEMPLATE.members[0], { ...COMPOSITION_TEMPLATE.members[1], id: 'ribosome' }] }, /重复/);
  bad({ controls: [{ id: 'k', targets: [{ member: 'nope', param: 'ERY' }] }] }, /不存在的过程/); bad({ controls: [{ id: 'k', targets: [{ member: 'ribosome', param: 'zzz' }] }] }, /不存在的参数/); bad({ controls: [{ id: 'k', targets: [] }] }, /没有指向/);
  bad({ members: [{ ...COMPOSITION_TEMPLATE.members[0], template: 'custom', sequence: '1' }] }, /至少要有 2 个/); bad({ members: [COMPOSITION_TEMPLATE.members[0], { ...COMPOSITION_TEMPLATE.members[1], schedule: [{ time: 0, kOpen: 99 }] }] }, /kOpen.*应在/);
  assert.throws(() => normalizeCompositionConfig(null), /1–4/);
  assert.equal(normalizeCompositionConfig({ members: [{ id: 'a', kind: 'translation' }] }).members[0].template, 'ubq', 'a translation member needs nothing but a name');
});

test('each member of the tool equals its own tool run, a shared control reaches only its member, and the strip belongs to the translation member only', () => {
  const c = run({ ...COMPOSITION_TEMPLATE, members: [{ ...COMPOSITION_TEMPLATE.members[0], timeScale: 2 }, COMPOSITION_TEMPLATE.members[1]] }), plain = run(COMPOSITION_TEMPLATE);
  const alone = createMarkovRun(translationModel(ORFS.ubq), 3, [{ time: 0 }]);
  assert.equal(json(c.at(20).members.ribosome), json(alone.at(40)), 'the ribosome runs at twice the scene clock');
  c.set('ery', 4, 10); assert.equal(json(c.at(30).members.channel), json(plain.at(30).members.channel));
  assert.notEqual(json(c.at(30).members.ribosome), json(plain.at(30).members.ribosome));
  const b = compositionBuild(normalizeCompositionConfig(COMPOSITION_TEMPLATE)); assert.ok(b.members[0].strip && !b.members[1].strip); assert.ok(b.members[0].display.length && b.members[1].display.length);
});

test('Studio-style editing through the generic tool model: names, clocks, seeds, the template of the translation member, control labels', async () => {
  const { tool: t } = await tool();
  let config = normalizeCompositionConfig(COMPOSITION_TEMPLATE);
  const paths = authorFields(t, config).map((f) => f.path);
  for (const p of ['members.0.label', 'members.0.timeScale', 'members.0.seed', 'members.0.template', 'members.0.sequence', 'members.1.timeScale', 'controls.0.label']) assert.ok(paths.includes(p), p);
  assert.ok(!paths.includes('members.1.template'), 'only a translation member has a template');
  config = editAuthorField(t, config, 'members.0.timeScale', '0.5'); config = editAuthorField(t, config, 'members.1.seed', '11'); config = editAuthorField(t, config, 'members.0.template', 'ermcl'); config = editAuthorField(t, config, 'controls.0.label', '红霉素');
  assert.deepEqual([config.members[0].timeScale, config.members[1].seed, config.members[0].sequence, config.controls[0].label], [0.5, 11, ORFS.ermcl, '红霉素']);
  assert.throws(() => editAuthorField(t, config, 'members.0.timeScale', '500'), /之间/); assert.throws(() => editAuthorField(t, config, 'members.0.template', 'nope'), /可选项/);
});
