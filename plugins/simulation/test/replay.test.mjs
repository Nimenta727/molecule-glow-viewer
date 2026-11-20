import assert from 'node:assert/strict';
import test from 'node:test';
import { Replay, normalizeIntervention, normalizeLog, STEP, REPLAY_LIMITS } from '../replay.mjs';
import { DataAnimation } from '../data-animation.mjs';
import { seededRng } from '../../motion/particles.mjs';
import { RESPIRATORY_CHAIN_KINETICS } from '../works/mechanism-kinetics.mjs';

// A small engine whose result depends on the settings it reads, so any replay mistake shows in the number.
const makeCounter = (host) => ({ x: 0, t: 0, kinetics: { setControl(id, v) { if (id !== 'k') throw new Error('没有控件'); host.k = v; } }, step(dt) { this.t += dt; this.x += (host.k ?? 1) * host.pace * (host.scale === 'fast' ? 10 : 1); } });
const run = (steps, plan = {}) => { const r = new Replay({ make: (h) => makeCounter(h) }); for (let i = 0; i < steps; i++) { if (plan[i]) r.intervene(plan[i]); r.advance(1); } return r; };

test('an intervention is logged at its step; rewinding and running on gives exactly the same engine state', () => {
  const live = run(90, { 30: { kind: 'control', id: 'k', value: 4 }, 60: { kind: 'pace', value: 2 } });
  assert.deepEqual(live.log.map((e) => [e.step, e.kind]), [[30, 'control'], [60, 'pace']]);
  const x = live.engine.x; assert.equal(x, 30 * 1 + 30 * 4 + 30 * 8);
  live.seek(10); assert.equal(live.engine.x, 10); assert.equal(live.step, 10);
  live.seek(90); assert.equal(live.engine.x, x);                                         // the same future again
  live.seek(45); live.seek(75); live.seek(90); assert.equal(live.engine.x, x);          // forward from the middle too
  assert.equal(live.furthest, 90);
});

test('an intervention made in the past ends the old future', () => {
  const r = run(90, { 30: { kind: 'control', id: 'k', value: 4 }, 60: { kind: 'pace', value: 2 } });
  r.seek(40); const { dropped } = r.intervene({ kind: 'scale', value: 'fast' });
  assert.equal(dropped, 1); assert.deepEqual(r.log.map((e) => [e.step, e.kind]), [[30, 'control'], [40, 'scale']]);
  assert.equal(r.furthest, 40); r.advance(50);
  assert.equal(r.engine.x, 30 + 10 * 4 + 50 * 4 * 10);                                    // the pace change at 60 is gone; the scale change holds
});

test('a logged step is applied once when reached, also at step 0; an unknown control is skipped with a note, not thrown', () => {
  const r = new Replay({ make: (h) => makeCounter(h), log: [{ step: 0, kind: 'pace', value: 3 }, { step: 5, kind: 'control', id: 'nope', value: 1 }] });
  r.seek(10); assert.equal(r.engine.x, 30); assert.match(r.warnings[0], /第 5 步的干预已跳过/);
});

test('validation: bad entries are refused or dropped by name; the log is limited', () => {
  assert.throws(() => normalizeIntervention({ step: -1, kind: 'pace', value: 1 }), /步数/);
  assert.throws(() => normalizeIntervention({ step: 1, kind: 'pace', value: 9 }), /0\.3–3/);
  assert.throws(() => normalizeIntervention({ step: 1, kind: 'scale', value: 'x' }), /slow/);
  assert.throws(() => normalizeIntervention({ step: 1, kind: 'control', id: '', value: 1 }), /控件名/);
  assert.throws(() => normalizeIntervention({ step: 1, kind: 'fly' }), /未知/);
  const { log, dropped } = normalizeLog([{ step: 9, kind: 'pace', value: 1 }, { step: 2, kind: 'pace', value: 2 }, { step: 1.5, kind: 'pace', value: 1 }, 'x']);
  assert.deepEqual(log.map((e) => e.step), [2, 9]); assert.equal(dropped, 2);
  const r = new Replay({ make: (h) => makeCounter(h), log: Array.from({ length: REPLAY_LIMITS.interventions }, (_, i) => ({ step: i, kind: 'pace', value: 1 })) });
  assert.throws(() => r.intervene({ kind: 'pace', value: 2 }), /已满/);
});

test('save and restore: a new Replay from the saved log reaches the same state', () => {
  const live = run(60, { 20: { kind: 'control', id: 'k', value: 3 } }), saved = JSON.parse(JSON.stringify(live.save()));
  assert.equal(saved.step, 60);
  const again = new Replay({ make: (h) => makeCounter(h), log: saved.interventions }); again.seek(saved.step);
  assert.equal(again.engine.x, live.engine.x); assert.equal(again.time, 60 * STEP);
});

test('with the real data animation and a compartment model: rewinding and running on reproduces the kinetics bit for bit', () => {
  const structure = { points: Array.from({ length: 60 }, (_, i) => [(i % 6) * 8, Math.floor(i / 6) * 8 - 40, 0]), centre: [20, 0, 0] };
  const raw = { version: 1, compartments: { top: { side: 'above', membrane: 0, gap: 30 }, bot: { side: 'below', membrane: 0, gap: 30 } }, pools: [], flows: [], reactions: [] };
  const make = (host) => new DataAnimation(raw, structure, { rng: seededRng(7), pace: () => host.pace, scale: () => host.scale, kinetics: RESPIRATORY_CHAIN_KINETICS });
  let control; try { const probe = make({ pace: 1, scale: 'slow' }); control = probe.kinetics.model.controls[0]; } catch (error) { assert.fail(error.message); }
  const r = new Replay({ make }); r.advance(60); r.intervene({ kind: 'control', id: control.id, value: control.type === 'range' ? control.max : !control.default }); r.advance(120);
  const snap = () => JSON.stringify([r.engine.kinetics.save(), r.engine.summary().counters]);
  const end = snap(); r.seek(50); r.seek(180);
  assert.equal(snap(), end);
});
