const SEL_HELP = 'all | none | protein | nucleic | ligands | sele（上一次的选择）| chain A[,B] | resi 10-50[,60] | resn HIS[,CYS] | entity "名字的一部分" | ligand HEM[,ATP] | within 5 of <选择>；用 and / or / not 和括号组合。残基按 Cα（核酸按 P）计；chain / resi 用作者编号（auth_asym_id / auth_seq_id，和论文、PDB 文件一致，可写插入码 52A，可以是 0 或负数）；label_asym A / label_seq 10-50 用 mmCIF 的 label 编号（label_asym 包括全部对称拷贝；asym C_2 只选第 2 个拷贝）。';
function selTokens(s) {
  const T = [], re = /\s*(?:"([^"]*)"|'([^']*)'|(\(|\))|([^\s()]+))/y; s = String(s ?? '').trim(); let m;
  while (re.lastIndex < s.length && (m = re.exec(s))) T.push(m[1] != null || m[2] != null ? { v: m[1] ?? m[2], q: true } : { v: m[3] ?? m[4], q: false });
  return T;
}
function parseSel(src) {
  const T = selTokens(src); let i = 0;
  const kw = (w) => T[i] && !T[i].q && T[i].v.toLowerCase() === w;
  const next = (what) => { if (i >= T.length) throw new CmdError(`选择表达式不完整：缺少${what}（${SEL_HELP}）`); return T[i++].v; };
  const list = (what) => next(what).split(',').map(x => x.trim()).filter(Boolean);
  const orE = () => { let n = andE(); while (kw('or')) { i++; n = { op: 'or', a: n, b: andE() }; } return n; };
  const andE = () => { let n = notE(); while (kw('and')) { i++; n = { op: 'and', a: n, b: notE() }; } return n; };
  const notE = () => { if (kw('not')) { i++; return { op: 'not', a: notE() }; } return atom(); };
  const atom = () => {
    if (kw('(')) { i++; const n = orE(); if (!kw(')')) throw new CmdError('选择表达式缺少 )'); i++; return n; }
    const t = next('选择'), w = t.toLowerCase();
    if (['all', 'none', 'protein', 'nucleic', 'ligands', 'sele'].includes(w)) return { op: w };
    if (w === 'chain') return { op: 'chain', v: list('链名') };
    if (w === 'label_asym') return { op: 'label_asym', v: list('label_asym_id') };
    if (w === 'asym') return { op: 'asym', v: list('asym（含拷贝号，如 C_2）') };
    if (w === 'label_seq') return { op: 'label_seq', v: list('label_seq_id').map(x => { const m = /^(\d+)(?:-(\d+))?$/.exec(x); if (!m) throw new CmdError('label_seq 写成 10-50：' + x); return [+m[1], m[2] != null ? +m[2] : +m[1]]; }) };
    if (w === 'resn') return { op: 'resn', v: list('残基名').map(x => x.toUpperCase()) };
    if (w === 'ligand') return { op: 'ligand', v: list('小分子代码').map(x => x.toUpperCase()) };
    if (w === 'entity') return { op: 'entity', v: next('实体名').toLowerCase() };
    if (w === 'resi') {
      /* author numbers: 10-50, 0, -3, 52A (insertion code: exactly that residue), 52A-60 */
      const v = list('残基编号').map(x => { const m = /^(-?\d+)([A-Za-z]?)(?:-(-?\d+)([A-Za-z]?))?$/.exec(x); if (!m) throw new CmdError('resi 写成 10-50、0、52A 或 10,12,20-30：' + x);
        return { u: +m[1], ui: m[2].toUpperCase(), v: m[3] != null ? +m[3] : +m[1], vi: m[3] != null ? m[4].toUpperCase() : m[2].toUpperCase(), range: m[3] != null }; });
      return { op: 'resi', v };
    }
    if (w === 'within') {
      const d = +next('距离'); if (!(d > 0 && d <= 30)) throw new CmdError('within 的距离应在 0–30 Å');
      if (!kw('of')) throw new CmdError('写成 within 5 of <选择>'); i++;
      return { op: 'within', d, a: notE() };
    }
    throw new CmdError(`不认识的选择关键字 “${t}”（${SEL_HELP}）`);
  };
  const n = orE(); if (i < T.length) throw new CmdError(`选择表达式多出了 “${T[i].v}”`); return n;
}
function evalSel(node) {
  const R = groups.flatMap(g => g.atoms), L = (model?.ligands || []).filter(x => !x.hidden);
  const num = (a) => { const k = parseInt(a.aseq); return Number.isFinite(k) ? k : a.seq; }, ch = (x) => x.ach || String(x.asym || '').split('_')[0];
  /* resi with insertion codes: 52A matches only 52A; a range 50-55 includes 52A, 52B ... */
  const inResi = (a, r) => { const k = num(a), ic = (a.ins || '').toUpperCase();
    if (!r.range) return k === r.u && ic === r.ui;
    return (k > r.u || (k === r.u && ic >= r.ui)) && (k < r.v || (k === r.v && (!r.vi || ic <= r.vi))); };
  const ev = (n) => {
    switch (n.op) {
      case 'all': return { r: new Set(R), l: new Set(L) };
      case 'none': return { r: new Set(), l: new Set() };
      case 'protein': return { r: new Set(R.filter(a => !a.na)), l: new Set() };
      case 'nucleic': return { r: new Set(R.filter(a => a.na)), l: new Set() };
      case 'ligands': return { r: new Set(), l: new Set(L) };
      case 'sele': return { r: new Set(glowSel.r), l: new Set(glowSel.l) };
      case 'chain': return { r: new Set(R.filter(a => n.v.includes(ch(a)))), l: new Set(L.filter(x => n.v.includes(ch(x)))) };
      case 'asym': return { r: new Set(R.filter(a => n.v.includes(String(a.asym)))), l: new Set(L.filter(x => n.v.includes(String(x.asym)))) };
      case 'label_asym': return { r: new Set(R.filter(a => n.v.includes(String(a.asym).split('_')[0]))), l: new Set(L.filter(x => n.v.includes(String(x.asym).split('_')[0]))) };
      case 'label_seq': return { r: new Set(R.filter(a => n.v.some(([u, v]) => a.seq >= u && a.seq <= v))), l: new Set() };
      case 'resn': return { r: new Set(R.filter(a => n.v.includes(String(a.resn || '').toUpperCase()))), l: new Set() };
      case 'resi': return { r: new Set(R.filter(a => n.v.some(r => inResi(a, r)))), l: new Set() };
      case 'entity': return { r: new Set(R.filter(a => String(a.entName || a.part || '').toLowerCase().includes(n.v) || String(a.part || '').toLowerCase().includes(n.v))), l: new Set() };
      case 'ligand': return { r: new Set(), l: new Set(L.filter(x => n.v.includes(String(x.comp).toUpperCase()))) };
      case 'and': { const a = ev(n.a), b = ev(n.b); return { r: new Set([...a.r].filter(x => b.r.has(x))), l: new Set([...a.l].filter(x => b.l.has(x))) }; }
      case 'or': { const a = ev(n.a), b = ev(n.b); return { r: new Set([...a.r, ...b.r]), l: new Set([...a.l, ...b.l]) }; }
      case 'not': { const a = ev(n.a); return { r: new Set(R.filter(x => !a.r.has(x))), l: new Set(L.filter(x => !a.l.has(x))) }; }
      case 'within': {   /* spatial hash of the target points (residue Cα / P and ligand atoms), cell = d */
        const t = ev(n.a), d = n.d, d2 = d * d, H = new Map(), key = (x, y, z) => x + ',' + y + ',' + z, P = [];
        for (const a of t.r) P.push(a.p); for (const x of t.l) for (const y of x.atoms) P.push(y.p);
        for (const p of P) { const k = key(Math.floor(p.x / d), Math.floor(p.y / d), Math.floor(p.z / d)); if (!H.has(k)) H.set(k, []); H.get(k).push(p); }
        const near = (p) => { const cx = Math.floor(p.x / d), cy = Math.floor(p.y / d), cz = Math.floor(p.z / d);
          for (let x = cx - 1; x <= cx + 1; x++) for (let y = cy - 1; y <= cy + 1; y++) for (let z = cz - 1; z <= cz + 1; z++) for (const q of H.get(key(x, y, z)) || []) if (p.distanceToSquared(q) <= d2) return true;
          return false; };
        if (!P.length) return { r: new Set(), l: new Set() };
        return { r: new Set(R.filter(a => !t.r.has(a) && near(a.p))), l: new Set(L.filter(x => !t.l.has(x) && x.atoms.some(y => near(y.p)))) };
      }
    }
    throw new CmdError('选择表达式无效');
  };
  const s = ev(node); return { r: [...s.r], l: [...s.l] };
}
