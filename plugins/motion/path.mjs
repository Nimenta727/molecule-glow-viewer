import { lerp } from './vectors.mjs';

/** Position at `fraction` (0–1) of the way along the polyline `path`, by arc length. */
export function walkPath(path, fraction) {
  const lengths = path.slice(1).map((p, i) => Math.hypot(...p.map((v, k) => v - path[i][k])));
  let wanted = lengths.reduce((s, l) => s + l, 0) * fraction;
  for (let i = 0; i < lengths.length; i++) { if (wanted <= lengths[i]) return lerp(path[i], path[i + 1], wanted / (lengths[i] || 1)); wanted -= lengths[i]; }
  return path.at(-1);
}
