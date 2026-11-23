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
  const tube = rep.layers.find((layer) => layer.mode === 'triangles' && layer.role === 'cartoon');
  assert.ok(tube && tube.normals.length === tube.positions.length, 'the backbone is a smooth 3D tube');
  const points = rep.layers.find((layer) => layer.mode === 'points');
  assert.equal(points.positions.length, 12, 'four backbone residues, one pick point each');
  assert.ok(Math.abs(points.positions[0] + 2.3) < 1e-12, 'coordinates are centered on non-water first-model bounds and scaled by 0.05');
  assert.ok(Math.abs(points.positions[3] + 2.1) < 1e-12, 'blank altLoc wins over alternate conformers');
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
  assert.deepEqual(new Set(ribbons.map((layer) => layer.color)), new Set(['#d47770', '#d6a94f']), 'the helix residues in the helix colour, the strand residues in the strand colour');
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
  const tube = representation.layers.find((layer) => layer.mode === 'triangles'), points = representation.layers.find((layer) => layer.mode === 'points');
  assert.equal(representation.chainId, 'N');
  assert.ok(tube, 'the phosphates carry the tube');
  assert.equal(points.positions.length, 6);
  assert.ok(Math.abs(points.positions[3] - 0.15) < 1e-12);
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

// ---- per-residue look (the authoring tools): colour and style of a chosen part, in every residue-level style ----
function chain(count = 6) {   // one chain of `count` residues, 3.8 Å apart: 6 residues = 5 segments
  return { atoms: Array.from({ length: count }, (_, i) => atom({ position: [i * 3.8, 0, 0], serial: i + 1, authSeqId: String(i + 1), labelSeqId: String(i + 1) })) };
}
const seqOf = (a) => Number(a.authSeqId);
const drawn = (model, style, look) => buildRepresentations(model, { style, look })[0].layers.filter((layer) => layer.mode !== 'points');
const count = (layers, mode) => layers.filter((l) => l.mode === mode).reduce((n, l) => n + (mode === 'triangles' ? l.positions.length / 9 : mode === 'lines' ? l.positions.length / 6 : l.positions.length / 3), 0);
const RED = '#e05a4a';
const xs = (layers) => layers.flatMap((l) => { const out = []; for (let i = 0; i < l.positions.length; i += 3) out.push(l.positions[i]); return out; });
const at = (seq) => ((seq - 1) * 3.8 - 9.5) * 0.05;   // where residue `seq` of chain() is drawn (centred on the chain, 0.05 per angstrom)

test('a colour for some residues splits the cartoon, the backbone and the blob by colour and pins the coloured layers; the rest keeps its own colour', () => {
  const look = { colorOf: (a) => (seqOf(a) >= 4 ? RED : undefined) };   // a segment takes the colour of the residue it ends at: segments ending at 4, 5, 6 are red
  const plain = drawn(chain(), 'cartoon'), cartoon = drawn(chain(), 'cartoon', look);
  assert.ok(count(plain, 'triangles') > 0); assert.equal(count(cartoon, 'triangles'), count(plain, 'triangles'), 'the same ribbon, only coloured differently');
  const red = cartoon.find((l) => l.color === RED); assert.ok(red.pinned);
  assert.ok(Math.min(...xs([red])) > at(3) && Math.min(...xs([red])) < at(4), 'red starts between residues 3 and 4 and runs to the end');
  assert.ok(cartoon.some((l) => l.color !== RED && !l.pinned), 'the other residues keep the default colour and are not pinned');
  const tube = drawn(chain(), 'backbone', look); assert.equal(count(tube, 'lines'), 0, 'the backbone is a tube, not lines'); assert.ok(tube.find((l) => l.color === RED)?.pinned);
  const blob = drawn(chain(), 'blob', look); assert.equal(count(blob, 'spheres'), 6); assert.equal(blob.find((l) => l.color === RED).positions.length / 3, 3, 'residues 4, 5, 6');
});

test('a hidden part is neither drawn nor pickable, and a segment touching a hidden residue is not drawn', () => {
  const look = { styleOf: (a) => (seqOf(a) === 3 || seqOf(a) === 4 ? 'hidden' : undefined) };
  const cartoon = drawn(chain(), 'cartoon', look); assert.ok(count(cartoon, 'triangles') > 0, 'residues 1-2 and 5-6 are drawn');
  assert.ok(xs(cartoon.filter((l) => l.mode === 'triangles')).every((x) => x < at(3) - 0.02 || x > at(4) + 0.02), 'nothing is drawn at the hidden residues 3 and 4');
  const [group] = buildRepresentations(chain(), { style: 'cartoon', look }), points = group.layers.findIndex((l) => l.mode === 'points');
  assert.equal(group.layers[points].positions.length / 3, 4, 'two residues are gone from the markers'); assert.deepEqual(group.pointTargets[points].map((t) => seqOf(t.atom)), [1, 2, 5, 6], 'and from what can be picked');
  assert.equal(count(drawn(chain(), 'blob', look), 'spheres'), 4);
});

test('a part can be drawn in another style than the rest: a blob pocket inside a cartoon, a backbone tail', () => {
  const mixed = drawn(chain(), 'cartoon', { styleOf: (a) => (seqOf(a) >= 5 ? 'blob' : seqOf(a) === 1 ? 'backbone' : undefined) });
  assert.equal(count(mixed, 'spheres'), 2, 'residues 5 and 6 as spheres'); assert.ok(count(mixed, 'triangles') > 0, 'residues 1-4 are one tube (backbone at 1, cartoon after)');
  assert.ok(Math.max(...xs(mixed.filter((l) => l.mode === 'triangles'))) < at(5), 'the tube stops before the blob residues'); assert.equal(count(mixed, 'lines'), 0);
});

test('surface and functional ignore the per-residue look, and without a look nothing changes', () => {
  const look = { colorOf: () => RED, styleOf: () => 'hidden' };
  for (const style of ['surface', 'functional']) assert.deepEqual(buildRepresentations(fixture(), { style, look }), buildRepresentations(fixture(), { style }), style);
  for (const style of ['cartoon', 'backbone', 'blob']) assert.deepEqual(buildRepresentations(fixture(), { style, look: {} }), buildRepresentations(fixture(), { style }), `${style}: an empty look is no look`);
});

// ---- atom-level sticks: only for the residues set to 'sticks', on top of the cartoon ----
function backboneChain(count = 3) {   // N, CA, C, O per residue with real bond lengths, residues 3.8 Å apart along x
  const atoms = []; let serial = 1;
  for (let i = 0; i < count; i++) {
    const x = i * 3.8, seq = String(i + 1);
    for (const [name, element, dx, dy] of [['N', 'N', -1.2, 0.3], ['CA', 'C', 0, 0], ['C', 'C', 1.4, 0.4], ['O', 'O', 1.9, 1.5]]) atoms.push(atom({ name, element, position: [x + dx, dy, 0], serial: serial++, authSeqId: seq, labelSeqId: seq }));
  }
  return { atoms };
}
test('sticks draw the bonds of the chosen residues (and the peptide bond between neighbours), tinted by element; those residues are drawn as atoms, not ribbon', () => {
  const look = { styleOf: (a) => (seqOf(a) <= 2 ? 'sticks' : undefined) };
  const plain = drawn(backboneChain(5), 'cartoon'), withSticks = drawn(backboneChain(5), 'cartoon', look);
  assert.ok(count(withSticks, 'triangles') > 0 && count(withSticks, 'triangles') < count(plain, 'triangles'), 'the rest is still cartoon');
  const sticks = withSticks.filter((l) => l.role === 'sticks'); assert.ok(sticks.length && sticks.every((l) => l.mode === 'cylinders' && l.pinned && l.radius > 0));
  assert.ok(sticks.some((l) => l.color === 'e05a4a') && sticks.some((l) => l.color === '4e79d6'), 'oxygen and nitrogen have their own tints');
  const segments = sticks.reduce((n, l) => n + l.positions.length / 6, 0);   // each bond is two half-bonds; per residue N-CA, CA-C, C-O = 3 bonds; plus C(1)-N(2) = 1 bond: 7 bonds, 14 half-bonds
  assert.equal(segments, 14);
  assert.equal(drawn(backboneChain(), 'cartoon', { styleOf: () => undefined }).filter((l) => l.role === 'sticks').length, 0, 'no sticks unless asked');
});

test('ball-and-stick draws the same bonds as sticks plus one ball per heavy atom, tinted by element; plain sticks have no balls', () => {
  const ball = { styleOf: (a) => (seqOf(a) <= 2 ? 'ballstick' : undefined) }, stick = { styleOf: (a) => (seqOf(a) <= 2 ? 'sticks' : undefined) };
  const withBalls = drawn(backboneChain(), 'cartoon', ball), plain = drawn(backboneChain(), 'cartoon', stick);
  const lines = (layers) => layers.filter((l) => l.role === 'sticks').reduce((n, l) => n + l.positions.length / 6, 0);
  assert.equal(lines(withBalls), lines(plain), 'the bonds are the same');
  const balls = withBalls.filter((l) => l.role === 'balls'); assert.ok(balls.length && balls.every((l) => l.mode === 'spheres' && l.pinned && l.radius > 0));
  assert.equal(balls.reduce((n, l) => n + l.positions.length / 3, 0), 8, '2 residues x 4 heavy atoms');
  assert.ok(balls.some((l) => l.color === 'e05a4a'), 'oxygen is tinted');
  assert.equal(plain.filter((l) => l.role === 'balls').length, 0);
});
