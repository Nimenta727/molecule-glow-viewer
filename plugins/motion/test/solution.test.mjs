import assert from 'node:assert/strict';
import test from 'node:test';
import { Solution, normalizeSolutionSpec, STEP, LIMITS } from '../solution.mjs';

// a small "protein": a ring of residues around the origin, 40 Å across, and two named residue groups
const points = Array.from({ length: 60 }, (_, i) => [20 * Math.cos(i * 0.4), (i % 5) * 4 - 8, 20 * Math.sin(i * 0.4)]);
const groups = { 'chain A': points.filter((p) => p[0] > 12), 'chain B': points.filter((p) => p[0] < -12), 'chain C': points.filter((p) => p[0] > 12) };
const resolveGroup = (e) => { if (!groups[e]) throw new Error('看不懂这个表达式'); return groups[e]; };
const make = (spec) => { const s = new Solution({ points, resolveGroup }); if (spec) s.setSpec(spec); return s; };

test('spec cleaning: known fields, clamped numbers, bad entries dropped, never throws', () => {
  assert.deepEqual(normalizeSolutionSpec(null), { seed: 7, scale: 'slow', pools: [], flows: [] });
  const s = normalizeSolutionSpec({ seed: 3, scale: 'fast', pools: [{ species: 'K⁺', n: 9999 }, { species: '', n: 3 }, { species: 'H⁺', n: 0 }, { species: 'Pi', n: '12' }, null],
    flows: [{ species: 'H⁺', from: ' chain A ', to: 'chain B', cps: 99 }, { species: 'H⁺', from: '', to: 'x' }], junk: 1 });
  assert.deepEqual(s, { seed: 3, scale: 'fast', pools: [{ species: 'K⁺', n: LIMITS.pool }, { species: 'Pi', n: 12 }], flows: [{ species: 'H⁺', from: 'chain A', to: 'chain B', cps: LIMITS.cps }] });
  assert.equal(normalizeSolutionSpec({ pools: Array.from({ length: 20 }, () => ({ species: 'H⁺', n: 1 })) }).pools.length, LIMITS.pools);
  assert.equal(normalizeSolutionSpec({ scale: 'weird' }).scale, 'slow');
});

test('pools: filled with the asked number of named particles, outside protein, and the same seed gives the same picture', () => {
  const a = make({ pools: [{ species: 'H⁺', n: 30 }, { species: 'ATP', n: 10 }] }), b = make({ pools: [{ species: 'H⁺', n: 30 }, { species: 'ATP', n: 10 }] });
  const items = a.frame(); assert.equal(items.length, 40);
  assert.ok(items.every((i) => i.name && /^#[0-9a-f]{6}$/.test(i.color) && i.radius > 0), 'every particle named and coloured');
  assert.ok(items.every((i) => !a.occupancy.busy(i.position, 5.9)), 'no particle starts inside protein');
  assert.ok(items.filter((i) => i.label).length <= 4, 'at most two name tags per species');
  assert.deepEqual(a.frame(), b.frame());
  a.run(120); b.run(120); assert.deepEqual(a.frame(), b.frame());
  assert.ok(a.frame().every((i) => !a.occupancy.busy(i.position, 5.9)), 'and never move into it (sampled >= 6 A, moves keep >= 7.5 A)');
  assert.notDeepEqual(make({ seed: 8, pools: [{ species: 'H⁺', n: 30 }] }).frame().map((i) => i.position), make({ seed: 7, pools: [{ species: 'H⁺', n: 30 }] }).frame().map((i) => i.position));
});

test('advance: fixed steps whatever the frame rate; a long pause does not fast-forward; reset returns to step 0', () => {
  const a = make({ pools: [{ species: 'K⁺', n: 12 }] }), b = make({ pools: [{ species: 'K⁺', n: 12 }] });
  for (let i = 0; i < 60; i++) a.advance(1 / 60); for (let i = 0; i < 20; i++) b.advance(1 / 20);
  assert.equal(a.steps, b.steps); assert.deepEqual(a.frame(), b.frame());
  const before = a.steps; a.advance(30); assert.ok(a.steps - before <= 4);
  const start = make({ pools: [{ species: 'K⁺', n: 12 }] }).frame(); a.reset(); assert.equal(a.steps, 0); assert.deepEqual(a.frame(), start);
  assert.equal(STEP, 1 / 30);
});

test('flows: a stream of the named species between two residue groups, shown on the fast scale; the slow scale shows the pools', () => {
  const s = make({ pools: [{ species: 'H⁺', n: 6 }], flows: [{ species: 'H⁺', from: 'chain A', to: 'chain B', cps: 2 }] });
  assert.deepEqual(s.errors, []); s.run(150);
  assert.ok(s.frame().every((i) => i.kind === 'pool') && s.frame().length === 6);
  s.setScale('fast'); const flow = s.frame();
  assert.ok(flow.length > 0 && flow.every((i) => i.kind === 'flow' && i.name === 'H⁺' && i.radius > 0)); assert.equal(flow.filter((i) => i.label).length, 1);
  assert.ok(s.summary().flows[0].emitted > 5 && s.summary().flows[0].moving === flow.length);
  s.setCps(0, 0); const emitted = s.summary().flows[0].emitted; s.run(60); assert.equal(s.summary().flows[0].emitted, emitted, 'no flux, no new particles');
  const none = make({ pools: [{ species: 'H⁺', n: 4 }] }); none.setScale('fast'); assert.equal(none.frame().length, 4, 'fast scale without flows still shows the pools');
});

test('flow errors are explained and the other flows still run', () => {
  const s = make({ flows: [{ species: 'H⁺', from: 'chain A', to: 'oops', cps: 1 }, { species: 'H⁺', from: 'chain A', to: 'chain C', cps: 1 }, { species: 'K⁺', from: 'chain A', to: 'chain B', cps: 1 }] });
  assert.equal(s.errors.length, 2); assert.match(s.errors[0], /终点“oops”：看不懂/); assert.match(s.errors[1], /重合/);
  assert.equal(s.flows.length, 1); assert.equal(s.flows[0].spec.species, 'K⁺');
});

test('editing: add and remove pools and flows; unknown species get a neutral look but still a name', () => {
  const s = make(); s.addPool('MyDrug', 5); s.addPool('H⁺', 3); s.addFlow('K⁺', 'chain A', 'chain B', 1);
  assert.equal(s.spec.pools.length, 2); assert.equal(s.spec.flows.length, 1);
  assert.ok(s.frame().filter((i) => i.name === 'MyDrug').every((i) => i.color === '#ffffff' && i.radius === 2.4));
  s.remove('pool', 0); assert.deepEqual(s.spec.pools.map((p) => p.species), ['H⁺']); s.remove('flow', 0); assert.equal(s.spec.flows.length, 0);
  assert.throws(() => new Solution({ points: [] }), /没有坐标/);
});

test('the saved spec round-trips and replays the same picture', () => {
  const a = make({ seed: 11, scale: 'fast', pools: [{ species: 'H⁺', n: 9 }], flows: [{ species: 'K⁺', from: 'chain A', to: 'chain B', cps: 1.5 }] });
  const b = make(JSON.parse(JSON.stringify(a.spec))); a.run(90); b.run(90); assert.deepEqual(a.frame(), b.frame()); assert.deepEqual(a.spec, b.spec);
});
