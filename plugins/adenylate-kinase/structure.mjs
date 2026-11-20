import { centroid, superpose } from '../structure/alignment.mjs';
import { selectCoordinateAtoms, PRESENTATION_METERS_PER_ANGSTROM as SCALE } from '../structure/representation.mjs';
import { densitySurface } from '../structure/density-surface.mjs';
import { ADK_4AKE_TEMPLATE, normalizeAdkConfig } from './config.mjs';
import { sub, distance, lerp } from '../motion/vectors.mjs';
import { displaceVertices, nearestAnchors, hypotSquared, rotationAngle } from '../motion/conformation.mjs';

export const DOMAINS = ADK_4AKE_TEMPLATE.domains;   // kept for callers; the data lives in config.mjs
const number = (a) => Number(a.authSeqId || a.labelSeqId);
const inDomain = (a, domain) => domain.ranges.some(([lo, hi]) => number(a) >= lo && number(a) <= hi);
const key = (a) => JSON.stringify([a.authSeqId, a.labelSeqId, a.insertionCode]);
export { rotationAngle };   // kept for callers; the function now lives in the shared motion module
/** `config` is the work configuration (see config.mjs); omitted = the built-in 4AKE/1AKE template. */
export function buildAdkStructure(model, closedModel, config) {
  const cfg = normalizeAdkConfig(config), { protein, domains: DOMAINS } = cfg;
  const namePattern = new RegExp(protein.namePattern, 'i');
  function caAtoms(source) {
    const atoms = selectCoordinateAtoms(source).map(({ atom }) => atom).filter((a) => a.name === 'CA' && a.element === 'C');
    if (!atoms.length || protein.residues !== null && atoms.length !== protein.residues || atoms.some((a) => a.authChainId !== protein.chain) ||
        !namePattern.test(source.chainNames?.[atoms[0]?.labelChainId] ?? '')) {
      throw new Error(`此 AdK 播放器需要${protein.organism} ${protein.chain} 链的 ${protein.residues ?? '若干'} 个 Cα 残基。`);
    }
    return atoms;
  }
  const atoms = selectCoordinateAtoms(model).map(({ atom }) => atom), open = caAtoms(model);
  const closedAtoms = selectCoordinateAtoms(closedModel).map(({ atom }) => atom);
  const closedCa = caAtoms({ ...closedModel, atoms: closedModel.atoms.filter((a) => a.authChainId === protein.chain) });
  const fitDomain = DOMAINS.find(({ name }) => name === cfg.fitDomain), moving = DOMAINS.filter(({ name }) => name !== cfg.fitDomain);
  const other = new Map(closedCa.map((a) => [key(a), a.position]));
  if (open.some((a) => !other.has(key(a)))) throw new Error('AdK 两态残基编号未完整匹配。');
  const core = open.filter((a) => inDomain(a, fitDomain));
  const fit = superpose(core.map((a) => a.position), core.map((a) => other.get(key(a))));
  const rmsd = Math.sqrt(core.reduce((sum, a) => sum + distance(a.position, fit(other.get(key(a)))) ** 2, 0) / core.length);
  if (rmsd > cfg.maxFitRmsd) throw new Error(`AdK ${cfg.fitDomain} 叠合 RMSD 超过 ${cfg.maxFitRmsd} Å。`);
  const targets = new Map(open.map((a) => [key(a), fit(other.get(key(a)))]));
  const min = [0, 1, 2].map((i) => Math.min(...atoms.map((a) => a.position[i]))), max = [0, 1, 2].map((i) => Math.max(...atoms.map((a) => a.position[i])));
  const origin = min.map((v, i) => (v + max[i]) / 2);
  const point = (p) => p.map((v, i) => (v - origin[i]) * SCALE);
  const ap5 = closedAtoms.filter((a) => a.residueName === cfg.ligand.residue && a.authChainId === cfg.ligand.chain && !['H', 'D'].includes(a.element));
  if (!ap5.length || ap5.length > 64) throw new Error(`${cfg.states.closed} 未找到可完整显示的 ${cfg.ligand.chain} 链 ${cfg.ligand.name} 坐标。`);
  const ligandCenter = centroid(ap5.map((a) => fit(a.position)));
  const inhibitor = { name: cfg.ligand.name, color: cfg.ligand.color, position: point(ligandCenter),
    molecule: ap5.map((a) => ({ element: a.element, position: sub(fit(a.position), ligandCenter).map((v) => v * SCALE) })) };
  function measurements(fraction) {
    const reference = core.map((a) => a.position), current = core.map((a) => lerp(a.position, targets.get(key(a)), fraction));
    const coreFit = superpose(reference, current);
    return moving.map((domain) => {
      const refs = open.filter((a) => inDomain(a, domain)), A = refs.map((a) => a.position);
      const B = refs.map((a) => coreFit(lerp(a.position, targets.get(key(a)), fraction)));
      return { name: domain.name, angle: rotationAngle(superpose(A, B)), shift: distance(centroid(A), centroid(B)) };
    });
  }
  const density = new Map();
  function domainSurfaces() {
    if (!density.size) for (const domain of DOMAINS) {
      const refs = open.filter((a) => inDomain(a, domain));
      const positions = densitySurface(refs.map((a) => a.position), refs.map(() => 1));
      const center = centroid(refs.map((a) => a.position));
      // Classic functional lobes shrink 1.5 Å toward their own center to expose domain seams.
      const triangles = [];
      for (let i = 0; i < positions.length; i += 3) {
        const p = positions.slice(i, i + 3), delta = sub(p, center), length = Math.hypot(...delta);
        triangles.push(...point(p.map((v, j) => v - delta[j] * Math.min(1, 1.5 / (length || 1)))));
      }
      density.set(domain.name, { mode: 'triangles', positions: triangles,
        color: domain.color, ink: true, role: 'density-surface', adkDomain: domain.name });
    }
    return [...density.values()].map((layer) => ({ ...layer }));
  }
  const anchorCache = new Map();
  const anchorsFor = (name) => {
    if (!anchorCache.has(name)) {
      const refs = name ? open.filter((a) => inDomain(a, DOMAINS.find((d) => d.name === name))) : open;
      anchorCache.set(name, refs.map((atom) => ({ ref: atom, at: point(atom.position), from: atom.position })));
    }
    return anchorCache.get(name);
  };
  const nearest = (vertex, name) => nearestAnchors(vertex, anchorsFor(name), 4, hypotSquared);
  function split(layer) {
    if (layer.adkDomain || layer.role === 'functional-core') return [layer];
    const stride = layer.mode === 'triangles' ? 9 : layer.mode === 'lines' ? 6 : 3;
    const result = new Map();
    for (let i = 0; i < layer.positions.length; i += stride) {
      const vertices = Array.from({ length: stride / 3 }, (_, j) => layer.positions.slice(i + j * 3, i + j * 3 + 3));
      const atom = nearest(centroid(vertices))[0].anchor.ref, domain = DOMAINS.find((d) => inDomain(atom, d));
      if (!result.has(domain.name)) result.set(domain.name, { ...layer, color: domain.color, positions: [], adkDomain: domain.name,
        ...(layer.radii ? { radii: [] } : {}), ...(layer.pointTargets ? { pointTargets: [] } : {}) });
      const group = result.get(domain.name); group.positions.push(...vertices.flat());
      if (group.radii) group.radii.push(layer.radii[i / 3]);
      if (group.pointTargets) group.pointTargets.push(layer.pointTargets[i / 3]);
    }
    return [...result.values()];
  }
  function decorate(layers, nodes) {
    for (const node of nodes) {
      const original = layers.get(node.assetId); if (!original) continue;
      const functional = original.some((layer) => layer.representationStyle === 'functional');
      const base = functional ? [...domainSurfaces(), ...original.filter((layer) => layer.mode === 'points' || layer.role === 'functional-core')] : original;
      const output = base.flatMap(split);
      for (const layer of output) {
        const [end] = displaceVertices(layer.positions, anchorsFor(layer.adkDomain), [(anchor) => targets.get(key(anchor.ref))],
          { scale: SCALE, squaredDistance: hypotSquared });
        layer.conformations = [layer.positions, end];
      }
      layers.set(node.assetId, output);
    }
    return layers;
  }
  return { rmsd, matched: open.length, measurements, inhibitor, decorate, closedCoordinates: targets };
}
