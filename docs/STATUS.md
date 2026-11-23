# 项目现状：我们做到哪里了

更新：2026-11-22（`main`，Desktop 0.12.0；发行记录见 [docs/releases](releases/desktop-v0.12.0.md)）。本页是“进度一页纸”；编号与验收条件以 [ROADMAP](ROADMAP.md) 为准，细节在 [routine](routine/) 逐步记录里。

## 0.9.0 做了什么（2026-11-22）

- **作图核心**：选择驱动的表示与着色（含逐原子棍状）、标注与测量（含按类型着色的氢键/盐桥线）、镜头关键帧、分子表面（可按简化库仑静电/疏水性着色）、一个场景放多个结构；全部随作品保存，Viewer 里一样显示。详见 [routine 记录](routine/2026-11-22-authoring-core.md)。
- **插件面板规矩**（`packages/plugin-host/panels.mjs`）与五个 Studio 面板：界面接触（含氢键/盐桥/疏水分类）、组成与性质、序列与二级结构、结构叠合（可跨条目）、分子表面与静电；插件清单共 22 个。
- **诚实的局限**：静电是简化库仑（不是 APBS）；氢键/盐桥只用重原子距离、无角度；叠合只用 Cα；移动过的链上已算好的高亮/测量/表面不跟着走；Viewer 里只能看、不能做；没有真实 GPU 验证，科学表述未经专业审阅。

## 0.12.0 之后（2026-11-23，尚未发版）

- **工坊“本地”区**：打开或导入过的 .glow 作品记在本机，在工坊“本地”里按**作品名称**列出，可打开、导出、改名、删除（Viewer、Studio 都有）。导入先查类型和大小、可拖放（Viewer）、大文件有提示；导出文件名用作品标题。详见 [routine 记录](routine/2026-11-23-local-works.md)。

## 0.12.0 做了什么（2026-11-23）

- **氢键与价键细节插件**（`bond-details`）：“查看”页的“原子细节”——球棍模型、价键模型、画氢键和盐桥线；模板默认仍是残基样式，由使用者按需打开。
- **文字标签插件**（`residue-labels`）：给选中的一处写标签，随作品保存；插件共 26 个。
- **官方工坊目录随软件内置**（`app/workshop/official/`：基础蛋白质作品、26 个插件的列表、资源），打包的应用里官方源不再联网；社区源仍联网。原子结构（22 个条目约 200 MB）仍按需从 RCSB 下载。
- 作品的本地导出和导入已核对：Viewer 的“打开”、Studio 的“导入场景包…”都能打开噬菌体的四个作品（含 113 MB 的装配体），Studio 重新导出后字节数与原文件一致。作品文件只放本地，不进发行页。详见 [routine 记录](routine/2026-11-23-view-panel-and-navigation.md)。

## 0.11.0 做了什么（2026-11-23）

- **Viewer 有了真正的操作入口**：新增“查看”页（显示方式含新的**球棍**、颜色、分子表面、光影、剖开、亚基列表：显示/隐藏/选中/聚焦/只看它，以及“拆装”）和“视角”页（鼠标左键模式、旋转/平移/缩放按钮、标准视角、以所选为中心、双击画面设旋转中心、滚轮朝鼠标缩放）。此前这些只能用命令。
- **三个以“看”为主的科研功能**：周边残基（新插件）、组成与性质、界面接触（原 Studio 面板插件，Viewer 里也能用，只读）。
- **光影包成为可拆卸的插件**（`org.glow.plugin.look-packs`，工坊插件区可停用）；插件共 24 个。Viewer 新增 `surface`、`lookPack`、`composition`、`contacts`、`neighborhood` 命令。
- 按钮、芯片、图例的文字不再被省略号截断，面板加宽。
- **作品留在本地**：不进发行页（0.10.0 发行页上误传的噬菌体作品已删除）。

## 0.10.0 做了什么（2026-11-22）

- **给 AI 的 Studio 命令接口 `window.studio`** 与 Studio 的“过程”页签（实时显示、放慢演示、回到某一步前）；操作手册和制作规范见 [skill/references/studio_authoring.md](../skill/references/studio_authoring.md)。
- **光影包**（暗场·细胞内部、冷光·膜蛋白、暖光·活性位点、论文白底）与三个展示作品；没做拥挤的多份拷贝场景和图表叠加。详见 [routine 记录](routine/2026-11-22-ai-interface-and-look-packs.md)。
- **大复合体作图支持**：表面可加膨胀半径（`inflate`）并自动用更粗的网格；剖开（`clip`）同样作用于表面；`part("chain A,B,C", …)` 支持多条链；`camera({focus})` 选中几十万残基时不再栈溢出。
- **噬菌体 T7 静态作品**（`tools/build-phage-model.py` + `tools/make-phage-works.cjs`）：成熟衣壳蛋白 gp10A（3J7X）、门户-尾部复合体（9JYZ）、核心蛋白（9JYY）按文献分组着色；装配体剖开图（头+核心+门户尾部+DNA 线轴）的各部件相对位置是示意。作品文件较大，放在发行页，不在仓库里。详见 [routine 记录](routine/2026-11-22-phage-model-start.md)。
- **修复**：桌面版结构缓存提交遇到 `EXDEV`（个别 Windows 机器上重命名失败）时降级为复制再删除；此前这会让所有在线结构显示“载入失败：Failed to fetch”。详见 [routine 记录](routine/2026-11-22-exdev-cache-fix.md)。

## 一句话

**制作基底（4.3）已有第一版闭环；经典功能插件化（4.4）已完成 4.4.0–4.4.7（纯逻辑＋Viewer 工具＋Studio 编辑，结构分析与自动定膜也已完成）；4.4.8（经典作品回归）做了一部分，还没做完。** 测试 537/537 通过；经典对照脚本（粒子、数据动画、动力学、翻译、拥挤、细胞几何、结合位点/口袋/通道/测量/辅因子链、自动定膜）全部一致（见下）。

## 模板与作品（2026-11-20 起的产品划分）

- **模板（静态）**：机理、蛋白质、局部系统、细胞各一类，**什么都不动**，用来看具体结构、读知识解说。打开模板时去掉场景包里的过程/动画声明，不挂任何工具，动画面板全部隐藏，只保留结构、组件布局、膜、部件命名与配色、讲解和证据；分析工具（选择、测量、结合位点、定膜、通道、整细胞外壳等）仍可用，因为它们是“看”。
- **作品（动态）**：同样四类，展示作用原理，挂动画工具。官方 15 个包现在得到 13 个模板和 11 个作品（两个只示范动画格式的包只做作品）。四个主题各有模板，也各有作品：机理（ATP 合酶、KcsA、AdK、呼吸链、叶绿体、鞭毛、翻译…）、局部系统（细胞一角）、细胞（整个细胞：外壳＋核糖体翻译与 KcsA 两个站在细胞里同时运行）；蛋白质只有静态模板。
- 工坊对话框分“静态作品（原模板区）/ 作品区 / 资源区 / 插件区 / 我的模板”，可按主题（机理/蛋白质/局部系统/细胞）筛选；Studio 和 Viewer 共用。

## 4.5 作者、API 与工坊闭环（代码层面已做）

| 编号 | 内容 | 状态 |
|---|---|---|
| 4.5.0 | 新 Viewer 的 `window.glow` 与经典对齐 | 新增 `measure`、`sequence`、按整条链的 `color`、`clip`，`camera` 的 orbit / az,el,dist / focus，`animate('play')`；`help()` 列出已注册工具及其运行参数；`sequence`/`measure` 归入敏感读取。未迁：`style` 画风、按残基范围上色、按选择换表示（被明确拒绝，不静默忽略） |
| 4.5.1 | 工坊检索、详情、版本、授权、复用/派生、依赖诊断 | 每个条目有“详情”：作者、版本、授权条款、派生链、所需工具、依赖诊断（错误/注意/说明）；作品包可写 `derivedFrom`，授权按来源收窄，校验和对话框共用一套规则。订阅/评分/评论/投稿流程沿用原样 |
| 4.5.2 | 工程继续编辑、预览发布、版本升级、兼容与恢复 | 场景新增 `publication` 块；Studio“发布”标签（填写、读取工坊目录、发布检查）；版本升级与“派生自”；工坊校验脚本同时收经典 v1 包和 Studio 导出的 v2/v3 场景包；缺少工具/插件的作品照常打开并说明；编辑时自动留草稿，意外关闭后可恢复 |

浏览器实测（Playwright + Chromium，请求拦截提供文件、不起服务进程）：`node tools/studio-authoring-check.cjs`（发布标签与草稿恢复）、`node tools/workshop-shot.cjs`（工坊详情）；截图在 [images](images/)：`workshop-details.png`、`workshop-details-narrow.png`、`studio-publish.png`。

- **复合体记录（插件规划 A3 的第一步，2026-11-21）**：`packages/schema/complex.mjs`——一种只存引用不存坐标的记录：由哪些资源（`{id, version, sha256}`）、各几份、每份用哪些链、相对位姿（位置/旋转/缩放）和每个摆放的**证据**（实验/推导/建模/示意）组成；`validateComplex`（唯一成员、一份一个摆放、证据序号有效、单位四元数、正缩放）、`stoichiometry`、`resolveComplex`（缺资源或哈希不符时报告而不是悄悄丢掉）、`diagnoseComplex`（给作者看的中文提示）、`complexFromStructure`（把真实条目的链按条目自己的名称分组，保持原坐标，证据就是条目本身）。作者用 `node tools/complex-from-structure.mjs <cif> --accession 6N2Y --id ... --title ...` 生成；真实数据检查 `node tools/complex-check.mjs <结构目录>`：6N2Y 为 α₃β₃γδε、b₂、a、c₁₀，6ZPO 的 c₈，4V6F 59 个成员都能解析；资源引用与工坊目录一致。**未做**：工坊里的复合体分区、Studio 面板、由多个条目装配（C1 才会写入有各自证据的摆放）、实例化渲染（B1）。
- **官方作品用到的结构全部登记为资源（2026-11-21）**：工坊资源区由 11 个增至 **29 个**：新增 1A70、1FNB、1PLC、5L8R、6FKF、6RQF、1AON、1KX5、5LE5、6VXX、6YKM、7CGO、8YJT、1UCU、4V6F，以及两个预设用到的 1OMP、1ANF、6N2Y。每个都是不带字节的引用型记录（来源、CC0、SHA-256、字节数、物种、方法、文献），文件按需从 RCSB 取回并核对哈希。哈希是我 2026-11-21 从 RCSB 原样下载后计算的，其中 1OMP、1ANF、6N2Y 与此前固定的下载清单逐位一致（说明可复现），**但还没有经过维护者的哈希评审**；最大的 4V6F 为 38 MB（在 64 MiB 上限内）。现在每个官方作品的 `pdb` 都有对应资源（0 个“结构未登记”）。登记时核对了实验方法并更正了我凭印象写的三处：5L8R、4V6F 是 X 射线晶体学，1UCU 是电子显微镜。数据在 `docs/science/structures.json`，文案在 `workshop/tools/build-resources.mjs`，`node workshop/tools/build-resources.mjs && node workshop/tools/build-index.mjs` 重新生成。
- **回退/干预界面已在真实浏览器里操作过（2026-11-21）**：`node tools/rewind-check.cjs`（呼吸链作品，软件渲染）。流程与断言：播放 → 打开“高耗能”开关（记一条干预，读数随之变化）→ 继续播放 → 用时间滑块回到 1.0 s（面板写“现在在过去”，最远时间被记住）→ 前进回最远处，**时间、计数器、动力学读数、干预记录逐字相同**；“后退 5 秒”“前进 5 秒”（前进不超过最远处）；回到 1.0 s 改“寡霉素”，面板提示旧的干预记录作废，只剩新的一条，最远时间变为当前。截图 [rewind-1-forward.png](images/rewind-1-forward.png)、[rewind-2-rewound.png](images/rewind-2-rewound.png)、[rewind-3-edited-past.png](images/rewind-3-edited-past.png)、[rewind-panel.png](images/rewind-panel.png)。看图发现的小毛病：窄侧栏里“时间 1.0 / 1.0 s”会折行；回退到很早处的读数是暂态（耗氧速率 180% 是起始瞬态，不是稳态）。仍未做：翻译、随机过程、多过程、旧三件播放器没有回退/干预；长时间运行后回退到很早处的重放耗时没测。
- **第一个用平台做的作品与 GPU 验收（2026-11-21）**：血红蛋白静态作品（Studio 从 PDB 模板制作，工坊社区区）；`tools/gpu-acceptance.cjs` 与给 AI 读的验收提示词 [ACCEPTANCE_GPU_PROMPT](ACCEPTANCE_GPU_PROMPT.md)；真显卡数据待你验收。详见 [routine](history/routine/2026-11-21-hemoglobin-work-and-gpu-acceptance.md)。
- **4.4.8：浏览器确认（2026-11-21）**：呼吸链能量条与计数器**已确认**；ATP 合酶作品转子**已确认在转**（计数与圈数一致；转轴与几何轴线的重合未量化）；翻译里 tRNA/mRNA **原先在播放后消失——是真 bug，已修复并在浏览器里确认**（视图只取最新状态、跳过了状态转换；现按顺序重放每个事件；打开时自动剖开核糖体露出 tRNA）。详见 [routine](history/routine/2026-11-21-448-visual-confirmation.md)。
- **4.4.8：第二个旋转 ATP 酶（2026-11-21）**：旋转 ATP 酶工具 `org.glow.tool.rotary-atpase` 新增预设 **枯草芽孢杆菌 PS3 F1Fo（6N2Y，冷冻电镜 3.0 Å，c10 环）**（`plugins/atp-synthase/templates.mjs`，纯数据；细菌里转子是 γ、ε 与 c 环，δ 是静止的外周柄，部件名与牛的条目不同）。真实浏览器端到端 `node tools/atp-second-work-check.cjs`：Studio 导入 6N2Y → 选预设添加（适用性检查通过）→ 导出 → 全新 Viewer 打开 → 转一圈得到 **3 ATP、10 H⁺**（牛 c8 是 8 H⁺），面板为作品自己的文字，系统视图含全部 31 个部件（截图 [atp-ps3-work-opened.png](images/atp-ps3-work-opened.png)）。端到端时发现并修了一个真问题：Studio 导入的结构是平铺的（每链一个顶层节点），而工具的导航视图以转子第一条链为根，Viewer 只显示根的子树，结果只画出 γ 一条链；现在准备作品场景时（`ensureStructureRoot`）给带工具的平铺结构补一个总根组，与官方包同形，所有播放器受益。**未做**：这条路径下 β 位点的三个构象仍取自同一个条目的三个催化位点（与牛的做法相同）；每圈 H⁺ 数由 c 环亚基数得出，未对 PS3 实验化学计量单独核对（文献里 PS3 为 c10，条目里确有 10 条 c 链）。
- **Studio 里直接改结构域残基范围（2026-11-21）**：文本字段新增 `format: 'ranges'`，面板里写 `1-109, 264-309`，配置里保存为 `[[1,109],[264,309]]`；写错（如 `9-3`）给出原因并恢复原值。两态构象工具另外开放了蛋白名称正则、物种、参考域（下拉）、参考配体残基名与链。没写进任何域的残基按参考域上色，不再出错。真实浏览器（`node tools/mbp-work-check.cjs`）：把 C 域改为 114-259 → 导出 → Viewer 的度量（36.00° / 10.65 Å）与独立计算一致，且与未编辑时不同。
- **4.4.8：第二个蛋白作为“作品”跑在同一个工具上（2026-11-21）**：`org.glow.tool.conformation-pair`（原 AdK 专用播放器的通用名）新增**预设**机制（描述符 `author.presets`，注册时就用工具自己的校验器检查），第一个预设是**麦芽糖结合蛋白 1OMP/1ANF**（`plugins/adenylate-kinase/templates.mjs`，纯数据）。Studio“添加工具”下拉里同一工具出现两项；真实浏览器端到端 `node tools/mbp-work-check.cjs`：Studio 导入 1OMP → 选预设添加 → 导出场景包 → 全新 Viewer 打开 → 播放闭合，度量（RMSD 0.721 Å、C 域 36.21°/10.21 Å、铰链 17.41°）与独立的坐标计算逐位一致，面板用作品自己的标题与证据（截图 [mbp-work-opened.png](images/mbp-work-opened.png)）。顺手修了两处 AdK 专属措辞会漏到别的作品上的问题：机制面板标题/证据改用作品配置里的 `panel`，参数“显示闭合态 Ap5A 参考”改为“参考配体”。两条独立代码路径（通用 `state-pair` 与 AdK 构建器）在 MBP 上数字相同，见 `docs/parity/second-pair-mbp-report.txt`。**未做**：ATP 合酶的同类通用化（它的几何仍围绕“c 环 + 三个 β 亚基”）；AdK 播放器仍是 player-v1。域划分待专业审阅。
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
- pH 体积（均匀半透明盒，不是光线步进的着色器）与作用位点闪光已做，pH 体积盒已在浏览器里看到。回退/干预已做在数据动画工具上（确定性重放＋干预记录，回退/干预的界面已在真实浏览器里操作并看过（见下））；翻译、随机过程、多过程、旧三件播放器还没有。
- **没有真实 GPU 验证**。Desktop 0.6.0 起每个版本的 Windows portable EXE 已由 CI 实际启动并通过六个运行案例与四个安全案例（软件渲染），见 [0.6.0 记录](history/validation/desktop-v0.6.0.json)；真实 GPU 上的性能与外观仍待维护者检查。
- **能量条与 pH 体积已在真实 Chromium（软件渲染）里看过**：呼吸链作品打开后顶部显示七步能量条、点亮第一步，结构周围是半透明的 pH 体积盒，动画面板的计数随模型走（截图 [official.respiratory-chain.work-opened.png](images/official.respiratory-chain.work-opened.png)、[running](images/official.respiratory-chain.work-running.png)；方法：`node tools/work-shot.cjs <作品编号>`）。软件渲染每秒只有约一帧，动画走得很慢，所以没能在截图里看完整个周期；回退/干预的外观已看过（软件渲染，见下一条）。
- 仍悬着的维护者事项：真实 GPU 检查；为 4.3 完成门槛选定真实的第二个结构对；在 GitHub 把 `platform-release-gate` 设为 main 必须通过的检查。（Windows 上的 studio-smoke 已在 CI 的 Windows 作业里运行。）

## 下一步（建议顺序）

0. **Desktop 0.9.0 已发布**（见 [发行说明](history/releases/desktop-v0.9.0.md)）：作图核心、五个 Studio 科研分析面板（插件共 22 个）、多结构场景。**接下来由维护者做**：在有独显的电脑上验收（[ACCEPTANCE_GPU_PROMPT](ACCEPTANCE_GPU_PROMPT.md)，分子表面三角形多，要看帧率），并请有专业背景的人审阅各面板的科学表述（氢键/盐桥阈值、简化库仑静电、核心域划分）。

1. 4.4.8 余下：**构象状态机已做**（时间与状态侧；见 [CONFORMATION_MACHINE](CONFORMATION_MACHINE.md)），ATP 合酶/AdK 的**结构侧**也已抽成通用“构象集”（`conformation-set.mjs`）；把它们升成 layer-v1 的通用工具（不再是 player-v1 专用外壳）；区域层级自己的粗糙内容；重复加载稳定性；浏览器/GPU/桌面验收。
2. 三个“播放器”并入通用引擎：KcsA 的动力学已跑在通用 Markov 引擎上（同种子逐事件、逐位一致，黄金轨迹不变）；ATP 合酶和 AdK 的算法（旋转、构象插值、叠合）早已用共享的 `plugins/motion`、`plugins/structure`，它们剩下的是各自的时间轴/粒子/事件编排，不是可以再并的算法。KcsA 的体相粒子、水合壳、曲线已恢复（胞外 Na⁺ 无控件、浴液离子与孔道进出不交换为已知差异）；把回退/干预扩展到其它工具；pH 体积着色；能量条接到其它工具（翻译/随机过程/旧三件）。
3. 桌面端验收（用户计划）：真实 GPU、完整 36 MiB 的 4V6F/7CGO 加载速度；之后才谈 4.5 工坊完整闭环与 4.7 发布。
