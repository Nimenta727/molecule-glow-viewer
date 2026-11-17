  /* Mitochondrial respiratory chain (5GUP respirasome I1III2IV1 + cytochrome c 1HRC + ATP synthase 6ZPO).
     Electrons hop between the REAL cofactor positions of the deposited structure (Fe-S clusters, hemes, copper centres):
     complex I cluster chain = shortest path through the clusters (FMN -> N3 ... N2 in the real enzyme); III: Q cycle
     (Rieske Fe-S -> c1 and bL -> bH -> Qi); cyt c shuttles III -> IV; IV: CuA -> heme a -> a3/CuB -> O2.
     Proton counts per NADH (2 e-): I 4, III 4 (released to the IMS), IV 2 -> 10 H+; bovine c8 ring: 8 H+ per 3 ATP. */
  respiratoryChain: {
    /* compartment model (matrix / intermembrane space): pmf mainly membrane potential (~150 mV) + ΔpH ~0.9; respiratory
       control (electron transport slows as pmf approaches ~205 mV), ATP synthase c8 (8/3 H+ per ATP + 1 for ADP/Pi import),
       TCA cycle supplies NADH, the cell consumes ATP. */
    cell: {
      init: () => ({ pmf: 0, nadh: 0.5, atp: 1.0 }),
      step(s, h, c) {
        const NADt = 3, At = 3, pmf = s.pmf, nad = NADt - s.nadh, adp = At - s.atp;
        const fbp = 1 / (1 + Math.exp((pmf - 205) / 7)), Je = 1.2 * (c.o2 ? 1 : 0) * fbp * s.nadh / (s.nadh + 0.3);
        const x = Math.max(0, (pmf - 140) / 30), Jatp = c.oligo ? 0 : 1.0 * x / (1 + x) * adp / (adp + 0.15), Jleak = 0.25 * pmf / 180 * (c.dnp ? 30 : 1);
        s.pmf = Math.max(0, pmf + h * (5 * Je - 11 / 3 * Jatp - Jleak) * 60);
        s.nadh = Math.min(NADt, Math.max(0, s.nadh + h * (0.8 * (c.sub ? 1 : 0) * nad / (nad + 0.3) - Je / 2)));
        const Juse = 0.35 * (c.demand ? 3 : 1) * s.atp / (s.atp + 0.4);
        s.atp = Math.min(At, Math.max(0, s.atp + h * (Jatp - Juse)));
        return { Je, Jatp, Juse, pmf, rate: Je / 0.3, rotor: Math.min(2.5, Jatp / 0.3) };
      },
      controls: [
        { id: 'sub', label: '底物（NADH）', on: true, tip: '三羧酸循环供应 NADH' },
        { id: 'o2', label: 'O₂', on: true, tip: '关 = 缺氧 / 氰化物抑制复合体 IV' },
        { id: 'demand', label: '高耗能（运动）', on: false, tip: '细胞消耗 ATP 加快 3 倍' },
        { id: 'oligo', label: '寡霉素', on: false, tip: '堵住 ATP 合酶的 H⁺ 通道' },
        { id: 'dnp', label: 'DNP 解偶联', on: false, tip: '2,4-二硝基苯酚：把 H⁺ 直接带回基质' } ],
      series: [
        { label: '膜间隙 pH', range: [6.6, 7.4], color: '#ff7a3d', get: (s) => 7.2 - 0.4 * 0.0045 * s.pmf, fmt: (v) => v.toFixed(2) },
        { label: '基质 pH', range: [7.0, 8.0], color: '#4f8ff0', get: (s) => 7.2 + 0.6 * 0.0045 * s.pmf, fmt: (v) => v.toFixed(2) },
        { label: '膜电位 Δψ', range: [0, 180], color: '#c04fd0', get: (s) => s.pmf * (1 - 59 * 0.0045), fmt: (v) => v.toFixed(0) + ' mV' },
        { label: '耗氧速率', range: [0, 4], color: '#22b8cf', get: (s, f) => f.Je / 0.284, fmt: (v) => (v * 100).toFixed(0) + ' %' },
        { label: 'ATP', range: [0, 3], color: '#e8a000', get: (s) => s.atp, fmt: (v) => v.toFixed(2) + ' mM' },
        { label: 'NADH', range: [0, 3], color: '#d9480f', get: (s) => s.nadh, fmt: (v) => v.toFixed(2) + ' mM' } ],
      comps: (s) => [{ name: '基质（matrix）', pH: 7.2 + 0.6 * 0.0045 * s.pmf }, { name: '膜间隙（IMS）', pH: 7.2 - 0.4 * 0.0045 * s.pmf }],
      dots: [
        { label: 'H⁺', comp: 'bot', color: 0xfff27a, ink: 0xf5c400, r: 2.0, max: 60, count: (s) => 1 + 38 * Math.pow(10, 6.82 - (7.2 - 0.0018 * s.pmf)) },
        { label: 'H⁺', comp: 'top', color: 0xfff27a, ink: 0xf5c400, r: 2.0, max: 30, count: (s) => 1 + 38 * Math.pow(10, 6.82 - (7.2 + 0.0027 * s.pmf)) },
        { label: 'ATP', comp: 'top', color: 0xff9a2e, ink: 0xf07a12, r: 3.0, max: 40, count: (s) => 30 * s.atp / 3 },
        { label: 'NADH', comp: 'top', color: 0xff6fa8, ink: 0xd9467e, r: 3.4, max: 30, count: (s) => 24 * s.nadh / 3 } ],
      explain(s, f, c) {
        const r = Math.round(f.Je / 0.284 * 100);
        if (!c.o2) return '缺氧 / 氰化物：复合体 IV 无法把电子交给 O₂，整条链堵住，NADH 无法氧化，质子动力势消失，ATP 合成停止——这就是氰化物致死的原因。';
        if (c.dnp) return `DNP 把 H⁺ 直接带回基质：质子动力势降到约 ${s.pmf.toFixed(0)} mV，“反压”消失，耗氧速率飙到 ${r}%，但能量变成热，ATP 几乎为零（20 世纪 30 年代曾被当减肥药，致死）。`;
        if (c.oligo) return `寡霉素堵住 ATP 合酶：H⁺ 回不来，膜电位升到约 ${(s.pmf * 0.73).toFixed(0)} mV，电子传递被“反压”压到 ${r}%（呼吸控制）；细胞继续耗 ATP，ATP 越来越少。`;
        if (!c.sub) return 'NADH 供应中断：电子来源耗尽，耗氧和质子泵停下，质子动力势逐渐消失。';
        if (c.demand) return `高耗能：ATP 被快速消耗，ADP 增多，ATP 合酶加速回流 H⁺，质子动力势略降，“反压”减小，电子传递和耗氧自动加快到 ${r}%——这就是呼吸控制。`;
        return `静息稳态：膜电位约 ${(s.pmf * 0.73).toFixed(0)} mV + ΔpH 约 ${(0.0045 * s.pmf).toFixed(1)}，质子动力势约 ${s.pmf.toFixed(0)} mV。ATP 充足、ADP 少，ATP 合酶转得慢，电子传递也被“反压”压低。试试“高耗能”“寡霉素”“DNP”。`;
      },
    },
    energyHL: [['/^复合体 I$/'], ['/^复合体 I$/'], ['/^复合体 I$/', '/^复合体 III$/'], ['/^复合体 III$/'], ['细胞色素 c', '/^复合体 III$/', '/^复合体 IV$/'], ['/^复合体 IV$/'], ['ATP 合酶']],
    energy: [
      ['NADH 交出电子', 'NADH 把 2 个电子（以氢负离子 H⁻ 形式）交给复合体 I 顶端的 FMN。NAD⁺/NADH 的标准还原电位 E°′ ≈ −0.32 V，是整条链的“高能”起点。'],
      ['复合体 I：电子下坡，泵 4 H⁺', '电子经一串铁硫簇（N3 → N1b → N4 → N5 → N6a → N6b → N2，间距都 < 14 Å，靠量子隧穿跳跃）到达膜旁的 N2，再还原泛醌（Q → QH₂）。还原放出的能量通过膜臂的构象 / 静电耦合，把 4 个 H⁺ 从基质泵到膜间隙（耦合的具体机制仍有争论）。'],
      ['泛醌池', 'QH₂ 是脂溶性的，在膜内扩散，把 2 个电子带到复合体 III。'],
      ['复合体 III：Q 循环', 'QH₂ 在 Qo 位点被氧化，两个电子分道：一个经 Rieske 铁硫蛋白 → 细胞色素 c1 → 细胞色素 c（高电位链）；另一个经血红素 bL → bH 到 Qi 位点还原另一个醌（低电位链）。Q 循环的净效果：每 2 个电子向膜间隙释放 4 个 H⁺，并从基质侧摄取 2 个。'],
      ['细胞色素 c 穿梭', '水溶性的细胞色素 c 在膜间隙一侧穿梭，一次只携带 1 个电子（血红素铁 Fe³⁺ ⇌ Fe²⁺），从复合体 III 的 c1 送到复合体 IV 的 CuA；每个 NADH 往返 2 次（动画画出两趟）。'],
      ['复合体 IV：O₂ → H₂O', '电子 CuA → 血红素 a → 血红素 a3–CuB 双核中心，在这里把 O₂ 还原成水（O₂/H₂O 的 E°′ ≈ +0.82 V）。每 2 个电子消耗基质侧 2 个“化学”H⁺（生成水），同时再泵出 2 个 H⁺。'],
      ['质子动力势 → ATP', 'NADH → O₂：ΔE°′ ≈ 1.14 V，ΔG°′ = −nFΔE°′ ≈ −220 kJ/mol。约 10 个 H⁺ 进入膜间隙（复合体 I 泵出 4 个、IV 泵出 2 个；复合体 III 的 Q 循环不是泵：在 Qo 位点释放 4 个、在 Qi 位点从基质摄取 2 个），能量储存在跨内膜的质子动力势里（约 200 mV，线粒体中以膜电位为主）。H⁺ 经 ATP 合酶回流驱动转子：牛的 c8 环每转 8 个 H⁺ 合成 3 个 ATP。' + ATP_PER_NADH + '。'] ],
    stage() { return this.stg || 0; },
    lead: '呼吸链：每个 NADH 送出 10 个 H⁺；H⁺ 经 ATP 合酶回流才合成 ATP（理论约 2.7 个，测得约 2.5 个）。',
    caption: 'NADH 的电子沿真实辅因子位置流过复合体 I → 泛醌 → III → 细胞色素 c → IV → O₂。每个 NADH：复合体 I 泵出 4 个 H⁺，III 经 Q 循环释放 4 个（不是泵），IV 泵出 2 个，共 10 个。H⁺ 账本：膜间隙存量 = 送出 − 经 ATP 合酶回流；存量用完时转子停下。ATP 计数 = 回流 H⁺ × 3/8（牛 c8 环，只算合酶产出）；' + ATP_PER_NADH + '。结构：5GUP 猪呼吸链超复合物 + 1HRC 马细胞色素 c + 6ZPO 牛 ATP 合酶，组件位置为示意。',
    async setup(ctx) {
      const V3 = (x, y, z) => new THREE.Vector3(x, y, z), all = ctx.allAtoms;
      const partAt = (p) => { let b = null, bd = 1e9; for (const a of all) { const d = a.p.distanceToSquared(p); if (d < bd) { bd = d; b = a; } } return b?.part || ''; };
      const cof = ctx.ligands.filter(l => ['SF4', 'FES', 'HEM', 'HEC', 'HEA', 'CU', 'CUA'].includes(l.comp) && !l.compLabel).map(l => ({ comp: l.comp, p: l.centre.clone(), part: partAt(l.centre) }));
      const inP = (nm) => cof.filter(c => c.part === nm), cen = (re) => { const A = ctx.atomsOf(re); return A.reduce((s, a) => s.add(a.p), V3(0, 0, 0)).multiplyScalar(1 / Math.max(1, A.length)); };
      const ym = this.ym = ctx.membraneY[0] ?? 0;
      /* complex I: shortest path through the Fe-S clusters from the matrix tip to the cluster next to the membrane (N2) */
      const fe = inP('复合体 I').filter(c => c.comp === 'SF4' || c.comp === 'FES');
      let chain = [];
      if (fe.length >= 2) {
        const s0 = fe.indexOf(fe.reduce((a, b) => b.p.y > a.p.y ? b : a)), t0 = fe.indexOf(fe.reduce((a, b) => b.p.y < a.p.y ? b : a));
        const n = fe.length, dist = Array(n).fill(Infinity), prev = Array(n).fill(-1), done = Array(n).fill(false); dist[s0] = 0;
        for (;;) { let u = -1; for (let i = 0; i < n; i++) if (!done[i] && dist[i] < Infinity && (u < 0 || dist[i] < dist[u])) u = i;
          if (u < 0 || u === t0) break; done[u] = true;
          for (let v = 0; v < n; v++) { const d = fe[u].p.distanceTo(fe[v].p); if (v !== u && d < 20 && dist[u] + d * d < dist[v]) { dist[v] = dist[u] + d * d; prev[v] = u; } } }
        for (let v = t0; v >= 0; v = prev[v]) chain.unshift(fe[v].p); if (chain.length < 2) chain = [fe[s0].p, fe[t0].p];
      } else { const c = cen(/^复合体 I$/); chain = [c.clone().setY(ym + 90), c.clone().setY(ym + 25)]; }
      this.chainI = chain; this.nadh = chain[0].clone().add(V3(0, 16, 0));
      const N2 = chain[chain.length - 1]; this.qI = N2.clone().lerp(V3(N2.x, ym, N2.z), 0.6);
      /* complex IV centres */
      const c4 = inP('复合体 IV'), cus = c4.filter(c => c.comp === 'CU' || c.comp === 'CUA'), pairOf = (c) => cus.some(d => d !== c && d.p.distanceTo(c.p) < 3.5);
      const cuA = (cus.find(pairOf) || cus.reduce((a, b) => (!a || b.p.y < a.p.y) ? b : a, null))?.p || cen(/^复合体 IV$/).setY(ym - 25);
      const cuB = cus.find(c => !pairOf(c))?.p || cen(/^复合体 IV$/).setY(ym + 5);
      const hea = c4.filter(c => c.comp === 'HEA').map(c => c.p).sort((a, b) => a.distanceTo(cuB) - b.distanceTo(cuB));
      this.a3 = hea[0] || cuB; this.ha = hea[1] || this.a3; this.cuA = cuA; this.cuB = cuB;
      /* complex III: the monomer whose c1 faces complex IV; bL = heme b nearest that c1, bH = heme b on the matrix side of bL */
      const c3 = inP('复合体 III'), c1 = (c3.filter(c => c.comp === 'HEC').map(c => c.p).sort((a, b) => a.distanceTo(cuA) - b.distanceTo(cuA))[0]) || cen(/^复合体 III$/).setY(ym - 25);
      const hems = c3.filter(c => c.comp === 'HEM').map(c => c.p), bL = hems.sort((a, b) => a.distanceTo(c1) - b.distanceTo(c1))[0] || c1.clone().setY(ym - 8);
      const bH = hems.filter(h => h !== bL && h.y > bL.y + 6).sort((a, b) => a.distanceTo(bL) - b.distanceTo(bL))[0] || bL.clone().add(V3(0, 18, 0));
      const isp = (c3.filter(c => c.comp === 'FES').map(c => c.p).sort((a, b) => a.distanceTo(bL.clone().lerp(c1, 0.5)) - b.distanceTo(bL.clone().lerp(c1, 0.5)))[0]) || bL.clone().lerp(c1, 0.5);
      Object.assign(this, { c1, bL, bH, isp, Qo: bL.clone().lerp(isp, 0.45), Qi: bH.clone().add(V3(0, 7, 0)) });
      /* complex I membrane arm: 4 pumping positions spread along it */
      const arm = ctx.atomsOf(/^复合体 I$/).filter(a => Math.abs(a.p.y - ym) < 18);
      this.pumpI = [];
      if (arm.length > 20) { const pc = pca(arm.map(a => a.p)), e = pc.axes[2].clone().setY(0).normalize(), ts = arm.map(a => a.p.clone().sub(pc.centre).dot(e)), lo = Math.min(...ts), hi = Math.max(...ts);
        for (const f of [0.2, 0.4, 0.6, 0.8]) this.pumpI.push(pc.centre.clone().addScaledVector(e, lo + (hi - lo) * f).setY(ym)); }
      else for (let i = 0; i < 4; i++) this.pumpI.push(this.qI.clone().setY(ym));
      /* cytochrome c: its own heme is hidden (the animation draws it on the moving protein) */
      const cytL = ctx.ligands.find(l => l.compLabel === '细胞色素 c' && l.comp === 'HEC'); if (cytL) ctx.hideLigand(cytL);
      const cytA = ctx.atomsOf(/^细胞色素 c$/); this.c0 = cytA.reduce((s, a) => s.add(a.p), V3(0, 0, 0)).multiplyScalar(1 / Math.max(1, cytA.length));
      this.h0 = cytL ? cytL.centre.clone() : this.c0.clone();
      this.dock1 = c1.clone().add(V3(0, -24, 0)); this.dock2 = cuA.clone().add(V3(0, -24, 0)); this.cytPos = this.dock1.clone();
      /* ATP synthase: H+ path at the a-subunit / c-ring interface; ATP leaves the F1 head */
      const aSub = cen(/ATP 合酶 · .*subunit a$/), beta = cen(/ATP 合酶 · .*subunit beta/);
      this.atpH = [aSub.clone().setY(ym - 34), aSub.clone().setY(ym - 6), aSub.clone().setY(ym + 6), aSub.clone().setY(ym + 34)];
      this.atpOut = beta.clone().add(V3(0, 18, 0));
      this.lastA = Math.floor(ctx.theta / (2 * Math.PI / 3)); this.lastH = Math.floor(ctx.theta / (2 * Math.PI / 8));
      ctx.counters.NADH = 0; ctx.counters['H⁺ 泵出（复合体 I / IV）'] = 0; ctx.counters['H⁺ 释放到膜间隙（Q 循环）'] = 0; ctx.counters['H⁺ 回流（ATP 合酶）'] = 0; ctx.counters['H⁺ 膜间隙存量'] = 0; ctx.counters['ATP（合酶产出）'] = 0; ctx.counters['ATP / NADH'] = 0; this.nE = 0;   /* per NADH (2 e⁻): pumped I 4 + IV 2; Q cycle at III releases 4 (and takes up 2 at Qi) -> 10 to the IMS */
      ctx.markHot([...chain, cuA, cuB, this.a3, this.ha, c1, bL, bH, isp], 7);
      this.t = 0; this.busy = false; this.stg = 0;
    },
    move(p, pts, per, done, fail) {   // hop a particle through points (electrons between cofactors: tunnelling hops); per = seconds per 20 A
      const ctx = this.ctx, k = ctx.pace(); let i = 0; p.position.copy(pts[0]);
      const go = () => { if (i >= pts.length - 1) { done ? done(p) : p.parent?.remove(p); return; }
        const a = pts[i].clone(), b = pts[i + 1].clone(); i++; ctx.anim(p, (per * (0.35 + a.distanceTo(b) / 20)) / k, (u) => { p.position.copy(a).lerp(b, ease(u)); }, go, fail); };
      go();
    },
    /* bulk pools: top = matrix, bot = intermembrane space (the cell sim's compartments when it runs) */
    pl(name, comp, n = 0) { const ym = this.ym, c = model.focus.centre;
      return spPool(name, comp, shellRegion(V3n(c.x, ym + (comp === 'top' ? 80 : -80), c.z), 0, 190, (p) => comp === 'top' ? p.y > ym + 28 : p.y < ym - 28), n); },
    /* one H+ pumped matrix -> IMS through a proton path of a complex */
    pumpH(from, to, delay = 0) {
      const ctx = this.ctx, ym = this.ym;
      ctx.anim(null, Math.max(0.02, delay / ctx.pace()), () => {}, () => { ctx.counters['H⁺ 泵出（复合体 I / IV）']++;
        const a = from.clone().setY(ym + 24), b = to.clone().setY(ym - 24);
        protonAcross(this.pl('H⁺', 'top'), this.pl('H⁺', 'bot'), [a, a.clone().lerp(b, 0.5), b], { pace: ctx.pace, label: 'H⁺（质子通道）',
          keepIn: (p) => { p.y = Math.max(p.y, ym + 26); }, keepOut: (p) => { p.y = Math.min(p.y, ym - 26); } }).catch(() => {}); });
    },
    /* H+ set free at a site (QH2 oxidised at Qo) -> into the IMS */
    releaseH(at, delay = 0) {
      const ctx = this.ctx, ym = this.ym;
      ctx.anim(null, Math.max(0.02, delay / ctx.pace()), () => {}, async () => { ctx.counters['H⁺ 释放到膜间隙（Q 循环）']++;
        const h = mkSp('H⁺'); h.position.copy(at); const out = at.clone().setY(ym - 24), pool = this.pl('H⁺', 'bot');
        await travel(h, [at.clone(), at.clone().lerp(out, 0.5), out], 0.9 / ctx.pace(), { ease: true });
        await travel(h, brownPath(out, pool.region.sample(false) || out.clone().setY(ym - 70), { free0: 6, free1: 0, keep: (p) => { p.y = Math.min(p.y, ym - 26); } }), 1.6 / ctx.pace());
        pool.give(h); });
    },
    /* a matrix H+ is used up chemically at a site (Qi, O2 reduction) */
    takeH(site, label) {
      const ctx = this.ctx, ym = this.ym, h = this.pl('H⁺', 'top').take(site), mouth = site.clone().setY(Math.max(site.y + 14, ym + 26));
      return travel(h, brownPath(h.position.clone(), mouth, { free1: 6, keep: (p) => { p.y = Math.max(p.y, ym + 26); } }), 1.8 / ctx.pace(), { fadeIn: (h.userData.alpha ?? 1) < 1 ? 0.3 : 0 })
        .then(() => { if (label) h.userData.tag?.set(label); return travel(h, [mouth, site], 0.7 / ctx.pace(), { ease: true, remove: true }); });
    },
    /* one NADH = 2 e⁻, drawn particle for particle (C1):
       I: NADH → 2 e⁻ → Q + 2H⁺ → QH₂, 4 H⁺ pumped. III (Q cycle): two QH₂ oxidised at Qo one after the other (each: 2 H⁺ released
       to the IMS, one e⁻ → Rieske → c1 → cytochrome c, one e⁻ → bL → bH → Qi); at Qi one Q takes both e⁻ + 2 matrix H⁺ → QH₂ back to
       the pool (net: 1 QH₂ oxidised). Cytochrome c makes 2 trips of 1 e⁻. IV, per e⁻: 1 H⁺ pumped + 1 matrix H⁺ used; O₂ after 4 e⁻. */
    async cycle() {
      const ctx = this.ctx, ym = this.ym, V3 = (x, y, z) => new THREE.Vector3(x, y, z), up = (p, d) => p.clone().setY(ym + d), k = () => ctx.pace();
      const mv = (p, pts, per) => new Promise((res, rej) => this.move(p, pts, per, (x) => { x.parent?.remove(x); res(); }, rej));
      this.busy = true; this.stg = 0; ctx.counters.NADH++;
      try {
        const nadh = this.pl('NADH', 'top', 3).take(this.nadh);
        await travel(nadh, brownPath(nadh.position.clone(), this.nadh, { free1: 8, keep: (p) => { p.y = Math.max(p.y, ym + 26); } }), 2.4 / k(), { fadeIn: (nadh.userData.alpha ?? 1) < 1 ? 0.3 : 0 });
        nadh.parent?.remove(nadh);
        eventTag('NADH → NAD⁺ + H⁺ + 2e⁻（2 个电子交给 FMN）', this.nadh.clone().add(V3(0, 8, 0)));
        { const nad = mkSp('NAD⁺'), pool = this.pl('NAD⁺', 'top'); nad.position.copy(this.nadh);
          travel(nad, brownPath(this.nadh.clone(), pool.region.sample(false) || up(this.nadh, 90), { free0: 8, free1: 0 }), 2.6 / k()).then(() => pool.give(nad)).catch(() => {}); }
        this.stg = 1;
        this.pumpI.forEach((q, i) => this.pumpH(up(q, 34), up(q, -34), 0.5 + i * 0.35));
        await mv(mkSp('e⁻', '2 e⁻（FMN → 铁硫簇链）'), [this.nadh, ...this.chainI, this.qI], 0.45);
        eventTag('复合体 I：Q + 2e⁻ + 2H⁺ → QH₂', this.qI.clone().add(V3(0, 6, 0)), 2.0);
        this.stg = 2;
        const q1 = mkSp('QH₂', 'QH₂（泛醇，在膜内扩散）');
        await travel(q1, [this.qI, ...brownPath(up(this.qI, 2), up(this.Qo, 2), { n: 14, clear: 6, free0: 6, free1: 6, keep: (p) => { p.y = ym + 2 + (p.y - ym - 2) * 0.2; } }), this.Qo], 3.0 / k());
        q1.parent?.remove(q1);
        await this.qoTurn(1, mv);
        /* the second QH₂ comes from the membrane quinone pool (the Q cycle needs two per NADH; the one made at Qi refills the pool) */
        const pool0 = up(this.Qo, 2).addScaledVector(ctx.rowDir, 45), q2 = mkSp('QH₂', 'QH₂（来自膜内醌池）'); q2.position.copy(pool0);
        await travel(q2, [...brownPath(pool0, up(this.Qo, 2), { n: 8, clear: 6, free0: 6, free1: 6, keep: (p) => { p.y = ym + 2 + (p.y - ym - 2) * 0.2; } }), this.Qo], 2.2 / k(), { fadeIn: 0.3 });
        q2.parent?.remove(q2);
        await this.qoTurn(2, mv);
        this.stg = 6; await animP(null, 1.2 / k(), () => {});
        this.busy = false;
      } catch (e) { if (!(e instanceof Stale)) { console.warn('respiratory chain', e); this.busy = false; } }
    },
    /* one QH₂ at Qo: 2 H⁺ out, e⁻ (low potential) → Qi, e⁻ (high potential) → cytochrome c → complex IV */
    async qoTurn(n, mv) {
      const ctx = this.ctx, ym = this.ym, V3 = (x, y, z) => new THREE.Vector3(x, y, z), up = (p, d) => p.clone().setY(ym + d);
      this.stg = 3;
      eventTag(`Qo 位点：QH₂ 氧化（第 ${n} 个）→ Q + 2H⁺ + 2e⁻`, this.Qo.clone().add(V3(0, -6, 0)), 2.2);
      for (let i = 0; i < 2; i++) this.releaseH(this.Qo.clone().add(V3((i - 0.5) * 3, 0, 0)), i * 0.3);
      mv(mkSp('e⁻', 'e⁻（低电位链 bL → bH）'), [this.Qo, this.bL, this.bH, this.Qi], 0.6).then(() => {
        if (n === 1) eventTag('Qi 位点：Q + e⁻ → Q•⁻（半醌，等第二个电子）', this.Qi.clone().add(V3(0, 6, 0)), 2.2);
        else {
          for (let i = 0; i < 2; i++) this.takeH(this.Qi, 'H⁺ → Qi 位点').catch(() => {});
          eventTag('Qi 位点还原：Q•⁻ + e⁻ + 2H⁺ → QH₂（回到醌池）', this.Qi.clone().add(V3(0, 6, 0)), 2.4);
          const q = mkSp('QH₂', 'QH₂（Qi 生成，回醌池）'); q.position.copy(this.Qi);
          travel(q, brownPath(up(this.Qi, 2), up(this.Qi, 2).addScaledVector(ctx.rowDir, 45), { n: 8, free0: 6, free1: 0, keep: (p) => { p.y = ym + 2 + (p.y - ym - 2) * 0.2; } }), 2.4 / ctx.pace(), { fadeOut: 0.3, remove: true }).catch(() => {});
        } }).catch(() => {});
      await mv(mkSp('e⁻', 'e⁻（Rieske → c1）'), [this.Qo, this.isp, this.c1, this.cytPos.clone().sub(this.c0).add(this.h0)], 0.6);
      this.stg = 4; this.cytLoaded = true;
      eventTag(`细胞色素 c 运送第 ${n} 个 e⁻`, this.cytPos.clone().sub(this.c0).add(this.h0).add(V3(0, -8, 0)), 2.0);
      await this.shuttle(this.dock2, 2.6);
      this.stg = 5; this.cytLoaded = false;
      this.pumpH(up(this.ha, 34).add(V3(n * 4 - 6, 0, 0)), up(this.ha, -34).add(V3(n * 4 - 6, 0, 0)), 0.6);   /* IV: 1 H⁺ pumped per e⁻ */
      this.takeH(this.cuB, '“化学” H⁺ → O₂').then(() => eventTag('基质 H⁺ 消耗（复合体 IV 生成水）', this.cuB.clone().add(V3(0, 10, 0)), 1.6)).catch(() => {});
      this.oxygen();
      await mv(mkSp('e⁻', 'e⁻（CuA → 血红素 a → a3–CuB）'), [this.dock2.clone().sub(this.c0).add(this.h0), this.cuA, this.ha, this.a3, this.cuB], 0.55);
      this.reduceO2();
      await this.shuttle(this.dock1, 2.6);
    },
    /* cytochrome c diffuses (not a straight line, around protein) between its two docking sites in the IMS */
    shuttle(to, dur) {
      const ym = this.ym, a = this.cytPos.clone(), P = brownPath(a, to, { n: 14, clear: 12, free0: 14, free1: 14, wander: 0.25, keep: (p) => { p.y = Math.min(p.y, ym - 30); } });
      const c = new THREE.CatmullRomCurve3(P, false, 'centripetal');
      return animP(null, dur / this.ctx.pace(), (u) => { c.getPoint(ease(u), this.cytPos); });
    },
    /* complex IV: one O2 binds at the heme a3 - CuB centre and waits there for the second electron pair */
    oxygen() {
      if (this.o2) return; const ym = this.ym, site = this.a3.clone().lerp(this.cuB, 0.5), o = this.o2 = this.pl('O₂', 'top', 3).take(site);
      travel(o, brownPath(o.position.clone(), site, { free1: 12, keep: (p) => { p.y = Math.max(p.y, ym - 10); } }), 2.4 / this.ctx.pace(), { fadeIn: (o.userData.alpha ?? 1) < 1 ? 0.3 : 0 })
        .then(() => { o.userData.tag?.set('O₂（结合在 a3–CuB）'); o.userData.bound = true; });
    },
    reduceO2() {
      const o = this.o2, site = this.a3.clone().lerp(this.cuB, 0.5);
      if (!o) return;
      this.nE = (this.nE || 0) + 1;
      if (this.nE % 4) { eventTag(`a3–CuB 中心：O₂ 已得到 ${this.nE % 4} 个电子（共需 4 个）`, site.clone().add(V3n(0, 8, 0)), 1.8); return; }
      eventTag('O₂ + 4e⁻ + 4H⁺ → 2 H₂O', site.clone().add(V3n(0, 8, 0)), 2.6);
      o.parent?.remove(o); this.o2 = null;
      const pool = this.pl('H₂O', 'top');
      for (let i = 0; i < 2; i++) { const w = mkSp('H₂O'); w.position.copy(site);
        travel(w, brownPath(site.clone(), pool.region.sample(false) || site.clone().setY(this.ym + 80), { free0: 10, free1: 0 }), 2.6 / this.ctx.pace()).then(() => pool.give(w)).catch(() => {}); }
      this.ctx.counters['O₂ → H₂O'] = (this.ctx.counters['O₂ → H₂O'] || 0) + 1;
    },
    update(ctx, dt) {
      if (!this.busy && !fastMode() && (!cellSim || cellSim.flux.rate > 0.08)) this.cycle();
      if (fastMode() && (!cellSim || cellSim.flux.rate > 0.08)) {   /* fast: the streams show the flux, the counters keep the same stoichiometry (C3) */
        this.facc = (this.facc || 0) + dt * ctx.pace() * 0.12;   /* about the slow-mode NADH rate */
        while (this.facc >= 1) { this.facc--; ctx.counters.NADH++; ctx.counters['H⁺ 泵出（复合体 I / IV）'] += 6; ctx.counters['H⁺ 释放到膜间隙（Q 循环）'] += 4;
          this.nE = (this.nE || 0) + 2; if (this.nE % 4 === 0) ctx.counters['O₂ → H₂O'] = (ctx.counters['O₂ → H₂O'] || 0) + 1; }
      }
      /* cytochrome c follows its animated position; its heme glows while it carries an electron */
      const g = ctx.partGroups(/^细胞色素 c$/)[0];
      if (g?.mesh) g.mesh.position.copy(this.cytPos).sub(this.c0);
      if (!this.heme) { this.heme = ctx.makeParticle(0xff7040, 2.4, null, '细胞色素 c 的血红素'); this.hemeTag = labelObj(this.heme, '细胞色素 c（血红素）', 0xff7040); }
      this.heme.position.copy(this.cytPos).sub(this.c0).add(this.h0); this.heme.scale.setScalar(this.cytLoaded ? 3.4 : 2.0);
      this.hemeTag.set(this.cytLoaded ? '细胞色素 c · Fe²⁺（带 1 个 e⁻）' : '细胞色素 c · Fe³⁺');
      /* ATP synthase: 8 H+ per turn of the c8 ring, 3 ATP per turn */
      const kH = Math.floor(ctx.theta / (2 * Math.PI / 8)), kA = Math.floor(ctx.theta / (2 * Math.PI / 3)), ym = this.ym;
      /* ATP is counted from the H⁺ that went back through the synthase: ATP = H⁺ returned × 3/8 (bovine c8 ring), in both modes (C2) */
      const RET = 'H⁺ 回流（ATP 合酶）';
      if (fastMode()) { if (kH > this.lastH) ctx.counters[RET] += kH - this.lastH; this.lastH = kH; this.lastA = kA; }
      for (; this.lastH < kH; this.lastH++) { ctx.counters[RET]++; protonAcross(this.pl('H⁺', 'bot'), this.pl('H⁺', 'top'), this.atpH, { pace: ctx.pace, label: 'H⁺（ATP 合酶 a 亚基 / c 环）',
        keepIn: (p) => { p.y = Math.min(p.y, ym - 26); }, keepOut: (p) => { p.y = Math.max(p.y, ym + 26); } }).catch(() => {}); }
      for (; this.lastA < kA; this.lastA++) atpFromPools((nm) => this.pl(nm, 'top', nm === 'ATP' ? 0 : 3), this.atpOut, ctx, true).catch(() => {});
      /* the proton ledger: what was sent out = what came back through the synthase + what is still in the intermembrane space */
      const out = ctx.counters['H⁺ 泵出（复合体 I / IV）'] + ctx.counters['H⁺ 释放到膜间隙（Q 循环）'], ret = ctx.counters[RET];
      ctx.counters['H⁺ 膜间隙存量'] = out - ret;
      ctx.counters['ATP（合酶产出）'] = Math.floor(ret * 3 / 8);
      ctx.counters['ATP / NADH'] = ctx.counters.NADH ? +(ctx.counters['ATP（合酶产出）'] / ctx.counters.NADH).toFixed(2) : 0;
      this.flows(ctx, dt);
    },
    /* the rotor only turns while there are protons to return (pmf drives it; the slider sets the top speed) */
    rotorRate() { const c = this.ctx?.counters; if (!c) return 1; const pool = (c['H⁺ 泵出（复合体 I / IV）'] || 0) + (c['H⁺ 释放到膜间隙（Q 循环）'] || 0) - (c['H⁺ 回流（ATP 合酶）'] || 0);
      return pool >= 1 ? Math.min(1, 0.3 + pool / 12) : 0;
    },
    flows(ctx, dt) {
      if (!fastMode()) { if (this.flow) this.flow.visible = false; return; }
      if (!this.flow) {
        const ym = this.ym, up = (p, d) => p.clone().setY(ym + d), T = (n) => this.pl(n, 'top').region, Bt = this.pl('H⁺', 'bot').region, S = (R, f) => R.sample(false) || f;
        const many = (n, fn) => Array.from({ length: n }, fn);
        const cyt = [this.c1, this.dock1.clone().sub(this.c0).add(this.h0), ...brownPath(this.dock1, this.dock2, { n: 8, clear: 12, free0: 14, free1: 14, keep: (p) => { p.y = Math.min(p.y, ym - 30); } }), this.cuA];
        const ePath = [this.nadh, ...this.chainI, this.qI, up(this.qI, 2), up(this.Qo, 2), this.Qo, this.isp, ...cyt, this.ha, this.a3, this.cuB];
        const pump = [...this.pumpI, this.Qo, this.ha].map(q => q.clone());
        const H = many(10, (_, i) => { const q = pump[i % pump.length]; return [...brownPath(S(T('H⁺'), up(q, 80)), up(q, 26), { free1: 4 }), up(q, 0), ...brownPath(up(q, -26), S(Bt, up(q, -80)), { free0: 4, free1: 0 })]; });
        const HB = many(6, () => [...brownPath(S(Bt, up(this.atpH[0], -80)), this.atpH[0], { free1: 4 }), ...this.atpH.slice(1), ...brownPath(this.atpH[3], S(T('H⁺'), up(this.atpH[3], 80)), { free0: 4, free1: 0 }).slice(1)]);
        this.flow = new FlowLayer([
          { label: 'e⁻ 流：NADH → I → Q → III → cyt c → IV → O₂', col: 0x6ff4ff, r: 2.0, paths: [ePath], per: 2, v: 120, spread: 1.2 },
          { label: 'H⁺：基质 → 膜间隙（泵出 + Q 循环释放）', col: 0xfff27a, r: 2.0, paths: H, per: 10, v: 90 },
          { label: 'H⁺ 回流：经 ATP 合酶 → 基质', col: 0xffd84a, r: 2.0, paths: HB, per: 10, v: 90 },
          { label: 'NADH 流入', col: 0xff6fa8, r: 3.0, paths: many(3, () => brownPath(S(T('NADH'), up(this.nadh, 90)), this.nadh, { free1: 8 })), per: 1, v: 60 },
          { label: 'O₂ 流入 → H₂O', col: 0x7ab8ff, r: 2.8, paths: many(3, () => brownPath(S(T('O₂'), up(this.cuB, 90)), this.a3, { free1: 12 })), per: 0.5, v: 60 },
          { label: 'ATP 流出', col: 0xff9a2e, r: 2.8, paths: many(3, () => brownPath(this.atpOut, S(T('ATP'), up(this.atpOut, 80)), { free0: 8, free1: 0 })), per: 2.5, v: 60 } ]);
      }
      this.flow.visible = true; this.flow.update(dt, 1.5 * ctx.pace());
    },
  },

