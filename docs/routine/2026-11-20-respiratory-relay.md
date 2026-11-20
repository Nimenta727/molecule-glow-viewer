# 2026-11-20 4.4.8 呼吸链的电子/质子编排（接力引擎）

## 做了什么
经典呼吸链里"一个 NADH 的 2 个电子沿真实辅因子传递、泵质子、Q 循环、细胞色素 c 穿梭、O₂ 还原"是一段专用代码。现在它是**数据**：数据动画工具新增命名锚点、按"是什么"找辅因子的锚点、和**接力（relay）**——由阶段组成的循环。官方呼吸链作品打开即带这套编排，能量条随电子走到哪一步而亮。

## 改动
- `plugins/simulation/data-spec.mjs`：`anchors`（命名位置）与 `{ref}` 引用；锚点新能力：`ligands` 多组分代码 + `part` 过滤 + `pick`（top/bottom/nearest/paired/unpaired，`rank`）+ `chain`（经全部辅因子的电子传递最短路径）+ `take`、`above/below/margin`、`between`、`arm`（沿膜臂长轴取点）、`onMembrane`；`relays`（阶段、并行动作、`wait`/`delay`/`every`/`stage`/`text`/`then`/`pause`/`hop`/`brown`）；流可加 `by: rotor|rate`。引用不存在的名字、没有阶段、路径无效按名称报错。
- `plugins/simulation/data-animation.mjs`：`resolveAnchor` 重写为上述能力（命名锚点用环检测，不限深度），复用 `cofactorChain`、`principalAxes`；`#runRelay` / `#launch`：一轮循环按阶段推进，动作复用"流"的粒子运动；`gate: flux` 在动力学通量≈0 时不再启动（经典做法）；快速时间尺度不画粒子、计数器保持计量；`stage` 写入 `summary()`。没有写新字段的声明行为不变（原有 90 个测试全过，随机数顺序不变）。
- `plugins/simulation/structure-frame.mjs`：小分子带上所属部件（最近残基的实体，即经典 `partAt`）、结构提供 `partPoints`。
- `plugins/simulation/works/respiratory-relay.mjs`（新）：呼吸链的 22 个命名锚点与 13 阶段接力；`mechanism-works.mjs` 把它装进作品配置，`mechanism-energy.mjs` 的呼吸链能量条改为 `relay` 模式。`plugins/simulation/energy-strip.mjs`：`stage.mode: 'relay'`。Viewer 把引擎的 `stage` 传给能量条。
- 文档：`skill/references/tools.md` 增加锚点/接力格式；`feature-parity.json` 更新。

## 验证
- **真实 5GUP，对经典代码**（`tools/relay-parity.mjs`，经典 `setup` 块原样在 vm 里运行，THREE 0.160.0）：复合体 I 铁硫电线、NADH 位点、N2、Q 位点、CuA/CuB、血红素 a/a3、c1、bL、bH、Rieske、Qo、Qi、两个 cyt c 对接点——**逐位一致**；膜臂上 4 个质子通道点在 1e-9 Å 内一致（PCA 中心求和顺序不同）；没有任何锚点退回模型中心。报告 `docs/parity/relay-parity-report.txt`（24/24）。
- 在 5GUP 上整轮运行：4 个 NADH → 泵出 24 个 H⁺（每个 NADH 6 个：复合体 I 4 + 复合体 IV 每电子 1）、Q 循环释放 16 个（每个 4）、2 次 O₂ → 2 H₂O（每 2 个 NADH 1 次）；能量条 0–6 步依次出现；每种分子的计量账本平衡。
- 单测 `plugins/simulation/test/relay.test.mjs`（5 个）：锚点各能力；坏声明按名称拒绝；慢速尺度的计量/阶段/账本；同种子确定、换种子不同、断料后不再启动新循环；快速尺度计量不变。

## 与经典的差异（有意的）
- **复合体 I 的电线只用 [4Fe-4S] 簇**：经典把 [2Fe-2S] 也算进去，而在 5GUP 上最高处的簇 N1a 是离其余簇 >20 Å 的死胡同，经典路径因此退化成"一步从头跳到尾"（`site-parity` 报告里同一结果）。这里得到真正连成线的 6 个簇；对照脚本把经典块同样限定到 SF4，证明算法逐位相同。N1b（[2Fe-2S]）不在线上。
- 细胞色素 c 是一个携带电子的**标记粒子**在两个对接点之间扩散，蛋白本身不移动。
- O₂ 在第 4 个电子到达时才出现，不是先结合再等待；第二个泛醇从 45 Å 外的点来（经典用布局的行方向）。
- 泵位、释放位、Qi 取质子的"口"沿用经典的相对膜的偏移（±24、+26 Å）。

## 没有做
- ATP 合酶转子与质子回流的联动、"H⁺ 回流 / 膜间隙存量 / ATP 产出"账本（`flow.by: rotor` 已就绪，转子联动见下一步）。
- 叶绿体的电子编排（同一接力引擎，下一步）。
- 浏览器里没有看（同前）。

## 下一步
转子联动（ATP 合酶与鞭毛马达），然后叶绿体接力。
