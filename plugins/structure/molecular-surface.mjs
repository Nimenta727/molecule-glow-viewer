import { selectCoordinateAtoms, isPolymer } from './representation.mjs';
import { selectionSpace, evaluateSelection } from './selection.mjs';
import { residueIdentity } from './confidence.mjs';
import { pocketSurface } from './site-analysis.mjs';
import { hydropathyColor } from './look.mjs';

/**
 * Molecular surface of a chosen part, drawn from ALL its atoms (not one point per residue), coloured by a property:
 *   surface        Gaussian molecular surface (each atom a Gaussian of its van der Waals radius, iso-level at that radius, surface nets): an approximation of the solvent-excluded surface that
 *                  ChimeraX / PyMOL compute; it is smooth and close to it but not the same mesh. Grid step 0.5 Å for parts up to 600 atoms, 0.75 Å above that, 1.25 Å or coarser above 40 000 atoms (up to 250 000), and coarser still when the grid would be too big. `plain` takes the rule's own `color`; `inflate` (0–6 Å) thickens every atom's radius: needed for a part drawn only by its C-alpha or phosphorus atoms (a head shell, a DNA trace), whose atoms are 3–4 Å apart. Up to 4 Å grids for objects the size of a virus.
 *   electrostatic  Coulomb potential at 1.4 Å outside each surface vertex along its normal, from SIMPLIFIED charges (below) over the whole structure, distance-dependent dielectric ε = 4r
 *                  (the defaults of ChimeraX `coulombic`), in kcal/(mol·e); red −10 … white 0 … blue +10. It is NOT a Poisson–Boltzmann (APBS) result: no solvent, no ions, no ligand charges,
 *                  no pH. Charges: Lys NZ +1; Arg NE/NH1/NH2 +1/3 each; Asp OD1/OD2 and Glu OE1/OE2 −1/2 each; nucleic phosphate oxygens −1/2 each; backbone N(+H) −0.1438, CA(+HA) +0.116,
 *                  C +0.5973, O −0.5679 (AMBER ff14SB values summed onto the heavy atoms, Pro N −0.2548); termini, His, ligands and all other side-chain atoms 0.
 *   hydrophobicity Kyte–Doolittle colour of the residue nearest to each vertex (the scale of the `hydrophobicity` colour scheme).
 *   plain          one colour.
 * Plain data in, typed arrays out; nothing is drawn here.
 */
export class SurfaceError extends Error { constructor(message) { super(message); this.name = 'SurfaceError'; } }
export const SCHEMES = Object.freeze({ electrostatic: '静电势（简化库仑）', hydrophobicity: '疏水性', plain: '单色' });
export const FINE_SCALE = 0.92;   // summed Gaussians swell a surface: on a fine grid the radii are scaled down so that the atoms' bumps stay visible (a tighter, more atomic surface)
export const MAX_SURFACES = 4, FINE_ATOMS = 600, MAX_ATOMS = 40000, COARSE_ATOMS = 250000, MAX_CELLS = 5e6, OFFSET = 1.4, DIELECTRIC = 4, RANGE = 10, COULOMB = 332.0716;
const VDW = { C: 1.7, N: 1.55, O: 1.52, S: 1.8, P: 1.8 };
const PRO = 'PRO', BACKBONE = { N: -0.1438, CA: 0.116, C: 0.5973, O: -0.5679 };
const SIDECHAIN = { 'LYS:NZ': 1, 'ARG:NE': 1 / 3, 'ARG:NH1': 1 / 3, 'ARG:NH2': 1 / 3, 'ASP:OD1': -0.5, 'ASP:OD2': -0.5, 'GLU:OE1': -0.5, 'GLU:OE2': -0.5 };
const NUCLEIC_O = new Set(['OP1', 'OP2', 'O1P', 'O2P']);

/** The simplified charge of one atom (see above). */
export function atomCharge(atom, format) {
  if (atom.record !== 'ATOM' && !isPolymer(atom, format)) return 0;
  const resn = String(atom.residueName).toUpperCase(), name = atom.name;
  if (NUCLEIC_O.has(name)) return -0.5;
  if (resn === PRO && name === 'N') return -0.2548;
  if (Object.hasOwn(BACKBONE, name) && String(atom.element).toUpperCase() === (name === 'CA' ? 'C' : name[0])) return BACKBONE[name];
  return SIDECHAIN[`${resn}:${name}`] ?? 0;
}

const NEG = [224, 70, 60], POS = [58, 110, 220];
/** Colour of a potential value (kcal/(mol·e)) as 0–1 rgb: red below zero, white at zero, blue above; saturated at ±RANGE. */
export function potentialColor(v) {
  const t = Math.max(-1, Math.min(1, v / RANGE)), end = t < 0 ? NEG : POS, a = Math.abs(t);
  return [0, 1, 2].map((i) => (255 + (end[i] - 255) * a) / 255);
}
const hexRgb = (hex) => [parseInt(hex.slice(1, 3), 16) / 255, parseInt(hex.slice(3, 5), 16) / 255, parseInt(hex.slice(5, 7), 16) / 255];

/** Area-weighted vertex normals of an indexed triangle surface (flat xyz array). */
export function vertexNormals(pos, idx) {
  const n = new Float32Array(pos.length);
  for (let t = 0; t < idx.length; t += 3) {
    const [a, b, c] = [idx[t] * 3, idx[t + 1] * 3, idx[t + 2] * 3];
    const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2], vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const i of [a, b, c]) { n[i] += nx; n[i + 1] += ny; n[i + 2] += nz; }
  }
  for (let i = 0; i < n.length; i += 3) { const l = Math.hypot(n[i], n[i + 1], n[i + 2]) || 1; n[i] /= l; n[i + 1] /= l; n[i + 2] /= l; }
  return n;
}

/** Potentials (kcal/(mol·e)) at `points` (flat xyz) from the charged atoms of the whole model: 332.07 · Σ q / (ε(r) · r) with ε = 4r, i.e. 83.02 · Σ q / r²; charges within 60 Å are summed. */
export function potentialAt(model, points) {
  const charged = []; for (const { atom, pos } of selectCoordinateAtoms(model)) { const q = atomCharge(atom, model.format); if (q) charged.push([pos, q]); }
  const cell = 30, grid = new Map(), key = (x, y, z) => `${x},${y},${z}`;
  for (const [pos, q] of charged) { const k = key(Math.floor(pos[0] / cell), Math.floor(pos[1] / cell), Math.floor(pos[2] / cell)); if (!grid.has(k)) grid.set(k, []); grid.get(k).push([pos, q]); }
  const out = new Float32Array(points.length / 3), factor = COULOMB / DIELECTRIC;
  for (let i = 0; i < out.length; i++) {
    const x = points[3 * i], y = points[3 * i + 1], z = points[3 * i + 2], cx = Math.floor(x / cell), cy = Math.floor(y / cell), cz = Math.floor(z / cell);
    let sum = 0;
    for (let a = cx - 2; a <= cx + 2; a++) for (let b = cy - 2; b <= cy + 2; b++) for (let c = cz - 2; c <= cz + 2; c++) for (const [pos, q] of grid.get(key(a, b, c)) ?? []) {
      const r2 = (x - pos[0]) ** 2 + (y - pos[1]) ** 2 + (z - pos[2]) ** 2; if (r2 > 3600) continue; sum += q / Math.max(1, r2);
    }
    out[i] = factor * sum;
  }
  return out;
}

/** Checks and cleans the surface rules ([{ expr, scheme }], at most 4). */
export function validateSurfaces(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_SURFACES) throw new SurfaceError(`表面规则应为不超过 ${MAX_SURFACES} 条的列表。`);
  return value.map((item) => {
    if (!item || typeof item.expr !== 'string' || !item.expr.trim() || item.expr.length > 400) throw new SurfaceError('表面规则的选择表达式无效（1–400 个字符）。');
    if (!Object.hasOwn(SCHEMES, item.scheme)) throw new SurfaceError(`表面配色应为 ${Object.keys(SCHEMES).join(' / ')}。`);
    if (item.color !== undefined && (typeof item.color !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(item.color))) throw new SurfaceError('表面颜色应为 #rrggbb。');
    if (item.inflate !== undefined && !(Number.isFinite(item.inflate) && item.inflate >= 0 && item.inflate <= 6)) throw new SurfaceError('表面的加粗应为 0–6 Å。');
    return { expr: item.expr.trim(), scheme: item.scheme, ...(item.color ? { color: item.color.toLowerCase() } : {}), ...(item.inflate ? { inflate: item.inflate } : {}) };
  });
}

/**
 * The surface of `expression` with `scheme`: { pos (Å, Float32Array), idx, colors (rgb, Float32Array), stats: { atoms, vertices, triangles, resolution, potential?: { min, max, mean } } }.
 * Throws a SurfaceError that says what to do when the part is empty, too big, or no surface forms.
 */
export function buildSurface(model, { expr, scheme = 'plain', color, inflate = 0 }) {
  if (!Object.hasOwn(SCHEMES, scheme)) throw new SurfaceError(`表面配色应为 ${Object.keys(SCHEMES).join(' / ')}。`);
  let residues; try { residues = evaluateSelection(expr, selectionSpace(model)).residues; } catch (error) { throw new SurfaceError(error.message); }
  if (!residues.length) throw new SurfaceError(`“${expr}”没有选中任何残基。`);
  const ids = new Set(residues.map((r) => residueIdentity(r.atom))), atoms = [];
  for (const { atom, pos } of selectCoordinateAtoms(model)) { if (['H', 'D'].includes(String(atom.element).toUpperCase())) continue; if (ids.has(residueIdentity(atom))) atoms.push({ atom, pos }); }
  if (atoms.length > COARSE_ATOMS) throw new SurfaceError(`这部分有 ${atoms.length} 个原子，超过表面的上限 ${COARSE_ATOMS}：请缩小选择（例如一个亚基或一组链）。`);
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const { pos } of atoms) for (let i = 0; i < 3; i++) { lo[i] = Math.min(lo[i], pos[i]); hi[i] = Math.max(hi[i], pos[i]); }
  const cells = (h) => [0, 1, 2].reduce((p, i) => p * (Math.ceil((hi[i] - lo[i] + 8) / h) + 1), 1);
  const finest = atoms.length > MAX_ATOMS ? 1.25 : atoms.length > FINE_ATOMS ? 0.75 : 0.5;   // more than 40 000 atoms (a ribosome) is drawn at 1.25 Å or coarser
  const h = [0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3, 4].filter((step) => step >= finest).find((step) => cells(step) <= MAX_CELLS);   // a whole chain at 0.5 Å is ~200 000 triangles: heavy to draw
  if (!h) throw new SurfaceError('这部分太大，无法在内存允许的网格里算出表面：请缩小选择。');
  const names = [...new Set(atoms.map(({ atom }) => String(atom.residueName).toUpperCase()))].slice(0, 254);
  const surface = pocketSurface({ pos: new Float32Array(atoms.flatMap(({ pos }) => pos)), rad: new Float32Array(atoms.map(({ atom }) => ((VDW[String(atom.element).toUpperCase()] ?? 1.8) * (h <= 0.75 ? FINE_SCALE : 1)) + inflate)), cls: new Uint8Array(atoms.map(({ atom }) => Math.max(0, names.indexOf(String(atom.residueName).toUpperCase())))), h });
  if (!surface.idx.length) throw new SurfaceError('没有形成表面（选择太小或太零散）。');
  const count = surface.pos.length / 3, colors = new Float32Array(count * 3), stats = { atoms: atoms.length, vertices: count, triangles: surface.idx.length / 3, resolution: h };
  // The winding of the mesh decides which side is "out": turn every triangle so that the front faces away from the molecule (a solid surface can then hide its back faces).
  const centre = [0, 1, 2].map((i) => atoms.reduce((sum, { pos }) => sum + pos[i], 0) / atoms.length);
  let normals = vertexNormals(surface.pos, surface.idx), outward = 0;
  for (let i = 0; i < count; i++) outward += normals[3 * i] * (surface.pos[3 * i] - centre[0]) + normals[3 * i + 1] * (surface.pos[3 * i + 1] - centre[1]) + normals[3 * i + 2] * (surface.pos[3 * i + 2] - centre[2]);
  if (outward < 0) { for (let t = 0; t < surface.idx.length; t += 3) { const second = surface.idx[t + 1]; surface.idx[t + 1] = surface.idx[t + 2]; surface.idx[t + 2] = second; } normals = vertexNormals(surface.pos, surface.idx); }
  if (scheme === 'electrostatic') {
    const probe = new Float32Array(surface.pos.length);
    for (let i = 0; i < probe.length; i++) probe[i] = surface.pos[i] + OFFSET * normals[i];
    const v = potentialAt(model, probe); let min = Infinity, max = -Infinity, sum = 0;
    for (let i = 0; i < count; i++) { colors.set(potentialColor(v[i]), 3 * i); min = Math.min(min, v[i]); max = Math.max(max, v[i]); sum += v[i]; }
    stats.potential = { min, max, mean: sum / count };
  } else if (scheme === 'hydrophobicity') {
    const palette = names.map((name) => hexRgb(hydropathyColor(name)));
    for (let i = 0; i < count; i++) colors.set(palette[surface.cls[i]] ?? [0.85, 0.86, 0.88], 3 * i);
  } else { const flat = color ? hexRgb(color) : [0.85, 0.82, 0.72]; for (let i = 0; i < count; i++) colors.set(flat, 3 * i); }
  for (let i = 0; i < colors.length; i++) { const c = colors[i]; colors[i] = c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }   // the colours above are sRGB; the renderer's vertex colours are linear
  return { pos: surface.pos, idx: surface.idx, colors, stats };
}
