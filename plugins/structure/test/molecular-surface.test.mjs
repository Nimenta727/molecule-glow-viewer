import assert from 'node:assert/strict';
import test from 'node:test';
import { atomCharge, potentialAt, potentialColor, vertexNormals, validateSurfaces, buildSurface, SurfaceError, SCHEMES } from '../molecular-surface.mjs';

let serial = 1;
const atom = (residueName, name, element, position, seq = 1, chain = 'A') => ({ record: 'ATOM', serial: serial++, element, name, residueName, authChainId: chain, labelChainId: chain, authSeqId: String(seq), labelSeqId: String(seq), insertionCode: '', altLoc: '', modelId: '1', position });
const cluster = (resn, names, center, seq = 1, chain = 'A') => names.map(([name, element], i) => atom(resn, name, element, [center[0] + (i % 3) * 1.4, center[1] + (Math.floor(i / 3) % 3) * 1.4, center[2] + Math.floor(i / 9) * 1.4], seq, chain));

test('charges: Lys NZ +1, Arg guanidinium thirds, Asp/Glu halves, backbone AMBER sums, everything else 0; ligands never charged', () => {
  const q = (resn, name, element = name[0]) => atomCharge(atom(resn, name, element, [0, 0, 0]), 'pdb');
  assert.equal(q('LYS', 'NZ'), 1); assert.ok(Math.abs(['NE', 'NH1', 'NH2'].reduce((s, n) => s + q('ARG', n), 0) - 1) < 1e-12); assert.equal(q('ASP', 'OD1'), -0.5); assert.equal(q('GLU', 'OE2'), -0.5);
  assert.equal(q('ALA', 'N'), -0.1438); assert.equal(q('PRO', 'N'), -0.2548); assert.equal(q('GLY', 'C'), 0.5973); assert.equal(q('GLY', 'O'), -0.5679); assert.equal(q('ALA', 'CA', 'C'), 0.116);
  assert.equal(q('HIS', 'NE2'), 0); assert.equal(q('ALA', 'CB', 'C'), 0); assert.equal(q('CA', 'CA', 'CA'), 0, 'a calcium ion is not an alpha carbon');
  assert.equal(atomCharge({ ...atom('LYS', 'NZ', 'N', [0, 0, 0]), record: 'HETATM', residueName: 'LIG' }, 'pdb'), 0);
  assert.ok(Math.abs([0, 1, 2, 3].reduce((s, i) => s + [q('ALA', 'N'), q('ALA', 'CA', 'C'), q('ALA', 'C'), q('ALA', 'O')][i], 0)) < 0.01, 'a backbone unit is neutral');
});

test('potential follows Coulomb with ε = 4r: a lone +1 charge gives 83.02/r² at distance r, a -1 charge the opposite, charges beyond 60 Å do not count', () => {
  const m = { format: 'pdb', atoms: [atom('LYS', 'NZ', 'N', [0, 0, 0])] };
  const v = potentialAt(m, new Float32Array([5, 0, 0, 0, 10, 0, 70, 0, 0]));
  assert.ok(Math.abs(v[0] - 83.0179 / 25) < 1e-3, `${v[0]}`); assert.ok(Math.abs(v[1] - 83.0179 / 100) < 1e-3); assert.equal(v[2], 0);
  const neg = potentialAt({ format: 'pdb', atoms: [atom('ASP', 'OD1', 'O', [0, 0, 0]), atom('ASP', 'OD2', 'O', [0, 0, 0])] }, new Float32Array([5, 0, 0])); assert.ok(Math.abs(neg[0] + 83.0179 / 25) < 1e-3);
  assert.deepEqual(potentialColor(0).map((x) => Math.round(x * 255)), [255, 255, 255]); assert.ok(potentialColor(-20)[0] > potentialColor(-20)[1] && potentialColor(20)[2] > potentialColor(20)[0], 'red below zero, blue above, saturated at ±10');
  assert.deepEqual(potentialColor(100), potentialColor(10));
});

test('a surface forms around the atoms of the chosen part; electrostatics colour a Lys cluster blue and an Asp cluster red; other schemes colour by residue', () => {
  const names = Array.from({ length: 9 }, (_, i) => [i === 4 ? 'NZ' : `C${i}`, i === 4 ? 'N' : 'C']);
  const lys = [...cluster('LYS', [['CA', 'C'], ...names], [0, 0, 0], 1, 'A'), ...cluster('LYS', [['CA', 'C']], [0, 0, 8], 2, 'A')];
  const asp = cluster('ASP', [['CA', 'C'], ['OD1', 'O'], ['OD2', 'O'], ['CB', 'C'], ['CG', 'C']], [100, 0, 0], 3, 'B');
  const model = { format: 'pdb', atoms: [...lys, ...asp] };
  const surf = buildSurface(model, { expr: 'chain A and resi 1', scheme: 'electrostatic' });
  assert.ok(surf.idx.length > 30 && surf.stats.vertices > 20 && surf.stats.resolution === 0.5, JSON.stringify(surf.stats));
  assert.deepEqual([...vertexNormals(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), new Uint32Array([0, 1, 2]))].map((x) => Math.round(x)), [0, 0, 1, 0, 0, 1, 0, 0, 1], 'a counter-clockwise triangle in the xy plane has the normal +z');
  assert.ok(surf.stats.potential.mean > 0, `a Lys cluster is positive (${surf.stats.potential.mean})`);
  const blue = [...Array(surf.stats.vertices).keys()].filter((i) => surf.colors[3 * i + 2] > surf.colors[3 * i]).length; assert.ok(blue > surf.stats.vertices / 2, 'mostly blue');
  const acid = buildSurface(model, { expr: 'chain B', scheme: 'electrostatic' }); assert.ok(acid.stats.potential.mean < 0, `an Asp cluster is negative (${acid.stats.potential.mean})`);
  const hydro = buildSurface(model, { expr: 'chain B', scheme: 'hydrophobicity' }), plain = buildSurface(model, { expr: 'chain B', scheme: 'plain' });
  assert.equal(hydro.stats.potential, undefined); assert.equal(plain.colors[0], plain.colors[3], 'one colour'); assert.ok(hydro.colors.length === plain.colors.length);
});

test('rules and bad input: schemes and counts are checked, an empty or unreadable part says why', () => {
  assert.deepEqual(validateSurfaces([{ expr: ' chain A ', scheme: 'plain' }]), [{ expr: 'chain A', scheme: 'plain' }]); assert.deepEqual(validateSurfaces(undefined), []);
  for (const bad of [[{ expr: '', scheme: 'plain' }], [{ expr: 'a', scheme: 'rainbow' }], 'x', Array.from({ length: 5 }, () => ({ expr: 'a', scheme: 'plain' }))]) assert.throws(() => validateSurfaces(bad), SurfaceError);
  const m = { format: 'pdb', atoms: cluster('LYS', [['CA', 'C'], ['NZ', 'N']], [0, 0, 0]) };
  assert.throws(() => buildSurface(m, { expr: 'resi 99', scheme: 'plain' }), /没有选中/); assert.throws(() => buildSurface(m, { expr: 'banana', scheme: 'plain' }), SurfaceError); assert.throws(() => buildSurface(m, { expr: 'all', scheme: 'magic' }), /表面配色/);
  assert.deepEqual(Object.keys(SCHEMES), ['electrostatic', 'hydrophobicity', 'plain']);
});
