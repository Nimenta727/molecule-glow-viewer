import { litStep } from '../../plugins/simulation/energy-strip.mjs';

/**
 * The energy-conversion strip in the Viewer (classic: the strip at the top of the classic viewer): the steps of the work's `energy` declaration as a row, one lit with the
 * animation, a click on a step shows its explanation and marks the structures it involves, and "跟随" marks them automatically as the lit step changes. The declaration
 * is the work's (plugins/simulation/energy-strip.mjs); text is only ever set as text. `context` supplies what the strip cannot know: select(expression) / clear() for the
 * structure selection, selection() for the current selection object (a reader's own pick is not overridden by "跟随"), and report(message) for a syntax error in a step's expression.
 */
export function createEnergyStrip({ root, context }) {
  let energy = null, buttons = [], detail = null, follow = null, lit = -1, opened = -1, available = true, ownSelection;

  const mark = (i, { auto = false } = {}) => {
    const step = energy.steps[i];
    if (!step?.select) { if (!auto) context.clear(); return; }
    try { context.select(step.select); ownSelection = context.selection(); } catch (error) { context.report(`第 ${i + 1} 步“${step.label}”的高亮表达式有误：${error.message}`); }
  };
  const showLit = (i) => { buttons.forEach((b, n) => { b.classList.toggle('lit', n === i); if (n === i) b.setAttribute('aria-current', 'step'); else b.removeAttribute('aria-current'); }); };
  const open = (i) => {
    opened = opened === i ? -1 : i;
    buttons.forEach((b, n) => b.setAttribute('aria-expanded', String(n === opened)));
    detail.hidden = opened < 0;
    if (opened >= 0) { detail.textContent = `${energy.steps[opened].label}：${energy.steps[opened].text}${energy.steps[opened].select ? '（高亮 = 这一步涉及的结构）' : ''}`; mark(opened); }
    else { context.clear(); ownSelection = undefined; }
  };

  function render() {
    root.replaceChildren();
    if (!energy || !available) { root.hidden = true; return; }
    const title = document.createElement('b'); title.textContent = '能量转化';
    const row = document.createElement('ol'); row.className = 'energy-steps';
    buttons = energy.steps.map((step, i) => {
      const li = document.createElement('li'), button = document.createElement('button');
      button.type = 'button'; button.textContent = step.label; button.setAttribute('aria-expanded', 'false'); button.addEventListener('click', () => open(i));
      li.append(button); row.append(li); return button;
    });
    follow = null;
    if (energy.steps.some((s) => s.select) && energy.stage.mode === 'cycle') {
      follow = document.createElement('button'); follow.type = 'button'; follow.className = 'energy-follow'; follow.textContent = '◎ 跟随'; follow.setAttribute('aria-pressed', 'false');
      follow.title = '播放时自动标出当前步骤涉及的结构（点一下标记，再点一下取消）';
      follow.addEventListener('click', () => { const on = follow.getAttribute('aria-pressed') !== 'true'; follow.setAttribute('aria-pressed', String(on)); if (!on) { context.clear(); ownSelection = undefined; } else if (lit >= 0) mark(lit, { auto: true }); });
      row.append(Object.assign(document.createElement('li'), {}));
      row.lastChild.append(follow);
    }
    detail = document.createElement('p'); detail.className = 'energy-detail'; detail.hidden = true; detail.setAttribute('aria-live', 'polite');
    root.append(title, row, detail); root.hidden = false;
    if (lit >= 0) showLit(lit);
  }

  return {
    /** The declaration of the work's tool entry (already validated); null/undefined hides the strip. */
    load(next) { energy = next ?? null; lit = -1; opened = -1; ownSelection = undefined; render(); },
    /** The animation clock in seconds: lights the step that is due. */
    update(time) {
      if (!energy || !available) return;
      const next = litStep(energy, time);
      if (next === lit) return;
      lit = next; showLit(lit);
      if (lit >= 0 && follow?.getAttribute('aria-pressed') === 'true') {
        const current = context.selection();
        if (!current || current === ownSelection) mark(lit, { auto: true });   // a pick of the reader's own stays
      }
    },
    setAvailable(on) { available = on; render(); },
    reset() { energy = null; lit = -1; opened = -1; ownSelection = undefined; render(); },
    get litIndex() { return lit; },
  };
}
