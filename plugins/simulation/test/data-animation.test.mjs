import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeDataAnimation, normalizeAnchor } from '../data-spec.mjs';
import { DataAnimation, flipAboutHorizontal } from '../data-animation.mjs';
import { seededRng } from '../../motion/particles.mjs';
import { makeStructure, pack } from './fixture.mjs';

const make = (raw, options = {}, structure = makeStructure()) => new DataAnimation(raw, structure, { rng: seededRng(options.seed ?? 7), ...options });
const copy = (x) => JSON.parse(JSON.stringify(x));

test('the official data packs are read without errors or warnings', () => {
  for (const name of ['adk-reaction-data', 'kcsa-data']) {
    const { spec, errors, warnings } = normalizeDataAnimation(pack(name));
    assert.deepEqual([errors, warnings], [[], []], name);
    assert.equal(spec.version, 1);
  }
  const kcsa = normalizeDataAnimation(pack('kcsa-data')).spec;
  assert.deepEqual(Object.keys(kcsa.compartments), ['胞内', '胞外']); assert.equal(kcsa.flows[0].via.length, 3); assert.deepEqual(kcsa.flows[0].via[2], { ligands: 'K', order: 'up' });
});

test('the reader refuses what cannot run and says why; it keeps only known fields, clamps, caps', () => {
  const bad = normalizeDataAnimation({ version: 2, pools: [{ species: 'H⁺', in: '不存在', n: 5 }], flows: [{ species: 'K⁺', via: [], rate: 1 }], reactions: [{ in: [{ species: 'A' }], out: [], rate: 1 }], code: 'alert(1)' });
  assert.ok(bad.errors.some((e) => /版本 2/.test(e)) && bad.errors.some((e) => /不存在的区室“不存在”/.test(e)) && bad.errors.some((e) => /路径/.test(e)) && bad.errors.some((e) => /位点/.test(e)) && bad.errors.some((e) => /来源区室/.test(e)));
  assert.ok(!('code' in bad.spec));
  assert.throws(() => make({ version: 2 }), /无法运行/);
  const big = normalizeDataAnimation({ version: 1, species: { X: { col: 'red', r: 99 } }, pools: [{ species: 'X', in: '溶液', n: 99999 }], flows: Array.from({ length: 40 }, () => ({ species: 'X', via: [[0, 0, 0]], rate: 1e9 })) });
  assert.equal(big.spec.pools[0].n, 200); assert.equal(big.spec.flows.length, 16); assert.equal(big.spec.flows[0].rate, 20); assert.equal(big.spec.species.X.r, 6); assert.equal(big.spec.species.X.col, '#ffffff');
  assert.deepEqual(normalizeAnchor({ ligand: 'k', index: -3, offset: [1, 2, 'x'] }), { ligand: 'k', index: 0, offset: [1, 2, 0] }); assert.equal(normalizeAnchor({ nonsense: 1 }), null); assert.equal(normalizeAnchor([1, 2]), null);
  assert.ok(normalizeDataAnimation({ version: 1, flows: [{ species: 'K⁺', via: [[0, 0, 0]], rate: 0 }] }).warnings.some((w) => /不会发生/.test(w)));
});

test('anchors: ligands expand to every copy in order, residues and parts are looked up, a missing one falls back to the centre with a warning', () => {
  const a = make(pack('kcsa-data'));
  assert.deepEqual(a.anchor({ ligands: 'K', order: 'up' }).map((p) => p[1]), [-12, -4, 4, 12]); assert.deepEqual(a.anchor({ ligands: 'K', order: 'down' }).map((p) => p[1]), [12, 4, -4, -12]);
  assert.deepEqual(a.anchor({ ligand: 'K', index: 99 }), [[0, 12, 0]]); assert.deepEqual(a.anchor({ ligand: 'ap5', offset: [1, 1, 1] }), [[9, 1, 4]]);
  assert.deepEqual(a.anchor({ residue: '77', part: 'kcsa' }), [[20, 0, 0]]); assert.deepEqual(a.anchor({ part: 'subunit a' }), [[20, 0, 0]]);
  assert.deepEqual(a.anchor({ membrane: 0 }), [[a.c[0], 0, a.c[2]]]); assert.deepEqual(a.anchor([1, 2, 3]), [[1, 2, 3]]);
  assert.deepEqual(a.anchor({ ligand: 'ZZZ' }), [a.c]); assert.ok(a.warnings.some((w) => /ZZZ/.test(w)));
  assert.deepEqual(a.anchor({ residue: '1' }), [a.c]);
  assert.deepEqual(flipAboutHorizontal([1, 2, 3], [0, 10, 5]), [1, 18, 7]);
});

test('AdK pack: pools fill, the reaction runs (reactants taken, consumed, two ADP released), counted, named, and the metering balances', () => {
  const a = make(pack('adk-reaction-data'));
  assert.deepEqual(a.summary().inventory, { ATP: 5, AMP: 5, ADP: 3 });
  a.run(900);   // 30 s
  const s = a.summary();
  assert.ok(s.counters['ADP 生成'] >= 3, `reactions ${s.counters['ADP 生成']}`);
  assert.ok(s.events.some((e) => e.text === 'ATP + AMP → 2 ADP（γ-磷酸转移）'));
  assert.ok(s.ledger.consumed.ATP >= 3 && s.ledger.consumed.AMP >= 3 && s.ledger.created.ADP >= 6);
  for (const [name, { expected, actual }] of Object.entries(a.balance())) assert.equal(actual, expected, `${name}: metering must balance`);
  assert.deepEqual(s.violations, []);
  const names = a.frame().items.map((i) => i.name); assert.ok(names.length > 0 && names.every((n) => ['ATP', 'AMP', 'ADP'].includes(n)));
  assert.ok(a.frame().items.every((i) => i.name && /^#[0-9a-f]{6}$/.test(i.color)));
});

test('KcsA pack: K⁺ flows from the cell to the outside through the anchors, events fire at their points, counter counts, metering balances', () => {
  const a = make(pack('kcsa-data'));
  const before = a.summary().inventory;
  a.run(1200);   // 40 s
  const s = a.summary();
  assert.ok(s.counters['K⁺ 外流'] >= 5, `flow ${s.counters['K⁺ 外流']}`);
  assert.ok(s.events.some((e) => e.text === '脱水：羰基氧替代水分子') && s.events.some((e) => e.text === '离开过滤器，重新水合'));
  assert.ok(s.ledger.taken['K⁺'] >= 5 && s.ledger.given['K⁺'] >= 4);
  for (const [name, { expected, actual }] of Object.entries(a.balance())) assert.equal(actual, expected, `${name}: metering must balance`);
  const comp = (name, item) => a.comp[name].inside(item.position);
  const free = a.frame().items.filter((i) => i.kind === 'pool' && i.name === 'K⁺');
  const inside = free.filter((i) => comp('胞内', i) || comp('胞外', i) || i.alpha < 1).length;
  assert.ok(inside >= 0.7 * free.length, `most pool K⁺ are in their compartments (${inside}/${free.length}); one just given back may sit at the edge`);
  assert.ok(before['K⁺'] === 13 && before['Na⁺'] === 8);
});

test('same seed, same history; another seed another one; fast scale counts without journeys and shows named streams', () => {
  const run = (seed, scale) => { const a = make(pack('kcsa-data'), { seed, scale: () => scale }); a.run(300); return a; };
  const a = run(3, 'slow'), b = run(3, 'slow');
  assert.deepEqual(a.frame(), b.frame()); assert.deepEqual(a.summary(), b.summary()); assert.notDeepEqual(run(4, 'slow').frame().items.map((i) => i.position), a.frame().items.map((i) => i.position));
  const fast = run(3, 'fast'), s = fast.summary();
  assert.ok(s.counters['K⁺ 外流'] >= 5, 'the counter follows the rate on the fast scale'); assert.equal(fast.motion.running, 0, 'no journeys on the fast scale');
  const streams = fast.frame().items.filter((i) => i.kind === 'stream'); assert.ok(streams.length > 0 && streams.every((i) => i.name.startsWith('K⁺') && i.radius > 0)); assert.equal(streams.filter((i) => i.label).length, fast.layer.filter(({ stream }) => stream.parts.length).length, 'one name tag per stream that has particles');
});

test('conserved quantities: a balanced reaction passes (adenylate phosphates 3+1 -> 2+2), an unbalanced one is reported with an event', () => {
  const ok = copy(pack('adk-reaction-data')); ok.conserved = [{ name: '磷酸基团', weights: { ATP: 3, ADP: 2, AMP: 1 } }];
  const a = make(ok); a.run(600); assert.ok(a.summary().counters['ADP 生成'] > 0); assert.deepEqual(a.summary().violations, []);
  const bad = copy(ok); bad.reactions[0].out = [{ species: 'ADP', to: '溶液' }];   // one ADP only: 4 phosphates in, 2 out
  const b = make(bad); b.run(600);
  assert.ok(b.summary().violations.length > 0 && b.summary().violations[0].before === 4 && b.summary().violations[0].after === 2);
  assert.ok(b.summary().events.some((e) => /不守恒/.test(e.text)));
  assert.ok(Object.values(b.balance()).every(({ expected, actual }) => actual === expected), 'the ledger still balances: it counts what happened, whatever the chemistry');
});

test('flows without a source or a target create and remove molecules, all of it metered', () => {
  const spec = { version: 1, compartments: { 溶液: {} }, flows: [{ species: 'e⁻', via: [{ ligand: 'AP5' }, [0, 20, 0]], rate: 1, counter: '电子', events: [{ at: 0, text: '起点事件' }] }] };
  const a = make(spec); a.run(450);
  const s = a.summary();
  assert.ok(s.counters['电子'] >= 3 && s.ledger.created['e⁻'] >= s.counters['电子'] && s.ledger.vanished['e⁻'] >= 2);
  assert.ok(s.events.some((e) => e.text === '起点事件'), 'an event at the first point fires (the classic never showed it)');
  for (const { expected, actual } of Object.values(a.balance())) assert.equal(actual, expected);
});

test('dispose: everything stops and nothing is called afterwards', () => {
  const a = make(pack('adk-reaction-data')); a.run(200); const counters = a.summary().counters;
  a.dispose(); assert.equal(a.motion.running, 0); a.motion.tick(5); a.motion.flush(); assert.deepEqual(a.summary().counters, counters);
});
