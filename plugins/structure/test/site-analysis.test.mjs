import assert from 'node:assert/strict';
import test from 'node:test';
import { siteInteractions, pocketSurface, findChannel, alongPath, pathLength, INTERACTION_TYPES } from '../site-analysis.mjs';

const atom = (el, an, comp, asym, position) => ({ el, an, comp, asym, position });
const residue = (asym, seq, comp, atoms) => ({ asym, seq, comp, atoms });

test('hydrogen bond, salt bridge, metal coordination and a hydrophobic contact are told apart', () => {
  const ligand = [atom('O', 'O1', 'LIG', 'B', [0, 0, 0]), atom('P', 'P1', 'LIG', 'B', [1.5, 0, 0]), atom('C', 'C1', 'LIG', 'B', [0, 5, 0])];
  const residues = [
    residue('A', 10, 'SER', [atom('O', 'OG', 'SER', 'A', [2.9, 0, 3.0])]),                 // 4.2 Å from O1: neither
    residue('A', 11, 'THR', [atom('O', 'OG1', 'THR', 'A', [0, 3.0, 0])]),                  // O–O 3.0 Å: hydrogen bond
    residue('A', 12, 'LYS', [atom('N', 'NZ', 'LYS', 'A', [0, 0, -3.6])]),                  // phosphate O to Lys NZ 3.6 Å: salt bridge
    residue('A', 13, 'LEU', [atom('C', 'CD1', 'LEU', 'A', [0, 5, 3.8])]),                  // C–C 3.8 Å side chain: hydrophobic
    residue('A', 14, 'GLY', [atom('C', 'CA', 'GLY', 'A', [0, 5, -3.8])]),                  // backbone carbons are not counted
  ];
  const r = siteInteractions({ ligand, residues, ligandComp: 'LIG' });
  assert.deepEqual(r.interactions.map((i) => [i.type, i.residue.seq]), [['hbond', 11], ['salt', 12]]);
  assert.deepEqual([...r.hydrophobic].map((x) => x.seq), [13]);
  assert.deepEqual(r.shown.map((x) => x.seq), [11, 12, 13]);
  assert.ok(INTERACTION_TYPES.hbond[0] && INTERACTION_TYPES.salt[1].startsWith('#'));
});

test('metals coordinate to O/N within 2.8 Å (K⁺ and Na⁺ 3.2 Å); impossible N/O contacts are skipped; only the best partner per atom is kept', () => {
  const ligand = [atom('O', 'O1', 'LIG', 'B', [0, 0, 0])];
  const het = [atom('K', 'K', 'K', 'C', [0, 0, 5.2]), atom('MG', 'MG', 'MG', 'C', [3.0, 0, 2.2])];
  const residues = [residue('A', 1, 'ASP', [atom('O', 'OD1', 'ASP', 'A', [0, 0, 2.2])])];
  const r = siteInteractions({ ligand, residues, het, ligandComp: 'LIG' });
  assert.equal(r.clashes, 1, 'the 2.2 Å O–O pair is a model error, not a hydrogen bond');
  assert.deepEqual(r.interactions.map((i) => i.type), ['metal'], 'K at 3.0 Å from an O counts, Mg at 3.0 Å does not');
  assert.equal(r.interactions[0].a.el, 'K');
});

test('pocket surface of one atom sits at its van der Waals radius, and the crop removes what is far from the centre', () => {
  const job = { pos: new Float32Array([0, 0, 0]), rad: new Float32Array([1.7]), cls: new Uint8Array([3]), centre: [0, 0, 0], cut: 10 };
  const s = pocketSurface(job);
  assert.ok(s.idx.length > 100 && s.pos.length % 3 === 0);
  const radii = []; for (let i = 0; i < s.pos.length; i += 3) radii.push(Math.hypot(s.pos[i], s.pos[i + 1], s.pos[i + 2]));
  assert.ok(Math.max(...radii) < 1.85 && Math.min(...radii) > 1.55, `radii ${Math.min(...radii)}–${Math.max(...radii)}`);
  assert.ok(s.cls.every((c) => c === 3));
  assert.equal(pocketSurface({ ...job, centre: [100, 0, 0], cut: 3 }).idx.length, 0, 'everything cropped away');
});

test('a channel through a tube of points is found, follows the axis and reports its radius; a closed tube has no way out', () => {
  const tube = () => { const pts = []; for (let z = -30; z <= 30; z += 2) for (let k = 0; k < 24; k++) { const a = k / 24 * Math.PI * 2; pts.push([8 * Math.cos(a), 8 * Math.sin(a), z]); } return pts; };
  const path = findChannel(tube(), [0, 0, 0], { h: 2, radius: 50, minClear: 3, openClear: 14, minLen: 20 });
  assert.ok(path && path.length > 5);
  assert.ok(path.filter((x) => Math.abs(x.p[2]) < 28).every((x) => Math.hypot(x.p[0], x.p[1]) < 2), 'stays near the axis');
  assert.ok(Math.abs(path.at(-1).p[2]) >= 20);
  assert.ok(path.filter((x) => Math.abs(x.p[2]) < 28).every((x) => x.r > 6 && x.r <= 9), 'inside the tube the clearance is about its radius');
  assert.equal(findChannel([...tube(), ...[-31, 31].flatMap((z) => [...Array(64)].map((_, i) => [-10.5 + (i % 8) * 3, -10.5 + Math.floor(i / 8) * 3, z]))], [0, 0, 0], { h: 2, radius: 40, minClear: 3, minLen: 40 }), null, 'plugs at both ends leave no way out');
});

test('alongPath walks the polyline, clamps at the start and continues straight past the end', () => {
  const path = [{ p: [0, 0, 0], r: 5 }, { p: [3, 4, 0], r: 5 }, { p: [3, 4, 10], r: 5 }];
  assert.equal(pathLength(path), 15);
  assert.deepEqual(alongPath(path, -2), [0, 0, 0]);
  assert.deepEqual(alongPath(path, 2.5), [1.5, 2, 0]);
  assert.deepEqual(alongPath(path, 10), [3, 4, 5]);
  assert.deepEqual(alongPath([[0, 0, 0], [0, 0, 2]], 5), [0, 0, 5]);
});
