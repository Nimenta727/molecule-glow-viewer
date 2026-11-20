import { centroid } from '../structure/alignment.mjs';
import { dot, cross, sub, normalize } from './vectors.mjs';

/**
 * Rotating parts (classic: the per-part "spin" switch and axis modes, src/derived/geometry.js and src/repr/rebuild.js). A spin is a rotation by an angle
 * about an axis through a pivot. The axis can come from the shape of the spinning parts (their long axis, their short axis, or their symmetry axis, as the
 * classic "主轴" modes), from the line between two groups of residues (classic `axisFrom`: through the first group's centre, pointing to the second),
 * or from a plain x / y / z direction. Pure maths: no rendering, no page.
 */

/** Eigen-decomposition of a symmetric 3x3 matrix by Jacobi sweeps: { values, vectors } (vectors are columns). */
export function jacobi(matrix) {
  const n = matrix.length, a = matrix.map((row) => row.slice()), v = matrix.map((row, i) => row.map((_, j) => +(i === j)));
  for (let sweep = 0; sweep < 60; sweep++) {
    let off = 0;
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) off += a[p][q] * a[p][q];
    if (off < 1e-18) break;
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) {
      if (Math.abs(a[p][q]) < 1e-14) continue;
      const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]), t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1)), c = 1 / Math.sqrt(t * t + 1), s = t * c;
      for (let k = 0; k < n; k++) { const kp = a[k][p], kq = a[k][q]; a[k][p] = c * kp - s * kq; a[k][q] = s * kp + c * kq; }
      for (let k = 0; k < n; k++) { const pk = a[p][k], qk = a[q][k]; a[p][k] = c * pk - s * qk; a[q][k] = s * pk + c * qk; }
      for (let k = 0; k < n; k++) { const kp = v[k][p], kq = v[k][q]; v[k][p] = c * kp - s * kq; v[k][q] = s * kp + c * kq; }
    }
  }
  return { values: a.map((row, i) => row[i]), vectors: v };
}

/** Principal axes of a point cloud: { centre, values (ascending), axes (unit vectors, shortest first) }. */
export function principalAxes(points) {
  const centre = centroid(points), M = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (const p of points) {
    const d = sub(p, centre);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) M[i][j] += d[i] * d[j];
  }
  const { values, vectors } = jacobi(M), order = [0, 1, 2].sort((i, j) => values[i] - values[j]);
  return { centre, values: order.map((i) => values[i]), axes: order.map((i) => normalize([vectors[0][i], vectors[1][i], vectors[2][i]])) };
}

export class AxisError extends Error {
  constructor(message) { super(message); this.name = 'AxisError'; }
}

const BASIS = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };

/**
 * A rotation axis { point, direction } (direction is a unit vector). `points`: the positions of the spinning parts' residues.
 *   mode 'long' / 'short'  the longest / shortest principal axis of `points` (through their centre)
 *   mode 'sym'             the symmetry axis: the principal axis whose eigenvalue differs most from the other two (a ring turns about it)
 *   mode 'x' | 'y' | 'z'   that direction through the centre of `points`
 *   mode 'between'         through the centre of `from`, pointing to the centre of `to` (two groups of points)
 */
export function chooseAxis(mode, { points = [], from = [], to = [] } = {}) {
  if (mode === 'between') {
    if (!from.length || !to.length) throw new AxisError('“两组残基之间”的轴需要两组都有残基。');
    const a = centroid(from), direction = sub(centroid(to), a);
    if (Math.hypot(...direction) < 1e-9) throw new AxisError('两组残基的中心重合，定不出轴。');
    return { point: a, direction: normalize(direction) };
  }
  if (points.length < 3) throw new AxisError('要旋转的部件里残基太少，定不出轴。');
  if (mode in BASIS) return { point: centroid(points), direction: BASIS[mode] };
  const { centre, values, axes } = principalAxes(points);
  let axis;
  if (mode === 'short') axis = axes[0];
  else if (mode === 'long') axis = axes[2];
  else if (mode === 'sym') {
    const d0 = Math.abs(values[0] - (values[1] + values[2]) / 2) / values[2], d2 = Math.abs(values[2] - (values[0] + values[1]) / 2) / values[2];
    axis = d0 > d2 ? axes[0] : axes[2];
  } else throw new AxisError(`未知的轴模式：${mode}`);
  return { point: centre, direction: axis };
}

/** Rotates `point` by `angle` (radians) about the axis `{ point, direction }` (Rodrigues). */
export function rotateAbout(point, { point: pivot, direction }, angle) {
  const v = sub(point, pivot), c = Math.cos(angle), s = Math.sin(angle), k = dot(direction, v), x = cross(direction, v);
  return v.map((value, i) => pivot[i] + value * c + x[i] * s + direction[i] * k * (1 - c));
}

/** Angle (radians) after `seconds` at `turnsPerSecond` (negative turns the other way), starting from `start`. */
export const spinAngle = (turnsPerSecond, seconds, start = 0) => start + 2 * Math.PI * turnsPerSecond * seconds;
