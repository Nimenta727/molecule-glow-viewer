import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeEnergy, litStep, ENERGY_LIMITS } from '../energy-strip.mjs';
import { normalizeDataConfig, dataAuthorFields } from '../data-tool.mjs';
import { mechanismWorkConfig } from '../works/mechanism-works.mjs';
import { MECHANISM_ENERGY } from '../works/mechanism-energy.mjs';

const steps = [{ label: '甲', text: '第一步', select: 'entity "甲"' }, { label: '乙', text: '第二步' }, { label: '丙', text: '第三步' }, { label: '丁', text: '第四步' }];

test('a declaration is validated by name and clamped; absent means no strip', () => {
  assert.deepEqual(normalizeEnergy(undefined), { energy: undefined, errors: [] });
  const { energy } = normalizeEnergy({ steps, stage: { mode: 'cycle', period: 1 } });
  assert.deepEqual(energy.stage, { mode: 'cycle', period: ENERGY_LIMITS.minPeriod });      // clamped to the shortest round
  assert.equal(energy.steps[1].select, undefined);
  assert.deepEqual(normalizeEnergy({ steps }).energy.stage, { mode: 'manual' });
  assert.equal(normalizeEnergy({ steps: [] }).errors.length, 1);
  assert.match(normalizeEnergy({ steps: [{ label: '', text: 'x' }] }).errors[0], /第 1 步缺少名称/);
  assert.match(normalizeEnergy({ steps, stage: { mode: 'spin' } }).errors[0], /stage\.mode/);
  assert.match(normalizeEnergy({ steps: Array(13).fill(steps[0]) }).errors[0], /最多 12/);
  assert.match(normalizeEnergy({ steps: [{ label: 'a', text: 'x'.repeat(ENERGY_LIMITS.text + 1) }] }).errors[0], /讲解超过/);
  assert.equal(normalizeEnergy('x').errors.length, 1);
});

test('cycle mode lights the steps in turn on the animation clock; manual mode and a bad clock light none', () => {
  const { energy } = normalizeEnergy({ steps, stage: { mode: 'cycle', period: 8 } });      // 2 s per step
  assert.deepEqual([0, 1.9, 2, 3.9, 4, 7.99, 8, 9, 17].map((t) => litStep(energy, t)), [0, 0, 1, 1, 2, 3, 0, 0, 0]);
  assert.equal(litStep(normalizeEnergy({ steps }).energy, 3), -1);
  for (const t of [-1, NaN, Infinity, undefined]) assert.equal(litStep(energy, t), -1);
  assert.equal(litStep(undefined, 1), -1);
});

test('the data tool keeps the strip in its configuration and reports a bad one by name; Studio gets a field per step', () => {
  const base = { animation: { version: 1, compartments: { 溶液: {} }, pools: [], flows: [], reactions: [] } };
  const config = normalizeDataConfig({ ...base, energy: { steps, stage: { mode: 'cycle', period: 12 } } });
  assert.equal(config.energy.steps.length, 4);
  assert.deepEqual(normalizeDataConfig(config), config);                                    // normalising is idempotent
  assert.throws(() => normalizeDataConfig({ ...base, energy: { steps: [] } }), /能量转化条有误/);
  assert.equal('energy' in normalizeDataConfig(base), false);
  const paths = dataAuthorFields(config).filter((f) => f.group === '能量转化条').map((f) => f.path);
  assert.deepEqual(paths.slice(0, 2), ['energy.stage.mode', 'energy.stage.period']);
  assert.ok(paths.includes('energy.steps.3.text') && paths.includes('energy.steps.0.select'));
});

test('the classic works carry the classic strips: counts, texts, and highlight expressions that parse', async () => {
  const { parseSelection } = await import('../../structure/selection.mjs');
  const respirasome = normalizeDataConfig(mechanismWorkConfig({ process: 'respiratoryChain', membranes: [{ at: 'x', offset: 0 }] }));
  const chloroplast = normalizeDataConfig(mechanismWorkConfig({ process: 'chloroplast' })), flagellum = normalizeDataConfig(mechanismWorkConfig({ process: 'flagellarMotor' }));
  assert.deepEqual([respirasome, chloroplast, flagellum].map((c) => c.energy.steps.length), [7, 7, 5]);
  assert.match(respirasome.energy.steps[6].text, /2\.7 个 ATP \/ NADH/);                    // the one ATP-per-NADH explanation of the classic
  for (const work of Object.values(MECHANISM_ENERGY)) for (const step of work.steps) { assert.ok(step.label && step.text); if (step.select) parseSelection(step.select); }
  assert.notStrictEqual(mechanismWorkConfig({ process: 'chloroplast' }).energy, MECHANISM_ENERGY.chloroplast);   // a copy: editing a work never edits the shared data
});
