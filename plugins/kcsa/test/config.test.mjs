import assert from 'node:assert/strict';
import test from 'node:test';
import { buildKcsaStructure } from '../structure.mjs';
import { prepareKcsa, createKcsaPlayer } from '../index.mjs';
import { KCSA_1K4C_TEMPLATE, normalizeKcsaConfig } from '../config.mjs';
import { kcsaFixture } from './fixture.mjs';

// Another tetrameric potassium channel: different numbering, structure ids, name, blocker residues and wording.
const OTHER = { shift: 40, partName: 'Inward rectifier potassium channel', ids: ['A1', 'B2', 'C3', 'D4', 'E5'], tba: 'XYZ', ba: 'ZZ' };
const OTHER_CONFIG = {
  id: 'kir-demo',
  states: { primary: 'A1', open: 'B2', inactivated: 'C3', tba: 'D4', barium: 'E5' },
  protein: { namePattern: 'inward rectifier', chains: 4 },
  pore: { fitRange: [100, 120], filterResidues: [115, 119] },
  blockers: { tba: { residue: 'XYZ', name: '阻断剂X', color: '#112233' }, barium: { residue: 'ZZ', name: '钡离子', color: '#445566' } },
  particles: { potassium: { name: '钾', color: '#778899' }, sodium: { name: '钠（排斥）', color: '#99aabb' } },
  counterLabels: { out: '钾 外流', in: '钾 内流', sodium: '钠 排斥' },
  conditions: { pH: 6, V: 30 },
  steps: [1, 2, 3, 4, 5, 6].map((n) => ({ title: `步骤${n}`, caption: `第${n}步说明` })),
  navigation: { idPrefix: 'kir', systemTitle: 'Kir 系统', proteinTitle: 'Kir 四聚体', mechanismTitle: 'Kir 门控' },
  evidence: { citation: 'Kir 演示', note: '仅为软件测试用的合成数据。' },
};

test('another channel needs configuration only: other numbering, ids, names and blockers give the same dynamics', async () => {
  const defaultInput = kcsaFixture(), otherInput = kcsaFixture(OTHER);
  assert.throws(() => buildKcsaStructure(otherInput.model, otherInput.states), /缺少构象结构 1K4C/, 'the default template names what is missing');
  const structure = buildKcsaStructure(otherInput.model, otherInput.states, OTHER_CONFIG);
  assert.deepEqual(Object.keys(structure.fits), ['B2', 'C3', 'D4', 'E5']);
  assert.deepEqual(Object.keys(structure.sites).sort(), ['S0', 'S1', 'S2', 'S3', 'S4', 'cav']);
  const config = { ...OTHER_CONFIG, conditions: {} };   // same conditions as the default work so the dynamics can be compared
  const a = createKcsaPlayer({ ...defaultInput, state: { seed: 3 } }), b = createKcsaPlayer({ ...otherInput, state: { seed: 3 }, config });
  for (const time of [2, 20, 60, 119]) {
    const x = a.seek(time), y = b.seek(time);
    assert.deepEqual(Object.values(y.counters), Object.values(x.counters));
    assert.equal(y.gate, x.gate);
    assert.deepEqual(y.events, x.events);
  }
  assert.deepEqual(Object.keys(b.seek(60).counters), ['钾 外流', '钾 内流', '钠 排斥']);
  assert.deepEqual(b.snapshot().particles.map(({ name }) => name), ['钾', '钾', '钾', '钠（排斥）', '阻断剂X', '钡离子']);
  assert.equal(b.snapshot().particles[0].color, '#778899');
  assert.deepEqual(b.steps.map(({ title }) => title), ['步骤1', '步骤2', '步骤3', '步骤4', '步骤5', '步骤6']);
  assert.deepEqual(b.navigation.views.map(({ id }) => id), ['kir-system', 'kir-protein', 'kir-mechanism']);
  assert.match(b.evidence.details, /^孔区 100–120 四链叠合 RMSD（Å）：B2 .*；C3 .*；D4 .*；E5 .*。仅为软件测试用的合成数据。$/);
  assert.equal(b.evidence.citation, 'Kir 演示');
  assert.doesNotMatch(JSON.stringify([b.steps, b.navigation, b.evidence, b.snapshot().counters]), /KcsA|1K4C|5VK6|TBA|Ba²⁺/);
});

test('initial experimental conditions come from the configuration and are validated by the kinetics model', () => {
  const input = kcsaFixture(OTHER);
  const player = createKcsaPlayer({ ...input, state: { seed: 3 }, config: OTHER_CONFIG });
  assert.equal(player.seek(0).parameters.pH, 6);
  assert.equal(player.snapshot().parameters.V, 30);
  assert.equal(createKcsaPlayer({ ...kcsaFixture(), state: { seed: 3 } }).seek(0).parameters.pH, 4, 'the default template keeps the classic conditions');
  assert.throws(() => normalizeKcsaConfig({ conditions: { pH: 9 } }), /KcsA 参数 pH 无效/);
  assert.throws(() => normalizeKcsaConfig({ conditions: { speedy: 1 } }), /KcsA 参数 speedy 无效/);
});

test('preparation downloads and stores the states named in the configuration', async () => {
  const requested = [];
  const loaded = { scene: { legacy: { scene: { id: 'A1' } }, assets: [{ id: 'p', kind: 'file', path: 'assets/p.cif', mediaType: 'chemical/x-mmcif', provenance: { parserVersion: '1' } }] },
    resources: new Map([['assets/p.cif', new Uint8Array([1])]]) };
  const args = { loaded, config: OTHER_CONFIG, signal: new AbortController().signal, parse: (c) => ({ n: c.bytes.length }),
    loadAccession: async (id) => { requested.push(id); return { bytes: new Uint8Array([2, 3]), source: { provider: 'test', accession: id } }; } };
  await prepareKcsa(args);
  assert.deepEqual(requested, ['B2', 'C3', 'D4', 'E5']);
  assert.deepEqual(loaded.scene.assets.slice(1).map(({ id, path }) => [id, path]),
    [['kcsa-state-B2', 'assets/kcsa/B2.cif'], ['kcsa-state-C3', 'assets/kcsa/C3.cif'], ['kcsa-state-D4', 'assets/kcsa/D4.cif'], ['kcsa-state-E5', 'assets/kcsa/E5.cif']]);
  const wrongPrimary = { ...args, loaded: { scene: { legacy: { scene: { id: '1K4C' } }, assets: loaded.scene.assets.slice(0, 1) }, resources: loaded.resources } };
  await assert.rejects(prepareKcsa(wrongPrimary), /KcsA 播放器需要 A1 主结构/);
});

test('an invalid KcsA work configuration is rejected with the offending field named', () => {
  const make = (config) => () => normalizeKcsaConfig(config);
  assert.throws(make('x'), /配置必须是对象/);
  assert.throws(make({ states: { open: '1K4C' } }), /不能重复/);
  assert.throws(make({ protein: { namePattern: '(' } }), /namePattern 不是有效的正则/);
  assert.throws(make({ protein: { chains: 1 } }), /protein\.chains/);
  assert.throws(make({ pore: { fitRange: [80, 60] } }), /pore\.fitRange 必须是/);
  assert.throws(make({ pore: { filterResidues: [75] } }), /pore\.filterResidues 必须是/);
  assert.throws(make({ pore: { maxFitRmsd: 0 } }), /pore\.maxFitRmsd/);
  assert.throws(make({ blockers: { tba: { residue: 'TBA', name: 'TBA', color: 'orange' } } }), /blockers\.tba\.color/);
  assert.throws(make({ particles: { sodium: 'Na' } }), /particles\.sodium 必须是对象/);
  assert.throws(make({ steps: KCSA_1K4C_TEMPLATE.steps.slice(0, 5) }), /steps 必须是 6–6 项/);
  assert.throws(make({ membrane: { radius: 0 } }), /membrane\.radius/);
  assert.throws(() => { KCSA_1K4C_TEMPLATE.states.primary = 'x'; }, TypeError, 'the built-in template is frozen');
});

test('a fit worse than the configured limit is refused with that limit in the message', () => {
  const input = kcsaFixture();
  assert.throws(() => buildKcsaStructure(input.model, input.states, { pore: { maxFitRmsd: 0.05 } }), /孔区叠合失败或 RMSD 超过 0\.05 Å/);
});
