/**
 * Chemical components (classic: getTemplate / bondsFromTemplate / bondsOf / fitPose in src/data/rcsb.js and src/repr/molecules.js).
 * The RCSB Chemical Component Dictionary (CCD) says what a small molecule is made of: atom names, elements, bonds and their orders. A ligand in a
 * structure carries the same atom names, so its bonds (single / double / triple / aromatic) come from the dictionary by name; without the dictionary
 * they are guessed from distances (all single). Network access is injected (`fetchText`); parsing and matching are pure.
 */
const COMPONENT_ID = /^[A-Za-z0-9]{1,5}$/;
const ORDER = { SING: 1, DOUB: 2, TRIP: 3, AROM: 1 };
export const AROMATIC = 4;   // bond order code for an aromatic bond (drawn as a bond plus a dashed line inside the ring)
/** Covalent radii (Å) of the elements the classic viewer bonds by distance; ions have none and are never bonded; unknown elements get 0.8 Å. */
const COVALENT = { C: 0.76, N: 0.71, O: 0.66, P: 1.07, S: 1.05, H: 0.31, FE: 1.3, F: 0.57, BR: 1.2, I: 1.39, SE: 1.2 };
const IONS = new Set(['MG', 'K', 'NA', 'CA', 'ZN', 'CL', 'MN', 'CU']);
const DEFAULT_COVALENT = 0.8;

export class ChemicalComponentError extends Error {
  constructor(message) { super(message); this.name = 'ChemicalComponentError'; }
}

const tokenize = (line) => line.match(/'[^']*'|"[^"]*"|\S+/g)?.map((t) => ((t[0] === "'" || t[0] === '"') ? t.slice(1, -1) : t)) ?? [];

/** The rows of one mmCIF category as objects (a looped table or a single-row key/value block). */
export function parseCategory(text, prefix) {
  const lines = text.split(/\r?\n/), out = [];
  let i = lines.findIndex((l) => l.startsWith(`${prefix}.`));
  if (i < 0) return out;
  if (!(i > 0 && lines[i - 1].trim() === 'loop_')) {
    const row = {};
    for (; i < lines.length && lines[i].startsWith(`${prefix}.`); i++) { const t = tokenize(lines[i]); row[t[0].slice(prefix.length + 1)] = t[1]; }
    return [row];
  }
  const columns = [];
  for (; i < lines.length && lines[i].startsWith(`${prefix}.`); i++) columns.push(lines[i].trim().slice(prefix.length + 1));
  let buffer = [];
  for (; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('#') || line.startsWith('loop_') || line.startsWith('_')) break;
    buffer.push(...tokenize(line));
    while (buffer.length >= columns.length) {
      const row = {};
      columns.forEach((c, k) => { row[c] = buffer[k]; });
      out.push(row);
      buffer = buffer.slice(columns.length);
    }
  }
  return out;
}

const centred = (atoms) => {
  const c = [0, 0, 0];
  for (const a of atoms) for (let k = 0; k < 3; k++) c[k] += a.position[k];
  for (let k = 0; k < 3; k++) c[k] /= atoms.length;
  return atoms.map((a) => ({ ...a, position: a.position.map((v, k) => v - c[k]) }));
};

/** A template from a CCD `.cif`: { comp, atoms: [{ name, element, position }], bonds: [[i, j, order]], byName, source }. Hydrogens are left out; coordinates are the ideal ones, centred. */
export function parseChemComp(text, comp) {
  const num = (v, w) => ((v && v !== '?' && v !== '.') ? +v : +w);
  const atoms = parseCategory(text, '_chem_comp_atom').filter((r) => (r.type_symbol ?? '').toUpperCase() !== 'H').map((r) => ({
    name: r.atom_id, element: r.type_symbol.toUpperCase(),
    position: [num(r.pdbx_model_Cartn_x_ideal, r.model_Cartn_x), num(r.pdbx_model_Cartn_y_ideal, r.model_Cartn_y), num(r.pdbx_model_Cartn_z_ideal, r.model_Cartn_z)],
  }));
  if (!atoms.length || atoms.some((a) => !a.position.every(Number.isFinite))) throw new ChemicalComponentError('化学组件没有理想坐标');
  const index = new Map(atoms.map((a, i) => [a.name, i]));
  const bonds = parseCategory(text, '_chem_comp_bond').filter((b) => index.has(b.atom_id_1) && index.has(b.atom_id_2))
    .map((b) => [index.get(b.atom_id_1), index.get(b.atom_id_2), b.pdbx_aromatic_flag === 'Y' ? AROMATIC : ORDER[b.value_order] || 1]);
  return finish(comp, centred(atoms), bonds, 'CCD');
}

/** A template from the ideal SDF (no atom names, so it cannot be matched onto a structure ligand by name). */
export function parseIdealSdf(text, comp) {
  const lines = text.split(/\r?\n/), na = parseInt(lines[3].slice(0, 3), 10), nb = parseInt(lines[3].slice(3, 6), 10), all = [];
  if (!(na > 0)) throw new ChemicalComponentError('SDF 没有原子');
  for (let i = 0; i < na; i++) { const r = lines[4 + i]; all.push({ position: [+r.slice(0, 10), +r.slice(10, 20), +r.slice(20, 30)], element: r.slice(31, 34).trim().toUpperCase(), name: '' }); }
  const keep = all.map((a) => a.element !== 'H'), remap = [];
  let k = 0;
  for (const flag of keep) remap.push(flag ? k++ : -1);
  const atoms = all.filter((a, i) => keep[i]), bonds = [];
  for (let i = 0; i < nb; i++) {
    const r = lines[4 + na + i], a = +r.slice(0, 3) - 1, b = +r.slice(3, 6) - 1, order = +r.slice(6, 9);
    if (keep[a] && keep[b]) bonds.push([remap[a], remap[b], order]);
  }
  return finish(comp, centred(atoms), bonds, 'SDF');
}

function finish(comp, atoms, bonds, source) {
  return Object.freeze({ comp, atoms, bonds, byName: Object.fromEntries(atoms.map((a) => [a.name, a.position])), source });
}

/** Bonds (with orders) from a template, matched to ligand atoms by name. Null when nothing matches (use bondsByDistance instead). `atoms`: [{ name }]. */
export function bondsFromTemplate(atoms, template) {
  if (!template?.atoms.length) return null;
  const at = new Map();
  atoms.forEach((a, i) => { if (a.name) at.set(a.name, i); });
  const out = [];
  for (const [i, j, order] of template.bonds) {
    const a = at.get(template.atoms[i].name), b = at.get(template.atoms[j].name);
    if (a != null && b != null) out.push([a, b, order]);
  }
  return out.length ? out : null;
}

/** Guessed single bonds between atoms closer than the sum of their covalent radii + 0.45 Å. `atoms`: [{ element, position }]. Ions (no covalent radius) are never bonded. */
export function bondsByDistance(atoms) {
  const radius = (element) => (IONS.has(element) ? 0 : COVALENT[element] ?? DEFAULT_COVALENT);
  const out = [];
  for (let i = 0; i < atoms.length; i++) for (let j = i + 1; j < atoms.length; j++) {
    const ri = radius(atoms[i].element), rj = radius(atoms[j].element);
    if (!ri || !rj) continue;
    const d = Math.hypot(atoms[i].position[0] - atoms[j].position[0], atoms[i].position[1] - atoms[j].position[1], atoms[i].position[2] - atoms[j].position[2]);
    if (d < ri + rj + 0.45) out.push([i, j, 1]);
  }
  return out;
}

const cache = new Map();
/**
 * Reads a component (cached). Falls back to the ideal SDF when the CCD file cannot be read; both failing is an error. An aborted request is never
 * replaced by the fallback (the SDF has no atom names and caching it would break every later match by name).
 */
export async function loadChemComp(comp, { fetchText, signal } = {}) {
  if (!COMPONENT_ID.test(comp ?? '')) throw new ChemicalComponentError('化学组件编号无效');
  const id = comp.toUpperCase();
  if (cache.has(id)) return cache.get(id);
  let template;
  try {
    template = parseChemComp(await fetchText(`https://files.rcsb.org/ligands/view/${id}.cif`, { signal }), id);
  } catch (error) {
    if (error?.name === 'AbortError' || signal?.aborted) throw error;
    try { template = parseIdealSdf(await fetchText(`https://files.rcsb.org/ligands/view/${id}_ideal.sdf`, { signal }), id); }
    catch (fallback) { if (fallback?.name === 'AbortError' || signal?.aborted) throw fallback; throw new ChemicalComponentError(`无法读取化学组件 ${id}：${fallback.message}`); }
  }
  cache.set(id, template);
  return template;
}
export const clearChemCompCache = () => cache.clear();
