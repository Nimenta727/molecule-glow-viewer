import assert from 'node:assert/strict';
import test from 'node:test';
import { createComposition } from '../composition.mjs';
import { createMarkovRun } from '../markov-model.mjs';
import { translationModel, ORFS } from '../translation.mjs';
import { kcsaMarkov } from './kcsa-markov.mjs';
import { DEFAULTS } from '../../kcsa/kinetics.mjs';

// the cell corner: a ribosome in the cytoplasm and a KcsA channel in the membrane, side by side
const station = (extra = {}) => ({
  members: [
    { id: 'ribosome', label: '核糖体', process: translationModel(ORFS.ubq), seed: 3, timeScale: 1 },
    { id: 'channel', label: '钾通道', process: kcsaMarkov, seed: 5, timeScale: 2, schedule: [{ time: 0, ...DEFAULTS, speed: 1, pH: 4.2 }] }],
  controls: [
    { id: 'ery', label: '红霉素', targets: [{ member: 'ribosome', param: 'ERY' }] },
    { id: 'tc', targets: [{ member: 'ribosome', param: 'TC' }] },
    { id: 'pH', label: '胞内 pH', targets: [{ member: 'channel', param: 'pH' }] },
    { id: 'V', targets: [{ member: 'channel', param: 'V' }] }],
  ...extra });
const json = (x) => JSON.stringify(x);

test('each member runs on its own clock, seed and counters: the composition shows what the member alone would', () => {
  const c = createComposition(station()), s = c.at(40);
  const alone = createMarkovRun(translationModel(ORFS.ubq), 3, [{ time: 0 }]).at(40), chan = createMarkovRun(kcsaMarkov, 5, [{ time: 0, ...DEFAULTS, speed: 1, pH: 4.2 }]).at(80);
  assert.equal(json(s.members.ribosome), json(alone)); assert.equal(json(s.members.channel), json(chan));
  assert.equal(s.members.ribosome.time, 40); assert.equal(s.members.channel.time, 80, 'the channel clock runs at twice the scene clock');
  assert.equal(s.counters['ribosome.prot'], alone.counters.prot); assert.equal(s.counters['channel.out'], chan.counters.out); assert.ok(Object.keys(s.counters).every((k) => /^(ribosome|channel)\./.test(k)));
  assert.deepEqual(c.members.map((m) => [m.id, m.timeScale]), [['ribosome', 1], ['channel', 2]]);
});

test('changing a control of one station leaves the other station exactly as it was (every moment, bit for bit)', () => {
  const plain = createComposition(station()), c = createComposition(station());
  c.set('ery', 5, 30); c.set('pH', 7.5, 60);
  const before = [10, 29, 30, 45, 90, 150].map((t) => [plain.at(t), c.at(t)]);
  for (const [t, [p, q]] of [10, 29, 30, 45, 90, 150].map((t, i) => [t, before[i]])) {
    if (t < 30) assert.equal(json(p.members.ribosome), json(q.members.ribosome), `the ribosome before the drug is the same at ${t}`);
    if (t * 2 < 120) assert.equal(json(p.members.channel), json(q.members.channel), `the channel before its pH change (scene time 60) is the same at ${t}`);
  }
  // each change reaches only its own member
  const onlyEry = createComposition(station()); onlyEry.set('ery', 5, 30);
  for (const t of [10, 45, 90, 150]) assert.equal(json(onlyEry.at(t).members.channel), json(plain.at(t).members.channel), `a drug for the ribosome never touches the channel (t = ${t})`);
  const onlyPh = createComposition(station()); onlyPh.set('pH', 7.5, 60);
  for (const t of [10, 45, 90, 150]) assert.equal(json(onlyPh.at(t).members.ribosome), json(plain.at(t).members.ribosome), `a pH change for the channel never touches the ribosome (t = ${t})`);
  assert.notEqual(json(onlyEry.at(150).members.ribosome), json(plain.at(150).members.ribosome), 'but the ribosome does feel its drug');
  assert.notEqual(json(onlyPh.at(150).members.channel), json(plain.at(150).members.channel), 'and the channel its pH');
  assert.deepEqual(c.at(100).controls, { ery: 5, tc: 25, pH: 7.5, V: 50 }, 'the control values in force at that moment');
  assert.deepEqual(c.at(40).controls, { ery: 5, tc: 25, pH: 4.2, V: 50 });
});

test('erythromycin reaches the ribosome of the composition as it would alone, and the interventions are the whole saved state', () => {
  const c = createComposition(station()); c.set('ery', 5, 20); c.set('V', -60, 50);
  const alone = createMarkovRun(translationModel(ORFS.ubq), 3, [{ time: 0 }, { time: 20, ERY: 5 }]);
  assert.equal(json(c.at(100).members.ribosome), json(alone.at(100)));
  const saved = JSON.parse(JSON.stringify(c.save())), back = createComposition(station()); back.restore(saved);
  for (const t of [0, 25, 70, 120]) assert.equal(json(back.at(t)), json(c.at(t)), `a restored composition is the same at ${t}`);
  assert.deepEqual(saved.interventions.map((iv) => iv.control), ['ery', 'V']);
  const away = c.at(90); c.at(5); assert.equal(json(c.at(90)), json(away), 'looking elsewhere in time and coming back finds each station where it was');
});

test('rewinding and changing a control again replaces its later changes, and leaves the other controls\' changes', () => {
  const c = createComposition(station()); c.set('ery', 5, 50); c.set('tc', 10, 70); c.set('ery', 1, 20);
  assert.deepEqual(c.interventions.map((iv) => [iv.control, iv.t, iv.value]), [['ery', 20, 1], ['tc', 70, 10]]);
  assert.equal(c.at(100).controls.ery, 1);
  const none = createComposition(station()); none.set('tc', 10, 70); assert.equal(json(c.at(100).members.channel), json(none.at(100).members.channel));
  c.set('ery', 3, 20); assert.deepEqual(c.interventions.map((iv) => iv.value), [3, 10], 'the same moment is replaced too');
});

test('mistakes are refused with a message and change nothing', () => {
  const c = createComposition(station());
  assert.throws(() => c.set('nope', 1, 0), /没有控件/); assert.throws(() => c.set('ery', 99, 0), /应在 0–5/); assert.throws(() => c.set('ery', 1, -1), /不小于 0/); assert.throws(() => c.set('ery', NaN, 0), /应在/);
  assert.deepEqual(c.interventions, []);
  assert.throws(() => createComposition({ members: [] }), /1–8/); assert.throws(() => createComposition({ members: [{ id: 'a', process: { version: 1 } }] }), /无法运行/);
  assert.throws(() => createComposition({ members: station().members.map((m) => ({ ...m, id: 'x' })) }), /重复/); assert.throws(() => createComposition(station({ controls: [{ id: 'k', targets: [] }] })), /没有指向/);
  assert.throws(() => createComposition(station({ controls: [{ id: 'k', targets: [{ member: 'zzz', param: 'pH' }] }] })), /不存在的过程/); assert.throws(() => createComposition(station({ controls: [{ id: 'k', targets: [{ member: 'channel', param: 'zzz' }] }] })), /不存在的参数/);
  assert.throws(() => createComposition({ members: [{ ...station().members[0], timeScale: 0 }] }), /正数/);
  c.restore({ interventions: [{ control: 'nope', t: 1, value: 1 }, { control: 'ery', t: -1, value: 1 }, { control: 'ery', t: 5, value: 'x' }, { control: 'ery', t: 5, value: 2 }] }); assert.equal(c.interventions.length, 1);
});

test('one control can drive several stations at once, and each follows it on its own clock', () => {
  const shared = { members: [{ id: 'a', process: translationModel(ORFS.polyu), seed: 1, timeScale: 1 }, { id: 'b', process: translationModel(ORFS.polyu), seed: 2, timeScale: 0.5 }], controls: [{ id: 'tc', targets: [{ member: 'a', param: 'TC' }, { member: 'b', param: 'TC' }] }] };
  const c = createComposition(shared); c.set('tc', 60, 40);
  const a = createMarkovRun(translationModel(ORFS.polyu), 1, [{ time: 0 }, { time: 40, TC: 60 }]), b = createMarkovRun(translationModel(ORFS.polyu), 2, [{ time: 0 }, { time: 20, TC: 60 }]);
  assert.equal(json(c.at(80).members.a), json(a.at(80))); assert.equal(json(c.at(80).members.b), json(b.at(40)), 'the slow station gets the change at its own time 20');
});
