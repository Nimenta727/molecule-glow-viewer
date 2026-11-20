import assert from 'node:assert/strict';
import test from 'node:test';
import { createPluginHost } from '../../../packages/plugin-host/index.mjs';
import { authorFields, editAuthorField } from '../../../packages/plugin-host/tool-model.mjs';
import { structurePlugin } from '../../structure/index.mjs';
import { toolPlugins, toolTitle, TRANSLATION_TOOL } from '../../mechanism-catalog.mjs';
import { normalizeTranslationConfig, translationProcessConfig, resolveTemplate, TRANSLATION_TEMPLATE, TEMPLATES } from '../translation-tool.mjs';
import { normalizeProcessConfig } from '../process-tool.mjs';
import { readDisplay } from '../observer.mjs';
import { createMarkovRun } from '../markov-model.mjs';
import { ORFS, translationModel } from '../translation.mjs';

async function tool() {
  const host = createPluginHost({ getScene: () => null, dispatch: () => {} });
  await host.activate(structurePlugin); for (const plugin of toolPlugins) await host.activate(plugin);
  return { host, tool: host.getTool(TRANSLATION_TOOL) };
}

test('the simulation plugin registers the translation tool for both front ends; deactivating it removes it; the template translates out of the box', async () => {
  const { host, tool: t } = await tool();
  assert.equal(t.runtime, 'layer-v1'); assert.deepEqual([...t.audience], ['view', 'author']); assert.ok(t.model.assumptions.length >= 3); assert.equal(toolTitle(TRANSLATION_TOOL), t.title);
  const built = translationProcessConfig(TRANSLATION_TEMPLATE), run = createMarkovRun(built.process, built.seed, built.schedule), s = run.at(30);
  assert.ok(s.counters.codAll > 100 && s.nums.L > 1); assert.equal(built.strip.sequence, ORFS.ubq);
  await host.deactivate('org.glow.simulation'); assert.equal(host.getTool(TRANSLATION_TOOL), undefined);
});

test('the configuration is validated: templates, a custom sequence is cleaned and bounded, the schedule keeps earlier values, seeds and bad input fall back or are refused', () => {
  assert.deepEqual(Object.keys(TEMPLATES), ['ubq', 'ermcl', 'polyu', 'custom']);
  const c = normalizeTranslationConfig({ template: 'custom', sequence: 'mkt ay-iak1', schedule: [{ time: 0, ERY: 2 }, { time: 10, TC: 40 }], seed: 3 });
  assert.equal(c.sequence, 'MKTAYIAK'); assert.deepEqual([c.schedule[1].ERY, c.schedule[1].TC, c.schedule[0].TC], [2, 40, 25]); assert.deepEqual(normalizeTranslationConfig(c), c, 'idempotent');
  assert.equal(normalizeTranslationConfig({ template: 'ermcl', sequence: 'XXXX' }).sequence, ORFS.ermcl, 'a preset uses its own sequence'); assert.equal(normalizeTranslationConfig({ template: 'nope' }).template, 'ubq');
  assert.equal(resolveTemplate({ template: 'custom', sequence: 'KTAY' }).aa, 'MKTAY', 'a chain starts with Met'); assert.equal(resolveTemplate({ template: 'ermcl' }).ermcl, true);
  assert.throws(() => normalizeTranslationConfig({ template: 'custom', sequence: '123' }), /至少要有 2 个/); assert.throws(() => normalizeTranslationConfig({ template: 'custom', sequence: 'A'.repeat(401) }), /最长/);
  assert.throws(() => normalizeTranslationConfig({ schedule: [{ time: 0 }, { time: 0 }] }), /时间必须大于/); assert.throws(() => normalizeTranslationConfig({ schedule: [{ time: 0, TC: 999 }] }), /TC.*应在/);
  assert.equal(normalizeTranslationConfig({ seed: -1 }).seed, 7);
});

test('the process panel config reads: counters, the chain length (a number), rates, errors; the built declaration passes the process tool validation', () => {
  const built = translationProcessConfig({ template: 'polyu' }), checked = normalizeProcessConfig({ process: built.process, schedule: built.schedule, seed: built.seed, display: built.display });
  assert.equal(checked.display.length, 6);
  const run = createMarkovRun(built.process, built.seed, built.schedule), at = 25, s = run.at(at);
  assert.equal(readDisplay(run, built.display[1], at), s.nums.L); assert.equal(readDisplay(run, built.display[0], at), s.counters.prot); assert.equal(readDisplay(run, built.display[5], at), s.clocks.nonCognate);
  assert.ok(readDisplay(run, built.display[2], at) > 5);
  assert.throws(() => normalizeProcessConfig({ process: built.process, display: [{ kind: 'number', name: 'zzz' }] }), /不存在的“zzz”/);
});

test('branch records tell which tRNA was incorporated: the peptide strip can mark the errors', () => {
  const run = createMarkovRun(translationModel('M' + 'K'.repeat(3000)), 5, [{ time: 0, PAR: 20 }]);
  run.at(100);
  const start = run.lastEvent('init', 100) ?? 0, peps = run.eventsBetween(start, 100, ['pep']);
  assert.ok(peps.length > 1000 && peps.every((e) => e.branch === 0 || e.branch === 1));
  const s = run.at(100); assert.equal(peps.filter((e) => e.branch === 0).length, s.nums.mis, 'branch 0 is a near-cognate (wrong) residue');
  assert.equal(run.lastEvent('nonexistent', 100), null); assert.equal(run.eventsBetween(10, 10.0001, ['pep']).length <= 1, true);
});

test('Studio-style editing through the generic tool model: template, sequence, seed, concentrations, a later change in the blank slot', async () => {
  const { tool: t } = await tool();
  let config = normalizeTranslationConfig(TRANSLATION_TEMPLATE);
  const paths = authorFields(t, config).map((f) => f.path);
  for (const p of ['template', 'sequence', 'seed', 'schedule.0.TC', 'schedule.0.ERY', 'schedule.1.time']) assert.ok(paths.includes(p), p);
  config = editAuthorField(t, config, 'template', 'ermcl'); assert.equal(config.sequence, ORFS.ermcl);
  config = editAuthorField(t, config, 'template', 'custom'); config = editAuthorField(t, config, 'sequence', 'MGIFSIFVISTVHYQPNKKAAA'); assert.equal(config.sequence, 'MGIFSIFVISTVHYQPNKKAAA');
  config = editAuthorField(t, config, 'schedule.0.ERY', '3'); config = editAuthorField(t, config, 'schedule.1.time', '20'); config = editAuthorField(t, config, 'schedule.1.ERY', '0');
  assert.deepEqual([config.schedule[0].ERY, config.schedule[1].time, config.schedule[1].ERY], [3, 20, 0]);
  assert.throws(() => editAuthorField(t, config, 'schedule.0.TC', '500'), /之间/); assert.throws(() => editAuthorField(t, config, 'template', 'nope'), /可选项/);
  assert.throws(() => editAuthorField(t, config, 'sequence', '123'), /至少要有 2 个/);
});
