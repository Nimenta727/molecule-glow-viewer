# 2026-11-20 4.4.7d 测量与通道显示

## 做了什么
经典 `glow.measure` 的距离/角度写成 `plugins/structure/measure.mjs`（三选一：一个残基的 Cα/P，或一个小分子的中心；两个选择量距离，三个量角度），通道搜索接上显示，Viewer 加“测量与通道”面板。

## 改动
- `measure.mjs`：用与 three.js 相同的 `distanceTo` / `angleTo` / `radToDeg` 算术；选择不是恰好一个对象就给出清楚的中文报错。`site-analysis.mjs` 增加 `describeChannel`（长度、最窄点、衬在最窄点附近的残基）。
- `tools/site-parity.mjs` 增加测量对照（3 个真实结构 3930 个距离、3907 个角度与 three.js 逐位相同），共 19/19；单元测试 +3，`npm test` 401。
- Viewer：`analysis-panel.mjs`：A/B/C 三个选择→虚线＋读数；通道从选择（或结构中心）出发，沿净空最大路径画一串按宽窄着色的球，写出长度、最窄净空、附近残基，可调“最窄净空”。浏览器实测 1AKE（13 位与 57 位 Lys 相距 18.61 Å，三点夹角 40.4°，含糊选择被拒）和 1K4C（从滤器 75–79 出发，最窄处旁是 Gly77、Val76、Tyr78）。截图 `docs/images/measure-view.png`、`channel-view.png`。

## 注意
- 起点本身落在 Cα 上，路径第一个点净空接近 0，“最窄”会受它影响；起点最好选在孔道中央。1K4C 在文件里只有一条 KcsA 链，不是四聚体孔道。
- 经典测量跟随构象滑块的位置；新版尚未接（`positionOf` 已留口）。

## 下一步
残基棍状显示、字幕/能量条/书签/图例。
