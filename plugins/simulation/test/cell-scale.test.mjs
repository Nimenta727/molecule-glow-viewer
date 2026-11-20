import assert from 'node:assert/strict';
import test from 'node:test';
import { ECOLI, capsuleFrame, cellFrameAt, capsuleProfile, capsuleSurface, capsuleVolume, capsuleArea } from '../cell-geometry.mjs';
import { levelOf, clipPlanes, inkAmount, easeInOut, scaleBar, zoomPose, createViewStack, LEVELS } from '../scale-ladder.mjs';

const near = (a, b, e = 1e-9) => assert.ok(Math.abs(a - b) < e, `${a} != ${b}`);

test('the cell is a capsule: the profile runs tip to tip, the surface is a closed mesh, volume and area follow the formulas', () => {
  const R = 4240, H = 5000, prof = capsuleProfile(R, H, 160);
  assert.equal(prof.length, 161); near(prof[0][0], -H - R, 1e-6); near(prof[0][1], 0, 1e-6); near(prof.at(-1)[0], H + R, 1e-6); near(prof.at(-1)[1], 0, 1e-6);
  assert.ok(prof.every(([u, r]) => r >= -1e-9 && r <= R + 1e-9 && Math.abs(u) <= H + R + 1e-9));
  assert.ok(prof.some(([u, r]) => Math.abs(u) < H && Math.abs(r - R) < 1e-9), 'a straight part of full radius');
  const F = capsuleFrame([0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]), mesh = capsuleSurface(F, R, H, 40, 32);
  assert.equal(mesh.positions.length, 41 * 33 * 3); assert.equal(mesh.indices.length, 40 * 32 * 6); assert.ok(mesh.indices.every((i) => i >= 0 && i < 41 * 33));
  for (let i = 0; i < mesh.positions.length; i += 3) { const x = mesh.positions[i], r = Math.hypot(mesh.positions[i + 1], mesh.positions[i + 2]); assert.ok(r <= R + 1e-3 && Math.abs(x) <= H + R + 1e-3); }
  near(capsuleVolume(R, H), Math.PI * R * R * 2 * H + 4 / 3 * Math.PI * R ** 3); near(capsuleArea(R, H), 2 * Math.PI * R * 2 * H + 4 * Math.PI * R * R);
});

test('the frame maps (u, angle, radius) to points and back; the cell is placed under the corner from the classic numbers', () => {
  const { frame, H, Rom } = cellFrameAt([100, 200, 300], [0, 0, 1], [0, 1, 0], [-1, 0, 0]);
  near(Rom, ECOLI.Rim + ECOLI.env); near(H, ECOLI.L / 2 - Rom - 20); assert.deepEqual(frame.o, [100, 200 - ECOLI.Rim, 300 - ECOLI.uF]);
  const p = frame.at(1234, 0.7, 2500), l = frame.loc(p); near(l.u, 1234, 1e-6); near(Math.hypot(l.y, l.w), 2500, 1e-6); near(Math.atan2(l.w, l.y), 0.7, 1e-9);
  const top = frame.at(0, 0, ECOLI.Rim); assert.deepEqual(top.map((v) => Math.round(v)), [100, 200, 300 - ECOLI.uF], 'the inner membrane passes through the corner up to the along-axis offset');
});

test('levels follow the camera distance; the clip planes, ink and scale bar follow it too', () => {
  assert.deepEqual([20000, 14000.1, 14000, 3000, 2600, 100].map(levelOf), ['cell', 'cell', 'region', 'region', 'machine', 'machine']); assert.deepEqual(LEVELS.map((l) => l.id), ['cell', 'region', 'machine']);
  assert.deepEqual(clipPlanes(300), { near: 1, far: 80900 }); assert.ok(clipPlanes(30000).near > clipPlanes(30).near);
  near(inkAmount(0), 1); near(inkAmount(20000), 0.45); near(inkAmount(10000), 0.6); near(inkAmount(5000, 2), 1.7);
  const bar = scaleBar(100, 45, 900); assert.ok(bar.pixels <= 150 && bar.length >= 10 && /nm$/.test(bar.label)); assert.match(scaleBar(30000, 45, 900).label, /µm$|nm$/);
  assert.ok(scaleBar(30000, 45, 900).length > scaleBar(100, 45, 900).length, 'zoomed out, the bar stands for a longer length');
});

test('a zoom flight goes through log distance with a slow-fast-slow ease and ends exactly at the target view', () => {
  const z = { t0: [0, 0, 0], t1: [100, 0, 0], dir0: [0, 0, 1], dir1: [1, 0, 1], d0: 20000, d1: 200 };
  const start = zoomPose(z, 0), mid = zoomPose(z, 0.5), end = zoomPose(z, 1);
  assert.deepEqual(start.target, [0, 0, 0]); near(start.distance, 20000, 1e-6); near(end.distance, 200, 1e-9); assert.deepEqual(end.target, [100, 0, 0]);
  near(mid.distance, Math.sqrt(20000 * 200), 1e-6); near(Math.hypot(...mid.direction), 1);
  assert.equal(easeInOut(0), 0); assert.equal(easeInOut(1), 1); assert.equal(easeInOut(0.5), 0.5); assert.ok(easeInOut(0.1) < 0.1 && easeInOut(0.9) > 0.9);
  const ds = [0, 0.25, 0.5, 0.75, 1].map((k) => zoomPose(z, k).distance); assert.ok(ds.every((d, i) => !i || d < ds[i - 1]), 'monotone');
  near(zoomPose(z, -1).distance, 20000, 1e-6); near(zoomPose(z, 5).distance, 200, 1e-9);
});

test('entering a level remembers the view; coming back restores it, level by level', () => {
  const s = createViewStack(3), view = (n) => ({ camera: { distance: n }, states: { ribosome: n * 2 } });
  assert.equal(s.back(), null); s.enter(view(20000), '细胞'); s.enter(view(3000), '细胞一角'); assert.equal(s.depth, 2); assert.deepEqual(s.trail(), ['细胞', '细胞一角']);
  const v = view(100); s.enter(v, '机器'); v.camera.distance = 1; assert.equal(s.back().camera.distance, 100, 'the saved view is a copy');
  assert.equal(s.back().camera.distance, 3000); assert.equal(s.back().camera.distance, 20000); assert.equal(s.back(), null);
  for (let i = 0; i < 5; i++) s.enter(view(i), String(i)); assert.equal(s.depth, 3, 'the oldest are dropped past the limit'); s.clear(); assert.equal(s.depth, 0);
});
