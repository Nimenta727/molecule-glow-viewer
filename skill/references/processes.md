# 过程动画（相互作用）API 与模板

过程动画 = 一个 JS 对象，放在 `viewer.html` 的 `const PROCESSES = {...}` 里，预设写 `process: '键名'` 即启用。

```js
PROCESSES.myProcess = {
  caption: '底部说明文字：谁 → 做什么 → 结果（颜色写清楚）',
  async setup(ctx) { /* 找位点、下载模板、建物体、初始化计数器；可以 await */ },
  update(ctx, dt)  { /* 每帧调用；dt 秒；根据 ctx.theta 或累计时间推进状态 */ },
};
```
- `this` 是该过程的一个实例（`Object.create`），可以在 `this` 上存状态。
- setup 完成之后才开始调用 update（异步安全）。setup 抛错时只显示提示，结构照常显示。
- 坐标系：查看器坐标（Å），主轴 = +Y；旋转部件绕 +Y 转 `theta`。一个在极角 φ 的点转后在 `φ − θ`（Three.js 的 Y 旋转方向）。
- 所有 `ctx.make*` 生成的物体都在叠加层：画在蛋白上面，不会被 AO 压黑。

## ctx 工具

| 成员 | 说明 |
|---|---|
| `ctx.theta` / `ctx.speed` | 转子当前角度（rad，累计）/ 转速滑块值 |
| `ctx.allAtoms` | 所有残基点 `{p: Vector3, part: 部件名, asym, seq, ent}` |
| `ctx.atomsOf(/正则/)` | 部件名匹配的残基点 |
| `ctx.ligands` | 结构里的配体 `{comp, fullName, asym, atoms[{p,el}], centre}` |
| `ctx.hideLigand(L)` | 不显示这个静态配体（由动画分子接管） |
| `ctx.template('ATP')` | 下载 CCD 理想构型，**带原子名**（`tpl.atoms[{name,el,p}]`、`tpl.byName.PG`），Promise |
| `ctx.makeMol(tpl)` | 球棍分子 Group，初始隐藏；用 `.visible/.position/.scale` 控制 |
| `ctx.makeParticle(color, r)` | 发光小球（质子、离子） |
| `ctx.makeFlash(color)` | 加法混合闪光球，初始隐藏 |
| `ctx.anim(obj, dur, step(u,dt), next)` | 补间：`u` 0→1；`dur=null` 时 step 返回 true 结束；无 next 则结束后移除 obj |
| `ctx.partGroups(/正则/)` | 部件名匹配的组（`g.atoms`、`g.name`） |
| `ctx.setConformations(g, keys)` | 声明该组残基带 `a.alts[key]` 替代坐标（setup 中、建网格之前调用） |
| `ctx.setChainBlend(g, asym, from, to, w)` | 让链 asym 的形状在两个构象之间插值（每帧调用） |
| `ctx.markHot(points, radius=10)` | 这些点附近的残基脉动发光（只在 setup 里调用有效） |
| `ctx.counters` | `{名称: 数}`，自动显示在说明文字下方 |
| `ctx.membraneY` | 膜的 y 坐标数组 |
| 全局工具 | `polar(r, φ, y)` 柱坐标 → Vector3；`ease(t)` 平滑 0–1（自动夹到 0–1） |

## 实例 1：ATP 合酶 `atpSynthase`（6ZPO）——真实构象循环
机制（结合变构 + 旋转催化）：
1. **质子**：c8 环每转 45° 运送 1 个 H⁺（膜间隙 → a 亚基半通道 → 跟着 c 环转 315° → 另一半通道 → 基质）。
2. **三条 β 链的真实构象**：6ZPO 的三条 β 链（E、F、G）本身就是三种构象（空的开放态 + 两个结合核苷酸的闭合态）。
   - 每条链的残基对其他两条链按 N 端桶 + 核苷酸结合域（序号前 62%）做 Horn 叠合 `T[k][s]`，得到“链 k 摆成链 s 的样子”的坐标 `a.alts[s]`。C 端结构域的摆动（最大约 18 Å）就是看到的“口袋开合”。
   - `next(k)` = 极角在 φk + 120° 的链。转子每转 +120°，链 k 变成 `next(k)` 原来的构象。
   - 角色：没有核苷酸的链 = 开放（O）；`next(O)` = 松弛（L）；`next(next(O))` = 紧密（T）。
   - 每个 120° 步内 `w = ease((f − 0.25)/0.6)`，`ctx.setChainBlend(β组, k, c0, c1, w)`。
3. **小分子位置来自晶体**：核苷酸分给最近的 β 链；`fitPose(CCD 模板, 晶体原子)` 按原子名叠合（ADP 模板原子名是 ATP 的子集，所以 ATP 模板也能对齐晶体里的 ADP）；Mg²⁺ = 核苷酸 4.5 Å 内的 MG。
   空口袋（开放态）的位置：把邻链口袋 11 Å 内的残基与空链对应残基局部叠合，把配体搬过去。所有姿态再经 `T[k][s]` 放到位点 k，随 w 插值（位置 lerp，朝向 slerp）→ **配体跟着口袋一起闭合**。
   Pi = ATP 的 PG 位置；松弛态时沿 PB→PG 方向外移 3 Å。
4. **事件**：L→T 步：口袋闭合、Pi 靠上 ADP，f = 0.88 闪光、换成 ATP、计数 +1；T→O 步：口袋张开，ATP（带 Mg）f > 0.45 离开；O→L 步：ADP + Mg 与 Pi 从外面扩散进来结合。
   每转 3 个 ATP、8 个 H⁺。
5. 预设配合：`axisFrom: ['subunit C1','subunit beta']`，`ghost: α、β`，`spin` = γδε + c 环。

## 实例 2：鞭毛马达 `flagellarMotor`
定子 11 个均布在半径 215 Å。转子每转 2π/44（每个定子约每 4 个 H⁺ 一步，示意）生成一个 H⁺：随机选一个定子，周质侧（+y 70 Å）→ 定子通道顶 → 通道底 → 胞质（−y 80 Å）后消失。

## 实例 3：钾通道 `ionChannel`（1BL8）
每 ~1 s（随转速缩放）一个 K⁺：从胞内侧进入空腔 → 在选择性过滤器的 4 个位点（间距 3.4 Å）各停一下 → 出胞外。过滤器位置按通道高度比例估计；做精确版时用 TVGYG 残基（`ctx.atomsOf` + seq 范围）的平均 y。

## 新过程模板（复制后改）
```js
PROCESSES.enzymeTurnover = {
  caption: '底物（金）进入活性位点 → 被催化成产物（青）→ 产物离开',
  async setup(ctx) {
    const site = ctx.ligands.find(L => L.comp === 'XXX');            // 结构里的配体给出位点
    this.S = site ? site.centre.clone() : ctx.atomsOf(/某部件/)[0].p.clone();
    if (site) ctx.hideLigand(site);
    this.D = this.S.clone().setY(0).normalize();                      // 口袋朝外的方向（按实际情况改）
    const [tSub, tPro] = await Promise.all(['底物代码', '产物代码'].map(ctx.template));
    this.sub = ctx.makeMol(tSub); this.pro = ctx.makeMol(tPro); this.flash = ctx.makeFlash(0xfff1a8);
    ctx.markHot([this.S]); ctx.counters['产物'] = 0; this.t = 0;
  },
  update(ctx, dt) {
    this.t = (this.t + dt * Math.max(0.1, ctx.speed)) % 4;            // 4 秒一个循环，随转速滑块快慢
    const out = this.S.clone().addScaledVector(this.D, 45), t = this.t;
    const show = (o, p, s) => { o.visible = s > 0.02; o.position.copy(p); o.scale.setScalar(Math.max(s, 0.001)); };
    if (t < 1) show(this.sub, out.clone().lerp(this.S, ease(t)), ease(t * 2)), show(this.pro, this.S, 0);
    else if (t < 2) show(this.sub, this.S, 1);
    else { show(this.sub, this.S, 0); show(this.pro, this.S.clone().lerp(out, ease(t - 2.3)), 1 - ease(t - 3.3));
      if (!this.done) { this.done = true; ctx.counters['产物']++; } }
    if (t < 2) this.done = false;
    const fl = Math.max(0, 1 - Math.abs(t - 2) / 0.15);
    this.flash.visible = fl > 0; this.flash.position.copy(this.S); this.flash.scale.setScalar(4 + 6 * fl); this.flash.material.opacity = fl * 0.55;
  },
};
```
写完：预设加 `process: 'enzymeTurnover'` → 浏览器加载 → 等 5 秒看计数器增加 → 拉近截图确认分子在口袋里、颜色可辨。
