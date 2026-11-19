import test from 'node:test';
import assert from 'node:assert/strict';
import { createAdkPlayback, validateParameters } from '../playback.mjs';
const comparable = (player) => { const { playing, ...state } = player.snapshot(); return state; };
test('automatic opening/closing is deterministic across stepping, seeking and save/reopen', () => {
  const a = createAdkPlayback(), b = createAdkPlayback();
  assert.equal(a.snapshot().fraction, 0);
  a.play(); for (let i = 0; i < 300; i++) a.advance(0.1);
  b.seek(30); assert.deepEqual(comparable(a), comparable(b));
  assert.equal(a.snapshot().particles, undefined);
  a.setSpeed(2); a.seek(40); a.setMorph(0.7); a.seek(50);
  assert.equal(a.snapshot().fraction, 0.7);
  assert.deepEqual(comparable(createAdkPlayback(a.save())), comparable(a));
  a.seek(10); b.seek(10); assert.deepEqual(comparable(a), comparable(b));
});
test('manual fraction is exact and automatic resume is continuous', () => {
  const player = createAdkPlayback();
  for (const time of [1, 8, 13, 24]) for (const value of [0, 0.2, 0.5, 0.8, 1]) {
    player.seek(time); player.setMorph(value);
    assert.equal(player.snapshot().parameters.auto, 0);
    player.setMorph('auto');
    assert(Math.abs(player.snapshot().fraction - value) < 1e-10);
  }
  player.setMorph(1); player.seek(120); assert.equal(player.snapshot().fraction, 1);
  assert.deepEqual(player.snapshot().counters, { '闭合程度（%）': 100 });
});
test('invalid parameters and schedules fail without changing playback', () => {
  const player = createAdkPlayback(), before = player.save();
  for (const parameters of [{ morph: 2 }, { auto: 0.5 }, { ap5: -1 }, { ATP: 5 }, []]) assert.throws(() => player.setParameters(parameters));
  assert.throws(() => validateParameters({ morph: NaN }));
  assert.throws(() => player.setSpeed(4));
  assert.deepEqual(player.save(), before);
  assert.throws(() => createAdkPlayback({ schedule: [{ ...before.schedule[0], time: 1 }] }));
  player.dispose(); assert.throws(() => player.snapshot(), /已释放/); assert.throws(() => player.setMorph(0), /已释放/);
});
