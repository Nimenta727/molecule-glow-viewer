import assert from 'node:assert/strict';
import test from 'node:test';
import { compileExpression, ExpressionError, FUNCTION_NAMES } from '../expression.mjs';
import { compileKineticModel, KineticSimulation, phColour, KINETIC_LIMITS } from '../kinetic-model.mjs';
import { respiratoryChain, chloroplast } from './models.mjs';

const ev = (src, scope = {}) => compileExpression(src, Object.keys(scope))(scope);
const near = (a, b, e = 1e-12) => assert.ok(Math.abs(a - b) < e, `${a} != ${b}`);

test('expressions: arithmetic in the order written, power right to left, unary minus below power, truth is a number, ternary, calls', () => {
  assert.equal(ev('1 + 2 * 3 - 4 / 2'), 5); assert.equal(ev('2 ^ 3 ^ 2'), 512); assert.equal(ev('-2 ^ 2'), -4); assert.equal(ev('2 ^ -1'), 0.5); assert.equal(ev('(1 + 2) * 3'), 9);
  assert.equal(ev('1 < 2'), 1); assert.equal(ev('2 <= 1'), 0); assert.equal(ev('1 == 1 && 2 != 3'), 1); assert.equal(ev('0 || 0'), 0); assert.equal(ev('!0'), 1); assert.equal(ev('!5'), 0);
  assert.equal(ev('x > 1 ? x * 2 : -1', { x: 3 }), 6); assert.equal(ev('x > 1 ? x * 2 : -1', { x: 0 }), -1); assert.equal(ev('a ? 1 : b ? 2 : 3', { a: 0, b: 1 }), 2);
  near(ev('exp(1) + log(10) + log10(1000) + sqrt(16)'), Math.E + Math.log(10) + 3 + 4); assert.equal(ev('min(1, 2) + max(3, 4) + abs(-5) + clamp(9, 0, 2) + floor(2.7) + ceil(2.1) + round(2.5) + sign(-3) + pow(2, 3)'), 1 + 4 + 5 + 2 + 2 + 3 + 3 - 1 + 8);
  assert.equal(ev('1e-3 * 1000'), 1); assert.equal(ev('.5 + 0.25'), 0.75); assert.equal(ev('true + false'), 1);
  assert.ok(FUNCTION_NAMES.includes('clamp'));
  // it is JavaScript arithmetic: the same digits as the classic formula
  const x = 0.1234, y = 7.77; assert.equal(ev('1 + 38 * 10 ^ (6.82 - (7.2 - 0.0018 * x))', { x }), 1 + 38 * Math.pow(10, 6.82 - (7.2 - 0.0018 * x))); assert.equal(ev('11 / 3 * y', { y }), 11 / 3 * y);
});

test('expressions are checked once: unknown names, bad syntax, wrong argument counts, size and depth are refused with a message', () => {
  const bad = (src, names, re) => assert.throws(() => compileExpression(src, names), (e) => e instanceof ExpressionError && re.test(e.message), src);
  bad('x + 1', [], /没有定义“x”/); bad('1 +', [], /没写完/); bad('(1 + 2', [], /应该有“\)”/); bad('1 2', [], /多余/); bad('foo(1)', [], /没有函数“foo”/); bad('min(1)', [], /需要 2 个参数/); bad('1 ? 2', [], /应该有“:”/); bad('1 # 2', [], /看不懂/); bad('', [], /不能为空/);
  bad('1' + ' + 1'.repeat(400), [], /太长/); bad('('.repeat(60) + '1' + ')'.repeat(60), [], /嵌套太深/);
  // nothing outside the given names can be reached
  for (const src of ['constructor', '__proto__', 'process', 'globalThis', 'toString', 'hasOwnProperty']) bad(src, ['x'], /没有定义/);
  bad('x.y', ['x'], /看不懂|多余/); bad('x[0]', ['x'], /看不懂/); bad('`a`', [], /看不懂/);
  assert.equal(compileExpression('x', ['x'])(Object.create(null, { x: { value: 3 } })), 3, 'the scope may be a bare object');
});

test('kinetic models: the two classic models compile; mistakes are reported by place and name', () => {
  for (const m of [respiratoryChain, chloroplast]) assert.deepEqual(compileKineticModel(m).errors, []);
  const errors = (patch) => compileKineticModel({ ...respiratoryChain, ...patch }).errors.join('|');
  assert.match(errors({ version: 2 }), /版本 2/); assert.match(errors({ step: [{ set: 'nope', expr: '1' }] }), /不是状态变量/); assert.match(errors({ step: [{ let: 'a', expr: 'zzz + 1' }] }), /没有定义“zzz”/);
  assert.match(errors({ step: [{ let: 'NADt', expr: '1' }] }), /重复/); assert.match(errors({ state: { h: 1 } }), /不合法/); assert.match(errors({ state: { pmf: 'x' } }), /有限的数/);
  assert.match(errors({ controls: [{ id: 'k', type: 'range', min: 1, max: 0, step: 1, default: 0 }] }), /范围/); assert.match(errors({ series: [{ label: 'a', range: [1, 0], expr: 'pmf' }] }), /范围/);
  assert.match(errors({ dots: [{ label: 'a', expr: 'x' }] }), /名称.*区室/); assert.match(errors({ explain: [{ when: 'pmf', text: '' }] }), /没有文字/); assert.match(errors({ step: [] }), /没有任何步骤/);
  assert.match(errors({ explain: [{ text: '值 {zzz|1}' }] }), /没有定义“zzz”/);
  assert.ok(compileKineticModel(null).errors.length); assert.throws(() => new KineticSimulation({ version: 1 }), /无法运行/);
  assert.ok(KINETIC_LIMITS.step >= 96);
});

test('a running model: warm-up, controls, curves, read-outs, pH colours, dots, explanation; same inputs give the same numbers', () => {
  const a = new KineticSimulation(chloroplast), b = new KineticSimulation(chloroplast);
  for (let i = 0; i < 600; i++) { a.update(1 / 30); b.update(1 / 30); }
  assert.deepEqual(a.state, b.state); assert.ok(a.state.dpH > 1.5, 'light on: the lumen acidifies'); assert.equal(a.hist[0].length, 75, 'a point every 0.25 s or so');
  const [lumen, stroma] = [a.compartments().find((c) => /lumen/.test(c.name)), a.compartments().find((c) => /stroma/.test(c.name))];
  assert.ok(lumen.pH < stroma.pH && /^#[0-9a-f]{6}$/.test(lumen.colour));
  assert.match(a.readout()[0].text, /^\d\.\d\d$/); assert.match(a.readout()[2].text, / mV$/); assert.match(a.explain(), /光照稳态/);
  a.setControl('light', false); for (let i = 0; i < 300; i++) a.update(1 / 30); assert.match(a.explain(), /黑暗/); assert.ok(a.state.dpH < b.state.dpH);
  assert.throws(() => a.setControl('nope', 1), /没有控件/);
  const d = a.dots(); assert.ok(d.every((x) => x.count >= 0 && x.count <= 60) && d[0].label === 'H⁺');
  const r = new KineticSimulation(respiratoryChain); assert.throws(() => r.setControl('sub', 'x') || r.setControl('zzz', 1), /没有控件/);
});

test('inputs, range controls, save and restore, and a diverging model is stopped instead of drawn', () => {
  const model = { version: 1, inputs: { effluxed: 'K⁺ 外流' }, constants: { Ki0: 140 }, state: { y: 1 }, controls: [{ id: 'k', type: 'range', label: 'k', min: 0, max: 10, step: 1, default: 2 }],
    step: [{ set: 'y', expr: 'y + h * k * (effluxed - y)' }], series: [{ label: 'Ki', range: [0, 200], expr: 'Ki0 - 0.5 * effluxed', format: { digits: 1, unit: ' mM' } }], warmup: false };
  const s = new KineticSimulation(model); s.setInputs({ effluxed: 6 }); s.update(1);
  assert.equal(s.readout()[0].text, '137.0 mM'); assert.ok(s.state.y > 1); assert.throws(() => s.setControl('k', 11), /之间/); s.setControl('k', 5);
  const saved = JSON.parse(JSON.stringify(s.save())), t = new KineticSimulation(model); t.restore(saved);
  assert.deepEqual([t.state, t.ctrl.k, t.t], [s.state, 5, 1]); t.restore({ state: { nope: 1, y: 'x' }, controls: { gone: 1 } }); assert.deepEqual(t.state, s.state);
  const boom = new KineticSimulation({ version: 1, state: { y: 1 }, step: [{ set: 'y', expr: 'y * 0 / 0' }], series: [{ label: 'y', range: [0, 1], expr: 'y' }], warmup: false });
  boom.update(0.1); assert.equal(boom.diverged, true); assert.equal(boom.state.y, 1, 'the last finite state is kept'); boom.update(1); assert.equal(boom.t, 0, 'stopped: the clock does not move');
});

test('pH colours match the stops at the stops and blend between them', () => {
  assert.equal(phColour(4), '#e8503a'); assert.equal(phColour(5), '#e8503a'); assert.equal(phColour(8.6), '#5a7fe0'); assert.equal(phColour(10), '#5a7fe0');
  assert.notEqual(phColour(6.2), phColour(6.3)); assert.match(phColour(7.2), /^#[0-9a-f]{6}$/);
});
