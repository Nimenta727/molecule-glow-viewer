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
