import assert from 'node:assert/strict';
import test from 'node:test';
import { createPluginHost } from '../../../packages/plugin-host/index.mjs';
import { authorFields, editAuthorField, getPath } from '../../../packages/plugin-host/tool-model.mjs';
import { structurePlugin } from '../../structure/index.mjs';
import { toolPlugins, toolTitle, PROCESS_TOOL } from '../../mechanism-catalog.mjs';
import { normalizeProcessConfig, PROCESS_TEMPLATE } from '../process-tool.mjs';
import { readDisplay } from '../observer.mjs';
import { createMarkovRun } from '../markov-model.mjs';
import { kcsaMarkov } from './kcsa-markov.mjs';

async function tool() {
  const host = createPluginHost({ getScene: () => null, dispatch: () => {} });
  await host.activate(structurePlugin); for (const plugin of toolPlugins) await host.activate(plugin);
  return { host, tool: host.getTool(PROCESS_TOOL) };
}
const kcsaConfig = (extra = {}) => ({ process: kcsaMarkov, schedule: [{ time: 0, pH: 4.2 }], seed: 5, display: [
  { label: '外流 K⁺', kind: 'counter', name: 'out', digits: 0 }, { label: '估算电流', kind: 'current', out: 'out', inn: 'inn', ns: 'ns', digits: 2 }, { label: '开放比例', kind: 'observable', name: 'openFraction' },
  { label: '外流速率', kind: 'rate', name: 'out', window: 10, unit: '/s' }], ...extra });

test('the simulation plugin registers the stochastic process tool; deactivating it removes the tool; the template runs out of the box', async () => {
  const { host, tool: t } = await tool();
  assert.equal(t.runtime, 'layer-v1'); assert.deepEqual([...t.audience], ['view', 'author']); assert.ok(t.model.assumptions.length >= 3); assert.equal(toolTitle(PROCESS_TOOL), t.title);
  const cfg = normalizeProcessConfig(PROCESS_TEMPLATE), run = createMarkovRun(cfg.process, cfg.seed, cfg.schedule), s = run.at(60);
  assert.ok(s.counters.openings > 10 && s.observables.openFraction > 0.2 && s.observables.openFraction < 0.6, `${s.counters.openings} / ${s.observables.openFraction}`);
  await host.deactivate('org.glow.simulation'); assert.equal(host.getTool(PROCESS_TOOL), undefined);
});

test('the configuration is validated: the process must run, schedule entries are full valid parameter sets in rising time, display rows name real things', () => {
  const c = normalizeProcessConfig(kcsaConfig({ schedule: [{ time: 0, pH: 4.2 }, { time: 30, V: -60 }, { time: 60, pH: 7 }] }));
  assert.deepEqual([c.schedule[1].pH, c.schedule[1].V, c.schedule[2].V, c.schedule[2].pH], [4.2, -60, -60, 7], 'a missing value keeps the one before it');
  assert.equal(c.schedule[0].time, 0); assert.equal(c.display[1].unit, 'pA'); assert.equal(c.display[3].window, 10);
  assert.deepEqual(normalizeProcessConfig(c), c, 'idempotent');
  assert.throws(() => normalizeProcessConfig({ process: { version: 1 } }), /随机过程配置有误/);
  assert.throws(() => normalizeProcessConfig(kcsaConfig({ schedule: [{ time: 0 }, { time: 0 }] })), /时间必须大于/); assert.throws(() => normalizeProcessConfig(kcsaConfig({ schedule: [{ time: 0, pH: 99 }] })), /pH.*应在/);
  assert.throws(() => normalizeProcessConfig(kcsaConfig({ display: [{ kind: 'counter', name: 'zzz' }] })), /不存在的“zzz”/); assert.throws(() => normalizeProcessConfig(kcsaConfig({ display: [{ kind: 'weird' }] })), /种类/);
  assert.throws(() => normalizeProcessConfig(kcsaConfig({ display: [{ kind: 'current', out: 'out', inn: 'inn', ns: 'nope' }] })), /不存在/);
  assert.equal(normalizeProcessConfig(kcsaConfig({ seed: -3 })).seed, 7); assert.equal(normalizeProcessConfig(kcsaConfig({ schedule: undefined })).schedule.length, 1);
});

test('display rows read counters, observables, clocks, rates and the estimated current from a run', () => {
  const cfg = normalizeProcessConfig(kcsaConfig()), run = createMarkovRun(cfg.process, cfg.seed, cfg.schedule), s = run.at(100);
  assert.equal(readDisplay(run, cfg.display[0], 100), s.counters.out); assert.equal(readDisplay(run, cfg.display[2], 100), s.observables.openFraction); assert.equal(readDisplay(run, { kind: 'clock', name: 'ns' }, 100), s.clocks.ns);
  assert.ok(readDisplay(run, cfg.display[1], 100) > 0, 'positive voltage: outward current'); assert.ok(readDisplay(run, cfg.display[3], 100) >= 0);
  assert.equal(readDisplay(run, cfg.display[3], 0), 0); assert.throws(() => readDisplay(run, { kind: 'nope' }, 1), /没有这种显示项/);
});

test('Studio-style editing through the generic tool model: seed, starting parameters, a later change added in the blank slot, bad values refused', async () => {
  const { tool: t } = await tool();
  let config = normalizeProcessConfig(kcsaConfig());
  const paths = authorFields(t, config).map((f) => f.path);
  for (const p of ['seed', 'schedule.0.pH', 'schedule.0.V', 'schedule.0.wt', 'schedule.1.time']) assert.ok(paths.includes(p), p);
  assert.ok(!paths.includes('schedule.1.pH'), 'the blank slot only asks for the time');
  config = editAuthorField(t, config, 'schedule.0.V', '-40'); assert.equal(config.schedule[0].V, -40);
  config = editAuthorField(t, config, 'schedule.1.time', '45'); assert.deepEqual([config.schedule.length, config.schedule[1].time, config.schedule[1].V], [2, 45, -40]);
  config = editAuthorField(t, config, 'schedule.1.pH', '7'); assert.equal(config.schedule[1].pH, 7); assert.equal(config.schedule[0].pH, 4.2);
  config = editAuthorField(t, config, 'seed', '12'); assert.equal(config.seed, 12);
  assert.throws(() => editAuthorField(t, config, 'schedule.0.pH', '99'), /之间/); assert.throws(() => editAuthorField(t, config, 'schedule.1.time', '0.01'), /之间/); assert.throws(() => editAuthorField(t, config, 'schedule.0.wt', '0.5'), /整数/);
  assert.equal(getPath(config, 'schedule.0.pH'), 4.2);
});
