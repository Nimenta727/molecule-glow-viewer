# 2026-11-20 4.4.7a/b 结合位点、口袋表面与通道搜索

## 做了什么
把经典 `ligand-focus.js`（相互作用规则）、`pocket.js`（高斯分子表面）、`tunnel.js`（通道/孔道搜索）写成纯函数，逐位对照经典，再把结合位点分析接进新 Viewer。

## 改动
- 新增 `plugins/structure/site-analysis.mjs`：`siteInteractions`（氢键、盐桥、金属/离子配位、疏水接触）、`siteAround`（从已加载结构取配体周围残基/杂原子）、`pocketSurface`/`pocketJob`（口袋表面）、`findChannel`/`alongPath`/`pathLength`（通道）。
- 新增 `tools/site-parity.mjs`＋`docs/parity/site-parity-report.txt`：经典代码原样跑在 Node `vm` 里（相互作用块按标记从源码切出），真实配体（1AKE/AP5、6ZPO/ATP·ADP、1K4C/K⁺、2HVK/TBA·L2C）、口袋表面（顶点/索引/残基类别）、通道（3 个结构＋默认参数）**18/18 逐位一致**。
- 单元测试 `site-analysis.test.mjs`（5 项），`npm test` 395/395。
- 视口新增 `setOverlayLines`、`setOverlayMesh`、`setOverlayVisible`（随场景清除）；Viewer 新增 `site-view.mjs` 与“结合位点相互作用”面板：选中一个小分子后列出相互作用与距离，按类型着色虚线，口袋表面按残基化学性质着色（默认关）。浏览器实测 1AKE/AP5：22 氢键、17 盐桥，截图 `docs/images/site-view-panel.png`。
- 更新 `feature-parity.json`、`parity/cases.json`、STATUS。

## 与经典的差别
经典向 RCSB 下载 5 Å 的全原子残基；新版直接用已加载结构（同一规则、同一原子），所以不需要网络，也适用于本地文件。

## 下一步
4.4.7 余下：距离/角度测量；通道显示（`findChannel` 已就绪，需要选起点与显示）；自动定膜（`src/sim/processes/auto.js`）；字幕/能量条/书签/图例；残基棍状显示。
