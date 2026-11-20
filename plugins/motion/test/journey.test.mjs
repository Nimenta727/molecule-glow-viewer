import assert from 'node:assert/strict';
import test from 'node:test';
import { Journey, Motion, EventLog, membraneCrossing, ease, legAlpha } from '../journey.mjs';
import { ParticlePool, boxRegion, seededRng, createOccupancy } from '../particles.mjs';

const mk = (over = {}) => ({ name: 'H⁺', position: [0, 0, 0], alpha: 1, rotation: [0, 0, 0], ...over });
const line = [[0, 0, 0], [10, 0, 0], [20, 0, 0]];
const near = (a, b, e = 1e-9) => assert.ok(Math.abs(a - b) < e, `${a} != ${b}`);

test('journey: ends exactly on the last point after dur, never overshoots, and finishes on the right tick', () => {
  const it = mk(), j = new Journey(it, [{ path: line, dur: 1 }]); let ticks = 0;
  while (!j.step(0.25)) ticks++;
  assert.equal(ticks, 3); assert.deepEqual(it.position.map(Math.round), [20, 0, 0]); assert.equal(j.step(1), true, 'stays finished');
  near(new Journey(mk(), [{ path: line, dur: 0 }]).dur, 0.05);
});

test('legs run one after the other with no carry-over, later legs are computed when they start, and onDone runs last', () => {
  const it = mk(), calls = [];
  const j = new Journey(it, [
    { path: line, dur: 0.5, onEnd: () => calls.push('end1') },
    { path: (p) => { calls.push('path2@' + Math.round(p.position[0])); return [p.position, [30, 0, 0]]; }, dur: 0.5, onStart: () => calls.push('start2') },
  ], { onDone: () => calls.push('done') });
  j.step(0.5); assert.deepEqual(calls, ['end1', 'start2', 'path2@20'], 'second leg starts as the first ends');
  near(it.position[0], 20); j.step(0.25); assert.ok(it.position[0] > 20 && it.position[0] < 30, 'the first step of leg 2 is the next tick, from t = 0');
  j.step(0.25); assert.deepEqual(calls.at(-1), 'done'); near(it.position[0], 30);
});

test('fades, easing and tumble', () => {
  near(legAlpha(0.15, 0.05, { fadeIn: 0.3 }), 0.05 + 0.95 * 0.5); near(legAlpha(0.9, 1, { fadeOut: 0.2 }), 0.5); assert.equal(legAlpha(0.5, 1, {}), undefined);
  assert.equal(ease(-1), 0); assert.equal(ease(2), 1); assert.equal(ease(0.5), 0.5);
  const it = mk({ alpha: 0.05 }), j = new Journey(it, [{ path: line, dur: 1, fadeIn: 0.3, tumble: true }]); j.step(0.15);
  near(it.alpha, 0.05 + 0.95 * 0.5); near(it.rotation[0], 0.15 * 1.8); near(it.rotation[1], 0.15 * 1.2);
  j.step(1); assert.equal(it.alpha, 1);
});

test('journey input is checked: a named particle, at least one leg, paths of two or more points', () => {
  assert.throws(() => new Journey({ position: [0, 0, 0] }, [{ path: line }]), /名字/);
  assert.throws(() => new Journey(mk(), []), /一段/);
  assert.throws(() => new Journey(mk(), [{ path: [[0, 0, 0]] }]), /两个点/);
  assert.throws(() => new Journey(null, [{ path: line }]), /position/);
});

test('motion: ticks every journey, drops the finished, and clear() cancels everything without calling anything', () => {
  const m = new Motion(); let done = 0; const a = mk(), b = mk();
  m.go(a, [{ path: line, dur: 0.2 }], { onDone: () => done++ }); m.go(b, [{ path: line, dur: 5 }], { onDone: () => done++ });
  assert.equal(m.running, 2); m.tick(0.25); assert.equal(m.running, 1); assert.equal(done, 1); near(m.clock, 0.25);
  assert.equal(m.clear(), 1); assert.equal(m.running, 0); m.tick(10); assert.equal(done, 1); assert.ok(b.position[0] < 20);
});

test('event log: strips markup, times events with the clock, caps at its limit; tags age out', () => {
  let t = 1.23456; const log = new EventLog(() => t, 3);
  log.add('ADP + Pi → <b>ATP</b>', [1, 2, 3], 1); t = 2; log.add('b', [0, 0, 0]); log.add('c', [0, 0, 0]); log.add('d', [0, 0, 0]);
  assert.deepEqual(log.list().map((e) => e.text), ['b', 'c', 'd']); assert.equal(log.list()[0].t, 2);
  assert.equal(log.tags.length, 4); log.tick(1.5); assert.equal(log.tags.length, 3, 'the 1 s tag is gone, the 2.4 s ones remain'); log.tick(1); assert.equal(log.tags.length, 0);
  log.add('x', [0, 0, 0]); log.clear(); assert.equal(log.list().length, 0); assert.equal(log.tags.length, 0);
  const e = new EventLog(() => 12.34567); e.add('<i>x</i>', [0, 0, 0]); assert.equal(e.list()[0].t, 12.346); assert.equal(e.list()[0].text, 'x');
});

test('membrane crossing: the particle leaves the entry pool, is labelled on the way, and joins the exit pool; no exit pool: it just leaves', () => {
  const rng = seededRng(8), occupancy = createOccupancy([[0, 0, 0]]);
  const box = { c: [0, 0, 0], d: [1, 0, 0], n: [0, 0, 1], ulo: -80, uhi: 80, vlo: -80, vhi: 80, ym: 0 };
  const top = new ParticlePool({ name: 'H⁺', region: boxRegion(box, 25, 100, { rng, occupancy }), n: 5 }, { rng, occupancy }), bottom = new ParticlePool({ name: 'H⁺', region: boxRegion(box, -100, -25, { rng, occupancy }), n: 0 }, { rng, occupancy });
  top.fill(); const channel = [[0, 30, 0], [2, 8, 1], [0, -8, 0], [0, -30, 0]], motion = new Motion(); let counted = 0;
  const j = membraneCrossing(motion, top, bottom, channel, { label: 'H⁺ in', count: () => counted++, pace: () => 2 }, { rng, occupancy });
  assert.equal(top.items.length, 4); assert.equal(counted, 1); assert.equal(j.item.label, 'H⁺');
  const seen = new Set(); for (let i = 0; i < 600 && motion.running; i++) { motion.tick(1 / 30); seen.add(j.item.label); }
  assert.ok(seen.has('H⁺ in'), 'labelled while approaching'); assert.equal(motion.running, 0);
  assert.equal(bottom.items.length, 1); assert.equal(bottom.items[0], j.item); assert.equal(j.item.mode, 'free'); assert.equal(j.item.alpha, 1); assert.equal(j.item.label, 'H⁺');
  const k = membraneCrossing(motion, top, null, channel, {}, { rng, occupancy });
  for (let i = 0; i < 600 && motion.running; i++) motion.tick(1 / 30);
  assert.equal(k.item.gone, true); assert.equal(bottom.items.length, 1); assert.equal(top.items.length, 3);
  assert.throws(() => membraneCrossing(motion, top, bottom, [[0, 0, 0]], {}, { rng, occupancy }), /两个点/);
});
