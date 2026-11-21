import test from 'node:test';
import assert from 'node:assert/strict';
import { MBP_1OMP_1ANF_TEMPLATE } from '../templates.mjs';
import { normalizeAdkConfig, ADK_4AKE_TEMPLATE } from '../config.mjs';
import { adkToolDescriptor } from '../tool.mjs';
import { validateToolDescriptor } from '../../../packages/plugin-host/tool-descriptor.mjs';

test('the maltose-binding protein template is a valid configuration whose domains cover every residue once', () => {
  const cfg = normalizeAdkConfig(MBP_1OMP_1ANF_TEMPLATE);
  assert.deepEqual([cfg.states.open, cfg.states.closed, cfg.protein.residues, cfg.fitDomain], ['1OMP', '1ANF', 370, 'N']);
  const covered = new Map();
  for (const { ranges } of cfg.domains) for (const [lo, hi] of ranges) for (let r = lo; r <= hi; r++) covered.set(r, (covered.get(r) ?? 0) + 1);
  assert.equal(covered.size, 370, 'residues 1-370 all belong to a domain');
  assert.ok([...covered.values()].every((n) => n === 1), 'and to only one');
  assert.equal(cfg.steps.length, 4);
});

test('it is offered as a preset of the same tool as adenylate kinase, and the default template is unchanged', () => {
  const tool = validateToolDescriptor('org.glow.tool.conformation-pair', adkToolDescriptor('1.0.0', 'org.glow.legacy-process.adenylate-kinase'));
  assert.deepEqual(tool.author.presets.map(({ id }) => id), ['mbp']);
  assert.equal(tool.author.template, ADK_4AKE_TEMPLATE);
});
