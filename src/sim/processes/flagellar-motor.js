  flagellarMotor: {
    lead: '鞭毛马达：H⁺ 流过定子，驱动转子旋转（H⁺ 数和转速为示意）。',
    energyHL: [['定子'], ['定子'], ['定子'], ['定子', 'C 环'], ['C 环', 'M-ring', 'MS ring', 'rod', 'hook protein', '鞭毛丝']],
    energy: [
      ['质子动力势', '细菌质膜内外的 H⁺ 电化学梯度（Δp 约 −150 mV 量级）。鞭毛马达直接用这个梯度，不用 ATP。'],
      ['H⁺ 经定子', 'H⁺ 从周质经 MotA/MotB 定子的通道流入胞质，途中结合并离开 MotB 跨膜段上一个保守的天冬氨酸。'],
      ['定子转动', '2020 年的 MotA₅B₂ 结构提出：H⁺ 的结合 / 释放驱动 MotA 五聚体绕中心的 MotB 二聚体转动，像一个小齿轮。'],
      ['推动 C 环（FliG）', 'MotA 胞质部分与 C 环上 FliG 的 C 端结构域接触，把定子的转动变成作用在转子上的扭矩。'],
      ['转子与鞭毛丝转动', '转子、杆、钩和鞭毛丝一起转动，每秒约上百转，推动细菌游动；CheY-P 结合 C 环可让转向在逆时针 / 顺时针间切换。'] ],
    stage(ctx) { return 1 + Math.floor((ctx.theta / (2 * Math.PI) * 4) % 4); },
    caption: 'H⁺ 从周质经定子 MotA/MotB（绿）流入胞质 → 定子推动 C 环（粉）→ 转子（杆、钩、鞭毛丝）旋转（H⁺ 计数仅示意：实测每转约 1000 个以上 H⁺，Meister, Lowe & Berg 1987）',
    async setup(ctx) {
      const st = ctx.atomsOf(/定子/);
      this.ys = st.length ? st.reduce((s, x) => s + x.p.y, 0) / st.length : (ctx.membraneY[0] || 0);
      this.n = 11; this.R = 215; this.lastK = Math.floor(ctx.theta / (2 * Math.PI / 44));
      ctx.counters['H⁺（示意）'] = 0;
      ctx.markHot(Array.from({ length: this.n }, (_, k) => polar(this.R, 2 * Math.PI * k / this.n, this.ys)));
    },
    update(ctx) {
      const k = Math.floor(ctx.theta / (2 * Math.PI / 44)), ys = this.ys, R = this.R;
      const top = spPool('H⁺', 'peri', shellRegion(V3n(0, ys + 60, 0), 0, R + 90, (p) => p.y > ys + 30 && Math.hypot(p.x, p.z) > R - 60), 24);
      const bot = spPool('H⁺', 'cyto', shellRegion(V3n(0, ys - 60, 0), 0, R + 90, (p) => p.y < ys - 30 && Math.hypot(p.x, p.z) > R - 60), 8);
      for (; this.lastK < k; this.lastK++) {
        const phi = 2 * Math.PI * Math.floor(rand() * this.n) / this.n + (rand() - 0.5) * 0.06; ctx.counters['H⁺（示意）']++;
        const P1 = polar(R, phi, ys + 22), P2 = polar(R, phi, ys - 22);
        protonAcross(top, bot, [P1, P1.clone().lerp(P2, 0.5), P2], { pace: ctx.pace, label: 'H⁺（经定子 MotA/MotB）', tIn: 1.6, tChan: 0.9,
          keepIn: (p) => { p.y = Math.max(p.y, ys + 30); }, keepOut: (p) => { p.y = Math.min(p.y, ys - 30); } }).catch(() => {});
      }
    },
  },

