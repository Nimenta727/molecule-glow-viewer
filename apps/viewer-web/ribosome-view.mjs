import { ribosomeFrame, RibosomeMotion } from '../../plugins/simulation/ribosome-motion.mjs';
import { selectionSpace } from '../../plugins/structure/selection.mjs';
import { PRESENTATION_METERS_PER_ANGSTROM } from '../../plugins/structure/representation.mjs';
import { displayCenter } from '../../plugins/motion/state-pair.mjs';
import { kwMatch } from '../../plugins/simulation/structure-frame.mjs';

/**
 * The tRNAs and mRNA of a translating ribosome in the Viewer (classic: the moving tRNA and mRNA bodies of the translation process): the poses come from the structure's own E / P / A tRNAs
 * (plugins/simulation/ribosome-motion.mjs), the state from the translation process (its discrete state `st` and whether the E site is occupied), and every residue is drawn as a bead.
 * The static tRNA and mRNA parts of the structure are hidden while it runs and shown again when it stops. Needs a structure with an mRNA and three tRNAs (4V6F); with anything else it stays off.
 * Not drawn here (the classic's own bodies): the bent A/T tRNA, EF-Tu, EF-G, RF1, the antibiotics and the nascent chain.
 */
const CLOUD = 'ribosome-trna', BEAD = 3.4;

export function createRibosomeView({ viewport, context, process, speed = () => 0.02 }) {
  let motion = null, frameId = null, last = 0, hidden = [], running = false;

  const hexToRgb = (hex) => hex;
  function build() {
    const model = context.model();
    if (!model) return false;
    const space = selectionSpace(model);
    try { motion = new RibosomeMotion(ribosomeFrame(space.residues.map((r) => ({ p: r.position, part: r.entity, seq: r.labelSeq, asym: r.labelAsym }))), { speed: speed() }); } catch { motion = null; return false; }
    return true;
  }
  function hideStatic() {
    const ids = [];
    for (const [key, nodes] of context.parts()) { let name = ''; try { name = String(JSON.parse(key)[1] ?? ''); } catch { /* not a part key */ } if (kwMatch(name, '/trna|^mrna$/')) ids.push(...nodes.map(({ id }) => id)); }
    if (ids.length) { viewport.setNodeVisibility(ids, false); hidden = ids; }
  }
  function showStatic() { if (hidden.length) viewport.setNodeVisibility(hidden, true); hidden = []; }

  function draw() {
    const model = context.model();
    if (!motion || !model) { viewport.setParticleCloud(CLOUD, []); return; }
    const centre = displayCenter(model), k = PRESENTATION_METERS_PER_ANGSTROM, b = motion.bodies(), items = [];
    const place = (p) => p.map((v, i) => (v - centre[i]) * k);
    b.trna.forEach((t, n) => t.positions.forEach((p, i) => items.push({ position: place(p), radius: BEAD * k, color: t.colour, alpha: t.fade, name: 'tRNA', ...(i === t.positions.length - 1 && n < 3 ? { label: 'tRNA 受体端' } : {}) })));
    if (b.mrna.fade > 0.01) b.mrna.positions.forEach((p) => items.push({ position: place(p), radius: BEAD * 0.8 * k, color: '#e0a000', alpha: b.mrna.fade, name: 'mRNA' }));
    viewport.setParticleCloud(CLOUD, items, { overlay: false });
  }
  const tick = (now) => {
    if (!running) { frameId = null; return; }
    const dt = Math.min(0.25, last ? (now - last) / 1000 : 0.016); last = now;
    const s = process.summary();
    if (s && motion) { motion.speed = speed(); motion.sync({ st: s.vars?.st, E: s.vars?.E === 'on' }); motion.step(dt); draw(); }
    frameId = requestAnimationFrame(tick);
  };
  return {
    /** The translation process was loaded: build the poses from the structure and start following it. */
    start() { this.stop(); if (!build()) return false; hideStatic(); running = true; last = 0; frameId = requestAnimationFrame(tick); return true; },
    stop() { running = false; if (frameId != null) cancelAnimationFrame(frameId); frameId = null; showStatic(); viewport.setParticleCloud(CLOUD, []); motion = null; },
    /** After the viewport was rebuilt: hide the static parts again and draw. */
    reapply() { if (running && motion) { hideStatic(); draw(); } },
    get active() { return running; },
  };
}
