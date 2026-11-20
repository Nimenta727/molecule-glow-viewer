import { placeMembrane, applyPlacement } from '../structure/membrane-placement.mjs';
import { rotateVector } from '../structure/alignment.mjs';

/**
 * The membrane proteins of the whole cell (classic: `membraneShape` and `place` in src/sim/processes/whole-cell.js). `membraneShape` puts a protein in its membrane frame (the automatic
 * membrane placement of plugins/structure/membrane-placement.mjs: normal +Y, centre y = 0, cytoplasm below; an outer-membrane protein is turned over when its bigger loops face the cytoplasm)
 * and keeps every k-th residue as a coarse blob shape. `placeMembraneProteins` scatters copies over the part of the inner and outer membrane around the corner (abundance per cell scaled to the
 * area drawn, the inner membrane topped up with the `fill` types to 20 % coverage, the outer to 60 %), each standing on the membrane (its +Y along the membrane normal, a random turn about
 * it), never on the occupied 22 Å cells of the membrane surface, only on the half behind the cut plane. Pure; `random` is the scenery stream.
 */
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const norm = (a) => { const l = Math.hypot(...a) || 1; return a.map((v) => v / l); };

/** three.js's setFromUnitVectors as [x, y, z, w]. */
function turnTo(from, to) {
  let r = from[0] * to[0] + from[1] * to[1] + from[2] * to[2] + 1, x, y, z;
  if (r < Number.EPSILON) { r = 0; if (Math.abs(from[0]) > Math.abs(from[2])) { x = -from[1]; y = from[0]; z = 0; } else { x = 0; y = -from[2]; z = from[1]; } }
  else { x = from[1] * to[2] - from[2] * to[1]; y = from[2] * to[0] - from[0] * to[2]; z = from[0] * to[1] - from[1] * to[0]; }
  const l = Math.hypot(x, y, z, r) || 1; return [x / l, y / l, z / l, r / l];
}

/** The coarse shape of a membrane protein in its membrane frame, or null when no membrane is found. `atoms`: [{ position, asym, seq, nucleic, resn, entity }]; `info` as for placeMembrane. */
export function membraneShape(type, atoms, info) {
  const found = placeMembrane(atoms, info);
  if (!found) return null;
  const protein = atoms.filter((a) => !a.nucleic);
  let P = applyPlacement(protein.map((a) => a.position), found.placement);
  if (type.outer) {   // the outer membrane: the bigger loops face outward
    const up = P.filter((p) => p[1] > found.half).length, dn = P.filter((p) => p[1] < -found.half).length;
    if (dn > up) P = P.map((p) => [p[0], -p[1], -p[2]]);
  }
  const np = clamp(Math.round(P.length / 45), 8, 70), k = Math.max(1, Math.ceil(P.length / np)), pts = P.filter((_, i) => i % k === 0);
  const foot = Math.max(15, ...pts.filter((p) => Math.abs(p[1]) < 22).map((p) => Math.hypot(p[0], p[2])));
  return { ...type, pts, r: 3.3 * Math.cbrt(k) * 1.12, foot, n: P.length, half: found.half };
}

/**
 * Scatters the copies. `cell` = { F (frame), C (ECOLI), H, Rom, wCut }; `shapes`: the results of membraneShape (each with `outer` or not, `perCell`, `fill`). Returns [{ shape, bodies:
 * [{ pts (placed blob positions), cen }], expect, placed }] in the order of `shapes`.
 */
export function placeMembraneProteins(cell, shapes, random) {
  const { F, C, H, Rom, wCut } = cell, area = 2 * C.reg * (wCut + C.reg), imArea = 2 * Math.PI * C.Rim * 2 * H + 4 * Math.PI * C.Rim ** 2, omArea = 2 * Math.PI * Rom * 2 * H + 4 * Math.PI * Rom ** 2;
  const regU = () => C.uF + (random() * 2 - 1) * C.reg, regTh = (R) => { const w = -C.reg + random() * (wCut + C.reg); return Math.asin(clamp(w / R, -1, 1)); };
  const occ = new Set(), key = (L, R) => Math.round(L.u / 22) * 100000 + Math.round(R * Math.atan2(L.w, L.y) / 22), result = new Map();
  const place = (list, R, cover, cellArea) => {
    const want = list.map((s) => Math.round((s.perCell || 0) * area / cellArea)); list.forEach((s, i) => { s.expect = want[i]; });
    let cov = list.reduce((a, s, i) => a + want[i] * Math.PI * s.foot ** 2, 0);
    const fill = list.map((_, i) => i).filter((i) => list[i].fill);
    for (let g = 0; cov < cover * area && fill.length && g < 3000; g++) { const i = fill[g % fill.length]; want[i]++; cov += Math.PI * list[i].foot ** 2; }
    list.map((_, i) => i).sort((a, b) => list[b].n - list[a].n).forEach((i) => {
      const s = list[i], bodies = []; result.set(s, bodies);
      for (let tries = 0; bodies.length < want[i] && tries < want[i] * 30; tries++) {
        const u = regU(), th = regTh(R), nrm = norm(sub(F.at(u, th, 1), F.at(u, th, 0))), cen = F.at(u, th, R);
        if (F.loc(cen).w >= wCut) continue;   // only the half behind the cut
        const standUp = turnTo(F.ey, nrm), spin = random() * 6.3, h = spin / 2, about = [F.ey[0] * Math.sin(h), F.ey[1] * Math.sin(h), F.ey[2] * Math.sin(h), Math.cos(h)];
        const pts = s.pts.map((p) => add(rotateVector(rotateVector(p, about), standUp), cen)), keys = pts.map((p) => key(F.loc(p), R));
        if (keys.some((k) => occ.has(k))) continue;
        keys.forEach((k) => occ.add(k)); bodies.push({ pts, cen });
      }
      s.placed = bodies.length;
    });
  };
  place(shapes.filter((s) => !s.outer), C.Rim, 0.2, imArea);
  place(shapes.filter((s) => s.outer), Rom, 0.6, omArea);
  return shapes.map((shape) => ({ shape, bodies: result.get(shape) ?? [], expect: shape.expect ?? 0, placed: shape.placed ?? 0 }));
}
