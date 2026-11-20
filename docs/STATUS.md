# 项目现状：我们做到哪里了

更新：2026-11-20（分支 `claude/adoring-maxwell-yuvpoh`，最后一个功能提交 4.4.6b）。本页是“进度一页纸”；编号与验收条件以 [ROADMAP](ROADMAP.md) 为准，细节在 [routine](routine/) 逐步记录里。

## 一句话

**制作基底（4.3）已有第一版闭环；经典功能插件化（4.4）已完成 4.4.0–4.4.7（纯逻辑＋Viewer 工具＋Studio 编辑，结构分析与自动定膜也已完成）；4.4.8（经典作品回归）做了一部分，还没做完。** 测试 412/412 通过；经典对照脚本（粒子、数据动画、动力学、翻译、拥挤、细胞几何、结合位点/口袋/通道/测量/辅因子链、自动定膜）全部一致（见下）。

## 模板与作品（2026-11-20 起的产品划分）

- **模板（静态）**：机理、蛋白质、局部系统、细胞各一类，**什么都不动**，用来看具体结构、读知识解说。打开模板时去掉场景包里的过程/动画声明，不挂任何工具，动画面板全部隐藏，只保留结构、组件布局、膜、部件命名与配色、讲解和证据；分析工具（选择、测量、结合位点、定膜、通道、整细胞外壳等）仍可用，因为它们是“看”。
- **作品（动态）**：同样四类，展示作用原理，挂动画工具。官方 15 个包现在得到 13 个模板和 10 个作品（两个只示范动画格式的包只做作品；整个细胞暂时没有动态作品）。
- 工坊对话框分“模板区 / 作品区 / 资源区”，可按主题（机理/蛋白质/局部系统/细胞）筛选；Studio 和 Viewer 共用。

## 4.4 各组进度

| 编号 | 功能组 | 状态 | 主要位置 | 经典对照 |
|---|---|---|---|---|
| 4.4.0 | 结构表示/选择/操作 | 完成主要部分（CCD/键级、剖切、选择语言、序列条、拆装、全原子界面、简介） | `plugins/structure/`、`apps/viewer-web/` | `tools/*-parity.mjs` 多份报告 |
| 4.4.1 | 构象与对象动画 | 完成（叠合/域/两态形变、部件自转） | `plugins/structure/`、`plugins/shared/` | domain-motion / rotation / state-pair |
| 4.4.2 | 粒子、路径与流 | 完成（纯逻辑、旅程、Viewer、工具） | `plugins/motion/` | 24/24 |
| 4.4.3 | 数据反应与区室 | 完成（v1 数据动画引擎、动力学：pH/浓度/电位） | `plugins/simulation/data-*`、`kinetic-model` | 6/6 + 5/5 |
| 4.4.4 | 门控与观测 | 完成（通用 Markov/Gillespie 引擎、观测、曲线、CSV） | `markov-model`、`observer`、`process-tool` | KcsA 验收用例 |
| 4.4.5 | 序列与随机过程 | 完成（核糖体翻译写成数据，药物/浓度计划） | `translation*.mjs` | 5/5（4 万随机状态速率逐位相同） |
| 4.4.6 | 环境、多过程、跨尺度 | 纯逻辑完成＋多过程工具（拥挤、胶囊细胞几何、尺度阶梯） | `crowding`、`composition*`、`cell-geometry`、`scale-ladder` | 4/4 + 5/5 |
| 4.4.7 | 经典分析与教学工具 | **完成主要部分**：结合位点相互作用（含周围残基棍状）、口袋表面、通道搜索与显示、距离/角度测量、自动定膜，以及各工具的证据行（建模/示意）并入标题徽章；能量条、图例、书签沿用 Studio/导航已有的讲解与书签，未另做 | `plugins/structure/{site-analysis,measure,membrane-placement}.mjs`、`apps/viewer-web/{site-view,analysis-panel,membrane-view}.mjs`、`plugins/mechanism-catalog.mjs`（`toolEvidence`） | 23/23 + 8/8 |
| 4.4.8 | 经典作品回归 | **进行中**：呼吸链、叶绿体两个官方包现在作为作品运行（区室动力学＋pH/电位/开关，与经典动力学逐位一致）；辅因子电子链（最短路径，与经典逐位一致）可在 Viewer 里显示；电子/质子的运动编排、ATP 合酶转子联动、翻译的核糖体结构动画、整细胞的拟核/鞭毛/肽聚糖/LPS/膜蛋白未做；拥挤细胞质可画（按丰度的粗略背景蛋白）；鞭毛马达（H⁺ 经 11 条定子通道，固定速率）、整细胞外壳（内外膜按真实尺寸＋比例尺＋三个视点）、翻译与细胞一角官方包打开即带工具 | `plugins/simulation/works/`、`apps/viewer-web/cell-view.mjs` | 5/5（动力学） |

## 已注册的工具（`plugins/mechanism-catalog.mjs`）

| 工具 id | 运行时 | 用途 |
|---|---|---|
| `org.glow.tool.solution-particles` | layer-v1 | 溶液粒子、路径与流（布朗/定向、命名粒子、跨膜计数） |
| `org.glow.tool.data-animation` | layer-v1 | 数据定义的区室/池/流/反应动画，含计量账本与守恒 |
| `org.glow.tool.stochastic-process` | layer-v1 | 种子化随机状态过程（门控、通量），参数滑块重放同一种子 |
| `org.glow.tool.translation` | layer-v1 | 由序列生成的核糖体翻译，药物与浓度计划 |
| `org.glow.tool.multi-process` | layer-v1 | 多个过程并排，各自时钟/种子/计数，共享控制 |
| 旧三件 | player-v1 | ATP 合酶 / KcsA / AdK 专用播放器（过渡实现，旧 id 保留别名） |

工具配置写进 `scene.tools[].config`，运行状态在 `entry.state`；Studio 按描述符自动生成编辑面板；停用插件只隐藏图层、不丢配置。格式见 [skill/references/tools.md](../skill/references/tools.md)。

## 验证数字

- `npm test`：413 通过，0 失败。
- 经典对照（同种子、同输入，经典代码在 Node `vm` 中原样运行）：结合位点/口袋/通道/测量/辅因子链 23/23、自动定膜 8/8、粒子 24/24、数据动画 6/6、动力学 5/5、翻译 5/5、拥挤 4/4、细胞几何 5/5；报告在 [parity](parity/)。
- 浏览器端到端（Playwright）：保存→关闭→重开后像素/数值一致；截图在 [images](images/)。
- 文档/契约检查：`node tools/check-docs.mjs`、`check-feature-parity.mjs`、`check-copies.mjs`。

## 已知限制（诚实清单）

- Studio 里还没有粒子预览；Viewer 里没有细胞一角的空间布局/拥挤/包络绘制。
- 70S 核糖体结构动画与原子特写未做；KcsA 播放器仍用自己的一套链（待并入通用引擎）。
- 没有 pH 体积着色器；“回退/干预（rewind/intervene）”与 markHot 未做。
- **没有任何真实 GPU / 桌面 EXE 验证**——全部在无 GPU 的容器里完成，桌面端由维护者后续实现和验收。
- 三件仍悬着的维护者事项：Windows 上运行 `tools/studio-smoke.cjs`；真实 GPU/桌面检查；为 4.3 完成门槛选定真实的第二个结构对。

## 下一步（建议顺序）

1. 4.4.8 余下：电子/质子沿辅因子链运动的编排（Q 循环、泵、细胞色素 c 穿梭，经典里是专用代码）；鞭毛马达与转子角度的联动；翻译作品里 tRNA/mRNA 在 70S 里的运动；整细胞的拟核/鞭毛/肽聚糖/LPS/膜蛋白；能量转化条（随作品配置）。
2. 把 ATP、KcsA、AdK 三个专用播放器并入通用引擎（KcsA 的体相粒子、水合、曲线一并恢复）；Studio 粒子预览；回退/干预界面；pH 体积着色。
3. 桌面端验收（用户计划）：真实 GPU、完整 36 MiB 的 4V6F/7CGO 加载速度；之后才谈 4.5 工坊完整闭环与 4.7 发布。
