import { selectCoordinateAtoms, isPolymer } from './representation.mjs';

/**
 * The selection language: a small expression grammar over residues and ligands, as in the classic viewer
 * (src/derived/selection-language.js), evaluated on the parsed structure model of the new platform.
 *
 *   all | none | protein | nucleic | ligands | sele      sele = the previous selection
 *   chain A[,B]  asym C_2  label_asym A  resn HIS[,CYS]  ligand HEM[,ATP]  entity "part of a name"
 *   resi 10-50,60  resi -3  resi 52A (exactly that insertion)  resi 52A-60      author numbering
 *   label_seq 10-50                                        label (sequence) numbering
 *   within 5 of <selection>                                 residues / ligands near, not in, the selection
 *   and / or / not and parentheses
 *
 * A residue is one entry per polymer residue (its C-alpha, or P for nucleotides); a ligand is one HETATM molecule that is not
 * water or unknown. The result is the *whole* matching set, in model order.
 */
export const SELECTION_HELP = 'all | none | protein | nucleic | ligands | sele（上一次的选择）| chain A[,B] | resi 10-50[,60] | resn HIS[,CYS] | entity "名字的一部分" | ligand HEM[,ATP] | within 5 of <选择>；用 and / or / not 组合，括号可嵌套';

export class SelectionError extends Error {
  constructor(message) { super(message); this.name = 'SelectionError'; }
}

const IGNORED_LIGANDS = new Set(['HOH', 'WAT', 'DOD', 'UNX', 'UNL']);

function tokens(source) {
  const result = [], pattern = /\s*(?:"([^"]*)"|'([^']*)'|(\(|\))|([^\s()]+))/y;
  const text = String(source ?? '').trim();
  let match;
  while (pattern.lastIndex < text.length && (match = pattern.exec(text))) {
    result.push(match[1] != null || match[2] != null ? { v: match[1] ?? match[2], q: true } : { v: match[3] ?? match[4], q: false });
  }
  return result;
}

export function parseSelection(source) {
  const T = tokens(source);
  let i = 0;
  const keyword = (word) => T[i] && !T[i].q && T[i].v.toLowerCase() === word;
  const next = (what) => {
    if (i >= T.length) throw new SelectionError(`选择表达式不完整：缺少${what}（${SELECTION_HELP}）`);
    return T[i++].v;
  };
  const list = (what) => next(what).split(',').map((item) => item.trim()).filter(Boolean);
  const orExpression = () => { let node = andExpression(); while (keyword('or')) { i++; node = { op: 'or', a: node, b: andExpression() }; } return node; };
  const andExpression = () => { let node = notExpression(); while (keyword('and')) { i++; node = { op: 'and', a: node, b: notExpression() }; } return node; };
  const notExpression = () => { if (keyword('not')) { i++; return { op: 'not', a: notExpression() }; } return atom(); };
  function atom() {
    if (keyword('(')) {
      i++;
      const node = orExpression();
      if (!keyword(')')) throw new SelectionError('选择表达式缺少 )');
      i++;
      return node;
    }
    const token = next('选择'), word = token.toLowerCase();
    if (['all', 'none', 'protein', 'nucleic', 'ligands', 'sele'].includes(word)) return { op: word };
    if (word === 'chain') return { op: 'chain', v: list('链名') };
    if (word === 'label_asym') return { op: 'label_asym', v: list('label_asym_id') };
    if (word === 'asym') return { op: 'asym', v: list('asym（含拷贝号，如 C_2）') };
    if (word === 'label_seq') {
      return { op: 'label_seq', v: list('label_seq_id').map((item) => {
        const m = /^(\d+)(?:-(\d+))?$/.exec(item);
        if (!m) throw new SelectionError(`label_seq 写成 10-50：${item}`);
        return [+m[1], m[2] != null ? +m[2] : +m[1]];
      }) };
    }
    if (word === 'resn') return { op: 'resn', v: list('残基名').map((item) => item.toUpperCase()) };
    if (word === 'ligand') return { op: 'ligand', v: list('小分子代码').map((item) => item.toUpperCase()) };
    if (word === 'entity') return { op: 'entity', v: next('实体名').toLowerCase() };
    if (word === 'resi' || word === 'resid') {
      // author numbers: 10-50, 0, -3, 52A (an insertion code: exactly that residue), 52A-60
      return { op: 'resi', v: list('残基编号').map((item) => {
        const m = /^(-?\d+)([A-Za-z]?)(?:-(-?\d+)([A-Za-z]?))?$/.exec(item);
        if (!m) throw new SelectionError(`resi 写成 10-50、0、52A 或 10,12,20-30：${item}`);
        return { u: +m[1], ui: m[2].toUpperCase(), v: m[3] != null ? +m[3] : +m[1], vi: m[3] != null ? m[4].toUpperCase() : m[2].toUpperCase(), range: m[3] != null };
      }) };
    }
    if (word === 'within') {
      const d = +next('距离');
      if (!(d > 0 && d <= 30)) throw new SelectionError('within 的距离应在 0–30 Å');
      if (!keyword('of')) throw new SelectionError('写成 within 5 of <选择>');
      i++;
      return { op: 'within', d, a: notExpression() };
    }
    throw new SelectionError(`不认识的选择关键字 “${token}”（${SELECTION_HELP}）`);
  }
  const node = orExpression();
  if (i < T.length) throw new SelectionError(`选择表达式多出了 “${T[i].v}”`);
  return node;
}

const spaces = new WeakMap();

/** The residues and ligands of a model that the language talks about (built once per model). */
export function selectionSpace(model) {
  if (spaces.has(model)) return spaces.get(model);
  const residues = [], ligandMap = new Map();
  const names = model.chainNames ?? {};
  for (const { atom } of selectCoordinateAtoms(model)) {
    const asym = atom.assemblyCopy ? `${atom.labelChainId}_${atom.assemblyCopy}` : atom.labelChainId;
    const authSeq = Number.parseInt(atom.authSeqId, 10), labelSeq = Number.parseInt(atom.labelSeqId, 10);
    const polymer = isPolymer(atom, model.format);
    if (atom.record === 'ATOM' ? (atom.name === 'CA' && atom.element !== 'CA') || atom.name === 'P' : polymer && atom.name === 'CA' && atom.element === 'C') {
      residues.push({
        atom, position: atom.position, chain: atom.authChainId || atom.labelChainId, asym, labelAsym: atom.labelChainId,
        authSeq: Number.isFinite(authSeq) ? authSeq : (Number.isFinite(labelSeq) ? labelSeq : 0), labelSeq: Number.isFinite(labelSeq) ? labelSeq : 0,
        insertion: (atom.insertionCode || '').toUpperCase(), resn: String(atom.residueName ?? '').toUpperCase(), nucleic: atom.name === 'P',
        entity: String(names[atom.labelChainId] ?? '').toLowerCase(),
      });
    } else if (atom.record === 'HETATM' && !polymer && !IGNORED_LIGANDS.has(String(atom.residueName).toUpperCase()) && !['H', 'D'].includes(atom.element)) {
      const key = `${asym}|${atom.residueName}|${atom.authSeqId}`;
      if (!ligandMap.has(key)) ligandMap.set(key, { atom, comp: String(atom.residueName).toUpperCase(), asym, labelAsym: atom.labelChainId, chain: atom.authChainId || atom.labelChainId, atoms: [] });
      ligandMap.get(key).atoms.push({ position: atom.position, element: atom.element, name: atom.name });
    }
  }
  const space = Object.freeze({ residues, ligands: [...ligandMap.values()] });
  spaces.set(model, space);
  return space;
}

const inResidueRange = (residue, r) => {
  if (!r.range) return residue.authSeq === r.u && residue.insertion === r.ui;
  // a range 50-55 includes 52A, 52B ...; 52A-60 starts at that insertion
  return (residue.authSeq > r.u || (residue.authSeq === r.u && residue.insertion >= r.ui)) &&
    (residue.authSeq < r.v || (residue.authSeq === r.v && (!r.vi || residue.insertion <= r.vi)));
};

/**
 * Evaluates a parsed (or textual) selection on a space. `previous` is the earlier result ({ residues, ligands } arrays of the same
 * space) that `sele` refers to. Returns { residues, ligands } in space order.
 */
export function evaluateSelection(expression, space, { previous } = {}) {
  const node = typeof expression === 'string' ? parseSelection(expression) : expression;
  const R = space.residues, L = space.ligands;
  const pick = (items, test) => new Set(items.filter(test));
  const evaluate = (n) => {
    switch (n.op) {
      case 'all': return { r: new Set(R), l: new Set(L) };
      case 'none': return { r: new Set(), l: new Set() };
      case 'protein': return { r: pick(R, (a) => !a.nucleic), l: new Set() };
      case 'nucleic': return { r: pick(R, (a) => a.nucleic), l: new Set() };
      case 'ligands': return { r: new Set(), l: new Set(L) };
      case 'sele': return { r: new Set((previous?.residues ?? []).filter((a) => R.includes(a))), l: new Set((previous?.ligands ?? []).filter((x) => L.includes(x))) };
      case 'chain': return { r: pick(R, (a) => n.v.includes(a.chain)), l: pick(L, (x) => n.v.includes(x.chain)) };
      case 'asym': return { r: pick(R, (a) => n.v.includes(a.asym)), l: pick(L, (x) => n.v.includes(x.asym)) };
      case 'label_asym': return { r: pick(R, (a) => n.v.includes(a.labelAsym)), l: pick(L, (x) => n.v.includes(x.labelAsym)) };
      case 'label_seq': return { r: pick(R, (a) => n.v.some(([u, v]) => a.labelSeq >= u && a.labelSeq <= v)), l: new Set() };
      case 'resn': return { r: pick(R, (a) => n.v.includes(a.resn)), l: new Set() };
      case 'resi': return { r: pick(R, (a) => n.v.some((r) => inResidueRange(a, r))), l: new Set() };
      case 'entity': return { r: pick(R, (a) => a.entity.includes(n.v)), l: new Set() };
      case 'ligand': return { r: new Set(), l: pick(L, (x) => n.v.includes(x.comp)) };
      case 'and': { const a = evaluate(n.a), b = evaluate(n.b); return { r: new Set([...a.r].filter((x) => b.r.has(x))), l: new Set([...a.l].filter((x) => b.l.has(x))) }; }
      case 'or': { const a = evaluate(n.a), b = evaluate(n.b); return { r: new Set([...a.r, ...b.r]), l: new Set([...a.l, ...b.l]) }; }
      case 'not': { const a = evaluate(n.a); return { r: pick(R, (x) => !a.r.has(x)), l: pick(L, (x) => !a.l.has(x)) }; }
      case 'within': {
        // spatial hash of the target points (residue C-alpha / P and every ligand atom), cell size = distance
        const target = evaluate(n.a), d = n.d, d2 = d * d, hash = new Map(), points = [];
        const cell = (p) => `${Math.floor(p[0] / d)},${Math.floor(p[1] / d)},${Math.floor(p[2] / d)}`;
        for (const a of target.r) points.push(a.position);
        for (const x of target.l) for (const y of x.atoms) points.push(y.position);
        if (!points.length) return { r: new Set(), l: new Set() };
        for (const p of points) { const key = cell(p); if (!hash.has(key)) hash.set(key, []); hash.get(key).push(p); }
        const near = (p) => {
          const cx = Math.floor(p[0] / d), cy = Math.floor(p[1] / d), cz = Math.floor(p[2] / d);
          for (let x = cx - 1; x <= cx + 1; x++) for (let y = cy - 1; y <= cy + 1; y++) for (let z = cz - 1; z <= cz + 1; z++) {
            for (const q of hash.get(`${x},${y},${z}`) ?? []) if ((p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 + (p[2] - q[2]) ** 2 <= d2) return true;
          }
          return false;
        };
        return { r: pick(R, (a) => !target.r.has(a) && near(a.position)), l: pick(L, (x) => !target.l.has(x) && x.atoms.some((y) => near(y.position))) };
      }
      default: throw new SelectionError('选择表达式无效');
    }
  };
  const result = evaluate(node);
  return { residues: R.filter((a) => result.r.has(a)), ligands: L.filter((x) => result.l.has(x)) };
}

/** One line about a result, e.g. "41 个残基（2 条链）、1 个小分子". */
export function describeSelection({ residues, ligands }) {
  if (!residues.length && !ligands.length) return '没有选中任何对象';
  const chains = new Set(residues.map((a) => a.chain));
  return [residues.length ? `${residues.length} 个残基（${chains.size} 条链）` : '', ligands.length ? `${ligands.length} 个小分子` : ''].filter(Boolean).join('、');
}
