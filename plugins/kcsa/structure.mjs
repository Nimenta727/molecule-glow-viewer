import { centroid, superpose } from '../structure/alignment.mjs';
import { selectCoordinateAtoms, PRESENTATION_METERS_PER_ANGSTROM as SCALE } from '../structure/representation.mjs';
import { normalizeKcsaConfig, numeral } from './config.mjs';
import { sub, dot, normalize, distance } from '../motion/vectors.mjs';
import { displaceVertices, hypotSquared } from '../motion/conformation.mjs';
export const key = (atom) => JSON.stringify([atom.authChainId, atom.labelChainId, atom.assemblyCopy]);
const residue = (atom) => String(atom.authSeqId || atom.labelSeqId);
const permutations = (list) => list.length <= 1 ? [list] : list.flatMap((value, i) => permutations(list.filter((_, j) => i !== j)).map((rest) => [value, ...rest]));
function chains(model, cfg) {
  const result = new Map(), pattern = new RegExp(cfg.protein.namePattern, 'i');
  for (const { atom } of selectCoordinateAtoms(model)) {
    if (atom.name !== 'CA' || !pattern.test(model.chainNames?.[atom.labelChainId] ?? '')) continue;
    const id = key(atom);
    if (!result.has(id)) result.set(id, []);
    result.get(id).push(atom);
  }
  if (result.size !== cfg.protein.chains) throw new Error(`KcsA 需要${numeral(cfg.protein.chains)}条通道链，当前为 ${result.size}。`);
  return result;
}

/** `config` is the work configuration (see config.mjs); omitted = the built-in KcsA/1K4C template. */
export function fitState(reference, state, config) {
  const cfg = normalizeKcsaConfig(config), { fitRange: [lo, hi], minPairs, maxFitRmsd } = cfg.pore;
  const ref = chains(reference, cfg), other = chains(state, cfg), pairs = [...other.values()].map((atoms) => new Map(atoms.map((a) => [residue(a), a.position])));
  let best;
  for (const order of permutations(Array.from({ length: cfg.protein.chains }, (_, i) => i))) {
    const X = [], Y = [];
    [...ref.values()].forEach((atoms, i) => {
      for (const a of atoms) if (Number(residue(a)) >= lo && Number(residue(a)) <= hi && pairs[order[i]].has(residue(a))) {
        X.push(a.position); Y.push(pairs[order[i]].get(residue(a)));
      }
    });
    if (X.length < minPairs) continue;
    const fit = superpose(X, Y), rmsd = Math.sqrt(X.reduce((s, p, i) => s + distance(p, fit(Y[i])) ** 2, 0) / X.length);
    if (!best || rmsd < best.rmsd) best = { fit, rmsd, order };
  }
  if (!best || best.rmsd > maxFitRmsd) throw new Error(`KcsA 孔区叠合失败或 RMSD 超过 ${maxFitRmsd} Å。`);
  const coordinates = new Map([...ref.keys()].map((id, i) => [id, new Map([...pairs[best.order[i]]].map(([n, p]) => [n, best.fit(p)]))]));
  return { ...best, coordinates, atoms: selectCoordinateAtoms(state).map(({ atom }) => ({ ...atom, position: best.fit(atom.position) })) };
}

// Renderer-neutral port of the classic clearance-weighted Dijkstra search.
export function findPorePath(points, start, axis, direction) {
  const h = 1.5, n = 54, N = n ** 3, origin = start.map((v) => v - n * h / 2), cell = 8, hash = new Map();
  for (const p of points) { const id = p.map((v) => Math.floor(v / cell)).join(','); if (!hash.has(id)) hash.set(id, []); hash.get(id).push(p); }
  const coordinate = (c) => [Math.floor(c / n ** 2), Math.floor(c / n) % n, c % n].map((v, i) => origin[i] + v * h);
  const clearance = new Float32Array(N).fill(-1);
  function clear(c, p) {
    if (clearance[c] >= 0) return clearance[c];
    const bin = p.map((v) => Math.floor(v / cell)); let best = 256;
    for (let x = -2; x <= 2; x++) for (let y = -2; y <= 2; y++) for (let z = -2; z <= 2; z++) {
      for (const q of hash.get([bin[0] + x, bin[1] + y, bin[2] + z].join(',')) ?? []) best = Math.min(best, sub(p, q).reduce((s, v) => s + v * v, 0));
    }
    return clearance[c] = Math.sqrt(best);
  }
  const dist = new Float64Array(N).fill(Infinity), prev = new Int32Array(N).fill(-1), heap = [];
  const push = (entry) => { heap.push(entry); let i = heap.length - 1; while (i) { const p = (i - 1) >>> 1; if (heap[p][0] <= entry[0]) break; heap[i] = heap[p]; i = p; } heap[i] = entry; };
  const pop = () => { const first = heap[0], last = heap.pop(); if (heap.length) { let i = 0; while (2 * i + 1 < heap.length) { let j = 2 * i + 1; if (j + 1 < heap.length && heap[j + 1][0] < heap[j][0]) j++; if (heap[j][0] >= last[0]) break; heap[i] = heap[j]; i = j; } heap[i] = last; } return first; };
  const mid = n / 2, initial = (mid * n + mid) * n + mid;
  dist[initial] = 0; push([0, initial]); let goal = -1;
  const neighbors = [];
  for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) for (let z = -1; z <= 1; z++) if (x || y || z) neighbors.push([x, y, z, Math.hypot(x, y, z) * h]);
  while (heap.length) {
    const [d, c] = pop(); if (d > dist[c]) continue;
    const p = coordinate(c), axial = dot(sub(p, start), axis) * direction;
    if (clear(c, p) >= 12 && axial >= (direction < 0 ? 22 : 12)) { goal = c; break; }
    const ijk = [Math.floor(c / n ** 2), Math.floor(c / n) % n, c % n];
    for (const [x, y, z, length] of neighbors) {
      const k = [ijk[0] + x, ijk[1] + y, ijk[2] + z]; if (k.some((v) => v < 0 || v >= n)) continue;
      const next = (k[0] * n + k[1]) * n + k[2], q = coordinate(next);
      if (dot(sub(q, start), axis) * direction < -1) continue;
      const r = clear(next, q); if (r < (direction < 0 ? 2.5 : 2)) continue;
      const cost = d + length * (1 + (12 / Math.max(r, 0.5)) ** 4);
      if (cost < dist[next]) { dist[next] = cost; prev[next] = c; push([cost, next]); }
    }
  }
  if (goal < 0) throw new Error('KcsA 开放态孔道搜索失败。');
  const path = []; for (let c = goal; c >= 0; c = prev[c]) path.push(coordinate(c));
  return path.reverse();
}

/** `config` is the work configuration (see config.mjs); omitted = the built-in KcsA/1K4C template. */
export function buildKcsaStructure(model, states, config) {
  const cfg = normalizeKcsaConfig(config), roles = cfg.states, { filterResidues: [lowResidue, highResidue], ion } = cfg.pore;
  const own = chains(model, cfg), atoms = selectCoordinateAtoms(model).map(({ atom }) => atom);
  for (const id of Object.values(roles)) if (!states.get(id)) throw new Error(`KcsA 缺少构象结构 ${id}。`);
  const closed = states.get(roles.primary);
  const fits = Object.fromEntries([roles.open, roles.inactivated, roles.tba, roles.barium].map((id) => [id, fitState(model, states.get(id), cfg)]));
  const polymer = [...own.values()].flat(), at = (n) => centroid(polymer.filter((a) => Number(residue(a)) === n).map((a) => a.position));
  const axis = normalize(sub(at(highResidue), at(lowResidue))), center = centroid(polymer.map((a) => a.position));
  const project = (p) => dot(sub(p, center), axis);
  const along = (d) => center.map((v, i) => v + axis[i] * d);
  const ions = [];
  for (const { atom } of selectCoordinateAtoms(closed)) if (atom.element === ion.element && !ions.some((p) => distance(p, atom.position) < 1) && distance(atom.position, along(project(atom.position))) < 3) ions.push(atom.position);
  const filter = ions.filter((p) => project(p) >= project(at(lowResidue)) - 2.5 && project(p) <= project(at(highResidue)) + 2.5).sort((a, b) => project(b) - project(a));
  if (filter.length < 4) throw new Error(`${roles.primary} 结构中未找到四个过滤器 ${ion.label} 位点。`);
  const sites = Object.fromEntries(filter.slice(0, 4).map((p, i) => [`S${i + 1}`, p]));
  sites.S0 = sites.S1.map((v, i) => v + axis[i] * 3.4);
  sites.cav = ions.find((p) => project(p) < project(sites.S4) - 4 && project(p) > project(sites.S4) - 12);
  if (!sites.cav) throw new Error(`${roles.primary} 结构中未找到中央腔 ${ion.label}。`);
  const open = [...fits[roles.open].coordinates.values()].flatMap((map) => [...map.values()]);
  const inside = findPorePath(open, sites.cav, axis, -1).reverse(), outside = findPorePath(open, sites.S0, axis, 1);
  const paths = { inside, outside };
  const min = [0, 1, 2].map((i) => Math.min(...atoms.map((a) => a.position[i]))), max = [0, 1, 2].map((i) => Math.max(...atoms.map((a) => a.position[i])));
  const origin = min.map((v, i) => (v + max[i]) / 2), point = (p) => p.map((v, i) => (v - origin[i]) * SCALE);
  function ligand(id, name) {
    const all = fits[id].atoms.filter((a) => a.residueName === name);
    const first = all.sort((a, b) => distance(a.position, sites.cav) - distance(b.position, sites.cav))[0];
    if (!first) throw new Error(`${id} 缺少 ${name} 阻断剂坐标。`);
    const group = all.filter((a) => key(a) === key(first) && a.authSeqId === first.authSeqId);
    const center = centroid(group.map((a) => a.position));
    return { position: point(center), molecule: group.map((a) => ({ element: a.element, position: sub(a.position, center).map((v) => v * SCALE) })) };
  }
  const blockers = { TBA: ligand(roles.tba, cfg.blockers.tba.residue), Ba: ligand(roles.barium, cfg.blockers.barium.residue) };
  function decorate(layers, nodes) {
    for (const node of nodes) {
      const refs = [...own.values()].find((list) => {
        const meta = node.extensions['org.glow.structure'];
        return meta.chainId === (list[0].authChainId || list[0].labelChainId) &&
          meta.chainKey === `chain:${encodeURIComponent(`${list[0].authChainId ?? ''}|${list[0].labelChainId ?? ''}${list[0].assemblyCopy ? `\u0000${list[0].assemblyCopy}` : ''}`)}`;
      });
      if (!refs) continue;
      const alternatives = [new Map(refs.map((a) => [residue(a), a.position])), fits[roles.open].coordinates.get(key(refs[0])), fits[roles.inactivated].coordinates.get(key(refs[0]))];
      const anchors = refs.map((atom) => ({ ref: atom, at: point(atom.position), from: atom.position }));
      const resolvers = alternatives.map((map) => (anchor) => map.get(residue(anchor.ref)) ?? anchor.from);
      for (const layer of layers.get(node.assetId) ?? []) {
        layer.conformations = displaceVertices(layer.positions, anchors, resolvers, { scale: SCALE, squaredDistance: hypotSquared });
      }
    }
    return layers;
  }
  return { point, sites, paths, blockers, axis, center: point(center), fits, decorate };
}
