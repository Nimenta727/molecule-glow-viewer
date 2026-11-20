import { ECOLI, cellFrameAt, capsuleSurface } from '../../plugins/simulation/cell-geometry.mjs';
import { LEVELS, levelOf, scaleBar } from '../../plugins/simulation/scale-ladder.mjs';
import { kwMatch } from '../../plugins/simulation/structure-frame.mjs';
import { PRESENTATION_METERS_PER_ANGSTROM } from '../../plugins/structure/representation.mjs';
import { displayCenter } from '../../plugins/motion/state-pair.mjs';

/**
 * The whole cell around a ribosome (classic: the multiscale scene of src/sim/processes/whole-cell.js): a rod-shaped E. coli cell, 2 µm long, whose inner membrane passes 60 Å
 * above the top of the 70S ribosome (the "cell corner"), drawn as its inner and outer membranes (translucent capsules, to scale), with a scale bar and three viewpoints: the whole
 * cell, the corner (about 300 nm), the machine. The ribosome's own axis (from the 16S to the 23S RNA) is the membrane normal. The geometry is plugins/simulation/cell-geometry.mjs and
 * scale-ladder.mjs (equal to the classic). Not drawn here (still the classic's own code): the nucleoid, flagella, peptidoglycan, LPS, the crowd and the membrane proteins.
 */
const INNER = 'cell-inner-membrane', OUTER = 'cell-outer-membrane', MEMBRANE_ABOVE_RIBOSOME = 60, FOV = 45;
const unit = (v) => { const l = Math.hypot(...v) || 1; return v.map((x) => x / l); };
const sub = (a, b) => a.map((v, i) => v - b[i]), dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const mean = (list) => list.reduce((t, p) => t.map((v, i) => v + p[i] / list.length), [0, 0, 0]);

/** The cell around a ribosome, in the structure's own coordinates: { frame, H, Rom, top, ey, e1, e3, corner } or null when the 16S / 23S RNA is not there. */
export function cellAroundRibosome(residues, config = ECOLI) {
  const rna = (key) => residues.filter((r) => kwMatch(r.entity ?? '', key)).map((r) => r.position);
  const a = rna('16S'), b = rna('23S');
  if (a.length < 20 || b.length < 20) return null;
  const ey = unit(sub(mean(b), mean(a)));
  let e1 = cross(ey, [1, 0, 0]); if (Math.hypot(...e1) < 0.2) e1 = cross(ey, [0, 0, 1]); e1 = unit(e1);
  const e3 = cross(e1, ey), centre = mean(residues.map((r) => r.position));
  let top = -Infinity; for (const r of residues) top = Math.max(top, dot(r.position, ey));
  const corner = [0, 1, 2].map((i) => centre[i] + ey[i] * (top + MEMBRANE_ABOVE_RIBOSOME - dot(centre, ey)));
  const { frame, H, Rom } = cellFrameAt(corner, e1, ey, e3, config);
  return { frame, H, Rom, top: corner, ey, e1, e3, centre, config };
}

export function createCellView({ viewport, elements, context }) {
  let cell = null, shown = false, timer = 0;
  const toRoot = (p, model) => { const c = displayCenter(model), k = PRESENTATION_METERS_PER_ANGSTROM; return p.map((v, i) => (v - c[i]) * k); };

  const flyTo = (level) => {
    const model = context.model(); if (!model || !cell) return;
    const k = PRESENTATION_METERS_PER_ANGSTROM, view = { cell: [22000, cell.centre], region: [5200, cell.top], machine: [700, cell.centre] }[level];
    const target = toRoot(view[1], model), direction = cell.e3, distance = view[0] * k;
    viewport.setCamera({ position: target.map((v, i) => v + direction[i] * distance), target }, { duration: 1.6 });
  };
  function hud() {
    if (!shown) return;
    const cam = viewport.getCamera(), model = context.model();
    if (cam && model) {
      const dist = Math.hypot(...cam.position.map((v, i) => v - cam.target[i])) / PRESENTATION_METERS_PER_ANGSTROM, bar = scaleBar(dist, FOV, elements.view.clientHeight || 800);
      elements.level.textContent = `${LEVELS.find((l) => l.id === levelOf(dist)).label} · 比例尺 ${bar.label}（${Math.round(bar.pixels)} px）`;
    }
    timer = requestAnimationFrame(() => setTimeout(hud, 250));
  }
  function show() {
    const model = context.model(); if (!model) return;
    cell = cellAroundRibosome(context.residues());
    if (!cell) { elements.note.textContent = '这个结构里没有 16S / 23S RNA，定不出核糖体的朝向，画不出细胞。'; return; }
    const make = (radius, rgb) => { const s = capsuleSurface(cell.frame, radius, cell.H, 96, 72), pos = new Float32Array(s.positions.length), colors = new Float32Array(s.positions.length);
      for (let i = 0; i < pos.length; i += 3) { pos.set(toRoot([s.positions[i], s.positions[i + 1], s.positions[i + 2]], model), i); colors.set(rgb, i); } return { pos, idx: new Uint32Array(s.indices), colors }; };
    viewport.setOverlayMesh(INNER, make(cell.config.Rim, [0.56, 0.72, 0.91]), { opacity: 0.12 });
    viewport.setOverlayMesh(OUTER, make(cell.Rom, [0.91, 0.73, 0.56]), { opacity: 0.08 });
    shown = true; elements.toggle.textContent = '隐藏细胞'; elements.levels.hidden = false;
    elements.note.textContent = `大肠杆菌细胞：长 ${(cell.config.L / 10000).toFixed(0)} µm，内膜半径 ${cell.config.Rim / 10} nm，内外膜相距 ${cell.config.env / 10} nm；内膜在核糖体上方 ${MEMBRANE_ABOVE_RIBOSOME} Å。按真实尺寸画出；拟核、鞭毛、肽聚糖、拥挤的细胞质没有画（仍是经典代码）。`;
    flyTo('cell'); hud();
  }
  function hide() { shown = false; cancelAnimationFrame(timer); viewport.setOverlayMesh(INNER, null); viewport.setOverlayMesh(OUTER, null); elements.toggle.textContent = '画出整个细胞'; elements.levels.hidden = true; elements.level.textContent = ''; }
  elements.toggle.addEventListener('click', () => (shown ? hide() : show()));
  for (const [level, button] of Object.entries(elements.fly)) button.addEventListener('click', () => flyTo(level));
  return { reset() { hide(); elements.note.textContent = ''; cell = null; } };
}
