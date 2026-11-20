/**
 * The parts of the whole cell besides its two membranes (classic: the nucleoid, ribosomes, flagella, peptidoglycan and LPS blocks of `setup` in src/sim/processes/whole-cell.js), as pure
 * geometry in the cell's frame (plugins/simulation/cell-geometry.mjs: `F.at(u, theta, r)` along / around / out from the axis, `F.loc(p)` back). Everything is in Å and deterministic for a
 * seeded random source `random()` in [0, 1) (the classic's `randVis`, the scenery stream); the Viewer draws the points as beads and the segments as lines.
 *   C = { Rim, env, L, uF, reg, regDepth } (ECOLI), H = half length of the straight part, Rom = outer membrane radius, wCut = where the cut plane is along the viewing axis (only w < wCut is drawn).
 */
const add = (a, b, k = 1) => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const unit = (a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const randDir = (random) => { const u = (random() - 0.5) * 2, t = random() * 6.283185307, r = Math.sqrt(1 - u * u); return [r * Math.cos(t), u, r * Math.sin(t)]; };

/** Is a point of the cell (local u, y, w) in the nucleoid ellipsoid (|u| < 0.72 H, radius 2300 Å)? */
export const NUCLEOID = Object.freeze({ radius: 2300, step: 300, steps: 70, strands: 26, fraction: 0.72 });
export const inNucleoid = (L, H) => (L.u / (H * NUCLEOID.fraction)) ** 2 + (L.y * L.y + L.w * L.w) / NUCLEOID.radius ** 2 < 1;

/** The nucleoid: random-walk DNA in an ellipsoid around the axis, `strands` polylines of `steps` points 300 Å apart (the real 1.6 mm genome is far longer; the share drawn is reported). */
export function nucleoid(F, H, random) {
  const nucU = H * NUCLEOID.fraction, nucR = NUCLEOID.radius, tubes = []; let length = 0;
  for (let s = 0; s < NUCLEOID.strands; s++) {
    let p = [(random() - 0.5) * nucU * 1.4, (random() - 0.5) * nucR, -random() * nucR * 0.9], dir = randDir(random);   // local (u, y, w)
    const pts = [];
    for (let i = 0; i < NUCLEOID.steps; i++) {
      pts.push(F.at(p[0], Math.atan2(p[2], p[1]), Math.hypot(p[1], p[2])));
      dir = unit(add(dir.map((v) => v * 0.55), randDir(random).map((v) => v * 0.8)));
      let nx = add(p, dir, NUCLEOID.step);
      if ((nx[0] / nucU) ** 2 + (nx[1] * nx[1] + nx[2] * nx[2]) / nucR ** 2 > 1 || nx[2] > -100) { dir = unit(add(unit(p.map((v) => -v)), randDir(random).map((v) => v * 0.5))); nx = add(p, dir, NUCLEOID.step); }   // back towards the middle, a little at random
      p = nx; length += NUCLEOID.step;
    }
    tubes.push(pts);
  }
  return { tubes, length };
}

/**
 * The ribosomes of the whole cell: 25 000 spread uniformly through the cytoplasm but about 90 % kept out of the nucleoid; only those behind the cut plane (w < wCut - 120) and outside the
 * corner's own box (`inRegion(L)`) are drawn, each as a pair of beads (the large and the small subunit). Returns { big, small, total, drawn }.
 */
export function cellRibosomes(F, C, H, random, { wCut, inRegion = () => false, total = 25000 } = {}) {
  const Rr = C.Rim - 150, big = [], small = []; let n = 0;
  while (n < total) {
    const u = (random() * 2 - 1) * (H + Rr), cap = Math.abs(u) > H ? Math.sqrt(Math.max(0, Rr * Rr - (Math.abs(u) - H) ** 2)) : Rr;
    if (random() > (cap / Rr) ** 2) continue;
    const th = random() * 2 * Math.PI, r = cap * Math.sqrt(random()), L = { u, y: r * Math.cos(th), w: r * Math.sin(th) };
    if (inNucleoid(L, H) && random() < 0.9) continue;
    n++; if (L.w > wCut - 120 || inRegion(L)) continue;
    const p = F.at(u, th, r); big.push(p); small.push(add(p, randDir(random), 95));
  }
  return { big, small, total: n, drawn: big.length };
}

/**
 * The flagella: up to 5, peritrichous, on the back half; the filament is a left-handed helix (pitch about 2.3 µm, radius up to 0.19 µm) cut to 3 µm, the motor a short cylinder through
 * the envelope. Returns [{ base, normal, path: [points every 150 Å], motor: { centre, axis, radius, length } }].
 */
export function flagella(F, C, H, Rom, random) {
  const out = [];
  for (let f = 0, tries = 0; f < 5 && tries < 200; tries++) {
    const u = (random() * 2 - 1) * H * 0.9, th = Math.PI + (random() - 0.5) * 2.2;   // the back: sin(th) < 0
    if (Math.sin(th) > -0.4 || (Math.abs(u - C.uF) < C.reg + 400 && Math.cos(th) > 0)) continue;
    const B = F.at(u, th, Rom + 20), n = unit(add(F.at(u, th, 1), F.at(u, th, 0), -1));
    const D = unit(add(add(F.e1.map((v) => -v), n, 0.45), F.e3, -0.2)), P1 = unit(add(n, D, -dot(n, D))), P2 = cross(D, P1), path = [];
    for (let s = 0; s <= 30000; s += 150) {
      const a = 1900 * Math.min(1, s / 3000), ph = -2 * Math.PI * s / 23000;
      path.push(add(add(add(add(B, n, Math.min(s, 400)), D, Math.max(0, s - 400)), P1, a * (Math.cos(ph) - 1)), P2, a * Math.sin(ph)));
    }
    out.push({ base: B, normal: n, path, motor: { centre: F.at(u, th, C.Rim + C.env / 2 - 40), axis: n, radius: 230, length: C.env + 160 } }); f++;
  }
  return out;
}

/**
 * The peptidoglycan net of the region around the corner (glycan strands running round the cell, 20-60 nm long with gaps, 30 Å segments; peptide cross-links to the next strand along the
 * axis with probability 0.35) and the LPS of the outer leaflet (short lines). Returns { glycan: [{ a, b }], lps: [{ a, b }] }.
 */
export function envelopeNet(F, C, Rom, random, { wCut }) {
  const Rpg = Rom - 110, glycan = [], lps = [], th0 = Math.asin(-C.reg / Rpg), th1 = Math.asin(Math.min(1, wCut / Rpg));
  for (let u = C.uF - C.reg; u <= C.uF + C.reg; u += 45) for (let th = th0; th < th1;) {
    const length = (200 + random() * 400) / Rpg, end = Math.min(th1, th + length);
    for (let a = th; a < end; a += 30 / Rpg) {
      glycan.push({ a: F.at(u, a, Rpg), b: F.at(u, Math.min(end, a + 30 / Rpg), Rpg) });
      if (random() < 0.35 && u + 45 <= C.uF + C.reg) glycan.push({ a: F.at(u, a, Rpg), b: F.at(u + 45, a, Rpg) });
    }
    th = end + (20 + random() * 40) / Rpg;
  }
  const regU = () => C.uF + (random() * 2 - 1) * C.reg, regTh = (R) => { const w = -C.reg + random() * (wCut + C.reg); return Math.asin(Math.max(-1, Math.min(1, w / R))); };
  for (let i = 0; i < 7000; i++) { const u = regU(), th = regTh(Rom); lps.push({ a: F.at(u, th, Rom + 19), b: F.at(u + (random() - 0.5) * 8, th + (random() - 0.5) * 0.002, Rom + 52) }); }
  return { glycan, lps };
}
