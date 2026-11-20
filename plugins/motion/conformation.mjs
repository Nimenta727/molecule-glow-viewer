import { distance } from './vectors.mjs';
import { superpose } from '../structure/alignment.mjs';

/**
 * Conformation motion by residue displacement: every display vertex follows the inverse-distance-weighted displacement of
 * its nearest anchor atoms between two coordinate sets. Shared by the rotary-ATPase, two-state (hinge) and potassium-channel
 * players, which previously each carried an identical copy. Anchors are
 *   { ref, at: [x, y, z] (display-space position used to find neighbours), from: [x, y, z] (source coordinates, angstrom) }
 * and a resolver maps an anchor to the target coordinates (angstrom) in the same frame as `from`.
 */

// Two numerically different squared-distance formulas existed in the copies; both are kept so results stay bit-identical.
export const sumOfSquares = (vertex, at) => (at[0] - vertex[0]) ** 2 + (at[1] - vertex[1]) ** 2 + (at[2] - vertex[2]) ** 2;
export const hypotSquared = (vertex, at) => distance(vertex, at) ** 2;

/** The `count` anchors closest to `vertex`, nearest first; equal distances keep their original order. */
export function nearestAnchors(vertex, anchors, count = 4, squaredDistance = sumOfSquares) {
  const nearest = [];
  for (const anchor of anchors) {
    const d = squaredDistance(vertex, anchor.at);
    const index = nearest.findIndex((entry) => d < entry.d);
    if (index >= 0) nearest.splice(index, 0, { anchor, d });
    else if (nearest.length < count) nearest.push({ anchor, d });
    if (nearest.length > count) nearest.length = count;
  }
  return nearest;
}

/**
 * For each resolver, the flat vertex positions displaced to that target state. `positions` is a flat [x,y,z,...] array in
 * display space; `scale` converts the angstrom displacement to display space. Returns one flat array per resolver.
 */
export function displaceVertices(positions, anchors, resolvers, { scale, neighbors = 4, squaredDistance = sumOfSquares } = {}) {
  const output = resolvers.map(() => []);
  for (let i = 0; i < positions.length; i += 3) {
    const vertex = positions.slice(i, i + 3);
    const nearest = nearestAnchors(vertex, anchors, neighbors, squaredDistance);
    const weights = nearest.map(({ d }) => 1 / Math.max(1e-12, d)), total = weights.reduce((sum, value) => sum + value, 0);
    resolvers.forEach((resolve, index) => {
      const delta = [0, 0, 0];
      nearest.forEach(({ anchor }, n) => {
        const target = resolve(anchor);
        for (let j = 0; j < 3; j++) delta[j] += (target[j] - anchor.from[j]) * scale * weights[n] / total;
      });
      output[index].push(...vertex.map((value, j) => value + delta[j]));
    });
  }
  return output;
}

/** Rotation angle in degrees of a rigid fit function (as returned by `superpose`). */
export function rotationAngle(fit) {
  const zero = fit([0, 0, 0]);
  const trace = [0, 1, 2].reduce((sum, i) => { const basis = [0, 0, 0]; basis[i] = 1; return sum + fit(basis)[i] - zero[i]; }, 0);
  return Math.acos(Math.max(-1, Math.min(1, (trace - 1) / 2))) * 180 / Math.PI;
}

export { superpose };

/**
 * Same result as `displaceVertices` (inverse-distance weighting of the nearest anchors) but with the anchors in a grid, so it stays fast with thousands
 * of anchors (a whole structure) and hundreds of thousands of vertices. Ties are resolved like `nearestAnchors` (earlier anchor first).
 */
export function displaceVerticesGrid(positions, anchors, resolvers, { scale, neighbors = 4, cell = 2 } = {}) {
  const grid = new Map(), key = (x, y, z) => `${x},${y},${z}`, floor = Math.floor;
  anchors.forEach((anchor, index) => {
    const k = key(floor(anchor.at[0] / cell), floor(anchor.at[1] / cell), floor(anchor.at[2] / cell));
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(index);
  });
  const nearestIndexes = (vertex) => {
    const [cx, cy, cz] = vertex.map((v) => floor(v / cell));
    for (let ring = 1; ring < 4096; ring++) {
      const found = [];
      for (let x = cx - ring; x <= cx + ring; x++) for (let y = cy - ring; y <= cy + ring; y++) for (let z = cz - ring; z <= cz + ring; z++) {
        for (const index of grid.get(key(x, y, z)) ?? []) found.push(index);
      }
      if (found.length >= neighbors) {
        // a candidate outside the searched cube could still be nearer than the k-th inside it: accept only when the k-th is within the cube's inner radius
        const entries = found.map((index) => ({ index, d: sumOfSquares(vertex, anchors[index].at) })).sort((a, b) => a.d - b.d || a.index - b.index).slice(0, neighbors);
        const safe = (ring * cell) ** 2;
        if (entries[entries.length - 1].d <= safe || found.length === anchors.length) return entries;
      }
      if (found.length === anchors.length) return found.map((index) => ({ index, d: sumOfSquares(vertex, anchors[index].at) })).sort((a, b) => a.d - b.d || a.index - b.index).slice(0, neighbors);
    }
    return [];
  };
  const output = resolvers.map(() => []);
  for (let i = 0; i < positions.length; i += 3) {
    const vertex = positions.slice(i, i + 3), nearest = nearestIndexes(vertex);
    const weights = nearest.map(({ d }) => 1 / Math.max(1e-12, d)), total = weights.reduce((sum, value) => sum + value, 0);
    resolvers.forEach((resolve, r) => {
      const delta = [0, 0, 0];
      nearest.forEach(({ index }, n) => {
        const target = resolve(anchors[index]);
        for (let j = 0; j < 3; j++) delta[j] += (target[j] - anchors[index].from[j]) * scale * weights[n] / total;
      });
      output[r].push(...vertex.map((value, j) => value + delta[j]));
    });
  }
  return output;
}
