/**
 * Ball-and-stick geometry of small molecules with bond orders (classic: buildMolecules, style "valence", in src/repr/molecules.js). Pure vector maths:
 * it returns balls, sticks and dashes; the viewport turns them into instanced meshes. Lengths are multiplied by `unit` (viewport units per Å).
 *
 *   single bond   one stick          double bond   two thin sticks side by side      triple bond   three
 *   aromatic      one stick plus a dashed line inside the ring (toward the ring side of a neighbouring bond)
 * Atoms are just joints (small balls) where they have bonds; an atom without bonds (an ion) is a full ball.
 */
export const AROMATIC = 4;
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const unit = (a) => { const l = len(a); return l > 0 ? mul(a, 1 / l) : null; };
const lerp = (a, b, t) => add(mul(a, 1 - t), mul(b, t));

/**
 * @param atoms [{ position: [x,y,z], color, radius }]   radius = ball radius in Å for an unbonded atom
 * @param bonds [[i, j, order]]  (order 1, 2, 3 or AROMATIC)
 * @param scale viewport units per Å
 */
export function valenceGeometry(atoms, bonds, scale = 1) {
  const neighbours = atoms.map(() => []);
  for (const [i, j] of bonds) { neighbours[i].push(j); neighbours[j].push(i); }
  const balls = atoms.map((atom, i) => ({ position: atom.position, color: atom.color, radius: (neighbours[i].length ? 0.15 : atom.radius) * scale }));
  const sticks = [], dashes = [];
  for (const [i, j, order] of bonds) {
    const A = atoms[i].position, B = atoms[j].position, ca = atoms[i].color, cb = atoms[j].color;
    const axis = unit(sub(B, A));
    if (!axis) continue;
    // sideways direction: in the plane of a neighbouring bond (inside the ring for aromatic bonds), else any perpendicular
    const k = neighbours[i].find((x) => x !== j) ?? neighbours[j].find((x) => x !== i);
    let side = null;
    if (k != null) {
      const ref = sub(atoms[k].position, neighbours[i].includes(k) ? A : B);
      side = sub(ref, mul(axis, dot(ref, axis)));
    }
    if (!side || len(side) * len(side) < 1e-6) {
      side = len(cross([1, 0, 0], axis)) ** 2 > 1e-3 ? cross([1, 0, 0], axis) : cross([0, 0, 1], axis);
    }
    side = unit(side);
    const shift = (f) => mul(side, f * scale);
    const stick = (from, to, radius) => sticks.push({ a: from, b: to, radius: radius * scale, colorA: ca, colorB: cb });
    if (order === 2) for (const f of [0.13, -0.13]) stick(add(A, shift(f)), add(B, shift(f)), 0.09);
    else if (order === 3) for (const f of [-0.19, 0, 0.19]) stick(add(A, shift(f)), add(B, shift(f)), 0.07);
    else if (order === AROMATIC) {
      stick(A, B, 0.15 * 0.9);
      const a2 = lerp(add(A, shift(0.3)), B, 0.18), b2 = lerp(add(B, shift(0.3)), A, 0.18), n = 3;
      for (let t = 0; t < n; t++) dashes.push({ a: lerp(a2, b2, t / n + 0.04), b: lerp(a2, b2, (t + 0.6) / n), radius: 0.06 * scale });
    } else stick(A, B, 0.15);
  }
  return { balls, sticks, dashes };
}
