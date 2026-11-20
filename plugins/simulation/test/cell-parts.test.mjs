import assert from 'node:assert/strict';
import test from 'node:test';
import { ECOLI, capsuleFrame, cellFrameAt } from '../cell-geometry.mjs';
import { nucleoid, cellRibosomes, flagella, envelopeNet, inNucleoid, NUCLEOID } from '../cell-parts.mjs';
import { mulberry32 } from '../../motion/particles.mjs';

const { frame: F, H, Rom } = cellFrameAt([0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]), C = ECOLI, wCut = 0;
const len = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

test('nucleoid: 26 strands of 70 points 300 Å apart that stay inside the ellipsoid; the same seed gives the same DNA', () => {
  const a = nucleoid(F, H, mulberry32(5)), b = nucleoid(F, H, mulberry32(5)), c = nucleoid(F, H, mulberry32(6));
  assert.equal(a.tubes.length, NUCLEOID.strands); assert.ok(a.tubes.every((t) => t.length === NUCLEOID.steps)); assert.equal(a.length, NUCLEOID.strands * NUCLEOID.steps * NUCLEOID.step);
  assert.deepEqual(a.tubes, b.tubes); assert.notDeepEqual(a.tubes, c.tubes);
  const worst = Math.max(...a.tubes.flat().map((p) => { const L = F.loc(p); return (L.u / (H * NUCLEOID.fraction)) ** 2 + (L.y * L.y + L.w * L.w) / NUCLEOID.radius ** 2; }));
  assert.ok(worst < 1.6, `the walk may step just out before it turns back (${worst})`);
  const steps = a.tubes[0].slice(1).map((p, i) => len(p, a.tubes[0][i])); assert.ok(steps.every((d) => Math.abs(d - NUCLEOID.step) < 1 || d < 2 * NUCLEOID.step), 'a walk of 300 Å steps (the bend at the surface counts once)');
});

test('ribosomes of the cell: 25 000 placed, about 90 % kept out of the nucleoid, only those behind the cut and outside the corner are drawn, as pairs', () => {
  const inRegion = (L) => Math.abs(L.u - C.uF) < C.reg && L.w > -C.reg && L.w < wCut && L.y > C.Rim - C.regDepth;
  const r = cellRibosomes(F, C, H, mulberry32(9), { wCut, inRegion });
  assert.equal(r.total, 25000); assert.equal(r.big.length, r.drawn); assert.equal(r.small.length, r.drawn);
  assert.ok(r.drawn > 4000 && r.drawn < 16000, `drawn ${r.drawn}`);
  assert.ok(r.big.every((p) => F.loc(p).w <= wCut - 120 + 1e-6), 'behind the cut'); assert.ok(r.big.every((p) => !inRegion(F.loc(p))), 'outside the corner box');
  const inNuc = r.big.filter((p) => inNucleoid(F.loc(p), H)).length / r.drawn; assert.ok(inNuc < 0.05, `${(inNuc * 100).toFixed(1)} % of the drawn ribosomes in the nucleoid (about 10 % of those that fall there are kept)`);
  assert.ok(r.big.every((p, i) => { const d = len(p, r.small[i]); return Math.abs(d - 95) < 1e-6; }), 'the small subunit sits 95 Å from the large one');
  const again = cellRibosomes(F, C, H, mulberry32(9), { wCut, inRegion }); assert.deepEqual(again.big.slice(0, 50), r.big.slice(0, 50));
});

test('flagella: at most five, on the back half, outside the outer membrane; a helix of 3 µm (201 points 150 Å apart along it), with a motor through the envelope', () => {
  const fl = flagella(F, C, H, Rom, mulberry32(3));
  assert.ok(fl.length >= 1 && fl.length <= 5, `${fl.length}`);
  for (const f of fl) {
    assert.equal(f.path.length, 201); assert.ok(Math.sin(Math.atan2(F.loc(f.base).w, F.loc(f.base).y)) < -0.4, 'on the back half');
    const L = F.loc(f.base); assert.ok(Math.hypot(L.y, L.w) >= Rom || Math.abs(L.u) > H, 'at or beyond the outer membrane');
    const chord = len(f.path[0], f.path.at(-1)); assert.ok(chord < 30000 && chord > 20000, `${chord}`);
    assert.equal(f.motor.length, C.env + 160); assert.ok(Math.abs(Math.hypot(...f.motor.axis) - 1) < 1e-9);
  }
});

test('peptidoglycan and LPS: glycan segments of 30 Å (and 45 Å cross-links) in the corner region; 7000 short LPS lines just outside the outer membrane', () => {
  const net = envelopeNet(F, C, Rom, mulberry32(4), { wCut: 800 });
  assert.equal(net.lps.length, 7000); assert.ok(net.glycan.length > 1000, `${net.glycan.length}`);
  const lens = net.glycan.map((s) => len(s.a, s.b)); assert.ok(lens.every((d) => d < 60), 'strand pieces and cross-links are short');
  assert.ok(net.glycan.every((s) => Math.abs(F.loc(s.a).u - C.uF) <= C.reg + 45 + 1e-6));
  const radius = (p) => { const L = F.loc(p); return Math.hypot(L.y, L.w); };
  assert.ok(net.lps.every((s) => radius(s.a) > Rom + 15 && radius(s.b) > radius(s.a)), 'LPS sticks out of the outer leaflet');
});

test('the inner membrane has an opening where the atomic structure is: triangles whose centre is inside are left out, the rest stay', async () => {
  const { capsuleSurface } = await import('../cell-geometry.mjs');
  const whole = capsuleSurface(F, C.Rim, H, 40, 32), holed = capsuleSurface(F, C.Rim, H, 40, 32, { u: [C.uF - 500, C.uF + 500], w: [-500, 500], y: C.Rim * 0.5 });
  assert.equal(holed.positions.length, whole.positions.length); assert.ok(holed.indices.length < whole.indices.length && holed.indices.length > whole.indices.length - 400, `${whole.indices.length - holed.indices.length} indices left out`);
  for (let t = 0; t < holed.indices.length; t += 3) { const c = [0, 1, 2].map((k) => [0, 1, 2].reduce((s, n) => s + holed.positions[holed.indices[t + n] * 3 + k], 0) / 3), L = F.loc(c); assert.ok(!(L.u > C.uF - 500 && L.u < C.uF + 500 && L.w > -500 && L.w < 500 && L.y > C.Rim * 0.5)); }
  assert.deepEqual(capsuleSurface(F, C.Rim, H, 40, 32, null).indices, whole.indices);
});
