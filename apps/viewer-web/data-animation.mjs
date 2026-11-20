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

export function createDataAnimation({ viewport, elements, context }) {
  let engine = null, frame = null, config = null, runFrame = null, last = 0, available = true, lastKey = '';

  const show = (text) => { elements.info.textContent = text; };

  function build() {
    const model = context.model();
    if (!model || !config) return null;
    const space = selectionSpace(model);
    frame = orientedFrame({
      residues: space.residues.map((r) => ({ position: r.position, entity: r.entity, authSeq: r.authSeq, insertion: r.insertion, labelSeq: r.labelSeq, chain: r.chain, labelAsym: r.labelAsym })),
      ligands: space.ligands, config: { axis: config.axis, membranes: config.membranes }, animation: config.animation,
    });
    engine = new DataAnimation(structuredClone(config.animation), frame.structure, {
      rng: seededRng(config.seed), pace: () => Number(elements.pace.value) || 1, scale: () => elements.scale.value,
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

  function describe() {
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
    if (engine.advance(dt)) { draw(); describe(); }
    runFrame = requestAnimationFrame(tick);
  };
  function start() { if (runFrame == null) { last = 0; runFrame = requestAnimationFrame(tick); } }
  function stop() { if (runFrame != null) cancelAnimationFrame(runFrame); runFrame = null; last = 0; }

  function rebuild() { stop(); engine?.dispose(); engine = null; try { build(); } catch (error) { engine = null; show(`无法运行数据动画：${error.message}`); } draw(); describe(); if (engine && elements.play.checked) start(); }

  elements.play.addEventListener('change', () => { if (elements.play.checked) { if (!engine) rebuild(); else start(); } });
  elements.reset.addEventListener('click', () => rebuild());
  elements.scale.addEventListener('change', () => { if (engine) { lastKey = ''; draw(); } });

  return {
    /** The work's tool configuration (after the structure model is ready): start the animation from its seed. */
    load(next) { config = next; elements.scale.value = next.scale === 'fast' ? 'fast' : 'slow'; elements.play.checked = true; rebuild(); },
    /** After the viewport was rebuilt: draw again. */
    reapply() { if (engine) draw(); },
    setAvailable(on) { if (available === on) return; available = on; if (!on) stop(); else if (engine && elements.play.checked) start(); draw(); },
    reset() { stop(); engine?.dispose(); engine = null; frame = null; config = null; elements.play.checked = false; elements.counters.replaceChildren(); elements.events.replaceChildren(); show(''); draw(); },
    get active() { return Boolean(engine); },
    /** For tests and the command API: the engine's current summary. */
    summary: () => engine?.summary() ?? null,
    step: (n = 1) => { if (engine) { engine.run(n); draw(); describe(); } },
  };
}
