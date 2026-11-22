import assert from 'node:assert/strict';
import test from 'node:test';
import { summarize, interfaceRules, resultData, contactsPanel, SIDE_COLORS } from '../panels/contacts-panel.mjs';
import { contactsBetween } from '../contacts.mjs';
import { validatePanel } from '../../../packages/plugin-host/panels.mjs';

let serial = 1;
const atom = (chain, seq, x, y) => ({ record: 'ATOM', serial: serial++, element: 'C', name: 'CA', residueName: 'GLY', authChainId: chain, labelChainId: chain, authSeqId: String(seq), labelSeqId: String(seq), insertionCode: '', altLoc: '', modelId: '1', position: [x, y, 0] });
const model = () => ({ format: 'pdb', atoms: [atom('A', 1, 0, 0), atom('A', 2, 10, 0), atom('B', 1, 0, 3.5), atom('B', 2, 10, 30)] });

test('the panel descriptor passes the panel rules and asks for a structure and a selection', () => {
  const panel = validatePanel(contactsPanel); assert.deepEqual(panel.needs, ['structure', 'selection']); assert.equal(panel.id, 'org.glow.panel.contacts');
});

test('the summary says what was found, or that nothing was; the rules paint A orange and B blue; the saved data holds conclusions only', () => {
  const found = contactsBetween(model(), 'chain A', 'chain B'), none = contactsBetween(model(), 'chain A', 'chain B', { cutoff: 1 });
  assert.match(summarize(found), /共 1 对残基接触（重原子 ≤ 4.5 Å）；最近 3.50 Å（GLY A:1 CA — GLY B:1 CA）/); assert.match(summarize(none), /没有 ≤ 1 Å/);
  assert.deepEqual(interfaceRules(found), [{ expr: 'chain A and resi 1', color: SIDE_COLORS.a }, { expr: 'chain B and resi 1', color: SIDE_COLORS.b }]);
  assert.deepEqual(resultData(found, 'chain A', 'chain B'), { a: 'chain A', b: 'chain B', cutoff: 4.5, pairs: 1, interfaceA: 1, interfaceB: 1, nearest: 3.5 }); assert.equal(resultData(none, 'x', 'y').nearest, null);
});

import { bondLines, typedSummary, residueExpression } from '../panels/contacts-panel.mjs';
test('typed lines are drawn for salt bridges and hydrogen bonds only, each end naming one residue and one atom; the summary names the counts and the limits', () => {
  const r = (chain, seq, resn, asym = chain) => ({ chain, asym, authSeq: seq, insertion: '', resn });
  const found = { counts: { salt: 1, hbond: 1, hydrophobic: 1 }, interactions: [
    { type: 'salt', a: r('A', 1, 'ASP'), b: r('B', 1, 'LYS'), atomA: 'OD1', atomB: 'NZ', distance: 3.0 },
    { type: 'hbond', a: r('A', 2, 'SER'), b: r('B', 2, 'ASN'), atomA: 'OG', atomB: 'OD1', distance: 2.8 },
    { type: 'hydrophobic', a: r('A', 3, 'LEU'), b: r('B', 3, 'ILE'), atomA: 'CD1', atomB: 'CD1', distance: 3.8 }] };
  assert.deepEqual(bondLines(found), [{ a: { expr: 'chain A and resi 1', atom: 'OD1' }, b: { expr: 'chain B and resi 1', atom: 'NZ' }, type: 'salt' }, { a: { expr: 'chain A and resi 2', atom: 'OG' }, b: { expr: 'chain B and resi 2', atom: 'OD1' }, type: 'hbond' }]);
  assert.equal(bondLines(found, 1).length, 1); assert.match(typedSummary(found), /没有角度判据.*盐桥 1、氢键 1、疏水接触 1。.*最近的是盐桥 ASP A:1 OD1 — LYS B:1 NZ，3\.00 Å/);
  assert.equal(residueExpression(r('A', 7, 'GLY', 'A_2')), 'asym A_2 and resi 7'); assert.equal(residueExpression({ ...r('A', 52, 'GLY'), insertion: 'A' }), 'chain A and resi 52A');
});
