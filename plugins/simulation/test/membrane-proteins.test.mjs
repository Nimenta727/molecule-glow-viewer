import assert from 'node:assert/strict';
import test from 'node:test';
import { ECOLI, cellFrameAt } from '../cell-geometry.mjs';
import { membraneShape, placeMembraneProteins } from '../membrane-proteins.mjs';
import { mulberry32 } from '../../motion/particles.mjs';

// A made-up membrane protein: a bundle of six helices along a tilted axis, 36 Å long, each residue one point; its transmembrane segments are declared.
const helix = (cx, cz, asym) => Array.from({ length: 24 }, (_, i) => ({ position: [cx + 2.3 * Math.cos(i * 1.75), -18 + 1.5 * i + 4, cz + 2.3 * Math.sin(i * 1.75)], asym, seq: i + 1, nucleic: false, resn: i % 3 ? 'LEU' : 'ALA', entity: 'x' }));
const atoms = [[0, 0, 'A'], [9, 0, 'B'], [-9, 0, 'C'], [0, 9, 'D'], [0, -9, 'E'], [9, 9, 'F']].flatMap(([x, z, a]) => helix(x, z, a));
const info = { segs: ['A', 'B', 'C', 'D', 'E', 'F'].map((asym) => ({ asym, b: 1, e: 24 })), segSrc: 'OPM', memAnn: true, topo: [] };

test('membraneShape: the protein is put in its membrane frame and reduced to a coarse shape; a soluble protein has none', () => {
  const s = membraneShape({ id: 'T', label: 't' }, atoms, info);
  assert.ok(s, 'a membrane was found'); assert.equal(s.n, atoms.length); assert.ok(s.pts.length >= 8 && s.pts.length <= 70);
  const ys = s.pts.map((p) => p[1]); assert.ok(Math.max(...ys) - Math.min(...ys) > 25 && Math.abs(ys.reduce((a, b) => a + b, 0) / ys.length) < 12, 'a bundle centred on y = 0');
  assert.ok(s.foot >= 15 && s.r > 3);
  assert.equal(membraneShape({ id: 'S' }, atoms.map((a) => ({ ...a, position: [a.position[0] * 3, a.position[1] * 0.2, a.position[2] * 3] })), { segs: [], memAnn: false, topo: [] }), null);
});

test('placeMembraneProteins: copies stand on the inner and outer membrane, in the corner region behind the cut, never on an occupied cell; deterministic', () => {
  const { frame: F, H, Rom } = cellFrameAt([0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]), C = ECOLI, wCut = 600;
  const shape = (id, outer, perCell, fill, n) => ({ id, outer, perCell, fill, pts: [[0, -10, 0], [0, 0, 0], [0, 10, 0], [6, 0, 0], [-6, 0, 0], [0, 0, 6]], r: 4, foot: 12, n, half: 15 });
  const make = () => [shape('IM1', false, 3000, 0, 500), shape('IM2', false, 0, 1, 300), shape('OM1', true, 33000, 0, 400)];
  const run = (seed) => placeMembraneProteins({ F, C, H, Rom, wCut }, make(), mulberry32(seed));
  const r = run(2), again = run(2);
  assert.deepEqual(r.map((x) => x.bodies.length), again.map((x) => x.bodies.length)); assert.deepEqual(r[0].bodies[0]?.cen, again[0].bodies[0]?.cen);
  assert.ok(r.every((x) => x.placed > 0), JSON.stringify(r.map((x) => [x.shape.id, x.expect, x.placed])));
  const radius = (p) => { const L = F.loc(p); return Math.hypot(L.y, L.w); };
  for (const { shape: s, bodies } of r) for (const b of bodies) {
    const R = radius(b.cen); assert.ok(Math.abs(R - (s.outer ? Rom : C.Rim)) < 1e-6, `${s.id} stands on its membrane`);
    const L = F.loc(b.cen); assert.ok(L.w < wCut && Math.abs(L.u - C.uF) <= C.reg + 1e-6, 'in the region behind the cut');
    assert.equal(b.pts.length, s.pts.length);
    assert.ok(Math.abs(radius(b.pts[2]) - radius(b.pts[0])) > 15, 'standing: the long axis of the protein points along the membrane normal');
  }
  const seen = new Set();   // the cells of different copies never coincide (the blobs of one copy may share a cell)
  for (const x of r) for (const b of x.bodies) {
    const mine = new Set(b.pts.map((p) => `${x.shape.outer}|${Math.round(F.loc(p).u / 22)}|${Math.round((x.shape.outer ? Rom : C.Rim) * Math.atan2(F.loc(p).w, F.loc(p).y) / 22)}`));
    for (const c of mine) assert.ok(!seen.has(c), `cell ${c} used twice`);
    for (const c of mine) seen.add(c);
  }
  const inner = r.filter((x) => !x.shape.outer).reduce((a, x) => a + x.placed * Math.PI * x.shape.foot ** 2, 0); const area = 2 * C.reg * (wCut + C.reg);
  assert.ok(inner >= 0.15 * area && inner <= 0.3 * area, `inner membrane coverage ${(inner / area * 100).toFixed(0)} %`);
});
