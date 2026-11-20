import { evaluateSelection } from './selection.mjs';

/**
 * Distances and angles between selections (classic: glow.measure in src/api/measure.js). Two selections give a distance (Å), three an angle (°, the middle one is the vertex).
 * Each selection must be exactly one residue (its Cα, or P for nucleic acids) or one small molecule (the centre of its atoms). The arithmetic is three.js's
 * (distanceTo, angleTo, radToDeg) so the numbers equal the classic to the last bit. Pure maths on a selection space; nothing is drawn here.
 */
export class MeasureError extends Error {
  constructor(message) { super(message); this.name = 'MeasureError'; }
}
const RAD2DEG = 180 / Math.PI;

const residueLabel = (r) => `${r.resn} ${r.chain}:${r.authSeq}${r.insertion || ''}`;
/** The point of one selection expression: { position, name }. */
export function measurePoint(space, expression, { positionOf } = {}) {
  const found = evaluateSelection(String(expression), space), count = found.residues.length + found.ligands.length;
  if (count !== 1) throw new MeasureError(`“${expression}” 选中了 ${count} 个，测量要正好一个残基或一个小分子（如 chain A and resi 87）`);
  if (found.residues.length) { const r = found.residues[0]; return { position: [...(positionOf?.(r) ?? r.position)], name: `${residueLabel(r)} ${r.nucleic ? 'P' : 'Cα'}` }; }
  const l = found.ligands[0], n = l.atoms.length, sum = l.atoms.reduce((s, a) => [s[0] + a.position[0], s[1] + a.position[1], s[2] + a.position[2]], [0, 0, 0]);
  return { position: sum.map((v) => v * (1 / n)), name: `${l.comp} 中心` };
}
export const distance = (a, b) => { const x = a[0] - b[0], y = a[1] - b[1], z = a[2] - b[2]; return Math.sqrt(x * x + y * y + z * z); };
/** The angle at `vertex` between the directions to `a` and `c`, in degrees. */
export function angle(a, vertex, c) {
  const u = [a[0] - vertex[0], a[1] - vertex[1], a[2] - vertex[2]], v = [c[0] - vertex[0], c[1] - vertex[1], c[2] - vertex[2]];
  const lu = u[0] * u[0] + u[1] * u[1] + u[2] * u[2], lv = v[0] * v[0] + v[1] * v[1] + v[2] * v[2], den = Math.sqrt(lu * lv);
  if (den === 0) return (Math.PI / 2) * RAD2DEG;
  const theta = (u[0] * v[0] + u[1] * v[1] + u[2] * v[2]) / den;
  return Math.acos(Math.max(-1, Math.min(1, theta))) * RAD2DEG;
}
/** measure(space, [a, b]) → { distance, unit: 'Å', points, positions }; measure(space, [a, b, c]) → { angle, unit: '°', ... }. `positionOf(residue)` may give a morphed position. */
export function measure(space, expressions, options) {
  const list = (expressions ?? []).filter((x) => x != null && x !== '');
  if (list.length < 2 || list.length > 3) throw new MeasureError('测量需要两个（距离）或三个（角度，中间是顶点）选择');
  const points = list.map((e) => measurePoint(space, e, options)), positions = points.map((p) => p.position), names = points.map((p) => p.name);
  return list.length === 2 ? { distance: distance(positions[0], positions[1]), unit: 'Å', points: names, positions } : { angle: angle(positions[0], positions[1], positions[2]), unit: '°', points: names, positions };
}
