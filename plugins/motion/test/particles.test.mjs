import assert from 'node:assert/strict';
import test from 'node:test';
import { createOccupancy, openSpace, brownPath, catmullRom, boxRegion, shellRegion, ParticlePool, PoolSet, FlowStream, seededRng, makeRng, speciesOf, SPECIES } from '../particles.mjs';

// a wall of "residue atoms": a 3 x 3 patch of points on the plane x = 0, 6 Å apart
const wall = []; for (let y = -12; y <= 12; y += 6) for (let z = -12; z <= 12; z += 6) wall.push([0, y, z]);
const box = { c: [0, 0, 0], d: [1, 0, 0], n: [0, 0, 1], ulo: -80, uhi: 80, vlo: -80, vhi: 80, ym: 0 };

test('occupancy: busy / clearance see nearby atoms and push away from them', () => {
  const occ = createOccupancy(wall);
  assert.equal(occ.busy([2, 0, 0], 4), true);
  assert.equal(occ.busy([30, 0, 0], 4), false);
  assert.ok(Math.abs(occ.clearance([3, 0, 0], 6) - 3) < 1e-9);
  assert.equal(occ.clearance([30, 0, 0], 6), Infinity);
  assert.ok(occ.push[0] === 0, 'no neighbours, no push');
  occ.clearance([3, 0, 0], 6); assert.ok(occ.push[0] > 0, 'pushed away from the wall (+x)');
  const p = [1, 0, 0]; occ.pushClear(p, 6, seededRng(1).sim); assert.ok(occ.clearance(p, 6) >= 6 * 0.8);
});

test('brownPath: same seed same path; ends pinned; keeps clear of protein except near the binding ends', () => {
  const occ = createOccupancy(wall), A = [-40, 0, 0], B = [40, 3, 2];
  const a = brownPath(A, B, { free1: 6 }, { rng: seededRng(3), occupancy: occ }), b = brownPath(A, B, { free1: 6 }, { rng: seededRng(3), occupancy: occ });
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, brownPath(A, B, { free1: 6 }, { rng: seededRng(4), occupancy: occ }));
  assert.deepEqual(a[0].map((v) => +v.toFixed(9)), A); assert.deepEqual(a[a.length - 1].map((v) => +v.toFixed(9)), B);
  assert.equal(a.length, 23);
  // the straight line goes through the wall; the path is pushed around it (except right next to the ends, which are free)
  const straightBusy = Array.from({ length: 23 }, (_, i) => A.map((v, k) => v + (B[k] - v) * i / 22)).filter((p) => occ.busy(p, 4)).length;
  const bridgeBusy = a.filter((p, i) => i > 0 && i < 22 && occ.busy(p, 4)).length;
  assert.ok(straightBusy > 0 && bridgeBusy < straightBusy, `${bridgeBusy} < ${straightBusy}`);
});

test('curves: pass through the control points, two points are a straight line, fewer than two are refused', () => {
  const pts = [[0, 0, 0], [10, 5, 0], [20, -5, 4], [30, 0, 0]], c = catmullRom(pts);
  assert.deepEqual(c.point(0), pts[0]); c.point(1).forEach((v, i) => assert.ok(Math.abs(v - pts[3][i]) < 1e-9));
  c.point(1 / 3).forEach((v, i) => assert.ok(Math.abs(v - pts[1][i]) < 1e-9));
  assert.ok(c.length() >= Math.hypot(30, 0, 0));
  const line = catmullRom([[0, 0, 0], [10, 20, 30]]); line.point(0.25).forEach((v, i) => assert.ok(Math.abs(v - [2.5, 5, 7.5][i]) < 1e-9));
  assert.throws(() => catmullRom([[0, 0, 0]]), /两个点/);
});

test('regions: samples are inside, avoid protein, and shell regions respect the compartment test', () => {
  const rng = seededRng(2), occ = createOccupancy(wall), b = boxRegion(box, 20, 100, { rng, occupancy: occ }), s = shellRegion([0, 0, 0], 30, 70, (p) => p[1] > 0, { rng, occupancy: occ });
  for (let i = 0; i < 60; i++) {
    const p = b.sample(i % 3 === 0), q = s.sample(false);
    assert.ok(p && b.inside(p) && !occ.busy(p, 6)); assert.ok(q && s.inside(q) && q[1] > 0);
  }
  assert.equal(b.inside([0, 5, 0]), false, 'below the compartment');
  assert.ok(b.depth([0, 25, 0]) > b.depth([0, 90, 0]), 'depth is the distance from the face away from the membrane: the surplus drifts out there');
});

test('pool: filled to n, deterministic for a seed, stays in its region and out of protein, tracks a changed n', () => {
  const run = (seed) => {
    const rng = seededRng(seed), occ = createOccupancy(wall), region = boxRegion(box, 20, 100, { rng, occupancy: occ });
    const pool = new ParticlePool({ name: 'H⁺', region, n: 20 }, { rng, occupancy: occ }); pool.fill();
    assert.equal(pool.items.length, 20);
    for (let i = 0; i < 400; i++) {
      if (i === 150) pool.n = 28; if (i === 300) pool.n = 14;
      pool.update(1 / 30);
      for (const it of pool.items) if (it.mode === 'free') { assert.ok(region.inside(it.position), 'free particles stay in the bulk'); assert.equal(occ.busy(it.position, 7.4), false, 'and out of protein'); }
    }
    return pool;
  };
  const a = run(9), b = run(9);
  assert.deepEqual(a.items.map((i) => i.position), b.items.map((i) => i.position));
  assert.ok(Math.abs(a.items.filter((i) => i.mode !== 'out').length - 14) <= 1, 'settles near the lowered n');
  assert.ok(a.items.filter((i) => i.labelled).length <= a.maxTags, 'at most maxTags name tags in the bulk');
});

test('pool: take removes the nearest free particle, give returns it to the pool of the compartment it ended up in; an empty pool lets one drift in', () => {
  const rng = seededRng(6), region = boxRegion(box, 20, 100, { rng });
  const top = new ParticlePool({ name: 'H⁺', region, n: 6 }, { rng }), bottom = new ParticlePool({ name: 'H⁺', region: boxRegion(box, -100, -20, { rng }), n: 0 }, { rng });
  top.fill();
  const near = top.items[3].position.slice(), got = top.take(near);
  assert.equal(top.items.length, 5); assert.ok(!top.items.includes(got)); assert.deepEqual(got.position, near);
  assert.equal(got.name, 'H⁺');
  bottom.give(got); assert.equal(bottom.items.length, 1); assert.equal(bottom.items[0].mode, 'free'); assert.equal(bottom.items[0].alpha, 1);
  for (let i = 0; i < 6; i++) bottom.take([0, -60, 0]);   // more takes than particles: each one drifts in from the edge
  assert.equal(bottom.items.length, 0);
});

test('every particle has a name: unnamed pools and flows are refused, a scene lists only named particles', () => {
  const rng = seededRng(1), region = boxRegion(box, 20, 100, { rng });
  assert.throws(() => new ParticlePool({ region }, { rng }), /名字/);
  assert.throws(() => new ParticlePool({ region, name: '   ' }, { rng }), /名字/);
  assert.throws(() => new ParticlePool({ name: 'x' }, { rng }), /区域/);
  assert.throws(() => new FlowStream({ paths: [[[0, 0, 0], [1, 1, 1]]], per: 1 }, { rng }), /名字/);
  assert.throws(() => new FlowStream({ label: 'H⁺', paths: [], per: 1 }, { rng }), /路径/);
  const set = new PoolSet({ rng }); set.speciesPool('K⁺', 'in', region, 5); set.speciesPool('Pi', 'in', region, 3);
  const listed = [...set.particles()]; assert.equal(listed.length, 8);
  assert.ok(listed.every((p) => typeof p.name === 'string' && p.name.length && p.key.endsWith('@in')));
  assert.equal(set.speciesPool('K⁺', 'in', region), set.pools.get('K⁺@in'), 'same key, same pool');
  assert.deepEqual(speciesOf('H⁺'), SPECIES['H⁺']); assert.deepEqual(speciesOf('MyDrug', { MyDrug: { col: 1, r: 5 } }), { col: 1, r: 5 }); assert.equal(speciesOf('unknown').r, 2.4);
});

test('flow: emits per x cycles-per-second particles a second, all on the paths, none beyond max, leaves at the end; deterministic', () => {
  const paths = [[[0, 0, 0], [20, 10, 0], [40, 0, 10]], [[0, 5, 0], [40, 5, 0], [80, 5, 5]]];
  const make = (seed, extra = {}) => new FlowStream({ label: 'H⁺', r: 2.2, paths, per: 4, v: 80, ...extra }, { rng: seededRng(seed) });
  const f = make(4); for (let i = 0; i < 300; i++) f.update(1 / 30, 1);   // 10 s at 1 cycle/s
  assert.ok(Math.abs(f.emitted - 40) <= 2, `emitted ${f.emitted}`);
  assert.ok(f.finished > 0 && f.parts.length === f.emitted - f.finished);
  const snap = f.snapshot(); assert.ok(snap.length > 0 && snap.every((s) => s.name === 'H⁺' && s.scale > 0));
  const g = make(4); for (let i = 0; i < 300; i++) g.update(1 / 30, 1);
  assert.deepEqual(g.snapshot(), snap);
  const capped = make(4, { max: 5, per: 50 }); for (let i = 0; i < 60; i++) capped.update(1 / 30, 1);
  assert.ok(capped.parts.length <= 5);
  const idle = make(4); for (let i = 0; i < 60; i++) idle.update(1 / 30, 0); assert.equal(idle.emitted, 0, 'no flux, no particles');
  for (const s of snap) assert.ok(s.position.every(Number.isFinite));
});

test('random sources: a function serves both streams, a pair is kept, anything else is refused', () => {
  const r = () => 0.5; assert.equal(makeRng(r).sim, r); assert.equal(makeRng(r).vis, r);
  const pair = seededRng(1); assert.equal(makeRng(pair), pair);
  assert.throws(() => makeRng({}), /随机数/); assert.equal(openSpace.busy([0, 0, 0], 100), false);
});
