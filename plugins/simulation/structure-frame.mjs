import { chooseAxis } from '../motion/rotation.mjs';
import { needsFlip, flipAboutHorizontal, structureBox } from './data-animation.mjs';

/**
 * The frame a data animation runs in. The classic engine runs on a model that has been turned so its axis is vertical (`axis: 'sym' | 'long' | 'short'`) and
 * centred, with "above" and "below" a membrane meaning larger and smaller y. The new Viewer draws a structure in its own coordinates, so this adapter builds
 * the engine's structure from the model in that oriented frame (the rotation comes from plugins/motion/rotation.mjs, the same axis the classic `orientTransform`
 * finds) and maps what the engine produces back to the model's coordinates. Pure maths; the Viewer supplies residues and ligands from the structure plugin.
 *
 *   residues: [{ position, entity, authSeq, insertion, labelSeq, chain, labelAsym }]   ligands: [{ comp, atoms: [{ position }] }]
 *   config: { axis, membranes: [{ at, offset }] }   (the same fields as the classic scene)
 */
const UP = [0, 1, 0];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const mean = (points) => points.reduce((s, p) => [s[0] + p[0] / points.length, s[1] + p[1] / points.length, s[2] + p[2] / points.length], [0, 0, 0]);

/** 3x3 rotation (rows) turning unit vector `d` onto +y by the shortest way. */
export function rotationToUp(d) {
  const c = dot(d, UP);
  if (c < -1 + 1e-9) return [[1, 0, 0], [0, -1, 0], [0, 0, -1]];   // opposite: half a turn about x
  const v = cross(d, UP), k = 1 / (1 + c);
  const vx = [[0, -v[2], v[1]], [v[2], 0, -v[0]], [-v[1], v[0], 0]];
  const vx2 = vx.map((row) => [0, 1, 2].map((j) => row[0] * vx[0][j] + row[1] * vx[1][j] + row[2] * vx[2][j]));
  return [0, 1, 2].map((i) => [0, 1, 2].map((j) => (i === j ? 1 : 0) + vx[i][j] + vx2[i][j] * k));
}
const apply = (R, p) => R.map((row) => dot(row, p));
const applyT = (R, p) => [0, 1, 2].map((j) => R[0][j] * p[0] + R[1][j] * p[1] + R[2][j] * p[2]);

/** The classic keyword match: a name contains the key (any case), or the key is /regex/flags. */
export function kwMatch(name, key) {
  if (key.startsWith('/') && key.lastIndexOf('/') > 0) { const i = key.lastIndexOf('/'); try { return new RegExp(key.slice(1, i), key.slice(i + 1) || 'i').test(name); } catch { return false; } }
  return name.toLowerCase().includes(key.toLowerCase());
}

export function orientedFrame({ residues, ligands = [], config = {}, animation }) {
  if (!residues?.length) throw new Error('取向需要结构的残基坐标');
  const native = residues.map((r) => r.position), g = mean(native), mode = config.axis ?? 'sym';
  let R = [[1, 0, 0], [0, 1, 0], [0, 0, 1]], axis = null;
  if (mode !== 'native') {
    // membrane complexes: the flattest direction of the named (transmembrane) parts is the membrane normal, as the classic axisFit; too few residues fall back to the whole model
    const fit = config.axisFit?.length ? residues.filter((r) => config.axisFit.some((k) => kwMatch(r.entity ?? '', k))).map((r) => r.position) : [];
    axis = chooseAxis(fit.length > 50 ? 'short' : mode, { points: fit.length > 50 ? fit : native }).direction; R = rotationToUp(axis);
  }
  // the part a small molecule sits in = the entity of the nearest residue (the classic partAt)
  const partOf = (c) => { let best = '', bd = Infinity; for (const r of residues) { const d = (r.position[0] - c[0]) ** 2 + (r.position[1] - c[1]) ** 2 + (r.position[2] - c[2]) ** 2; if (d < bd) { bd = d; best = r.entity ?? ''; } } return best; };
  // `ring` = the centre of the ring atoms (Mg and the four N of a chlorophyll or heme; all atoms when there are none), the classic's `ring()`
  const ligandInfo = ligands.map((l) => { const native = mean(l.atoms.map((a) => a.position)), ringAtoms = l.atoms.filter((a) => ['MG', 'NA', 'NB', 'NC', 'ND'].includes(a.name)); return { comp: String(l.comp).toUpperCase(), native, ring: ringAtoms.length ? mean(ringAtoms.map((a) => a.position)) : native, part: partOf(native), ringPart: partOf(ringAtoms.length ? mean(ringAtoms.map((a) => a.position)) : native) }; });
  const toOriented = (p) => apply(R, [p[0] - g[0], p[1] - g[1], p[2] - g[2]]);
  let oriented = native.map(toOriented), flipAbout = null;
  // up / down: the named part ends above (below) the middle; the axis sign is arbitrary, so turn the model half a turn about a horizontal axis if it is the wrong way up
  const side = config.up ?? config.down;
  if (side) {
    const named = residues.map((r, i) => ({ r, p: oriented[i] })).filter(({ r }) => kwMatch(r.entity ?? '', side));
    const my = named.length ? named.reduce((t, { p }) => t + p[1], 0) / named.length : 0;
    if (named.length && (config.up ? my < 0 : my > 0)) flipAbout = structureBox(oriented).centre;
  }
  const build = (points) => {
    const place = (p) => (flipAbout ? flipAboutHorizontal(p, flipAbout) : p);
    const pts = flipAbout ? points.map(place) : points;
    const byEntity = (name) => residues.map((r, i) => ({ r, p: pts[i] })).filter(({ r }) => kwMatch(r.entity ?? '', name));
    const structure = {
      points: pts,
      ligands: ligandInfo.map(({ comp, native, ring, part, ringPart }) => ({ comp, centre: place(toOriented(native)), ring: place(toOriented(ring)), part, ringPart })),
      residue: ({ number, ins = '', part, chain, labelSeq, labelAsym }) => {
        const hit = residues.findIndex((r) => (labelSeq != null ? r.labelSeq === labelSeq && (!labelAsym || r.labelAsym === labelAsym) : r.authSeq === number && (r.insertion ?? '').toUpperCase() === ins && (!chain || r.chain === chain)) && (!part || kwMatch(r.entity ?? '', part)));
        return hit < 0 ? null : pts[hit];
      },
      // every residue that matches (a number occurs once in each copy of a chain)
      residues: ({ number, ins = '', part, chain }) => residues.flatMap((r, i) => (r.authSeq === number && (r.insertion ?? '').toUpperCase() === ins && (!chain || r.chain === chain) && (!part || kwMatch(r.entity ?? '', part)) ? [pts[i]] : [])),
      part: (name) => { const list = byEntity(name); return list.length ? mean(list.map(({ p }) => p)) : null; },
      partPoints: (name) => byEntity(name).map(({ p }) => p),
      membraneY: [],
    };
    structure.membraneY = (config.membranes ?? []).slice(0, 2).map((m) => {
      const entities = [...new Set(residues.map((r) => r.entity ?? ''))], key = entities.find((n) => kwMatch(n, m.at || ''));
      const list = key === undefined ? [] : residues.map((r, i) => ({ r, p: pts[i] })).filter(({ r }) => (r.entity ?? '') === key);
      return (list.length ? mean(list.map(({ p }) => p))[1] : 0) + (Number(m.offset) || 0);
    });
    return structure;
  };
  let structure = build(oriented);
  // orient.up: the anchor's side of the model faces up (the axis sign is arbitrary), by a half turn about a horizontal axis through the middle
  if (flipAbout) structure = build(oriented);
  const flipped = !flipAbout && (animation ? needsFlip(animation, structure) : false);
  if (flipped) { flipAbout = structureBox(oriented).centre; structure = build(oriented); }
  const fromOriented = (q) => { const p = flipAbout ? flipAboutHorizontal(q, flipAbout) : q; const r = applyT(R, p); return [r[0] + g[0], r[1] + g[1], r[2] + g[2]]; };
  return { structure, flipped: Boolean(flipAbout), axis, rotation: R, centroid: g, toNative: fromOriented, fromNative: (p) => { const q = toOriented(p); return flipAbout ? flipAboutHorizontal(q, flipAbout) : q; } };
}
