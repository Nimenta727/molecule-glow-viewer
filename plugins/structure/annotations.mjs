import { selectionSpace, evaluateSelection } from './selection.mjs';
import { measure, MeasureError } from './measure.mjs';

/**
 * Measurements and labels the author keeps with a work (in the structure file's viewer state, next to the look): a MEASUREMENT is the distance between two parts or the angle at the middle one of three
 * (each part: one residue or one small molecule, written in the selection language), a LABEL is a text put on a part. Plain data; no executable content. `computeAnnotations` turns them into what is
 * drawn (dashed lines and texts, in the structure's own coordinates, Å); the Studio and the Viewer put them in their own scene. A rule whose selection no longer picks what it should (another file) is reported
 * in `problems` and left out, never guessed.
 */
export const MAX_MEASURES = 24, MAX_LABELS = 48, MAX_EXPRESSION = 400, MAX_TEXT = 60;
export class AnnotationError extends Error { constructor(message) { super(message); this.name = 'AnnotationError'; } }

const expression = (value, what) => {
  if (typeof value !== 'string' || !value.trim() || value.length > MAX_EXPRESSION) throw new AnnotationError(`${what}的选择表达式无效（1–${MAX_EXPRESSION} 个字符）。`);
  return value.trim();
};

/** Checks and cleans the measurements: [{ points: [a, b] | [a, b, c] }], at most 24. */
export function validateMeasures(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_MEASURES) throw new AnnotationError(`测量应为不超过 ${MAX_MEASURES} 条的列表。`);
  return value.map((item) => {
    if (!item || !Array.isArray(item.points) || item.points.length < 2 || item.points.length > 3) throw new AnnotationError('每条测量要两个（距离）或三个（角度，中间是顶点）选择。');
    return { points: item.points.map((point) => expression(point, '测量')) };
  });
}

/** Checks and cleans the labels: [{ expr, text? }], at most 48; `text` empty means "name the part". */
export function validateLabels(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_LABELS) throw new AnnotationError(`标签应为不超过 ${MAX_LABELS} 条的列表。`);
  return value.map((item) => {
    if (!item || typeof item !== 'object') throw new AnnotationError('标签应为对象。');
    const text = item.text === undefined || item.text === null ? '' : String(item.text).trim();
    if (text.length > MAX_TEXT) throw new AnnotationError(`标签文字最多 ${MAX_TEXT} 个字符。`);
    return { expr: expression(item.expr, '标签'), ...(text ? { text } : {}) };
  });
}

const centroid = (points) => points.reduce((sum, p) => [sum[0] + p[0], sum[1] + p[1], sum[2] + p[2]], [0, 0, 0]).map((v) => v / points.length);
const middle = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];

/**
 * What to draw for the given measurements and labels on `model`: { lines: [{ a, b }], texts: [{ position, text, kind, index }], problems: [{ kind, index, message }] }; positions in Å.
 * A measurement draws its segments and puts its value at the middle of the first one ("12.34 Å", "95.0°"); a label sits at the centre of the part it names.
 */
export function computeAnnotations(model, { measures = [], labels = [] } = {}) {
  const out = { lines: [], texts: [], problems: [] };
  if (!model || (!measures.length && !labels.length)) return out;
  const space = selectionSpace(model);
  measures.forEach((item, index) => {
    try {
      const result = measure(space, item.points), p = result.positions;
      for (let i = 1; i < p.length; i++) out.lines.push({ a: p[i - 1], b: p[i] });
      out.texts.push({ position: middle(p[0], p[1]), text: result.distance != null ? `${result.distance.toFixed(2)} Å` : `${result.angle.toFixed(1)}°`, kind: 'measure', index });
    } catch (error) { out.problems.push({ kind: 'measure', index, message: error instanceof MeasureError || error.name === 'SelectionError' ? error.message : `测量失败：${error.message}` }); }
  });
  labels.forEach((item, index) => {
    try {
      const found = evaluateSelection(item.expr, space), points = [...found.residues.map((r) => [...r.position]), ...found.ligands.map((l) => centroid(l.atoms.map((a) => a.position)))];
      if (!points.length) throw new AnnotationError(`“${item.expr}” 没有选中任何东西。`);
      const first = found.residues[0], single = points.length === 1;
      const name = single ? (first ? `${first.resn} ${first.chain}:${first.authSeq}${first.insertion || ''}` : found.ligands[0].comp) : `${points.length} 个部分`;
      out.texts.push({ position: centroid(points), text: item.text || name, kind: 'label', index });
    } catch (error) { out.problems.push({ kind: 'label', index, message: error.message }); }
  });
  return out;
}
