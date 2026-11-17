/* ============================================================================= AUTO MODE: any PDB entry, no preset needed
   1. fetchAutoInfo: RCSB metadata (method, organism, citation, annotations) + MEMBRANE_SEGMENT features (OPM / PDBTM /
      MemProtMD, per chain instance, label_seq ranges).
   2. autoMembrane: membrane normal = principal direction of the transmembrane segments (each segment end - start, sign-free
      tensor, so helices and tilted barrel strands both work) -> +Y; membrane centre = median height of the TM residues;
      cytoplasm side = the side with more Lys / Arg just outside the bilayer (positive-inside rule, von Heijne) -> down.
      No segment annotation but a membrane GO / mpstruc / OPM label -> hydrophobic-belt scan over 600 directions (surface
      residues only). Plain soluble proteins are left as they are.
   3. PROCESSES.auto: through-membrane pore along the bilayer normal through the TM centroid (findChannel on CA / P points,
      only inside the protein's own enclosure within the bilayer), drawn as dots coloured by clearance, constriction residues
      glow; side labels.
   4. showAutoCard / autoCaption: what was found, where it came from, UniProt function text, ligands -> binding-site focus. */
async function fetchAutoInfo(id) {
  const q = `{ entry(entry_id:"${id}"){ struct{title} struct_keywords{pdbx_keywords} exptl{method}
    rcsb_entry_info{resolution_combined} rcsb_accession_info{initial_release_date}
    rcsb_primary_citation{title journal_abbrev year pdbx_database_id_DOI}
    polymer_entities{ rcsb_polymer_entity{pdbx_description} entity_poly{type} rcsb_entity_source_organism{scientific_name}
      rcsb_polymer_entity_container_identifiers{entity_id uniprot_ids} rcsb_polymer_entity_annotation{type name}
      rcsb_polymer_entity_align{ reference_database_name reference_database_accession aligned_regions{ entity_beg_seq_id ref_beg_seq_id length } }
      polymer_entity_instances{ rcsb_polymer_entity_instance_container_identifiers{asym_id}
        rcsb_polymer_instance_feature{type provenance_source feature_positions{beg_seq_id end_seq_id}} } } } }`;
  const j = JSON.parse(await fetchText('https://data.rcsb.org/graphql', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query: q }) }));
  const e = j.data?.entry; if (!e) return null;
  const segs = { OPM: [], PDBTM: [], MemProtMD: [] };
  for (const pe of e.polymer_entities || []) for (const inst of pe.polymer_entity_instances || []) {
    const asym = inst.rcsb_polymer_entity_instance_container_identifiers?.asym_id;
    for (const f of inst.rcsb_polymer_instance_feature || []) if (f.type === 'MEMBRANE_SEGMENT' && segs[f.provenance_source])
      for (const fp of f.feature_positions || []) if (fp.beg_seq_id != null) segs[f.provenance_source].push({ asym, b: fp.beg_seq_id, e: fp.end_seq_id ?? fp.beg_seq_id });
  }
  const src = ['OPM', 'PDBTM', 'MemProtMD'].find(s => segs[s].length) || null;
  const anns = (e.polymer_entities || []).flatMap(pe => pe.rcsb_polymer_entity_annotation || []);
  const memAnn = anns.some(a => /^(mpstruc|OPM|PDBTM|MemProtMD)$/.test(a.type) || (a.type === 'GO' && /membrane/i.test(a.name) && !/membrane-(bounded|enclosed)/i.test(a.name)));
  /* UniProt: function text + topological domains (Cytoplasmic / Extracellular ...), mapped onto entity residue numbers through
     the RCSB-UniProt alignment -> which side of the membrane is the cytoplasm */
  const accs = [...new Set((e.polymer_entities || []).flatMap(pe => pe.rcsb_polymer_entity_container_identifiers?.uniprot_ids || []))].slice(0, 8), uni = {};
  await Promise.all(accs.map(async (acc) => { try { uni[acc] = JSON.parse(await fetchText(`https://rest.uniprot.org/uniprotkb/${acc}.json?fields=cc_function,protein_name,gene_names,ft_topo_dom`)); } catch (err) { console.warn('uniprot', acc, err); } }));
  const IN = /cytoplasmic|mitochondrial matrix|stromal|nuclear|intracellular/i, OUT = /extracellular|periplasmic|lumenal|intermembrane|exoplasmic|vacuolar|virion surface/i, topo = [];
  for (const pe of e.polymer_entities || []) for (const al of pe.rcsb_polymer_entity_align || []) {
    const u = uni[al.reference_database_accession]; if (al.reference_database_name !== 'UniProt' || !u) continue;
    for (const ft of u.features || []) {
      if (ft.type !== 'Topological domain') continue; const side = IN.test(ft.description) ? -1 : OUT.test(ft.description) ? 1 : 0; if (!side) continue;
      const fs = ft.location?.start?.value, fe = ft.location?.end?.value; if (fs == null || fe == null) continue;
      for (const r of al.aligned_regions || []) { const lo = Math.max(fs, r.ref_beg_seq_id), hi = Math.min(fe, r.ref_beg_seq_id + r.length - 1);
        if (lo <= hi) topo.push({ ent: pe.rcsb_polymer_entity_container_identifiers.entity_id, b: r.entity_beg_seq_id + lo - r.ref_beg_seq_id, e: r.entity_beg_seq_id + hi - r.ref_beg_seq_id, side }); }
    }
  }
  return { e, segs: src ? segs[src] : [], segSrc: src, memAnn, uni, topo };
}
/* hydrophobic belt: the 30 A slab, over 600 directions, whose SURFACE residues are most hydrophobic and least charged */
function hydroSlab(prot) {
  const cell = 10, g = new Map(), K = (x, y, z) => x + ',' + y + ',' + z, fl = Math.floor;
  for (const a of prot) { const k = K(fl(a.p.x / cell), fl(a.p.y / cell), fl(a.p.z / cell)); if (!g.has(k)) g.set(k, []); g.get(k).push(a.p); }
  const surf = prot.filter(a => { let n = 0; const x = fl(a.p.x / cell), y = fl(a.p.y / cell), z = fl(a.p.z / cell);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) for (const q of g.get(K(x + dx, y + dy, z + dz)) || []) if (q.distanceToSquared(a.p) < 100) n++;
    return n < 16; });
  if (surf.length < 40) return null;
  const CH = new Set(['ASP', 'GLU', 'LYS', 'ARG']), hy = surf.map(a => HYDRO_RES.has(a.resn)), ch = surf.map(a => CH.has(a.resn));
  const c = surf.reduce((s, a) => s.add(a.p), new THREE.Vector3()).multiplyScalar(1 / surf.length), P = surf.map(a => a.p.clone().sub(c));
  let best = null; const N = 600, pr = new Float32Array(P.length);
  for (let i = 0; i < N; i++) {
    const z = (i + 0.5) / N, r = Math.sqrt(1 - z * z), ph = i * 2.399963, nx = r * Math.cos(ph), nz = r * Math.sin(ph);
    let lo = 1e9, hi = -1e9; for (let k = 0; k < P.length; k++) { const v = P[k].x * nx + P[k].y * z + P[k].z * nz; pr[k] = v; if (v < lo) lo = v; if (v > hi) hi = v; }
    const nb = Math.ceil((hi - lo) / 2) + 1, H = new Float32Array(nb), C = new Float32Array(nb), T = new Float32Array(nb);
    for (let k = 0; k < P.length; k++) { const b = fl((pr[k] - lo) / 2); T[b]++; if (hy[k]) H[b]++; if (ch[k]) C[b]++; }
    for (let b0 = 0; b0 + 15 <= nb; b0++) { let h = 0, cc = 0, t = 0; for (let b = b0; b < b0 + 15; b++) { h += H[b]; cc += C[b]; t += T[b]; }
      if (t < 20) continue; const sc = h - 2 * cc; if (!best || sc > best.sc) best = { sc, n: new THREE.Vector3(nx, z, nz), from: lo + b0 * 2, frac: h / t, h }; }
  }
  if (!best || best.frac < 0.5 || best.h < 20) return null;
  return { n: best.n, atoms: surf.filter((a, k) => { const v = P[k].dot(best.n); return v >= best.from && v <= best.from + 30; }) };
}
function autoMembrane(main, info) {
  const V = THREE.Vector3, prot = main.atoms.filter(a => !a.na);
  if (prot.length < 30) return null;
  let tm = [], dirs = [], src = null, flank = [];
  if (info?.segs?.length) {
    const by = new Map(); for (const a of prot) { if (!by.has(a.asym)) by.set(a.asym, []); by.get(a.asym).push(a); }
    const segBy = new Map(); for (const s of info.segs) { if (!segBy.has(s.asym)) segBy.set(s.asym, []); segBy.get(s.asym).push(s); }
    const m = (L) => L.reduce((q, a) => q.add(a.p), new V()).multiplyScalar(1 / L.length);
    for (const [asym, arr] of by) for (const s of segBy.get(asym.split('_')[0]) || []) {
      const r = arr.filter(a => a.seq >= s.b && a.seq <= s.e).sort((x, y) => x.seq - y.seq); if (r.length < 5) continue;
      tm.push(...r); dirs.push(m(r.slice(-4)).sub(m(r.slice(0, 4))));
      /* the loops right next to the segment (6 residues each way): what the positive-inside rule actually counts */
      for (const a of arr) if ((a.seq > s.e && a.seq <= s.e + 6) || (a.seq < s.b && a.seq >= s.b - 6)) flank.push(a);
    }
    if (dirs.length) src = info.segSrc;
  }
  let n;
  if (dirs.length) {
    const M = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    for (const d of dirs) { const L = d.length(); if (L < 1) continue; const u = [d.x / L, d.y / L, d.z / L]; for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) M[i][j] += u[i] * u[j] * L; }
    const { values, vectors } = jacobi(M), k = values.indexOf(Math.max(...values)); n = new V(vectors[0][k], vectors[1][k], vectors[2][k]).normalize();
  } else if (info?.memAnn) { const h = hydroSlab(prot); if (!h) return null; n = h.n; tm = h.atoms; src = 'scan'; }
  else return null;
  if (tm.length < 8) return null;
  const c = tm.reduce((s, a) => s.add(a.p), new V()).multiplyScalar(1 / tm.length);
  applyTf(main, { centre: c, q: new THREE.Quaternion().setFromUnitVectors(n, new V(0, 1, 0)) });
  const ys = tm.map(a => a.p.y).sort((a, b) => a - b), med = ys[ys.length >> 1];
  const half = THREE.MathUtils.clamp((ys[Math.floor(ys.length * 0.9)] - ys[Math.floor(ys.length * 0.1)]) / 2, 12, 20);
  applyTf(main, { centre: new V(0, med, 0), q: new THREE.Quaternion() });
  /* positive-inside rule (von Heijne): Lys / Arg in the loops flanking the TM segments (sequence neighbours, counted on the side
     where they end up); without segment annotation: Lys / Arg in the 15 A just outside each face */
  const KR = (a) => a.resn === 'LYS' || a.resn === 'ARG', fl = flank.filter(KR);
  let up, dn, how = fl.length >= 4 ? 'flank' : 'near';
  /* best evidence: UniProt topological domains -> mean height of the residues annotated cytoplasmic vs extracellular */
  const tp = info?.topo || [], my = (side) => { let s = 0, n = 0; for (const a of prot) if (Math.abs(a.p.y) > 4 && tp.some(t => t.side === side && t.ent === a.ent && a.seq >= t.b && a.seq <= t.e)) { s += Math.sign(a.p.y); n++; } return n ? s / n : null; };
  const yIn = tp.length ? my(-1) : null, yOut = tp.length ? my(1) : null;
  if (yIn != null || yOut != null) { how = 'uniprot'; const sc = (yIn ?? 0) - (yOut ?? 0);   /* > 0: cytoplasmic residues sit above */
    up = sc > 0 ? 1 : 0; dn = sc > 0 ? 0 : 1; if (Math.abs(sc) < 0.3) how = 'flank'; }
  if (how === 'flank' && fl.length >= 4) { up = fl.filter(a => a.p.y > 0).length; dn = fl.length - up; }
  else if (how !== 'uniprot') { how = 'near'; const kr = (lo, hi) => prot.filter(a => KR(a) && a.p.y > lo && a.p.y < hi).length; up = kr(half - 2, half + 15); dn = kr(-half - 15, -half + 2); }
  if (up > dn) { applyTf(main, { centre: new V(), q: new THREE.Quaternion().setFromAxisAngle(new V(1, 0, 0), Math.PI) }); [up, dn] = [dn, up]; }
  /* each subunit's own TM centre (in the final frame): candidate pore axes for porins / aquaporins (one pore per subunit) */
  const byA = new Map(); for (const a of tm) { if (!byA.has(a.asym)) byA.set(a.asym, []); byA.get(a.asym).push(a.p); }
  const axes = []; for (const L of byA.values()) if (L.length >= 25) { const x = L.reduce((s, p) => s + p.x, 0) / L.length, z = L.reduce((s, p) => s + p.z, 0) / L.length;
    if (Math.hypot(x, z) > 6 && !axes.some(([u, w]) => Math.hypot(u - x, w - z) < 6)) axes.push([x, z]); }
  return { y: 0, half, src, nSeg: dirs.length, krIn: dn, krOut: up, how, axes, sideSure: how === 'uniprot' || dn >= up * 1.3 + 2 };
}
const niceTitle = (t) => !t ? '' : t === t.toUpperCase() ? t.charAt(0) + t.slice(1).toLowerCase() : t;   /* RCSB titles are often ALL CAPS */
const FUSION = new Set(['P00720', 'P0ABE7', 'P0AEX9']);   /* T4 lysozyme, BRIL, MBP: crystallisation fusion partners, not the subject */
const MEM_SRC = { OPM: 'OPM 数据库', PDBTM: 'PDBTM 数据库', MemProtMD: 'MemProtMD 模拟', scan: '疏水带扫描（推断）' };

PROCESSES.auto = {
  caption: '',
  async setup(ctx) {
    const M = current?.autoMem; this.pore = null; this.pores = []; this.dots = []; this.t = 0; if (!M) return;
    const V = THREE.Vector3, P = ctx.allAtoms.map(a => a.p), t0 = performance.now();
    const clr = (q) => { let b = 1e9; for (const p of P) { const d = p.distanceToSquared(q); if (d < b) b = d; } return Math.sqrt(b); };
    this.protR = Math.max(20, ...P.filter(p => Math.abs(p.y) < M.half + 10).map(p => Math.hypot(p.x, p.z)));
    /* one candidate axis (vertical line through (ax, az)): enclosure radius per height = smallest, over 12 sectors around the axis,
       of the farthest residue -> inside the bilayer a pore must stay inside it (not wander out into the lipids) */
    const search = (ax, az, R0) => {
      const enc = new Map(), sl = (y) => Math.round(y / 2), dxz = (p) => Math.hypot(p.x - ax, p.z - az);
      for (let s = sl(-M.half - 12); s <= sl(M.half + 12); s++) {
        const mx = new Float32Array(12); for (const p of P) if (Math.abs(p.y - s * 2) < 3) { const k = Math.floor((Math.atan2(p.z - az, p.x - ax) + Math.PI) / (2 * Math.PI) * 12) % 12, r = dxz(p); if (r > mx[k]) mx[k] = r; }
        enc.set(s, Math.min(...mx));
      }
      const encAt = (y) => enc.get(sl(y)) ?? 0;
      let start = null, sc = 0; for (let y = -M.half + 2; y <= M.half - 2; y += 1.5) { if (encAt(y) < 8) continue; const q = new V(ax, y, az), c = clr(q); if (c > sc) { sc = c; start = q; } }
      if (!start || sc < 4) return { sc };
      const ok = (dir) => (p) => (dir > 0 ? p.y >= start.y - 1 : p.y <= start.y + 1) && dxz(p) < R0 && (Math.abs(p.y) > M.half + 4 || dxz(p) < encAt(p.y) - 3);
      const run = (dir) => findChannel(P, start, { h: 2, radius: R0 + 15, minClear: 4, allowed: ok(dir), goal: (q, c) => dir * q.y > M.half + 6 && c >= 9 });
      const up = run(1), dn = up && run(-1); if (!(up && dn)) return { sc };
      const path = [...dn.slice().reverse(), ...up.slice(1)], inb = path.filter(x => Math.abs(x.p.y) < M.half + 2);
      const nar = (inb.length ? inb : path).reduce((a, b) => b.r < a.r ? b : a);
      return { sc, pore: { path, rmin: nar.r, at: nar.p.clone(), len: pathLength(path), central: !ax && !az } };
    };
    /* the central axis first (channels: pore on the symmetry axis), then each subunit's own TM centre (porins, aquaporins) */
    const c0 = search(0, 0, 30); if (c0.pore) this.pores.push(c0.pore);
    else for (const [ax, az] of (M.axes || []).slice(0, 6)) { const r = search(ax, az, 18); if (r.pore) this.pores.push(r.pore); }
    this.pore = this.pores[0] || null;
    current.corePts = this.pores.flatMap(pr => pr.path.filter(x => Math.abs(x.p.y) < M.half + 8).map(x => ({ p: x.p, r: x.r + 3 })));   /* pore lining = functional core (atomic detail) */
    console.log(`auto 孔道：${this.pores.length ? this.pores.map(p => '最窄 ' + p.rmin.toFixed(1) + ' Å，长 ' + p.len.toFixed(0) + ' Å').join('；') : '无（中央起点净空 ' + c0.sc.toFixed(1) + ' Å）'}（${(performance.now() - t0).toFixed(0)} ms）`);
    /* drawing */
    const R = this.protR;
    makeTag(`脂双层 · ${MEM_SRC[M.src] || M.src}定位`, { p: new V(R + 14, M.half + 4, 0), cls: 'small' });
    makeTag(M.how === 'uniprot' ? '胞质侧（UniProt 拓扑）' : M.sideSure ? '胞质侧（正电残基多）' : '胞质侧？（正电规则证据弱）', { p: new V(R + 14, -M.half - 14, 0), cls: 'small' });
    makeTag(M.sideSure ? '胞外 / 腔面' : '胞外 / 腔面？', { p: new V(R + 14, M.half + 18, 0), cls: 'small' });
    const col = (r) => r < 5 ? 0xe8503a : r < 7 ? 0xff8a3d : r < 10 ? 0xf5c84a : 0x6fb1f0;
    this.pores.forEach((pr, j) => {
      const rAt = (p) => pr.path.reduce((a, b) => b.p.distanceToSquared(p) < a.p.distanceToSquared(p) ? b : a).r; let i = 0;
      for (let s = 0; s <= pr.len; s += 2.5, i++) { const p = alongPath(pr.path, s), d = ctx.makeParticle(col(rAt(p)), 1.1, null, `孔道中心线（由结构算出；这里半径约 ${rAt(p).toFixed(1)} Å）`); d.position.copy(p); d.visible = true; d.userData.base = 1.1; d.userData.i = i; this.dots.push(d); }
      if (j === 0) makeTag(`最窄处 · CA 净空 ${pr.rmin.toFixed(1)} Å`, { p: pr.at.clone().add(new V(9, 0, 0)), cls: 'hl small' });
      const lin = ctx.allAtoms.filter(a => a.p.distanceTo(pr.at) < pr.rmin + 2.5);   /* residues lining the constriction (they glow) */
      pr.lining = [...new Map(lin.map(a => [(AA1[a.resn] || a.resn) + (a.aseq || a.seq), 1])).keys()].slice(0, 12);
      ctx.markHot([pr.at], pr.rmin - 2);
    });
  },
  update(ctx, dt) {
    if (!this.dots.length) return; this.t += dt; const k = (this.t * 10) % 40 - 8;   /* a pulse runs up every pore (no claim about what passes) */
    for (const d of this.dots) d.scale.setScalar(d.userData.base * (1 + 0.9 * Math.exp(-((d.userData.i - k) ** 2) / 8)));
  },
};
function autoCaption(cfg) {
  const e = cfg.autoInfo?.e, M = cfg.autoMem, pore = proc?.pore, nl = new Set(model.ligands.map(L => L.comp)).size, out = [];
  out.push(`自动展示：${esc(niceTitle(e?.struct?.title) || cfg.id)}`);
  if (M) out.push(`膜蛋白——按${MEM_SRC[M.src]}的跨膜片段（${M.nSeg || '—'} 段）把膜法线转成竖直并放上脂双层，胞质侧朝下${M.sideSure ? '' : '（方向证据弱）'}`);
  const np = proc?.pores?.length || 0;
  if (pore) out.push(`${pore.central ? '中央' : `每个亚基各有一条（共 ${np} 条）`}贯穿膜的孔道（彩色点：红＝窄，蓝＝宽），最窄处以 CA 计净空 ${pore.rmin.toFixed(1)} Å`);
  else if (M) out.push('没有找到贯穿膜的孔道（转运体、受体或关闭态都很常见）');
  if (nl) out.push(`${nl} 种小分子 / 离子，可在「简介」里逐个聚焦结合位点`);
  out.push('右上「简介」：来源、功能、文献');
  return out.join('；') + '。';
}
async function showAutoCard() {
  const cfg = current; if (!cfg?.auto) return;
  const e = cfg.autoInfo?.e, M = cfg.autoMem, pore = proc?.pore, H = [];
  const pes = e?.polymer_entities || [];
  $('infoT').textContent = niceTitle(e?.struct?.title) || cfg.id;
  const org = [...new Set(pes.flatMap(p => (p.rcsb_entity_source_organism || []).map(o => o.scientific_name)).filter(Boolean))].slice(0, 3);
  const res = e?.rcsb_entry_info?.resolution_combined?.[0], meth = (e?.exptl || []).map(x => x.method).join(' / ');
  H.push(`<div class="sec"><b>${esc(cfg.id)}</b> · ${esc(meth || '')}${res ? ` · ${res.toFixed(1)} Å` : ''}${org.length ? ` · <i>${org.map(esc).join('、')}</i>` : ''}${e?.struct_keywords?.pdbx_keywords ? ` · ${esc(e.struct_keywords.pdbx_keywords)}` : ''}</div>`);
  const cit = e?.rcsb_primary_citation;
  if (cit?.title) H.push(`<div class="sec">文献：${esc(cit.title)} <span style="color:var(--dim)">${esc(cit.journal_abbrev || '')} ${cit.year || ''}</span>${cit.pdbx_database_id_DOI ? ` <a href="https://doi.org/${encodeURI(cit.pdbx_database_id_DOI)}" target="_blank" rel="noopener">DOI</a>` : ''}</div>`);
  /* composition */
  const comp = groups.slice(0, 8).map(g => `${esc(g.name)} <span style="color:var(--dim)">×${new Set(g.atoms.map(a => a.asym)).size} 链，${g.atoms.length} 残基</span>`);
  H.push(`<div class="sec"><b>组成</b><br>${comp.join('<br>')}${groups.length > 8 ? `<br>… 共 ${groups.length} 种` : ''}</div>`);
  /* membrane & pore */
  if (M) H.push(`<div class="sec"><b>膜</b>：${MEM_SRC[M.src]}${M.nSeg ? `给出 ${M.nSeg} 个跨膜片段` : ''}；膜法线 = 这些片段的主方向，膜中心 = 它们的中位高度。${M.how === 'uniprot' ? '胞质侧按 UniProt 的拓扑注释（Cytoplasmic / Extracellular 等结构域，经 RCSB 的序列对应映射到结构上）放在下方' : `胞质侧按“正电在内”规则（${M.how === 'flank' ? '跨膜片段两端 6 个残基内' : '膜外 15 Å 内'}的 Lys/Arg：下侧 ${M.krIn}、上侧 ${M.krOut}）${M.sideSure ? '放在下方' : '，两侧差别不大，方向不确定'}`}。</div>`);
  if (pore) H.push(`<div class="sec"><b>孔道</b>${pore.central ? '（中央对称轴）' : `（各亚基自己的跨膜中心，共 ${proc.pores.length} 条；中央轴上没有）`}：沿膜法线、只在蛋白自身包围的范围内搜索最大净空路径（与 HOLE 思路相同，但用 CA 粗粒点）：长 ${pore.len.toFixed(0)} Å，最窄处净空 ${pore.rmin.toFixed(1)} Å（到 CA 的距离；真实半径还要减去侧链，约小 2–4 Å）。${pore.lining?.length ? `衬在最窄处的残基：${pore.lining.map(esc).join(' ')}（发光）。` : ''}</div>`);
  else if (M) H.push(`<div class="sec"><b>孔道</b>：中央轴和各亚基的跨膜中心都没有贯穿的通路（CA 净空 ≥ 4 Å）。转运体、受体、酶或关闭态通道通常如此；很窄的孔（如水通道）在 CA 粗粒点上也可能测不出。</div>`);
  /* ligands -> binding-site focus */
  const by = new Map(); for (const L of model.ligands) { if (!by.has(L.comp)) by.set(L.comp, []); by.get(L.comp).push(L); }
  if (by.size) {
    const ents = [...by.entries()].sort((a, b) => (LIPIDS.has(a[0]) - LIPIDS.has(b[0])) || b[1][0].atoms.length - a[1][0].atoms.length).slice(0, 14);
    H.push(`<div class="sec"><b>小分子 / 离子</b>（点击看结合位点与相互作用）<div id="autoLig" style="display:flex;flex-wrap:wrap;gap:4px;margin-top:4px"></div></div>`);
    setTimeout(() => { const box = $('autoLig'); if (!box || current !== cfg) return; for (const [c, list] of ents) {   /* L4: the scene may have changed meanwhile */ const b = document.createElement('button'); b.style.cssText = 'padding:2px 8px;font-size:11px';
      b.textContent = `${c}${list.length > 1 ? ' ×' + list.length : ''}`; b.title = (list[0].fullName || c) + (LIPIDS.has(c) ? '（脂 / 去垢剂）' : ''); let i = -1;
      b.onclick = () => { i = (i + 1) % list.length; focusLigand(list[i], i, list.length); }; box.appendChild(b); } }, 0);
  }
  /* annotations */
  const ann = (t, n) => [...new Set(pes.flatMap(p => (p.rcsb_polymer_entity_annotation || []).filter(a => a.type === t).map(a => a.name.replace(/<[^>]+>/g, ''))))].slice(0, n);
  const fam = [...ann('mpstruc', 1), ...ann('OPM', 1), ...ann('InterPro', 3)], go = ann('GO', 4);
  if (fam.length || go.length) H.push(`<div class="sec"><b>注释</b>：${fam.map(esc).join('；')}${go.length ? `<br><span style="color:var(--dim)">GO：${go.map(esc).join('；')}</span>` : ''}</div>`);
  H.push(`<div class="sec" id="autoFn" style="color:var(--dim)">${cfg.uniFn ?? '正在读取 UniProt 功能注释 …'}</div>`);
  H.push(`<div class="sec" style="color:var(--dim)">点任意部件看详情；☰ 打开面板可换配色、剖开、拆开。</div>`);
  $('infoB').innerHTML = H.join(''); $('infoCard').style.display = 'block';
  if (cfg.uniFn != null) return;
  /* UniProt function text of the largest entities (English original) */
  const accs = [...new Set(pes.map(p => [p, groups.find(g => g.name === p.rcsb_polymer_entity?.pdbx_description)?.atoms.length || 0]).sort((a, b) => b[1] - a[1])
    .flatMap(([p]) => (p.rcsb_polymer_entity_container_identifiers?.uniprot_ids || []).slice().sort((a, b) => FUSION.has(a) - FUSION.has(b))))].slice(0, 2);
  const parts = await Promise.all(accs.map(async (acc) => { try {
    const u = cfg.autoInfo?.uni?.[acc] || JSON.parse(await fetchText(`https://rest.uniprot.org/uniprotkb/${acc}.json?fields=cc_function,protein_name,gene_names`));
    const fn = (u.comments || []).filter(c => c.commentType === 'FUNCTION').flatMap(c => c.texts || []).map(t => t.value).join(' ').replace(/\s*\((?:PubMed|By similarity|Ref\.|ECO)[^)]*\)/g, '');
    const nm = u.proteinDescription?.recommendedName?.fullName?.value || acc, gn = u.genes?.[0]?.geneName?.value;
    return fn ? `<b>${esc(nm)}</b>${gn ? ` (<i>${esc(gn)}</i>)` : ''} <a href="https://www.uniprot.org/uniprotkb/${acc}" target="_blank" rel="noopener">${acc}</a>：${esc(fn.length > 520 ? fn.slice(0, 520) + '…' : fn)}` : '';
  } catch (err) { return ''; } }));
  cfg.uniFn = parts.filter(Boolean).length ? `<span style="color:inherit">功能（UniProt 原文）</span><br>${parts.filter(Boolean).join('<br>')}` : '（UniProt 没有这条结构的功能注释）';
  if (current === cfg && $('autoFn')) $('autoFn').innerHTML = cfg.uniFn;
}

