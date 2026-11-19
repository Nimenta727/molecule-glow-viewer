// The classic Viewer's Gaussian density and surface-nets method, with array
// coordinates and passive triangles instead of Three.js objects.
export function densitySurface(points, weights, resolution = 12) {
  if (points.length < 3) return [];
  const sigma = 0.225 * resolution;
  const spacing = Math.max(1.2, resolution / 4);
  const cutoff = 3 * sigma;
  const padding = cutoff + 2 * spacing;
  const minimum = [Infinity, Infinity, Infinity];
  const maximum = [-Infinity, -Infinity, -Infinity];
  for (const point of points) {
    for (let axis = 0; axis < 3; axis++) {
      minimum[axis] = Math.min(minimum[axis], point[axis]);
      maximum[axis] = Math.max(maximum[axis], point[axis]);
    }
  }
  const dimensions = minimum.map((value, axis) => Math.ceil((maximum[axis] - value + 2 * padding) / spacing) + 1);
  const [nx, ny, nz] = dimensions;
  if (nx * ny * nz > 1_000_000) throw new RangeError('部件密度网格超过预览上限，请提高分辨率数值。');
  for (let axis = 0; axis < 3; axis++) minimum[axis] -= padding;
  const density = new Float32Array(nx * ny * nz);
  const gridIndex = (x, y, z) => x + nx * (y + ny * z);
  const radius = Math.ceil(cutoff / spacing);
  const inverseVariance = 1 / (2 * sigma * sigma);
  for (const [index, point] of points.entries()) {
    const [cx, cy, cz] = point.map((value, axis) => Math.round((value - minimum[axis]) / spacing));
    for (let z = Math.max(0, cz - radius); z <= Math.min(nz - 1, cz + radius); z++) {
      for (let y = Math.max(0, cy - radius); y <= Math.min(ny - 1, cy + radius); y++) {
        for (let x = Math.max(0, cx - radius); x <= Math.min(nx - 1, cx + radius); x++) {
          const dx = minimum[0] + x * spacing - point[0];
          const dy = minimum[1] + y * spacing - point[1];
          const dz = minimum[2] + z * spacing - point[2];
          const squared = dx * dx + dy * dy + dz * dz;
          if (squared <= cutoff * cutoff) density[gridIndex(x, y, z)] += weights[index] * Math.exp(-squared * inverseVariance);
        }
      }
    }
  }
  const values = density.filter((value) => value > 1e-4).sort();
  const volume = weights.reduce((sum, weight) => sum + weight, 0) * 136;
  const cells = Math.max(1, Math.round(volume / spacing ** 3));
  const level = values.length > cells ? values[values.length - cells] : (values[0] || 0.5) * 0.5;
  const corners = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0],
    [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]];
  const edges = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3],
    [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
  const vertexIndices = new Int32Array((nx - 1) * (ny - 1) * (nz - 1)).fill(-1);
  const cellIndex = (x, y, z) => x + (nx - 1) * (y + (ny - 1) * z);
  const vertices = [];
  for (let z = 0; z < nz - 1; z++) {
    for (let y = 0; y < ny - 1; y++) {
      for (let x = 0; x < nx - 1; x++) {
        const samples = corners.map(([dx, dy, dz]) => density[gridIndex(x + dx, y + dy, z + dz)] - level);
        const inside = samples.filter((value) => value > 0).length;
        if (inside === 0 || inside === 8) continue;
        const position = [0, 0, 0];
        let intersections = 0;
        for (const [a, b] of edges) {
          if ((samples[a] > 0) === (samples[b] > 0)) continue;
          const fraction = samples[a] / (samples[a] - samples[b]);
          for (let axis = 0; axis < 3; axis++) {
            position[axis] += corners[a][axis] + fraction * (corners[b][axis] - corners[a][axis]);
          }
          intersections++;
        }
        vertexIndices[cellIndex(x, y, z)] = vertices.length;
        vertices.push(position.map((value, axis) =>
          minimum[axis] + ([x, y, z][axis] + value / intersections) * spacing));
      }
    }
  }
  const triangles = [];
  function quad(a, b, c, d, flip) {
    if ([a, b, c, d].some((index) => index < 0)) return;
    const indices = flip ? [a, c, b, a, d, c] : [a, b, c, a, c, d];
    for (const index of indices) triangles.push(...vertices[index]);
  }
  for (let z = 1; z < nz - 1; z++) {
    for (let y = 1; y < ny - 1; y++) {
      for (let x = 0; x < nx - 1; x++) {
        const a = density[gridIndex(x, y, z)] > level;
        const b = density[gridIndex(x + 1, y, z)] > level;
        if (a !== b) quad(vertexIndices[cellIndex(x, y - 1, z - 1)], vertexIndices[cellIndex(x, y, z - 1)],
          vertexIndices[cellIndex(x, y, z)], vertexIndices[cellIndex(x, y - 1, z)], b);
      }
    }
  }
  for (let z = 1; z < nz - 1; z++) {
    for (let y = 0; y < ny - 1; y++) {
      for (let x = 1; x < nx - 1; x++) {
        const a = density[gridIndex(x, y, z)] > level;
        const b = density[gridIndex(x, y + 1, z)] > level;
        if (a !== b) quad(vertexIndices[cellIndex(x - 1, y, z - 1)], vertexIndices[cellIndex(x - 1, y, z)],
          vertexIndices[cellIndex(x, y, z)], vertexIndices[cellIndex(x, y, z - 1)], b);
      }
    }
  }
  for (let z = 0; z < nz - 1; z++) {
    for (let y = 1; y < ny - 1; y++) {
      for (let x = 1; x < nx - 1; x++) {
        const a = density[gridIndex(x, y, z)] > level;
        const b = density[gridIndex(x, y, z + 1)] > level;
        if (a !== b) quad(vertexIndices[cellIndex(x - 1, y - 1, z)], vertexIndices[cellIndex(x, y - 1, z)],
          vertexIndices[cellIndex(x, y, z)], vertexIndices[cellIndex(x - 1, y, z)], b);
      }
    }
  }
  return triangles;
}
