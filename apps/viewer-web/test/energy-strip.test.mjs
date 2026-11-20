import assert from 'node:assert/strict';
import test from 'node:test';

// A minimal document: just enough element behaviour for the strip (children, text, attributes, classes, click handlers).
class El {
  constructor(tag) { this.tag = tag; this.children = []; this.attrs = {}; this.handlers = {}; this.hidden = false; this.textContent = ''; this.className = ''; this.classes = new Set(); this.classList = { toggle: (c, on) => (on ? this.classes.add(c) : this.classes.delete(c)) }; }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  removeAttribute(k) { delete this.attrs[k]; }
  getAttribute(k) { return this.attrs[k] ?? null; }
  addEventListener(type, fn) { this.handlers[type] = fn; }
  click() { this.handlers.click?.(); }
  get lastChild() { return this.children.at(-1); }
  find(pred, out = []) { if (pred(this)) out.push(this); for (const c of this.children) c.find?.(pred, out); return out; }
}
globalThis.document = { createElement: (tag) => new El(tag) };
const { createEnergyStrip } = await import('../energy-strip.mjs');

const energy = { steps: [{ label: '甲', text: '第一步讲解', select: 'entity "甲"' }, { label: '乙', text: '第二步讲解' }, { label: '丙', text: '第三步讲解', select: 'entity "BAD' }], stage: { mode: 'cycle', period: 9 } };
function setup() {
  const log = { selected: [], cleared: 0, reported: [] }; let selection;
  const root = new El('nav'), context = {
    select: (e) => { if (e.includes('BAD')) throw new Error('语法'); log.selected.push(e); selection = { expression: e }; }, clear: () => { log.cleared++; selection = undefined; },
    selection: () => selection, report: (m) => log.reported.push(m),
  };
  const strip = createEnergyStrip({ root, context });
  return { strip, root, log, setSelection: (s) => { selection = s; }, buttons: () => root.find((e) => e.tag === 'button' && !e.className.includes('follow')), follow: () => root.find((e) => e.className === 'energy-follow')[0], detail: () => root.find((e) => e.className === 'energy-detail')[0] };
}

test('no declaration: the strip is hidden; a declaration shows one button per step', () => {
  const t = setup(); t.strip.load(null); assert.equal(t.root.hidden, true);
  t.strip.load(energy); assert.equal(t.root.hidden, false); assert.deepEqual(t.buttons().map((b) => b.textContent), ['甲', '乙', '丙']);
  t.strip.setAvailable(false); assert.equal(t.root.hidden, true); t.strip.setAvailable(true); assert.equal(t.root.hidden, false);
  t.strip.reset(); assert.equal(t.root.hidden, true);
});

test('the animation clock lights the steps in turn', () => {
  const t = setup(); t.strip.load(energy);
  for (const [time, expected] of [[0, 0], [2.9, 0], [3, 1], [6, 2], [9, 0]]) { t.strip.update(time); assert.equal(t.strip.litIndex, expected); assert.equal(t.buttons()[expected].classes.has('lit'), true); }
});

test('a click shows the explanation as text and marks the step\'s structures; a second click closes it; a bad expression is reported, not thrown', () => {
  const t = setup(); t.strip.load(energy);
  t.buttons()[0].click(); assert.equal(t.detail().hidden, false); assert.match(t.detail().textContent, /甲：第一步讲解/); assert.deepEqual(t.log.selected, ['entity "甲"']);
  t.buttons()[0].click(); assert.equal(t.detail().hidden, true); assert.equal(t.log.cleared, 1);
  t.buttons()[1].click(); assert.match(t.detail().textContent, /第二步讲解/); assert.equal(t.log.selected.length, 1);          // no expression: nothing marked
  t.buttons()[2].click(); assert.match(t.log.reported[0], /第 3 步“丙”的高亮表达式有误：语法/);
});

test('"跟随" marks the lit step\'s structures, but never replaces a pick of the reader\'s own', () => {
  const t = setup(); t.strip.load(energy);
  t.strip.update(0); assert.deepEqual(t.log.selected, []);                                       // off by default
  t.follow().click(); assert.deepEqual(t.log.selected, ['entity "甲"']);                          // switching on marks the lit step at once
  t.strip.update(3); assert.equal(t.log.selected.length, 1);                                      // step 乙 has nothing to mark
  t.strip.update(0); t.strip.update(3); t.strip.update(0.1);
  t.setSelection({ expression: 'chain Z' });                                                      // the reader selects something themselves
  const before = t.log.selected.length; t.strip.update(9); t.strip.update(12); assert.equal(t.log.selected.length, before);
  t.follow().click(); assert.equal(t.follow().getAttribute('aria-pressed'), 'false');
});

test('a work without structure expressions offers no "跟随" button', () => {
  const t = setup(); t.strip.load({ steps: [{ label: '甲', text: 'x' }], stage: { mode: 'cycle', period: 4 } }); assert.equal(t.follow(), undefined);
  t.strip.load({ steps: [{ label: '甲', text: 'x', select: 'all' }], stage: { mode: 'manual' } }); assert.equal(t.follow(), undefined);   // manual: nothing to follow
});
