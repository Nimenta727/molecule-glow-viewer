import assert from 'node:assert/strict';
import test from 'node:test';
import { createKcsaPlayer } from '../index.mjs';
import { kcsaFixture } from './fixture.mjs';

const player = (state = { seed: 3 }) => createKcsaPlayer({ ...kcsaFixture(), state });

test('free ions fill the two baths in proportion to their concentrations, every particle named, the same picture whenever the same time is shown', () => {
  const p = player();
  p.seek(20);
  const e = p.extras(), bulk = e.clouds['kcsa-bulk'];
  const count = (name) => bulk.filter((i) => i.name.startsWith(name)).length;
  assert.equal(count('K⁺（胞内'), 56, 'Ki = 140 mM → 56'); assert.equal(count('K⁺（胞外'), 2, 'Ko = 5 mM → 2');
  assert.equal(count('Na⁺（胞内'), 4); assert.equal(count('Na⁺（胞外'), 56);
  assert.ok(bulk.every((i) => i.name && i.radius > 0 && i.position.every(Number.isFinite) && /^#[0-9a-fA-F]{6}$/.test(i.color)));
  assert.deepEqual(p.extras(), e, 'asking again changes nothing');
  p.seek(60); const later = p.extras().clouds['kcsa-bulk']; p.seek(20);
  assert.deepEqual(p.extras().clouds['kcsa-bulk'], bulk, 'seeking back shows the same picture');
  assert.notDeepEqual(later.map((i) => i.position), bulk.map((i) => i.position), 'the ions drift with time');
  p.setParameters({ Ki: 20, Ko: 100 }); p.seek(21);
  const changed = p.extras().clouds['kcsa-bulk'];
  assert.equal(changed.filter((i) => i.name.startsWith('K⁺（胞内')).length, 8); assert.equal(changed.filter((i) => i.name.startsWith('K⁺（胞外')).length, 40);
});

test('the extracellular Na⁺ control sets the size of the Na⁺ bath outside and nothing else (as in the classic: no rate depends on it)', () => {
  const p = player({ seed: 3 }), na = (bath) => p.extras().clouds['kcsa-bulk'].filter((i) => i.name.startsWith('Na⁺（' + bath)).length;
  p.seek(30); const outside = na('胞外');
  assert.equal(outside, 56, 'default 140 mM → 56');
  p.setParameters({ Nao: 0 }); p.seek(31); assert.equal(na('胞外'), 0, '0 mM → no Na⁺ outside');
  p.setParameters({ Nao: 50 }); p.seek(32); assert.equal(na('胞外'), 20, '50 mM → 20');
  assert.equal(na('胞内'), 4, 'the inside bath does not follow it');
  const control = player({ seed: 3 }); control.seek(32);
  assert.deepEqual(p.snapshot().counters, control.snapshot().counters, 'the channel events and counters are the same whatever the outside Na⁺');
  assert.throws(() => p.setParameters({ Nao: 151 }), /Nao/);
});

test('hydration shells circle ions in solution and are gone in the filter; empty filter sites hold water', () => {
  const p = player({ seed: 3 });
  let withShell = 0, filterOnly = 0, waters = 0;
  for (let t = 0; t <= 119; t += 0.37) {
    p.seek(t); const water = p.extras().clouds['kcsa-water'], shell = water.filter((i) => /水合层/.test(i.name));
    assert.equal(shell.length % 6, 0, 'six waters per hydrated ion');
    assert.ok(water.every((i) => i.name.startsWith('H₂O') && i.position.every(Number.isFinite)));
    if (shell.length) withShell++; else filterOnly++;
    waters += water.filter((i) => i.name === 'H₂O（过滤器里的水）').length;
  }
  assert.ok(withShell > 0 && filterOnly > 0, `shells in ${withShell} frames, none in ${filterOnly}`);
  assert.ok(waters > 0, 'water in the empty sites');
});

test('the curves cover the last ten seconds with the current, whether the channel conducts, and E_K; they react to the parameters', () => {
  const p = player();
  p.seek(30); const a = p.extras();
  assert.deepEqual(a.series.map((s) => s.label), ['单通道电流', '导电', 'E_K']); assert.ok(a.series.every((s) => s.values.length === 40 && s.values.every(Number.isFinite)));
  assert.equal(a.window, 10);
  const ek = 25.69 * Math.log(5 / 140); assert.ok(Math.abs(a.series[2].values.at(-1) - ek) < 1e-9, 'E_K = 25.69 ln(Ko/Ki)');
  assert.ok(a.series[1].values.every((v) => v === 0 || v === 1));
  p.setParameters({ Ko: 140 }); p.seek(31);
  assert.ok(Math.abs(p.extras().series[2].values.at(-1)) < 1e-9, 'E_K is zero with equal K⁺');
  p.seek(2); assert.equal(p.extras().window, 2, 'early on the window is what has happened so far');
});

import { buildKcsaStructure } from '../structure.mjs';
test('the bath outside lies beyond the extracellular mouth of the pore and the bath inside beyond the intracellular one, along the channel axis', () => {
  const input = kcsaFixture(), structure = buildKcsaStructure(input.model, input.states), p = createKcsaPlayer({ ...input, state: { seed: 3 } });
  p.seek(5); const bulk = p.extras().clouds['kcsa-bulk'];
  const along = (item) => item.position.reduce((t, v, k) => t + v * structure.axis[k], 0), mean = (list) => list.reduce((t, i) => t + along(i), 0) / list.length;
  const outside = bulk.filter((i) => i.name.includes('胞外')), inside = bulk.filter((i) => i.name.includes('胞内'));
  const pore = (name) => structure.point(structure.sites[name]).reduce((t, v, k) => t + v * structure.axis[k], 0);
  assert.ok(outside.length && inside.length);
  assert.ok(outside.every((i) => along(i) > pore('S0')), 'every outside ion is beyond S0');
  assert.ok(inside.every((i) => along(i) < pore('cav')), 'every inside ion is below the central cavity');
  assert.ok(mean(outside) > mean(inside));
});
