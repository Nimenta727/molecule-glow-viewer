import assert from 'node:assert/strict';
import test from 'node:test';
import { ribbonLayers } from '../cartoon-mesh.mjs';
import { dashedTubes } from '../annotation-draw.mjs';

// a helix of 8 residues (3.6 per turn, 1.5 A rise, radius 2.3 A) followed by 4 coil residues along x
const residue = (seq) => ({ atom: { seq } });
const helix = Array.from({ length: 8 }, (_, i) => ({ raw: [2.3 * Math.cos(i * 1.745), 2.3 * Math.sin(i * 1.745), 1.5 * i], residue: residue(i + 1) }));
const coil = Array.from({ length: 4 }, (_, i) => ({ raw: [2.3 + 3.8 * (i + 1), 0, 12], residue: residue(i + 9) }));
const markers = [...helix, ...coil];
const options = (types) => ({ rangeTypeFor: (atom) => types(atom.seq), residueGap: (a, b) => b.atom.seq - a.atom.seq === 1, colors: { default: '#607f91', helix: '#d47770', sheet: '#d6a94f' } });
const centered = { point: (p) => p.map((v) => v * 0.05) };

test('the cartoon is triangles with a normal per vertex: the helix part is a ribbon, the coil a tube, in their own colours', () => {
  const layers = ribbonLayers(markers, [], centered, {}, 'cartoon', options((seq) => (seq <= 8 ? 'helix' : 'default')));
  assert.ok(layers.length >= 2);
  for (const layer of layers) { assert.equal(layer.mode, 'triangles'); assert.equal(layer.positions.length % 9, 0); assert.equal(layer.normals.length, layer.positions.length); assert.ok(layer.normals.every(Number.isFinite)); }
  assert.deepEqual(new Set(layers.map((l) => l.color)), new Set(['#d47770', '#607f91']));
  const extent = (layer) => { const xs = []; for (let i = 0; i < layer.positions.length; i += 3) xs.push(layer.positions[i + 2]); return Math.max(...xs) - Math.min(...xs); };
  assert.ok(extent(layers.find((l) => l.color === '#d47770')) > 0.4, 'the ribbon follows the helix up its axis');
});

test('a hidden residue breaks the curve, a pinned colour comes from the look, and a strand ends in an arrow wider than the strand', () => {
  const look = { styleOf: (atom) => (atom.seq === 5 ? 'hidden' : undefined), colorOf: (atom) => (atom.seq <= 3 ? 'ff0000' : undefined) };
  const broken = ribbonLayers(markers, [], centered, look, 'cartoon', options(() => 'default'));
  assert.ok(broken.some((l) => l.color === 'ff0000' && l.pinned), 'the look colour is pinned');
  const straight = Array.from({ length: 6 }, (_, i) => ({ raw: [3.4 * i, 0, 0], residue: residue(i + 1) }));
  const sheet = ribbonLayers(straight, [], { point: (p) => p }, {}, 'cartoon', options((seq) => (seq <= 4 ? 'sheet' : 'default')));
  const ys = (layer) => { const out = []; for (let i = 0; i < layer.positions.length; i += 3) out.push(Math.abs(layer.positions[i + 1]), Math.abs(layer.positions[i + 2])); return Math.max(...out); };
  assert.ok(ys(sheet.find((l) => l.color === '#d6a94f')) > 1.6, 'the arrow head is wider than the 1.1 A strand');
  const backbone = ribbonLayers(straight, [], { point: (p) => p }, {}, 'backbone', options(() => 'default'));
  assert.ok(ys(backbone[0]) < 0.5, 'the backbone is a thin round tube');
});

test('interactions are dashed tubes from atom to atom: dashes along the line, coloured per segment', () => {
  const mesh = dashedTubes([{ a: [0, 0, 0], b: [3, 0, 0], color: '#2f9bff' }], { radius: 0.1, dash: 0.3, gap: 0.2, sides: 6 });
  assert.equal(mesh.pos.length / 3 / 12, 6, 'six dashes of 0.3 with 0.2 gaps along 3 A');
  assert.equal(mesh.idx.length, 6 * 6 * 6);
  assert.ok(Math.max(...Array.from(mesh.pos).filter((_, i) => i % 3 === 0)) <= 3 + 1e-9);
  assert.equal(mesh.colors.length, mesh.pos.length);
});
