import { superposeFit, rotateVector } from './alignment.mjs';
import { selectionSpace, evaluateSelection } from './selection.mjs';
import { selectCoordinateAtoms } from './representation.mjs';
import { complexFromStructure, validateComplex } from '../../packages/schema/complex.mjs';

/**
 * Putting structures from different entries into one frame by superposing what they share (docs/PLUGIN_ROADMAP.md, C1). A new component (a factor, a ligand, another subunit) that was solved
 * together with a subunit the base also contains is carried over by fitting that shared subunit onto the base's copy; the transform it gets is recorded with the evidence for it (what was fitted,
 * how well, how many residues) and a report of steric clashes with the base. Nothing here claims the combination exists in nature: the evidence type is "derived", and the fit's quality is on the record.
 */
const ONE = { ALA: 'A', ARG: 'R', ASN: 'N', ASP: 'D', CYS: 'C', GLN: 'Q', GLU: 'E', GLY: 'G', HIS: 'H', ILE: 'I', LEU: 'L', LYS: 'K', MET: 'M', PHE: 'F', PRO: 'P', SER: 'S', THR: 'T', TRP: 'W', TYR: 'Y', VAL: 'V', A: 'A', C: 'C', G: 'G', U: 'U', DA: 'A', DC: 'C', DG: 'G', DT: 'T' };
export class AssemblyError extends Error { constructor(message) { super(message); this.name = 'AssemblyError'; } }

const residuesOf = (model, selection) => evaluateSelection(selection, selectionSpace(model)).residues.slice().sort((a, b) => (a.asym < b.asym ? -1 : a.asym > b.asym ? 1 : a.authSeq - b.authSeq || a.labelSeq - b.labelSeq));
const code = (residue) => ONE[residue.resn] ?? 'X';

/** Residue pairs with the same author number, insertion code and residue name (the numbering of one entry's own chain seen in another). */
export function matchByNumber(base, added) {
  const key = (r) => `${r.authSeq}|${r.insertion}|${r.resn}`, index = new Map(base.map((r) => [key(r), r]));
  return added.flatMap((r) => (index.has(key(r)) ? [[index.get(key(r)), r]] : []));
}

/** Residue pairs from a global alignment (Needleman-Wunsch: match +2, mismatch -1, gap -2) of the two one-letter sequences; only identical aligned residues are kept (they are the ones to fit). */
export function matchBySequence(base, added, { maxLength = 4000 } = {}) {
  if (base.length > maxLength || added.length > maxLength) throw new AssemblyError(`序列太长（超过 ${maxLength} 个残基），无法做序列比对；请改用 number 模式或缩小选择。`);
  const n = base.length, m = added.length, W = m + 1, score = new Int32Array((n + 1) * W), back = new Uint8Array((n + 1) * W);   // 0 diagonal, 1 up (gap in added), 2 left
  for (let i = 1; i <= n; i++) { score[i * W] = -2 * i; back[i * W] = 1; }
  for (let j = 1; j <= m; j++) { score[j] = -2 * j; back[j] = 2; }
  for (let i = 1; i <= n; i++) for (let j = 1; j <= m; j++) {
    const diagonal = score[(i - 1) * W + j - 1] + (code(base[i - 1]) === code(added[j - 1]) && code(base[i - 1]) !== 'X' ? 2 : -1), up = score[(i - 1) * W + j] - 2, left = score[i * W + j - 1] - 2;
    const best = Math.max(diagonal, up, left); score[i * W + j] = best; back[i * W + j] = best === diagonal ? 0 : best === up ? 1 : 2;
  }
  const pairs = []; let i = n, j = m;
  while (i > 0 || j > 0) {
    const move = back[i * W + j];
    if (i > 0 && j > 0 && move === 0) { if (code(base[i - 1]) === code(added[j - 1]) && code(base[i - 1]) !== 'X') pairs.push([base[i - 1], added[j - 1]]); i--; j--; } else if (i > 0 && (move === 1 || j === 0)) i--; else j--;
  }
  return pairs.reverse();
}

const rms = (a, b) => Math.sqrt(a.reduce((s, p, k) => s + (p[0] - b[k][0]) ** 2 + (p[1] - b[k][1]) ** 2 + (p[2] - b[k][2]) ** 2, 0) / a.length);
const compose = (fit) => { const R = (p) => rotateVector(p, fit.quaternion), origin = R(fit.cb); return { position: fit.ca.map((v, k) => v - origin[k]), rotation: fit.quaternion, scale: [1, 1, 1] }; };

/**
 * Fits `added` onto `base` over the residues both selections name. Returns { transform: { position, rotation, scale } (a point of the added entry's frame goes to rotation * p + position in the
 * base's), rmsd, matched, identity (matched / the shorter selection), mode }. Throws AssemblyError when there is too little to fit on or the fit is poor.
 */
export function fitOnto({ base, added, baseSelection, addSelection, mode = 'number', maxRmsd = 4, minMatched = 10 }) {
  const a = residuesOf(base, baseSelection), b = residuesOf(added, addSelection);
  if (!a.length) throw new AssemblyError(`基座里“${baseSelection}”没有选中任何残基。`);
  if (!b.length) throw new AssemblyError(`新增结构里“${addSelection}”没有选中任何残基。`);
  const pairs = mode === 'sequence' ? matchBySequence(a, b) : mode === 'number' ? matchByNumber(a, b) : (() => { throw new AssemblyError(`匹配方式应为 number 或 sequence，不是 ${mode}。`); })();
  if (pairs.length < minMatched) throw new AssemblyError(`只匹配到 ${pairs.length} 对残基（至少需要 ${minMatched} 对）：两个选择可能不是同一个亚基，或编号不一致（可以试 sequence 模式）。`);
  const target = pairs.map(([x]) => x.position), source = pairs.map(([, y]) => y.position), fit = superposeFit(target, source);
  const moved = source.map((p) => rotateVector(p.map((v, k) => v - fit.cb[k]), fit.quaternion).map((v, k) => v + fit.ca[k])), rmsd = rms(target, moved);
  if (rmsd > maxRmsd) throw new AssemblyError(`叠合的 RMSD 是 ${rmsd.toFixed(2)} Å，超过上限 ${maxRmsd} Å（${pairs.length} 对残基）：这两个选择的构象差别太大，不适合用来摆放。`);
  return { transform: compose(fit), rmsd, matched: pairs.length, identity: pairs.length / Math.min(a.length, b.length), mode };
}

/**
 * Steric clashes between some atoms of `added` (the chains in `carry`, after the transform) and every atom of `base`: pairs of heavy atoms closer than `threshold` Å.
 * Returns { count, minDistance, examples: [{ distance, added, base }] } (at most `maxExamples`).
 */
export function findClashes({ base, added, carry, transform, threshold = 2.0, maxExamples = 5 }) {
  const heavy = (model, keep) => selectCoordinateAtoms(model).map(({ atom }) => atom).filter((atom) => !['H', 'D'].includes(atom.element) && keep(atom));
  const baseAtoms = heavy(base, () => true), moving = heavy(added, (atom) => carry.includes(atom.labelChainId)), cell = threshold, key = (p) => p.map((x) => Math.floor(x / cell)).join(',');
  const grid = new Map(); for (const atom of baseAtoms) { const k = key(atom.position); (grid.get(k) ?? grid.set(k, []).get(k)).push(atom); }
  let count = 0, minDistance = Infinity; const examples = [];
  for (const atom of moving) {
    const p = rotateVector(atom.position, transform.rotation).map((v, k) => v + transform.position[k]), [cx, cy, cz] = p.map((x) => Math.floor(x / cell));
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) for (const other of grid.get(`${cx + dx},${cy + dy},${cz + dz}`) ?? []) {
      const d = Math.hypot(p[0] - other.position[0], p[1] - other.position[1], p[2] - other.position[2]);
      if (d < threshold) { count++; if (d < minDistance) minDistance = d; if (examples.length < maxExamples) examples.push({ distance: d, added: `${atom.labelChainId}:${atom.authSeqId} ${atom.residueName} ${atom.name}`, base: `${other.labelChainId}:${other.authSeqId} ${other.residueName} ${other.name}` }); }
    }
  }
  return { count, minDistance: Number.isFinite(minDistance) ? minDistance : null, examples };
}

/**
 * The assembly as a complex record (packages/schema/complex.mjs): the base entry as it is (identity placements, experimental evidence) plus, for each addition, the carried chains placed by the
 * fit with a derived-evidence entry that records what was fitted and how well. Returns { complex, reports: [{ name, fit, clashes }] }.
 *   base       { model, resource }
 *   additions  [{ model, resource, baseSelection, addSelection, carry: [label chain ids], mode?, name?, threshold? }]
 */
export function composeAssembly({ id, title, base, additions, citation }) {
  const complex = complexFromStructure({ model: base.model, resource: base.resource, id, title, citation }), reports = [];
  for (const [n, add] of additions.entries()) {
    if (!add.carry?.length) throw new AssemblyError('每个新增结构都要说明带过来哪些链（carry）。');
    const names = add.carry.map((chain) => add.model.chainNames?.[chain] ?? `chain ${chain}`), fit = fitOnto({ base: base.model, added: add.model, baseSelection: add.baseSelection, addSelection: add.addSelection, mode: add.mode, maxRmsd: add.maxRmsd });
    const clashes = findClashes({ base: base.model, added: add.model, carry: add.carry, transform: fit.transform, threshold: add.threshold });
    complex.evidence.push({ type: 'derived', resource: add.resource, citation: `把 ${add.resource.id} 的“${add.addSelection}”叠合到 ${base.resource.id} 的“${add.baseSelection}”（${fit.mode} 匹配，${fit.matched} 对残基，RMSD ${fit.rmsd.toFixed(2)} Å）；新增部分的位置由此推导，不是同一个条目里测得的。` });
    const evidence = complex.evidence.length - 1, name = add.name ?? names.join(' + '), used = new Set(complex.members.map(({ id: memberId }) => memberId));
    let memberId = `addition-${n + 1}`; while (used.has(memberId)) memberId += '-x';
    complex.members.push({ id: memberId, name, resource: add.resource, copies: 1, placements: [{ chains: add.carry.slice(), transform: fit.transform, evidence }] });
    reports.push({ name, fit, clashes });
  }
  return { complex: validateComplex(complex), reports };
}
