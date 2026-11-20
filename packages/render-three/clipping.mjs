/**
 * Clipping geometry (classic: aimCut / applyCut in src/repr). Pure vector maths so it can be tested without a GPU; the viewport turns the results
 * into three.js clipping planes. A plane is { normal: [x, y, z], constant }; three keeps the points with normal·p + constant >= 0.
 *
 * - slab: removes what lies nearer the viewer than a plane through the model, a fraction `depth` of the model radius away from its centre
 *   (depth 1 removes nothing, 0 cuts through the centre). Fixed to the model, so orbiting does not change what is cut.
 * - wedge: removes a ±half-angle wedge around the (horizontal) viewing direction, around the vertical axis through the centre; applied to the parts
 *   marked "剖开". Two planes that clip only where BOTH clip (clipIntersection).
 */
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const length = (a) => Math.hypot(a[0], a[1], a[2]);
const scale = (a, k) => a.map((v) => v * k);
const normalize = (a) => { const l = length(a); return l > 0 ? scale(a, 1 / l) : null; };
const radians = (degrees) => degrees * Math.PI / 180;

/** Rotates v about the unit axis by angle (Rodrigues). */
function rotate(v, axis, angle) {
  const c = Math.cos(angle), s = Math.sin(angle), k = dot(axis, v);
  const cross = [axis[1] * v[2] - axis[2] * v[1], axis[2] * v[0] - axis[0] * v[2], axis[0] * v[1] - axis[1] * v[0]];
  return v.map((value, i) => value * c + cross[i] * s + axis[i] * k * (1 - c));
}

/** `toViewer`: unit-ish vector from the model centre towards the camera. Returns null when there is no direction. */
export function slabPlane({ toViewer, center, radius, depth }) {
  const direction = normalize(toViewer);
  if (!direction || !(radius > 0) || !Number.isFinite(depth) || depth >= 1) return null;
  const clamped = Math.max(-1, depth);
  // keep dir·p <= dir·center + depth*R: normal = -dir, constant = dir·center + depth*R
  return { normal: scale(direction, -1), constant: dot(direction, center) + clamped * radius };
}

/** The wedge around the vertical axis (`up`, default +Y). Returns null when the viewing direction is along the axis. */
export function wedgePlanes({ toViewer, center, up = [0, 1, 0], halfDegrees = 62, margin = 0.2 }) {
  const axis = normalize(up);
  const horizontal = toViewer.map((value, i) => value - axis[i] * dot(toViewer, axis));
  const direction = length(horizontal) > 1e-9 ? normalize(horizontal) : null;
  if (!axis || !direction) return null;
  const half = radians(halfDegrees);
  const m1 = rotate(direction, axis, half - Math.PI / 2), m2 = rotate(direction, axis, Math.PI / 2 - half);
  // removed where m1·(p-c) > margin AND m2·(p-c) > margin  <=>  kept where -m·p + (m·c + margin) >= 0 on either plane
  return [m1, m2].map((m) => ({ normal: scale(m, -1), constant: dot(m, center) + margin }));
}

/** Is a world point removed by these planes? `intersection` = removed only where all planes clip (the wedge); otherwise where any does (the slab). */
export function isClipped(planes, intersection, point) {
  if (!planes?.length) return false;
  const outside = planes.map(({ normal, constant }) => dot(normal, point) + constant < 0);
  return intersection ? outside.every(Boolean) : outside.some(Boolean);
}

/** The state that is saved with a work, validated: unknown or malformed values are dropped, never guessed. */
export function normalizeClipping(value) {
  if (!value || typeof value !== 'object') return null;
  const vector = (v) => Array.isArray(v) && v.length === 3 && v.every(Number.isFinite) && length(v) > 0 ? normalize(v) : null;
  const direction = vector(value.direction);
  if (!direction) return null;
  const depth = Number.isFinite(value.depth) ? Math.min(1, Math.max(-1, value.depth)) : 1;
  const scope = value.scope === 'parts' ? 'parts' : 'all';
  const wedgeParts = Array.isArray(value.wedgeParts) ? value.wedgeParts.filter((key) => typeof key === 'string').slice(0, 512) : [];
  return { enabled: value.enabled === true, direction, depth, scope, wedgeParts };
}
