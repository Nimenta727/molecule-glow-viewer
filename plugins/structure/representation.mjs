import { createLigandNeighborhood, createPresetCore, functionalLayers, matchesPart } from './functional-preview.mjs';
import { densitySurface } from './density-surface.mjs';
import { bondsByDistance } from './chemical-component.mjs';

export const PRESENTATION_METERS_PER_ANGSTROM = 0.05;
const WATER_NAMES = new Set(['HOH', 'WAT', 'DOD', 'H2O']);
const BACKBONE_COLORS = { default: '#607f91', helix: '#d47770', sheet: '#d6a94f' };
const BLOB_COLORS = ['#7697c6', '#cf8589', '#79aaa3', '#c8a367', '#9b8ab4'];
const CARTOON_WIDTH = 0.45;
const MODIFIED_RESIDUES = new Set(['MSE', 'SEP', 'TPO', 'PTR']);
const surfaceCache = new WeakMap();

function text(value) {
  return value == null ? '' : String(value).trim();
}

function atomPosition(atom) {
  const p = atom.position;
  const xyz = Array.isArray(p) ? p : [p?.x, p?.y, p?.z];
  if (xyz.length < 3 || !xyz.slice(0, 3).every(Number.isFinite)) return null;
  return [xyz[0], xyz[1], xyz[2]];
}

function firstModel(atoms) {
  if (!atoms.length) return [];
  const id = atoms[0].modelId;
  return atoms.filter((atom) => atom.modelId === id);
}

export function chainKey(atom) {
  const key = `${text(atom.authChainId)}\u0000${text(atom.labelChainId)}`;
  return atom.assemblyCopy ? `${key}\u0000${atom.assemblyCopy}` : key;
}

function residueKey(atom) {
  return [chainKey(atom), text(atom.authSeqId), text(atom.labelSeqId), text(atom.insertionCode), text(atom.residueName).toUpperCase()].join('\u0001');
}

function altRank(atom) {
  const alt = text(atom.altLoc);
  return alt === '' ? [0, ''] : alt.toUpperCase() === 'A' ? [1, 'A'] : [2, alt.toUpperCase()];
}

function compareAlternative(a, b) {
  const [rankA, labelA] = altRank(a), [rankB, labelB] = altRank(b);
  if (rankA !== rankB) return rankA - rankB;
  const order = labelA.localeCompare(labelB);
  if (order) return order;
  const serialA = Number(a.serial), serialB = Number(b.serial);
  if (Number.isFinite(serialA) && Number.isFinite(serialB) && serialA !== serialB) return serialA - serialB;
  return 0;
}

function chooseAlternatives(atoms) {
  const chosen = new Map();
  for (const atom of atoms) {
    const pos = atomPosition(atom);
    if (!pos) continue;
    const name = text(atom.name || atom.authAtomId || atom.labelAtomId).toUpperCase();
    const key = `${residueKey(atom)}\u0001${name}`;
    const previous = chosen.get(key);
    if (!previous || compareAlternative(atom, previous) < 0) chosen.set(key, { atom, pos, name, key });
  }
  return [...chosen.values()];
}

export function selectCoordinateAtoms(model) {
  const atoms = firstModel(Array.isArray(model?.atoms) ? model.atoms : []);
  return chooseAlternatives(atoms.filter((atom) => !isWater(atom)));
}

function sequenceNumber(value) {
  const valueText = text(value);
  if (!valueText) return Number.POSITIVE_INFINITY;
  const match = valueText.match(/^[+-]?\d+/);
  return match ? Number(match[0]) : Number.POSITIVE_INFINITY;
}

function firstSequenceNumber(atom) {
  return sequenceNumber(text(atom.authSeqId) ? atom.authSeqId : atom.labelSeqId);
}

function compareResidues(a, b) {
  return firstSequenceNumber(a.atom) - firstSequenceNumber(b.atom)
    || text(a.atom.insertionCode).localeCompare(text(b.atom.insertionCode))
    || a.order - b.order;
}

function residueGap(a, b) {
  const seqA = firstSequenceNumber(a.atom), seqB = firstSequenceNumber(b.atom);
  if (!Number.isFinite(seqA) || !Number.isFinite(seqB)) return true;
  return seqB - seqA <= 1;
}

function isWater(atom) {
  return WATER_NAMES.has(text(atom.residueName).toUpperCase());
}

export function isPolymer(atom, format) {
  return atom.record === 'ATOM' || (format === 'mmcif' && Boolean(atom.labelSeqId)) || MODIFIED_RESIDUES.has(atom.residueName);
}

/** The key a chain group carries in the representation and in the scene's node metadata (`chainKey`). */
export const chainGroupKey = (atom) => `chain:${encodeURIComponent(chainKey(atom).replace('\u0000', '|'))}`;

function chainFor(atom, key) {
  return {
    key: `chain:${encodeURIComponent(key.replace('\u0000', '|'))}`,
    chainId: text(atom.authChainId) || text(atom.labelChainId),
    authChainId: text(atom.authChainId),
    labelChainId: text(atom.labelChainId),
    assemblyCopy: atom.assemblyCopy,
    atoms: [],
  };
}

function mappedResidueId(atom, numbering) {
  return numbering === 'label' ? atom.labelSeqId : atom.authSeqId;
}

export function rangeTypeFor(atom, ranges) {
  for (const range of ranges) {
    const rangeChain = text(range.chainId);
    const chain = text(range.numbering === 'label'
      ? (atom.labelChainId || atom.authChainId)
      : (atom.authChainId || atom.labelChainId));
    const seq = sequenceNumber(mappedResidueId(atom, range.numbering));
    const from = sequenceNumber(range.from), to = sequenceNumber(range.to);
    if (rangeChain !== chain || !Number.isFinite(seq) || !Number.isFinite(from) || !Number.isFinite(to)) continue;
    if (seq >= Math.min(from, to) && seq <= Math.max(from, to)) return range.type;
  }
  return 'default';
}

export function centerAndScale(items) {
  if (!items.length) return { center: [0, 0, 0], point: () => [0, 0, 0] };
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const { pos } of items) for (let axis = 0; axis < 3; axis++) {
    min[axis] = Math.min(min[axis], pos[axis]);
    max[axis] = Math.max(max[axis], pos[axis]);
  }
  const center = min.map((value, axis) => (value + max[axis]) / 2);
  return {
    center,
    point: (pos) => pos.map((value, axis) => (value - center[axis]) * PRESENTATION_METERS_PER_ANGSTROM),
  };
}

function flat(points) {
  return points.flatMap((point) => point);
}

function linePositions(markers, centered) {
  const points = [];
  for (let i = 1; i < markers.length; i++) {
    const previous = markers[i - 1], current = markers[i];
    const distance = Math.hypot(...current.raw.map((v, axis) => v - previous.raw[axis]));
    if (!residueGap(previous.residue, current.residue) || distance > 10) continue;
    points.push(centered.point(previous.raw), centered.point(current.raw));
  }
  return flat(points);
}

/**
 * Per-residue appearance, for the authoring tools: `look.styleOf(atom)` is the style one residue is drawn in ('cartoon' | 'backbone' | 'blob' | 'hidden'; undefined = the style of the whole build) and
 * `look.colorOf(atom)` its colour (undefined = the default of the layer). A segment between two residues takes the look of the later one and is drawn only when neither end is hidden.
 * Layers that carry a residue colour are marked `pinned`, so a chain-wide colour (the `color` command) does not paint over them.
 */
function segmentLook(a, b, look, defaultStyle) {
  const styleA = look.styleOf?.(a.residue.atom) ?? defaultStyle, styleB = look.styleOf?.(b.residue.atom) ?? defaultStyle;
  if (styleA === 'hidden' || styleB === 'hidden') return null;
  return { style: styleB === 'sticks' ? 'cartoon' : styleB, color: look.colorOf?.(b.residue.atom) ?? look.colorOf?.(a.residue.atom) };
}

function normalize(v) {
  const length = Math.hypot(v[0], v[1], v[2]);
  return length > 1e-9 ? v.map((x) => x / length) : [0, 0, 1];
}

function subtract(a, b) { return a.map((v, axis) => v - b[axis]); }
function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }

function ribbonSide(markers, index) {
  const before = markers[Math.max(index - 1, 0)].raw;
  const after = markers[Math.min(index + 1, markers.length - 1)].raw;
  const tangent = normalize(subtract(after, before));
  let side = cross(tangent, [0, 1, 0]);
  if (Math.hypot(...side) < 1e-8) side = cross(tangent, [0, 0, 1]);
  return normalize(side).map((value) => value * CARTOON_WIDTH);
}

function cartoonLayers(markers, ranges, centered, look = {}, defaultStyle = 'cartoon') {
  const byType = new Map([['default', []], ['helix', []], ['sheet', []]]);
  for (let i = 1; i < markers.length; i++) {
    const a = markers[i - 1], b = markers[i];
    const distance = Math.hypot(...b.raw.map((v, axis) => v - a.raw[axis]));
    if (!residueGap(a.residue, b.residue) || distance > 10) continue;
    const seen = segmentLook(a, b, look, defaultStyle);
    if (!seen || seen.style !== 'cartoon') continue;
    const typeA = rangeTypeFor(a.residue.atom, ranges);
    const typeB = rangeTypeFor(b.residue.atom, ranges);
    const type = seen.color ? `#${seen.color}` : typeA === typeB ? typeA : 'default';
    if (!byType.has(type)) byType.set(type, []);
    const sideA = ribbonSide(markers, i - 1), sideB = ribbonSide(markers, i);
    const aLeft = a.raw.map((v, axis) => v + sideA[axis]);
    const aRight = a.raw.map((v, axis) => v - sideA[axis]);
    const bLeft = b.raw.map((v, axis) => v + sideB[axis]);
    const bRight = b.raw.map((v, axis) => v - sideB[axis]);
    byType.get(type).push(
      centered.point(aLeft), centered.point(aRight), centered.point(bLeft),
      centered.point(bLeft), centered.point(aRight), centered.point(bRight),
    );
  }
  return [...byType].filter(([, vertices]) => vertices.length).map(([type, vertices]) => (type.startsWith('#')
    ? { mode: 'triangles', positions: flat(vertices), color: type.slice(1), pinned: true }
    : { mode: 'triangles', positions: flat(vertices), color: BACKBONE_COLORS[type] }));
}

/** Backbone lines split by per-residue look: one `lines` layer per colour. */
function backboneLayers(markers, centered, look = {}, defaultStyle = 'backbone') {
  const byColor = new Map();
  for (let i = 1; i < markers.length; i++) {
    const a = markers[i - 1], b = markers[i];
    const distance = Math.hypot(...b.raw.map((v, axis) => v - a.raw[axis]));
    if (!residueGap(a.residue, b.residue) || distance > 10) continue;
    const seen = segmentLook(a, b, look, defaultStyle);
    if (!seen || seen.style !== 'backbone') continue;
    const key = seen.color ?? '';
    if (!byColor.has(key)) byColor.set(key, []);
    byColor.get(key).push(centered.point(a.raw), centered.point(b.raw));
  }
  return [...byColor].map(([color, points]) => (color ? { mode: 'lines', positions: flat(points), color, pinned: true } : { mode: 'lines', positions: flat(points), color: BACKBONE_COLORS.default }));
}

const ELEMENT_TINT = { N: '4e79d6', O: 'e05a4a', S: 'e0b83a', P: 'e58a3a' };
/**
 * Atom-level sticks for the residues the author set to 'sticks' (drawn on top of the cartoon): every heavy atom of the residue, bonds by covalent distance, plus the peptide bond to the next residue.
 * One `lines` layer per colour (carbon takes the residue's colour; N, O, S, P their usual tints). Hydrogens are left out. The number of residues is limited by the look rules (MAX_STICK_RESIDUES).
 */
function stickLayers(ordered, model, centered, look, defaultStyle) {
  const byColor = new Map(), add = (color, a, b) => { if (!byColor.has(color)) byColor.set(color, []); byColor.get(color).push(centered.point(a), centered.point(b)); };
  const heavy = (residue) => residue.atoms.filter(({ atom }) => !['H', 'D'].includes(text(atom.element).toUpperCase()));
  const tint = (item, base) => ELEMENT_TINT[text(item.atom.element).toUpperCase()] ?? base;
  const draw = (items, base, bonds) => { for (const [i, j] of bonds) { const a = items[i], b = items[j], mid = a.pos.map((v, k) => (v + b.pos[k]) / 2); add(tint(a, base), a.pos, mid); add(tint(b, base), mid, b.pos); } };
  let previous = null;
  for (const residue of ordered) {
    const sticks = look.styleOf?.(residue.atom) === 'sticks' && isPolymer(residue.atom, model.format);
    const items = sticks ? heavy(residue) : null;
    if (items?.length) {
      const base = look.colorOf?.(residue.atom) ?? '9aa7b4';
      draw(items, base, bondsByDistance(items.map(({ atom, pos }) => ({ element: text(atom.element).toUpperCase(), position: pos }))));
      const pc = previous?.items.find((item) => item.name === 'C'), nn = items.find((item) => item.name === 'N');
      if (pc && nn && residueGap(previous.residue, residue) && Math.hypot(...pc.pos.map((v, k) => v - nn.pos[k])) < 1.8) draw([pc, nn], base, [[0, 1]]);
    }
    previous = items?.length ? { residue, items } : null;
  }
  return [...byColor].map(([color, points]) => ({ mode: 'lines', positions: flat(points), color, pinned: true, role: 'sticks' }));
}

/**
 * Build passive, renderer-neutral backbone or illustrative ribbon data.
 * Coordinates are centered on the selected first model's bounding box and scaled at 0.05 presentation meters per Å.
 * Blank alternate locations win; otherwise altLoc A wins, then the alphabetically first ID. No occupancy-based science is inferred.
 * Cartoon colors are only visual hints for deposited helix and sheet ranges (red and gold); they are not calculated predictions.
 */
export function buildRepresentations(model, { style = 'backbone', functionalRules, look = {} } = {}) {
  if (!['backbone', 'cartoon', 'blob', 'functional', 'surface'].includes(style)) throw new TypeError(`Unsupported representation style: ${style}`);
  const chosen = selectCoordinateAtoms(model);
  const centered = centerAndScale(chosen);
  const residueLevel = style === 'cartoon' || style === 'backbone' || style === 'blob';   // surface and functional keep the look of the whole chain
  const appearance = residueLevel ? look : {};
  const coreLigands = Array.isArray(functionalRules?.coreLigands) ? new Set(functionalRules.coreLigands) : null;
  const nearLigand = style === 'functional' ? createLigandNeighborhood(chosen
    .filter(({ atom }) => atom.record === 'HETATM' && !isPolymer(atom, model.format) && !['H', 'D'].includes(atom.element) &&
      (!coreLigands || coreLigands.has(atom.residueName)))
    .map(({ pos }) => pos)) : null;
  const presetCore = style === 'functional' && Array.isArray(functionalRules?.core) && functionalRules.core.length
    ? createPresetCore(chosen.filter(({ name, atom }) => (name === 'CA' || name === 'P') && isPolymer(atom, model.format)), model, functionalRules)
    : null;
  const groups = new Map();
  for (const item of chosen) {
    const key = chainKey(item.atom);
    let group = groups.get(key);
    if (!group) { group = chainFor(item.atom, key); groups.set(key, group); }
    group.atoms.push(item);
  }

  const ranges = Array.isArray(model?.secondaryStructure) ? model.secondaryStructure : [];
  return [...groups.values()].map((group, groupIndex) => {
    const residues = new Map();
    for (let order = 0; order < group.atoms.length; order++) {
      const item = group.atoms[order];
      const key = residueKey(item.atom);
      if (!residues.has(key)) residues.set(key, { atom: item.atom, atoms: [], order });
      residues.get(key).atoms.push(item);
    }
    const ordered = [...residues.values()].sort(compareResidues);
    const markers = [];
    for (const residue of ordered) {
      const polymer = residue.atoms.filter(({ atom }) => isPolymer(atom, model.format));
      const atom = polymer.find((item) => item.name === 'CA' && item.atom.element !== 'CA') ??
        polymer.find((item) => item.name === 'P');
      if (atom) markers.push({ raw: atom.pos, residue, nucleotide: atom.name === 'P' });
    }
    const layers = [];
    // every residue-level style can show every other for the residues the author gave one (a blob for a ligand pocket inside a cartoon)
    const hasLook = residueLevel && (look.styleOf || look.colorOf);
    const drawn = (wanted) => (hasLook ? true : style === wanted);
    if (drawn('cartoon')) layers.push(...cartoonLayers(markers, ranges, centered, appearance, style));
    if (drawn('backbone')) {
      if (hasLook) layers.push(...backboneLayers(markers, centered, appearance, style));
      else { const positions = linePositions(markers, centered); if (positions.length) layers.push({ mode: 'lines', positions, color: BACKBONE_COLORS.default }); }
    }
    if (hasLook && look.styleOf) layers.push(...stickLayers(ordered, model, centered, appearance, style));
    if (drawn('blob') && markers.length) {
      const base = BLOB_COLORS[groupIndex % BLOB_COLORS.length], radius = 2.1 * PRESENTATION_METERS_PER_ANGSTROM;
      if (!hasLook) layers.push({ mode: 'spheres', positions: flat(markers.map(({ raw }) => centered.point(raw))), color: base, radius });
      else {
        const byColor = new Map();
        for (const marker of markers) {
          if ((appearance.styleOf?.(marker.residue.atom) ?? style) !== 'blob') continue;
          const color = appearance.colorOf?.(marker.residue.atom) ?? '';
          if (!byColor.has(color)) byColor.set(color, []);
          byColor.get(color).push(centered.point(marker.raw));
        }
        for (const [color, points] of byColor) layers.push(color ? { mode: 'spheres', positions: flat(points), color, radius, pinned: true } : { mode: 'spheres', positions: flat(points), color: base, radius });
      }
    }
    if ((nearLigand || style === 'surface') && markers.length >= 3) {
      let surfaces = surfaceCache.get(model);
      if (!surfaces) { surfaces = new Map(); surfaceCache.set(model, surfaces); }
      if (!surfaces.has(group.key)) {
        const positions = densitySurface(markers.map(({ raw }) => raw), markers.map(({ nucleotide }) => nucleotide ? 2.4 : 1));
        const scaled = [];
        for (let i = 0; i < positions.length; i += 3) scaled.push(...centered.point(positions.slice(i, i + 3)));
        surfaces.set(group.key, scaled);
      }
      const positions = surfaces.get(group.key);
      if (positions.length) layers.push({ mode: 'triangles', positions,
        color: BLOB_COLORS[groupIndex % BLOB_COLORS.length], ink: true, role: 'density-surface' });
    }
    if (nearLigand) {
      const functional = functionalLayers(markers, (raw, atom) => nearLigand(raw) || presetCore?.(raw, atom), centered.point,
        PRESENTATION_METERS_PER_ANGSTROM, BLOB_COLORS[groupIndex % BLOB_COLORS.length]);
      layers.push(...functional.filter(({ role }) => markers.length < 3 || role === 'functional-core'));
      const partName = model.chainNames?.[group.labelChainId] ?? group.chainId;
      const moving = [...(Array.isArray(functionalRules?.spin) ? functionalRules.spin : []),
        ...(Array.isArray(functionalRules?.solid) ? functionalRules.solid : [])].some((key) => matchesPart(partName, key));
      if (groups.size > 2 && !moving && !functional.some(({ role }) => role === 'functional-core')) {
        for (const layer of layers) if (layer.role === 'density-surface') layer.faded = true;
      }
    }
    const shown = hasLook ? markers.filter(({ residue }) => (appearance.styleOf?.(residue.atom) ?? style) !== 'hidden') : markers;
    if (shown.length) layers.push({ mode: 'points', positions: flat(shown.map(({ raw }) => centered.point(raw))), color: '#395968', pointSize: 0.05 });
    const pointTargets = layers.map((layer) =>
      layer.mode === 'points' ? shown.map(({ residue }) => ({ kind: 'residue', atom: residue.atom })) : null);

    const ligands = new Map();
    for (const item of group.atoms) {
      if (item.atom.record !== 'HETATM' || isPolymer(item.atom, model.format)) continue;
      const element = text(item.atom.element).toUpperCase();
      if (element === 'H' || element === 'D') continue;
      const key = residueKey(item.atom);
      if (!ligands.has(key)) ligands.set(key, { atom: item.atom, positions: [] });
      ligands.get(key).positions.push(item.pos);
    }
    const ligandCenters = [...ligands.values()].map(({ positions }) => positions[0].map((_, axis) => positions.reduce((sum, point) => sum + point[axis], 0) / positions.length));
    if (ligandCenters.length) {
      layers.push({ mode: 'points', positions: flat(ligandCenters.map(centered.point)), color: '#e58a3a', pointSize: 0.14 });
      pointTargets.push([...ligands.values()].map(({ atom }) => ({ kind: 'ligand', atom })));
    }

    const chainId = group.authChainId || group.labelChainId;
    return {
      key: group.key,
      label: (chainId ? `Chain ${chainId}` : 'Unassigned chain') + (group.assemblyCopy ? ` · ${group.assemblyCopy}` : ''),
      chainId,
      labelChainId: group.labelChainId,
      layers,
      pointTargets,
    };
  }).filter(({ layers }) => layers.length);
}

export function findLigandContacts(model, ligand) {
  const key = residueKey(ligand);
  const heavy = chooseAlternatives(firstModel(model.atoms).filter((atom) =>
    !isWater(atom) && !['H', 'D'].includes(text(atom.element).toUpperCase())));
  const radius = 4;
  const cell = (xyz) => xyz.map((value) => Math.floor(value / radius));
  const cells = new Map();
  for (const { atom, pos } of heavy) {
    if (isPolymer(atom, model.format) || residueKey(atom) !== key) continue;
    const address = cell(pos).join(',');
    if (!cells.has(address)) cells.set(address, []);
    cells.get(address).push(pos);
  }
  const contacts = new Map();
  for (const { atom, pos } of heavy) {
    if (!isPolymer(atom, model.format)) continue;
    const [x, y, z] = cell(pos);
    let closest = Infinity;
    for (let i = x - 1; i <= x + 1; i++) {
      for (let j = y - 1; j <= y + 1; j++) {
        for (let k = z - 1; k <= z + 1; k++) {
          for (const neighbor of cells.get(`${i},${j},${k}`) ?? []) {
            const [nx, ny, nz] = neighbor;
            closest = Math.min(closest, Math.hypot(pos[0] - nx, pos[1] - ny, pos[2] - nz));
          }
        }
      }
    }
    if (closest > radius) continue;
    const residue = residueKey(atom);
    if (closest < (contacts.get(residue)?.distance ?? Infinity)) {
      contacts.set(residue, { atom, distance: closest });
    }
  }
  return [...contacts.values()].sort((a, b) => a.distance - b.distance);
}

/**
 * Return original atom records matching both supplied filters. `chainId` matches either authChainId or labelChainId.
 * `residueId` may be a scalar matching either authSeqId or labelSeqId, or a mapping object with authSeqId,
 * labelSeqId and/or insertionCode; all mapping fields present must match. Unset filters match all atoms in the first model.
 * The returned array is new but its atom objects are the original read-only model records.
 */
export function selectStructure(model, { chainId, residueId } = {}) {
  const atoms = firstModel(Array.isArray(model?.atoms) ? model.atoms : []);
  return atoms.filter((atom) => {
    if (chainId != null && text(chainId) !== text(atom.authChainId) && text(chainId) !== text(atom.labelChainId)) return false;
    if (residueId == null) return true;
    if (typeof residueId !== 'object') return text(residueId) === text(atom.authSeqId) || text(residueId) === text(atom.labelSeqId);
    const fields = ['authSeqId', 'labelSeqId', 'insertionCode'].filter((field) => Object.hasOwn(residueId, field));
    return fields.length > 0 && fields.every((field) => text(residueId[field]) === text(atom[field]));
  });
}
