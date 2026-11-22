# 2026-11-19 — 合并三个播放器共用的运动算法（`plugins/motion` 第一步）

## 重复在哪里
核对三个播放器后发现真正重复的不是“叠合”（`superpose` 早已共用于 `plugins/structure/alignment.mjs`），而是**顶点位移**：ATP、AdK、KcsA 各写了一份“找最近 4 个锚点原子 → 反距离加权 → 把显示顶点移到另一构象”，另有 `sub/distance/lerp/normalize/cross/dot` 和折线取位置（`walk`）的重复小函数。

## 做了什么
- 新增 `plugins/motion/`：`vectors.mjs`、`conformation.mjs`（`displaceVertices`、`nearestAnchors`、`rotationAngle`）、`path.mjs`（`walkPath`）、README。
- ATP / AdK / KcsA 的 `decorate` 与向量小函数改为调用共用实现；AdK 的 `rotationAngle` 仍从原模块导出（兼容）。
- 两种距离平方写法（求和平方 / `Math.hypot` 平方）在旧代码里并存，为保持**逐位一致**而都保留为可选度量，未统一。
- 数值基线：把 motion 三个文件纳入受监控来源并重新生成——只有源码哈希变化，数值不变。

## 验证
- 178 项 Node 测试通过（motion 新增 7 项：向量、最近锚点并列保序、刚性平移得到同样位移、多目标独立/恒等目标不变、近处锚点主导与邻居数、旋转角恢复、折线取位置）。
- 三个播放器的黄金输出（合成数据）全部**逐位**不变。
- **真实数据新旧对照**（改动前代码 vs 新代码）：ATP 6ZPO（45 个链节点，催化链位移）、AdK 4AKE/1AKE 的团块与功能分区层及域测量、KcsA 五个真实状态（48 个链节点）——全部摘要一致。因 ATP 黄金输出原本不覆盖位移，这一步专门补上了。
- 浏览器（软件渲染 Chromium）三个官方包：ATP t=4 s `ATP 3 · H⁺ 8`；AdK NMP 44.8° / LID 52.2°；KcsA 种子 7、t=60 s `37 / 8 / 1`——与之前完全一致。
- 桌面打包脚本整体复制 `plugins/` 目录，新目录会自动包含；未重跑 Electron 冒烟/安全用例，未在真实 GPU/EXE 验证。

## 边界
- 仍是库模块，不是 `tools`；工具注册、`audience` 过滤随 4.3.3。
- 没有改变任何行为，也没有新增能力；统一距离度量需要另行更新黄金输出并说明浮点差异。

## 下一步
1. schemaVersion 3：`resource` 一等引用 + `tools[]`，让 ATP/AdK/KcsA 的配置随场景保存重开；旧 `legacy.scene.process` 映射到各模板（4.3.2）。
2. 工具协议（4.3.3）：`registerTool`、`audience`、参数描述自动生成面板；把 motion 的能力作为第一批工具。
3. 前端：机理镜头过近、粒子标签白框；Studio 面板结构（依赖工具协议）。
