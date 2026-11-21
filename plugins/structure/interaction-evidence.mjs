import { rotateVector } from './alignment.mjs';
import { selectCoordinateAtoms } from './representation.mjs';

/**
 * Who touches whom, and how well that is known (docs/PLUGIN_ROADMAP.md, D1). For two sets of chains it finds the interface (heavy-atom pairs closer than a cutoff, and the residues on each side), and for
 * the members of a complex record (packages/schema/complex.mjs) it lists every interacting pair with an EVIDENCE LEVEL taken from where the two placements come from, so that a contact between two chains
 * that sit together in one deposited entry is not drawn the same way as one between a structure and another entry's factor that was only fitted next to it.
 *
 * Levels, strongest first: experimental (both placements are the deposited coordinates of one entry), derived (at least one was put there by fitting another entry), predicted (a predicted structure is
 * involved), modelled, illustrative. A pair is only as well known as its weaker side. A contact is a geometric fact about the coordinates as placed; it says nothing about affinity.
 */
export const EVIDENCE_LEVELS = Object.freeze(['experimental', 'derived', 'predicted', 'modelled', 'illustrative']);
const rank = (level) => EVIDENCE_LEVELS.indexOf(level);

const heavyAtoms = (model, chains) => selectCoordinateAtoms(model).map(({ atom }) => atom).filter((atom) => chains.includes(atom.labelChainId) && !['H', 'D'].includes(atom.element));
const place = (position, transform) => (transform ? rotateVector(position, transform.rotation).map((v, k) => v + transform.position[k]) : position);
const residueKey = (atom) => `${atom.labelChainId}:${atom.authSeqId}${atom.insertionCode || ''} ${atom.residueName}`;

/**
 * The interface between chains `chainsA` of `modelA` and chains `chainsB` of `modelB` (each placed by its transform, if given): { contacts (atom pairs within the cutoff), minDistance, residuesA, residuesB }.
 * Residues are named "chain:number name"; the lists are sorted and without repeats.
 */
export function interfaceBetween({ modelA, chainsA, transformA, modelB, chainsB, transformB, cutoff = 4.5 }) {
  const a = heavyAtoms(modelA, chainsA).map((atom) => ({ atom, p: place(atom.position, transformA) })), b = heavyAtoms(modelB, chainsB).map((atom) => ({ atom, p: place(atom.position, transformB) }));
  const cell = cutoff, grid = new Map(), key = (p) => p.map((v) => Math.floor(v / cell)).join(',');
  for (const item of b) { const k = key(item.p); (grid.get(k) ?? grid.set(k, []).get(k)).push(item); }
  let contacts = 0, minDistance = Infinity; const ra = new Set(), rb = new Set();
  for (const item of a) {
    const [cx, cy, cz] = item.p.map((v) => Math.floor(v / cell));
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) for (const other of grid.get(`${cx + dx},${cy + dy},${cz + dz}`) ?? []) {
      const d = Math.hypot(item.p[0] - other.p[0], item.p[1] - other.p[1], item.p[2] - other.p[2]);
      if (d <= cutoff) { contacts++; if (d < minDistance) minDistance = d; ra.add(residueKey(item.atom)); rb.add(residueKey(other.atom)); }
    }
  }
  return { contacts, minDistance: Number.isFinite(minDistance) ? minDistance : null, residuesA: [...ra].sort(), residuesB: [...rb].sort() };
}

/**
 * The evidence level of one pair of placements of a complex. `kinds` (optional) maps "resourceId@version" to a resource kind so that a predicted structure is recognised.
 * Returns { level, reasons: [text] }.
 */
export function pairEvidence(complex, placementA, placementB, { memberA, memberB, kinds = new Map() } = {}) {
  const ea = complex.evidence[placementA.evidence], eb = complex.evidence[placementB.evidence], reasons = [];
  let level = 'experimental';
  const lower = (candidate, reason) => { if (rank(candidate) > rank(level)) level = candidate; reasons.push(reason); };
  for (const [e, member] of [[ea, memberA], [eb, memberB]]) {
    if (e.type === 'derived') lower('derived', `“${member.name}”的位置是推导的：${e.citation}`);
    else if (e.type === 'modelled') lower('modelled', `“${member.name}”的位置来自建模：${e.citation}`);
    else if (e.type === 'illustrative') lower('illustrative', `“${member.name}”的位置只是示意：${e.citation}`);
    if (kinds.get(`${member.resource.id}@${member.resource.version}`) === 'predicted-structure') lower('predicted', `“${member.name}”来自预测结构（${member.resource.id}），不是实验测定的。`);
  }
  if (level === 'experimental') reasons.push('两边都是同一个条目里测得的坐标。');
  return { level, reasons };
}

/**
 * Every interacting pair of copies in a complex: [{ a: { member, name, copy, chains }, b: {...}, contacts, minDistance, residues: { a, b }, level, reasons }], strongest evidence first and, within a level,
 * most contacts first. `models` is a Map "resourceId@version" -> parsed structure; a member whose model is missing is reported in `missing`, not silently left out. A pair is listed when it has
 * at least `minContacts` atom pairs within the cutoff (default 10: a few incidental near atoms are not an interface).
 * Returns { interactions, missing, checked }.
 */
export function interactionsOfComplex({ complex, models, cutoff = 4.5, minContacts = 10, kinds = new Map(), maxPairs = 200000 }) {
  const copies = [], missing = new Set();
  for (const member of complex.members) {
    const model = models.get(`${member.resource.id}@${member.resource.version}`);
    if (!model) { missing.add(`${member.resource.id}@${member.resource.version}`); continue; }
    member.placements.forEach((placement, copy) => copies.push({ member, placement, copy, model }));
  }
  const interactions = []; let checked = 0;
  for (let i = 0; i < copies.length; i++) for (let j = i + 1; j < copies.length; j++) {
    if (++checked > maxPairs) throw new RangeError(`too many pairs to check (more than ${maxPairs}); narrow the complex`);
    const A = copies[i], B = copies[j], fa = A.placement.transform, fb = B.placement.transform;
    const quick = (t) => (t.position.every((v) => v === 0) && t.rotation[3] === 1 ? null : t);
    const iface = interfaceBetween({ modelA: A.model, chainsA: A.placement.chains, transformA: quick(fa), modelB: B.model, chainsB: B.placement.chains, transformB: quick(fb), cutoff });
    if (iface.contacts < minContacts) continue;
    const evidence = pairEvidence(complex, A.placement, B.placement, { memberA: A.member, memberB: B.member, kinds });
    interactions.push({ a: { member: A.member.id, name: A.member.name, copy: A.copy, chains: A.placement.chains }, b: { member: B.member.id, name: B.member.name, copy: B.copy, chains: B.placement.chains },
      contacts: iface.contacts, minDistance: iface.minDistance, residues: { a: iface.residuesA, b: iface.residuesB }, level: evidence.level, reasons: evidence.reasons });
  }
  interactions.sort((x, y) => rank(x.level) - rank(y.level) || y.contacts - x.contacts);
  return { interactions, missing: [...missing], checked };
}

/** How many partners each copy has: Map "member#copy" -> number of interacting copies (a quick look at the topology: a ring has two, a hexamer of alternating subunits has two of the other kind). */
export function degrees(interactions) {
  const out = new Map(), bump = (k) => out.set(k, (out.get(k) ?? 0) + 1);
  for (const { a, b } of interactions) { bump(`${a.member}#${a.copy}`); bump(`${b.member}#${b.copy}`); }
  return out;
}
