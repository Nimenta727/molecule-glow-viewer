const SITE_RADIUS = 8;
const CELL_SIZE = 7;

function cell(point, size) {
  return point.map((value) => Math.floor(value / size));
}

export function matchesPart(name, selector) {
  if (typeof name !== 'string' || typeof selector !== 'string' || !selector) return false;
  name = name.toLowerCase();
  if (selector === '/./') return Boolean(name);
  if (!selector.startsWith('/')) return name.includes(selector.toLowerCase());
  if (!selector.endsWith('/')) return false;
  let pattern = selector.slice(1, -1).toLowerCase();
  const start = pattern.startsWith('^'), end = pattern.endsWith('$');
  pattern = pattern.slice(start ? 1 : 0, end ? -1 : undefined);
  if (!pattern || /[.*+?^$|()[\]{}\\]/.test(pattern)) return false;
  if (start && end) return name === pattern;
  if (start) return name.startsWith(pattern);
  if (end) return name.endsWith(pattern);
  return name.includes(pattern);
}

export function createLigandNeighborhood(ligands, radius = SITE_RADIUS) {
  if (!ligands.length) return () => false;
  const cells = new Map();
  for (const point of ligands) {
    const key = cell(point, radius).join(',');
    if (!cells.has(key)) cells.set(key, []);
    cells.get(key).push(point);
  }
  return (point) => {
    const [x, y, z] = cell(point, radius);
    for (let i = x - 1; i <= x + 1; i++) {
      for (let j = y - 1; j <= y + 1; j++) {
        for (let k = z - 1; k <= z + 1; k++) {
          for (const [px, py, pz] of cells.get(`${i},${j},${k}`) ?? []) {
            if ((point[0] - px) ** 2 + (point[1] - py) ** 2 + (point[2] - pz) ** 2 <= radius ** 2) return true;
          }
        }
      }
    }
    return false;
  };
}

export function createPresetCore(markers, model, config) {
  const nameFor = (atom) => {
    const name = Object.hasOwn(model.chainNames ?? {}, atom.labelChainId)
      ? model.chainNames[atom.labelChainId] : `Chain ${atom.authChainId || atom.labelChainId}`;
    const grouped = Array.isArray(config.groupParts) && config.groupParts.find((group) => Array.isArray(group) &&
      group.slice(1).some((selector) => matchesPart(name, selector)));
    return typeof grouped?.[0] === 'string' ? grouped[0] : name;
  };
  const seq = (atom) => Number(atom.labelSeqId || atom.authSeqId || NaN);
  const groups = new Map();
  for (const { atom, pos } of markers) {
    const name = nameFor(atom);
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push({ atom, pos });
  }
  const sites = [];
  for (const rule of config.core ?? []) {
    if (rule?.part && Array.isArray(rule.seqs)) {
      const ranges = rule.seqs.filter((range) => Array.isArray(range) && range.length === 2 && range.every(Number.isFinite));
      sites.push((_, atom, name) => matchesPart(name, rule.part) && ranges.some(([a, b]) => seq(atom) >= a && seq(atom) <= b));
    }
    if (rule?.near && Number.isFinite(rule.r) && rule.r > 0) {
      const anchor = [...groups.keys()].find((name) => matchesPart(name, rule.near.part));
      if (!anchor) continue;
      const points = groups.get(anchor).filter(({ atom }) => seq(atom) === rule.near.seq).map(({ pos }) => pos);
      const neighborhood = createLigandNeighborhood(points, rule.r);
      sites.push((point, _, name) => (name === anchor || (Array.isArray(rule.with) &&
        rule.with.some((selector) => matchesPart(name, selector)))) && neighborhood(point));
    }
  }
  return (point, atom, name = nameFor(atom)) => sites.some((site) => site(point, atom, name));
}

export function functionalLayers(markers, isCore, toPresentation, scale, color) {
  const regions = new Map();
  const core = [];
  for (const { raw, residue, nucleotide } of markers) {
    if (isCore(raw, residue.atom)) {
      core.push(...toPresentation(raw));
      continue;
    }
    const key = cell(raw, CELL_SIZE).join(',');
    const volume = nucleotide ? 320 : 136;
    const region = regions.get(key) ?? { moment: [0, 0, 0], volume: 0 };
    region.volume += volume;
    for (let axis = 0; axis < 3; axis++) region.moment[axis] += raw[axis] * volume;
    regions.set(key, region);
  }
  const layers = [];
  if (regions.size) {
    const positions = [], radii = [];
    for (const { moment, volume } of regions.values()) {
      positions.push(...toPresentation(moment.map((value) => value / volume)));
      radii.push(Math.cbrt(3 * volume / (4 * Math.PI)) * scale);
    }
    layers.push({ mode: 'spheres', positions, radii, color, role: 'functional-scaffold' });
  }
  if (core.length) layers.push({ mode: 'spheres', positions: core, radius: scale * 2.1, color: '#d07446', role: 'functional-core' });
  return layers;
}
