import assert from 'node:assert/strict';
import test from 'node:test';
import { drawAnnotations, clearAnnotations, ANNOTATION_LINES, ANNOTATION_TEXTS } from '../annotation-draw.mjs';

const fakeViewport = () => { const calls = {}; return { calls, setOverlayLines: (tag, items, opts) => { calls[tag] = { items, opts }; }, setParticleCloud: (tag, items, opts) => { calls[tag] = { items, opts }; } }; };

test('nothing to draw clears both layers and reports no problems', () => {
  const viewport = fakeViewport();
  assert.deepEqual(drawAnnotations(viewport, null, { labels: [{ expr: 'all' }] }, (p) => p), []);
  assert.deepEqual(drawAnnotations(viewport, {}, {}, (p) => p), []);
  assert.deepEqual(viewport.calls[ANNOTATION_LINES].items, []); assert.deepEqual(viewport.calls[ANNOTATION_TEXTS].items, []);
  clearAnnotations(viewport);
});

const model = () => ({ format: 'pdb', atoms: [[0, 0, 0], [10, 0, 0], [20, 0, 0]].map((position, i) => ({ record: 'ATOM', serial: i + 1, element: 'C', name: 'CA', residueName: 'ALA', authChainId: 'A', labelChainId: 'A', authSeqId: String(i + 1), labelSeqId: String(i + 1), insertionCode: '', altLoc: '', modelId: '1', position })) });

test('measurements become dashed lines and labelled dots in scene coordinates; a rule that selects nothing is reported and skipped', () => {
  const viewport = fakeViewport(), scale = (p) => p.map((v) => v * 0.05);
  const problems = drawAnnotations(viewport, model(), { measures: [{ points: ['resi 1', 'resi 3'] }], labels: [{ expr: 'resi 2', text: '活性位点' }, { expr: 'resi 99' }] }, scale);
  assert.deepEqual(problems.map((p) => [p.kind, p.index]), [['label', 1]]);
  const { items: lines, opts } = viewport.calls[ANNOTATION_LINES]; assert.deepEqual(lines.map(({ a, b }) => [a, b]), [[[0, 0, 0], [1, 0, 0]]]); assert.ok(opts.dash > 0 && opts.gap > 0);
  const dots = viewport.calls[ANNOTATION_TEXTS].items; assert.deepEqual(dots.map((d) => d.label), ['20.00 Å', '活性位点']); assert.deepEqual(dots[1].position, [0.5, 0, 0]); assert.equal(viewport.calls[ANNOTATION_TEXTS].opts.overlay, true);
});
