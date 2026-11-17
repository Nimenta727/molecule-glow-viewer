  /* ============================================================================= KcsA in its membrane: pH gating, C-type
     inactivation, knock-on permeation, internal blockers. All conformations are real structures superposed on the scene by
     the pore helix + filter (residues 60-80 of all four chains, chain correspondence by best permutation):
     closed 1K4C, open 5VK6 (E71A), open-inactivated 5VKE, TBA in the cavity 2HVK, Ba2+ in the filter 2ITD.
     Two clocks: gating / block (ms - s, real time) and permeation (ns, slowed ~1e9 x). Permeation = the Berneche-Roux
     knock-on cycle [S1,S3] -> [S1,S3,Cav] -> [S0,S2,S4] -> [S2,S4] -> [S1,S3] with Eyring voltage dependence (electrical
     distances 0.15 / 0.35 / 0.15 / 0.35) and detailed balance, so the current reverses exactly at E_K; rates calibrated
     offline to ~90 pS (KcsA). Ions move along the pore path computed from the open structure (findChannel). */
  kcsa: {
    lead: 'KcsA 钾通道（链霉菌）：K⁺ 单列穿过选择性过滤器，画面比真实慢约一亿倍。',
    energyHL: [[{ aseqs: [[96, 124]] }], [{ aseqs: [[100, 112]] }], [{ aseqs: [[75, 79]] }], [{ aseqs: [[75, 79]] }], [{ aseqs: [[78, 82]] }], [{ aseqs: [[71, 71], [77, 77], [80, 80]] }]],
    energy: [
      ['pH 门控', 'KcsA 胞内端有一组可质子化的残基（His25、Glu118、Glu120 等）。胞内 pH 降到约 4 时它们质子化，静电相互作用改变，内螺旋 TM2 在 Gly99 附近弯曲外张，束交叉处（Thr112 一带）的“门”打开。动画用 1K4C（关）和 5VK6（开）的真实坐标插值。'],
      ['水合 K⁺ 进入中央腔', 'K⁺ 带着水合壳从胞质经打开的门进入中央腔。腔里充满水，四个孔螺旋的偶极负端指向腔中心，稳定这里的阳离子（Doyle 等 1998）。'],
      ['过滤器：羰基氧替代水', '选择性过滤器 TVGYG（Thr75–Gly79）的主链羰基氧围成四个结合位点 S1–S4，每个位点 8 个氧，几何上与水合壳几乎一样。K⁺ 脱水的代价被这些氧补偿；更小的 Na⁺ 不能同时贴近 8 个氧，补偿不足，所以进不来。'],
      ['敲击：离子相斥推动通过', '过滤器里通常有两个 K⁺，中间隔着水，交替占 S1、S3 或 S2、S4。一个新 K⁺ 进入 S4 时，静电排斥把整列离子往外推一格，最外面的离子离开（Bernèche & Roux 2001 的敲击循环）。每秒可通过约 10⁸ 个离子，所以动画是慢放：1 秒相当于几纳秒。'],
      ['出胞外重新水合', 'K⁺ 从 S0 离开进入胞外液，重新获得水合壳。电流方向由电化学梯度决定：膜电位高于 K⁺ 平衡电位 E_K 时外流，低于时内流（模型满足细致平衡，所以正好在 E_K 处反转）。'],
      ['C 型失活', '门开着一段时间后，过滤器会慢慢塌陷：Gly77 的羰基翻转，中间的 S2、S3 位点失去离子，通道虽然门开着却不导电（5VKE、1K4D 的真实结构）。驱动它的是过滤器后面 Glu71–Asp80 的氢键网络；E71A 突变几乎不失活（5VK6 就是这个突变体）。'] ],
    stage() { return this.stg ?? 0; },
    caption: 'KcsA 钾通道（链霉菌）嵌在细胞膜里。胞内 pH 打开或关闭它的门，开放后会发生 C 型失活。K⁺ 按敲击机制单列通过选择性过滤器，沿由开放结构算出的孔道路径移动；Na⁺ 被排斥。右上角可以改膜电位、两侧浓度、胞内 pH，加 TBA 或 Ba²⁺ 阻断。关闭、开放、失活三种构象和阻断剂位置都来自晶体结构（1K4C / 5VK6 / 5VKE / 2HVK / 2ITD）。',
    async setup(ctx) {
      const V = () => new THREE.Vector3();
      const g = this.g = ctx.partGroups(/potassium channel|KcsA/i)[0]; if (!g) throw new Error('找不到 KcsA');
      const A = g.atoms, key = (a) => parseInt(a.aseq) || a.seq;
      /* the pore axis is vertical through the channel's centroid (the channel may sit anywhere in a bigger scene) */
      const O = A.reduce((s, a) => s.add(a.p), V()).multiplyScalar(1 / A.length), rA = Math.max(...A.map(a => a.p.distanceTo(O)));
      const mine = (L) => L.centre.distanceTo(O) < rA + 6, offAx = (p) => Math.hypot(p.x - O.x, p.z - O.z);
      /* the four K+ in the 1K4C filter sit on the 4-fold axis (symmetry copies coincide) */
      let Ks = [];
      for (const L of ctx.ligands) { if (!mine(L)) continue; if (L.comp === 'K' && offAx(L.centre) < 3 && !Ks.some(q => q.distanceTo(L.centre) < 1)) Ks.push(L.centre.clone()); if (L.comp === 'K') ctx.hideLigand(L); }
      /* extracellular (filter) side up: turn the channel (and its own small molecules) 180 deg about a horizontal axis through its centroid */
      const fy = Ks.length ? Ks.reduce((s, p) => s + p.y, 0) / Ks.length : O.y;
      if (fy < O.y) {
        const fl = (p) => { p.y = 2 * O.y - p.y; p.z = 2 * O.z - p.z; };
        const myL = ctx.ligands.filter(mine); for (const a of A) fl(a.p); for (const L of myL) { L.atoms.forEach(x => fl(x.p)); fl(L.centre); } Ks.forEach(fl);
        for (const k in model.entityStats) if (/potassium channel|kcsa/i.test(k)) { const e = model.entityStats[k]; [e.min, e.max] = [2 * O.y - e.max, 2 * O.y - e.min]; e.mean = 2 * O.y - e.mean; }
      }
      Ks.sort((a, b) => b.y - a.y);
      const yOf = (k) => { const r = A.filter(a => key(a) === k); return r.reduce((s, a) => s + a.p.y, 0) / Math.max(1, r.length); };
      const yT = yOf(75), yG = yOf(79), inF = Ks.filter(p => p.y > yT - 2.5 && p.y < yG + 2.5);
      const ax = (y) => new THREE.Vector3(O.x, y, O.z); this.O = O;
      const S = this.site = {};
      if (inF.length >= 4) inF.slice(0, 4).forEach((p, i) => S['S' + (i + 1)] = ax(p.y));
      else { const top = Math.max(yT, yG), bot = Math.min(yT, yG); for (let i = 0; i < 4; i++) S['S' + (i + 1)] = ax(top + 1.5 - i * (top - bot + 3) / 4); }
      S.S0 = ax(S.S1.y + 3.4); const cavK = Ks.find(p => p.y < S.S4.y - 4 && p.y > S.S4.y - 12); S.cav = ax(cavK ? cavK.y : S.S4.y - 7.5);
      console.log('KcsA 位点 y:', Object.fromEntries(Object.entries(S).map(([k, v]) => [k, v.y.toFixed(1)])), '晶体 K⁺', Ks.length);
      /* other states: superpose by residues 60-80 of all four chains, chain correspondence = best of the 24 permutations */
      status('下载 KcsA 开放 / 失活 / 阻断剂结构并叠合…', true);
      const sceneCh = [...new Set(A.map(a => a.asym))].sort();
      const byCh = Object.fromEntries(sceneCh.map(c => [c, A.filter(a => a.asym === c)]));
      const perms = (arr) => arr.length <= 1 ? [arr] : arr.flatMap((x, i) => perms([...arr.slice(0, i), ...arr.slice(i + 1)]).map(r => [x, ...r]));
      const fitState = async (id) => {
        const e = await loadEntry(id, true);
        const kc = e.atoms.filter(a => /potassium channel|kcsa/i.test(e.entities[a.ent]?.name || ''));
        const stCh = [...new Set(kc.map(a => a.asym))].sort(); if (stCh.length < 4) throw new Error(id + ' 不足 4 条链');
        const sb = Object.fromEntries(stCh.map(c => [c, new Map(kc.filter(a => a.asym === c).map(a => [key(a), a.p]))]));
        let best = null;
        for (const P of perms(stCh.slice(0, 4))) { const X = [], Y = [];
          sceneCh.forEach((c, i) => { for (const a of byCh[c]) { const k = key(a); if (k >= 60 && k <= 80) { const b = sb[P[i]].get(k); if (b) { X.push(a.p); Y.push(b); } } } });
          if (X.length < 20) continue; const f = superpose(X, Y), r = Math.sqrt(X.reduce((s, p, j) => s + f(Y[j]).distanceToSquared(p), 0) / X.length); if (!best || r < best.r) best = { f, r, P }; }
        const map = {}; sceneCh.forEach((c, i) => { map[c] = new Map([...sb[best.P[i]]].map(([k, p]) => [k, best.f(p)])); });
        console.log(`KcsA ${id}：孔区（60–80，四条链）RMSD ${best.r.toFixed(2)} Å`);
        return { map, ligs: e.ligands.map(L => ({ comp: L.comp, atoms: L.atoms.map(x => ({ ...x, p: best.f(x.p) })) })) };
      };
      const [op, inn, tba, ba] = await Promise.all(['5VK6', '5VKE', '2HVK', '2ITD'].map(id => fitState(id).catch(e => { console.warn(id, e); return null; })));
      if (!op) throw new Error('开放态 5VK6 下载失败');
      for (const a of A) { const k = key(a), o = op.map[a.asym]?.get(k), i = inn?.map[a.asym]?.get(k);
        a.alts = { closed: a.p.clone(), open: (o || a.p).clone(), inact: (i || o || a.p).clone() }; }
      ctx.setConformations(g, ['closed', 'open', 'inact']); this.chains = sceneCh;
      this.conf = { from: 'closed', to: 'closed', w: 0 };
      /* pore path through the OPEN structure: cavity -> intracellular bulk, cavity -> extracellular bulk */
      const openPts = A.map(a => a.alts.open), cav = S.cav;
      const t0 = performance.now();
      const dn = findChannel(openPts, cav, { h: 1.5, radius: 40, minClear: 2.5, openClear: 12, minLen: 22, allowed: (p) => p.y < cav.y + 1 });
      const up = findChannel(openPts, S.S0, { h: 1.5, radius: 40, minClear: 2.0, openClear: 12, minLen: 12, allowed: (p) => p.y > S.S0.y - 1 });
      console.log(`KcsA 孔道路径：胞内段 ${dn ? pathLength(dn).toFixed(0) : '—'} Å，胞外段 ${up ? pathLength(up).toFixed(0) : '—'} Å（${(performance.now() - t0).toFixed(0)} ms）`);
      const inSide = dn ? dn.map(x => x.p).reverse() : [ax(cav.y - 30), cav.clone()], outSide = up ? up.map(x => x.p) : [S.S0.clone(), ax(S.S0.y + 25)];
      const path = [...inSide.slice(0, -1), cav.clone(), S.S4.clone(), S.S3.clone(), S.S2.clone(), S.S1.clone(), ...outSide];
      const st = {}; let acc = 0; const mark = { [inSide.length - 1]: 'cav', [inSide.length]: 'S4', [inSide.length + 1]: 'S3', [inSide.length + 2]: 'S2', [inSide.length + 3]: 'S1', [inSide.length + 4]: 'S0' };
      path.forEach((p, i) => { if (i) acc += p.distanceTo(path[i - 1]); if (mark[i]) st[mark[i]] = acc; });
      st.in = -12; st.out = acc + 12; st.inFar = -80; st.outFar = acc + 80;   // beyond the pore mouths each ion follows its own Brownian path into / out of the bulk
      this.path = path; this.st = st;
      /* blockers at their crystal positions */
      const near = (L) => L.atoms.reduce((s, x) => s.add(x.p), V()).multiplyScalar(1 / L.atoms.length);
      const pick = (r, comp) => r?.ligs.filter(L => L.comp === comp).sort((a, b) => offAx(near(a)) - offAx(near(b)))[0];
      const Ltba = pick(tba, 'TBA'), Lba = ba?.ligs.filter(L => L.comp === 'BA' && offAx(near(L)) < 2.5).sort((x, y) => near(x).y - near(y).y)[0] || pick(ba, 'BA');   /* several Ba2+ on the axis in 2ITD: the innermost one (entered from the cytoplasm) */
      let tTBA = null; try { tTBA = await ctx.template('TBA'); } catch (e) { console.warn(e); }
      this.tbaMol = null; if (Ltba && tTBA) { const pose = fitPose(tTBA, Ltba.atoms); if (pose) { this.tbaMol = ctx.makeMol(tTBA, true, '#ff8c00'); this.tbaMol.quaternion.copy(pose.q); this.tbaMol.position.copy(pose.t); } }
      this.baPos = Lba ? near(Lba) : S.S4.clone();
      this.baIon = ctx.makeParticle(0x2fd46a, 2.3, null, 'Ba²⁺（阻断剂，卡在过滤器里）'); this.baIon.visible = false; this.baIon.position.copy(this.baPos);   /* its tag is this.tags.ba */
      /* which filter site the crystal Ba2+ occupies (nearest site), and its arc length on the pore path (the filter is straight along y) */
      this.baSite = ['S0', 'S1', 'S2', 'S3', 'S4'].sort((a, b) => Math.abs(S[a].y - this.baPos.y) - Math.abs(S[b].y - this.baPos.y))[0];
      st.ba = st.S4 + (this.baPos.y - S.S4.y); this.baIo = { s: st.inFar }; this.tbaD = { d: -34 }; this.tbaT0 = this.tbaMol ? this.tbaMol.position.clone() : null;
      console.log('KcsA Ba²⁺ 晶体位置最近', this.baSite, '；TBA 在中央腔 y =', this.tbaT0?.y.toFixed(1));
      this.tags = { ba: makeTag('Ba²⁺', { obj: this.baIon, cls: 'small warn' }), tba: makeTag('TBA（四丁铵）', this.tbaMol ? { obj: this.tbaMol, cls: 'small warn' } : { p: cav, cls: 'small warn' }),
        gate: makeTag('', { p: ax(cav.y - 22), cls: 'hl' }), filt: makeTag('选择性过滤器 TVGYG', { p: ax(S.S2.y).add(new THREE.Vector3(14, 0, 0)), cls: 'small' }),
        cav: makeTag('中央腔', { p: ax(cav.y).add(new THREE.Vector3(12, 0, 0)), cls: 'small' }) };
      ctx.markHot([S.S1, S.S2, S.S3, S.S4], 6);
      /* ions, filter waters, hydration shells */
      this.ions = []; this.waters = ['S1', 'S2', 'S3', 'S4'].map(() => { const w = ctx.makeParticle(0xdfe8f5, 1.0, 'H₂O'); w.visible = false; return w; });
      this.tw = []; this.paused = false; this.reset();
      ctx.counters['K⁺ 外流'] = 0; ctx.counters['K⁺ 内流'] = 0;
    },
    reset() {
      for (const io of this.ions || []) this.killIon(io);
      this.ions = []; this.tw = [];
      this.s = { gate: 'C', perm: 'A', tba: false, ba: false, out: 0, inn: 0, na: 0, tg: 0, tOpen: 0, poHist: [], ns: 0, log: [] };
      for (const k of ['S1', 'S3']) this.mkIon(k);
      this.pnext = null; this.pwaited = 0; this.gnext = null; this.gwaited = 0; this.stg = 0; this.cKey = '';
      if (this.conf) { this.conf.from = 'closed'; this.conf.to = 'closed'; this.conf.w = 0; } if (this.baIo) { this.baIo.s = this.st.inFar; this.tbaD.d = -34; }
    },
    mkIon(site, na) {
      const p = this.ctx.makeParticle(na ? 0x4fc3f7 : 0xb98cff, na ? 1.7 : 2.0, na ? 'Na⁺' : 'K⁺');
      const shell = Array.from({ length: 6 }, () => { const w = this.ctx.makeParticle(0xdfe8f5, 0.85, null, `H₂O（${na ? 'Na⁺' : 'K⁺'} 的水合层，进过滤器前脱去）`); return w; });
      const io = { p, shell, s: this.st[site], site, na, hyd: /in|out|cav/.test(site) ? 1 : 0, ph: rand() * 6 }; this.ions.push(io); this.ends(io, site); return io;
    },
    /* each ion's own Brownian path between a pore mouth and the bulk on either side; an ion entering from the bulk IS one of the
       free ions there (taken from the compartment's pool), an ion leaving becomes one again (given to the pool) */
    ends(io, site) {
      const st = this.st, a = alongPath(this.path, st.in, V3n()), b = alongPath(this.path, st.out, V3n()), sp = io.na ? 'Na⁺' : 'K⁺';
      let fin = a.clone().add(V3n(gauss() * 22, -45 - rand() * 20, gauss() * 22)), fout = b.clone().add(V3n(gauss() * 22, 45 + rand() * 20, gauss() * 22));
      const take = (key, near) => { const pool = scenePools.get(key); if (!pool || !pool.items.length) return null; const o = pool.take(near), q = o.position.clone(); o.parent?.remove(o); return q; };
      if (site === 'inFar') { const q = take(sp + '@bot', fin); if (q) { fin = q; io.fromPool = true; } }
      if (site === 'outFar') { const q = take(sp + '@top', fout); if (q) { fout = q; io.fromPool = true; } }
      io.pre = new THREE.CatmullRomCurve3(brownPath(fin, a, { free1: 5, clear: 5, keep: (p) => { p.y = Math.min(p.y, a.y + 2); } }), false, 'centripetal');
      io.post = new THREE.CatmullRomCurve3(brownPath(b, fout, { free0: 5, free1: 0, clear: 5, keep: (p) => { p.y = Math.max(p.y, b.y - 2); } }), false, 'centripetal');
    },
    posOf(io, out) {
      const st = this.st, cl = THREE.MathUtils.clamp;
      if (io.s < st.in && io.pre) { const u = cl((io.s - st.inFar) / (st.in - st.inFar), 0, 1); io.edge = u; return io.pre.getPoint(u, out); }
      if (io.s > st.out && io.post) { const u = cl((io.s - st.out) / (st.outFar - st.out), 0, 1); io.edge = 1 - u; return io.post.getPoint(u, out); }
      io.edge = 1; return alongPath(this.path, io.s, out);
    },
    killIon(io) { for (const o of [io.p, ...io.shell]) { o.parent?.remove(o); o.material.dispose(); } this.ions = this.ions.filter(x => x !== io); },
    /* an ion that has left into the bulk joins the free ions there */
    retire(io) {
      const pool = scenePools.get((io.na ? 'Na⁺' : 'K⁺') + '@' + (io.s > this.st.S1 ? 'top' : 'bot'));
      if (!pool) return this.killIon(io);
      for (const o of io.shell) { o.parent?.remove(o); o.material.dispose(); }
      this.ions = this.ions.filter(x => x !== io); io.p.userData.tag?.set(io.na ? 'Na⁺' : 'K⁺'); io.p.scale.setScalar(pool.r || 2); pool.give(io.p);
    },
    ionAt(site) { return this.ions.find(io => io.site === site && !io.leaving); },
    tween(o, k, to, dur, done, block = true) { const d = dur * this.dsc(); if (d < 1e-3) { o[k] = to; done?.(); return; } this.tw.push({ o, k, a: o[k], b: to, t: 0, dur: d, done, block }); },
    dsc() { return Math.min(1, 10 / Math.max(0.1, this.ionSpeed || 10)); },
    busy() { return this.tw.some(x => x.block); },
    move(io, site, dur = 0.45, done) { io.site = site; const hyd = /^(in|out|cav|inFar|outFar)$/.test(site) ? 1 : site === 'S0' ? 0.4 : 0; this.tween(io, 's', this.st[site], dur, done); this.tween(io, 'hyd', hyd, dur, null, false); },
    conc() { const c = this.ctx.cell?.ctrl || {}; return { V: c.V ?? 50, Ki: c.Ki ?? 140, Ko: c.Ko ?? 5, Nai: c.Nai ?? 10, Nao: c.Nao ?? 140, pH: c.pH ?? 4.0, wt: !!c.wt, TBA: c.TBA || 0, Ba: c.Ba || 0 }; },
    /* permeation rates (s^-1) of the knock-on cycle; u = FV/RT at 25 C; concentrations in M */
    permRates(c) {
      const u = c.V / 25.69, Ki = c.Ki / 1000, Ko = c.Ko / 1000, d = [0.15, 0.35, 0.15, 0.35], E = (x) => Math.exp(x * u / 2);
      const k1 = 9e8, km1 = 1.5e8, k2 = 1.5e9, km2 = 3e8, k3 = 4.5e8, k4 = 9e8, km4 = 6e8, km3 = k1 * k2 * k3 * k4 / (km1 * km2 * km4);
      return { f: [k1 * Ki * E(d[0]), k2 * E(d[1]), k3 * E(d[2]), k4 * E(d[3])], b: [km1 / E(d[0]), km2 / E(d[1]), km3 * Ko / E(d[2]), km4 / E(d[3])] };
    },
    current(c) {   // exact steady-state single-channel current (pA) of the cycle, by Gaussian elimination
      const { f, b } = this.permRates(c), n = 4, M = Array.from({ length: n }, () => new Array(n + 1).fill(0));
      for (let i = 0; i < n; i++) { const j = (i + 1) % n; M[j][i] += f[i]; M[i][i] -= f[i]; M[i][j] += b[i]; M[j][j] -= b[i]; }
      M[3] = [1, 1, 1, 1, 1];
      for (let col = 0; col < n; col++) { let pv = col; for (let r = col; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[pv][col])) pv = r; [M[col], M[pv]] = [M[pv], M[col]];
        for (let r = 0; r < n; r++) if (r !== col) { const fac = M[r][col] / M[col][col]; for (let k = col; k <= n; k++) M[r][k] -= fac * M[col][k]; } }
      const p = M.map((r, i) => r[n] / r[i]); return (p[0] * f[0] - p[1] * b[0]) * 1.602e-19 * 1e12;
    },
    conducting() { return this.s.gate === 'O' && !this.s.tba && !this.s.ba; },
    /* ---------------------------------------------------------------- gating + block (real-time clock) */
    gateRates(c) {
      const s = this.s, h = 1 / (1 + Math.pow(10, 2 * (c.pH - 4.2))), u = c.V / 25.69, R = [], add = (r, id) => { if (r > 0) R.push([r, id]); };
      if (s.gate === 'C') add(50 * h, 'open');
      if (s.gate === 'O') { add(50 * (1 - h) + 2, 'close'); if (c.wt) add(1.2, 'inact'); }
      if (s.gate === 'I') { add(0.3 * (1 - h) + 0.03, 'recover'); add(0.05, 'reopen'); }
      const cavFree = ['A', 'D'].includes(s.perm);
      if (s.gate === 'O' && !s.tba && !s.ba && cavFree && c.TBA > 0) add(1.0 * c.TBA * Math.exp(0.3 * u / 2), 'tba+');
      if (s.tba && s.gate === 'O') add(3 * Math.exp(-0.3 * u / 2), 'tba-');   // trapped while the gate is shut
      if (s.gate === 'O' && !s.tba && !s.ba && s.perm === 'A' && c.Ba > 0) add(0.02 * c.Ba * Math.exp(0.6 * u), 'ba+');
      if (s.ba) add(0.3 * Math.exp(-0.6 * u), 'ba-');
      return R;
    },
    gateFire(id) {
      const s = this.s; const log = (t, w) => { s.log.push([t, w]); if (s.log.length > 8) s.log.shift(); };
      const conf = (to, dur = 0.8) => { const C = this.conf; C.from = C.w >= 0.5 ? C.to : C.from; C.to = to; C.w = 0; this.rt(C, 'w', 1, dur); };   // morph runs in real time; replaces a morph still running
      switch (id) {
        case 'open': s.gate = 'O'; this.stg = 0; conf('open'); log('胞内 pH 低：门打开（TM2 外张）'); break;
        case 'close': s.gate = 'C'; this.stg = 0; conf('closed'); log('门关闭'); break;
        case 'inact': s.gate = 'I'; this.stg = 5; conf('inact'); log('C 型失活：过滤器塌陷，S2、S3 失去离子', true);
          for (const io of [...this.ions]) if (!io.leaving && io.site !== 'S1' && io.site !== 'S4') { io.leaving = true; this.move(io, /S0|S1|S2/.test(io.site) ? 'outFar' : 'inFar', 1.6, () => this.retire(io)); }
          if (!this.ionAt('S1')) this.move(this.mkIon('outFar'), 'S1', 0.8); if (!this.ionAt('S4')) this.move(this.mkIon('inFar'), 'S4', 0.8);   // inactivated filter: ions only at S1 and S4 (5VKE / 1K4D)
          s.perm = 'X'; break;
        case 'recover': s.gate = 'C'; this.stg = 5; conf('closed'); log('从失活恢复（门关，过滤器重新导电）'); this.refill(); break;
        case 'reopen': s.gate = 'O'; conf('open'); log('过滤器恢复导电'); this.refill(); break;
        case 'tba+': s.tba = true; this.tbaD.d = -34; this.rt(this.tbaD, 'd', 0, 0.9); log('TBA 从胞内穿过打开的门进入中央腔，卡在过滤器下方，堵住离子通路', true); break;
        case 'tba-': s.tba = false; this.rt(this.tbaD, 'd', -34, 0.9); log('TBA 离开中央腔，回到胞质'); break;
        case 'ba+': s.ba = true; this.baIo.s = this.st.inFar; this.rt(this.baIo, 's', this.st.ba, 1.0); log(`Ba²⁺ 从胞内进入过滤器（晶体中在 ${this.baSite} 位点）：电荷 2+，结合很紧，堵住通道`, true); break;
        case 'ba-': s.ba = false; this.rt(this.baIo, 's', this.st.inFar, 1.0); log('Ba²⁺ 离开过滤器，回到胞内'); break;
      }
    },
    rt(o, k, to, dur) { this.tw = this.tw.filter(x => !(x.o === o && x.k === k)); this.tw.push({ o, k, a: o[k], b: to, t: 0, dur, block: false }); },   // real-time tween (gating clock)
    refill() { if (this.s.perm !== 'X') return; for (const io of [...this.ions]) if (!io.leaving) this.killIon(io); this.mkIon('S1'); this.mkIon('S3'); this.s.perm = 'A'; },
    /* ---------------------------------------------------------------- permeation (ns clock, slowed) */
    permFire(id, c) {
      const s = this.s, at = (k) => this.ionAt(k);
      switch (id) {
        case 'AB': { const io = this.mkIon('inFar'); this.move(io, 'cav', 1.8); s.perm = 'B'; this.stg = 1; break; }
        case 'BA': { const io = at('cav'); if (io) { io.leaving = true; this.move(io, 'inFar', 1.6, () => this.retire(io)); } s.perm = 'A'; break; }
        case 'BC': { const a = at('S1'), b = at('S3'), d = at('cav'); if (a) this.move(a, 'S0'); if (b) this.move(b, 'S2'); if (d) this.move(d, 'S4'); s.perm = 'C'; this.stg = 3; break; }
        case 'CB': { const a = at('S0'), b = at('S2'), d = at('S4'); if (a) this.move(a, 'S1'); if (b) this.move(b, 'S3'); if (d) this.move(d, 'cav'); s.perm = 'B'; break; }
        case 'CD': { const io = at('S0'); if (io) { io.leaving = true; this.move(io, 'outFar', 1.8, () => this.retire(io)); } s.perm = 'D'; s.out++; this.ctx.counters['K⁺ 外流']++; this.stg = 4; break; }
        case 'DC': { const io = this.mkIon('outFar'); this.move(io, 'S0', 1.8); s.perm = 'C'; s.inn++; this.ctx.counters['K⁺ 内流']++; this.stg = 4; break; }
        case 'DA': { const a = at('S2'), b = at('S4'); if (a) this.move(a, 'S1'); if (b) this.move(b, 'S3'); s.perm = 'A'; this.stg = 2; break; }
        case 'AD': { const a = at('S1'), b = at('S3'); if (a) this.move(a, 'S2'); if (b) this.move(b, 'S4'); s.perm = 'D'; this.stg = 2; break; }
        case 'na': { const io = this.mkIon('inFar', true); s.na++; this.move(io, 'cav', 1.6, () => { this.tween(io, 's', this.st.cav + 3, 0.25, () => { io.leaving = true;
          eventTag('Na⁺ 太小：不能同时贴近过滤器的 8 个羰基氧 → 被排斥', alongPath(this.path, this.st.S4, V3n()).add(V3n(10, 0, 0)), 2.4); this.move(io, 'inFar', 1.6, () => this.retire(io)); }); }); break; }
      }
    },
    permRatesNow(c) {
      const s = this.s, { f, b } = this.permRates(c), R = [];
      const map = { A: [[f[0], 'AB'], [b[3], 'AD']], B: [[b[0], 'BA'], [f[1], 'BC']], C: [[b[1], 'CB'], [f[2], 'CD']], D: [[b[2], 'DC'], [f[3], 'DA']] }[s.perm] || [];
      for (const r of map) R.push(r);
      if (['A', 'D'].includes(s.perm)) R.push([f[0] * (c.Nai / Math.max(1, c.Ki)) * 0.5, 'na']);   // Na+ reaches the cavity but is rejected at S4
      return R;
    },
    gillespie(budget, rates, fire, slot) {   // shared loop: slot = 'p' (permeation) or 'g' (gating); returns the molecular time used
      const nk = slot + 'next', wk = slot + 'waited', b0 = budget;
      for (let it = 0; it < 500; it++) {
        if (!this[nk]) { const R = rates(), tot = R.reduce((a, r) => a + r[0], 0); if (!tot) return 0;
          let u = rand() * tot, pk = R[R.length - 1]; for (const r of R) { u -= r[0]; if (u <= 0) { pk = r; break; } }
          this[nk] = { tau: -Math.log(1 - rand()) / tot, id: pk[1] }; this[wk] = 0; }
        const need = this[nk].tau - this[wk];
        if (need > budget) { this[wk] += budget; return b0; }
        budget -= need; const id = this[nk].id; this[nk] = null; fire(id);
        if (slot === 'p' && this.busy()) return b0 - budget;   // the event animation blocks the clock; unused time is not counted
      }
      return b0 - budget;
    },
    update(ctx, dt) {
      if (!this.s) return;
      const c = this.conc(), s = this.s, key = JSON.stringify(c);
      if (key !== this.cKey) { this.cKey = key; this.pnext = null; this.gnext = null; }
      this.ionSpeed = +(ctx.cell?.ctrl?.ionSpeed ?? 10); const gs = +(ctx.cell?.ctrl?.gateSpeed ?? 0.05);
      for (let i = this.tw.length - 1; i >= 0; i--) { const x = this.tw[i]; x.t += dt; const u = Math.min(1, x.t / x.dur); x.o[x.k] = x.a + (x.b - x.a) * ease(u); if (u >= 1) { this.tw.splice(i, 1); x.done?.(); } }
      if (!this.paused) {
        s.tg += dt * gs; this.gillespie(dt * gs, () => this.gateRates(c), (id) => this.gateFire(id), 'g');
        if (this.conducting()) { s.tOpen += dt * gs; if (!this.busy()) s.ns += 1e9 * this.gillespie(dt * this.ionSpeed * 1e-9, () => this.permRatesNow(c), (id) => this.permFire(id, c), 'p'); }
        s.poHist.push([s.tg, this.conducting() ? 1 : 0]); while (s.poHist.length && s.poHist[0][0] < s.tg - 0.5) s.poHist.shift();
      }
      /* conformation of all four chains */
      const C = this.conf; for (const ch of this.chains) ctx.setChainBlend(this.g, ch, C.from, C.to, C.w);
      /* ions along the real pore path; hydration shell fades inside the filter */
      const _p = new THREE.Vector3();
      for (const io of this.ions) {
        this.posOf(io, _p); io.p.position.copy(_p); io.ph += dt * 3;
        const al = io.fromPool ? 1 : Math.min(1, io.edge / 0.2); setAlpha(io.p, al);
        io.p.userData.tag?.set((io.na ? 'Na⁺' : 'K⁺') + (io.hyd > 0.6 ? '（水合）' : io.hyd < 0.2 ? '（脱水，羰基氧配位）' : ''));
        io.shell.forEach((w, k) => { const th = io.ph + k * Math.PI / 3, r = 3.4; w.visible = io.hyd > 0.05 && al > 0.1; w.scale.setScalar(0.85 * io.hyd + 0.001);
          w.position.set(_p.x + r * Math.cos(th) * io.hyd, _p.y + 2.2 * Math.sin(th * 1.7 + k), _p.z + r * Math.sin(th) * io.hyd); });
      }
      /* waters in the empty filter sites (ions and water alternate) */
      ['S1', 'S2', 'S3', 'S4'].forEach((k, i) => { const w = this.waters[i], occ = this.ions.some(io => !io.leaving && Math.abs(io.s - this.st[k]) < 1.2);
        w.visible = s.perm !== 'X' && !occ && !(s.ba && k === this.baSite); if (w.visible) alongPath(this.path, this.st[k], w.position); });
      if (this.tbaMol) { this.tbaMol.visible = s.tba || this.tbaD.d > -33; this.tbaMol.position.copy(this.tbaT0).y += this.tbaD.d; }
      this.baIon.visible = s.ba || this.baIo.s > this.st.inFar + 1; if (this.baIon.visible) alongPath(this.path, this.baIo.s, this.baIon.position);
      this.tags.tba.on = !!this.tbaMol?.visible; this.tags.ba.on = this.baIon.visible;
      this.tags.gate.set(s.gate === 'O' ? (s.tba ? '门开 · 被 TBA 堵住' : s.ba ? '门开 · 被 Ba²⁺ 堵住' : '门开 · 导电') : s.gate === 'I' ? '门开 · 失活（过滤器塌陷）' : '门关');
    },
    explain() {
      const s = this.s, c = this.conc(), EK = 25.69 * Math.log(c.Ko / c.Ki), I = this.current(c), po = s.poHist.length ? s.poHist.reduce((a, x) => a + x[1], 0) / s.poHist.length : 0;
      const L = [];
      L.push(`【门】${s.gate === 'O' ? '开' : s.gate === 'I' ? '开但失活' : '关'}${s.tba ? '，TBA 在中央腔' : ''}${s.ba ? '，Ba²⁺ 在 ' + this.baSite : ''}；胞内 pH ${c.pH.toFixed(1)}（KcsA 半开放约 pH 4.2）${c.wt ? '，野生型（会失活）' : '，E71A（不失活）'}`);
      L.push(`【过滤器】${{ A: 'S1、S3 有 K⁺（S2、S4 是水）', B: 'S1、S3 + 中央腔 1 个水合 K⁺', C: 'S0、S2、S4 有 K⁺', D: 'S2、S4 有 K⁺（S1、S3 是水）', X: '塌陷：只剩 S1、S4' }[s.perm]}`);
      L.push(`【电化学】E_K = 25.7 × ln(${c.Ko}/${c.Ki}) = ${EK.toFixed(0)} mV；膜电位 ${c.V} mV → 驱动力 ${(c.V - EK).toFixed(0)} mV → 单通道电流 ${I.toFixed(2)} pA（${I > 0 ? '外流' : I < 0 ? '内流' : '无净流'}，约 ${Math.abs(I / 1.602e-7).toExponential(1)} 个 K⁺/s）`);
      L.push(`【开放概率】最近 500 ms（门控时间）导电时间 ${(100 * po).toFixed(0)}%`);
      L.push(`【动画计数】K⁺ 外流 ${s.out}、内流 ${s.inn}、Na⁺ 被排斥 ${s.na}；离子动画已播放 ${s.ns.toFixed(0)} ns（真实通过的离子远多于画出的：开放 ${(s.tOpen * 1000).toFixed(0)} ms 实际约 ${(Math.abs(I) / 1.602e-7 * s.tOpen).toExponential(1)} 个）`);
      if (c.TBA > 0) L.push('· TBA（四丁铵）：从胞内经打开的门进入中央腔，正好卡在过滤器下方（2HVK）。门关上时被“困”在腔里出不去。去极化（胞内更正）把它推得更深，阻断更强。');
      if (c.Ba > 0) L.push(`· Ba²⁺：和 K⁺ 几乎一样大（1.35 vs 1.38 Å），能进过滤器，但带 2 个正电荷，在过滤器里结合极紧（2ITD 中位于 ${this.baSite}），停留时间以秒计，期间完全不导电。`);
      L.push('【事件】' + s.log.slice().reverse().map(([t, w]) => `\n${w ? '⚠ ' : ''}${t}`).join(''));
      return L.join('\n');
    },
    cell: {
      title: 'KcsA 钾通道 · 实时模拟', wide: true, noWarmup: true,
      init() { return {}; }, step() { return { rate: 1, rotor: 0 }; },
      timeLabel() { const s = proc?.s; return s ? `门控时间 ${(s.tg * 1000).toFixed(0)} ms · 离子时间 ${s.ns.toFixed(0)} ns` : ''; },
      comps: () => { const c = cellSim?.ctrl || {}; return [{ name: '胞外', pH: 7.4 }, { name: '胞内', pH: c.pH ?? 4 }]; },
      dots: [
        { comp: 'top', color: '#b98cff', ink: '#8a5cf0', label: 'K⁺', r: 1.9, max: 60, count: () => Math.min(60, (cellSim?.ctrl?.Ko ?? 5) * 0.4) },
        { comp: 'bot', color: '#b98cff', ink: '#8a5cf0', label: 'K⁺', r: 1.9, max: 60, count: () => Math.min(60, (cellSim?.ctrl?.Ki ?? 140) * 0.4) },
        { comp: 'top', color: '#4fc3f7', ink: '#1e88c8', label: 'Na⁺', r: 1.6, max: 60, count: () => Math.min(60, (cellSim?.ctrl?.Nao ?? 140) * 0.4) },
        { comp: 'bot', color: '#4fc3f7', ink: '#1e88c8', label: 'Na⁺', r: 1.6, max: 60, count: () => Math.min(60, (cellSim?.ctrl?.Nai ?? 10) * 0.4) },
      ],
      controls: [
        { type: 'section', label: '膜两侧' },
        { type: 'range', id: 'V', label: '膜电位（胞内 − 胞外）', min: -150, max: 150, step: 5, value: 50, unit: 'mV' },
        { type: 'range', id: 'Ki', label: '胞内 K⁺', min: 5, max: 300, step: 5, value: 140, unit: 'mM' },
        { type: 'range', id: 'Ko', label: '胞外 K⁺', min: 1, max: 300, step: 1, value: 5, unit: 'mM' },
        { type: 'range', id: 'Nai', label: '胞内 Na⁺', min: 0, max: 150, step: 5, value: 10, unit: 'mM' },
        { type: 'range', id: 'Nao', label: '胞外 Na⁺', min: 0, max: 150, step: 5, value: 140, unit: 'mM' },
        { type: 'range', id: 'pH', label: '胞内 pH（门控）', min: 3.5, max: 8, step: 0.1, value: 4.0 },
        { type: 'section', label: '通道与阻断剂（胞内侧）' },
        { id: 'wt', label: '野生型（会 C 型失活）', on: false, tip: '关：E71A 突变体（5VK6），几乎不失活' },
        { type: 'range', id: 'TBA', label: 'TBA 四丁铵', min: 0, max: 20, step: 0.1, value: 0, unit: 'μM' },
        { type: 'range', id: 'Ba', label: 'Ba²⁺', min: 0, max: 200, step: 1, value: 0, unit: 'μM' },
        { type: 'section', label: '时间' },
        { type: 'select', id: 'ionSpeed', value: '10', options: [['2', '离子：1 秒 = 2 ns'], ['10', '离子：1 秒 = 10 ns'], ['50', '离子：1 秒 = 50 ns']] },
        { type: 'select', id: 'gateSpeed', value: '0.05', tip: '真实的 KcsA 开关和阻断剂结合在毫秒级，实时看只是闪烁，所以默认慢放 20 倍', options: [['0.05', '门控：慢放 ×1/20'], ['0.01', '门控：慢放 ×1/100'], ['1', '门控：实时（闪烁）']] },
        { type: 'button', label: '⏸ 暂停', run: (sim, b) => { if (!proc) return; proc.paused = !proc.paused; b.textContent = proc.paused ? '▶ 继续' : '⏸ 暂停'; } },
        { type: 'button', label: '↺ 重置', run: () => proc?.reset?.() },
      ],
      series: [
        { label: '单通道电流', get: () => proc?.conducting?.() ? proc.current(proc.conc()) : 0, fmt: (v) => v.toFixed(2) + ' pA', range: [-12, 12], color: '#8a5cf0' },
        { label: '开放（导电）', get: () => proc?.conducting?.() ? 1 : 0, fmt: (v) => v ? '导电' : '不导电', range: [0, 1], color: '#2fb39c' },
        { label: 'E_K', get: () => { const c = proc?.conc?.(); return c ? 25.69 * Math.log(c.Ko / c.Ki) : 0; }, fmt: (v) => v.toFixed(0) + ' mV', range: [-150, 50], color: '#e4572e' },
      ],
      explain: () => proc?.explain?.() || '',
    },
  },

