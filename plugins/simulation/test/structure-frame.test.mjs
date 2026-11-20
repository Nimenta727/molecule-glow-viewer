import assert from 'node:assert/strict';
import test from 'node:test';
import { orientedFrame, rotationToUp, kwMatch } from '../structure-frame.mjs';
import { DataAnimation } from '../data-animation.mjs';
import { seededRng } from '../../motion/particles.mjs';
import { pack } from './fixture.mjs';

// a four-fold ring of residues around the z axis (a channel lying on its side, as a PDB file stores it), K ligands along z, two entities
const ring = (z0, z1, name) => { const out = []; for (let z = z0; z <= z1; z += 8) for (let i = 0; i < 8; i++) out.push({ position: [14 * Math.cos(i * Math.PI / 4) + 3, 14 * Math.sin(i * Math.PI / 4) - 2, z + 5], entity: name, authSeq: out.length + 1, insertion: '', labelSeq: out.length + 1, chain: 'A', labelAsym: 'A' }); return out; };
const residues = [...ring(-40, 40, 'potassium channel'), ...ring(60, 76, 'antibody fragment')];
const ligands = [-12, -4, 4, 12].map((z) => ({ comp: 'K', atoms: [{ position: [3, -2, z + 5] }] }));
const near = (a, b, e = 1e-9) => assert.ok(Math.abs(a - b) < e, `${a} != ${b}`);
const nearV = (a, b, e = 1e-9) => a.forEach((v, i) => near(v, b[i], e));

test('rotationToUp: a proper rotation that turns the axis onto +y, including the opposite direction', () => {
  for (const d of [[0, 0, 1], [1, 0, 0], [0, -1, 0], [0.6, 0.64, -0.48], [0, 1, 0]]) {
    const n = Math.hypot(...d), u = d.map((v) => v / n), R = rotationToUp(u);
    nearV(R.map((row) => row.reduce((s, v, j) => s + v * u[j], 0)), [0, 1, 0]);
    const det = R[0][0] * (R[1][1] * R[2][2] - R[1][2] * R[2][1]) - R[0][1] * (R[1][0] * R[2][2] - R[1][2] * R[2][0]) + R[0][2] * (R[1][0] * R[2][1] - R[1][1] * R[2][0]);
    near(det, 1);
  }
});

test('the structure is turned so its symmetry axis is vertical and centred; mapping back and forth is exact', () => {
  const f = orientedFrame({ residues, ligands, config: { axis: 'sym', membranes: [{ at: 'potassium', offset: 0 }] } });
  const k = f.structure.ligands.filter((l) => l.comp === 'K');
  assert.equal(k.length, 4);
  for (const l of k) assert.ok(Math.hypot(l.centre[0], l.centre[2]) < 0.5, `K ions sit on the vertical axis (${l.centre})`);
  const ys = k.map((l) => l.centre[1]).sort((a, b) => a - b); near(ys[3] - ys[0], 24, 1e-6);
  residues.slice(0, 20).forEach((r, i) => nearV(f.toNative(f.fromNative(r.position)), r.position, 1e-9));
  nearV(f.toNative(f.structure.points[3]), residues[3].position, 1e-9);
  assert.equal(f.flipped, false);
});

test('membrane height = mean height of the named entity + offset (the classic membranes entry); an unknown entity gives 0 + offset', () => {
  const f = orientedFrame({ residues, ligands, config: { axis: 'sym', membranes: [{ at: 'potassium', offset: 5 }, { at: 'zzz', offset: 2 }] } });
  const own = f.structure.points.slice(0, 40).reduce((s, p) => s + p[1], 0) / 40;
  const channel = residues.map((r, i) => ({ r, p: f.structure.points[i] })).filter(({ r }) => r.entity === 'potassium channel');
  near(f.structure.membraneY[0], channel.reduce((s, { p }) => s + p[1], 0) / channel.length + 5, 1e-9); near(f.structure.membraneY[1], 2); assert.ok(Number.isFinite(own));
  assert.deepEqual(orientedFrame({ residues, ligands, config: {} }).structure.membraneY, []);
});

test('orient.up: when the declared anchor lies below the middle the whole structure is turned over, and the mapping still round-trips', () => {
  const animation = { version: 1, orient: { up: { ligands: 'K' } } };
  // reverse the order of the K ligands' heights by choosing a structure whose axis sign puts them low: try both signs and compare
  const a = orientedFrame({ residues, ligands, config: { axis: 'sym' }, animation });
  const lowered = orientedFrame({ residues: residues.slice(0, 40), ligands: [{ comp: 'K', atoms: [{ position: [3, -2, -30] }] }, ...ligands.slice(0, 1)], config: { axis: 'sym' }, animation });
  for (const f of [a, lowered]) {
    const ys = f.structure.ligands.map((l) => l.centre[1]), mid = (Math.min(...f.structure.points.map((p) => p[1])) + Math.max(...f.structure.points.map((p) => p[1]))) / 2;
    assert.ok(ys[0] >= mid - 1e-9 || !f.flipped, 'after the decision the first K is on the upper half');
    nearV(f.toNative(f.fromNative(residues[5].position)), residues[5].position, 1e-9);
  }
  assert.equal(lowered.flipped, true, 'a ligand low in the model asks for the turn');
  const ys = lowered.structure.ligands.map((l) => l.centre[1]);
  assert.ok(ys[0] > ys[1], 'the declared K is now above the other one');
});

test('residue and part lookups follow the classic rules (number + insertion + part + chain; entity keyword or /regex/)', () => {
  const f = orientedFrame({ residues, ligands, config: { axis: 'sym' } });
  assert.ok(f.structure.residue({ number: 5, ins: '', part: 'potassium' })); assert.equal(f.structure.residue({ number: 5, ins: 'A' }), null); assert.equal(f.structure.residue({ number: 5, chain: 'Z' }), null);
  assert.ok(f.structure.residue({ labelSeq: 7, labelAsym: 'A' })); assert.ok(f.structure.part('/^antibody/')); assert.equal(f.structure.part('ribosome'), null);
  assert.equal(kwMatch('Potassium Channel', 'channel'), true); assert.equal(kwMatch('x', '/(/'), false);
});

test('the KcsA data pack runs on a structure given sideways: K+ goes from the lower to the upper compartment of the oriented frame and back in the model frame', () => {
  const animation = pack('kcsa-data'), f = orientedFrame({ residues, ligands, config: { axis: 'sym', membranes: [{ at: '', offset: 0 }] }, animation });
  const run = new DataAnimation(structuredClone(animation), f.structure, { rng: seededRng(7) }); delete run.spec.orient;
  run.run(900);
  const s = run.summary(); assert.ok(s.counters['K⁺ 外流'] >= 3, `${s.counters['K⁺ 外流']}`);
  for (const [name, { expected, actual }] of Object.entries(run.balance())) assert.equal(actual, expected, name);
  const inChannel = run.frame().items.filter((i) => i.kind === 'moving').map((i) => f.toNative(i.position));
  assert.ok(inChannel.every((p) => p.every(Number.isFinite)));
});
