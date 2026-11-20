import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeMachine, createMachine, registerProfile, machineKinds, ROTARY_TEMPLATE, OSCILLATING_TEMPLATE, MACHINE_SCHEDULE_LIMIT } from '../conformation-machine.mjs';

const plain = (s) => JSON.parse(JSON.stringify(s));

test('a declaration is checked by name; a partial one is merged over the template of its kind', () => {
  assert.deepEqual(machineKinds().sort(), ['oscillating', 'rotary']);
  const r = normalizeMachine({ kind: 'rotary' }); assert.equal(r.sites, 3); assert.deepEqual(r.stageAt, [...ROTARY_TEMPLATE.stageAt]); assert.equal(r.speed.default, 0.25);
  const o = normalizeMachine({ kind: 'oscillating' }); assert.equal(o.rate, 0.35); assert.equal(o.parameters.morph.integer, false); assert.equal(o.parameters.auto.integer, true);
  for (const [bad, pattern] of [[{ kind: 'spin' }, /kind 必须是/], [{ kind: 'rotary', sites: 1 }, /sites/], [{ kind: 'rotary', stageAt: [0.5, 0.4, 0.8, 0.9] }, /stageAt/], [{ kind: 'rotary', morph: { start: 0.5, span: 0.6 } }, /morph/],
    [{ kind: 'rotary', stepPhases: [0, 1] }, /stepPhases/], [{ kind: 'rotary', speed: { min: 2, max: 1 } }, /speed/], [{ kind: 'oscillating', rate: 0 }, /rate/], [{ kind: 'oscillating', lo: 0.5, span: 0.6 }, /lo/],
    [{ kind: 'oscillating', stages: { low: 0.9, high: 0.5 } }, /stages/], [{ kind: 'oscillating', manual: 'nope' }, /manual/], [{ kind: 'oscillating', parameters: { 'bad name': {} } }, /参数名/], [null, /kind/], [[], /kind/]]) assert.throws(() => normalizeMachine(bad), pattern ?? /kind/);
});

// a machine nobody has built before: four sites, its own stage windows, a different speed range and labels
const FOUR = normalizeMachine({ kind: 'rotary', sites: 4, stageAt: [0.2, 0.3, 0.6, 0.9], morph: { start: 0.3, span: 0.3 }, stepPhases: [0, 0.25, 0.45, 0.75, 0.95], speed: { min: 0.1, max: 2, default: 0.5, label: '转速' },
  counters: { cycles: '产物', unit: '质子' }, eventLabel: '位点释放产物' });

test('rotary: a four-site rotor makes one cycle per quarter turn; counters, events, stages and the changing shape follow the declaration', () => {
  const m = createMachine(FOUR, {}, { seed: 5, units: 12 });
  const s = m.seek(8);   // 0.5 turn/s for 8 s = 4 turns
  assert.equal(s.turns, 4); assert.deepEqual(s.counters, { 产物: 16, 质子: 48 }); assert.equal(s.events.length, 16); assert.deepEqual(s.events.at(-1), { time: 8, label: '位点释放产物', 产物: 16 });
  const at = (turns) => m.seek(turns / 0.5).stage;   // time for that many turns
  assert.deepEqual([0.01, 0.06, 0.09, 0.17, 0.23].map(at), [0, 1, 2, 3, 4], 'site phases 0.04, 0.24, 0.36, 0.68, 0.92');
  assert.equal(m.seek(0).conformation.fraction, 0); const mid = m.seek((0.3 + 0.15) / 4 / 0.5).conformation; assert.equal(mid.from, 0); assert.ok(Math.abs(mid.fraction - 0.5) < 1e-6, `${mid.fraction}`);
  assert.equal(m.seek(1.1 / 0.5).conformation.from, 0, 'turn 1.1 = site cycle 4 of the next turn: from = 4 % 4'); assert.equal(m.seek(0.3 / 0.5).conformation.from, 1);
});

test('rotary: seeking, stepping and reopening from the saved schedule give the same history; speed changes end everything after them', () => {
  const a = createMachine(FOUR, {}, { seed: 5, units: 12 }), b = createMachine(FOUR, {}, { seed: 5, units: 12 });
  a.play(); for (let i = 0; i < 240; i++) a.advance(1 / 30);
  a.pause(); assert.deepEqual(plain(a.snapshot()), plain(b.seek(a.snapshot().time)));
  a.seek(3); a.setSpeed(1); a.seek(6); a.setSpeed(0.25); const end = plain(a.seek(10)), saved = a.save();
  assert.equal(saved.rates.length, 3); const again = createMachine(FOUR, saved, { seed: 5, units: 12 }); assert.deepEqual(plain(again.seek(10)), end);
  assert.equal(a.stepTime(2) > 0, true); a.seek(4); a.setSpeed(2); assert.deepEqual(a.save().rates.map((r) => r.time), [0, 3, 4], 'a change in the past drops the later ones (the one at 6 is gone)');
  assert.throws(() => a.setSpeed(5), /转速范围为 0.1–2/); assert.throws(() => a.stepTime(9), /机制步骤/);
  assert.equal(createMachine(FOUR, { rates: [{ time: 1, speed: 1 }] }, {}).save().rates, undefined, 'a schedule that does not start at 0 is ignored');
  assert.equal(createMachine(FOUR, { speed: 99 }, {}).save().speed, 2, 'a saved speed is clamped to the range');
  const times = a.seek(10).events.map((e) => e.time); assert.deepEqual(times, [...times].sort((x, y) => x - y));
});

test('oscillating: a swing with its own end holds; both ends hold, the middle is eased; manual closure hands back to the swing without a jump', () => {
  const spec = normalizeMachine({ kind: 'oscillating', rate: 1, lo: 0.2, span: 0.5, stages: { low: 0.1, high: 0.9 }, steps: 3, counters: { percent: '关闭%' }, eventLabel: '改了', speed: { min: 0.5, max: 2, default: 1, label: '倍率' },
    parameters: { morph: { label: 'm', min: 0, max: 1, step: 0.01, value: 0 }, auto: { label: 'a', min: 0, max: 1, step: 1, value: 1 }, lamp: { label: 'l', min: 0, max: 2, step: 1, value: 2 } } });
  const m = createMachine(spec, {}, { label: '演示' });
  assert.equal(m.seek(0).fraction, 0); assert.ok(m.seek(1).fraction > 0 && m.seek(1).fraction < 1);
  const fractions = Array.from({ length: 60 }, (_, i) => m.seek(i * 0.2).fraction); assert.ok(fractions.every((f) => f >= 0 && f <= 1)); assert.ok(fractions.filter((f) => f === 0).length > 3 && fractions.filter((f) => f === 1).length > 3, 'both ends hold');
  for (const [time, value] of [[1, 0.3], [4.2, 0.7], [9, 0]]) { m.seek(time); m.setMorph(value); assert.equal(m.snapshot().parameters.auto, 0); assert.equal(m.snapshot().fraction, value); m.setMorph('auto'); assert.ok(Math.abs(m.snapshot().fraction - value) < 1e-9); }
  m.setParameters({ lamp: 1 }); assert.equal(m.snapshot().parameters.lamp, 1); assert.throws(() => m.setParameters({ lamp: 3 }), /演示参数 lamp 无效/); assert.throws(() => m.setParameters({ lamp: 0.5 }), /无效/);
  assert.deepEqual(m.snapshot().counters, { '关闭%': Math.round(m.snapshot().fraction * 100) }); assert.equal(m.stepTime(2), undefined); assert.throws(() => m.stepTime(3), /机制步骤/);
  const saved = m.save(), reopened = createMachine(spec, saved, { label: '演示' }); assert.deepEqual(plain(reopened.snapshot()), plain(m.snapshot()));
  assert.throws(() => createMachine(spec, { schedule: [{ ...saved.schedule[0], time: 1 }] }, { label: '演示' }), /顺序无效/); assert.throws(() => createMachine(spec, { schedule: [] }, {}), /超出范围/);
  m.dispose(); assert.throws(() => m.snapshot(), /演示已释放/);
});

test('the schedule is limited, playback follows the playhead, and a new profile can be registered', () => {
  const m = createMachine(normalizeMachine({ kind: 'rotary' }), {}, {});
  m.play(); m.advance(1); assert.equal(m.snapshot().time, 1); m.pause(); m.advance(5); assert.equal(m.snapshot().time, 1); m.setPlaybackRate(5); m.play(); m.advance(1); assert.equal(m.snapshot().time, 6);
  assert.throws(() => m.setPlaybackRate(3), /倍率/); assert.throws(() => m.seek(NaN), /有限/); assert.throws(() => m.advance(-1), /无效/);
  m.seek(119); m.play(); m.advance(10); assert.equal(m.snapshot().time, 120); assert.equal(m.snapshot().playing, false);
  const limited = createMachine(normalizeMachine({ kind: 'oscillating' }), {}, {});
  for (let i = 1; i < MACHINE_SCHEDULE_LIMIT; i++) { limited.seek(i / 10); limited.setParameters({ ap5: i % 2 }); }
  limited.seek(100); assert.throws(() => limited.setParameters({ ap5: 0 }), /已达上限/);
  registerProfile('ramp', { normalize: (raw) => ({ kind: 'ramp', per: raw.per ?? 2 }), create: (spec) => ({ snapshot: () => ({ stage: 0, per: spec.per }) }) });
  assert.deepEqual(createMachine(normalizeMachine({ kind: 'ramp', per: 7 }), {}, {}).snapshot(), { stage: 0, per: 7 }); assert.throws(() => registerProfile('ramp', {}), /已存在/);
  assert.ok(machineKinds().includes('ramp')); assert.ok(OSCILLATING_TEMPLATE.parameters.morph.integer === false);
});
