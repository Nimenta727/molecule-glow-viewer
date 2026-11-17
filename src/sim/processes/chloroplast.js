  chloroplast: {
    lead: '叶绿体光反应：光把水的电子送到 NADPH，腔内累积的 H⁺ 驱动 ATP 合酶。',
    /* compartment model (stroma / thylakoid lumen): mM, s. Lumen pH 7 -> ~5.6 in light, stroma 7 -> ~8.1; photosynthetic
       control (b6f slows when lumen pH < ~5.8), ATP synthase driven by pmf above threshold, Calvin cycle 3 ATP + 2 NADPH / CO2
       (enzymes light-activated via thioredoxin, tau ~6 s), cyclic electron flow when NADPH is high (2 H+/e-, no NADPH). */
    cell: {
      init: () => ({ L: 0, act: 0, dpH: 0, nadph: 0.05, atp: 0.5 }),
      step(s, h, c) {
        s.L += ((c.light ? 1 : 0) - s.L) * Math.min(1, h / 0.3); s.act += ((c.light ? 1 : 0) - s.act) * Math.min(1, h / 6);
        const Nt = 0.5, At = 1.5, dpH = s.dpH, nadp = Nt - s.nadph, adp = At - s.atp;
        const fbp = 1 / (1 + Math.exp((dpH - 2.5) / 0.15));
        const Je = 0.8 * s.L * fbp * nadp / (nadp + 0.04), Jc = c.cef ? 0.35 * s.L * fbp * (s.nadph / Nt) ** 2 : 0;
        const dpsi = 20 * (1 - Math.exp(-dpH / 0.6)), pmf = 59 * dpH + dpsi, x = Math.max(0, (pmf - 95) / 45);
        const Jatp = c.oligo ? 0 : 0.55 * x / (1 + x) * adp / (adp + 0.25), Jleak = 0.07 * dpH * (c.unc ? 20 : 1);
        s.dpH = Math.max(0, dpH + h * (3 * Je + 2 * Jc - 14 / 3 * Jatp - Jleak) / 1.2);
        const Jcal = 0.12 * s.act * s.atp / (s.atp + 0.3) * s.nadph / (s.nadph + 0.05);
        s.nadph = Math.min(Nt, Math.max(0, s.nadph + h * (Je / 2 - 2 * Jcal)));
        s.atp = Math.min(At, Math.max(0, s.atp + h * (Jatp - 3 * Jcal - 0.01 * s.atp)));
        return { Je, Jc, Jatp, Jcal, pmf, rate: Je / 0.3, rotor: Math.min(2.5, Jatp / 0.24) };
      },
      controls: [
        { id: 'light', label: '☀ 光照', on: true, tip: '关灯：电子传递停止，看 ΔpH 和 ATP 怎样消退' },
        { id: 'cef', label: '环式电子流', on: true, tip: 'Fd → PQ → b6f → PSI：只泵 H⁺、不产 NADPH，补足 ATP' },
        { id: 'unc', label: '解偶联剂', on: false, tip: '例如 NH₄Cl / 尼日利亚菌素：H⁺ 直接漏回基质' },
        { id: 'oligo', label: '抑制 ATP 合酶', on: false, tip: '例如 tentoxin：H⁺ 出不去' } ],
      series: [
        { label: '类囊体腔 pH', range: [5.2, 7.4], color: '#ff7a3d', get: (s) => 7.0 - 0.55 * s.dpH, fmt: (v) => v.toFixed(2) },
        { label: '基质 pH', range: [6.8, 8.4], color: '#4f8ff0', get: (s) => 7.0 + 0.45 * s.dpH, fmt: (v) => v.toFixed(2) },
        { label: '质子动力势', range: [0, 190], color: '#c04fd0', get: (s, f) => f.pmf, fmt: (v) => v.toFixed(0) + ' mV' },
        { label: '电子流', range: [0, 1.5], color: '#22b8cf', get: (s, f) => f.Je / 0.3, fmt: (v) => (v * 100).toFixed(0) + ' %' },
        { label: 'ATP', range: [0, 1.5], color: '#e8a000', get: (s) => s.atp, fmt: (v) => v.toFixed(2) + ' mM' },
        { label: 'NADPH', range: [0, 0.5], color: '#d9480f', get: (s) => s.nadph, fmt: (v) => v.toFixed(2) + ' mM' },
        { label: 'CO₂ 固定', range: [0, 0.1], color: '#2f9e44', get: (s, f) => f.Jcal, fmt: (v) => (v / 0.079 * 100).toFixed(0) + ' %' } ],
      comps: (s) => [{ name: '基质（stroma）', pH: 7.0 + 0.45 * s.dpH }, { name: '类囊体腔（lumen）', pH: 7.0 - 0.55 * s.dpH }],
      dots: [
        { label: 'H⁺', comp: 'bot', color: 0xfff27a, ink: 0xf5c400, r: 2.0, max: 60, count: (s) => 1 + 40 * Math.pow(10, 5.6 - (7.0 - 0.55 * s.dpH)) },
        { label: 'H⁺', comp: 'top', color: 0xfff27a, ink: 0xf5c400, r: 2.0, max: 20, count: (s) => 1 + 40 * Math.pow(10, 5.6 - (7.0 + 0.45 * s.dpH)) },
        { label: 'ATP', comp: 'top', color: 0xff9a2e, ink: 0xf07a12, r: 3.0, max: 40, count: (s) => 30 * s.atp / 1.5 },
        { label: 'NADPH', comp: 'top', color: 0xff6fa8, ink: 0xd9467e, r: 3.4, max: 30, count: (s) => 24 * s.nadph / 0.5 } ],
      explain(s, f, c) {
        const lp = (7 - 0.55 * s.dpH).toFixed(1), sp = (7 + 0.45 * s.dpH).toFixed(1);
        if (!c.light) return s.dpH > 0.3 ? `黑暗：电子传递停止，腔内积累的 H⁺ 经 ATP 合酶和漏流回到基质，ΔpH 正在消退（腔 pH ${lp}）；卡尔文循环的酶随之失活。` : '黑暗：没有质子梯度，ATP 合酶停转，卡尔文循环停止。按“☀ 光照”看光照后几秒内腔内怎样酸化。';
        if (c.unc) return '解偶联剂让 H⁺ 不经 ATP 合酶直接漏回基质：ΔpH 崩塌，ATP 合酶停转，ATP 耗尽，卡尔文循环停下，NADPH 堆积，电子传递也因没有 NADP⁺ 而停。';
        if (c.oligo) return `ATP 合酶被抑制：H⁺ 只进不出，腔 pH 降到约 ${lp} 后 b6f 被“反压”抑制（光合控制，保护 PSII），电子流变慢；没有 ATP，卡尔文循环停下。`;
        if (!c.cef && s.atp < 0.6) return '没有环式电子流：线性电子流每个 NADPH 只配约 1.29 个 ATP，卡尔文循环需要 1.5 → ATP 不够、NADPH 堆积，NADP⁺ 不足又卡住了电子传递。再打开“环式电子流”。';
        if (s.dpH < 2) return `刚开灯：电子传递把 H⁺ 泵进类囊体腔，腔 pH 迅速下降（${lp}），基质变碱（${sp}）；ΔpH 超过阈值后 ATP 合酶开始转动。`;
        return `光照稳态：腔 pH ≈ ${lp}，基质 pH ≈ ${sp}，ΔpH ≈ ${s.dpH.toFixed(1)}（叶绿体的质子动力势主要是 ΔpH）。ATP 和 NADPH 被卡尔文循环按 3 : 2 消耗${c.cef ? '，环式电子流补足 ATP' : ''}。`;
      },
    },
    energyHL: [['LHCII 天线', 'PSII 核心'], ['PSII 核心', '放氧复合体蛋白'], ['PSII 核心', 'Cyt b6f'], ['质体蓝素', 'Cyt b6f', 'PSI-LHCI'], ['PSI-LHCI'], ['PSI-LHCI', '铁氧还蛋白', 'FNR'], ['ATP 合酶']],
    energy: [
      ['光能捕获', '天线叶绿素吸收光子（680 nm 红光约 1.82 eV，每摩尔光子约 176 kJ），激发能经共振能量转移在几十皮秒内汇集到反应中心 P680。每轮动画 = 2 个电子 = 1 个 NADPH，PSII 和 PSI 各需 2 个光子。'],
      ['PSII：电荷分离 + 水裂解', 'P680* 把电子交给去镁叶绿素（约 3 ps）→ QA → 非血红素铁 → QB；留下的 P680⁺（约 +1.2 V，生物界最强氧化剂）经 D1 的 Tyr161（TyrZ）从 Mn₄CaO₅ 簇夺回电子。锰簇攒够 4 个氧化当量，把 2 H₂O 氧化成 O₂（O₂/H₂O E°′ = +0.82 V），4 个 H⁺ 留在类囊体腔。QB 接 2 个电子并从基质摄取 2 个 H⁺ 成为 PQH₂。'],
      ['质体醌 → b6f：Q 循环', 'PQH₂ 在膜内扩散到 b6f 的 Qo 位点被氧化：一个电子经 Rieske 铁硫簇 → 细胞色素 f（高电位链，约 +0.37 V）；另一个经血红素 bL → bH → cn 回到 Qi 位点还原质体醌（低电位链，需基质 H⁺）。每 2 个电子向腔里释放 4 个 H⁺。'],
      ['质体蓝素穿梭', '质体蓝素（Cu）在类囊体腔里一次运 1 个电子，从细胞色素 f 送到 PSI 的 P700⁺（每轮往返 2 次，动画画出两趟）。'],
      ['PSI：第二次光激发', 'P700（约 +0.45 V）吸收 700 nm 光子（约 1.77 eV）变成 P700*（约 −1.3 V），电子经 A0（叶绿素）→ A1（叶绿醌）→ FX → FA → FB 铁硫簇到达基质表面。两个光系统串联、能量“两次爬坡”，画成电位图就是 Z 形，所以叫 Z 方案。'],
      ['Fd → FNR → NADPH', '铁氧还蛋白（−0.42 V）把电子带给 FNR；FNR 的 FAD 攒够 2 个电子，以 H⁻ 形式交给 NADP⁺（E°′ = −0.32 V），从基质再取 1 个 H⁺ → NADPH。总账：H₂O → NADP⁺，ΔE°′ ≈ 1.14 V，2 个电子 ΔG°′ ≈ +220 kJ/mol（上坡），由 4 个光子（约 690 kJ/mol）推动，光能约 1/3 存进 NADPH。'],
      ['质子动力势 → ATP', '每 2 个电子约 6 个 H⁺ 进入类囊体腔（水裂解 2 + Q 循环 4），腔 pH 可降到约 5。H⁺ 经 CF1Fo ATP 合酶流回基质：c14 环每转 14 个 H⁺ 合成 3 个 ATP（约 4.7 H⁺/ATP）→ 线性电子流约 1.3 ATP/NADPH，而卡尔文循环需要 1.5；不足的 ATP 由环式电子流（Fd → PQ → b6f → PSI，只泵 H⁺、不产 NADPH）补上。'] ],
    stage() { return this.stg || 0; },
    caption: '光子（红）激发 PSII 的 P680，电子（青）从水经 PSII → 质体醌 → b6f → 质体蓝素 → PSI（再次激发）→ 铁氧还蛋白 → FNR，生成 NADPH；水裂解放出 O₂（蓝），H⁺（黄）在类囊体腔累积，经 ATP 合酶回流合成 ATP（3JCU 菠菜 PSII-LHCII + 6RQF 菠菜 b6f + 5L8R 豌豆 PSI-LHCI + 1PLC 质体蓝素 + 1A70 铁氧还蛋白 + 1FNB FNR + 6FKF 菠菜 ATP 合酶；位置为示意，上方 = 基质，下方 = 类囊体腔）',
    async setup(ctx) {
      const V3 = (x, y, z) => new THREE.Vector3(x, y, z), all = ctx.allAtoms, ym = this.ym = ctx.membraneY[0] ?? 0;
      const near = (p, f = () => true) => { let b = null, bd = 1e9; for (const a of all) if (f(a)) { const d = a.p.distanceToSquared(p); if (d < bd) { bd = d; b = a; } } return b; };
      const ring = (L) => { const r = L.atoms.filter(x => ['MG', 'NA', 'NB', 'NC', 'ND'].includes(x.name)); return (r.length ? r : L.atoms).reduce((s, x) => s.add(x.p), V3(0, 0, 0)).multiplyScalar(1 / (r.length || L.atoms.length)); };
      const lig = (comp, lab) => ctx.ligands.filter(l => l.comp === comp && (lab ? l.compLabel === lab : !l.compLabel));
      const pts = (comp, lab) => lig(comp, lab).map(ring);
      const cen = (re) => { const A = ctx.atomsOf(re); return A.reduce((s, a) => s.add(a.p), V3(0, 0, 0)).multiplyScalar(1 / Math.max(1, A.length)); };
      const by = (p) => (a, b) => a.distanceTo(p) - b.distanceTo(p), entIs = (p, re) => re.test(near(p)?.entName || '');
      const row = ctx.rowDir || V3(1, 0, 0);
      /* ---- PSII: the monomer facing b6f */
      const b6C = cen(/^Cyt b6f$/), psiC = cen(/^PSI-LHCI$/);
      const oex = pts('OEX').sort(by(b6C))[0] || cen(/^PSII 核心$/).setY(ym - 15);
      const pheos = pts('PHO').sort(by(oex)).slice(0, 2), pm = pheos.length === 2 ? pheos[0].clone().lerp(pheos[1], 0.5) : oex.clone().setY(ym);
      const pheo = pheos.find(p => entIs(p, /protein D1/)) || pheos[0] || pm;
      const chl = pts('CLA').filter(p => p.distanceTo(pm) < 18 && p.y < pm.y + 2); let best = null, bd = 1e9;
      for (let i = 0; i < chl.length; i++) for (let j = i + 1; j < chl.length; j++) { const d = chl[i].distanceTo(chl[j]); if (d < bd) { bd = d; best = [chl[i], chl[j]]; } }
      const P680 = best && bd < 12 ? best[0].clone().lerp(best[1], 0.5) : oex.clone().lerp(pm, 0.55);
      const tyrZ = near(oex, a => a.resn === 'TYR' && +a.aseq === 161 && /protein D1/.test(a.entName || ''))?.p.clone() || oex.clone().lerp(P680, 0.5);
      const fe2 = pts('FE2').sort(by(pm))[0] || pm.clone().setY(ym + 12);
      const qs = pts('PL9').filter(p => p.distanceTo(fe2) < 22);
      const QA = qs.find(p => entIs(p, /D2 protein/)) || fe2.clone().addScaledVector(row, -7);
      const QB = qs.find(p => entIs(p, /protein D1/)) || fe2.clone().multiplyScalar(2).sub(QA);
      /* ---- b6f: cyt f facing PSI; bL nearest it; bH matrix-side of bL; heme cn next to bH; Rieske between */
      const f = pts('HEC', 'Cyt b6f').filter(p => p.y < ym - 10).sort(by(psiC))[0] || b6C.clone().setY(ym - 35);
      const hems = pts('HEM', 'Cyt b6f'), bL = hems.sort(by(f))[0] || f.clone().setY(ym - 8);
      const bH = hems.filter(h => h !== bL && h.y > bL.y + 6).sort(by(bL))[0] || bL.clone().add(V3(0, 18, 0));
      const cn = pts('HEC', 'Cyt b6f').filter(p => p.y > ym).sort(by(bH))[0] || bH.clone().add(V3(0, 6, 0));
      const isp = pts('FES', 'Cyt b6f').sort(by(bL.clone().lerp(f, 0.5)))[0] || bL.clone().lerp(f, 0.5);
      /* ---- PSI: P700 = chl a' + its partner; A1 = phylloquinone; FX, FA, FB in order of distance */
      const cl0 = pts('CL0', 'PSI-LHCI')[0] || psiC.clone().setY(ym - 12);
      const partner = pts('CLA', 'PSI-LHCI').sort(by(cl0))[0], P700 = partner && partner.distanceTo(cl0) < 12 ? cl0.clone().lerp(partner, 0.5) : cl0;
      const A1 = pts('PQN', 'PSI-LHCI').sort(by(P700))[0] || P700.clone().add(V3(0, 18, 0));
      const A0 = pts('CLA', 'PSI-LHCI').filter(p => p.distanceTo(P700) < 16 && p.distanceTo(A1) < 14).sort(by(A1))[0];
      const fs = pts('SF4', 'PSI-LHCI').sort(by(P700)), FX = fs[0] || A1.clone().add(V3(0, 12, 0)), FA = fs[1] || FX.clone().add(V3(0, 12, 0)), FB = fs[2] || FA.clone().add(V3(0, 10, 0));
      Object.assign(this, { oex, tyrZ, P680, pheo, QA, fe2, QB, f, bL, bH, cn, isp, Qo: bL.clone().lerp(isp, 0.45), Qi: cn.clone().lerp(bH, 0.3), P700, A0, A1, FX, FA, FB });
      /* ---- antenna chlorophylls (photon targets) */
      this.ant2 = pts('CLA').concat(pts('CHL')).filter(p => p.distanceTo(P680) > 25 && p.distanceTo(P680) < 70);
      this.ant1 = pts('CLA', 'PSI-LHCI').filter(p => p.distanceTo(P700) > 25);
      /* ---- shuttles: their own cofactor is hidden, the animation draws it on the moving protein */
      const shuttle = (lab, comp) => { const L = lig(comp, lab)[0]; if (L) ctx.hideLigand(L); const c0 = cen(new RegExp('^' + lab + '$')); return { c0, h0: L ? L.centre.clone() : c0.clone(), pos: c0.clone() }; };
      this.pc = shuttle('质体蓝素', 'CU'); this.fd = shuttle('铁氧还蛋白', 'FES');
      this.pc.dock1 = f.clone().add(V3(0, -20, 0)); this.pc.dock2 = P700.clone().add(V3(0, -26, 0)); this.pc.pos.copy(this.pc.dock1);
      const fad = pts('FAD', 'FNR')[0] || cen(/^FNR$/), fnrC = cen(/^FNR$/);
      this.fad = fad; this.fd.dock1 = FB.clone().add(V3(0, 20, 0));
      this.fd.dock2 = fnrC.clone().add(this.fd.dock1.clone().sub(fnrC).normalize().multiplyScalar(30)); this.fd.pos.copy(this.fd.dock1);
      this.nadp = fad.clone().add(V3(0, 26, 0)).addScaledVector(row, 10);
      /* ---- ATP synthase: H+ path at the a-subunit / c-ring interface (lumen -> stroma); ATP leaves the CF1 head */
      const aSub = cen(/ATP 合酶 · .*subunit a,/), beta = cen(/ATP 合酶 · .*subunit beta/);
      this.atpH = [aSub.clone().setY(ym - 34), aSub.clone().setY(ym - 6), aSub.clone().setY(ym + 6), aSub.clone().setY(ym + 34)];
      this.atpOut = beta.clone().add(V3(0, 18, 0));
      this.lastA = Math.floor(ctx.theta / (2 * Math.PI / 3)); this.lastH = Math.floor(ctx.theta / (2 * Math.PI / 14));
      Object.assign(ctx.counters, { '光子': 0, 'O₂': 0, 'H⁺ 入腔': 0, NADPH: 0, ATP: 0 });
      this.marks = [P680, P700].map((p, i) => { const m = ctx.makeParticle(0x9dff6a, 2.0, i ? 'P700（PSI 反应中心）' : 'P680（PSII 反应中心）'); m.position.copy(p); return m; });
      ctx.markHot([oex, tyrZ, P680, pheo, QA, fe2, QB, f, bL, bH, cn, isp, P700, A1, FX, FA, FB, fad], 7);
      this.busy = false; this.stg = 0; this.n = 0;
    },
    move(p, pts, per, done) {   // hop a particle through points (electrons between cofactors); per = seconds per 20 A
      const ctx = this.ctx, k = ctx.pace(); let i = 0; p.position.copy(pts[0]);
      const go = () => { if (i >= pts.length - 1) { done ? done(p) : p.parent?.remove(p); return; }
        const a = pts[i].clone(), b = pts[i + 1].clone(); i++; ctx.anim(p, (per * (0.35 + a.distanceTo(b) / 20)) / k, (u) => { p.position.copy(a).lerp(b, ease(u)); }, go); };
      go();
    },
    /* bulk pools: top = stroma, bot = thylakoid lumen (the cell sim's compartments when it runs) */
    pl(name, comp, n = 0) { const ym = this.ym, c = model.focus.centre;
      return spPool(name, comp, shellRegion(V3n(c.x, ym + (comp === 'top' ? 80 : -80), c.z), 0, 220, (p) => comp === 'top' ? p.y > ym + 28 : p.y < ym - 28), n); },
    async cycle() {
      const ctx = this.ctx, V3 = (x, y, z) => new THREE.Vector3(x, y, z), ym = this.ym, up = (p, d) => p.clone().setY(ym + d);
      const k = () => ctx.pace(), wait = (s) => animP(null, Math.max(0.02, s / k()), () => {});
      const hop = (p, pts, per) => new Promise(r => this.move(p, pts, per, (q) => { q.parent?.remove(q); r(); }));
      const two = (fn) => Promise.all([fn(), wait(0.35).then(fn)]);   // 2 electrons per NADPH
      const fi = (o) => ({ fadeIn: (o.userData.alpha ?? 1) < 1 ? 0.3 : 0 });
      const keepS = (p) => { p.y = Math.max(p.y, ym + 26); }, keepL = (p) => { p.y = Math.min(p.y, ym - 26); };
      /* a photon (straight line: light does not diffuse) is absorbed by an antenna chlorophyll; the excitation hops by resonance
         energy transfer from chlorophyll to chlorophyll to the reaction centre */
      const photon = async (target, ant, mark, name) => {
        const a = ant.length ? ant[Math.floor(rand() * ant.length)] : target.clone().add(V3(20, 0, 0));
        const ph = mkSp('光子 hν', name === 'P680' ? '光子 hν（680 nm）' : '光子 hν（700 nm）'); ctx.counters['光子']++;
        const s = a.clone().add(V3((rand() - 0.5) * 80, 130, (rand() - 0.5) * 80)); ph.userData.alpha = 0;
        await travel(ph, [s, a], 0.9 / k(), { fadeIn: 0.25 });
        ph.parent?.remove(ph); eventTag('天线叶绿素吸收光子 → 激发态', a.clone().add(V3(0, 6, 0)), 1.6);
        const mid = ant.filter(p => p.distanceTo(a) < 30 && p.distanceTo(target) < a.distanceTo(target)).sort((x, y) => y.distanceTo(target) - x.distanceTo(target)).slice(0, 2);
        await hop(mkSp('激发能', '激发能（共振转移）'), [a, ...mid, target], 0.25);
        eventTag(name + ' → ' + name + '*（激发态，电荷分离）', target.clone().add(V3(0, -8, 0)), 1.8);
        mark.scale.setScalar(3.6); ctx.anim(null, 0.6, (u) => { mark.scale.setScalar(3.6 - 1.6 * u); });
      };
      /* H+ set free in the lumen at a site (water splitting, PQH2 at Qo) */
      const releaseH = async (at, delay) => { await wait(delay); ctx.counters['H⁺ 入腔']++;
        const h = mkSp('H⁺'), pool = this.pl('H⁺', 'bot'), out = at.clone().setY(Math.min(at.y - 6, ym - 26)); h.position.copy(at);
        await travel(h, [at.clone(), at.clone().lerp(out, 0.5), out], 0.8 / k(), { ease: true });
        await travel(h, brownPath(out, pool.region.sample(false) || out.clone().setY(ym - 70), { free0: 6, free1: 0, keep: keepL }), 1.6 / k());
        pool.give(h); };
      /* a stroma H+ is used up at a site (QB, Qi, FNR) */
      const takeH = async (site, label) => { const h = this.pl('H⁺', 'top').take(site), mouth = site.clone().setY(Math.max(site.y + 12, ym + 26));
        await travel(h, brownPath(h.position.clone(), mouth, { free1: 6, keep: keepS }), 1.8 / k(), fi(h));
        h.userData.tag?.set(label); await travel(h, [mouth, site], 0.6 / k(), { ease: true, remove: true }); };
      const shuttle = (s, to, dur, keep) => { const P = brownPath(s.pos.clone(), to, { n: 14, clear: 12, free0: 14, free1: 14, wander: 0.25, keep }), c = new THREE.CatmullRomCurve3(P, false, 'centripetal');
        return animP(null, dur / k(), (u) => { c.getPoint(ease(u), s.pos); }); };
      this.busy = true; this.n++;
      /* 0-1: two photons at PSII, charge separation, water splitting */
      this.stg = 0;
      const water = this.pl('H₂O', 'bot', 6).take(this.oex);
      const wIn = travel(water, brownPath(water.position.clone(), this.oex, { free1: 10, keep: keepL }), 2.4 / k(), fi(water)).then(() => water.parent?.remove(water));
      await two(() => photon(this.P680, this.ant2, this.marks[0], 'P680'));
      this.stg = 1;
      await Promise.all([ wIn,
        two(() => hop(mkSp('e⁻'), [this.P680, this.pheo, this.QA, this.fe2, this.QB], 0.45)),
        two(() => hop(mkSp('e⁻', 'e⁻（来自水，经 TyrZ）'), [this.oex, this.tyrZ, this.P680], 0.6)),
        wait(0.2).then(() => eventTag('锰簇：H₂O 被氧化（每 4 个电子放出 1 个 O₂）', this.oex.clone().add(V3(0, -8, 0)), 2.4)),
        releaseH(this.oex, 0.3), releaseH(this.oex.clone().addScaledVector(ctx.rowDir, 3), 0.7),
        takeH(this.QB.clone().add(V3(-2, 0, 0)), 'H⁺ → QB'), wait(0.4).then(() => takeH(this.QB.clone().add(V3(2, 0, 0)), 'H⁺ → QB')),
        this.n % 2 === 0 ? wait(1.0).then(async () => { ctx.counters['O₂']++; eventTag('2 H₂O → O₂ + 4H⁺ + 4e⁻', this.oex.clone().add(V3(0, -14, 0)), 2.4);
          const o = mkSp('O₂'), pool = this.pl('O₂', 'bot'); o.position.copy(this.oex);
          await travel(o, brownPath(this.oex.clone(), pool.region.sample(false) || up(this.oex, -80), { free0: 10, free1: 0, keep: keepL }), 3.0 / k()); pool.give(o); }) : null,
      ]);
      /* 2: PQH2 through the membrane to Qo; Q cycle */
      this.stg = 2; eventTag('PQ + 2e⁻ + 2H⁺ → PQH₂', this.QB.clone().add(V3(0, 6, 0)), 2.0);
      { const q = mkSp('PQH₂', 'PQH₂（质体醌醇，在膜内扩散）'), path = [this.QB, ...brownPath(up(this.QB, 2), up(this.Qo, 2), { n: 14, clear: 6, free0: 6, free1: 6, keep: (p) => { p.y = ym + 2 + (p.y - ym - 2) * 0.2; } }), this.Qo];
        await travel(q, path, 3.2 / k(), { remove: true }); }
      eventTag('PQH₂ → PQ + 2H⁺ + 2e⁻（Qo 位点，Q 循环）', this.Qo.clone().add(V3(0, -6, 0)), 2.2);
      await Promise.all([
        ...[0, 1, 2, 3].map(i => releaseH(this.Qo.clone().addScaledVector(ctx.rowDir, (i - 1.5) * 3), i * 0.3)),
        hop(mkSp('e⁻', 'e⁻（低电位链 bL → bH → cn）'), [this.Qo, this.bL, this.bH, this.cn, this.Qi], 0.6),
        takeH(this.Qi.clone().add(V3(-2, 0, 0)), 'H⁺ → Qi'), wait(0.4).then(() => takeH(this.Qi.clone().add(V3(2, 0, 0)), 'H⁺ → Qi')),
        two(() => hop(mkSp('e⁻', 'e⁻（Rieske → 细胞色素 f）'), [this.Qo, this.isp, this.f], 0.6)),
      ]);
      /* 3: plastocyanin carries the electron from cyt f to P700 (diffusing through the lumen, around the proteins) */
      const pc = this.pc;
      for (let trip = 0; trip < 2; trip++) {   /* 2 electrons per cycle: plastocyanin carries one per trip, so it goes twice */
        this.stg = 3;
        await hop(mkSp('e⁻'), [this.f, pc.pos.clone().sub(pc.c0).add(pc.h0)], 0.6); pc.loaded = true;
        await shuttle(pc, pc.dock2, 2.6, (p) => { p.y = Math.min(p.y, ym - 30); });
        this.stg = 4; pc.loaded = false;
        await hop(mkSp('e⁻', `e⁻（质体蓝素第 ${trip + 1} 趟）`), [pc.dock2.clone().sub(pc.c0).add(pc.h0), this.P700], 0.5);
        const back = shuttle(pc, pc.dock1, 2.6, (p) => { p.y = Math.min(p.y, ym - 30); }); if (trip === 0) await back;
      }
      /* 4: second photon pair at PSI; electron down the PSI chain */
      await two(() => photon(this.P700, this.ant1, this.marks[1], 'P700'));
      const fd = this.fd, fdH = () => fd.pos.clone().sub(fd.c0).add(fd.h0);
      await two(() => hop(mkSp('e⁻', 'e⁻（A0 → A1 → FX → FA → FB）'), [this.P700, ...(this.A0 ? [this.A0] : []), this.A1, this.FX, this.FA, this.FB, fdH()], 0.4));
      /* 5: ferredoxin -> FNR -> NADPH */
      this.stg = 5; fd.loaded = true;
      await shuttle(fd, fd.dock2, 2.4, (p) => { p.y = Math.max(p.y, ym + 30); });
      fd.loaded = false; await hop(mkSp('e⁻'), [fdH(), this.fad], 0.5);
      eventTag('FAD 攒够 2 个电子 → FADH⁻', this.fad.clone().add(V3(0, 8, 0)), 2.0);
      shuttle(fd, fd.dock1, 2.4, (p) => { p.y = Math.max(p.y, ym + 30); });
      { const nadp = this.pl('NADP⁺', 'top', 3).take(this.nadp), h = takeH(this.fad.clone().add(V3(4, 4, 0)), 'H⁺ → FNR');
        await Promise.all([travel(nadp, brownPath(nadp.position.clone(), this.fad, { free1: 10, keep: keepS }), 2.4 / k(), fi(nadp)), h]); nadp.parent?.remove(nadp); }
      ctx.counters.NADPH++; eventTag('NADP⁺ + 2e⁻ + H⁺ → NADPH', this.fad.clone().add(V3(0, 10, 0)), 2.4);
      { const m = mkSp('NADPH'), pool = this.pl('NADPH', 'top'); m.position.copy(this.fad);
        travel(m, brownPath(this.fad.clone(), pool.region.sample(false) || this.nadp.clone().add(V3(10, 60, 10)), { free0: 10, free1: 0, keep: keepS }), 2.8 / k()).then(() => pool.give(m)); }
      /* 6: ATP synthase runs continuously (see update); give it a moment on the strip */
      this.stg = 6; await wait(2.6);
      this.busy = false;
    },
    update(ctx, dt) {
      if (!this.busy && !fastMode() && (!cellSim || cellSim.flux.rate > 0.08)) this.cycle().catch((e) => console.warn(e));
      for (const [lab, s, col, t0, t1] of [['质体蓝素', this.pc, 0x4ad6ff, '质体蓝素 · Cu²⁺', '质体蓝素 · Cu⁺（带 1 个 e⁻）'], ['铁氧还蛋白', this.fd, 0xff8a5a, '铁氧还蛋白 · 氧化态', '铁氧还蛋白 · 还原态（带 1 个 e⁻）']]) {
        const g = ctx.partGroups(new RegExp('^' + lab + '$'))[0]; if (g?.mesh) g.mesh.position.copy(s.pos).sub(s.c0);
        if (!s.glow) { s.glow = ctx.makeParticle(col, 2.2, null, t0); s.tag = labelObj(s.glow, t0, col); }
        s.glow.position.copy(s.pos).sub(s.c0).add(s.h0); s.glow.scale.setScalar(s.loaded ? 3.4 : 2.0); s.tag.set(s.loaded ? t1 : t0);
      }
      /* CF1Fo: 14 H+ per turn of the c14 ring, 3 ATP per turn */
      const kH = Math.floor(ctx.theta / (2 * Math.PI / 14)), kA = Math.floor(ctx.theta / (2 * Math.PI / 3)), ym = this.ym;
      if (fastMode()) { this.lastH = kH; this.lastA = kA; }
      for (; this.lastH < kH; this.lastH++) protonAcross(this.pl('H⁺', 'bot'), this.pl('H⁺', 'top'), this.atpH, { pace: ctx.pace, label: 'H⁺（ATP 合酶 a 亚基 / c 环）',
        keepIn: (p) => { p.y = Math.min(p.y, ym - 26); }, keepOut: (p) => { p.y = Math.max(p.y, ym + 26); } }).catch(() => {});
      for (; this.lastA < kA; this.lastA++) atpFromPools((nm) => this.pl(nm, 'top', nm === 'ATP' ? 0 : 3), this.atpOut, ctx).catch(() => {});
      this.flows(ctx, dt);
    },
    flows(ctx, dt) {
      if (!fastMode()) { if (this.flow) this.flow.visible = false; return; }
      if (!this.flow) {
        const ym = this.ym, up = (p, d) => p.clone().setY(ym + d), St = this.pl('H⁺', 'top').region, Lu = this.pl('H⁺', 'bot').region, S = (R, f) => R.sample(false) || f;
        const many = (n, fn) => Array.from({ length: n }, fn), pc = this.pc, fd = this.fd;
        const lum = (a, b) => brownPath(a, b, { n: 8, clear: 12, free0: 14, free1: 14, keep: (p) => { p.y = Math.min(p.y, ym - 30); } });
        const str = (a, b) => brownPath(a, b, { n: 8, clear: 12, free0: 14, free1: 14, keep: (p) => { p.y = Math.max(p.y, ym + 30); } });
        const ePath = [this.oex, this.tyrZ, this.P680, this.pheo, this.QA, this.fe2, this.QB, up(this.QB, 2), up(this.Qo, 2), this.Qo, this.isp, this.f, ...lum(pc.dock1, pc.dock2), this.P700,
          ...(this.A0 ? [this.A0] : []), this.A1, this.FX, this.FA, this.FB, ...str(fd.dock1, fd.dock2), this.fad];
        const ph = (ant) => many(4, () => { const a = ant[Math.floor(rand() * ant.length)] || this.P680; return [a.clone().add(V3n((rand() - 0.5) * 80, 140, (rand() - 0.5) * 80)), a]; });
        const Hin = many(8, (_, i) => i % 3 === 0 ? [this.oex, ...brownPath(up(this.oex, -26), S(Lu, up(this.oex, -80)), { free0: 4, free1: 0 })]
          : [...brownPath(S(St, up(this.QB, 80)), up(this.QB, 26), { free1: 4 }), this.QB, up(this.QB, 2), up(this.Qo, 2), this.Qo, ...brownPath(up(this.Qo, -26), S(Lu, up(this.Qo, -80)), { free0: 4, free1: 0 })]);
        const Hout = many(6, () => [...brownPath(S(Lu, up(this.atpH[0], -80)), this.atpH[0], { free1: 4 }), ...this.atpH.slice(1), ...brownPath(this.atpH[3], S(St, up(this.atpH[3], 80)), { free0: 4, free1: 0 }).slice(1)]);
        this.flow = new FlowLayer([
          { label: '光子 hν', col: 0xff5a5a, r: 1.8, paths: [...ph(this.ant2), ...ph(this.ant1)], per: 4, v: 260, spread: 0.5 },
          { label: 'e⁻ 流：H₂O → PSII → PQ → b6f → PC → PSI → Fd → FNR', col: 0x6ff4ff, r: 2.0, paths: [ePath], per: 2, v: 120, spread: 1.0 },
          { label: 'H⁺ 流入类囊体腔', col: 0xfff27a, r: 2.0, paths: Hin, per: 6, v: 90 },
          { label: 'H⁺ 经 ATP 合酶回流基质', col: 0xffd84a, r: 2.0, paths: Hout, per: 6, v: 90 },
          { label: 'O₂ 放出（腔内）', col: 0x7ab8ff, r: 2.8, paths: many(3, () => brownPath(this.oex, S(Lu, up(this.oex, -80)), { free0: 10, free1: 0 })), per: 0.5, v: 50 },
          { label: 'NADPH 流出', col: 0xff6fa8, r: 3.0, paths: many(3, () => brownPath(this.fad, S(St, up(this.fad, 80)), { free0: 10, free1: 0 })), per: 1, v: 55 },
          { label: 'ATP 流出', col: 0xff9a2e, r: 2.8, paths: many(3, () => brownPath(this.atpOut, S(St, up(this.atpOut, 80)), { free0: 8, free1: 0 })), per: 1.3, v: 55 } ]);
      }
      this.flow.visible = true; this.flow.update(dt, 1.5 * ctx.pace());
    },
  },

