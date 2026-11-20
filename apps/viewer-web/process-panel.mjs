import { createMarkovRun } from '../../plugins/simulation/markov-model.mjs';
import { readDisplay, sampleRun, toCSV } from '../../plugins/simulation/observer.mjs';
import { createPeptideStrip } from './peptide-strip.mjs';

/**
 * The stochastic process in the Viewer (tool org.glow.tool.stochastic-process): a seeded Markov chain run on a display clock, its parameters as sliders, the
 * display rows (counts, estimated current, open fraction, concentrations, potentials) as numbers with growing curves, the discrete state and the last events.
 * Changing a parameter while it runs adds a parameter change at the current time and replays the same seed, so the past stays exactly as it was. Nothing is
 * saved here: the work's tool entry holds the configuration and a run always starts again from its seed.
 */
const SAMPLE = 0.5, KEEP = 240;

export function createProcessPanel({ elements }) {
  let config = null, run = null, schedule = null, t = 0, frame = null, last = 0, available = true, history = [], lastDraw = 0;
  const sliders = new Map();   // parameter id -> { input, out, unit }
  const strip = createPeptideStrip(elements.strip);

  const show = (text) => { elements.info.textContent = text; };
  const model = () => run?.model;

  function build(entries) {
    schedule = entries.map((e) => ({ ...e }));
    run = createMarkovRun(config.process, config.seed, schedule);
  }

  /** Values of every display row at the sample times up to now (the past never changes for a seed, so only new samples are added). */
  function sampleHistory() {
    const target = Math.floor(t / SAMPLE) * SAMPLE;
    while ((history.at(-1)?.t ?? -SAMPLE) + SAMPLE <= target) { const at = (history.at(-1)?.t ?? -SAMPLE) + SAMPLE; history.push({ t: at, values: config.display.map((row) => readDisplay(run, row, at)) }); }
    if (history.length > KEEP) history.splice(0, history.length - KEEP);
  }

  function buildParams() {
    const box = elements.params; box.replaceChildren(); sliders.clear();
    if (!run) return;
    for (const p of model().parameters) {
      const label = document.createElement('label'); label.className = 'take-apart-row'; label.title = p.label;
      const input = document.createElement('input'), out = document.createElement('output');
      Object.assign(input, { type: 'range', min: p.min, max: p.max, step: p.step, value: run.at(t).parameters[p.id] }); input.dataset.param = p.id;
      out.textContent = `${input.value}${p.unit ? ' ' + p.unit : ''}`;
      const unit = p.unit ? ' ' + p.unit : ''; sliders.set(p.id, { input, out, unit });
      input.addEventListener('input', () => { out.textContent = `${input.value}${unit}`; });
      input.addEventListener('change', () => intervene(p.id, Number(input.value)));
      label.append(`${p.label} `, input, ' ', out); box.append(label);
    }
  }

  /** A parameter change now: keep the schedule up to this moment, add the new set at this time, replay the same seed. */
  function intervene(id, value) {
    const now = run.at(t).parameters, kept = schedule.filter((e) => e.time < t - 1e-9), next = { ...now, [id]: value, time: kept.length ? t : 0 };
    try { build([...kept, next]); } catch (error) { show(error.message); build(schedule); }
    history = history.filter((h) => h.t <= t);
    draw(true);
  }

  function draw(force = false) {
    if (!run) return;
    const now = performance.now();
    if (!force && now - lastDraw < 90) return;
    lastDraw = now;
    sampleHistory();
    const s = run.at(t), rows = config.display.map((row, i) => ({ row, value: readDisplay(run, row, t), series: history.map((h) => h.values[i]) }));
    elements.readout.replaceChildren(...rows.map(({ row, value, series }) => {
      const li = document.createElement('li'), name = document.createElement('span'), canvas = document.createElement('canvas');
      name.textContent = `${row.label}：${Number.isFinite(value) ? value.toFixed(row.digits) : '—'}${row.unit ? ' ' + row.unit : ''}`;
      canvas.width = 120; canvas.height = 24; canvas.setAttribute('role', 'img'); canvas.setAttribute('aria-label', `${row.label}的变化曲线`);
      const g = canvas.getContext('2d'), finite = series.filter(Number.isFinite), lo = Math.min(...finite, 0), hi = Math.max(...finite, lo + 1e-9);
      g.strokeStyle = '#4f8ff0'; g.lineWidth = 1.6; g.beginPath();
      series.forEach((v, n) => { const x = canvas.width - (series.length - 1 - n) * (canvas.width / (KEEP - 1)), y = canvas.height - 2 - ((Number.isFinite(v) ? v : lo) - lo) / (hi - lo) * (canvas.height - 4); n ? g.lineTo(x, y) : g.moveTo(x, y); });
      g.stroke(); li.append(name, canvas); return li;
    }));
    strip.draw(run, t, s);
    elements.state.textContent = `t = ${t.toFixed(1)} 示意秒　${Object.entries(s.vars).map(([k, v]) => `${k}：${v}`).join('　')}`;
    elements.events.replaceChildren(...s.events.slice(-8).reverse().map((e) => { const li = document.createElement('li'); li.textContent = `${e.time.toFixed(2)} s　${e.label}`; return li; }));
    for (const [id, { input, out, unit }] of sliders) if (document.activeElement !== input && Number(input.value) !== s.parameters[id]) { input.value = s.parameters[id]; out.textContent = `${s.parameters[id]}${unit}`; }
  }

  const tick = (now) => {
    if (!available || !run || !elements.play.checked) { frame = null; last = 0; return; }
    const dt = Math.min(0.25, last ? (now - last) / 1000 : 0.016);
    last = now; t += dt * Number(elements.speed.value);
    draw();
    frame = requestAnimationFrame(tick);
  };
  const start = () => { if (frame == null) { last = 0; frame = requestAnimationFrame(tick); } };
  const stop = () => { if (frame != null) cancelAnimationFrame(frame); frame = null; last = 0; };

  function restart() {
    stop(); t = 0; history = [];
    try { build(config.schedule); } catch (error) { run = null; show(`无法运行随机过程：${error.message}`); return; }
    elements.title.textContent = model().title || '随机状态过程';
    strip.build(config.strip); buildParams(); draw(true);
    show('这是随机过程：同一种子重放同一段历史；改滑块就是在此刻加一次参数变化。时间是示意秒。');
    if (elements.play.checked) start();
  }

  elements.play.addEventListener('change', () => { if (elements.play.checked) { if (!run && config) restart(); else start(); } });
  elements.reset.addEventListener('click', () => { if (config) restart(); });
  elements.speed.addEventListener('input', () => { elements.speedOut.textContent = elements.speed.value; });
  elements.jumpGo.addEventListener('click', () => {
    if (!run) return;
    const target = Number(elements.jump.value); if (!(target >= 0) || target > 3600) { show('跳到的时间要在 0 到 3600 示意秒之间。'); return; }
    elements.play.checked = false; stop(); t = target; history = []; draw(true);
  });
  elements.csv.addEventListener('click', () => {
    if (!run) return;
    const csv = toCSV(sampleRun(run, { from: 0, to: Math.max(t, 1), step: 1 })), link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); link.download = `process-seed${config.seed}.csv`; link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  });
  elements.speedOut.textContent = elements.speed.value;

  return {
    load(next) { config = next; elements.play.checked = true; restart(); },
    setAvailable(on) { if (available === on) return; available = on; if (!on) stop(); else if (run && elements.play.checked) start(); },
    reset() { stop(); strip.clear(); run = null; config = null; schedule = null; history = []; t = 0; elements.play.checked = false; elements.params.replaceChildren(); elements.readout.replaceChildren(); elements.events.replaceChildren(); elements.state.textContent = ''; show(''); },
    get active() { return Boolean(run); },
    /** For tests and the command API: the state now. */
    summary: () => (run ? { time: t, ...run.at(t) } : null),
  };
}
