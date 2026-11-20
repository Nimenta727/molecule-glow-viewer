import { DataAnimation } from '../../plugins/simulation/data-animation.mjs';
import { orientedFrame } from '../../plugins/simulation/structure-frame.mjs';
import { seededRng } from '../../plugins/motion/particles.mjs';
import { selectionSpace } from '../../plugins/structure/selection.mjs';
import { PRESENTATION_METERS_PER_ANGSTROM } from '../../plugins/structure/representation.mjs';
import { displayCenter } from '../../plugins/motion/state-pair.mjs';
import { Replay, STEP, REPLAY_LIMITS } from '../../plugins/simulation/replay.mjs';

/**
 * The data animation in the Viewer (classic: the `animation` of a scene, run by PROCESSES.dataAnim). The tool entry of the work holds the declaration; this
 * file builds the structure frame from the loaded model (axis vertical, see plugins/simulation/structure-frame.mjs), runs the engine on a fixed step,
 * draws pools, molecules on a journey, streams and event tags through the viewport, and keeps the counters and the event list. The work's tool
 * entry holds the configuration; the animation starts from its seed and, with a Replay (plugins/simulation/replay.mjs), can be rewound and changed by hand: the interventions
 * and the step it was at are saved in the entry's `state`, and a plain run saves nothing.
 */
const POOL = 'data-pool', MOVING = 'data-moving', STREAM = 'data-stream';

export function createDataAnimation({ viewport, elements, context, strip = null }) {
  let replay = null, frame = null, config = null, runFrame = null, last = 0, carry = 0, available = true, lastKey = '', syncers = [], savedState = null;
  const engineOf = () => replay?.engine ?? null;

  const show = (text) => { elements.info.textContent = text; };

  function build() {
    const model = context.model();
    if (!model || !config) return null;
    const restore = savedState; savedState = null;
    const space = selectionSpace(model);
    frame = orientedFrame({
      residues: space.residues.map((r) => ({ position: r.position, entity: r.entity, authSeq: r.authSeq, insertion: r.insertion, labelSeq: r.labelSeq, chain: r.chain, labelAsym: r.labelAsym })),
      ligands: space.ligands, config: { axis: config.axis, axisFit: config.axisFit, up: config.up, down: config.down, membranes: config.membranes }, animation: config.animation,
    });
    const make = (host) => new DataAnimation(structuredClone(config.animation), frame.structure, { rng: seededRng(config.seed), pace: () => host.pace, scale: () => host.scale, kinetics: config.kinetics ?? null });
    // the settings at the start are fixed (pace 1, the work's scale), so a replay from the log always starts from the same place
    replay = new Replay({ make, initial: { pace: 1, scale: config.scale === 'fast' ? 'fast' : 'slow' }, log: restore?.interventions ?? [] });
    if (restore && Number.isInteger(restore.step)) replay.seek(restore.step);
    replay.furthest = Math.max(replay.furthest, replay.step, ...replay.log.map((e) => e.step));
    carry = 0; lastKey = '';
    return replay.engine;
  }

  function draw() {
    const clear = () => { viewport.setParticleCloud(POOL, []); viewport.setParticleCloud(MOVING, []); viewport.setParticleCloud(STREAM, []); viewport.setEventTags([]); };
    if (!available || !engineOf() || !context.model()) { clear(); return; }
    const centre = displayCenter(context.model()), k = PRESENTATION_METERS_PER_ANGSTROM, { items, tags } = engineOf().frame();
    const convert = (item) => ({ position: frame.toNative(item.position).map((v, i) => (v - centre[i]) * k), radius: item.radius * k, color: item.color, alpha: item.alpha, label: item.label, name: item.name });
    viewport.setParticleCloud(POOL, items.filter((i) => i.kind === 'pool').map(convert));
    viewport.setParticleCloud(MOVING, items.filter((i) => i.kind === 'moving').map(convert), { overlay: true });
    viewport.setParticleCloud(STREAM, items.filter((i) => i.kind === 'stream').map(convert), { overlay: true });
    viewport.setEventTags(tags.map((t) => ({ text: t.text, age: t.age, dur: t.dur, position: frame.toNative(t.position).map((v, i) => (v - centre[i]) * k) })));
  }

  // The compartment model (concentrations, pH, membrane potential): switches and sliders, read-outs with their curves, the pH of each compartment, a note.
  function buildKineticControls() {
    const box = elements.kinetics; box.replaceChildren(); box.hidden = !engineOf()?.kinetics; syncers = [];
    if (!engineOf()?.kinetics) return;
    const k = engineOf().kinetics, add = (tag, props = {}) => Object.assign(document.createElement(tag), props), rows = document.createElement('div');
    for (const c of k.model.controls) {
      const label = document.createElement('label'); label.className = 'take-apart-row'; label.title = c.tip;
      const input = document.createElement('input');
      if (c.type === 'range') {
        Object.assign(input, { type: 'range', min: c.min, max: c.max, step: c.step, value: k.ctrl[c.id] });
        const out = document.createElement('output'); out.textContent = `${k.ctrl[c.id]}${c.unit ? ' ' + c.unit : ''}`;
        input.addEventListener('input', () => { out.textContent = `${input.value}${c.unit ? ' ' + c.unit : ''}`; });   // the change is made (and logged) when the slider is let go
        input.addEventListener('change', () => intervene({ kind: 'control', id: c.id, value: Number(input.value) }));
        syncers.push(() => { const v = engineOf().kinetics.ctrl[c.id]; if (Number(input.value) !== v) input.value = v; out.textContent = `${v}${c.unit ? ' ' + c.unit : ''}`; });
        label.append(`${c.label} `, input, ' ', out);
      } else {
        Object.assign(input, { type: 'checkbox', checked: k.ctrl[c.id] });
        input.addEventListener('change', () => intervene({ kind: 'control', id: c.id, value: input.checked }));
        syncers.push(() => { input.checked = Boolean(engineOf().kinetics.ctrl[c.id]); });
        label.append(input, ` ${c.label}`);
      }
      rows.append(label);
    }
    box.append(rows, add('ul', { className: 'particle-list', id: 'kinetic-readout' }), add('ul', { className: 'particle-list', id: 'kinetic-compartments' }), add('p', { className: 'structure-summary', id: 'kinetic-note' }));
  }
  function drawKinetics() {
    const k = engineOf()?.kinetics; if (!k) return;
    const read = document.getElementById('kinetic-readout'), comps = document.getElementById('kinetic-compartments'), note = document.getElementById('kinetic-note');
    if (!read) return;
    read.replaceChildren(...k.readout().map((r, i) => {
      const li = document.createElement('li'), name = document.createElement('span'), canvas = document.createElement('canvas');
      name.textContent = `${r.label}：${r.text}`; canvas.width = 120; canvas.height = 24; canvas.setAttribute('role', 'img'); canvas.setAttribute('aria-label', `${r.label}的变化曲线`);
      const g = canvas.getContext('2d'), H = k.hist[i], [lo, hi] = r.range; g.strokeStyle = r.color; g.lineWidth = 1.6; g.beginPath();
      H.forEach((v, n) => { const x = canvas.width - (H.length - 1 - n) * (canvas.width / 239), y = canvas.height - 2 - (Math.min(hi, Math.max(lo, v)) - lo) / (hi - lo) * (canvas.height - 4); n ? g.lineTo(x, y) : g.moveTo(x, y); });
      g.stroke(); li.append(name, canvas); return li;
    }));
    comps.replaceChildren(...k.compartments().map((c) => { const li = document.createElement('li'), chip = document.createElement('i'); chip.style.cssText = `display:inline-block;width:0.8em;height:0.8em;border-radius:50%;background:${c.colour};margin-right:0.4em`; li.append(chip, `${c.name}　pH ${c.pH.toFixed(2)}`); return li; }));
    note.textContent = k.diverged ? '区室动力学的数值发散，已停止（请调整参数后“从头开始”）。' : k.explain();
  }
  const SIGNS = { control: (e, k) => { const c = k?.model.controls.find((x) => x.id === e.id); return `${c?.label ?? e.id} → ${typeof e.value === 'boolean' ? (e.value ? '开' : '关') : e.value}`; }, pace: (e) => `快慢 → ${e.value}×`, scale: (e) => `时间尺度 → ${e.value === 'fast' ? '快：粒子流' : '慢：逐个分子'}` };
  function syncControls() { for (const sync of syncers) sync(); if (replay) { elements.pace.value = replay.host.pace; elements.scale.value = replay.host.scale; } }
  function drawTimeline() {
    if (!replay || !elements.seek) return;
    const top = Math.max(replay.furthest, replay.step);
    elements.seek.max = String(top); elements.seek.value = String(replay.step);
    elements.time.textContent = `${replay.time.toFixed(1)} / ${(top * STEP).toFixed(1)} s`;
    elements.back.disabled = replay.step === 0; elements.forward.disabled = replay.step >= top;
    elements.interventions.replaceChildren(...replay.log.map((e) => { const li = document.createElement('li'); li.textContent = `${(e.step * STEP).toFixed(1)} s　${SIGNS[e.kind](e, engineOf()?.kinetics)}`; return li; }));
  }
  function describe() {
    drawKinetics(); syncControls(); drawTimeline();
    if (!engineOf()) { show('此作品没有数据动画。'); return; }
    const s = engineOf().summary(), counters = Object.entries(s.counters), key = JSON.stringify([counters, s.events.length, s.warnings.length, s.violations.length, replay.log.length, replay.step, replay.warnings.length]);
    if (key === lastKey) return;
    lastKey = key;
    elements.counters.replaceChildren(...counters.map(([name, n]) => { const li = document.createElement('li'); li.textContent = `${name}：${n}`; return li; }));
    elements.events.replaceChildren(...s.events.slice(-8).reverse().map((e) => { const li = document.createElement('li'); li.textContent = `${e.t.toFixed(1)} s　${e.text}`; return li; }));
    const notes = [...s.warnings, ...s.violations.map((v) => `${v.reaction} 不守恒（${v.quantity}：${v.before} → ${v.after}）`), ...replay.warnings];
    show(`${frame.flipped ? '已按声明把结构翻转使“上”朝上；' : ''}粒子只是画面上的示意，不改变作品里的坐标。${replay.step < replay.furthest ? ' 现在在过去的某一刻：改动开关会结束原来的未来。' : ''}${notes.length ? ' ' + notes.join('；') : ''}`);
  }
  const refresh = () => { lastKey = ''; draw(); describe(); strip?.update(replay.time, engineOf()?.stage); };

  /** Change a switch, slider, the pace or the time scale at the current moment: it is applied now and logged, so a replay makes the same change at the same step. */
  function intervene(change) {
    if (!replay) return;
    try {
      const { dropped } = replay.intervene(change);
      refresh();
      if (dropped) show(`在 ${replay.time.toFixed(1)} s 处改动：之后的 ${dropped} 条干预记录已作废（原来的未来结束）。`);
    } catch (error) { syncControls(); show(error.message); }
  }
  /** Rewind or fast-forward to a time (seconds): the animation is run again from its seed and the logged interventions, so the same moment comes back exactly. */
  function seek(seconds) {
    if (!replay) return;
    replay.seek(Math.round(seconds / STEP));
    if (replay.step === 0) strip?.update(0, null);
    refresh();
  }

  const tick = (now) => {
    if (!available || !engineOf() || !elements.play.checked) { runFrame = null; last = 0; return; }
    carry += Math.min(0.25, last ? (now - last) / 1000 : 0.016); last = now;
    let n = 0;   // fixed 1/30 s steps, at most 4 a frame; the logged interventions are applied exactly at their steps
    while (carry >= STEP && n < 4 && replay.step < REPLAY_LIMITS.steps) { replay.advance(1); carry -= STEP; n++; }
    if (carry > STEP) carry = STEP;
    if (n) { draw(); describe(); strip?.update(replay.time, engineOf()?.stage); }
    runFrame = requestAnimationFrame(tick);
  };
  function start() { if (runFrame == null) { last = 0; runFrame = requestAnimationFrame(tick); } }
  function stop() { if (runFrame != null) cancelAnimationFrame(runFrame); runFrame = null; last = 0; }

  function rebuild() { stop(); replay?.dispose(); replay = null; try { build(); } catch (error) { replay = null; show(`无法运行数据动画：${error.message}`); } buildKineticControls(); draw(); describe(); strip?.load(replay ? config.energy : null); strip?.update(replay?.time ?? 0, engineOf()?.stage); if (replay && elements.play.checked) start(); }

  elements.play.addEventListener('change', () => { if (elements.play.checked) { if (!replay) rebuild(); else start(); } });
  elements.reset.addEventListener('click', () => rebuild());
  elements.scale.addEventListener('change', () => intervene({ kind: 'scale', value: elements.scale.value }));
  elements.pace.addEventListener('change', () => intervene({ kind: 'pace', value: Number(elements.pace.value) }));
  elements.seek?.addEventListener('input', () => { elements.time.textContent = `${Number(elements.seek.value * STEP).toFixed(1)} s`; });
  elements.seek?.addEventListener('change', () => seek(Number(elements.seek.value) * STEP));
  elements.back?.addEventListener('click', () => seek(Math.max(0, replay.time - 5)));
  elements.forward?.addEventListener('click', () => seek(Math.min(replay.furthest * STEP, replay.time + 5)));

  return {
    /** The work's tool configuration (after the structure model is ready): start the animation from its seed. `state` is what the work saved: its interventions and where it was. */
    load(next, state = null) { config = next; savedState = state && typeof state === 'object' ? state : null; elements.scale.value = next.scale === 'fast' ? 'fast' : 'slow'; elements.pace.value = 1; elements.play.checked = true; rebuild(); },
    /** After the viewport was rebuilt: draw again. */
    reapply() { if (replay) draw(); },
    setAvailable(on) { if (available === on) return; available = on; strip?.setAvailable(on); if (!on) stop(); else if (replay && elements.play.checked) start(); draw(); },
    reset() { stop(); replay?.dispose(); replay = null; frame = null; config = null; savedState = null; syncers = []; elements.play.checked = false; elements.kinetics.replaceChildren(); elements.kinetics.hidden = true; strip?.reset(); elements.counters.replaceChildren(); elements.events.replaceChildren(); elements.interventions?.replaceChildren(); show(''); draw(); },
    get active() { return Boolean(replay); },
    /** What a saved work keeps (only when the author or reader made interventions): the log and where the animation was; null otherwise. */
    save() { return replay?.log.length ? replay.save() : null; },
    /** For tests and the command API: the engine's current summary. */
    summary: () => engineOf()?.summary() ?? null,
    step: (n = 1) => { if (replay) { replay.advance(n); refresh(); } },
    seek, intervene,
  };
}
