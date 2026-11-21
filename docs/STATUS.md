# 项目现状：我们做到哪里了

更新：2026-11-21（`main`，Desktop 0.7.0 发布中；0.6.0 对应提交 2e270c1）。本页是“进度一页纸”；编号与验收条件以 [ROADMAP](ROADMAP.md) 为准，细节在 [routine](routine/) 逐步记录里。

## 一句话

**制作基底（4.3）已有第一版闭环；经典功能插件化（4.4）已完成 4.4.0–4.4.7（纯逻辑＋Viewer 工具＋Studio 编辑，结构分析与自动定膜也已完成）；4.4.8（经典作品回归）做了一部分，还没做完。** 测试 537/537 通过；经典对照脚本（粒子、数据动画、动力学、翻译、拥挤、细胞几何、结合位点/口袋/通道/测量/辅因子链、自动定膜）全部一致（见下）。

## 模板与作品（2026-11-20 起的产品划分）

- **模板（静态）**：机理、蛋白质、局部系统、细胞各一类，**什么都不动**，用来看具体结构、读知识解说。打开模板时去掉场景包里的过程/动画声明，不挂任何工具，动画面板全部隐藏，只保留结构、组件布局、膜、部件命名与配色、讲解和证据；分析工具（选择、测量、结合位点、定膜、通道、整细胞外壳等）仍可用，因为它们是“看”。
- **作品（动态）**：同样四类，展示作用原理，挂动画工具。官方 15 个包现在得到 13 个模板和 11 个作品（两个只示范动画格式的包只做作品）。四个主题各有模板，也各有作品：机理（ATP 合酶、KcsA、AdK、呼吸链、叶绿体、鞭毛、翻译…）、局部系统（细胞一角）、细胞（整个细胞：外壳＋核糖体翻译与 KcsA 两个站在细胞里同时运行）；蛋白质只有静态模板。
- 工坊对话框分“模板区 / 作品区 / 资源区”，可按主题（机理/蛋白质/局部系统/细胞）筛选；Studio 和 Viewer 共用。

## 4.5 作者、API 与工坊闭环（代码层面已做）

| 编号 | 内容 | 状态 |
|---|---|---|
| 4.5.0 | 新 Viewer 的 `window.glow` 与经典对齐 | 新增 `measure`、`sequence`、按整条链的 `color`、`clip`，`camera` 的 orbit / az,el,dist / focus，`animate('play')`；`help()` 列出已注册工具及其运行参数；`sequence`/`measure` 归入敏感读取。未迁：`style` 画风、按残基范围上色、按选择换表示（被明确拒绝，不静默忽略） |
| 4.5.1 | 工坊检索、详情、版本、授权、复用/派生、依赖诊断 | 每个条目有“详情”：作者、版本、授权条款、派生链、所需工具、依赖诊断（错误/注意/说明）；作品包可写 `derivedFrom`，授权按来源收窄，校验和对话框共用一套规则。订阅/评分/评论/投稿流程沿用原样 |
| 4.5.2 | 工程继续编辑、预览发布、版本升级、兼容与恢复 | 场景新增 `publication` 块；Studio“发布”标签（填写、读取工坊目录、发布检查）；版本升级与“派生自”；工坊校验脚本同时收经典 v1 包和 Studio 导出的 v2/v3 场景包；缺少工具/插件的作品照常打开并说明；编辑时自动留草稿，意外关闭后可恢复 |

浏览器实测（Playwright + Chromium，请求拦截提供文件、不起服务进程）：`node tools/studio-authoring-check.cjs`（发布标签与草稿恢复）、`node tools/workshop-shot.cjs`（工坊详情）；截图在 [images](images/)：`workshop-details.png`、`workshop-details-narrow.png`、`studio-publish.png`。

- **4.3 完成门槛与收尾（2026-11-21）**：第二个真实结构对 **MBP 1OMP（开）/ 1ANF（闭）** 用同一个构象工具、只改配置（叠合范围 = N 域 1-109,264-309，结构域 C 域 114-259,317-370、铰链）：N 域刚体 RMSD 0.72 Å（155 残基），C 域转 36.2°、位移 10.2 Å，换成 C 域为核心 N 域同样转 36.2°；`node tools/second-pair-check.mjs desktop/dist/smoke-structures` 7/7，`node tools/second-pair-browser.cjs` 预览→保存→重开数字一致、分子画面逐像素相同（截图 [second-pair-mbp.png](images/second-pair-mbp.png)）。选它的理由：同一条链、370 残基两边一一对应，铰链开合，且 1OMP 的标题就是“配体诱导的大幅铰链-扭转运动”；转角数字是我从坐标算出的，**未经专业人员审阅**。另：Studio 大纲多选/成组/删除/拖拽改父子（`node tools/studio-outline-check.cjs`）；添加工具时自动登记插件依赖。
- **4.3 收尾（早先）**：工具描述符有 `outputs`/`dependencies`；Studio“发布”标签有“导出发布包”：不许嵌入且有 RCSB 来源的结构改为带哈希的引用，本地文件则拒绝并指出资产；Viewer 打开带引用的包时取回并核对哈希。真实浏览器：`node tools/studio-export-check.cjs`（需先 `node tools/fetch-smoke-structures.mjs --dir desktop/dist/smoke-structures`）。引用取回在真实 RCSB 网络上尚未端到端试过（单元测试用注入的取回函数）。

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
| 4.4.7 | 经典分析与教学工具 | **完成主要部分**：结合位点相互作用（含周围残基棍状）、口袋表面、通道搜索与显示、距离/角度测量、自动定膜，以及各工具的证据行（建模/示意）并入标题徽章；图例、书签沿用 Studio/导航已有的讲解与书签，未另做；能量条见 4.4.8 | `plugins/structure/{site-analysis,measure,membrane-placement}.mjs`、`apps/viewer-web/{site-view,analysis-panel,membrane-view}.mjs`、`plugins/mechanism-catalog.mjs`（`toolEvidence`） | 23/23 + 8/8 |
| 4.4.8 | 经典作品回归 | **进行中**：**鞭毛马达的换向（CheY-P）和驱动梯度**现在是作品的两个控件（顺时针/逆时针同样每转 44 个质子，梯度为 0 时不转也不过质子）；**细胞一角的布局**（膜在核糖体顶上 60 Å、通道进切面、拥挤盒）已写成纯逻辑，在真实 4V6F + 1K4C 上与经典 8/8 一致（Viewer 打开细胞一角包时已应用这个位移，平面取场景默认视角，截图 [cell-corner-layout.png](images/cell-corner-layout.png)）；**重复加载稳定性**用真实浏览器检查（`node tools/viewer-stability-check.cjs`：3 个结构各载入 6 轮，GPU 几何/纹理/着色器/场景对象数不增长，JS 堆在 0.3 MB 内持平）；呼吸链、叶绿体两个官方包现在作为作品运行（区室动力学＋pH/电位/开关，与经典动力学逐位一致）；辅因子电子链（最短路径，与经典逐位一致）可在 Viewer 里显示；**呼吸链的电子/质子编排**（Q 循环、质子泵、细胞色素 c 穿梭、O₂→H₂O）是数据动画的“接力”，在真实 5GUP 上辅因子位置与经典逐位一致、计量成立（6 泵出 + 4 释放 H⁺/NADH），能量条随接力；**ATP 合酶与鞭毛马达的转子联动**（转子角度由引擎时钟决定，质子/ATP 事件按“每转 n 个”发出，回退重放精确；转子轴未经肉眼确认）；**翻译里 tRNA/mRNA 在 4V6F 核糖体中的运动**（E/P/A 位点位姿与经典在真实结构上一致；进 A、容纳、杂合、移位、离开；A/T 弯曲 tRNA、EF-Tu、EF-G、RF1 与四种抗生素位点已画（按 23S/16S 叠合其它 PDB，叠合与经典在真实条目上一致）；出口通道与新生肽链、红霉素与黄色霉素位点也已画；原子级特写（解码中心/PTC，真实全原子）已做；未在浏览器里确认。**修正了一个真错误**：4V6F 有两个核糖体，三条 tRNA 现在只在同一个核糖体里选）；**叶绿体光反应的电子/质子/光子编排**同样是接力（真实 PSII/b6f/PSI 上的辅因子位置与经典一致，每 NADPH 4 光子 + 6 H⁺ 入腔）；整细胞的拟核 DNA、25 000 个核糖体、鞭毛、肽聚糖、LPS、膜蛋白已画（种子化的示意布局，规则照经典、未逐点对照）；**能量转化条**随作品配置（`energy`，呼吸链/叶绿体/鞭毛自带经典文字，步骤轮流点亮为示意，**尚未在浏览器里肉眼确认**）；拥挤细胞质可画（按丰度的粗略背景蛋白）；鞭毛马达（H⁺ 经 11 条定子通道，固定速率）、整细胞外壳（内外膜按真实尺寸＋比例尺＋三个视点）、翻译与细胞一角官方包打开即带工具 | `plugins/simulation/works/`、`apps/viewer-web/cell-view.mjs` | 5/5（动力学） |

## 已注册的工具（`plugins/mechanism-catalog.mjs`）

| 工具 id | 运行时 | 用途 |
|---|---|---|
| `org.glow.tool.solution-particles` | layer-v1 | 溶液粒子、路径与流（布朗/定向、命名粒子、跨膜计数） |
| `org.glow.tool.data-animation` | layer-v1 | 数据定义的区室/池/流/反应动画，含计量账本与守恒 |
| `org.glow.tool.stochastic-process` | layer-v1 | 种子化随机状态过程（门控、通量），参数滑块重放同一种子 |
| `org.glow.tool.translation` | layer-v1 | 由序列生成的核糖体翻译，药物与浓度计划 |
| `org.glow.tool.multi-process` | layer-v1 | 多个过程并排，各自时钟/种子/计数，共享控制 |
| 旧三件 | player-v1 | ATP 合酶 / KcsA / AdK 专用播放器（过渡实现，旧 id 保留别名）；ATP 合酶与 AdK 的时间/状态侧已由通用的构象状态机运行 |

工具配置写进 `scene.tools[].config`，运行状态在 `entry.state`；Studio 按描述符自动生成编辑面板；停用插件只隐藏图层、不丢配置。格式见 [skill/references/tools.md](../skill/references/tools.md)。

## 验证数字

- `npm test`：537 通过，0 失败（先 `npm ci`）。
- 经典对照（同种子、同输入，经典代码在 Node `vm` 中原样运行）：结合位点/口袋/通道/测量/辅因子链 23/23、自动定膜 8/8、粒子 24/24、数据动画 6/6、动力学 5/5、翻译 5/5、拥挤 4/4、细胞几何 5/5；报告在 [parity](parity/)。
- 浏览器端到端（Playwright）：保存→关闭→重开后像素/数值一致；截图在 [images](images/)。
- 文档/契约检查：`node tools/check-docs.mjs`、`check-feature-parity.mjs`、`check-copies.mjs`。

## 已知限制（诚实清单）

- Studio 的粒子预览已做（工具页签里勾选“预览粒子”）；细胞一角里核糖体站与通道站的空间联系、整细胞的内膜“洞”与区域层级还没画（拟核、核糖体、鞭毛、肽聚糖、LPS、膜蛋白已画）。
- 70S 核糖体结构动画未做（原子特写已做）；KcsA 的动力学已跑在通用引擎上，播放器外壳仍是旧 id。
- pH 体积（均匀半透明盒，不是光线步进的着色器）与作用位点闪光已做，pH 体积盒已在浏览器里看到。回退/干预已做在数据动画工具上（确定性重放＋干预记录，**回退/干预的界面尚未肉眼确认**）；翻译、随机过程、多过程、旧三件播放器还没有。
- **没有真实 GPU 验证**。Desktop 0.6.0/0.7.0 的 Windows portable EXE 已由 CI 实际启动并通过六个运行案例与四个安全案例（软件渲染），见 [0.6.0 记录](validation/desktop-v0.6.0.json)；真实 GPU 上的性能与外观仍待维护者检查。
- **能量条与 pH 体积已在真实 Chromium（软件渲染）里看过**：呼吸链作品打开后顶部显示七步能量条、点亮第一步，结构周围是半透明的 pH 体积盒，动画面板的计数随模型走（截图 [official.respiratory-chain.work-opened.png](images/official.respiratory-chain.work-opened.png)、[running](images/official.respiratory-chain.work-running.png)；方法：`node tools/work-shot.cjs <作品编号>`）。软件渲染每秒只有约一帧，动画走得很慢，所以没能在截图里看完整个周期；回退/干预的外观仍未肉眼确认。
- 仍悬着的维护者事项：真实 GPU 检查；为 4.3 完成门槛选定真实的第二个结构对；在 GitHub 把 `platform-release-gate` 设为 main 必须通过的检查。（Windows 上的 studio-smoke 已在 CI 的 Windows 作业里运行。）

## 下一步（建议顺序）

0. **先把 Desktop 0.7.0 发出去**：main 已含 0.7.0 全部内容，但 `desktop-v0.7.0` 标签与 Release 尚未创建（打标签触发闸门与发布，需维护者确认）。详见 [计划](routine/2026-11-21-next-plan-after-0.7.0.md)。

1. 4.4.8 余下：**构象状态机已做**（时间与状态侧；见 [CONFORMATION_MACHINE](CONFORMATION_MACHINE.md)），ATP 合酶/AdK 的**结构侧**也已抽成通用“构象集”（`conformation-set.mjs`）；把它们升成 layer-v1 的通用工具（不再是 player-v1 专用外壳）；区域层级自己的粗糙内容；重复加载稳定性；浏览器/GPU/桌面验收。
2. 三个“播放器”并入通用引擎：KcsA 的动力学已跑在通用 Markov 引擎上（同种子逐事件、逐位一致，黄金轨迹不变）；ATP 合酶和 AdK 的算法（旋转、构象插值、叠合）早已用共享的 `plugins/motion`、`plugins/structure`，它们剩下的是各自的时间轴/粒子/事件编排，不是可以再并的算法。KcsA 的体相粒子、水合壳、曲线已恢复（胞外 Na⁺ 无控件、浴液离子与孔道进出不交换为已知差异）；把回退/干预扩展到其它工具；pH 体积着色；能量条接到其它工具（翻译/随机过程/旧三件）。
3. 桌面端验收（用户计划）：真实 GPU、完整 36 MiB 的 4V6F/7CGO 加载速度；之后才谈 4.5 工坊完整闭环与 4.7 发布。
