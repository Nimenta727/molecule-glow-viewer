import { Solution, normalizeSolutionSpec } from '../../plugins/motion/solution.mjs';
import { DataAnimation } from '../../plugins/simulation/data-animation.mjs';
import { orientedFrame } from '../../plugins/simulation/structure-frame.mjs';
import { seededRng } from '../../plugins/motion/particles.mjs';
import { evaluateSelection, selectionSpace } from '../../plugins/structure/selection.mjs';
import { PRESENTATION_METERS_PER_ANGSTROM } from '../../plugins/structure/representation.mjs';
import { displayCenter } from '../../plugins/motion/state-pair.mjs';
import { SOLUTION_TOOL } from '../../plugins/motion/solution-tool.mjs';
import { DATA_TOOL } from '../../plugins/simulation/data-tool.mjs';

/**
 * The particle preview of Studio: while an author configures the solution-particles tool or the data-animation tool, this runs the tool's own engine on the structure the work
 * holds and draws it in the studio viewport, so a pool, a flow or a reaction can be seen as it is edited. It changes nothing in the work (the Viewer is where the work is played and
 * saved); it draws at the structure's own place, so an object that was moved or rotated in Studio does not carry the particles along. The engines are the Viewer's
 * (plugins/motion/solution.mjs, plugins/simulation/data-animation.mjs); this file only supplies the structure and the clock.
 *   getScene() -> the scene   getModel() -> the parsed model of the primary structure (or undefined while it is not ready)   resolveToolId(id) -> the tool's current id   note(text)
 */
const CLOUDS = ['solution', 'solution-flow', 'data-pool', 'data-moving', 'data-stream'];

export function createParticlePreview({ viewport, getScene, getModel, resolveToolId = (id) => id, note = () => {}, schedule = (f) => requestAnimationFrame(f), cancel = (h) => cancelAnimationFrame(h) }) {
  let running = false, handle = null, last = 0, engine = null, key = '', model = null;

  const entryFor = (toolId) => getScene()?.tools?.find((entry) => (resolveToolId(entry.tool.id) ?? entry.tool.id) === toolId);
  const clear = () => { for (const tag of CLOUDS) viewport.setParticleCloud(tag, []); viewport.setEventTags?.([]); };
  /** Which tools of the scene can be previewed: ['solution-particles', 'data-animation'] (those present). */
  const available = () => [entryFor(SOLUTION_TOOL) && 'solution-particles', entryFor(DATA_TOOL) && 'data-animation'].filter(Boolean);

  function build() {
    model = getModel();
    if (!model) { note('结构还在解析，稍后会自动出现粒子。'); return null; }
    const space = selectionSpace(model), solution = entryFor(SOLUTION_TOOL), data = entryFor(DATA_TOOL), made = {};
    if (solution) {
      const s = new Solution({ points: space.residues.map((r) => r.position), resolveGroup: (expression) => evaluateSelection(expression, space).residues.map((r) => r.position) });
      s.setSpec(normalizeSolutionSpec(solution.config));
      made.solution = s;
    }
    if (data) {
      const config = data.config, frame = orientedFrame({
        residues: space.residues.map((r) => ({ position: r.position, entity: r.entity, authSeq: r.authSeq, insertion: r.insertion, labelSeq: r.labelSeq, chain: r.chain, labelAsym: r.labelAsym })),
        ligands: space.ligands, config: { axis: config.axis, axisFit: config.axisFit, up: config.up, down: config.down, membranes: config.membranes }, animation: config.animation });
      made.data = { frame, engine: new DataAnimation(structuredClone(config.animation), frame.structure, { rng: seededRng(config.seed), pace: () => 1, scale: () => config.scale ?? 'slow', kinetics: config.kinetics ?? null }) };
    }
    return made;
  }

  function draw() {
    if (!engine || !model) { clear(); return; }
    const centre = displayCenter(model), k = PRESENTATION_METERS_PER_ANGSTROM, toRoot = (p) => p.map((v, i) => (v - centre[i]) * k);
    const convert = (map) => (item) => ({ position: toRoot(map(item.position)), radius: item.radius * k, color: item.color, alpha: item.alpha, label: item.label, name: item.name });
    if (engine.solution) {
      const items = engine.solution.frame(), same = convert((p) => p);
      viewport.setParticleCloud('solution', items.filter((i) => i.kind === 'pool').map(same));
      viewport.setParticleCloud('solution-flow', items.filter((i) => i.kind === 'flow').map(same), { overlay: true });
    }
    if (engine.data) {
      const { items, tags } = engine.data.engine.frame(), native = convert((p) => engine.data.frame.toNative(p));
      viewport.setParticleCloud('data-pool', items.filter((i) => i.kind === 'pool').map(native));
      viewport.setParticleCloud('data-moving', items.filter((i) => i.kind === 'moving').map(native), { overlay: true });
      viewport.setParticleCloud('data-stream', items.filter((i) => i.kind === 'stream').map(native), { overlay: true });
      viewport.setEventTags?.(tags.map((t) => ({ text: t.text, age: t.age, dur: t.dur, position: toRoot(engine.data.frame.toNative(t.position)) })));
    }
  }

  /** One step of the clock (the animation frame calls it; tests call it directly). Returns whether anything moved. */
  function advance(dt) {
    if (!engine) return false;
    const moved = [engine.solution?.advance(dt), engine.data?.engine.advance(dt)].some(Boolean);
    if (moved) draw();
    return moved;
  }
  const tick = (now) => {
    if (!running) { handle = null; return; }
    advance(Math.min(0.25, last ? (now - last) / 1000 : 0.016)); last = now;
    handle = schedule(tick);
  };

  function sync() {
    const configs = JSON.stringify([entryFor(SOLUTION_TOOL)?.config, entryFor(DATA_TOOL)?.config]);
    if (!running) return;
    if (!available().length) { stop(); note('这个作品里没有粒子或数据动画工具。'); return; }
    if (engine && configs === key && model === getModel()) { draw(); return; }   // after the viewport was rebuilt: draw again
    try {
      const made = build();
      if (!made) return;
      engine = made; key = configs; last = 0; note(`预览：${available().map((id) => ({ 'solution-particles': '溶液粒子', 'data-animation': '数据动画' }[id])).join('、')}。只是预览，不改作品；对象被移动后粒子不会跟着走。`);
      draw();
    } catch (error) { engine = null; clear(); note(`预览失败：${error.message}`); }
  }
  function start() { running = true; engine = null; sync(); if (handle == null) { last = 0; handle = schedule(tick); } }
  function stop() { running = false; if (handle != null) cancel(handle); handle = null; engine = null; key = ''; clear(); note(''); }

  return { start, stop, sync, advance, available, get running() { return running; } };
}
