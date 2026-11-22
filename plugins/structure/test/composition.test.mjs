import assert from 'node:assert/strict';
import test from 'node:test';
import { compositionOf, CompositionError, CLASSES } from '../composition.mjs';

const names = ['ALA', 'LYS', 'ARG', 'ASP', 'GLY', 'SER', 'HOH'];
const model = () => ({ format: 'pdb', atoms: names.map((residueName, i) => ({ record: 'ATOM', serial: i + 1, element: 'C', name: 'CA', residueName, authChainId: 'A', labelChainId: 'A', authSeqId: String(i + 1), labelSeqId: String(i + 1), insertionCode: '', altLoc: '', modelId: '1', position: [i * 3.8, 0, 0] })) });

test('residues are counted by kind; GRAVY is the mean hydropathy and the net charge counts Lys/Arg minus Asp/Glu', () => {
  const out = compositionOf(model(), 'resi 1-6');
  assert.deepEqual(out.classes, { hydrophobic: 1, polar: 1, positive: 2, negative: 1, special: 1 }); assert.deepEqual([out.selected, out.protein, out.other], [6, 6, 0]);
  assert.equal(out.netCharge, 1, '+1 +1 −1'); assert.equal(out.gravy.toFixed(3), ((1.8 - 3.9 - 4.5 - 3.5 - 0.4 - 0.8) / 6).toFixed(3));
  assert.deepEqual(out.byName, { ALA: 1, LYS: 1, ARG: 1, ASP: 1, GLY: 1, SER: 1 });
  assert.deepEqual(Object.keys(CLASSES), ['hydrophobic', 'polar', 'positive', 'negative', 'special']);
});

test('unknown residues are reported but not counted in the protein figures; nothing selected or unreadable says why', () => {
  const out = compositionOf(model(), 'resi 6-7'); assert.ok(out.selected >= 1);
  assert.throws(() => compositionOf(model(), 'resi 99'), (e) => e instanceof CompositionError && /没有选中/.test(e.message)); assert.throws(() => compositionOf(model(), 'banana'), CompositionError);
  const none = compositionOf({ format: 'pdb', atoms: [{ ...model().atoms[0], residueName: 'XYZ' }] }, 'all'); assert.deepEqual([none.protein, none.other, none.gravy, none.netCharge], [0, 1, null, null]);
});

import { describe as describeResult, resultData, compositionPanel } from '../panels/composition-panel.mjs';
import { validatePanel } from '../../../packages/plugin-host/panels.mjs';
test('the panel says what was counted, keeps conclusions only, and passes the panel rules', () => {
  const out = compositionOf(model(), 'resi 1-6'), lines = describeResult(out);
  assert.match(lines[0], /6 个氨基酸残基/); assert.ok(lines.some((l) => /带正电：2（33%）/.test(l))); assert.match(lines.at(-1), /GRAVY：-1\.88.*净电荷：\+1/);
  assert.deepEqual(resultData(out, 'resi 1-6'), { part: 'resi 1-6', residues: 6, classes: out.classes, gravy: -1.883, netCharge: 1 });
  assert.match(describeResult(compositionOf({ format: 'pdb', atoms: [{ ...model().atoms[0], residueName: 'XYZ' }] }, 'all'))[0], /没有可统计的氨基酸/);
  assert.deepEqual(validatePanel(compositionPanel).needs, ['structure', 'selection']);
});
