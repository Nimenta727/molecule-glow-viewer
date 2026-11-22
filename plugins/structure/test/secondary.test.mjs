import assert from 'node:assert/strict';
import test from 'node:test';
import { secondaryOf, SecondaryError } from '../secondary.mjs';

// chain A, residues 1-12 (label_seq 1-12) except 6 missing (a gap); helix 2-4, strand 8-10
const seq = ['ALA', 'GLY', 'LEU', 'LYS', 'SER', null, 'VAL', 'ILE', 'THR', 'TRP', 'ASP', 'GLU'];
const model = () => ({ format: 'pdb', secondaryStructure: [{ type: 'helix', chainId: 'A', from: '2', to: '4', numbering: 'auth' }, { type: 'sheet', chainId: 'A', from: '8', to: '10', numbering: 'auth' }],
  atoms: seq.flatMap((residueName, i) => (residueName ? [{ record: 'ATOM', serial: i + 1, element: 'C', name: 'CA', residueName, authChainId: 'A', labelChainId: 'A', authSeqId: String(i + 1), labelSeqId: String(i + 1), insertionCode: '', altLoc: '', modelId: '1', position: [i * 3.8, 0, 0] }] : [])) });

test('sequence, structure line and segments come from the deposited secondary structure, with a gap marked', () => {
  const out = secondaryOf(model(), 'chain A'), [chain] = out.chains;
  assert.equal(out.chains.length, 1); assert.deepEqual([chain.label, chain.residues], ['A', 11]);
  assert.equal(chain.sequence, 'AGLKS/VITWDE'); assert.equal(chain.structure, '-HHH-/-EEE--');
  assert.deepEqual(chain.segments.map(({ type, from, to, length }) => [type, from, to, length]), [['helix', 2, 4, 3], ['sheet', 8, 10, 3]]); assert.equal(chain.segments[0].expr, 'chain A and resi 2-4');
  assert.deepEqual([chain.helix, chain.sheet], [3, 3]);
});

test('only the chosen residues are shown; nothing chosen or unreadable says why', () => {
  const part = secondaryOf(model(), 'chain A and resi 3-9').chains[0]; assert.equal(part.sequence, 'LKS/VIT'); assert.equal(part.structure, 'HH-/-EE', 'helix 3-4, then the gap, strand 8-9');
  assert.throws(() => secondaryOf(model(), 'resi 99'), (e) => e instanceof SecondaryError && /没有选中/.test(e.message)); assert.throws(() => secondaryOf(model(), 'banana'), SecondaryError);
});

import { blocks, share, resultData, secondaryPanel, LINE } from '../panels/secondary-panel.mjs';
import { validatePanel } from '../../../packages/plugin-host/panels.mjs';
test('the sequence is cut into numbered blocks, shares are rounded, saved data holds figures only, and the panel passes the rules', () => {
  const chain = { sequence: 'A'.repeat(LINE + 5), structure: '-'.repeat(LINE + 5), residues: 10, helix: 3, sheet: 1, label: 'A', segments: [{ type: 'helix', from: 2, to: 4 }, { type: 'sheet', from: 8, to: 8 }] };
  assert.deepEqual(blocks(chain).map((b) => [b.start, b.sequence.length]), [[1, LINE], [LINE + 1, 5]]); assert.deepEqual([share(chain, 'helix'), share(chain, 'sheet'), share({ residues: 0, helix: 0 }, 'helix')], [30, 10, 0]);
  assert.deepEqual(resultData({ chains: [chain] }, 'chain A'), { part: 'chain A', chains: [{ chain: 'A', residues: 10, helix: 3, sheet: 1, segments: [['H', 2, 4], ['E', 8, 8]] }] });
  assert.deepEqual(validatePanel(secondaryPanel).needs, ['structure', 'selection']);
});
