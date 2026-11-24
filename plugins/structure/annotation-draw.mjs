import { computeAnnotations } from './annotations.mjs';

/**
 * Puts the measurements and labels of a work into a viewport: dashed lines for the segments, a small dot with the text for every value and label. Shared by the Studio and the Viewer, which differ only in
 * how a structure coordinate (Å) becomes a scene coordinate: `convert(point)`. Returns the problems found (a rule that selects nothing in this file) so the caller can say so; nothing is drawn for them.
 */
export const ANNOTATION_LINES = 'annotation-lines', ANNOTATION_TEXTS = 'annotation-texts';
const MEASURE_COLOR = '#d9a400', LABEL_COLOR = '#2a6f97';

export const ANNOTATION_BONDS = 'annotation-bonds';
export function clearAnnotations(viewport) {
  viewport.setOverlayLines(ANNOTATION_LINES, []);
  viewport.setOverlayMesh(ANNOTATION_BONDS, null);
  viewport.setParticleCloud(ANNOTATION_TEXTS, []);
}

/**
 * Interactions (hydrogen bonds, salt bridges, hydrophobic contacts) as dashed tubes from atom to atom, in the scene like the atoms themselves (hidden behind what is in front of them, lit and outlined),
 * so they read at the atoms they join rather than floating over the picture. `radius`, `dash` and `gap` are in scene units. Returns { pos, idx, colors } for viewport.setOverlayMesh.
 */
export function dashedTubes(segments, { radius, dash, gap, sides = 8 }) {
  const pos = [], idx = [], colors = [], shade = (hex) => { const v = parseInt(String(hex).replace('#', ''), 16); return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255].map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)); };
  for (const { a, b, color } of segments) {
    const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], length = Math.hypot(...d); if (length < 1e-9) continue;
    const t = d.map((v) => v / length), helper = Math.abs(t[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    let u = [t[1] * helper[2] - t[2] * helper[1], t[2] * helper[0] - t[0] * helper[2], t[0] * helper[1] - t[1] * helper[0]]; const ul = Math.hypot(...u); u = u.map((v) => v / ul);
    const w = [t[1] * u[2] - t[2] * u[1], t[2] * u[0] - t[0] * u[2], t[0] * u[1] - t[1] * u[0]], rgb = shade(color);
    for (let start = 0; start < length; start += dash + gap) {
      const end = Math.min(start + dash, length), base = pos.length / 3;
      for (const along of [start, end]) for (let k = 0; k < sides; k++) {
        const angle = (2 * Math.PI * k) / sides, c = Math.cos(angle) * radius, s = Math.sin(angle) * radius;
        pos.push(a[0] + t[0] * along + u[0] * c + w[0] * s, a[1] + t[1] * along + u[1] * c + w[1] * s, a[2] + t[2] * along + u[2] * c + w[2] * s); colors.push(...rgb);
      }
      for (let k = 0; k < sides; k++) { const k1 = (k + 1) % sides; idx.push(base + k, base + sides + k, base + k1, base + k1, base + sides + k, base + sides + k1); }
    }
  }
  return { pos: new Float32Array(pos), idx: new Uint32Array(idx), colors: new Float32Array(colors) };
}

export function drawAnnotations(viewport, model, { measures = [], labels = [], bonds = [] } = {}, convert) {
  if (!model || (!measures.length && !labels.length && !bonds.length)) { clearAnnotations(viewport); return []; }
  const { lines, texts, problems } = computeAnnotations(model, { measures, labels, bonds });
  const measured = lines.filter((line) => line.kind !== 'bond'), bonded = lines.filter((line) => line.kind === 'bond');
  viewport.setOverlayLines(ANNOTATION_LINES, measured.map(({ a, b, color }) => ({ a: convert(a), b: convert(b), color: color ?? MEASURE_COLOR })), { dash: 0.01, gap: 0.006 });
  const origin = convert([0, 0, 0]), unit = Math.hypot(...convert([1, 0, 0]).map((v, i) => v - origin[i]));   // scene units per angstrom
  viewport.setOverlayMesh(ANNOTATION_BONDS, bonded.length ? dashedTubes(bonded.map(({ a, b, color }) => ({ a: convert(a), b: convert(b), color })), { radius: 0.09 * unit, dash: 0.32 * unit, gap: 0.22 * unit }) : null, { opacity: 1 });
  const shown = bonded.length > 16 ? texts.filter((text) => text.kind !== 'bond') : texts;   // with many interactions the distance labels would cover the picture: the panel lists them instead
  viewport.setParticleCloud(ANNOTATION_TEXTS, shown.map(({ position, text, kind, quiet, color }) => ({ position: convert(position), radius: quiet ? 0.012 : 0.03, color: color ?? (kind === 'measure' ? MEASURE_COLOR : LABEL_COLOR), alpha: 0.95, name: text, ...(quiet ? {} : { label: text }) })), { overlay: true });
  return problems;
}
