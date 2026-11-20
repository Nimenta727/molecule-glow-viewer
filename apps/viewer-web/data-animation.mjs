import { DataAnimation } from '../../plugins/simulation/data-animation.mjs';
import { orientedFrame } from '../../plugins/simulation/structure-frame.mjs';
import { seededRng } from '../../plugins/motion/particles.mjs';
import { selectionSpace } from '../../plugins/structure/selection.mjs';
import { PRESENTATION_METERS_PER_ANGSTROM } from '../../plugins/structure/representation.mjs';
import { displayCenter } from '../../plugins/motion/state-pair.mjs';

/**
 * The data animation in the Viewer (classic: the `animation` of a scene, run by PROCESSES.dataAnim). The tool entry of the work holds the declaration; this
 * file builds the structure frame from the loaded model (axis vertical, see plugins/simulation/structure-frame.mjs), runs the engine on a fixed step,
 * draws pools, molecules on a journey, streams and event tags through the viewport, and keeps the counters and the event list. Nothing here is saved: the
 * work's tool entry is the single place for the configuration, and the animation always starts again from its seed.
 */
const POOL = 'data-pool', MOVING = 'data-moving', STREAM = 'data-stream';

export function createDataAnimation({ viewport, elements, context, strip = null }) {
  let engine = null, frame = null, config = null, runFrame = null, last = 0, available = true, lastKey = '';

  const show = (text) => { elements.info.textContent = text; };

  function build() {
    const model = context.model();
    if (!model || !config) return null;
    const space = selectionSpace(model);
    frame = orientedFrame({
      residues: space.residues.map((r) => ({ position: r.position, entity: r.entity, authSeq: r.authSeq, insertion: r.insertion, labelSeq: r.labelSeq, chain: r.chain, labelAsym: r.labelAsym })),
      ligands: space.ligands, config: { axis: config.axis, axisFit: config.axisFit, up: config.up, down: config.down, membranes: config.membranes }, animation: config.animation,
    });
    engine = new DataAnimation(structuredClone(config.animation), frame.structure, {
      rng: seededRng(config.seed), pace: () => Number(elements.pace.value) || 1, scale: () => elements.scale.value, kinetics: config.kinetics ?? null,
    });
    lastKey = '';
    return engine;
  }

  function draw() {
    const clear = () => { viewport.setParticleCloud(POOL, []); viewport.setParticleCloud(MOVING, []); viewport.setParticleCloud(STREAM, []); viewport.setEventTags([]); };
    if (!available || !engine || !context.model()) { clear(); return; }
    const centre = displayCenter(context.model()), k = PRESENTATION_METERS_PER_ANGSTROM, { items, tags } = engine.frame();
    const convert = (item) => ({ position: frame.toNative(item.position).map((v, i) => (v - centre[i]) * k), radius: item.radius * k, color: item.color, alpha: item.alpha, label: item.label, name: item.name });
    viewport.setParticleCloud(POOL, items.filter((i) => i.kind === 'pool').map(convert));
    viewport.setParticleCloud(MOVING, items.filter((i) => i.kind === 'moving').map(convert), { overlay: true });
    viewport.setParticleCloud(STREAM, items.filter((i) => i.kind === 'stream').map(convert), { overlay: true });
    viewport.setEventTags(tags.map((t) => ({ text: t.text, age: t.age, dur: t.dur, position: frame.toNative(t.position).map((v, i) => (v - centre[i]) * k) })));
  }

  // The compartment model (concentrations, pH, membrane potential): switches and sliders, read-outs with their curves, the pH of each compartment, a note.
  function buildKineticControls() {
    const box = elements.kinetics; box.replaceChildren(); box.hidden = !engine?.kinetics;
    if (!engine?.kinetics) return;
    const k = engine.kinetics, add = (tag, props = {}) => Object.assign(document.createElement(tag), props), rows = document.createElement('div');
    for (const c of k.model.controls) {
      const label = document.createElement('label'); label.className = 'take-apart-row'; label.title = c.tip;
      const input = document.createElement('input');
      if (c.type === 'range') {
        Object.assign(input, { type: 'range', min: c.min, max: c.max, step: c.step, value: k.ctrl[c.id] });
        const out = document.createElement('output'); out.textContent = `${k.ctrl[c.id]}${c.unit ? ' ' + c.unit : ''}`;
        input.addEventListener('input', () => { k.setControl(c.id, Number(input.value)); out.textContent = `${input.value}${c.unit ? ' ' + c.unit : ''}`; lastKey = ''; });
        label.append(`${c.label} `, input, ' ', out);
      } else {
        Object.assign(input, { type: 'checkbox', checked: k.ctrl[c.id] });
        input.addEventListener('change', () => { k.setControl(c.id, input.checked); lastKey = ''; });
        label.append(input, ` ${c.label}`);
      }
      rows.append(label);
    }
    box.append(rows, add('ul', { className: 'particle-list', id: 'kinetic-readout' }), add('ul', { className: 'particle-list', id: 'kinetic-compartments' }), add('p', { className: 'structure-summary', id: 'kinetic-note' }));
  }
  function drawKinetics() {
    const k = engine?.kinetics; if (!k) return;
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
  function describe() {
    drawKinetics();
    if (!engine) { show('此作品没有数据动画。'); return; }
    const s = engine.summary(), counters = Object.entries(s.counters), key = JSON.stringify([counters, s.events.length, s.warnings.length, s.violations.length]);
    if (key === lastKey) return;
    lastKey = key;
    elements.counters.replaceChildren(...counters.map(([name, n]) => { const li = document.createElement('li'); li.textContent = `${name}：${n}`; return li; }));
    elements.events.replaceChildren(...s.events.slice(-8).reverse().map((e) => { const li = document.createElement('li'); li.textContent = `${e.t.toFixed(1)} s　${e.text}`; return li; }));
    const notes = [...s.warnings, ...s.violations.map((v) => `${v.reaction} 不守恒（${v.quantity}：${v.before} → ${v.after}）`)];
    show(`${frame.flipped ? '已按声明把结构翻转使“上”朝上；' : ''}粒子只是画面上的示意，不改变作品里的坐标。${notes.length ? ' ' + notes.join('；') : ''}`);
  }

  const tick = (now) => {
    if (!available || !engine || !elements.play.checked) { runFrame = null; last = 0; return; }
    const dt = Math.min(0.25, last ? (now - last) / 1000 : 0.016);
    last = now;
    if (engine.advance(dt)) { draw(); describe(); strip?.update(engine.time); }
    runFrame = requestAnimationFrame(tick);
  };
  function start() { if (runFrame == null) { last = 0; runFrame = requestAnimationFrame(tick); } }
  function stop() { if (runFrame != null) cancelAnimationFrame(runFrame); runFrame = null; last = 0; }

  function rebuild() { stop(); engine?.dispose(); engine = null; try { build(); } catch (error) { engine = null; show(`无法运行数据动画：${error.message}`); } buildKineticControls(); draw(); describe(); strip?.load(engine ? config.energy : null); if (engine && elements.play.checked) start(); }

  elements.play.addEventListener('change', () => { if (elements.play.checked) { if (!engine) rebuild(); else start(); } });
  elements.reset.addEventListener('click', () => rebuild());
  elements.scale.addEventListener('change', () => { if (engine) { lastKey = ''; draw(); } });

  return {
    /** The work's tool configuration (after the structure model is ready): start the animation from its seed. */
    load(next) { config = next; elements.scale.value = next.scale === 'fast' ? 'fast' : 'slow'; elements.play.checked = true; rebuild(); },
    /** After the viewport was rebuilt: draw again. */
    reapply() { if (engine) draw(); },
    setAvailable(on) { if (available === on) return; available = on; strip?.setAvailable(on); if (!on) stop(); else if (engine && elements.play.checked) start(); draw(); },
    reset() { stop(); engine?.dispose(); engine = null; frame = null; config = null; elements.play.checked = false; elements.kinetics.replaceChildren(); elements.kinetics.hidden = true; strip?.reset(); elements.counters.replaceChildren(); elements.events.replaceChildren(); show(''); draw(); },
    get active() { return Boolean(engine); },
    /** For tests and the command API: the engine's current summary. */
    summary: () => engine?.summary() ?? null,
    step: (n = 1) => { if (engine) { engine.run(n); draw(); describe(); strip?.update(engine.time); } },
  };
}
