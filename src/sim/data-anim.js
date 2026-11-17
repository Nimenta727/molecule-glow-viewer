/* ---- the data-only animation engine. Anchors (model coordinates):
     [x,y,z] | {ligand:'K', index:0} | {ligands:'K', order:'up'|'down'} (expands to all of them) | {residue:77, part:'kcsa'}
     | {part:'subunit a'} | {membrane:0} | {centre:true}, each with an optional offset:[dx,dy,dz] */
PROCESSES.dataAnim = {
  caption: '',
  async setup(ctx) {
    const A = current.animation; this.A = A; this.ctx = ctx;
    const at = ctx.allAtoms, bb = new THREE.Box3(); for (const a of at) bb.expandByPoint(a.p);
    this.c = bb.getCenter(V3n()); this.R = bb.getSize(V3n()).length() / 2;
    /* orient.up: the anchor's side of the model faces up (the PCA axis sign is arbitrary). Turn everything 180 deg about a
       horizontal axis through the centre (keeps handedness); runs before the meshes are built, like the KcsA process */
    if (A.orient?.up && this.anchor(A.orient.up)[0].y < this.c.y) {
      const O = this.c, fl = (p) => { p.y = 2 * O.y - p.y; p.z = 2 * O.z - p.z; }, seen = new Set(), F = (p) => { if (!seen.has(p)) { seen.add(p); fl(p); } };
      for (const a of at) F(a.p); for (const g of ctx.partGroups(/./)) for (const a of g.atoms || []) F(a.p);
      for (const L of ctx.ligands) { L.atoms.forEach(x => F(x.p)); F(L.centre); }
      for (const e of Object.values(model.entityStats)) { [e.min, e.max] = [2 * O.y - e.max, 2 * O.y - e.min]; e.mean = 2 * O.y - e.mean; }
      ctx.membraneY.forEach((y, i) => { ctx.membraneY[i] = 2 * O.y - y; $(i ? 'mem2' : 'mem1').value = ctx.membraneY[i] / model.radius; });
      model._occ = null;
    }
    for (const [name, s] of Object.entries(A.species || {})) sceneSpecies[name] = { col: new THREE.Color(s.col || '#ffffff').getHex(), r: THREE.MathUtils.clamp(+s.r || 2.4, 0.8, 6) };
    const mem = ctx.membraneY; this.comp = {}; this.keepF = {};
    for (const [k, d] of Object.entries(A.compartments || { '溶液': {} })) {
      const y = mem[d.membrane ?? 0] ?? this.c.y, g = d.gap ?? 20;
      const ok = d.side === 'above' ? (p) => p.y > y + g : d.side === 'below' ? (p) => p.y < y - g : () => true;
      this.comp[k] = shellRegion(this.c, 0, (d.r ?? 1.2) * this.R, ok);
      this.keepF[k] = d.side === 'above' ? (p) => { if (p.y < y + g) p.y = y + g; } : d.side === 'below' ? (p) => { if (p.y > y - g) p.y = y - g; } : undefined;
    }
    this.pool = (sp, comp) => spPool(sp, comp, this.comp[comp], 0);
    for (const p of A.pools || []) spPool(p.species, p.in, this.comp[p.in], p.n ?? 6);
    const hot = [];
    this.flows = (A.flows || []).map(f => { const pts = f.via.flatMap(a => this.anchor(a)); hot.push(...pts); return { ...f, pts: pts.length > 1 ? pts : [pts[0], pts[0].clone().add(V3n(0, 0.01, 0))], t: rand(), busy: 0 }; });
    this.reacts = (A.reactions || []).flatMap(r => this.anchor(r.site).map(site => { hot.push(site); return { ...r, site, t: rand(), busy: 0 }; }));   /* {ligands:'HEM'} = one reaction per site */
    for (const x of [...this.flows, ...this.reacts]) if (x.counter) ctx.counters[x.counter] = 0;
    if (hot.length) ctx.markHot(hot, 8);
    this.layer = null;
  },
  anchor(a) {
    const off = Array.isArray(a?.offset) ? V3n(+a.offset[0] || 0, +a.offset[1] || 0, +a.offset[2] || 0) : V3n();
    const ctx = this.ctx, one = (p) => [p.clone().add(off)];
    if (Array.isArray(a)) return one(V3n(+a[0] || 0, +a[1] || 0, +a[2] || 0));
    if (a.ligand != null || a.ligands != null) {
      const comp = String(a.ligand ?? a.ligands).toUpperCase(), L = ctx.ligands.filter(x => x.comp === comp);
      if (!L.length) { console.warn('animation: no ligand', comp); return one(this.c); }
      if (a.ligand != null) return one(L[Math.min(L.length - 1, a.index || 0)].centre);
      const P = []; for (const x of L) if (!P.some(q => q.distanceTo(x.centre) < 1)) P.push(x.centre.clone());   /* symmetry copies coincide */
      P.forEach(p => p.add(off)); if (a.order === 'up') P.sort((p, q) => p.y - q.y); if (a.order === 'down') P.sort((p, q) => q.y - p.y); return P;
    }
    if (a.residue != null) {
      const m = /^(-?\d+)([A-Za-z]?)$/.exec(String(a.residue).trim()), rn = m ? +m[1] : NaN, ri = m ? m[2].toUpperCase() : '';
      const r = ctx.allAtoms.find(x => parseInt(x.aseq) === rn && (x.ins || '').toUpperCase() === ri && (!a.part || kwMatch(x.part || '', a.part)) && (!a.chain || (x.ach || x.asym?.split('_')[0]) === a.chain));
      if (!r) console.warn('animation: no residue', a); return one(r ? r.p : this.c);
    }
    if (a.label_seq != null) {
      const r = ctx.allAtoms.find(x => x.seq === +a.label_seq && (!a.part || kwMatch(x.part || '', a.part)) && (!a.label_asym || x.asym?.split('_')[0] === a.label_asym));
      if (!r) console.warn('animation: no residue', a); return one(r ? r.p : this.c);
    }
    if (a.part != null) { const S = ctx.allAtoms.filter(x => kwMatch(x.part || '', a.part)); if (!S.length) console.warn('animation: no part', a.part);
      return one(S.length ? S.reduce((s, x) => s.add(x.p), V3n()).multiplyScalar(1 / S.length) : this.c); }
    if (a.membrane != null) return one(V3n(this.c.x, ctx.membraneY[a.membrane] ?? this.c.y, this.c.z));
    return one(this.c);
  },
  wait(s) { return animP(null, s, () => {}); },
  async runFlow(f) {
    const ctx = this.ctx, k = ctx.pace(), P = f.pts, sp = f.species;
    const obj = f.from ? this.pool(sp, f.from).take(P[0]) : mkSp(sp);
    if (!f.from) { obj.position.copy(P[0]); setAlpha(obj, 0); }
    const a0 = obj.userData.alpha ?? 1;
    if (f.from) await travel(obj, brownPath(obj.position.clone(), P[0], { free1: f.free ?? 6, keep: this.keepF[f.from] }), (f.tIn ?? 1.6) / k, { fadeIn: a0 < 1 ? 0.3 : 0, tumble: f.tumble });
    else await travel(obj, [P[0], P[0].clone().add(V3n(0, 0.01, 0))], 0.4, { fadeIn: 1 });
    if (f.labelVia) obj.userData.tag?.set(f.labelVia);
    const dur = (f.tVia ?? 0.45 * P.length) / k;
    for (const e of f.events || []) { const i = THREE.MathUtils.clamp(e.at | 0, 0, P.length - 1); this.wait(dur * i / Math.max(1, P.length - 1)).then(() => eventTag(e.text, P[i].clone().add(V3n(0, 7, 0)), 2.2)); }
    await travel(obj, P, dur, { ease: true });
    obj.userData.tag?.set(sp);
    if (f.counter) ctx.counters[f.counter]++;
    const end = P[P.length - 1];
    if (f.to) { const pool = this.pool(sp, f.to), dest = pool.region.sample(false) || end.clone().add(V3n(0, 30, 0));
      await travel(obj, brownPath(end.clone(), dest.lerp(end, 0.45), { free0: f.free ?? 6, free1: 0, keep: this.keepF[f.to] }), (f.tOut ?? 1.4) / k); pool.give(obj); }
    else await travel(obj, [end, end.clone().add(V3n(0, 0.01, 0))], 0.6, { fadeOut: 1, remove: true });
  },
  async runReaction(r) {
    const ctx = this.ctx, k = ctx.pace(), at = r.site;
    const ins = await Promise.all((r.in || []).map((s, i) => { const o = this.pool(s.species, s.from).take(at), tgt = at.clone().add(V3n(Math.cos(i * 2.4) * 3, Math.sin(i * 2.4) * 3, 0));
      return travel(o, brownPath(o.position.clone(), tgt, { free1: r.free ?? 10, keep: this.keepF[s.from] }), (r.tIn ?? 2.2) / k, { fadeIn: (o.userData.alpha ?? 1) < 1 ? 0.3 : 0, tumble: true }); }));
    await this.wait((r.hold ?? 0.5) / k);
    for (const o of ins) o.parent?.remove(o);
    if (r.text) eventTag(r.text, at.clone().add(V3n(0, 8, 0)), 2.2);
    if (r.counter) ctx.counters[r.counter]++;
    await Promise.all((r.out || []).map((s, i) => { const m = mkSp(s.species); m.position.copy(at).add(V3n(Math.cos(i * 2.4) * 2, 0, Math.sin(i * 2.4) * 2));
      if (!s.to) return travel(m, [m.position.clone(), m.position.clone().add(V3n(0, 6, 0))], 1.0, { fadeOut: 1, remove: true });
      const pool = this.pool(s.species, s.to), dest = pool.region.sample(false) || at.clone().add(V3n(0, 30, 0));
      return travel(m, brownPath(m.position.clone(), dest, { free0: r.free ?? 10, free1: 0, keep: this.keepF[s.to] }), (r.tOut ?? 2.4) / k).then(() => pool.give(m)); }));
  },
  /* fast mode: one particle stream per flow / per reactant and product, paths from the bulk through the anchors to the bulk */
  buildLayer() {
    const defs = [], S = spOf, smp = (c, near) => this.comp[c]?.sample(false) || near.clone().add(V3n(0, 40, 0));
    const paths = (mk) => [0, 1, 2].map(mk);
    for (const f of this.flows) defs.push({ label: f.name || f.species, col: S(f.species).col, r: S(f.species).r, per: f.rate * (f.stoich || 1), v: 70,
      paths: paths(() => { const a = f.from ? brownPath(smp(f.from, f.pts[0]), f.pts[0], { free1: 6, keep: this.keepF[f.from] }) : [f.pts[0]];
        const e = f.pts[f.pts.length - 1], b = f.to ? brownPath(e.clone(), smp(f.to, e), { free0: 6, free1: 0, keep: this.keepF[f.to] }) : [e];
        return [...a, ...f.pts.slice(1), ...b.slice(1)]; }) });
    for (const r of this.reacts) {
      for (const s of r.in || []) defs.push({ label: s.species + ' → ' + (r.name || '反应'), col: S(s.species).col, r: S(s.species).r, per: r.rate, v: 60, paths: paths(() => brownPath(smp(s.from, r.site), r.site, { free1: 10, keep: this.keepF[s.from] })) });
      for (const s of r.out || []) if (s.to) defs.push({ label: s.species, col: S(s.species).col, r: S(s.species).r, per: r.rate, v: 60, paths: paths(() => brownPath(r.site.clone(), smp(s.to, r.site), { free0: 10, free1: 0, keep: this.keepF[s.to] })) });
    }
    return new FlowLayer(defs);
  },
  update(ctx, dt) {
    const pace = ctx.pace();
    if (fastMode()) { this.layer ||= this.buildLayer(); this.layer.visible = true; this.layer.update(dt, pace);
      for (const x of [...this.flows, ...this.reacts]) if (x.counter) { x.acc = (x.acc || 0) + dt * pace * x.rate; while (x.acc >= 1) { x.acc--; ctx.counters[x.counter]++; } }
      return; }
    if (this.layer) this.layer.visible = false;
    for (const f of this.flows) { f.t += dt * f.rate * pace; if (f.t >= 1 && f.busy < (f.max ?? 3)) { f.t = 0; f.busy++; this.runFlow(f).catch(e => console.warn(e)).finally(() => f.busy--); } else if (f.t > 1) f.t = 1; }
    for (const r of this.reacts) { r.t += dt * r.rate * pace; if (r.t >= 1 && r.busy < (r.max ?? 2)) { r.t = 0; r.busy++; this.runReaction(r).catch(e => console.warn(e)).finally(() => r.busy--); } else if (r.t > 1) r.t = 1; }
  },
};

