  /* ============================================================================= translation (one 70S ribosome, kinetic simulation)
     Scene: 4V6F (T. thermophilus 70S, mRNA + E/P/A tRNA). Everything else is superposed onto THIS ribosome by its rRNA
     (alignEntry): EF-Tu·GTP·aa-tRNA in the A/T state (4V5L), EF-Tu·GDP domain arrangement (1TUI, fitted on domains 2-3),
     EF-G intermediate (4V9H) and post-translocation (4V5F, + fusidic acid), RF1 (4V7P), antibiotics at their crystal sites.
     Kinetics: continuous-time Markov chain (Gillespie) over the elongation cycle with TL_K rates; concentrations, drugs and the
     mRNA come from the HUD. Molecular time runs at `speed` x real time; every main-chain event plays a short animation
     (durations shrink at high speed) during which molecular time is frozen. Non-cognate encounters are counted, not drawn. */
  translation: {
    lead: '核糖体翻译（嗜热栖热菌 70S）：每一步按测得的速率随机发生。',
    energyHL: [[], ['/protein L7/'], [{ part: '16S', aseqs: [[1492, 1493], [530, 530]] }], ['/protein L7/'], [], [{ part: '23S', aseqs: [[2451, 2451], [2583, 2585], [2602, 2602]] }], ['/protein L7/'], ['/protein L1$/'], []],
    energy: [
      ['起始', '30S 起始复合物：mRNA 的 SD 序列（GGAGG）与 16S rRNA 的 3′ 端配对，把起始密码子 AUG 放进 P 位；IF1、IF2·GTP、IF3 帮 fMet-tRNAᶠᴹᵉᵗ 进入 P 位，50S 结合后形成 70S 起始复合物。这里合并为一步（约 1 s⁻¹）。'],
      ['三元复合物结合', 'EF-Tu·GTP·氨酰-tRNA（三元复合物）扩散碰到核糖体，先与 L7/L12 柄短暂结合，这一步与密码子无关（k₁ ≈ 110 μM⁻¹s⁻¹，接近扩散极限）。细胞里约 40 种 tRNA 竞争：对某个密码子平均只有约 4% 是同源的，约 6% 是近同源（一个错配），其余为非同源——它们很快离开、不占 A 位（只计数）。'],
      ['密码子识别', '反密码子与 A 位密码子配对。16S rRNA 的 A1492、A1493 翻出、G530 转动，检查前两个碱基对的小沟几何——只有沃森-克里克配对能“咬合”。同源：k₋₂ ≈ 1 s⁻¹，几乎不脱落；近同源：k₋₂ ≈ 600 s⁻¹，大多在这里离开。'],
      ['GTP 水解（第一次选择）', '密码子识别的信号经 tRNA 本身的形变（A/T 态的弯曲）传到 EF-Tu 的 G 结构域，激活 GTP 酶（His84 进入活性位点，23S 的 SRL 参与）。同源 k₃ ≈ 1500 s⁻¹，近同源 ≈ 1.5 s⁻¹：诱导契合造成约 1000 倍的速度差，这是初始选择。'],
      ['EF-Tu 变构离开 → 校对 / 容纳', 'GTP → GDP + Pi 后，EF-Tu 的 G 结构域（结构域 1）相对结构域 2、3 大幅转动。动画用 4V5L（GTP 形式）和 1TUI（GDP 形式）的真实坐标插值。EF-Tu 松开 tRNA 的受体端并离开，tRNA 从弯曲的 A/T 态伸直，受体端摆进 50S 的肽基转移中心，叫“容纳”（同源约 150 s⁻¹）。近同源 tRNA 多数在这里被甩掉，叫“校对”（k₇ ≈ 30 s⁻¹，容纳只有 ≈ 1 s⁻¹）。两次选择合计，错误率约 10⁻⁴–10⁻³。'],
      ['肽键形成', '肽基转移中心由 23S rRNA 构成（A2451、U2585、G2583 等），核糖体是核酶。A 位氨酰-tRNA 的 α-氨基进攻 P 位肽酰-tRNA 的酯键，整条肽链转到 A 位 tRNA 上，P 位 tRNA 变成空载。反应靠定位和熵效应，P 位 tRNA A76 的 2′-OH 协助质子转移，不消耗 GTP（约 200 s⁻¹）。'],
      ['EF-G 移位', '肽键形成后，tRNA 受体端自发进入杂合态（A/P、P/E：受体端先移到下一位）。EF-G·GTP 结合并稳定杂合态；GTP 水解后，结构域 IV 伸进 30S 的 A 位，30S 头部转动，两个 tRNA 的反密码子臂连同 mRNA 前移 3 个核苷酸，然后 EF-G·GDP 离开。EF-G 的形状由 4V9H（中间态）和 4V5F（移位后）的真实坐标插值；tRNA 杂合态是示意：受体臂先移动。'],
      ['E 位 tRNA 离开', '空载 tRNA 从 E 位离开（L1 柄协助），回到细胞质，由氨酰-tRNA 合成酶重新装上氨基酸（消耗 1 ATP → AMP + PPi）。'],
      ['终止与释放', '终止密码子（UAA / UAG / UGA）没有对应的 tRNA，由释放因子识别：RF1 读 UAA / UAG，RF2 读 UAA / UGA。RF1 的 GGQ 基序伸进肽基转移中心，用水分子水解肽酰-tRNA 的酯键，释放肽链。之后 RF3、RRF + EF-G 把核糖体拆开回收（这里合并为“回收”一步）。'] ],
    stage() { return this.stg ?? 0; },
    caption: '一个真实的 70S 核糖体（4V6F，嗜热栖热菌）正在翻译。三元复合物、EF-G、RF1 按浓度在周围扩散；每一步按测得的速率常数随机发生（Gillespie 算法）。右上角可以改浓度、加抗生素、换 mRNA、单步查看。tRNA、EF-Tu、EF-G、RF1 和抗生素的位置都来自各自的晶体结构，按 rRNA 叠合到同一个核糖体上；新生肽链沿由 23S 坐标算出的出口通道伸出。',
    async setup(ctx) {
      const V = () => new THREE.Vector3(), cen = (A) => A.reduce((s, a) => s.add(a.p || a), V()).multiplyScalar(1 / Math.max(1, A.length));
      const all = ctx.allAtoms;
      const mrna = all.filter(a => /^MRNA$/i.test(a.part)).sort((x, y) => x.seq - y.seq);
      const tAt = all.filter(a => /TRNA/i.test(a.part));
      const chs = [...new Set(tAt.map(a => a.asym))].map(k => tAt.filter(a => a.asym === k).sort((x, y) => x.seq - y.seq)).filter(c => c.length > 60);
      if (mrna.length < 12 || chs.length < 3) throw new Error('该结构里找不到 mRNA 和 3 个 tRNA');
      const res = (c, s) => c.find(a => a.seq === s) || c[Math.min(c.length - 1, s - 1)];
      const nearM = (p) => { let bi = 0, bd = 1e18; mrna.forEach((m, i) => { const d = m.p.distanceToSquared(p); if (d < bd) { bd = d; bi = i; } }); return bi; };
      /* E / P / A by where each anticodon (34-36) sits on the mRNA, 5' -> 3' */
      const [sE, sP, sA] = chs.map(c => ({ c, j: nearM(res(c, 35).p) })).sort((a, b) => a.j - b.j).slice(0, 3);
      ctx.partGroups(/TRNA|^MRNA$/i).forEach(g => g.visible = false);
      this.mPts = mrna.map(a => a.p.clone()); this.jP = nearM(res(sP.c, 36).p);   // codon position 1 pairs with anticodon base 36
      /* template tRNA = the P-site tRNA; a pose maps template coordinates x -> q (x - cT) + t */
      const tpl = sP.c, T0 = tpl.map(a => a.p.clone()), cT = cen(T0);
      const accW = (s) => s <= 7 || s >= 66 ? 1 : s >= 49 ? 0.7 : s >= 44 ? 0.3 : s <= 9 ? 0.8 : s <= 26 ? 0.35 : 0;   // acceptor arm leads in the hybrid states
      this.T = { ref: T0, c: cT, acc: tpl.map(a => accW(a.seq)), n: T0.length, at: T0.map(p => p.clone()) };
      const poseFrom = (m) => { const A = [], B = []; tpl.forEach((a, i) => { const p = m.get(a.seq); if (p) { A.push(p); B.push(T0[i]); } });
        if (A.length < 20) return null; const f = superpose(A, B); return { q: f.q.clone(), t: f(cT) }; };
      const mapOf = (c) => new Map(c.map(a => [a.seq, a.p]));
      const S = this.site = { E: poseFrom(mapOf(sE.c)), P: poseFrom(mapOf(sP.c)), A: poseFrom(mapOf(sA.c)) };
      this.R3 = (pose, x) => x.clone().sub(cT).applyQuaternion(pose.q).add(pose.t);
      const end3 = (pose) => this.R3(pose, T0[T0.length - 1]);
      const c16 = cen(all.filter(a => /16S/i.test(a.part))), c23 = cen(all.filter(a => /23S/i.test(a.part)));
      const up = this.up = c23.clone().sub(c16).normalize();
      const ptc = this.ptc = end3(S.P).add(end3(S.A)).multiplyScalar(0.5);
      const eA = S.A.t.clone().sub(S.E.t);
      if (current) current.camera = { az: Math.atan2(-eA.z, eA.x), el: 0.1, dist: 1.5 };   // E -> A runs left to right
      const rib = all.filter(a => !/TRNA|^MRNA$/i.test(a.part));
      this.C0 = cen(rib); this.Rr = Math.max(...rib.map(a => a.p.distanceTo(this.C0)));
      /* exit tunnel: maximal-clearance path from the peptidyl-transferase centre out through the 50S */
      status('计算肽链出口通道（由 23S 坐标）…', true); await new Promise(r => setTimeout(r, 0));
      const t0 = performance.now();
      const tun = findChannel(all.map(a => a.p), ptc,   // tRNAs + mRNA included: they close the intersubunit space around the PTC
        { h: 2, radius: 90, minClear: 4, openClear: 14, minLen: 70,
        allowed: (p) => (p.x - ptc.x) * up.x + (p.y - ptc.y) * up.y + (p.z - ptc.z) * up.z > -6 });
      this.tun = tun ? tun.map(x => x.p) : [ptc.clone(), ptc.clone().addScaledVector(up, 100)];
      this.tunLen = pathLength(this.tun);
      console.log(`出口通道 ${this.tunLen.toFixed(0)} Å，${(performance.now() - t0).toFixed(0)} ms`);
      const nT = this.tun.length; this.exitPt = this.tun[nT - 1].clone(); this.exitDir = this.tun[nT - 1].clone().sub(this.tun[Math.max(0, nT - 6)]).normalize();
      ctx.markHot([ptc, mrna[Math.min(mrna.length - 1, this.jP + 4)].p], 7);   // decoding centre + PTC with atomic detail
      /* ---- superpose factors and drug complexes onto this ribosome */
      status('从 RCSB 下载并叠合 EF-Tu、EF-G、RF1 和抗生素结构…', true);
      const refs = { '23S': rib.filter(a => /23S/i.test(a.part) && a.na), '16S': rib.filter(a => /16S/i.test(a.part) && a.na) };
      const J = (id, o) => alignEntry(id, { refAtoms: refs[o.ref], ...o }).catch(e => { console.warn('叠合失败', id, e); return null; });
      const aAnti = res(sA.c, 35).p, dec = mrna[Math.min(mrna.length - 1, this.jP + 4)].p, aEnd = end3(S.A), tunPt = alongPath(this.tun, 14, V());
      this.decPt = dec.clone(); this.asymA = sA.c[0].asym; this.asymP = sP.c[0].asym; this.asymM = mrna[0].asym; this.seqAC = res(sA.c, 35).seq; this.seqA76 = sA.c[sA.c.length - 1].seq;   /* atom-level close-ups */
      const [tu, g1, g2, rf, dTAC, dPAR, dCLM, dERY, dKIR] = await Promise.all([
        J('4V5L', { ref: '23S', chains: [['tu', 'ELONGATION FACTOR TU'], ['tr', 'A-SITE TRNA']], ligands: ['GCP'] }),
        J('4V9H', { ref: '23S', chains: [['g', 'Elongation factor G']], ligands: ['GCP'] }),
        J('4V5F', { ref: '23S', chains: [['g', 'ELONGATION FACTOR G']], ligands: ['FUA', 'GDP'] }),
        J('4V7P', { ref: '23S', chains: [['rf', 'release factor 1']] }),
        J('4V9A', { ref: '16S', ligands: ['TAC'], near: { TAC: aAnti } }),
        J('4V51', { ref: '16S', ligands: ['PAR'], near: { PAR: dec } }),
        J('6ND5', { ref: '23S', ligands: ['CLM'], near: { CLM: aEnd } }),
        J('6XHX', { ref: '23S', ligands: ['ERY'], near: { ERY: tunPt } }),
        J('4V5P', { ref: '23S', ligands: ['KIR'] }),
      ]);
      if (!tu?.chains.tu || !tu.chains.tr) throw new Error('EF-Tu 三元复合物结构（4V5L）下载失败');
      /* A/T tRNA: its own (bent) shape, expressed in the template frame */
      const byA = new Map(), byS = new Map(); for (const a of tu.chains.tr.atoms) { const k = parseInt(a.aseq); if (k) byA.set(k, a.p); byS.set(a.seq, a.p); }
      const atM = byA.size >= 50 ? byA : byS; S.AT = poseFrom(atM);
      const qi = S.AT.q.clone().invert();
      this.T.at = tpl.map((a, i) => { const p = atM.get(a.seq); return p ? p.clone().sub(S.AT.t).applyQuaternion(qi).add(cT) : T0[i].clone(); });
      /* EF-Tu: GTP form (4V5L) and GDP form (1TUI fitted on domains 2-3, so domain 1 shows its real swing) */
      const TU = tu.chains.tu.atoms; let gdp = null;
      try { const refT = TU.filter(a => (parseInt(a.aseq) || a.seq) > 212);
        const r = await alignEntry('1TUI', { ref: 'ELONGATION FACTOR TU', refAtoms: refT, refNa: false, chains: [['tu', 'ELONGATION FACTOR TU']] });
        const m = new Map(r.chains.tu.atoms.map(a => [String(a[r.key]), a.p])); gdp = TU.map(a => (m.get(String(a[r.key])) || a.p).clone());
      } catch (e) { console.warn('1TUI', e); }
      this.TU = { ref: TU.map(a => a.p.clone()), gdp: gdp || TU.map(a => a.p.clone()), hasGDP: !!gdp };
      this.cTC = cen([...this.TU.ref, ...this.T.at.map(x => this.R3(S.AT, x))]);
      /* EF-G: intermediate (4V9H) -> post (4V5F); residues matched by whichever numbering puts them closer */
      const G1 = g1?.chains.g?.atoms || g2?.chains.g?.atoms; if (!G1) throw new Error('EF-G 结构下载失败');
      let post = G1.map(a => a.p.clone());
      if (g1?.chains.g && g2?.chains.g) {
        const tryK = (k) => { const m = new Map(g2.chains.g.atoms.map(a => [String(a[k]), a.p])); let s = 0, n = 0; const out = G1.map(a => { const p = m.get(String(a[k])); if (p) { s += p.distanceTo(a.p); n++; } return (p || a.p).clone(); }); return { out, d: n > 100 ? s / n : 1e9 }; };
        const A1 = tryK('seq'), A2 = tryK('aseq'); post = (A1.d <= A2.d ? A1 : A2).out;
      }
      this.EG = { ref: G1.map(a => a.p.clone()), post }; this.cG = cen(this.EG.ref);
      this.RF = rf?.chains.rf ? { ref: rf.chains.rf.atoms.map(a => a.p.clone()) } : null; if (this.RF) this.cRF = cen(this.RF.ref);
      /* small molecules: CCD templates fitted by atom name onto the aligned crystal ligands */
      const tpls = this.tpls = {};
      await Promise.all(['GTP', 'GDP', 'PO4', 'TAC', 'PAR', 'CLM', 'ERY', 'KIR', 'FUA'].map(async c => { try { tpls[c] = await ctx.template(c); } catch (e) { console.warn(e); } }));
      const poseOf = (t, atoms) => tpls[t] && atoms ? fitPose(tpls[t], atoms) : null;
      this.gtpTU = poseOf('GTP', tu.ligands.GCP?.atoms); this.gdpTU = poseOf('GDP', tu.ligands.GCP?.atoms);
      this.piTU = tu.ligands.GCP?.atoms.find(x => x.name === 'PG')?.p.clone() || null;
      this.gtpG = poseOf('GTP', g1?.ligands.GCP?.atoms) || poseOf('GTP', g2?.ligands.GDP?.atoms);
      this.gdpG = poseOf('GDP', g2?.ligands.GDP?.atoms) || poseOf('GDP', g1?.ligands.GCP?.atoms);
      this.fuaG = poseOf('FUA', g2?.ligands.FUA?.atoms);
      const mk = (t, col) => tpls[t] ? ctx.makeMol(tpls[t], true, col) : null;
      this.m = { gtpT: mk('GTP'), gdpT: mk('GDP'), piT: mk('PO4'), gtpG: mk('GTP'), gdpG: mk('GDP'), fua: mk('FUA', TL_DRUG.FUA.col) };
      this.dsite = {};
      const dres = { TAC: dTAC, PAR: dPAR, CLM: dCLM, ERY: dERY, KIR: dKIR };
      for (const k of Object.keys(dres)) { const L = dres[k]?.ligands[k], pose = L && poseOf(k, L.atoms); if (!pose) continue;
        const mol = mk(k, TL_DRUG[k].col); mol.quaternion.copy(pose.q); mol.position.copy(pose.t);
        this.dsite[k] = { mol, c: L.centre.clone(), tag: makeTag(TL_DRUG[k].name, { p: L.centre, cls: 'small warn', dy: 0 }) }; }
      /* ---- 3D containers */
      this.root = new THREE.Group(); world.add(this.root); procWorld.push(this.root);
      this.bodies = []; this.trs = new Set(); this.tw = []; this.pool = { tc: [], g: [], rf: [] }; this.free = {}; this.rel = [];
      this.H = this.Rr + 150; this.perUM = Math.pow(2 * this.H, 3) * 6.022e-10;   // molecules in the view box per uM
      this.pepMesh = new THREE.InstancedMesh(PARTICLE_GEO, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.45 }), 900);
      this.pepMesh.count = 0; this.pepMesh.frustumCulled = false; this.pepMesh.userData.name = '新生肽链（每个珠 = 1 个氨基酸，颜色 = 种类）'; this.pepMesh.setColorAt(0, new THREE.Color()); procRoot.add(this.pepMesh);
      this.tag = { E: makeTag('', { p: V(), cls: 'small' }), P: makeTag('', { p: V(), cls: 'small' }), A: makeTag('', { p: V(), cls: 'small' }),
        tc: makeTag('', { p: V() }), g: makeTag('', { p: V() }), rf: makeTag('', { p: V() }), pep: makeTag('', { p: V(), cls: 'small' }),
        sE: makeTag('E 位', { p: this.R3(S.E, T0[54]).addScaledVector(up, 14), cls: 'small hl' }), sP: makeTag('P 位', { p: this.R3(S.P, T0[54]).addScaledVector(up, 14), cls: 'small hl' }),
        sA: makeTag('A 位', { p: this.R3(S.A, T0[54]).addScaledVector(up, 14), cls: 'small hl' }) };
      this.orfKey = 'ubq'; this.aaSeq = TL_ORF.ubq[1]; this.paused = false; this.speed = 0.02;
      this.restart();
      ctx.counters['肽键'] = 0; ctx.counters['蛋白质'] = 0;
      console.log('translation ready', { jP: this.jP, tunnel: this.tunLen, drugs: Object.keys(this.dsite), gdp: this.TU.hasGDP });
    },

    /* ---------------------------------------------------------------- 3D bodies (one InstancedMesh of residue blobs each) */
    mkBody(ref, col, na, calc) {
      const atoms = ref.map(p => ({ p: p.clone(), na }));
      const mesh = blobInstances({ atoms }, () => new THREE.Color(col), blobMaterial());
      const obj = new THREE.Group(); obj.add(mesh); obj.add(outlineOf(mesh, { blob: true })); this.root.add(obj);
      const b = { mesh, obj, sc: atoms.map(a => mesh.userData.scaleOf(a)), n: atoms.length, calc, cr: null, fade: 1 };
      this.bodies.push(b); return b;
    },
    drawBody(b) {
      if (b.cr) crEval(b.cr);
      for (let i = 0; i < b.n; i++) { b.calc(i, _tp); if (b.cr) crApply(b.cr, _tp); _tm4.compose(_tp, _tq0, _tsv.setScalar(Math.max(1e-3, b.sc[i] * b.fade))); b.mesh.setMatrixAt(i, _tm4); }
      b.mesh.instanceMatrix.needsUpdate = true;
    },
    killBody(b) { if (!b) return; this.root.remove(b.obj); disposeObj(b.obj); this.bodies = this.bodies.filter(x => x !== b); },
    /* tRNA: rigid site poses pa -> pb (global progress w, acceptor-arm-first progress hy), shape straight -> bent A/T (sAT) */
    mkT(aa) {
      const T = this.T, cT = T.c, tr = { aa, pa: this.site.P, pb: this.site.P, w: 0, hy: 0, sAT: 0 };
      const PAL = ['#d6336c', '#ae3ec9', '#e8590c', '#c2255c', '#9c36b5', '#f03e3e'];   /* each tRNA keeps its colour through A -> P -> E */ this._ti = (this._ti || 0) + 1;
      tr.b = this.mkBody(T.ref, PAL[this._ti % PAL.length], true, (i, out) => {
        const wi = tr.hy ? Math.max(tr.w, tr.hy * T.acc[i]) : tr.w;
        out.copy(T.ref[i]); if (tr.sAT) out.lerp(T.at[i], tr.sAT);
        let q = tr.pa.q, t = tr.pa.t;
        if (tr.pb !== tr.pa && wi > 0) { if (wi >= 1) { q = tr.pb.q; t = tr.pb.t; } else { q = _pq.copy(tr.pa.q).slerp(tr.pb.q, wi); t = _pt.copy(tr.pa.t).lerp(tr.pb.t, wi); } }
        return out.sub(cT).applyQuaternion(q).add(t);
      });
      tr.bead = this.ctx.makeParticle(aa ? aaCol(aa) : 0xffffff, 2.6, null, aa ? `氨基酸 ${aa === 'fM' ? '甲酰甲硫氨酸 fMet' : aa}（连在 tRNA 末端）` : '氨基酸'); tr.bead.visible = !!aa && aa !== 'fM';   // fMet is drawn as the first residue of the chain
      this.trs.add(tr); return tr;
    },
    setAA(tr, aa) { tr.aa = aa; if (aa) { tr.bead.material.color.set(aaCol(aa)); tr.bead.material.emissive.set(aaCol(aa)); } tr.bead.visible = !!aa; },
    killT(tr) { if (!tr) return; this.trs.delete(tr); this.killBody(tr.b); tr.bead.parent?.remove(tr.bead); tr.bead.material.dispose(); if (this.pepTr === tr) this.pepTr = null; },
    end3T(tr, out) { tr.b.calc(this.T.n - 1, out); if (tr.b.cr) crApply(tr.b.cr, out); return out; },
    mkTC(aa) {
      const tr = this.mkT(aa); tr.pa = tr.pb = this.site.AT; tr.sAT = 1;
      const tc = { tr, gdp: 0, cr: crNew(this.cTC), kir: false, hyd: false };
      tc.tu = this.mkBody(this.TU.ref, '#2f7fe0', false, (i, out) => { out.copy(this.TU.ref[i]); if (tc.gdp) out.lerp(this.TU.gdp[i], tc.gdp); return out; });
      tr.b.cr = tc.cr; tc.tu.cr = tc.cr; return tc;
    },
    mkEG() { const eg = { post: 0, cr: crNew(this.cG), hyd: false };
      eg.b = this.mkBody(this.EG.ref, '#159a52', false, (i, out) => { out.copy(this.EG.ref[i]); if (eg.post) out.lerp(this.EG.post[i], eg.post); return out; }); eg.b.cr = eg.cr; return eg; },
    mkRF() { const rf = { cr: crNew(this.cRF) }; rf.b = this.mkBody(this.RF.ref, '#7c4ddb', false, (i, out) => out.copy(this.RF.ref[i])); rf.b.cr = rf.cr; return rf; },
    killItem(it) { if (!it) return; if (it.tr) this.killT(it.tr); this.killBody(it.tu); this.killBody(it.b); },
    /* random place in the view box, outside the ribosome */
    randPt(edge) { const H = this.H; for (let k = 0; k < 50; k++) {
      const p = new THREE.Vector3((rand() * 2 - 1) * H, (rand() * 2 - 1) * H * 0.75, (rand() * 2 - 1) * H);
      if (edge) { const ax = Math.floor(rand() * 3); p.setComponent(ax, Math.sign(p.getComponent(ax) || 1) * H * (ax === 1 ? 0.75 : 1)); }
      if (p.length() > this.Rr + 40 && (this.yMax == null || p.y + this.C0.y < this.yMax)) return p.add(this.C0); } return this.C0.clone().add(new THREE.Vector3(H, 0, 0)); },   /* yMax: membrane above (cell scene) */
    place(cr, edge) { const p = this.randPt(edge), q = randQ(); cr.q0.copy(q); cr.q1.copy(q); cr.t0.copy(p); cr.t1.copy(p); cr.w = 1; },

    /* ---------------------------------------------------------------- tweens (animated transitions) */
    tween(o, k, to, dur, done, block = true) { const d = dur * this.dsc(); if (d < 1e-3 || (this.speed >= 1 && block)) { /* real time / fast-forward: events snap */ o[k] = to; done?.(); return; } this.tw.push({ o, k, a: o[k], b: to, t: 0, dur: d, done, block }); },
    wait(dur) { this.tween({ x: 0 }, 'x', 1, dur); },
    dsc() { return Math.min(1, 0.02 / Math.max(1e-4, this.speed)); },
    busy() { return this.tw.some(x => x.block); },
    flyIn(it, cRef, dur, done) { const cr = it.cr; crFrom(cr); cr.q1.identity(); cr.t1.copy(cRef); cr.c.copy(cRef); this.tween(cr, 'w', 1, dur, done); },
    flyOut(it, done) {   // leave the ribosome into the cytoplasm and fade
      const cr = it.cr; crFrom(cr);
      const c = cr.t.clone(), dir = c.clone().sub(this.C0).normalize().add(new THREE.Vector3(rand() - 0.5, rand() - 0.5, rand() - 0.5).multiplyScalar(0.6)).normalize();
      cr.t1.copy(c).addScaledVector(dir, this.Rr * 0.9 + 60); cr.q1.copy(randQ()).slerp(cr.q0, 0.7);
      const bs = [it.tr?.b, it.tu, it.b].filter(Boolean);
      this.tween(cr, 'w', 1, 1.4, () => { bs.forEach(b => this.tween(b, 'fade', 0, 0.5, null, false)); this.tween({ x: 0 }, 'x', 1, 0.55, () => { this.killItem(it); done?.(); }, false); }, false);
    },
    tOut(tr) {   // a tRNA (bound in a site) leaves on its own
      const c = new THREE.Vector3(); this.T.ref.forEach((_, i) => { tr.b.calc(i, _tp); c.add(_tp); }); c.multiplyScalar(1 / this.T.n);
      tr.b.cr = crNew(c); this.flyOut({ tr, cr: tr.b.cr });
    },

    /* ---------------------------------------------------------------- mRNA, ORF, restart */
    setOrf(key, custom) {
      if (key === 'custom') { const s = String(custom || '').toUpperCase().replace(/[^ACDEFGHIKLMNPQRSTVWY]/g, ''); if (!s) return; this.aaSeq = s; }
      else if (TL_ORF[key]) this.aaSeq = TL_ORF[key][1];
      this.orfKey = key; this.restart();
    },
    restart() {
      /* everything except the free pools goes (also molecules still flying away) */
      const keep = new Set(); for (const L of Object.values(this.pool)) for (const it of L) { keep.add(it.tr); [it.tr?.b, it.tu, it.b].forEach(b => b && keep.add(b)); }
      for (const tr of [...this.trs]) if (!keep.has(tr)) this.killT(tr);
      for (const b of [...this.bodies]) if (!keep.has(b)) this.killBody(b);
      this.tw = []; this.tc = this.eg = this.rf = null;
      const a = this.aaSeq[0] === 'M' ? this.aaSeq : 'M' + this.aaSeq; this.aa = a;
      const base = 'GGCAAGGAGGUAAACAACU'; const u5 = this.jP <= base.length ? base.slice(base.length - this.jP) : 'A'.repeat(this.jP - base.length) + base;
      this.u5 = u5.length; this.seq = u5 + 'AUG' + [...a.slice(1)].map(x => PREF_CODON[x]).join('') + 'UAA' + 'GCUUUUAAGCUUAAGCAUUC';
      if (this.mMesh) { procRoot.remove(this.mMesh); this.mMesh.material.dispose(); }
      const NB = { A: '#4caf50', U: '#e5484d', G: '#f5a623', C: '#3b6fe0' };
      this.mMesh = new THREE.InstancedMesh(PARTICLE_GEO, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5 }), this.seq.length);
      [...this.seq].forEach((b, i) => this.mMesh.setColorAt(i, new THREE.Color(NB[b]))); this.mMesh.frustumCulled = false; this.mMesh.userData.name = 'mRNA（每个珠 = 1 个核苷酸：A 绿 U 红 G 橙 C 蓝）'; procRoot.add(this.mMesh);
      this.pi = this.u5; this.mOff = 0; this.mFade = 1;
      const fm = this.mkT('fM'); this.tr = { E: null, P: fm, A: null };
      this.pep = [{ aa: 'fM' }]; this.pepTr = fm; this.pepFrom = null; this.pepW = 1; this.outP = [];
      this.s = { st: 'post', T: 0, L: 1, nCod: 0, mis: 0, codAll: 0, misAll: 0, prot: 0, non: 0, near1: 0, near2: 0, cogOff: 0, drop: 0, E: false, fua: false, inc: null,
        drug: { TAC: false, PAR: false, CLM: false, ERY: false }, rate: 0, lastPep: null, log: [], kirN: 0 };
      this.next = null; this.waited = 0; this.stg = 0; this.cKey = '';
    },
    codonA() { const i = this.pi + 3; return this.seq.slice(i, i + 3); },
    codonAt(k) { const i = this.pi + k; return i >= 0 ? this.seq.slice(i, i + 3) : ''; },
    mPos(x, out) {   // point x (fractional index) along the real mRNA path of 4V6F, extended straight beyond its ends
      const P = this.mPts, n = P.length;
      if (x <= 0) return out.copy(P[0]).addScaledVector(_cw.copy(P[0]).sub(P[3]).normalize(), -x * 6.2);
      if (x >= n - 1) return out.copy(P[n - 1]).addScaledVector(_cw.copy(P[n - 1]).sub(P[n - 4]).normalize(), (x - n + 1) * 6.2);
      const i = Math.floor(x); return out.copy(P[i]).lerp(P[i + 1], x - i);
    },
    conc() { const c = this.ctx.cell?.ctrl || {}; return { TC: c.TC ?? 25, EFG: c.EFG ?? 20, RF1: c.RF1 ?? 2, TAC: c.TAC || 0, PAR: c.PAR || 0, CLM: c.CLM || 0, ERY: c.ERY || 0, KIR: c.KIR || 0, FUA: c.FUA || 0 }; },
    /* macrolide in the tunnel: ErmCL stalls with Ile9 in the P site (Vazquez-Laslop 2008, stable, no drop-off);
       other peptides are blocked at ~6-8 aa and the peptidyl-tRNA drops off (Tenson 2003) */
    eryStall() { const s = this.s; return s.drug.ERY && (this.orfKey === 'ermcl' ? s.L === 9 : s.L >= 7); },
    clmF() { if (!this.s.drug.CLM) return 1; const pen = this.pep[this.pep.length - 2]?.aa; return ['A', 'S', 'T'].includes(pen) ? 0.003 : 0.1; },   // context-specific (Marks 2016): strong arrest after Ala / Ser / Thr

    /* ---------------------------------------------------------------- kinetics: all transitions out of the current state */
    rates() {
      const K = TL_K, c = this.conc(), s = this.s, R = [], add = (r, id) => { if (r > 0) R.push([r, id]); };
      const cod = this.codonA(), cog = s.inc?.cls === 'c', par = s.drug.PAR;
      switch (s.st) {
        case 'init': add(K.init, 'init'); break;
        case 'post': if (cod.length < 3) break; if (GENCODE[cod] === '*') { if (this.RF) add(K.rf * c.RF1, 'rfOn'); } else { add(K.k1 * c.TC * K.fc, 'tcC'); add(K.k1 * c.TC * K.fn, 'tcN'); } break;
        case 'tc': add(K.km1, 'tcOff'); if (!s.drug.TAC) add(K.k2, 'codon'); break;
        case 'cr': add(cog ? K.km2c : K.km2n, 'codonOff'); add(cog ? K.k3c : par ? K.k3nPar : K.k3n, 'gtp'); break;
        case 'gtp': add(K.k4, s.inc.kir ? 'kirStuck' : 'tuOff'); break;
        case 'kir': add(K.kirOff, 'tuOff'); break;
        case 'rel': add(cog ? K.k5c : par ? K.k5nPar : K.k5n, 'accom'); add(cog ? K.k7c : par ? K.k7nPar : K.k7n, 'reject'); break;
        case 'acc': if (this.eryStall()) add(this.orfKey === 'ermcl' ? K.dropErm : K.dropOff, 'drop'); else add(K.pep * this.clmF(), 'pep'); break;
        case 'pre': add(K.gOn * c.EFG, 'gOn'); break;
        case 'g': add(K.trans, 'trans'); break;
        case 'gpost': add(s.fua ? K.faOff : K.gOff, 'gOff'); break;
        case 'rf': add(K.hyd, 'hyd'); break;
        case 'term': case 'drop': add(K.recycle, 'recycle'); break;
      }
      for (const d of ['TAC', 'PAR', 'CLM', 'ERY']) { const D = TL_DRUG[d];
        if (s.drug[d]) add(D.koff, d + '-'); else if (c[d] > 0 && !(d === 'ERY' && s.L > 8)) add(D.kon * c[d], d + '+'); }
      if (s.E && s.st !== 'g') add(K.eOff, 'eOff');
      return R;
    },
    adv(dt) {   // molecular time passes; non-cognate encounters while the A site waits are counted
      const s = this.s; s.T += dt;
      if (s.st === 'post' && GENCODE[this.codonA()] && GENCODE[this.codonA()] !== '*') s.non += TL_K.k1 * this.conc().TC * (1 - TL_K.fc - TL_K.fn) * dt;
    },
    runEngine(dt) {
      if (this.busy()) return;
      let budget = this.stepReq ? Infinity : dt * this.speed;
      for (let it = 0; it < 3000; it++) {
        if (!this.next) {
          const R = this.rates(), tot = R.reduce((s, r) => s + r[0], 0);
          if (!tot) { if (budget !== Infinity) this.adv(budget); this.stepReq = 0; return; }
          let u = rand() * tot, pick = R[R.length - 1]; for (const r of R) { u -= r[0]; if (u <= 0) { pick = r; break; } }
          this.next = { tau: -Math.log(1 - rand()) / tot, id: pick[1] }; this.waited = 0;
        }
        const need = this.next.tau - this.waited;
        if (need > budget) { this.waited += budget; this.adv(budget); return; }
        budget -= need; this.adv(need);
        const id = this.next.id; this.next = null; this.fire(id);
        if (this.stepReq && !/[+-]$|^eOff$/.test(id)) { this.stepReq = 0; return; }
        if (this.busy()) return;
      }
      this.stepReq = 0;
    },
    log(t, warn) { const s = this.s; s.log.push([s.T, t, warn]); if (s.log.length > 9) s.log.shift(); },
    takeTC() {
      const a = this.ctx; let best = -1, bd = 1e18; const tgt = this.site.A.t;
      this.pool.tc.forEach((it, i) => { const d = it.cr.t1.distanceToSquared(tgt); if (d < bd) { bd = d; best = i; } });
      if (best >= 0) return this.pool.tc.splice(best, 1)[0];
      const it = this.mkTC('ACDEFGHIKLMNPQRSTVWY'[Math.floor(rand() * 20)]); this.place(it.cr, true); return it;
    },
    takeFrom(list, mk) { if (list.length) { let bi = 0, bd = 1e18; list.forEach((it, i) => { const d = it.cr.t1.distanceToSquared(this.ptc); if (d < bd) { bd = d; bi = i; } }); return list.splice(bi, 1)[0]; }
      const it = mk(); this.place(it.cr, true); return it; },

    /* ---------------------------------------------------------------- one event: state change + its animation */
    fire(id) {
      const s = this.s, c = this.conc(), S = this.site, ctx = this.ctx;
      const cod = this.codonA(), inc = s.inc, cog = inc?.cls === 'c';
      switch (id) {
        case 'tcC': case 'tcN': {
          const cls = id === 'tcC' ? 'c' : 'n'; let aa = GENCODE[cod];
          if (cls === 'n') { const nn = nearAA(cod); aa = nn.length ? nn[Math.floor(rand() * nn.length)] : aa; }
          const kir = c.KIR > 0 && rand() < c.KIR / (c.KIR + TL_DRUG.KIR.kd);
          s.inc = { cls, aa, kir }; s.st = 'tc'; this.stg = 1;
          const tc = this.tc = this.takeTC(); this.setAA(tc.tr, aa); tc.kir = kir; tc.hyd = false; tc.gdp = 0;
          [tc.tr.b, tc.tu].forEach(b => { if (b.fade < 1) this.tween(b, 'fade', 1, 0.3, null, false); });
          this.flyIn(tc, this.cTC, 1.4);
          this.log(`${cls === 'c' ? '同源' : '近同源'}三元复合物结合：${AANAME(aa)}-tRNA（密码子 ${cod}）${kir ? '，EF-Tu 上带着黄色霉素' : ''}`); break; }
        case 'tcOff': { if (cog) s.cogOff++; else s.near1++; this.log(`${cog ? '同源' : '近同源'}三元复合物没等到识别就离开了`); const tc = this.tc; this.tc = null; s.inc = null; s.st = 'post'; this.stg = 1; this.flyOut(tc); this.wait(0.4); break; }
        case 'codon': s.st = 'cr'; this.stg = 2; this.log(cog ? `密码子识别：${cod} 与反密码子 ${ANTI(cod)} 三对配对，A1492/A1493 翻出“咬合”` : `密码子识别：${cod} 与 ${AANAME(inc.aa)}-tRNA 有一个错配，解码中心咬合不紧`, !cog); this.wait(0.6); break;
        case 'codonOff': s.st = 'tc'; this.stg = 1; this.log('反密码子松开（错配不稳定）'); this.wait(0.3); break;
        case 'gtp': { s.st = 'gtp'; this.stg = 3; const tc = this.tc; tc.hyd = true;
          if (this.piTU) { this.piA = { p0: crApply(crEval(tc.cr), this.piTU.clone()), u: 0 }; this.tween(this.piA, 'u', 1, 1.2, null, false); }
          this.log(`EF-Tu：GTP + H₂O → GDP + Pi${cog ? '' : '（近同源，罕见）'}`, !cog); this.wait(0.6); break; }
        case 'kirStuck': s.st = 'kir'; this.stg = 4; s.kirN++; this.log('黄色霉素：EF-Tu·GDP 不能变构，卡在核糖体上', true); this.wait(0.5); break;
        case 'tuOff': { s.st = 'rel'; this.stg = 4; const tc = this.tc; this.tc = null;
          const tr = tc.tr; tr.b.cr = null; this.tr.A = tr;   // the tRNA stays (A/T); EF-Tu changes shape and leaves
          tc.tr = null;
          this.tween(tc, 'gdp', 1, 0.8, () => this.flyOut(tc));
          this.log('EF-Tu 变成 GDP 构象（结构域 1 转动），松开 tRNA 离开'); break; }
        case 'accom': { s.st = 'acc'; this.stg = 4; const tr = this.tr.A; tr.pa = S.AT; tr.pb = S.A; tr.w = 0;
          this.tween(tr, 'sAT', 0, 1.1); this.tween(tr, 'w', 1, 1.1, () => { tr.pa = tr.pb = S.A; tr.w = 0; });
          this.log(cog ? 'tRNA 容纳：伸直，氨酰末端摆进肽基转移中心' : `近同源 ${AANAME(inc.aa)}-tRNA 逃过了校对，被容纳（将掺错）`, !cog); break; }
        case 'reject': { if (cog) s.cogOff++; else s.near2++; const tr = this.tr.A; this.tr.A = null; s.inc = null; s.st = 'post'; this.stg = 4;
          this.tOut(tr); this.log(`校对：${cog ? '同源' : '近同源'} tRNA 被甩出 A 位`); this.wait(0.5); break; }
        case 'pep': {
          s.st = 'pre'; this.stg = 5; const A = this.tr.A, P = this.tr.P;
          this.pep.push({ aa: inc.aa, mis: inc.aa !== GENCODE[cod] }); s.L++; s.nCod++; s.codAll++; if (inc.aa !== GENCODE[cod]) { s.mis++; s.misAll++; }
          if (s.lastPep != null) { const d = s.T - s.lastPep; s.rate = s.rate ? 0.75 * s.rate + 0.25 / d : 1 / d; } s.lastPep = s.T;
          ctx.counters['肽键'] = (ctx.counters['肽键'] || 0) + 1;
          this.pepFrom = P; this.pepTr = A; this.pepW = 0; A.bead.visible = false;
          this.tween(this, 'pepW', 1, 0.8, () => { P.bead.visible = false; this.pepFrom = null;
            P.pa = S.P; P.pb = S.E; A.pa = S.A; A.pb = S.P; this.tween(P, 'hy', 1, 0.7); this.tween(A, 'hy', 1, 0.7); });
          this.log(`肽键形成：${AANAME(inc.aa)} 接到肽链 C 端（第 ${s.L} 个氨基酸）${inc.aa !== GENCODE[cod] ? ' ← 错误掺入！应为 ' + AANAME(GENCODE[cod]) : ''}${this.clmF() < 1 ? '（氯霉素减慢了这一步）' : ''}`, inc.aa !== GENCODE[cod]);
          s.inc = null; break; }
        case 'drop': { s.st = 'drop'; s.drop++; this.stg = 5;
          this.log(`红霉素堵住通道：${s.L} 个氨基酸的肽酰-tRNA 从核糖体掉落（流产翻译）`, true);
          this.releaseChain(true); for (const k of ['A', 'P', 'E']) if (this.tr[k]) { this.tOut(this.tr[k]); this.tr[k] = null; } s.E = false; s.inc = null; this.wait(0.8); break; }
        case 'gOn': { s.st = 'g'; this.stg = 6; const eg = this.eg = this.takeFrom(this.pool.g, () => this.mkEG()); eg.post = 0; eg.hyd = false;
          if (eg.b.fade < 1) this.tween(eg.b, 'fade', 1, 0.3, null, false);
          this.flyIn(eg, this.cG, 1.3); this.log('EF-G·GTP 结合到核糖体（tRNA 处于杂合态）'); break; }
        case 'trans': {
          s.st = 'gpost'; this.stg = 6; s.fua = c.FUA > 0 && rand() < c.FUA / (c.FUA + TL_DRUG.FUA.kd);
          if (this.tr.E) { this.tOut(this.tr.E); this.tr.E = null; }
          const P = this.tr.P, A = this.tr.A; this.tr.E = P; this.tr.P = A; this.tr.A = null; s.E = true;
          for (const [tr, a, b] of [[P, S.P, S.E], [A, S.A, S.P]]) { tr.pa = a; tr.pb = b; tr.w = 0; this.tween(tr, 'w', 1, 1.4, () => { tr.pa = tr.pb = b; tr.w = 0; tr.hy = 0; }); }
          this.pi += 3; this.mOff = 3; this.tween(this, 'mOff', 0, 1.4);
          this.eg.hyd = true; this.tween(this.eg, 'post', 1, 1.4);
          this.log(`移位：EF-G 水解 GTP，两个 tRNA 与 mRNA 前移 3 nt；A 位现在是 ${this.codonA()}${s.fua ? '。夫西地酸把 EF-G·GDP 锁在核糖体上' : ''}`, s.fua); break; }
        case 'gOff': { s.st = 'post'; this.stg = 6; const eg = this.eg; this.eg = null; if (s.fua) this.log('夫西地酸解离，EF-G·GDP 终于离开'); s.fua = false; this.flyOut(eg); this.wait(0.4);
          if (!s.fua) this.log('EF-G·GDP 离开，A 位空出'); break; }
        case 'eOff': { if (this.tr.E) { this.tOut(this.tr.E); this.tr.E = null; } s.E = false; this.log('空载 tRNA 从 E 位离开'); break; }
        case 'rfOn': { s.st = 'rf'; this.stg = 8; const rf = this.rf = this.takeFrom(this.pool.rf, () => this.mkRF()); if (rf.b.fade < 1) this.tween(rf.b, 'fade', 1, 0.3, null, false);
          this.flyIn(rf, this.cRF, 1.4); this.log(`RF1 识别终止密码子 ${cod}`); break; }
        case 'hyd': { s.st = 'term'; this.stg = 8; s.prot++; ctx.counters['蛋白质'] = (ctx.counters['蛋白质'] || 0) + 1;
          this.log(`RF1 的 GGQ 水解酯键：${s.L} 个氨基酸的蛋白质释放（${s.mis ? '含 ' + s.mis + ' 处错误' : '无错误'}）`); this.releaseChain(false); this.wait(0.8); break; }
        case 'recycle': { s.st = 'init'; this.stg = 0; this.log('RRF + EF-G 回收核糖体，tRNA、释放因子和 mRNA 离开');
          for (const k of ['A', 'P', 'E']) if (this.tr[k]) { this.tOut(this.tr[k]); this.tr[k] = null; }
          if (this.rf) { this.flyOut(this.rf); this.rf = null; } if (this.eg) { this.flyOut(this.eg); this.eg = null; }
          s.E = false; this.tween(this, 'mFade', 0, 0.8); break; }
        case 'init': { s.st = 'post'; this.stg = 0; this.pi = this.u5; this.mOff = 6; this.tween(this, 'mFade', 1, 0.6); this.tween(this, 'mOff', 0, 1.2);
          const fm = this.mkT('fM'); fm.b.cr = crNew(this.site.P.t); this.place(fm.b.cr, true); this.flyIn({ cr: fm.b.cr }, this.site.P.t, 1.4, () => { fm.b.cr = null; });
          this.tr.P = fm; this.pep = [{ aa: 'fM' }]; this.pepTr = fm; this.pepFrom = null; this.pepW = 1; this.outP = [];
          s.L = 1; s.mis = 0; s.nCod = 0; s.lastPep = null; s.inc = null; this.log('起始：mRNA 的 SD 序列与 16S 配对，fMet-tRNAᶠᴹᵉᵗ 进入 P 位'); break; }
        default: {
          const m = /^(TAC|PAR|CLM|ERY)([+-])$/.exec(id); if (!m) break;
          s.drug[m[1]] = m[2] === '+'; this.log(`${TL_DRUG[m[1]].name}${m[2] === '+' ? '结合到它的位点' : '解离'}`, m[2] === '+');
          if (m[2] === '+' && this.dsite[m[1]]) { this.dsite[m[1]].pop = 0; this.tween(this.dsite[m[1]], 'pop', 1, 0.6, null, false); }
        }
      }
    },
    /* the nascent chain leaves: released by RF1 (out of the exit tunnel) or dropped off with its tRNA */
    releaseChain(dropped) {
      const n = this.pep.length; if (!n) return;
      const P = []; for (let i = 0; i < n; i++) { this.pepMesh.getMatrixAt(i, _tm4); P.push(new THREE.Vector3().setFromMatrixPosition(_tm4)); }
      const mesh = new THREE.InstancedMesh(PARTICLE_GEO, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.45 }), n); mesh.frustumCulled = false; mesh.userData.name = '离开的肽链（每个珠 = 1 个氨基酸，颜色 = 种类）';
      this.pep.forEach((r, i) => mesh.setColorAt(i, new THREE.Color(aaCol(r.aa)))); procRoot.add(mesh);
      const dir = dropped ? this.ptc.clone().sub(this.C0).normalize().add(new THREE.Vector3(0, 0.3, 0)).normalize() : this.exitDir.clone();
      this.rel.push({ mesh, P, dir, t: 0, n });
      this.pep = []; this.pepTr = null; this.pepFrom = null; this.outP = [];
    },

    /* ---------------------------------------------------------------- frame */
    /* ---------------------------------------------------------------- atom-level close-ups (v16)
       The ribosome is drawn one blob per nucleotide, so the binding sites are shown separately with REAL all-atom coordinates:
       decoding centre = every residue within 6 A of the A-site anticodon in 4V6F (codon, anticodon, A1492 / A1493, G530,
       protein S12), PTC = every residue within 7 A of the A-site tRNA 3' end (both CCA ends, A2451, U2585, G2583 ...),
       fetched from RCSB ModelServer and put into the scene by fitting 4V6F's own 16S onto the scene. A1492 / A1493 are
       interpolated between their position in the empty-A-site 30S (1J5E, stacked inside h44) and in 4V6F (flipped out,
       reading the codon-anticodon minor groove); codon-anticodon hydrogen bonds = N/O pairs 2.5-3.4 A in the real atoms. */
    detail() {
      if (this.detP) return this.detP;
      return this.detP = (async () => {
        const all = this.ctx.allAtoms, dec = this.decPt, loc = all.filter(a => /16S/i.test(a.part) && a.na && a.p.distanceTo(dec) < 45);
        const V = (r) => new THREE.Vector3(r.x, r.y, r.z), clean = (rows) => rows.filter(r => r.el !== 'H' && (!r.alt || r.alt === '.' || r.alt === 'A'));
        const [me, apo] = await Promise.all([alignEntry('4V6F', { ref: '16S', refAtoms: loc }), alignEntry('1J5E', { ref: '16S', refAtoms: loc }).catch(e => { console.warn('1J5E', e); return null; })]);
        const meta = await fetchMeta('4V6F'); this.asymName = {};
        for (const e of meta.polymer_entities || []) for (const a of e.rcsb_polymer_entity_container_identifiers.asym_ids || []) this.asymName[a] = e.rcsb_polymer_entity.pdbx_description || '';
        const sur = async (seq, r) => clean(parseAtomSite(await fetchText(`https://models.rcsb.org/v1/4v6f/residueSurroundings?label_asym_id=${this.asymA}&label_seq_id=${seq}&radius=${r}&encoding=cif&copy_all_categories=false`))).map(x => ({ ...x, p: me.f(V(x)) }));
        const [dc, pt] = await Promise.all([sur(this.seqAC, 6), sur(this.seqA76, 7)]);
        let apoRows = [];
        if (apo) for (const n of [1492, 1493]) apoRows.push(...clean(parseAtomSite(await fetchText(msAtoms('1J5E', `label_asym_id=${apo.refAsym}&auth_seq_id=${n}`)))).map(x => ({ ...x, p: apo.f(V(x)) })));
        console.log(`近景：解码中心 ${dc.length} 个原子，肽基转移中心 ${pt.length} 个原子，1J5E A1492/A1493 ${apoRows.length} 个原子（4V6F 自身叠合 RMSD ${me.rmsd.toFixed(2)} Å${apo ? '，1J5E ' + apo.rmsd.toFixed(2) + ' Å' : ''}）`);
        return this.det = this.buildDetail(dc, pt, apoRows);
      })();
    },
    buildDetail(dc, pt, apoRows) {
      const root = new THREE.Group(); root.visible = false; procRoot.add(root);
      const ent = (r) => this.entOf(r), resKey = (r) => r.asym + ':' + r.seq;
      const group = (rows) => { const m = new Map(); for (const r of rows) { const k = resKey(r); if (!m.has(k)) m.set(k, []); m.get(k).push(r); } return m; };
      const COL = { A: '#ff7aa8', P: '#c58cff', m: '#ffb347', '16S': '#e9c46a', '23S': '#d4a373', prot: '#8fb3d9' };
      const kind = (r) => r.asym === this.asymA ? 'A' : r.asym === this.asymP ? 'P' : r.asym === this.asymM ? 'm' : /16S/i.test(ent(r)) ? '16S' : /23S/i.test(ent(r)) ? '23S' : 'prot';
      const mol = (atoms, col) => { const g = buildMolecules([{ atoms, centre: atoms[0].p.clone() }], 1, col, 'valence'); root.add(g); return g; };
      const site = (rows, name) => {
        const S = { name, parts: [], tags: [], hb: [], centre: rows.reduce((s, r) => s.add(r.p), V3n()).multiplyScalar(1 / Math.max(1, rows.length)), flip: [] };
        for (const [k, rs] of group(rows)) {
          const r0 = rs[0], kd = kind(r0), aseq = +r0.aseq, flip = kd === '16S' && (aseq === 1492 || aseq === 1493);
          const atoms = rs.map(r => ({ p: r.p.clone(), el: r.el, name: r.an }));
          const lab = r0.comp === 'MG' ? 'Mg²⁺' : r0.comp === 'MIA' ? `A 位 tRNA ms²i⁶A${r0.aseq}` : kd === 'A' ? `A 位 tRNA ${r0.comp}${r0.aseq}` : kd === 'P' ? `P 位 tRNA ${r0.comp}${r0.aseq}` : kd === 'm' ? `mRNA ${r0.comp}${r0.aseq}` : kd === 'prot' ? `${(ent(r0).match(/S\d+|L\d+/i) || [''])[0]} ${AA1[r0.comp] || r0.comp}${r0.aseq}`.trim() : `${r0.comp}${r0.aseq}`;
          const c = atoms.reduce((s, a) => s.add(a.p), V3n()).multiplyScalar(1 / atoms.length);
          const part = { kd, atoms, col: COL[kd], obj: kd === 'prot' && atoms.length > 14 ? null : mol(atoms, COL[kd]), c, flip };
          if (flip) { const ap = new Map(apoRows.filter(r => +r.aseq === aseq).map(r => [r.an, r.p])); part.inPos = atoms.map(a => ap.get(a.name) || a.p); part.outPos = atoms.map(a => a.p.clone()); part.w = 1; S.flip.push(part); }
          if (part.obj || flip) { const t = makeTag(lab, { p: c, cls: 'small' + (flip || /^(G530|A2451|U2585|G2583)$/.test(`${r0.comp}${r0.aseq}`) ? ' hl' : '') }); t.on = false; part.tag = t; S.tags.push(t); }
          S.parts.push(part);
        }
        return S;
      };
      const D = { root, dc: site(dc, 'dc'), pt: site(pt, 'ptc'), w: 1 };
      /* codon-anticodon hydrogen bonds (and the A1492 / A1493 / G530 contacts with the minor groove) from the real atoms */
      const NO = (p) => p.atoms.filter(a => a.el === 'N' || a.el === 'O');
      const A = D.dc.parts.filter(p => p.kd === 'A'), M = D.dc.parts.filter(p => p.kd === 'm'), R = D.dc.parts.filter(p => p.kd === '16S');
      const pairs = (X, Y, lo, hi, kindHb) => { for (const x of X) for (const y of Y) for (const a of NO(x)) for (const b of NO(y)) { const d = a.p.distanceTo(b.p); if (d > lo && d < hi) D.dc.hb.push({ a: a.p, b: b.p, kind: kindHb, x, y }); } };
      pairs(A, M, 2.5, 3.35, 'wc'); pairs(R, [...A, ...M], 2.5, 3.3, 'mon');
      const mat = new THREE.LineDashedMaterial({ color: 0x2f9e44, dashSize: 0.35, gapSize: 0.25, depthTest: false, transparent: true });
      for (const h of D.dc.hb) { const g = new THREE.BufferGeometry().setFromPoints([h.a, h.b]); h.line = new THREE.Line(g, h.kind === 'wc' ? mat : mat.clone()); if (h.kind !== 'wc') h.line.material.color.set(0xe8590c); h.line.computeLineDistances(); root.add(h.line); }
      D.state = makeTag('', { p: D.dc.centre.clone().add(V3n(0, 9, 0)), cls: 'hl' }); D.state.on = false;
      D.ptState = makeTag('', { p: D.pt.centre.clone().add(V3n(0, 9, 0)), cls: 'hl' }); D.ptState.on = false;
      console.log(`近景：密码子–反密码子氢键 ${D.dc.hb.filter(h => h.kind === 'wc').length} 条，A1492/A1493/G530 与小沟接触 ${D.dc.hb.filter(h => h.kind === 'mon').length} 处`);
      return D;
    },
    entOf(r) { return this.asymName?.[r.asym] || ''; },
    closeUp(v) {
      this.view = v; this.viewIn = false;
      if (!v) { resetCamera(current?.camera); return; }
      status(v === 'dc' ? '下载解码中心的全原子坐标（4V6F + 1J5E）…' : '下载肽基转移中心的全原子坐标（4V6F）…', true);
      this.detail().then(D => { status(v === 'dc' ? '解码中心：真实原子坐标' : '肽基转移中心：真实原子坐标');
        const S = v === 'dc' ? D.dc : D.pt; flyTo(S.centre.clone().applyMatrix4(world.matrixWorld), v === 'dc' ? 40 : 52, 1800); })
        .catch(e => { console.warn(e); status('近景下载失败：' + e.message); this.view = null; });
    },
    drawDetail(dt) {
      const D = this.det; if (!D) return;
      const s = this.s, dist = camera.position.distanceTo(controls.target), on = !!this.view && dist < 260;
      if (this.view && dist < 200) this.viewIn = true;
      if (this.view && this.viewIn && dist > 400) { this.view = null; this.viewIn = false; }   /* zoomed back out by hand */
      D.root.visible = on;
      if (!D.dim) { D.dim = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({ transparent: true, depthTest: false, depthWrite: false,
          uniforms: { uC: { value: new THREE.Color() }, uA: { value: 0 } }, vertexShader: 'void main(){ gl_Position = vec4(position.xy, 0.0, 1.0); }',
          fragmentShader: 'uniform vec3 uC; uniform float uA; void main(){ gl_FragColor = vec4(uC, uA); }' }));
        D.dim.frustumCulled = false; D.dim.renderOrder = -100; overlay.add(D.dim); procWorld.push(D.dim); }
      D.dimA = (D.dimA || 0) + ((on ? 1 : 0) - (D.dimA || 0)) * Math.min(1, dt * 3);
      D.dim.visible = D.dimA > 0.01; D.dim.material.uniforms.uA.value = 0.62 * D.dimA; D.dim.material.uniforms.uC.value.set(illustrative() ? 0xffffff : 0x05070d);
      if (this.mMesh) this.mMesh.visible = !on;
      const st = s?.st || 'post', inA = ['cr', 'gtp', 'kir', 'rel', 'acc', 'pre'].includes(st), cog = s?.inc?.cls === 'c' || !s?.inc;
      /* decoding centre: the anticodon is there only while a tRNA reads the A codon; A1492 / A1493 flip out on a cognate match */
      const wT = st === 'cr' ? (cog ? 1 : 0.35) : inA ? (cog ? 1 : 0.5) : 0;
      const prevW = D.w; D.w += Math.sign(wT - D.w) * Math.min(Math.abs(wT - D.w), dt * 1.4);
      const showDC = on && this.view === 'dc', showPT = on && this.view === 'ptc';
      for (const p of D.dc.parts) { if (p.obj) p.obj.visible = showDC && (p.kd !== 'A' || inA); if (p.tag) p.tag.on = showDC && (p.kd !== 'A' || inA); }
      for (const p of D.pt.parts) { const vis = showPT && (p.kd !== 'A' || ['acc', 'pre', 'g'].includes(st)); if (p.obj) p.obj.visible = vis; if (p.tag) p.tag.on = vis; }
      if (Math.abs(D.w - prevW) > 1e-4 || !D.flipBuilt) { D.flipBuilt = true;
        for (const p of D.dc.flip) { if (p.obj) { p.obj.parent?.remove(p.obj); disposeObj(p.obj); }
          const atoms = p.atoms.map((a, i) => ({ ...a, p: p.inPos[i].clone().lerp(p.outPos[i], ease(D.w)) }));
          p.obj = buildMolecules([{ atoms, centre: atoms.reduce((q, a) => q.add(a.p), V3n()).multiplyScalar(1 / atoms.length) }], 1, p.col, 'valence'); D.root.add(p.obj);
          p.tag.p.copy(atoms.reduce((q, a) => q.add(a.p), V3n()).multiplyScalar(1 / atoms.length)); } }
      for (const p of D.dc.flip) if (p.obj) p.obj.visible = showDC;
      for (const h of D.dc.hb) h.line.visible = showDC && inA && (h.kind === 'wc' ? true : D.w > 0.9);
      D.state.on = showDC; D.ptState.on = showPT;
      D.state.set(!inA ? 'A 位空着：A1492 / A1493 收在 h44 里（1J5E）' : st === 'cr' || st === 'gtp' || st === 'kir' ? (cog ? '同源：三对碱基配对，A1492 / A1493 翻出“咬住”小沟 → GTP 酶被激活' : '近同源：一个错配，小沟几何不对，A1492 / A1493 咬不紧') : (cog ? 'tRNA 已被接受，正在容纳 / 已容纳' : '近同源 tRNA 正在被校对'));
      D.ptState.set(st === 'acc' ? 'A 位氨酰末端已摆进 PTC：α-NH₂ 对准 P 位肽酰酯键' : st === 'pre' ? '肽键已形成：肽链转到 A 位 tRNA 上（23S rRNA 是核酶）' : st === 'g' ? 'EF-G 推动移位' : 'P 位肽酰-tRNA 在 PTC，等下一个氨酰-tRNA');
      /* named events as they happen */
      if (this.lastSt !== st) { const prev = this.lastSt; this.lastSt = st;
        if (showDC && st === 'cr') eventTag(cog ? '密码子识别：A1492 / A1493 翻出，G530 转动' : '密码子识别：一个错配', D.dc.centre.clone().add(V3n(0, -8, 0)), 2.6);
        if (showPT && st === 'pre' && prev === 'acc') eventTag('肽键形成：α-NH₂ 进攻酯键羰基碳', D.pt.centre.clone().add(V3n(0, -8, 0)), 2.6); }
    },
    update(ctx, dt) {
      if (!this.s) return;
      this.speed = +(ctx.cell?.ctrl?.speed ?? this.speed);
      const c = this.conc(), key = JSON.stringify(c); if (key !== this.cKey) { this.cKey = key; this.next = null; }   // memoryless: resample after a change
      for (let i = this.tw.length - 1; i >= 0; i--) { const x = this.tw[i]; x.t += dt; const u = Math.min(1, x.t / x.dur); x.o[x.k] = x.a + (x.b - x.a) * ease(u);
        if (u >= 1) { this.tw.splice(i, 1); x.done?.(); } }
      this.updPool(dt, c);
      if (!this.paused || this.stepReq) this.runEngine(dt);
      this.draw(dt); this.drawDetail(dt);
    },
    updPool(dt, c) {
      const H = this.H, keep = (cr) => { const t = cr.t1;
        for (const ax of ['x', 'y', 'z']) { const lim = ax === 'y' ? H * 0.75 : H, d = t[ax] - this.C0[ax]; if (Math.abs(d) > lim) t[ax] = this.C0[ax] + Math.sign(d) * lim; }
        const r = t.clone().sub(this.C0), L = r.length(), m = this.Rr + 30; if (L < m) t.copy(this.C0).addScaledVector(r.normalize(), m);
        if (this.yMax != null && t.y > this.yMax) t.y = this.yMax; };
      const drift = (it, D) => { const cr = it.cr; if (cr.w < 1) return;
        cr.t1.x += (randVis() - 0.5) * D * dt; cr.t1.y += (randVis() - 0.5) * D * dt; cr.t1.z += (randVis() - 0.5) * D * dt; keep(cr); cr.t0.copy(cr.t1);
        cr.q1.multiply(_pq.setFromEuler(new THREE.Euler((randVis() - 0.5) * dt * 0.8, (randVis() - 0.5) * dt * 0.8, (randVis() - 0.5) * dt * 0.8))); cr.q0.copy(cr.q1); };
      const maintain = (list, target, mk) => {
        while (list.length < target) { const it = mk(); this.place(it.cr, true); [it.tr?.b, it.tu, it.b].filter(Boolean).forEach(b => { b.fade = 0; this.tween(b, 'fade', 1, 0.8, null, false); }); list.push(it); }
        while (list.length > target) { list.sort((a, b) => a.cr.t1.distanceToSquared(this.C0) - b.cr.t1.distanceToSquared(this.C0)); const it = list.pop(); this.flyOut(it); }
      };
      maintain(this.pool.tc, Math.min(12, Math.round(c.TC * this.perUM)), () => this.mkTC('ACDEFGHIKLMNPQRSTVWY'[Math.floor(rand() * 20)]));
      maintain(this.pool.g, Math.min(10, Math.round(c.EFG * this.perUM)), () => this.mkEG());
      if (this.RF) maintain(this.pool.rf, Math.min(6, Math.round(c.RF1 * this.perUM)), () => this.mkRF());
      for (const it of this.pool.tc) drift(it, 260); for (const it of this.pool.g) drift(it, 220); for (const it of this.pool.rf) drift(it, 260);
      /* free antibiotic molecules: number from concentration, fast small-molecule diffusion */
      for (const d of ['TAC', 'PAR', 'CLM', 'ERY', 'KIR', 'FUA']) {
        const L = this.free[d] = this.free[d] || [], tgt = this.tpls[d] ? Math.min(14, Math.round(c[d] * this.perUM)) : 0;
        while (L.length < tgt) { const mol = this.ctx.makeMol(this.tpls[d], true, TL_DRUG[d].col); mol.visible = true; mol.position.copy(this.randPt(false)); mol.quaternion.copy(randQ()); L.push(mol); }
        while (L.length > tgt) { const mol = L.pop(); procRoot.remove(mol); disposeObj(mol); }
        for (const mol of L) { mol.position.x += (randVis() - 0.5) * 900 * dt; mol.position.y += (randVis() - 0.5) * 900 * dt; mol.position.z += (randVis() - 0.5) * 900 * dt;
          const r = mol.position.clone().sub(this.C0); if (r.length() > this.H || r.length() < this.Rr || (this.yMax != null && mol.position.y > this.yMax)) mol.position.copy(this.randPt(false)); mol.rotation.x += dt; mol.rotation.y += dt * 0.7; }
      }
    },
    draw(dt) {
      const s = this.s, S = this.site, V = THREE.Vector3;
      for (const b of this.bodies) this.drawBody(b);
      /* amino-acid beads on the 3' ends */
      const v1 = new V(), v2 = new V();
      const beadOn = (tr) => { if (!tr?.bead.visible) return; this.end3T(tr, v1); tr.b.calc(this.T.n - 4, v2); if (tr.b.cr) crApply(tr.b.cr, v2); tr.bead.position.copy(v1).addScaledVector(v1.clone().sub(v2).normalize(), 3); };
      [this.tr.E, this.tr.P, this.tr.A, this.tc?.tr, ...this.pool.tc.map(it => it.tr)].forEach(beadOn);
      /* GTP / GDP / Pi on the active EF-Tu and EF-G */
      const M = this.m, place = (mol, pose, cr, on) => { if (!mol) return; mol.visible = !!(on && pose); if (!mol.visible) return;
        mol.position.copy(pose.t); mol.quaternion.copy(pose.q); if (cr) { crApply(cr, mol.position); mol.quaternion.premultiply(cr.q); } };
      place(M.gtpT, this.gtpTU, this.tc?.cr, this.tc && !this.tc.hyd);
      place(M.gdpT, this.gdpTU, this.tc?.cr, this.tc && this.tc.hyd);
      if (M.piT) { const on = this.piA && this.piA.u < 1; M.piT.visible = !!on; if (on) M.piT.position.copy(this.piA.p0).addScaledVector(this.piA.p0.clone().sub(this.cTC).normalize(), 30 * this.piA.u); }
      place(M.gtpG, this.gtpG, this.eg?.cr, this.eg && !this.eg.hyd);
      place(M.gdpG, this.gdpG, this.eg?.cr, this.eg && this.eg.hyd);
      place(M.fua, this.fuaG, this.eg?.cr, this.eg && s.fua && s.st === 'gpost');
      /* drugs in their sites */
      for (const [k, d] of Object.entries(this.dsite)) {
        const on = k === 'KIR' ? !!(this.tc?.kir && ['gtp', 'kir'].includes(s.st)) : !!s.drug[k];
        d.mol.visible = on; d.tag.on = on; if (on) d.mol.scale.setScalar(1 + 0.6 * Math.sin(Math.PI * (d.pop ?? 1)));
      }
      /* mRNA beads along the real path; x = jP + (i - pi) + mOff */
      const mm = this.mMesh, n = this.mPts.length;
      for (let i = 0; i < this.seq.length; i++) {
        const x = this.jP + (i - this.pi) + this.mOff, vis = x > -22 && x < n + 22;
        this.mPos(x, _tp); _tm4.compose(_tp, _tq0, _tsv.setScalar(vis ? Math.max(1e-3, 2.7 * this.mFade) : 1e-3)); mm.setMatrixAt(i, _tm4);
      }
      mm.instanceMatrix.needsUpdate = true;
      const down = this.up.clone().negate();
      for (const [k, o] of [['E', -3], ['P', 0], ['A', 3]]) { const t = this.tag[k], cod = this.codonAt(o), aa = GENCODE[cod];
        t.on = this.mFade > 0.5 && cod.length === 3; this.mPos(this.jP + o + 1 + this.mOff, t.p).addScaledVector(down, 12);
        const i0 = this.pi + o; t.set(`<b>${cod}</b> ${i0 < this.u5 ? '' : aa === '*' ? '终止' : i0 === this.u5 ? 'fMet' : AANAME(aa)}`); }
      /* factor tags */
      const tagAt = (t, it, c, html) => { t.on = !!it; if (!it) return; crEval(it.cr); crApply(it.cr, t.p.copy(c)); t.set(html); };
      const inc = s.inc;
      tagAt(this.tag.tc, this.tc, this.cTC, this.tc ? `EF-Tu·${this.tc.hyd ? 'GDP' : 'GTP'}·${AANAME(this.tc.tr?.aa || inc?.aa)}-tRNA${inc?.cls === 'n' ? ' <span class="w">近同源</span>' : ''}${this.tc.kir ? ' · 黄色霉素' : ''}` : '');
      tagAt(this.tag.g, this.eg, this.cG, this.eg ? `EF-G·${this.eg.hyd ? 'GDP' : 'GTP'}${s.fua && s.st === 'gpost' ? ' · 夫西地酸' : ''}` : '');
      tagAt(this.tag.rf, this.rf, this.cRF || this.C0, 'RF1');
      /* nascent chain: from the 3' end of the peptidyl-tRNA through the computed tunnel, then compacting outside */
      const L = this.pep.length, pm = this.pepMesh;
      if (L && this.pepTr) {
        const anc = this.end3T(this.pepTr, new V()); if (this.pepFrom && this.pepW < 1) anc.lerp(this.end3T(this.pepFrom, new V()), 1 - this.pepW);   // pepTr is the target
        const path = [anc, ...this.tun], Lt = pathLength(path), step = 3.5;
        const posIn = (k, out) => alongPath(path, (L - 1 - k) * step + 3, out);
        const nOut = Math.max(0, Math.min(L, Math.ceil(L - 1 - (Lt - 3) / step)));
        const O = this.outP;
        for (let k = 0; k < nOut; k++) if (!O[k]) O[k] = this.exitPt.clone().addScaledVector(this.exitDir, 3).add(new V(rand() - 0.5, rand() - 0.5, rand() - 0.5).multiplyScalar(3));
        O.length = nOut;
        if (nOut) { const cc = O.reduce((a, p) => a.add(p), new V()).multiplyScalar(1 / nOut), nxt = new V(), d = new V();
          for (let it = 0; it < 2; it++) for (let k = 0; k < nOut; k++) { const p = O[k];
            if (k + 1 < nOut) nxt.copy(O[k + 1]); else posIn(k + 1, nxt);
            d.copy(nxt).sub(p); const len = d.length() || 1, f = (len - 3.8) / len * (k + 1 < nOut ? 0.5 : 1); p.addScaledVector(d, f); if (k + 1 < nOut) O[k + 1].addScaledVector(d, -f);
            if (nOut < 260) for (let j = k + 2; j < nOut; j++) { d.copy(O[j]).sub(p); const l2 = d.lengthSq(); if (l2 < 22 && l2 > 1e-4) { const l = Math.sqrt(l2), g = (4.7 - l) / l * 0.5; p.addScaledVector(d, -g); O[j].addScaledVector(d, g); } }
            if (nOut > 6) p.lerp(cc, 0.012);
            const h = d.copy(p).sub(this.exitPt).dot(this.exitDir); if (h < 2) p.addScaledVector(this.exitDir, 2 - h); }
        }
        const col = new THREE.Color();
        for (let k = 0; k < L; k++) { if (k < nOut) _tp.copy(O[k]); else posIn(k, _tp);
          const r = this.pep[k]; _tm4.compose(_tp, _tq0, _tsv.setScalar(r.mis ? 3.3 : 2.4)); pm.setMatrixAt(k, _tm4); pm.setColorAt(k, col.set(r.mis ? '#ff2d2d' : aaCol(r.aa))); }
        pm.count = L; pm.instanceMatrix.needsUpdate = true; pm.instanceColor.needsUpdate = true;
        this.tag.pep.on = L > 3; if (L > 3) { this.tag.pep.p.copy(nOut ? O[0] : this.exitPt); this.tag.pep.set(`新生肽链 ${L} aa`); }
      } else { pm.count = 0; this.tag.pep.on = false; }
      /* released chains drift away */
      for (let i = this.rel.length - 1; i >= 0; i--) { const R = this.rel[i]; R.t += dt;
        for (let k = 0; k < R.n; k++) { R.P[k].addScaledVector(R.dir, 60 * dt).add(new V(randVis() - 0.5, randVis() - 0.5, randVis() - 0.5).multiplyScalar(2)); _tm4.compose(R.P[k], _tq0, _tsv.setScalar(2.4 * Math.max(0.01, 1 - R.t / 4))); R.mesh.setMatrixAt(k, _tm4); }
        R.mesh.instanceMatrix.needsUpdate = true; if (R.t > 4) { procRoot.remove(R.mesh); R.mesh.material.dispose(); this.rel.splice(i, 1); } }
    },

    /* ---------------------------------------------------------------- HUD text */
    explain() {
      const s = this.s, K = TL_K, ms = (t) => t < 1 ? (t * 1000).toFixed(0) + ' ms' : t.toFixed(2) + ' s';
      const R = this.rates().filter(r => !/[+-]$|^eOff$/.test(r[1])), tot = R.reduce((a, r) => a + r[0], 0);
      const lines = [];
      lines.push(`【当前】${TL_STATE[s.st] || s.st}${this.paused ? '（已暂停，可单步）' : ''}`);
      if (s.inc) lines.push(`A 位来者：${AANAME(s.inc.aa)}-tRNA，${s.inc.cls === 'c' ? '同源' : '近同源（1 个错配）'}，密码子 ${this.codonA()}`);
      if (R.length) lines.push('【下一步的可能】' + R.map(r => `${TL_EV[r[1]] || r[1]} ${r[0] >= 10 ? r[0].toFixed(0) : r[0].toPrecision(2)} s⁻¹（${(100 * r[0] / tot).toFixed(r[0] / tot < 0.01 ? 2 : 0)}%）`).join('；') + `；平均等 ${ms(1 / tot)}`);
      const dr = ['TAC', 'PAR', 'CLM', 'ERY'].filter(d => s.drug[d]).map(d => TL_DRUG[d].name);
      if (dr.length) lines.push('【结合中的抗生素】' + dr.join('、') + (this.eryStall() ? '（肽链被红霉素堵住）' : ''));
      const ab = ['TAC', 'PAR', 'CLM', 'ERY', 'KIR', 'FUA'].filter(d => this.conc()[d] > 0);
      if (ab.length) lines.push(...ab.map(d => `· ${TL_DRUG[d].name}：${TL_DRUG[d].eff}`));
      const shown = this.pep.map(r => r.aa === 'fM' ? 'M' : r.mis ? `[${r.aa}]` : r.aa).join('');
      lines.push(`【肽链 N→C】${shown.length > 60 ? '…' + shown.slice(-60) : shown || '（无）'}　/ 模板 ${this.aa.length} aa`);
      lines.push(`【统计】蛋白 ${s.prot} 条，掉落 ${s.drop}；本轮错误 ${s.mis}/${s.nCod}，累计 ${s.misAll}/${s.codAll}${s.codAll ? `（${(100 * s.misAll / s.codAll).toFixed(2)}%）` : ''}；非同源碰撞 ≈${Math.round(s.non)} 次；近同源被拒：初选 ${s.near1}，校对 ${s.near2}${s.kirN ? `；EF-Tu 被黄色霉素卡住 ${s.kirN} 次` : ''}`);
      lines.push(`【视野里的分子】三元复合物 ${this.pool.tc.length}、EF-G ${this.pool.g.length}、RF1 ${this.pool.rf.length}（每 μM ≈ ${this.perUM.toFixed(2)} 个）`);
      lines.push('【事件】' + s.log.slice().reverse().map(([t, x, w]) => `\n${w ? '⚠ ' : ''}${ms(t)}  ${x}`).join(''));
      return lines.join('\n');
    },
    cell: {
      title: '翻译 · 动力学模拟（单个核糖体）', wide: true, noWarmup: true,
      init() { return {}; },
      step() { return { rate: 1, rotor: 0 }; },
      timeLabel() { const T = proc?.s?.T || 0; return '分子时间 ' + (T < 1 ? (T * 1000).toFixed(0) + ' ms' : T.toFixed(2) + ' s'); },
      controls: [
        { type: 'section', label: '细胞质浓度（μM）' },
        { type: 'range', id: 'TC', label: '三元复合物 EF-Tu·GTP·aa-tRNA', min: 0, max: 80, step: 1, value: 25, unit: 'μM', tip: '所有氨酰-tRNA 的三元复合物总浓度；对某个密码子约 4% 同源、6% 近同源' },
        { type: 'range', id: 'EFG', label: 'EF-G', min: 0, max: 40, step: 0.5, value: 20, unit: 'μM' },
        { type: 'range', id: 'RF1', label: 'RF1（释放因子）', min: 0, max: 10, step: 0.1, value: 2, unit: 'μM' },
        { type: 'section', label: '抗生素（μM）' },
        { type: 'range', id: 'TAC', label: '四环素（挡 A 位）', min: 0, max: 50, step: 0.5, value: 0, unit: 'μM' },
        { type: 'range', id: 'PAR', label: '巴龙霉素（读错）', min: 0, max: 20, step: 0.1, value: 0, unit: 'μM' },
        { type: 'range', id: 'CLM', label: '氯霉素（挡肽键形成）', min: 0, max: 50, step: 0.5, value: 0, unit: 'μM' },
        { type: 'range', id: 'ERY', label: '红霉素（堵出口通道）', min: 0, max: 5, step: 0.05, value: 0, unit: 'μM' },
        { type: 'range', id: 'KIR', label: '黄色霉素（卡住 EF-Tu）', min: 0, max: 5, step: 0.05, value: 0, unit: 'μM' },
        { type: 'range', id: 'FUA', label: '夫西地酸（卡住 EF-G）', min: 0, max: 20, step: 0.1, value: 0, unit: 'μM' },
        { type: 'section', label: 'mRNA（开放阅读框）' },
        { type: 'select', id: 'orf', value: 'ubq', options: Object.entries(TL_ORF).map(([k, v]) => [k, v[0]]).concat([['custom', '自定义（在下面输入氨基酸序列）']]), change: (sim, v) => { if (v !== 'custom') proc?.setOrf(v); } },
        { type: 'text', placeholder: '输入单字母氨基酸序列，回车（如 MKTAYIAK）', apply: (sim, v) => proc?.setOrf('custom', v) },
        { type: 'section', label: '时间' },
        { type: 'select', id: 'speed', value: '0.02', options: [['0.005', '慢放：分子时间 ×1/200'], ['0.02', '慢放 ×1/50'], ['0.1', '慢放 ×1/10'], ['1', '实时（动画几乎瞬时）'], ['10', '快进 ×10（看统计）']] },
        { type: 'button', label: '⏸ 暂停', run: (sim, b) => { if (!proc) return; proc.paused = !proc.paused; b.textContent = proc.paused ? '▶ 继续' : '⏸ 暂停'; } },
        { type: 'button', label: '⏭ 单步', tip: '执行下一个事件（暂停时用）', run: () => { if (proc) { proc.paused = true; proc.stepReq = 1; } } },
        { type: 'button', label: '↺ 重新开始', run: () => proc?.restart() },
        { type: 'section', label: '镜头（原子细节）' },
        { type: 'button', label: '🔍 解码中心', tip: '真实全原子坐标：密码子–反密码子配对、A1492 / A1493 翻出（4V6F + 1J5E）', run: () => proc?.closeUp?.('dc') },
        { type: 'button', label: '🔍 肽基转移中心', tip: '真实全原子坐标：两个 tRNA 的 CCA 末端和 23S rRNA 的 A2451、U2585 等', run: () => proc?.closeUp?.('ptc') },
        { type: 'button', label: '↩ 全景', run: () => proc?.closeUp?.(null) },
      ],
      series: [
        { label: '延伸速率', get: () => { const s = proc?.s; if (!s?.rate) return 0; const idle = s.lastPep != null ? s.T - s.lastPep : 0; return Math.min(s.rate, idle > 0 ? 1 / idle : s.rate); }, fmt: (v) => v.toFixed(1) + ' aa/s', range: [0, 25], color: '#2fb39c' },
        { label: '肽链长度', get: () => proc?.pep?.length || 0, fmt: (v) => v + ' aa', range: [0, 80], color: '#e4572e' },
        { label: '错误率（累计）', get: () => { const s = proc?.s; return s?.codAll ? s.misAll / s.codAll : 0; }, fmt: (v) => (v * 100).toFixed(2) + ' %', range: [0, 0.05], color: '#d9467e' },
        { label: '已合成蛋白', get: () => proc?.s?.prot || 0, fmt: (v) => v + ' 条', range: [0, 10], color: '#3b6fe0' },
      ],
      key: [{ label: 'EF-Tu', color: '#2f7fe0' }, { label: 'tRNA', color: '#d6336c' }, { label: 'EF-G', color: '#159a52' }, { label: 'RF1', color: '#7c4ddb' }, { label: 'mRNA：A', color: '#4caf50' }, { label: 'U', color: '#e5484d' }, { label: 'G', color: '#f5a623' }, { label: 'C', color: '#3b6fe0' }],
      explain: () => proc?.explain?.() || '',
    },
  },

