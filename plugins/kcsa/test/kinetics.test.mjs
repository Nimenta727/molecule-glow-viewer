import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULTS, createKinetics, singleChannelCurrent, reversalPotential, validateParameters } from '../kinetics.mjs';
const config = (extra = {}) => ({ ...DEFAULTS, time: 0, speed: 1, ...extra });

test('KcsA detailed balance reverses current at E_K and retains symmetric conductance', () => {
  const c = config(), ek = reversalPotential(c);
  assert(Math.abs(ek + 85.6) < 0.1);
  assert(Math.abs(singleChannelCurrent({ ...c, V: ek })) < 1e-10);
  assert(singleChannelCurrent({ ...c, V: ek - 20 }) < 0);
  assert(singleChannelCurrent({ ...c, V: ek + 20 }) > 0);
  const conductance = singleChannelCurrent({ ...c, Ki: 150, Ko: 150, V: 1 }) * 1000;
  assert(conductance > 80 && conductance < 120, `${conductance} pS`);
});

test('seeded event history is independent of seek partition and can rewind', () => {
  const a = createKinetics(19, [config()]), b = createKinetics(19, [config()]);
  for (let time = 1; time <= 120; time++) a.at(time);
  assert.deepEqual(a.at(120), b.at(120));
  assert.deepEqual(a.at(20), createKinetics(19, [config()]).at(20));
  const edited = createKinetics(19, [config(), config({ time: 30, pH: 7 })]);
  assert.deepEqual(edited.at(20), b.at(20));
  assert(edited.at(120).out < b.at(120).out);
});

test('ensemble flux agrees with open-clock analytic current; pH and blockers inhibit', () => {
  function ensemble(parameters) {
    let net = 0, ns = 0, open = 0;
    for (let seed = 1; seed <= 128; seed++) {
      const s = createKinetics(seed, [config(parameters)]).at(120);
      net += s.out - s.inn; ns += s.ns; open += s.openSeconds;
    }
    return { net, ns, open };
  }
  const normal = ensemble({}), expected = normal.ns * singleChannelCurrent(DEFAULTS) / 160.2;
  assert(Math.abs(normal.net - expected) / expected < 0.12, `${normal.net} vs ${expected}`);
  assert(ensemble({ V: -140 }).net < 0);
  for (const params of [{ pH: 7 }, { TBA: 100 }, { Ba: 100 }, { wt: 1 }]) {
    assert(ensemble(params).open < normal.open * 0.5, JSON.stringify(params));
  }
});

test('parameter validation rejects out-of-range and undeclared controls', () => {
  for (const value of [{ pH: 9 }, { Ki: 0 }, { V: NaN }, { wt: 0.5 }, { unknown: 1 }, []]) assert.throws(() => validateParameters(value));
  assert.deepEqual(validateParameters({ pH: 7, wt: 1 }), { pH: 7, wt: 1 });
});

test('clock multiplier preserves event counts and sodium concentration controls rejection', () => {
  const a = createKinetics(7, [config()]).at(120);
  const b = createKinetics(7, [config({ speed: 2 })]).at(60);
  for (const field of ['out', 'inn', 'na', 'gate', 'perm']) assert.equal(a[field], b[field]);
  assert(Math.abs(a.ns - b.ns) < 1e-8);
  assert(Math.abs(a.gateSeconds - b.gateSeconds) < 1e-8);
  assert.equal(createKinetics(7, [config({ Nai: 0 })]).at(120).na, 0);
});
