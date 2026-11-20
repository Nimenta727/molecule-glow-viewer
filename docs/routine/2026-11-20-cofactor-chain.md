# 2026-11-20 4.4.8b 辅因子电子链

## 做了什么
把经典呼吸链里“复合体 I 铁硫簇之间平方距离和最小的最短路径”写成通用纯函数 `cofactorChain`（`plugins/structure/site-analysis.mjs`），与经典逐位对照，并在 Viewer 的“测量与通道”面板加“辅因子链”。

## 改动
- `cofactorChain(cofactors, { direction, maxHop, from, to })`：跳跃不超过 20 Å，总平方距离最小；起止默认是沿 `direction` 的两端，也可以用 `from`/`to`（选中对象附近）指定；找不到通路时只连两端（与经典相同）。
- `tools/site-parity.mjs`（现 23/23）：经典代码块（按标记从 `respiratory-chain.js` 切出）原样运行在 5GUP、6ZPO、3JCU 的真实辅因子中心上，坐标取作品的取向（膜法线竖直，`axisFit` 与作品包一致）；5GUP 复合体 I 的 6 个 SF4 连成 6 个点、72.8 Å，与经典一致；含 FES 时端点 FES 离最近簇 22 Å，经典与新版同样退化成两端（这是经典规则的结果，不是 bug）。
- 单元测试 +1；`npm test` 407。
- Viewer：面板里输入辅因子类型（默认 SF4/FES/HEM/HEC/HEA/CU），可选起点/终点，画出粉色虚线与编号小球，写出个数、跳距范围、总长，并说明这只是几何路径、不是转移速率。截图 `docs/images/cofactor-chain.png`。

## 没有做
电子/质子沿链运动的编排（Q 循环、泵、细胞色素 c 穿梭）、ATP 合酶转子联动。

## 下一步
鞭毛马达、整细胞空间绘制、翻译作品的核糖体结构动画；运动编排。
