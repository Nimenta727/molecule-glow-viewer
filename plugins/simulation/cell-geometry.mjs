/**
 * The geometry of a whole cell in one scene (classic: ECOLI and capsuleGeo in src/sim/processes/whole-cell.js). A rod-shaped cell is a capsule: a cylinder with a
 * hemispherical cap at each end, described in a frame whose axis `e1` runs along the cell, `ey` points from the cytoplasm out through the inner membrane at the corner and
 * `e3` completes the frame. Everything is in Å. Pure geometry; the Viewer draws the surfaces.
 */
export const ECOLI = Object.freeze({ Rim: 4000, env: 240, L: 20000, uF: 3000, reg: 1500, regDepth: 1700 });   // inner-membrane radius, inner to outer membrane, length tip to tip, corner position along the axis, region half size / depth

const add = (a, b, k = 1) => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** The frame of the cell: origin `o` (on the axis, at the cell's middle... the cell centre), axes e1 (along), ey (up through the corner), e3; `at(u, theta, r)` and `loc(p)`. */
export function capsuleFrame(o, e1, ey, e3) {
  return { o, e1, ey, e3,
    at: (u, th, r) => add(add(add(o, e1, u), ey, r * Math.cos(th)), e3, r * Math.sin(th)),
    loc: (p) => { const q = [p[0] - o[0], p[1] - o[1], p[2] - o[2]]; return { u: dot(q, e1), y: dot(q, ey), w: dot(q, e3) }; } };
}
/** Where the cell is, given the point `top` of the inner membrane at the corner and the corner's frame (classic setup): the frame, the half length of the straight part and the outer radius. */
export function cellFrameAt(top, e1, ey, e3, C = ECOLI) {
  const o = add(add(top, ey, -C.Rim), e1, -C.uF), Rom = C.Rim + C.env;
  return { frame: capsuleFrame(o, e1, ey, e3), H: C.L / 2 - Rom - 20, Rom };
}

/** The profile of a capsule of radius R and straight half length H: nP + 1 points [u, r] from one tip to the other, evenly spaced along the outline. */
export function capsuleProfile(R, H, nP = 160) {
  const S = Math.PI * R + 2 * H, prof = [];
  for (let i = 0; i <= nP; i++) {
    const a = S * i / nP; let u, r;
    if (a < Math.PI * R / 2) { const f = a / R; u = -H - R * Math.cos(f); r = R * Math.sin(f); }
    else if (a < Math.PI * R / 2 + 2 * H) { u = -H + a - Math.PI * R / 2; r = R; }
    else { const f = (S - a) / R; u = H + R * Math.cos(f); r = R * Math.sin(f); }
    prof.push([u, r]);
  }
  return prof;
}
/** The surface as an indexed triangle mesh: { positions: Float32Array (x, y, z per vertex), indices }, (nP + 1) x (nT + 1) vertices. */
export function capsuleSurface(F, R, H, nP = 160, nT = 128) {
  const prof = capsuleProfile(R, H, nP), positions = new Float32Array((nP + 1) * (nT + 1) * 3), indices = []; let k = 0;
  for (let i = 0; i <= nP; i++) for (let j = 0; j <= nT; j++) { const th = 2 * Math.PI * j / nT, [u, r] = prof[i], p = F.at(u, th, r); positions[k++] = p[0]; positions[k++] = p[1]; positions[k++] = p[2]; }
  for (let i = 0; i < nP; i++) for (let j = 0; j < nT; j++) { const a = i * (nT + 1) + j, b = a + nT + 1; indices.push(a, b, a + 1, b, b + 1, a + 1); }
  return { positions, indices };
}
export const capsuleVolume = (R, H) => Math.PI * R * R * 2 * H + (4 / 3) * Math.PI * R ** 3;
export const capsuleArea = (R, H) => 2 * Math.PI * R * 2 * H + 4 * Math.PI * R * R;
