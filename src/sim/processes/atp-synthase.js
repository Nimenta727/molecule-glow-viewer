/* =============================================================================
   2. PROCESSES  - interaction animations. Each: { caption, async setup(ctx), update(ctx, dt) }.
   ctx: theta (rotor angle), dTheta, speed, atomsOf(regex), ligands, membraneY[], template(comp),
        makeMol(tpl), makeParticle(color, r), makeFlash(color), anim(...), counters{}, hideLigand(L)
   Coordinates are in the viewer frame (main axis = +Y, Angstrom). Rotor parts rotate by theta
   about +Y; a point at polar angle phi moves to phi - theta (Three.js Y rotation).
   ============================================================================= */
const PROCESSES = {
  atpSynthase: {
    lead: 'ATP 合酶（牛线粒体，c8 环）：每转 8 个 H⁺ 回流，合成 3 个 ATP。',
    energyHL: [['/subunit a$/'], ['/subunit a$/', 'subunit C1'], ['subunit gamma', 'subunit delta', 'subunit epsilon', 'subunit C1', 'subunit beta'], ['subunit beta', 'subunit alpha'], ['subunit beta', 'subunit gamma']],
    energy: [
      ['质子动力势', '呼吸链把 H⁺ 泵到膜间隙，建立跨线粒体内膜的电化学梯度（质子动力势 Δp 约 180–200 mV，主要是膜电位，ΔpH 只占一小部分）。这是 ATP 合酶的能量来源。'],
      ['H⁺ 流过 → c 环转动', 'H⁺ 从膜间隙一侧的 a 亚基半通道进入，结合到 c 亚基的 Glu58 上（中和负电荷后，这个 c 亚基才能转进疏水的脂双层）；c 环转一圈后，它在 a 亚基 Arg159 旁边把 H⁺ 交给通往基质的另一个半通道。电化学能在这里变成转动的机械能。c8 环转一圈要 8 个 H⁺。'],
      ['转动 → β 构象变化', 'γ 是不对称的偏心轴，与 c 环一起转动。每转 120°，它把三个 β 亚基依次推入下一种构象（开放 → 松弛 → 紧密），机械能被储存为蛋白构象和结合能的变化。聚焦 β 位点里的核苷酸可看到由坐标算出的结构域转动角。'],
      ['紧密位点里生成 ATP', '在紧密构象中 ADP 和 Pi 被牢牢包住、水被排除，位点内 ADP + Pi ⇌ ATP 的平衡常数接近 1（ΔG ≈ 0），所以生成化学键这一步本身几乎不消耗外来能量——这是 Boyer 结合变构机制的要点。'],
      ['位点打开释放 ATP（耗能）', '紧密位点对 ATP 的亲和力极高（单位点催化测得解离常数约 10⁻¹² M 量级；Penefsky 等）。转动的能量真正用在这里：强迫位点打开、降低亲和力，把 ATP 释放出来。每转一圈释放 3 个 ATP，约 8 H⁺ / 3 ATP ≈ 2.7 H⁺/ATP。'] ],
    stage(ctx) { const f = this.f || 0; return f < 0.15 ? 1 : f < 0.8 ? 2 : f < 0.93 ? 3 : 4; },
    caption: 'H⁺ 顺电化学梯度（质子动力势）经 a 亚基（深蓝）进入 c 环（绿）→ c 环与中心柄 γ（白）旋转 → γ 每转 120°，三个 β 亚基（蓝）依次变构：开放（空）→ 松弛（结合 ADP + Pi）→ 紧密（在位点里 ADP + Pi → ATP）→ 开放（释放 ATP）（Boyer 结合变构机制）。H⁺、Mg·ADP、Pi 从周围溶液扩散进来，ATP 扩散出去，每个粒子都标了名字；“时间尺度”切到快放可看粒子流。β 的形状来自 6ZPO（冷冻电镜，4.0 Å）三条 β 链的真实构象；ADP / Mg²⁺ 位置取自该结构，ATP 与 Pi 的位置是按 ADP 位置建模的示意。计数：整圈比 8 H⁺ : 3 ATP（牛 c8 环）；H⁺ 按 c 环转角计、ATP 按 β 位点完成的循环计，两者有相位差，转满几圈后比值才接近 2.67',
    async setup(ctx) {
      const c = ctx.atomsOf(/subunit c1/i), a = ctx.atomsOf(/subunit a$/i);
      if (!c.length) throw new Error('找不到 c 环');
      const rads = c.map(x => Math.hypot(x.p.x, x.p.z)).sort((x, y) => x - y);
      this.rc = rads[Math.floor(rads.length * 0.9)];
      this.yc = c.reduce((s, x) => s + x.p.y, 0) / c.length;
      const ac = a.length ? a.reduce((s, x) => s.add(x.p), new THREE.Vector3()).multiplyScalar(1 / a.length) : polar(this.rc + 20, 0, this.yc);
      this.phiA = Math.atan2(ac.z, ac.x);
      // ---- the three beta chains
      const bg = ctx.partGroups(/subunit beta/i)[0]; if (!bg) throw new Error('找不到 β 亚基');
      const chains = [...new Set(bg.atoms.map(x => x.asym))].slice(0, 3);
      if (chains.length < 3) throw new Error('β 亚基少于 3 条链');
      const res = Object.fromEntries(chains.map(k => [k, bg.atoms.filter(x => x.asym === k)]));
      const bySeq = Object.fromEntries(chains.map(k => [k, new Map(res[k].map(x => [x.seq, x]))]));
      const cen = (arr) => arr.reduce((s, x) => s.add(x.p), new THREE.Vector3()).multiplyScalar(1 / arr.length);
      const ang = Object.fromEntries(chains.map(k => { const q = cen(res[k]); return [k, Math.atan2(q.z, q.x)]; }));
      const wrap = (x) => Math.atan2(Math.sin(x), Math.cos(x));
      // next(k): the chain at phi_k + 120 deg. A rotor turn of +120 deg makes chain k take the conformation next(k) had.
      const next = Object.fromEntries(chains.map(k => [k, chains.filter(j => j !== k).sort((i, j) => Math.abs(wrap(ang[i] - ang[k] - 2 * Math.PI / 3)) - Math.abs(wrap(ang[j] - ang[k] - 2 * Math.PI / 3)))[0]]));
      // ---- catalytic nucleotides (+ Mg) -> nearest beta chain
      const nuc = ctx.ligands.filter(L => /^(ATP|ADP|ANP|AGS|ACP)$/.test(L.comp));
      const near = (p, arr) => arr.reduce((m, x) => Math.min(m, x.p.distanceTo(p)), 1e9);
      const others = ctx.allAtoms.filter(x => !/subunit beta/i.test(x.part));
      const site = {};
      for (const L of nuc) {
        const dB = chains.map(k => near(L.centre, res[k])), k = chains[dB.indexOf(Math.min(...dB))];
        if (Math.min(...dB) < near(L.centre, others) && !site[k]) { site[k] = { L }; ctx.hideLigand(L); }
      }
      for (const L of ctx.ligands.filter(L => L.comp === 'MG')) for (const k in site)
        if (site[k].L.atoms.some(x => x.p.distanceTo(L.atoms[0].p) < 4.5)) { site[k].mg = L.atoms[0].p.clone(); ctx.hideLigand(L); }
      const filled = chains.filter(k => site[k]);
      if (!filled.length) throw new Error('β 亚基上没有核苷酸');
      // open chain E = the empty one (beta_E); roles along the cycle: open -> loose -> tight
      // ---- T[k][s]: superposition placing chain s onto chain k using the N-terminal barrel + nucleotide-binding domain
      const seqs = res[chains[0]].map(x => x.seq), s0 = Math.min(...seqs), s1 = Math.max(...seqs), cutSeq = s0 + 0.62 * (s1 - s0);
      const T = {};
      for (const k of chains) { T[k] = {}; for (const s2 of chains) {
        const pr = res[k].filter(x => x.seq < cutSeq && bySeq[s2].has(x.seq));
        T[k][s2] = superpose(pr.map(x => x.p), pr.map(x => bySeq[s2].get(x.seq).p));
      } }
      for (const k of chains) for (const x of res[k]) {
        x.alts = {};
        for (const s2 of chains) { const y = bySeq[s2].get(x.seq); x.alts[s2] = s2 === k ? x.p.clone() : y ? T[k][s2](y.p) : x.p.clone(); }
      }
      /* beta_E (open) = the chain whose conformation differs most from the other two. Do NOT use "the empty site":
         in 6ZPO all three beta sites hold ADP (audit: auth D = betaDP, E = betaE, F = betaTP by comparison with 1BMF). */
      const rmsd = (a2, b2) => { const pr = res[a2].filter(x => bySeq[b2].has(x.seq)), F = T[a2][b2];
        return Math.sqrt(pr.reduce((s3, x) => s3 + x.p.distanceToSquared(F(bySeq[b2].get(x.seq).p)), 0) / pr.length); };
      const odd = (k) => chains.filter(j => j !== k).reduce((s3, j) => s3 + rmsd(k, j), 0);
      const E = chains.find(k => !site[k]) || chains.reduce((a2, b2) => odd(b2) > odd(a2) ? b2 : a2);
      this.role = { [E]: 'open', [next[E]]: 'loose', [next[next[E]]]: 'tight' };
      this.betaE = E;
      ctx.setConformations(bg, chains);
      // ---- ligand poses in every (site k, conformation s)
      const [tATP, tADP, tPi] = await Promise.all(['ATP', 'ADP', 'PO4'].map(ctx.template));
      const apply = (Tf, pose) => ({ q: Tf.q.clone().multiply(pose.q), t: pose.t.clone().sub(Tf.cb).applyQuaternion(Tf.q).add(Tf.ca) });
      const ofPose = (pose, p) => p.clone().applyQuaternion(pose.q).add(pose.t);
      const local = {};   // poses of each conformation s in chain s's own frame
      for (const s2 of chains) {
        let src = s2; while (!site[src]) src = next[src];
        const crys = site[src].L.atoms;
        let pa = fitPose(tATP, crys), pd = fitPose(tADP, crys), mg = site[src].mg;
        if (!pa || !pd) throw new Error('核苷酸原子名匹配失败');
        if (src !== s2) {   // empty pocket: carry the ligand over with a LOCAL pocket superposition src -> s2
          const pocket = res[src].filter(x => crys.some(y => y.p.distanceTo(x.p) < 11) && bySeq[s2].has(x.seq));
          const F = superpose(pocket.map(x => bySeq[s2].get(x.seq).p), pocket.map(x => x.p));
          pa = apply(F, pa); pd = apply(F, pd); mg = mg && F(mg);
        }
        const PG = ofPose(pa, tATP.byName.PG), PB = ofPose(pa, tATP.byName.PB);
        local[s2] = { atp: pa, adp: pd, mg, pi: PG, piOut: PG.clone().addScaledVector(PG.clone().sub(PB).normalize(), 3.0) };
      }
      this.sites = chains.map(k => {
        const P = {};
        for (const s2 of chains) { const Tf = T[k][s2], L0 = local[s2];
          P[s2] = { atp: apply(Tf, L0.atp), adp: apply(Tf, L0.adp), mg: L0.mg && Tf(L0.mg), pi: Tf(L0.pi), piOut: Tf(L0.piOut) }; }
        const S = P[k].atp.t.clone(), D = new THREE.Vector3(S.x, 0, S.z).normalize();
        return { k, P, S, D, mg: ctx.makeParticle(0x7dff8a, 1.6, null, 'Mg²⁺（β 位点里和 ADP / ATP 结合）'), entr: S.clone().addScaledVector(D, 14).add(new THREE.Vector3(0, 9, 0)) };
      });
      { const s0 = this.sites[0], own = s0.P[s0.k], loc = (pose, p) => p ? p.clone().sub(pose.t).applyQuaternion(pose.q.clone().invert()) : null;
        this.mgOff = { adp: loc(own.adp, own.mg), atp: loc(own.atp, own.mg) }; this.tpl = { atp: tATP, adp: tADP, pi: tPi };
        this.cF1 = this.sites.reduce((a, q) => a.add(q.S), new THREE.Vector3()).multiplyScalar(1 / 3); this.rF1 = Math.max(...bg.atoms.map(x => x.p.distanceTo(this.cF1))); }
      this.bg = bg; this.next = next; this.chains = chains; this.f = 0;
      ctx.markHot(this.sites.map(s => s.S), 8);
      this.lastK = Math.floor(ctx.theta / (Math.PI / 4));
      ctx.counters.ATP = 0; ctx.counters['H⁺'] = 0;
    },
    /* pools of free molecules around the machine (or the cell sim's compartments): matrix = F1 side (+y), IMS = below */
    pools() {
      if (this._pools) return this._pools;
      const yc = this.yc, cF = this.cF1, T = this.tpl, off = this.mgOff;
      const mat = shellRegion(cF, this.rF1 + 6, this.rF1 + 75, (p) => p.y > yc + 30), ims = shellRegion(V3n(0, yc - 45, 0), 0, 120, (p) => p.y < yc - 28);
      const matH = shellRegion(V3n(0, yc + 45, 0), 0, 125, (p) => p.y > yc + 28);
      const nuc = (tpl, mg) => () => { const g = new THREE.Group(), m = makeMol(tpl); m.visible = true; g.add(m);
        if (mg) { const q = makeParticle(0x7dff8a, 1.4, null, 'Mg²⁺（和 ATP 一起离开）'); q.position.copy(mg); g.add(q); } procRoot.add(g); return g; };
      return this._pools = {
        adp: scenePool('Mg·ADP@mat', { label: 'Mg·ADP', col: 0x00c8ff, make: nuc(T.adp, off.adp), region: mat, n: 4, tumble: true }),
        pi: scenePool('Pi@mat', { label: 'Pi', col: 0xc9a2ff, make: () => { const m = makeMol(T.pi); m.visible = true; return m; }, region: mat, n: 4, tumble: true }),
        atp: scenePool('Mg·ATP@mat', { label: 'Mg·ATP', col: 0xffb300, make: nuc(T.atp, off.atp), region: mat, n: 2, tumble: true }),
        hIn: spPool('H⁺', 'ims', ims, 14), hOut: spPool('H⁺', 'mat', matH, 4),
      };
    },
    /* a new 120-degree step begins for site s: what it holds changes hands */
    enter(s, n, role) {
      const P = this.pools(), first = s.n === undefined; s.n = n;
      const own = s.P[s.k], fresh = (pool, key, tag) => { const o = pool.make(); procRoot.add(o); o.visible = true; labelObj(o, tag, pool.col); o.userData.alpha = 1; return o; };
      if (role === 'open') {
        if (s.atp) this.release(s);
        s.adp = P.adp.take(s.S); s.adpQ0 = s.adp.quaternion.clone(); s.adpC = new THREE.CatmullRomCurve3(brownPath(s.adp.position.clone(), s.entr, { free1: 5, clear: 7 }), false, 'centripetal');
        s.pi = P.pi.take(s.S); s.piC = new THREE.CatmullRomCurve3(brownPath(s.pi.position.clone(), s.entr.clone().add(V3n(0, -5, 0)), { free1: 5, clear: 6 }), false, 'centripetal');
        s.made = false;
      } else if (role === 'loose') {
        if (first) { s.adp = fresh(P.adp, 'adp', 'Mg·ADP'); s.pi = fresh(P.pi, 'pi', 'Pi'); }
        s.made = false;
      } else if (role === 'tight') {
        if (!s.made && s.adp) this.synth(s);
        if (first) { s.atp = fresh(P.atp, 'atp', 'Mg·ATP'); s.made = true; }
      }
    },
    /* inside the closed (tight) site: ADP + Pi -> ATP, named on the spot (no flash) */
    synth(s) {
      const p = s.adp.position.clone();
      for (const o of [s.adp, s.pi]) if (o) { o.parent?.remove(o); }
      s.adp = s.pi = null; s.made = true;
      const P = this.pools(); s.atp = P.atp.make(); procRoot.add(s.atp); s.atp.visible = true; s.atp.userData.alpha = 1; labelObj(s.atp, 'Mg·ATP', 0xffb300); s.atp.position.copy(p);
      this.ctx.counters.ATP++;
      if (!fastMode()) eventTag('ADP + Pi → ATP（紧密位点里，ΔG ≈ 0）', p.clone().add(V3n(0, 6, 0)), 2.6);
    },
    /* the opening site lets the ATP go: it diffuses out into the matrix and joins the free ATP there */
    release(s) {
      const a = s.atp; s.atp = null; if (!a) return;
      const P = this.pools(), dest = P.atp.region.sample(false) || s.entr.clone().addScaledVector(s.D, 40);
      if (fastMode()) { P.atp.give(a); return; }   /* fast: the ATP stream shows it */
      eventTag('位点打开 → ATP 释放（这一步耗能）', a.position.clone().add(V3n(0, 8, 0)), 2.2);
      travel(a, brownPath(a.position.clone(), dest, { free0: 9, free1: 0, clear: 7 }), 3.0 / this.ctx.pace(), { tumble: true }).then(() => P.atp.give(a));
    },
    update(ctx, dt) {
      const fast = fastMode(), k8 = Math.floor(ctx.theta / (Math.PI / 4));
      if (fast) { if (k8 > this.lastK) ctx.counters['H⁺'] += k8 - this.lastK; this.lastK = k8; }   /* fast: the H⁺ stream shows the flux; the count still follows the rotor (8 H⁺ per turn : 3 ATP, bovine c8 ring) */
      else for (; this.lastK < k8; this.lastK++) this.spawnProton(ctx).catch(() => {});
      const step = ctx.theta / (2 * Math.PI / 3), n = Math.floor(step), f = step - n, nn = ((n % 3) + 3) % 3; this.f = f;
      const w = ease((f - 0.25) / 0.6);   // protein conformational change during the middle of each 120 deg step
      const _q = new THREE.Quaternion(), _p = new THREE.Vector3();
      for (const s of this.sites) {
        let c0 = s.k; for (let i = 0; i < nn; i++) c0 = this.next[c0];
        const c1 = this.next[c0], role = this.role[c0];
        ctx.setChainBlend(this.bg, s.k, c0, c1, w);
        if (s.n !== n) this.enter(s, n, role);
        const A = s.P[c0], B = s.P[c1];
        const pose = (key, o) => { _q.copy(A[key].q).slerp(B[key].q, w); _p.copy(A[key].t).lerp(B[key].t, w); o.quaternion.copy(_q); o.position.copy(_p); };
        const fadeUp = (o) => { if ((o.userData.alpha ?? 1) < 1) setAlpha(o, Math.min(1, o.userData.alpha + dt / 0.8)); };
        if (role === 'open') {               // open -> loose: Mg·ADP and Pi diffuse in from the matrix and bind
          if (s.adp) { fadeUp(s.adp); const u = f / 0.55;
            if (u < 1) { s.adpC.getPoint(u, s.adp.position); s.adp.quaternion.slerpQuaternions(s.adpQ0, A.adp.q, ease(u)); }
            else { pose('adp', s.adp); s.adp.position.lerpVectors(s.entr, _p, ease((f - 0.55) / 0.3)); } }
          if (s.pi) { fadeUp(s.pi); const u = (f - 0.08) / 0.55;
            if (u < 1) s.piC.getPoint(Math.max(0, u), s.pi.position); else s.pi.position.lerpVectors(s.entr.clone().add(V3n(0, -5, 0)), A.piOut.clone().lerp(B.piOut, w), ease((f - 0.63) / 0.3)); }
        } else if (role === 'loose') {       // loose -> tight: the pocket closes round ADP; Pi docks on it; ATP is made at the end
          if (s.adp) { pose('adp', s.adp); if (s.pi) s.pi.position.copy(A.piOut).lerp(B.pi, w); if (f > 0.88 && !s.made) this.synth(s); }
          if (s.atp) pose('atp', s.atp);
        } else {                             // tight -> open: the pocket opens and lets the ATP go
          if (s.atp) { pose('atp', s.atp); if (f > 0.5) this.release(s); }
        }
        for (const o of [s.adp, s.pi, s.atp]) if (o) o.visible = !fast;   /* fast: the streams show the flux instead */
        s.mg.visible = false;
      }
      this.flows(ctx, dt);
    },
    async spawnProton(ctx) {
      const rc = this.rc, yc = this.yc, phiIn = this.phiA - 0.35, k = ctx.pace(), P = this.pools();
      const mouth = polar(rc + 26, phiIn - 0.25, yc - 32), site = polar(rc + 3, phiIn, yc - 2);
      ctx.counters['H⁺']++;
      const h = P.hIn.take(mouth);
      await travel(h, brownPath(h.position.clone(), mouth, { free1: 6, keep: (p) => { p.y = Math.min(p.y, yc - 28); } }), 2.0 / k, { fadeIn: (h.userData.alpha ?? 1) < 1 ? 0.3 : 0 });
      h.userData.tag?.set('H⁺ → a 亚基半通道');
      await travel(h, [mouth, mouth.clone().lerp(site, 0.5).add(V3n(0, 4, 0)), site], 1.0 / k, { ease: true });
      h.userData.tag?.set('H⁺ 结合 c 亚基 Glu58');
      const th0 = ctx.theta;
      await animP(h, null, () => { const d = ctx.theta - th0; h.position.copy(polar(rc + 3, phiIn - d, yc - 2)); return d > Math.PI * 1.75; });
      const E0 = h.position.clone(), phiE = Math.atan2(E0.z, E0.x), E1 = polar(rc + 22, phiE - 0.3, yc + 32);
      h.userData.tag?.set('H⁺ 经半通道 → 基质');
      await travel(h, [E0, E0.clone().lerp(E1, 0.5).add(V3n(0, 2, 0)), E1], 1.0 / k, { ease: true });
      h.userData.tag?.set('H⁺');
      const dest = P.hOut.region.sample(false) || E1.clone().add(V3n(0, 40, 0));
      await travel(h, brownPath(E1, dest, { free0: 6, free1: 0, keep: (p) => { p.y = Math.max(p.y, yc + 28); } }), 2.0 / k);
      P.hOut.give(h);
    },
    /* fast mode: streams (cycles = rotor turns) */
    flows(ctx, dt) {
      const fast = fastMode();
      if (!fast) { if (this.flow) this.flow.visible = false; return; }
      if (!this.flow) {
        const rc = this.rc, yc = this.yc, phiIn = this.phiA - 0.35, P = this.pools(), H = [], AD = [], AT = [];
        for (let i = 0; i < 6; i++) { const a = P.hIn.region.sample(false), mouth = polar(rc + 26, phiIn - 0.25, yc - 32);
          const ring = Array.from({ length: 15 }, (_, j) => polar(rc + 3, phiIn - j * Math.PI * 1.75 / 14, yc - 2)), E0 = ring[14], E1 = polar(rc + 22, Math.atan2(E0.z, E0.x) - 0.3, yc + 32);
          H.push([...brownPath(a, mouth, { free1: 6 }), ...ring, E1, ...brownPath(E1, P.hOut.region.sample(false) || E1.clone().setY(yc + 80), { free0: 6, free1: 0 }).slice(1)]); }
        for (const s of this.sites) { AD.push(brownPath(P.adp.region.sample(false) || s.entr.clone().addScaledVector(s.D, 50), s.S, { free1: 14 })); AT.push(brownPath(s.S, P.atp.region.sample(false) || s.entr.clone().addScaledVector(s.D, 50), { free0: 14, free1: 0 })); }
        this.flow = new FlowLayer([
          { label: 'H⁺ 流：膜间隙 → c 环 → 基质', col: 0xfff27a, r: 2.0, paths: H, per: 8, v: 90 },
          { label: 'ADP + Pi 流入 β 位点', col: 0x00c8ff, r: 2.6, paths: AD, per: 3, v: 50 },
          { label: 'ATP 流出', col: 0xffb300, r: 2.8, paths: AT, per: 3, v: 50 } ]);
      }
      this.flow.visible = true;
      this.flow.update(dt, 3 * +$('spin').value * (cellSim ? cellSim.flux.rotor : 1) / (2 * Math.PI));
    },
  },

