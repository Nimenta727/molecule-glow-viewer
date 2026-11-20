# 2026-11-20 4.4.8 叶绿体光反应的电子/质子/光子编排（接力）

## 做了什么
叶绿体官方作品现在和呼吸链一样带着经典的整套编排：一个 NADPH（2 个电子）一轮——PSII 处两个光子（天线叶绿素吸收，激发能逐个叶绿素跳到 P680）、电荷分离、水裂解（2 H⁺ 入腔，每两轮放 1 个 O₂）、PQ 从基质取 2 个 H⁺、b6f 的 Q 循环（4 H⁺ 入腔、Qi 处取 2 个基质 H⁺、低电位链 bL→bH→cn→Qi、高电位链 Rieske→细胞色素 f）、质体蓝素两趟把电子从细胞色素 f 送到 P700、PSI 处两个光子、A0→A1→FX→FA→FB 到铁氧还蛋白、铁氧还蛋白→FNR→NADPH；CF1Fo 的转子按模型通量转，每转 14 个 H⁺ 回流、3 个 ATP 离开。能量条随接力。

## 为此在锚点和引擎里补的通用能力
- 小分子取**环中心**（`ring`，经典 `ring()`），`part` 按环中心最近的残基判断所属蛋白（经典 `entIs`）；
- `near`（距离范围，可多条）、`pick: cycle`（逐轮轮换，代替随机）、`pairMid`（最近一对的中点：P680）、`along`、`mirror`、残基 `nearest`、`else`、`optional`；动作的 `pause` 可带 `text`/`at`。
- 小分子记录增加 `ring`、`ringPart`（structure-frame.mjs）；`part` 字段上限放宽到 240 字符（正则可以长一些）。

## 验证
- **真实结构对经典**（`tools/chloroplast-parity.mjs`，经典 `setup` 块原样在 vm 里运行，THREE 0.160.0；3JCU、6RQF、5L8R 各用它自己的朝向，组件间的关系用同一个固定参照点）：PSII 的 OEX、Pheo、P680、TyrZ、FE2、QA、QB；b6f 的细胞色素 f、bL、bH、cn、Rieske、Qo、Qi；PSI 的 P700、A1、FX/FA/FB；PSII 的 25–70 Å 天线集合——全部一致（环中心在 1e-9 Å 内）。A0：5L8R 里经典也找不到（路径跳过它），接力同样跳过。FNR 的 FAD 与 6FKF 的 CF1Fo 锚点按名称命中。报告 `docs/parity/chloroplast-parity-report.txt`（24/24）。
- 单测：每个 NADPH 4 个光子、6 个 H⁺ 入腔、每 2 个 NADPH 放 1 个 O₂；阶段 0–6 依次出现；计量账本平衡；CF1Fo 每转 14 个 H⁺。新锚点能力各有断言。
- 值得一提的发现：3JCU 里 D1 的 QB 位点没有醌，经典的 QB 其实是回退值（`2·Fe − QA` 对称出来）；接力的 `else: mirror` 复现了它。

## 与经典的差异
- PSI 天线里 **Lhca2** 的 9 个叶绿素被漏掉：这个蛋白和 PSII 的 LHCII 同名（`chlorophyll a-b binding protein, chloroplastic`），按名字无法区分；经典靠"来自哪个组件"区分。
- 光子被哪个天线叶绿素吸收按轮次轮换，不是随机。
- 质体蓝素、铁氧还蛋白是携带电子的标记粒子，蛋白本身不移动；激发能从天线直接到反应中心（不画中间的叶绿素）。

## 没有做
- 浏览器里没有看。
- 组件在包里是合并成一个模型的：部件名依赖各组件保留自己的实体名（呼吸链、叶绿体共用这个假设），在真实 Viewer 里加载整包后是否都命中，需要肉眼确认。
