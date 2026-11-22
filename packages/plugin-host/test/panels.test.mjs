import assert from 'node:assert/strict';
import test from 'node:test';
import { validatePanel, createPanelRegistry, createPanelContext, panelReadiness, PanelError, MAX_DATA_BYTES } from '../panels.mjs';

const descriptor = (extra = {}) => ({ id: 'org.glow.panel.demo', title: '演示', mount() {}, ...extra });
const recording = () => { const log = []; const host = { model: () => ({ m: 1 }), selection: () => ({ expression: 'chain A', residues: [] }), readData: () => ({ n: 1 }), writeData: (...a) => log.push(['data', ...a]), applyLook: (...a) => log.push(['look', ...a]), annotate: (...a) => log.push(['annotate', ...a]), addEvidence: (...a) => log.push(['evidence', ...a]), highlight: (r) => log.push(['highlight', r]), status: (t) => log.push(['status', t]), evidenceFrom: () => log.filter(([k]) => k === 'evidence').length }; return { host, log }; };

test('a panel descriptor is checked, copied and frozen; a bad one says what is wrong', () => {
  const panel = validatePanel(descriptor({ summary: '  说明  ', needs: ['structure', 'selection'] }));
  assert.deepEqual([panel.id, panel.title, panel.summary, panel.needs], ['org.glow.panel.demo', '演示', '说明', ['structure', 'selection']]); assert.ok(Object.isFrozen(panel) && Object.isFrozen(panel.needs));
  for (const [bad, pattern] of [[null, /对象/], [descriptor({ id: 'Demo' }), /不合法/], [descriptor({ title: '' }), /标题/], [descriptor({ title: 'x'.repeat(25) }), /标题/], [descriptor({ needs: ['network'] }), /needs/], [descriptor({ mount: 1 }), /mount/], [descriptor({ summary: 'x'.repeat(201) }), /说明/]]) assert.throws(() => validatePanel(bad), (e) => e instanceof PanelError && pattern.test(e.message));
  assert.deepEqual(validatePanel(descriptor()).needs, ['structure'], 'a panel needs a structure unless it says otherwise');
});

test('the registry keeps unique ids in order and can let one go', () => {
  const registry = createPanelRegistry(), off = registry.register(descriptor()); registry.register(descriptor({ id: 'org.glow.panel.other' }));
  assert.deepEqual(registry.list().map((p) => p.id), ['org.glow.panel.demo', 'org.glow.panel.other']); assert.throws(() => registry.register(descriptor()), /已经注册过/);
  off(); assert.equal(registry.get('org.glow.panel.demo'), undefined); assert.equal(registry.list().length, 1);
});

test('a panel writes only through the four doors, each checked: look, annotations, evidence, its own data', () => {
  const { host, log } = recording(), api = createPanelContext(validatePanel(descriptor()), host);
  assert.deepEqual(api.data(), { n: 1 }); assert.deepEqual(api.model(), { m: 1 });
  api.setData({ contacts: 12 }); api.applyLook({ colors: { residues: [{ expr: 'resi 1-5', color: '#e05a4a' }] } }); api.annotate({ labels: [{ expr: 'resi 3' }] });
  assert.deepEqual(log.map(([k]) => k), ['data', 'look', 'annotate']); assert.deepEqual(log[0].slice(1, 3), ['org.glow.panel.demo', { contacts: 12 }], 'the data goes to the panel’s own namespace');
  assert.throws(() => api.applyLook({ camera: {} }), /只接受/); assert.throws(() => api.applyLook([]), /只接受/); assert.throws(() => api.annotate({ colors: {} }), /只接受/);
  assert.throws(() => api.setData({ big: 'x'.repeat(MAX_DATA_BYTES) }), /太大/); const loop = {}; loop.self = loop; assert.throws(() => api.setData(loop), /普通的 JSON/);
  assert.ok(Object.isFrozen(api), 'the panel cannot add to its own door');
});

test('a plugin result can only be recorded as derived or modelled, always with its method and name, and never in bulk', () => {
  const { host, log } = recording(), api = createPanelContext(validatePanel(descriptor()), host);
  api.addEvidence({ method: '重原子 4.5 Å 内的接触', citation: 'Shrake & Rupley 1973' });
  const [, entry] = log.at(-1); assert.equal(entry.type, 'derived'); assert.match(entry.citation, /演示（org\.glow\.panel\.demo）：重原子 4\.5 Å 内的接触；Shrake & Rupley 1973/); assert.equal(entry.source, 'org.glow.panel.demo');
  api.addEvidence({ type: 'modelled', method: '叠合' }); assert.equal(log.at(-1)[1].type, 'modelled');
  assert.throws(() => api.addEvidence({ type: 'source', method: 'x' }), /不能冒充实测/); assert.throws(() => api.addEvidence({ type: 'experimental', method: 'x' }), /不能冒充实测/);
  assert.throws(() => api.addEvidence({}), /写明方法/); assert.throws(() => api.addEvidence({ method: 'x'.repeat(201) }), /写明方法/); assert.throws(() => api.addEvidence({ method: 'm', citation: 'x'.repeat(301) }), /引用最多/);
  for (let i = 0; i < 6; i++) api.addEvidence({ method: `m${i}` }); assert.throws(() => api.addEvidence({ method: 'one too many' }), /最多记 8 条/);
});

test('whether a panel can be used: what it needs must be open', () => {
  const both = validatePanel(descriptor({ needs: ['structure', 'selection'] })), none = validatePanel(descriptor({ needs: [] }));
  assert.deepEqual(panelReadiness(both, { hasStructure: false, hasSelection: false }), { ready: false, reason: '先导入或打开一个结构。' }); assert.match(panelReadiness(both, { hasStructure: true, hasSelection: false }).reason, /选择语言/);
  assert.deepEqual(panelReadiness(both, { hasStructure: true, hasSelection: true }), { ready: true, reason: '' }); assert.equal(panelReadiness(none, {}).ready, true);
});

test('placing a chain takes a unit rotation and a bounded shift, or a reset; nothing else', () => {
  const { host, log } = recording(); host.placePart = (...a) => log.push(['place', ...a]);
  const api = createPanelContext(validatePanel(descriptor()), host), q = [0, 0, Math.sin(0.3), Math.cos(0.3)];
  api.placePart({ chain: 'B', quaternion: q, from: [0, 0, 0], to: [1, 2, 3] }); assert.deepEqual(log.at(-1).slice(1, 2), [{ chain: 'B', quaternion: q, from: [0, 0, 0], to: [1, 2, 3] }]);
  api.placePart({ chain: 'B', reset: true }); assert.deepEqual(log.at(-1)[1], { chain: 'B', reset: true });
  for (const bad of [null, {}, { chain: '', quaternion: q, from: [0, 0, 0], to: [0, 0, 0] }, { chain: 'B', quaternion: [0, 0, 0, 2], from: [0, 0, 0], to: [0, 0, 0] }, { chain: 'B', quaternion: q, from: [0, 0], to: [0, 0, 0] }, { chain: 'B', quaternion: q, from: [0, 0, 0], to: [NaN, 0, 0] }, { chain: 'B', quaternion: q, from: [0, 0, 0], to: [5000, 0, 0] }, { chain: 'B', quaternion: q, from: [0, 0, 0], to: [0, 0, 0], extra: 1 }]) assert.throws(() => api.placePart(bad), PanelError, JSON.stringify(bad));
});
