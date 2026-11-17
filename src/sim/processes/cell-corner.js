  /* ============================================================================= a corner of a bacterial cell: the translation
     station (70S ribosome in the cytoplasm) and the KcsA station (in the plasma membrane above it) simulated at the same time.
     Each station keeps its own engine and clocks; they share the cell (one control panel, one intracellular compartment,
     the same counters). The channel is moved into the plane of the ribosome's cross-section (E -> A axis = screen right)
     so one cut shows both. Sub-station cell callbacks refer to the global `proc`; `wrapSub` points it at the sub-station
     while they run. */
  cellCorner: {
    lead: '细菌细胞一角：核糖体用嗜热栖热菌结构、钾通道用链霉菌 KcsA 代表（代用结构）。',
    caption: '细菌细胞的一角：细胞质里的 70S 核糖体正在把 mRNA 翻译成蛋白质，上方细胞膜里的 KcsA 钾通道按胞内 pH 开关、让 K⁺ 通过。两套模拟同时运行，各有自己的时钟（翻译以毫秒–秒计，离子通过以纳秒计）。右上角同时控制两者：EF-Tu / EF-G 浓度、抗生素、mRNA；膜电位、两侧离子浓度、胞内 pH、通道阻断剂。用“镜头”按钮在全景、核糖体和通道之间切换。',
    stage() { const s = this.sub?.[this.view === 'k' ? 1 : 0]; return s?.stage ? s.stage(s.ctx) : 0; },
    get energy() { return this.sub?.[this.view === 'k' ? 1 : 0]?.energy; },
    get energyHL() { if (this.view !== 'k') return this.sub?.[0]?.energyHL || null;
      return this._khl ||= (this.sub?.[1]?.energyHL || []).map(L => L.map(sp => typeof sp === 'string' ? sp : { part: 'KcsA', ...sp })); },
    async setup(ctx) {
      const V = THREE.Vector3, cen = (A) => A.reduce((s, a) => s.add(a.p), new V()).multiplyScalar(1 / Math.max(1, A.length));
      const kg = ctx.partGroups(/KcsA/i)[0]; if (!kg) throw new Error('找不到 KcsA 组件（1K4C）');
      const kset = new Set(kg.atoms), all = model.allAtoms, rib = all.filter(a => !kset.has(a));
      const tl = Object.create(PROCESSES.translation), kc = Object.create(PROCESSES.kcsa); tl.ctx = ctx; kc.ctx = ctx;
      this.sub = [tl, kc]; this.view = 'all';
      /* the ribosome station sees only the ribosome (its tunnel search and size must not include the channel) */
      model.allAtoms = rib; try { await tl.setup(ctx); } finally { model.allAtoms = all; }
      /* membrane 60 A above the top of the ribosome; channel in the cut plane, a little left of the ribosome's centre (clear of the panels on the right) */
      const cR = cen(rib); let top = -1e9; for (const a of rib) top = Math.max(top, a.p.y);
      const az = current?.camera?.az ?? 0, right = new V(Math.cos(az), 0, -Math.sin(az)), ym = top + 60;
      const d = cR.clone().setY(ym).addScaledVector(right, -tl.Rr * 0.3).sub(cen(kg.atoms));
      for (const a of kg.atoms) a.p.add(d);
      for (const L of ctx.ligands) if (L.compLabel === 'KcsA 钾通道') { L.atoms.forEach(x => x.p.add(d)); L.centre.add(d); }
      let rmax = 0, mainR = 0; for (const a of all) { rmax = Math.max(rmax, a.p.length()); mainR = Math.max(mainR, Math.hypot(a.p.x, a.p.z)); }
      const fc = cen(all); let fr = 0; for (const a of all) fr = Math.max(fr, a.p.distanceTo(fc));
      Object.assign(model, { radius: rmax, mainR, focus: { centre: fc, radius: fr } });
      $('mem1').value = ym / rmax; $('mem2On').checked = false; ctx.membraneY = [ym];
      await kc.setup(ctx);
      tl.yMax = ym - 30;   /* cytoplasmic factors and drugs stay below the membrane */
      /* the rest of the cytoplasm: pale copies of abundant E. coli proteins behind the cut plane (macromolecular crowding) */
      status('填充细胞质：下载背景蛋白结构…', true);
      let botC = 1e9; for (const a of rib) botC = Math.min(botC, a.p.y);
      const vdir = new V(Math.sin(az), 0, Math.cos(az)), nBack = vdir.clone().negate(), fcc = cen(all), Hx = tl.Rr + 170;
      this.crowdBox = { min: new V(cR.x - Hx, botC - 70, cR.z - Hx), max: new V(cR.x + Hx, ym - 34, cR.z + Hx) };
      this.crowd = await buildCrowd({ box: this.crowdBox,
        keepSide: { n: nBack, d: nBack.dot(fcc) + 6 }, phi: 0.16, cellVol: 7e11,
        types: [
          { id: '1EFT', label: 'EF-Tu', perCell: 60000, col: '#cdd9e8', fill: 2 },
          { id: '4V6F', label: '70S 核糖体', perCell: 25000, col: '#e6dccb' },
          { id: '6ALH', label: 'RNA 聚合酶', perCell: 3000, col: '#d6e2d0' },
          { id: '1AON', label: 'GroEL/GroES', perCell: 1500, col: '#e2d5e6' },
          { id: '1GD1', label: '甘油醛-3-磷酸脱氢酶', perCell: 0, col: '#dcd6c8', fill: 1 },
          { id: '1PKN', label: '丙酮酸激酶', perCell: 0, col: '#d3dbd8', fill: 1 },
          { id: '1TIM', label: '磷酸丙糖异构酶', perCell: 0, col: '#e0d8d0', fill: 1 },
          { id: '4AKE', label: '腺苷酸激酶', perCell: 0, col: '#d8dce6', fill: 1 } ] }).catch(e => { console.warn('crowd', e); return null; });
      this.tc = 0;
      /* overview framing: from the bottom of the ribosome to just above the membrane (the cut plane stays vertical through the same x, z) */
      let bot = 1e9; for (const a of rib) bot = Math.min(bot, a.p.y);
      const topS = ym + 45; model.focus.centre.y = (bot + topS) / 2; model.focus.radius = Math.max((topS - bot) / 2, tl.Rr * 1.15);
      this.ym = ym; if (current) current.camera = { az, el: 0.1, dist: 1.45 };
      this.kTag = makeTag('KcsA 钾通道（细胞膜）', { p: kc.O.clone().setY(kc.site.S0.y + 26), cls: 'hl' });
      console.log('cellCorner: 膜 y =', ym.toFixed(0), '，核糖体顶 y =', top.toFixed(0), '，通道轴', kc.O.toArray().map(v => v.toFixed(0)).join(','));
    },
    update(ctx, dt) { for (const s of this.sub) s.update(ctx, dt); this.tc += dt; if (this.crowd && (this._f = (this._f || 0) + 1) % 3 === 0) this.crowd.draw(this.tc); },
    look(v) {
      this.view = v; renderEnergy();
      const [tl, kc] = this.sub, M = world.matrixWorld;
      if (v === 'all') { resetCamera(current?.camera); return; }
      const t = (v === 'k' ? kc.O.clone().setY(kc.site.cav.y + 4) : tl.C0.clone()).applyMatrix4(M);
      flyTo(t, fitDist(v === 'k' ? 48 : tl.Rr * 0.8), 900);
    },
    explain() {
      const [tl, kc] = this.sub, c = kc.conc();
      const L = ['━━ 核糖体（细胞质）━━', tl.explain(), '', '━━ KcsA 钾通道（细胞膜）━━', kc.explain()];
      if (this.crowd) L.push('', `━━ 背景 ━━
浅色的是细胞质里的其他大分子（真实结构的粗粒化模型，只画剖面后方）：${this.crowd.summary}。数量按每个大肠杆菌细胞的拷贝数量级（EF-Tu 约 6 万、核糖体约 2.5 万、RNA 聚合酶约 3 千、GroEL 约 1.5 千）换算到这块体积，其余用几种常见代谢酶补到蛋白体积分数约 ${(100 * this.crowd.phi).toFixed(0)}%（真实细胞质的大分子占体积 20–30%，这里略稀以便看清）。`);
      if (c.pH < 6) L.push('', `⚠ 胞内 pH ${c.pH.toFixed(1)}：KcsA 只在这样的酸性条件下打开（实验条件）。真实细胞质约 pH 7.5，这么酸时翻译也会停止；本模型没有包含 pH 对翻译的影响。`);
      else L.push('', `胞内 pH ${c.pH.toFixed(1)}（接近生理）：KcsA 的门几乎总是关着。把胞内 pH 拖到 4 左右可以看到它打开（实验条件）。`);
      return L.join('\n');
    },
    get cell() {
      if (this._cell) return this._cell;
      const wrapSub = (fn, i) => function (...a) { const o = proc, s = o?.sub?.[i]; if (!s) return fn.apply(this, a); proc = s; try { return fn.apply(this, a); } finally { proc = o; } };
      const W = (obj, i) => Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, typeof v === 'function' ? wrapSub(v, i) : v]));
      const T = PROCESSES.translation.cell, K = PROCESSES.kcsa.cell;
      return this._cell = {
        title: '细胞一角 · 核糖体 + 钾通道（同时模拟）', wide: true, noWarmup: true,
        init: () => ({}), step: () => ({ rate: 1, rotor: 0 }),
        timeLabel: () => `翻译 ${wrapSub(T.timeLabel, 0)()} · 通道 ${wrapSub(K.timeLabel, 1)()}`,
        comps: wrapSub(K.comps, 1), dots: K.dots.map(x => W(x, 1)),
        controls: [
          { type: 'section', label: '镜头' },
          { type: 'button', label: '全景', run: () => proc?.look?.('all') },
          { type: 'button', label: '看核糖体', run: () => proc?.look?.('rib') },
          { type: 'button', label: '看钾通道', run: () => proc?.look?.('k') },
          ...(T.controls[0]?.type === 'section' ? [] : [{ type: 'section', label: '核糖体' }]), ...T.controls.map(x => W(x.type === 'section' ? { ...x, label: '核糖体 · ' + x.label } : x, 0)),
          ...K.controls.map(x => W(x.type === 'section' ? { ...x, label: '钾通道 · ' + x.label } : x.id === 'pH' ? { ...x, value: 7.2 } : x, 1)),
        ],
        series: [...T.series.map(x => W(x, 0)), ...K.series.map(x => W(x, 1))],
        explain: () => proc?.explain?.() || '',
      };
    },
  },
};

