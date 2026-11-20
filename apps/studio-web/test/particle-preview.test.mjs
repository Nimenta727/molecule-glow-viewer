import assert from 'node:assert/strict';
import test from 'node:test';
import { createParticlePreview } from '../particle-preview.mjs';
import { parsePdb } from '../../../plugins/structure/parser.mjs';
import { SOLUTION_TEMPLATE } from '../../../plugins/motion/solution-tool.mjs';
import { DATA_TEMPLATE } from '../../../plugins/simulation/data-tool.mjs';

// a small structure: two chains of 60 residues each along a gently curved line, as a PDB file
const pad = (value, width, right = false) => (right ? String(value).padEnd(width) : String(value).padStart(width));
const atoms = [];
for (const [chain, x0] of [['A', 0], ['B', 40]]) for (let i = 0; i < 60; i++) {
  const n = atoms.length + 1;
  atoms.push(`ATOM  ${pad(n, 5)}  CA  ALA ${chain}${pad(i + 1, 4)}    ${pad((x0 + 3 * Math.cos(i / 4) * 5).toFixed(3), 8)}${pad((i * 1.5).toFixed(3), 8)}${pad((3 * Math.sin(i / 4) * 5).toFixed(3), 8)}  1.00 20.00           C`);
}
const model = parsePdb(atoms.join('\n'));

function rig(tools) {
  const calls = new Map(), notes = [], scene = { tools };
  const viewport = { setParticleCloud: (tag, items) => calls.set(tag, items), setEventTags: () => {} };
  let queued = null;
  const preview = createParticlePreview({ viewport, getScene: () => scene, getModel: () => model, note: (t) => notes.push(t), schedule: (f) => (queued = f, 1), cancel: () => { queued = null; } });
  return { preview, calls, notes, scene };
}
const entry = (id, config) => ({ id, tool: { id: `org.glow.tool.${id}`, version: '1.0.0' }, config });

test('the solution-particles tool is previewed: pools appear around the structure, every particle named, and they move with the clock', () => {
  const { preview, calls, notes } = rig([entry('solution-particles', { ...SOLUTION_TEMPLATE, pools: [{ species: 'H⁺', n: 12 }, { species: 'K⁺', n: 6 }] })]);
  assert.deepEqual(preview.available(), ['solution-particles']);
  preview.start();
  const first = calls.get('solution').map((i) => i.position.join());
  assert.ok(first.length >= 10, `${first.length} particles`);
  assert.ok(calls.get('solution').every((i) => i.name && i.radius > 0 && i.position.every(Number.isFinite)));
  for (let i = 0; i < 30; i++) preview.advance(0.1);
  assert.notDeepEqual(calls.get('solution').map((i) => i.position.join()), first, 'they moved');
  assert.match(notes.at(-1), /预览：溶液粒子/);
  preview.stop();
  assert.equal(calls.get('solution').length, 0, 'stopping removes them');
});

test('the data-animation tool is previewed too, and editing the configuration rebuilds the preview on the next sync', () => {
  const { preview, calls, scene } = rig([entry('data-animation', DATA_TEMPLATE)]);
  assert.deepEqual(preview.available(), ['data-animation']);
  preview.start();
  for (let i = 0; i < 20; i++) preview.advance(0.1);
  const before = calls.get('data-pool').length;
  assert.ok(before > 0 && calls.get('data-pool').every((i) => i.name));
  scene.tools[0] = entry('data-animation', { ...DATA_TEMPLATE, animation: { ...DATA_TEMPLATE.animation, pools: [{ species: 'ATP', in: '溶液', n: 3 }] } });
  preview.sync();
  assert.ok(calls.get('data-pool').length < before, 'the edited pool is smaller');
});

test('with no previewable tool, or no structure yet, the preview says so and draws nothing', () => {
  const none = rig([]); none.preview.start();
  assert.match(none.notes.at(-1), /没有粒子或数据动画工具/); assert.equal(none.preview.running, false);
  const calls = new Map(), notes = [];
  const waiting = createParticlePreview({ viewport: { setParticleCloud: (t, i) => calls.set(t, i) }, getScene: () => ({ tools: [entry('solution-particles', SOLUTION_TOOL_PLACEHOLDER())] }), getModel: () => undefined, note: (t) => notes.push(t), schedule: () => 1, cancel: () => {} });
  waiting.start(); assert.match(notes.at(-1), /结构还在解析/); assert.equal(waiting.advance(0.1), false);
});
function SOLUTION_TOOL_PLACEHOLDER() { return { ...SOLUTION_TEMPLATE }; }
