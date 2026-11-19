import assert from 'node:assert/strict';
import test from 'node:test';
import { buildRepresentations, findLigandContacts, selectStructure } from '../representation.mjs';

function atom({
  record = 'ATOM', serial = 1, element = 'C', position, name = 'CA', residueName = 'ALA',
  authChainId = 'A', labelChainId = 'X', authSeqId = '1', labelSeqId = '11', insertionCode = '',
  altLoc = '', modelId = '1',
}) {
  return {
    record, serial, element, position, name, authAtomId: name, labelAtomId: name, residueName,
    authChainId, labelChainId, authSeqId, labelSeqId, insertionCode, altLoc, modelId,
  };
}

function fixture() {
  return {
    atoms: [
      atom({ position: [10, 0, 0], serial: 1 }),
      atom({ position: [30, 0, 0], serial: 2, altLoc: 'B' }),
      atom({ position: [14, 0, 0], serial: 3, authSeqId: '2', labelSeqId: '12' }),
      atom({ position: [18, 0, 0], serial: 4, authSeqId: '3', labelSeqId: '13' }),
      atom({ position: [22, 0, 0], serial: 5, authSeqId: '4', labelSeqId: '14' }),
      atom({ record: 'HETATM', position: [100, 0, 0], name: 'C1', residueName: 'LIG', authSeqId: '501', labelSeqId: '501' }),
      atom({ record: 'HETATM', position: [102, 0, 0], serial: 7, name: 'O1', element: 'O', residueName: 'LIG', authSeqId: '501', labelSeqId: '501' }),
      atom({ record: 'HETATM', position: [-100, 0, 0], name: 'O', residueName: 'HOH', authChainId: 'W', labelChainId: 'W', authSeqId: '1', labelSeqId: '1' }),
      atom({ position: [5000, 0, 0], serial: 9, modelId: '2' }),
    ],
    secondaryStructure: [
      { type: 'helix', chainId: 'A', from: '1', to: '2A', numbering: 'auth' },
      { type: 'sheet', chainId: 'X', from: '13', to: '14', numbering: 'label' },
    ],
  };
}

function validateLayers(representations) {
  for (const representation of representations) {
    assert.ok(representation.key.startsWith('chain:'));
    for (const layer of representation.layers) {
      assert.match(layer.color, /^#[0-9a-f]{6}$/i);
      assert.ok(layer.positions.length % 3 === 0);
      assert.ok(layer.positions.every(Number.isFinite));
      if (layer.mode === 'triangles') assert.equal(layer.positions.length % 9, 0);
      if (layer.mode === 'lines') assert.equal(layer.positions.length % 6, 0);
      if (layer.mode === 'points') assert.ok(layer.pointSize > 0);
    }
  }
}

test('backbone uses first model, chooses deterministic altLocs, centers and scales coordinates', () => {
  const model = fixture();
  const originalFirstPosition = [...model.atoms[0].position];
  const representations = buildRepresentations(model);
  assert.equal(representations.length, 1, 'water-only chain and second model are omitted');
  const rep = representations[0];
  assert.equal(rep.chainId, 'A');
  assert.equal(rep.label, 'Chain A');
  const lines = rep.layers.find((layer) => layer.mode === 'lines');
  assert.ok(lines);
  assert.equal(lines.positions.length, 18, 'four consecutive backbone residues form three segments');
  assert.ok(Math.abs(lines.positions[0] + 2.3) < 1e-12, 'coordinates are centered on non-water first-model bounds and scaled by 0.05');
  assert.ok(Math.abs(lines.positions[3] + 2.1) < 1e-12, 'blank altLoc wins over alternate conformers');
  const ligand = rep.layers.find((layer) => layer.color === '#e58a3a');
  assert.ok(Math.abs(ligand.positions[0] - 2.25) < 1e-12);
  assert.deepEqual(ligand.positions.slice(1), [0, 0], 'non-water ligand is one heavy-atom centroid marker');
  assert.deepEqual(model.atoms[0].position, originalFirstPosition, 'source atom coordinates are unchanged');
  validateLayers(representations);
});

test('cartoon builds valid ribbon triangles and conveys deposited helix and sheet ranges', () => {
  const representations = buildRepresentations(fixture(), { style: 'cartoon' });
  const rep = representations[0];
  const ribbons = rep.layers.filter((layer) => layer.mode === 'triangles');
  assert.deepEqual(new Set(ribbons.map((layer) => layer.color)), new Set(['#d47770', '#607f91', '#d6a94f']));
  assert.ok(ribbons.every((layer) => layer.positions.length >= 9));
  assert.ok(rep.layers.some((layer) => layer.mode === 'points' && layer.color === '#e58a3a'));
  validateLayers(representations);
});

test('blob uses one runtime sphere per representative residue and retains the pick targets', () => {
  const [representation] = buildRepresentations(fixture(), { style: 'blob' });
  const spheres = representation.layers.find(({ mode }) => mode === 'spheres');
  const markers = representation.layers.findIndex(({ mode }) => mode === 'points');
  assert.ok(Math.abs(spheres.radius - 0.105) < 1e-12);
  assert.deepEqual(spheres.positions, representation.layers[markers].positions);
  assert.equal(representation.pointTargets[markers].length, 4);
});

test('functional mode keeps representative residues near ligand heavy atoms and coarsens the rest', () => {
  const model = fixture();
  const ligand = model.atoms.find(({ residueName }) => residueName === 'LIG');
  ligand.position = [9, 0, 0];
  const [group] = buildRepresentations(model, { style: 'functional' });
  const core = group.layers.find(({ role }) => role === 'functional-core');
  const coarse = group.layers.find(({ role }) => role === 'density-surface');
  assert.equal(core.positions.length, 6);
  assert.ok(coarse.positions.length > 0 && coarse.positions.length % 9 === 0);
  assert.ok(coarse.positions.every(Number.isFinite));
  assert.equal(group.pointTargets.find(Boolean).length, 4);
});

test('functional mode applies imported preset ranges and named residue neighborhoods', () => {
  const [group] = buildRepresentations(fixture(), { style: 'functional', functionalRules: {
    coreLigands: [],
    core: [
      { part: 'Chain A', seqs: [[14, 14]] },
      { near: { part: '/^Chain A$/', seq: 11 }, r: 4.1 },
    ],
  } });
  assert.equal(group.layers.find(({ role }) => role === 'functional-core').positions.length, 9);
  assert.ok(group.layers.some(({ role }) => role === 'density-surface'));
});

test('nucleic-acid style chains use phosphate P atoms when CA is absent', () => {
  const model = { atoms: [
    atom({ name: 'P', residueName: 'A', position: [0, 0, 0], authChainId: 'N', labelChainId: 'L', authSeqId: '1', labelSeqId: '1' }),
    atom({ name: 'P', residueName: 'C', position: [6, 0, 0], authChainId: 'N', labelChainId: 'L', authSeqId: '2', labelSeqId: '2', serial: 2 }),
  ] };
  const representation = buildRepresentations(model)[0];
  const line = representation.layers.find((layer) => layer.mode === 'lines');
  assert.equal(representation.chainId, 'N');
  assert.ok(line);
  assert.equal(line.positions.length, 6);
  assert.ok(Math.abs(line.positions[3] - 0.15) < 1e-12);
});

test('selectStructure supports auth and label identifiers and combines filters', () => {
  const model = fixture();
  const byAuthChain = selectStructure(model, { chainId: 'A' });
  const byLabelChain = selectStructure(model, { chainId: 'X' });
  assert.equal(byAuthChain.length, byLabelChain.length);
  assert.ok(byAuthChain.every((atom) => atom.modelId === '1'));
  assert.equal(selectStructure(model, { chainId: 'A', residueId: '12' }).length, 1, 'scalar residue ID matches label numbering');
  assert.equal(selectStructure(model, { chainId: 'X', residueId: { authSeqId: '2', labelSeqId: '12', insertionCode: '' } }).length, 1);
  assert.equal(selectStructure(model, { chainId: 'A', residueId: { authSeqId: '1', insertionCode: 'A' } }).length, 0);
  const allFirstModelAtoms = selectStructure(model);
  assert.equal(allFirstModelAtoms.length, model.atoms.length - 1);
  assert.equal(allFirstModelAtoms[0], model.atoms[0], 'returns original atom records in a detached result array');
});

test('ligand contacts group residues and report minimum heavy-atom distances in Å', () => {
  const ligand = atom({ record: 'HETATM', name: 'FE', element: 'FE', residueName: 'HEM',
    authSeqId: '101', labelSeqId: '', position: [0, 0, 0] });
  const nearest = atom({ name: 'N', element: 'N', insertionCode: 'B', position: [-2, 0, 0] });
  const model = { format: 'mmcif', atoms: [
    ligand, nearest, atom({ insertionCode: 'B', position: [-3, 0, 0] }),
    atom({ name: 'H', element: 'H', insertionCode: 'B', position: [-1, 0, 0] }),
    atom({ authSeqId: '2', position: [4, 0, 0] }),
    atom({ authSeqId: '3', position: [4.1, 0, 0] }),
    atom({ authSeqId: '4', position: [1, 0, 0], modelId: '2' }),
  ] };
  assert.deepEqual(findLigandContacts(model, ligand).map(({ atom: contact, distance }) =>
    [contact.authSeqId, contact.insertionCode, distance]), [['1', 'B', 2], ['2', '', 4]]);
});

test('empty inputs produce no representations and unsupported styles fail explicitly', () => {
  assert.deepEqual(buildRepresentations({ atoms: [] }), []);
  assert.deepEqual(selectStructure({ atoms: [] }), []);
  assert.throws(() => buildRepresentations(fixture(), { style: 'spacefill' }), /Unsupported representation style/);
});
