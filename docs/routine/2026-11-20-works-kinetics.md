# 2026-11-20 4.4.8a 呼吸链与叶绿体作为作品运行

## 做了什么
把官方 v1 包 `respiratory-chain`、`chloroplast-light` 从“只有静态结构”变成能运行的作品：膜两侧的区室动力学（质子动力势、两侧 pH、膜电位、呼吸控制/光合控制、ATP、NADH/NADPH）加五个/四个开关和经典的说明文字。

## 改动
- `plugins/simulation/works/mechanism-kinetics.mjs`：两个动力学模型（原先是 `test/models.mjs` 里的验收用例，现在随包发布；`models.mjs` 保留为转发，路径证据不变）。
- `plugins/simulation/works/mechanism-works.mjs`：`mechanismWorkConfig(legacy)` 把经典场景（`process: respiratoryChain|chloroplast`）变成数据动画工具配置：膜上方 `top`（基质/基质）、下方 `bot`（膜间隙/类囊体腔）、模型、`axisFit`/`up`/`down`、膜位置。`mechanism-catalog.mjs` 的 `dataAnimationEntry` 接上，所以打开这两个包就会得到工具条目。
- 数据工具配置新增 `axisFit`（用指定部件的最扁方向作膜法线，经典做法）和 `up`/`down`（指定部件在上/下）；`structure-frame.mjs` 实现；Viewer 传入。
- 测试 +3（配置有效、工具条目映射、取向）：`npm test` 406/406；`tools/kinetics-parity.mjs` 仍 5/5（经典模型与数据模型逐位一致）。
- 实测：在浏览器里打开两个官方包（5GUP+6ZPO+1HRC，3JCU）：区室动力学面板、开关、读数、说明都在运行；5GUP 取向后复合体 I 的基质臂（flavoprotein 1）在上，膜在 Cytochrome b 的中心；3JCU 的 OEE（腔侧）在下。截图 `docs/images/respiratory-chain-kinetics.png`。

## 没有做（仍是经典的代码）
电子沿真实辅因子的传递、Q 循环与质子泵编排、ATP 合酶转子联动、能量转化条。

## 下一步
- 辅因子电子路径：最短路径算法（Fe–S 簇间最短 d² 路径）可先写成纯函数并对照。
- 鞭毛马达、整细胞空间绘制、翻译作品的核糖体结构动画。
