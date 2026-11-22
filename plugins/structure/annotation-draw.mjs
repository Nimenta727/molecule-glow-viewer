import { computeAnnotations } from './annotations.mjs';

/**
 * Puts the measurements and labels of a work into a viewport: dashed lines for the segments, a small dot with the text for every value and label. Shared by the Studio and the Viewer, which differ only in
 * how a structure coordinate (Å) becomes a scene coordinate: `convert(point)`. Returns the problems found (a rule that selects nothing in this file) so the caller can say so; nothing is drawn for them.
 */
export const ANNOTATION_LINES = 'annotation-lines', ANNOTATION_TEXTS = 'annotation-texts';
const MEASURE_COLOR = '#d9a400', LABEL_COLOR = '#2a6f97';

export function clearAnnotations(viewport) {
  viewport.setOverlayLines(ANNOTATION_LINES, []);
  viewport.setParticleCloud(ANNOTATION_TEXTS, []);
}

export function drawAnnotations(viewport, model, { measures = [], labels = [], bonds = [] } = {}, convert) {
  if (!model || (!measures.length && !labels.length && !bonds.length)) { clearAnnotations(viewport); return []; }
  const { lines, texts, problems } = computeAnnotations(model, { measures, labels, bonds });
  viewport.setOverlayLines(ANNOTATION_LINES, lines.map(({ a, b, color }) => ({ a: convert(a), b: convert(b), color: color ?? MEASURE_COLOR })), { dash: 0.01, gap: 0.006 });
  viewport.setParticleCloud(ANNOTATION_TEXTS, texts.map(({ position, text, kind, quiet, color }) => ({ position: convert(position), radius: quiet ? 0.012 : 0.03, color: color ?? (kind === 'measure' ? MEASURE_COLOR : LABEL_COLOR), alpha: 0.95, name: text, ...(quiet ? {} : { label: text }) })), { overlay: true });
  return problems;
}
