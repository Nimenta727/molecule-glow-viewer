import { createComposition } from '../../plugins/simulation/composition.mjs';
import { compositionBuild } from '../../plugins/simulation/composition-tool.mjs';
import { readDisplay } from '../../plugins/simulation/observer.mjs';
import { createPeptideStrip } from './peptide-strip.mjs';

/**
 * Several stochastic processes side by side (tool org.glow.tool.multi-process; classic: the cell corner, a translation station and a channel station at once). Each
 * member has its own section (numbers with growing curves, its state, a peptide strip for a translation) and its own clock; the shared controls sit on top and change
 * only the members they point at. The runtime state (the scene time and the controls set so far) is what a saved work keeps, so reopening finds each station where it was.
 */
const SAMPLE = 0.5, KEEP = 240;

export function createCompositionPanel({ elements }) {
  let config = null, comp = null, t = 0, frame = null, last = 0, available = true, lastDraw = 0;
  const sections = new Map();   // member id -> { strip, readout, state, history: [{ t, values }] }
  const sliders = new Map();    // control id -> { input, out, unit }

  const show = (text) => { elements.info.textContent = text; };

  function build() {
    const b = compositionBuild(config);
    comp = createComposition({ members: b.members, controls: b.controls });
    sections.clear(); elements.members.replaceChildren();
    for (const m of b.members) {
      const box = document.createElement('section'), head = document.createElement('h4'), stripBox = document.createElement('div'), readout = document.createElement('ul'), state = document.createElement('p');
      box.className = 'station'; head.textContent = `${m.label}　（时钟 ×${m.timeScale}）`; stripBox.className = 'peptide-strip'; stripBox.setAttribute('role', 'img'); readout.className = 'particle-list'; readout.setAttribute('aria-label', `${m.label}的读数与曲线`); state.className = 'structure-summary';
      box.append(head, stripBox, readout, state); elements.members.append(box);
      const strip = createPeptideStrip(stripBox); strip.build(m.strip);
      sections.set(m.id, { strip, readout, state, display: m.display, history: [] });
    }
    elements.controls.replaceChildren(); sliders.clear();
    for (const c of comp.controls) {
      const label = document.createElement('label'), input = document.createElement('input'), out = document.createElement('output'), unit = c.unit ? ' ' + c.unit : '';
      label.className = 'take-apart-row'; label.title = c.label;
      Object.assign(input, { type: 'range', min: c.min, max: c.max, step: c.step, value: c.default }); input.dataset.control = c.id; out.textContent = `${c.default}${unit}`;
      input.addEventListener('input', () => { out.textContent = `${input.value}${unit}`; });
      input.addEventListener('change', () => change(c.id, Number(input.value)));
      sliders.set(c.id, { input, out, unit }); label.append(`${c.label} `, input, ' ', out); elements.controls.append(label);
    }
  }

  function change(id, value) {
    try { comp.set(id, value, t); } catch (error) { show(error.message); return; }
    for (const s of sections.values()) s.history = s.history.filter((h) => h.t <= t);   // the past of every member is unchanged
    draw(true);
  }

  function draw(force = false) {
    if (!comp) return;
    const now = performance.now();
    if (!force && now - lastDraw < 90) return;
    lastDraw = now;
    const s = comp.at(t);
    for (const [id, section] of sections) {
      const { run, timeScale } = comp.member(id), local = t * timeScale, history = section.history;
      const target = Math.floor(t / SAMPLE) * SAMPLE;
      while ((history.at(-1)?.t ?? -SAMPLE) + SAMPLE <= target) { const at = (history.at(-1)?.t ?? -SAMPLE) + SAMPLE; history.push({ t: at, values: section.display.map((row) => readDisplay(run, row, at * timeScale)) }); }
      if (history.length > KEEP) history.splice(0, history.length - KEEP);
      const state = s.members[id];
      section.readout.replaceChildren(...section.display.map((row, i) => {
        const value = readDisplay(run, row, local), series = history.map((h) => h.values[i]), li = document.createElement('li'), name = document.createElement('span'), canvas = document.createElement('canvas');
        name.textContent = `${row.label}：${Number.isFinite(value) ? value.toFixed(row.digits) : '—'}${row.unit ? ' ' + row.unit : ''}`; canvas.width = 120; canvas.height = 24; canvas.setAttribute('role', 'img'); canvas.setAttribute('aria-label', `${row.label}的变化曲线`);
        const g = canvas.getContext('2d'), finite = series.filter(Number.isFinite), lo = Math.min(...finite, 0), hi = Math.max(...finite, lo + 1e-9);
        g.strokeStyle = '#4f8ff0'; g.lineWidth = 1.6; g.beginPath();
        series.forEach((v, n) => { const x = canvas.width - (series.length - 1 - n) * (canvas.width / (KEEP - 1)), y = canvas.height - 2 - ((Number.isFinite(v) ? v : lo) - lo) / (hi - lo) * (canvas.height - 4); n ? g.lineTo(x, y) : g.moveTo(x, y); });
        g.stroke(); li.append(name, canvas); return li;
      }));
      section.state.textContent = `自己的时间 ${state.time.toFixed(1)} 秒　${Object.entries(state.vars).slice(0, 4).map(([k, v]) => `${k}：${v}`).join('　')}`;
      section.strip.draw(run, local, state);
    }
    for (const [id, { input, out, unit }] of sliders) if (document.activeElement !== input && Number(input.value) !== s.controls[id]) { input.value = s.controls[id]; out.textContent = `${s.controls[id]}${unit}`; }
    elements.time.textContent = `场景时间 ${t.toFixed(1)} 秒`;
  }

  const tick = (now) => {
    if (!available || !comp || !elements.play.checked) { frame = null; last = 0; return; }
    const dt = Math.min(0.25, last ? (now - last) / 1000 : 0.016);
    last = now; t += dt * Number(elements.speed.value); draw(); frame = requestAnimationFrame(tick);
  };
  const start = () => { if (frame == null) { last = 0; frame = requestAnimationFrame(tick); } };
  const stop = () => { if (frame != null) cancelAnimationFrame(frame); frame = null; last = 0; };

  function restart(saved) {
    stop(); t = 0;
    try { build(); } catch (error) { comp = null; show(`无法运行多过程组合：${error.message}`); return; }
    if (saved) { comp.restore(saved); if (Number.isFinite(saved.t) && saved.t >= 0) t = saved.t; }
    show('每个过程有自己的时钟和计数；共享控件只改它指向的过程，别的过程的历史不变。时间是示意秒。');
    draw(true);
    if (elements.play.checked) start();
  }

  elements.play.addEventListener('change', () => { if (elements.play.checked) { if (!comp && config) restart(); else start(); } });
  elements.reset.addEventListener('click', () => { if (config) restart(); });
  elements.speed.addEventListener('input', () => { elements.speedOut.textContent = elements.speed.value; });
  elements.jumpGo.addEventListener('click', () => {
    if (!comp) return;
    const target = Number(elements.jump.value); if (!(target >= 0) || target > 3600) { show('跳到的时间要在 0 到 3600 示意秒之间。'); return; }
    elements.play.checked = false; stop(); t = target; for (const s of sections.values()) s.history = []; draw(true);
  });
  elements.speedOut.textContent = elements.speed.value;

  return {
    /** `saved` = what `save()` gave earlier ({ t, interventions }): the stations come back where they were. */
    load(next, saved) { config = next; elements.play.checked = !saved; restart(saved); },
    setAvailable(on) { if (available === on) return; available = on; if (!on) stop(); else if (comp && elements.play.checked) start(); },
    reset() { stop(); for (const s of sections.values()) s.strip.clear(); sections.clear(); sliders.clear(); comp = null; config = null; t = 0; elements.play.checked = false; elements.members.replaceChildren(); elements.controls.replaceChildren(); elements.time.textContent = ''; show(''); },
    get active() { return Boolean(comp); },
    /** What a saved work keeps: the scene time and the controls set so far (every member is rebuilt exactly from them). */
    save: () => (comp ? { t, ...comp.save() } : null),
    summary: () => (comp ? comp.at(t) : null),
  };
}
