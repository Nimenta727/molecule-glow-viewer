# 第二轮审计（严格版）：核对、缺陷分级、三个模拟器、开发者接口、实施清单

> **审计对象**：`glow_viewer/index.html`（唯一源头；快照 6776 行，2026-11-16 08:43）。审计期间该文件仍被其他会话修改，**行号带 ~，只作定位，以函数名为准**。
> **其他依据**：`docs/AI_AUDIT_AND_STABILIZATION.md`（第一轮）、`docs/ROADMAP.md`、`glow_studio/main.js`（GLOW_REGRESS / GLOW_SMOKE）、`glow_studio/scripts/regress.mjs` + `regress-scenes.json`、`workshop/SCHEMA.md`、`workshop/tools/*`、skill `references/architecture.md`、`build_log.md`。
> **规则**：只有在代码里核实过、并且满足第一轮验收标准的才算“完成”。有雏形但没达到验收标准的一律记为 ❌，并写明缺什么。
> **严重度**：**P0** = 对学习者是错的或误导的，或崩溃 / 泄漏 / 竞态，或让测试失效；**P1** = 与 Mol\* / NGL / ChimeraX 的专业差距；**P2** = 打磨。每条都有验收检查。

---

## 0. 结论（一段话）

画面和机制动画是我们的强项，但**“可信”和“可验证”这两条地基都还没有建起来**：第一轮 5 个冲刺里，按验收标准没有一个冲刺完成；新加的证据徽章有 4 处标错或漏标（把模型标成实验、把手工摆放的膜标成推算、漏掉随机大小和热抖动）；ATP 合酶快放时 H⁺ 计数器停住但 ATP 继续加，屏幕上的 H⁺/ATP 比是错的；呼吸链把复合体 III 的 Q 循环释放算成“泵出”，这是教科书里要纠正的误解；新的回归脚本看不到叠加层（粒子都在那里），对“组件加载失败”“过程初始化失败”也报通过，所以“回归全过”目前不能说明没有泄漏或没有坏场景。对照 Mol\*/NGL/ChimeraX，我们在选择语言、序列视图、测量、会话 / 撤销、来源信息、可编程接口这 6 项上全部缺失。

---

## 1. 对照第一轮审计：逐项核对（严格）

### 1.1 冲刺

| 冲刺 | 条目 | 结论 | 证据 / 缺什么 |
|---|---|---|---|
| 1 | 六个固定场景回归 | ❌ | 脚本存在（`regress.mjs`、`regress-scenes.json`、`main.js` ~89–109、`loadAndProbe` ~6760），但：**没有 `regress/baseline.json`**（`regress/latest/` 只有 1 张 jpg，没有跑完过一轮）；截图不比较；计数器不比较（随机）；看不到叠加层；有两类失败报通过（见 §2.3）。仓库 `desktop/scripts/` 里没有这个脚本，ROADMAP 写的路径不存在。 |
| 1 | 资源计数 + 场景 session | ❌ | 只有 `renderer.info` 和 `scene.traverse` 计数。无 `SceneSession`、无 `ResourceRegistry`；DOM 标签、监听器、Worker、定时器、挂起协程都不统计。 |
| 1 | 加载取消 | ❌ | 只有 `loadSeq`/`Stale` 令牌（~4507、~4996），在 await 之后放弃。无 `AbortController`，`fetchText`（~558）不接受 signal；`focusLigand`、`kitFullAtom` 不受令牌管（R3、R4）。验收“连切 20 次只剩最后一个场景”从未测过。 |
| 1 | 记录 GPU / FPS / 内存 / 请求数 | ❌ | 请求数、下载字节数没有。GPU 名只 `console.log`。 |
| 2 | `preserveDrawingBuffer` 按需 | ❌ | 仍为 `true`（~852）。 |
| 2 | 标签 / HUD 限频 | ❌ | `frame()`（~6717）每帧 `updateLabels/updateFocusLabels/updateEnergy/updateTags`；每帧多次 `getComputedStyle`/`getBoundingClientRect`（`updateTags` ~2156、`updateViewOffset` ~1828、`updateCellSim` ~5296）。 |
| 2 | 按实时 FPS 降级 | ❌ | 只在启动时按 GPU 字符串选一次（~6728）。 |
| 2 | 表面 / 接触 Worker 化 | ❌ | 只有口袋表面 `runPocketJob`（~6106）；`lowpassSurface`、`kitContacts`、`findChannel`、`buildCrowd` 在主线程。 |
| 2 | 大结构 LOD 预算 | ❌ | 有简化表示，但没有任何三角形 / 绘制调用预算或自动切换。 |
| 3 | `StructureModel` | ❌ | `model` 是 `loadScene` 里临时拼的对象；残基对象上混着 `hot/part/entName/p2/alts/rf`（表示和模拟字段）。 |
| 3 | `Selection` | ❌ | `sel`（~1750）只支持 `part:`、`residue:` 两种 id，无表达式；配体焦点、拆装选择、核心、孔道各自独立。 |
| 3 | 来源与证据等级 | ❌ | 徽章已加，但标错 / 漏标（§2.1）；方法、分辨率、物种、文献只在自动模式卡片里有。 |
| 4 | 统一 `create/step/observe/dispose` | ❌ | 仍是 `setup/update/caption/cell`，没有 `dispose`。 |
| 4 | seed、事件日志、重放 | ❌ | 全部 `Math.random`；无事件日志（翻译站的 `this.log` 只是文字）。 |
| 4 | 保留现有过程 | ✅ | 已核：8 个预设过程 + auto + dataAnim 都在。 |
| 5 | 可保存场景状态 | ❌ | `.glow` 只存 cfg + 相机 + 剖切；不存选择、表示、可见性、构象、时间尺度、模拟控件、seed。 |
| 5 | 三层导航 | ❌ | 选项卡只是筛预设；整个细胞有缩放级别，但无“进入机器 / 返回”。 |
| 5 | 三条完整链路 | ❌ | 无。 |

### 1.2 不变量

| 不变量 | 结论 | 说明 |
|---|---|---|
| 坐标 Å | ✅ | |
| 时间单位分清模拟 / 展示 | ❌ | 慢放 / 快放不说比例；细胞 HUD 的“秒”是模拟秒还是屏幕秒没写。 |
| author / label 编号不混用 | ❌（未核实即视为缺失） | 内部用 label_seq；信息卡显示哪种编号没有标注，学习者对照论文会对不上。 |
| 来源可查 | ❌ | 预设没有文献字段；分辨率 / 方法不显示。 |
| 缺失坐标不伪装 | ❌ | 断链处团块直接相邻，示意 / 卡通把缺口连起来（`sweepFragment` 按片段分开，但没有任何“这里缺 N 个残基”的标注）。 |
| 示意可辨识 | ❌ | 徽章存在但内容有错（§2.1）。 |
| 剖开不闪烁 | ✅ | 固定楔形 `aimCut`，已核。 |
| 每站显式状态机 | ❌ | 翻译、KcsA、细胞模型是；atpSynthase、flagellarMotor、respiratoryChain、chloroplast 是动画驱动。 |
| 固定 seed 重放 | ❌ | |
| 单一源头 | ❌ | `glow_viewer/index.html` ≠ `github_repo/web/index.html`；CI 的 `glow-lib.mjs loadRules` 读后者，**CI 和查看器可能执行不同的校验规则**。 |
| 新功能可关闭 | ❌ | 证据徽章、能量条不可关。 |
| 切换不残留 | ❌ | R1–R5。 |

---

## 2. 新加部分的审计

### 2.1 证据徽章 `evidenceOf` / `renderEvidence`（~5681–5711）

| # | 级别 | 缺陷 | 验收 |
|---|---|---|---|
| E1 | **P0** | `cfg.local`（本地文件 / 场景包内嵌 `structure`）一律记为“实验”。SCHEMA 明说内嵌结构用于 **AlphaFold 或自己建的模型**——模型被标成实验坐标。 | 内嵌结构默认归入“建模”；只有包里写 `structure.source: {pdb:'XXXX'}` 且能核对时才归“实验”。测试包（AlphaFold mmCIF）打开后徽章显示“建模 1”，无“实验”。 |
| E2 | **P0** | `cfg.membranes`（预设按“某部件高度 + offset”手工摆的膜）记为“推算：由 UniProt / OPM 注释或疏水带推算”。只有 `cfg.auto` 才是推算。 | `cfg.membranes` → “建模：膜的位置按预设摆放”；`cfg.auto && autoMem` → “推算”并写明来源（`MEM_SRC[autoMem.src]`）。6ZPO 场景徽章里“推算”不再出现膜条目。 |
| E3 | **P0** | 漏标的示意：残基团块**随机大小** `a.rf = 0.85–1.15`（`blobInstances` ~1135）、团块**热抖动** `uJitter`、随机排布的**脂质分子**（`rebuildMembranes` ~5799）、团块整体放大（`blob` 滑块）、小分子放大（`ligScale`）。同时“实验”条写“每个团块 = 一个残基（Cα）”，与随机大小矛盾。 | “示意”列表包含：团块大小与抖动、脂质排布、小分子放大倍数（显示当前值）。把 `ligScale` 调到 2 后徽章条目显示“小分子放大 2×”。 |
| E4 | **P0** | 数量口径混乱：徽章写 `ligGroups.length 个小分子 / 离子`，但 `ligGroups` 是“化学组分 × 构象”分组；状态栏写 `ligands.length 个小分子`；`probe().ligands` 又是 `ligGroups.length`。同一场景三个不同数。 | 统一为“N 种 / M 个”；probe 拆为 `ligandTypes`、`ligandCopies`；6ZPO 上三处一致。 |
| E5 | **P0** | `renderEvidence` 只在加载成功路径调用；`clearScene` 不清 `#evid`。加载失败或被取代时，**徽章仍描述上一个场景**。 | clearScene 清空 `#evid/#evidPop` 和 `__viewer.evidence`；加载一个不存在的 PDB 编号后徽章为空。 |
| E6 | **P0** | `SCENE_KEYS`（~6224）不含 `evidence`，`sanitizePack` 删除场景包的 `scene.evidence`——社区内容**无法**声明自己的示意部分，徽章功能对工坊无效。 | 加入 `evidence`；包里 `evidence.illustrative:['x']` 打开后徽章出现 “x”；`validate.mjs` 通过。 |
| E7 | P1 | 徽章只到场景级。点一个粒子 / 拥挤分子 / 膜，看不到它属于哪一级。Mol\* 的来源信息至少到“模型/条目”级。 | 信息卡每次都显示一行证据等级色块。 |
| E8 | P1 | “示意”条依赖 `/示意/.test(caption)`——是否标注取决于作者是否碰巧写了“示意”两个字。 | 删除这条启发式，改为过程自己声明 `evidence`（每个 PROCESSES 必填，缺了回归失败）。 |
| E9 | P2 | 包内字符串 `cleanStr` 已转义 `<`，`renderEvidence` 再 `escT` → 显示 `&lt;`。 | 含 `<` 的条目显示为 `<`。 |
| E10 | P2 | 徽章不可关闭（违反“新功能可关闭”）。投影 / 截图时占位。 | 面板里有开关，截图选项可隐藏。 |

### 2.2 诊断 `probe` / `loadAndProbe`（~6749–6766）

| # | 级别 | 缺陷 | 验收 |
|---|---|---|---|
| D1 | **P0** | `objects` 只 `scene.traverse()`；过程粒子、池、FlowLayer、焦点都在 **`overlay` 场景的 `procRoot`**（~1114）。粒子泄漏完全看不见。 | 增加 `overlayObjects`、`procRootChildren`、`bulkRootChildren`；故意注释掉 clearScene 里清 procRoot 的一行，回归必须失败。 |
| D2 | **P0** | `loadAndProbe` 只在 `loadScene` 抛异常时设 `error`，但 `loadScene` 自己吞掉了所有异常（~5160），所以 `error` 实际永远是 null，只能靠状态栏文字。 | `loadScene` 返回 `{ok, error, stale}`（或把最后一个错误记到 `session.errors`）；probe 返回 `errors[]`。 |
| D3 | P1 | 不统计 DOM 标签（`#procLabs`、`#labels`、`#kitLabs`、`.compLab`）、监听器、挂起 anim、池数量、`focus` 状态。 | 加上这些字段；R1 未修时“整个细胞”加载两次后 `listeners` 增长被检出。 |
| D4 | P1 | `residues` 是团块数（Cα/P 点），不是残基数（缺失、修饰残基、组装体副本都影响）；命名误导。 | 改名 `beads`；另给 `chains`、`assemblyCopies`。 |
| D5 | P2 | `fps` 在 Electron 隐藏 / 后台窗口中无意义（已设 `backgroundThrottling:false`，但未检查窗口是否可见）。 | 报告里记录 `document.visibilityState`。 |

### 2.3 回归脚本 `regress.mjs` + GLOW_REGRESS

| # | 级别 | 缺陷 | 验收 |
|---|---|---|---|
| T1 | **P0** | 判定失败只看 `/^出错/.test(status)`。组件失败（`组件 X 加载失败`，~5102）、过程失败（`过程动画初始化失败`，~5139）、自动信息失败（`console.warn`）都**报通过**。例：7CGO 的组件挂了，场景照样“通过”。 | 用 D2 的 `errors[]` 判定；人为把一个组件 id 改坏，回归失败。 |
| T2 | **P0** | 没有基线时打印“还没有基线”并以 0 退出——第一次运行永远绿。 | 无基线且未 `--accept` 时退出码 2。 |
| T3 | **P0** | 不测快速连切（第一轮 P1 的唯一验收标准）。 | 新增 rapid 用例（§5 第 2 项）。 |
| T4 | P1 | 计数器、截图记录但不比较；因为随机，也无法比较。 | 依赖 seed + 定步推进（§5 第 7 项）后进入硬比较。 |
| T5 | P1 | 全部依赖实时网络（RCSB、UniProt）。RCSB 波动 = 回归波动。 | 回归模式用 `glow_studio` 的结构缓存，缓存缺失时明确标“网络”而不是“失败”。 |
| T6 | P1 | 没有任何单元测试：`parseAtomSite`、`parsePDB`、`parseOperExpr`、`superpose`、`sanitizePack/checkAnimation`、`findChannel`。这些是“数据可信”的核心，Mol\*/NGL 都有解析器测试。 | `node --test` 跑纯函数（用 `glow-lib.mjs` 同样的抽取法）；至少：Horn 叠合对已知旋转误差 < 1e-6；`parseOperExpr('(1-3)(4,5)')` 结果正确；恶意包集合全部被拒。 |
| T7 | P2 | 截图只保存。 | 与基线截图做像素差（阈值），差异大时警告并输出对比图。 |

---

## 3. 代码缺陷清单（按严重度）

### P0：错误 / 误导 / 泄漏 / 竞态

| # | 位置 | 缺陷 | 验收 |
|---|---|---|---|
| S1 | `atpSynthase.update`（~2779）`if (fast) this.lastK = k8; else …spawnProton` | **快放时 H⁺ 计数器冻结，ATP 计数器（`synth` ~2766）继续加**。屏幕上的 H⁺/ATP 比随快放时长变得任意，而 c8 环的正确比是 8/3 ≈ 2.67。 | 快放 10 s：ΔH⁺/ΔATP = 8/3 ± 0.1；慢放同样。 |
| S2 | `respiratoryChain.releaseH`（~3007）计入 `'H⁺ 泵出'` | 复合体 III 在 Qo 位释放的 H⁺ 是 Q 循环化学释放，不是“泵”。把它和复合体 I、IV 的泵合称“泵出”是常见误解，教学软件不能强化它。 | 计数拆为“泵出（I、IV）”与“Q 循环释放（III）”；每个 NADH 的合计 = 10 且分项为 4 / 4 / 2；讲解文字同步。 |
| S3 | `PROCESSES.wholeCell.update`（~4945）`if (!this._zfL) { … controls.addEventListener('start', …) }` | 标记在实例上（`Object.create(P)`），**每次加载整个细胞都新增一个监听器**，闭包持有旧实例（2.5 万核糖体点、拥挤网格）→ 监听器 + 大块内存泄漏。 | 加载“整个细胞”3 次，`listeners` 不变，JS 堆回到 ±10%。 |
| S4 | `clearScene()`（~5713） | 不调 `clearFocus`、`clearSelection`，不清 `labels` 和 `#labels` DOM、`camFly`、`energyKey/energyFollow`、`#evid`，不调过程清理。加载期间旧标签、旧焦点标签仍在屏幕上；`sel.mats` 指向已释放材质。 | 连切用例后 `domTags`、`focus`、`selection` 回到空。 |
| S5 | `focusLigand`（~5959，过期判断 ~6012） | 只比较 `focusLigand._req`，`loadScene` 不改它 → 下载结合位点期间换场景，**旧配体的结合位点画进新场景**。 | 点配体后立刻切预设：新场景无焦点对象、无焦点标签。 |
| S6 | `clearScene` 中 `anims = []` + `travel/protonAcross/atpFromPools` 的 await | 被清掉的 anim 永不 resolve，协程挂起（泄漏闭包）；若协程里有非 anim 的 await（模板下载），会在**新场景**里继续 `makeParticle`。 | anim 带 reject；clearScene 时 reject `Stale`；连切后 `procRootChildren` = 新场景初始值。 |
| S7 | `kitFullAtom`（~5529） | 只检查 `if (!kit)`；退出再进入拆装后，旧请求写进新 kit。 | 记录 `const k = kit` 并比较。 |
| S8 | `loadScene` catch（~5160） | Stale / 失败时在 `$('load').disabled = false` 之前 return；按钮状态依赖下一次加载。 | `finally` 中按 `my === loadSeq` 恢复。 |

### P1：专业差距与工程缺陷

| # | 缺陷 | 对照 | 验收 |
|---|---|---|---|
| G1 | 无选择语言 | NGL / PyMOL / ChimeraX 都有（`:A and 10-50`、`within 5 of`） | §4.5 语法；6ZPO 上 `chain A and resi 1-50` 数量与手算一致。 |
| G2 | 无序列视图 | Mol\*、ChimeraX 标配 | 4HHB A 链序列条 141 个，缺失残基虚线。 |
| G3 | 无测量（距离 / 角度） | 全部专业工具都有 | 两个 Cα 距离误差 < 0.01 Å。 |
| G4 | 表示是全局的（`repMode`），不能按选择集 | NGL Component/Representation 分离 | `glow.represent('part alpha','simplified')` 只改 α。 |
| G5 | 无会话 / 操作记录 / 撤销 | Mol\* state tree、ChimeraX 命令日志 | `glow.log()` + `replay()` 得到相同 state。 |
| G6 | 无来源面板（方法、分辨率、物种、文献、组装体） | RCSB / Mol\* 都在首屏 | 6 个回归场景都显示方法与分辨率。 |
| G7 | 无可编程接口（只有内部 `__viewer`） | NGL / 3Dmol.js 的公开 API、ChimeraX 命令 | §4 的 `window.glow`。 |
| G8 | 表面是 Cα/P 点的低通密度等值面（`lowpassSurface` ~1333），不是分子表面 | 专业工具用 SES/SAS | 界面上称“低分辨率外形”，证据标“推算（近似）”。 |
| G9 | 无 seed / 无确定性推进 | ChimeraX、VMD 轨迹可复现 | §5 第 6、7 项。 |
| G10 | 无 AbortController；组件串行下载 | | 连切时旧请求被取消；多组件并行。 |
| G11 | `dataAnim.setup`（~6378）写全局 `SPECIES` | | 两个包同名物种不同颜色时各自正确。 |
| G12 | 性能：`preserveDrawingBuffer:true`、每帧布局读取、无自动降级 | | §5 第 12 项。 |
| G13 | 预设 id 是长中文名（同时用于 URL `?preset=`、`regress-scenes.json`、`presetCat` 正则 ~6559）。改一个字，测试、外链、所属选项卡全部悄悄改变 | 专业工具用稳定 id | 每个预设有 ascii `key` 和显式 `tier`；`presetCat` 删除正则。 |
| G14 | 两个源文件分叉；CI 规则读 `web/index.html` | | sync 后 sha256 一致才允许回归 / 发布。 |
| G15 | 死代码：`PROCESSES.ionChannel`（~3373，约 47 行）没有任何预设或官方包使用（KcsA 用 `kcsa`），却仍可被社区包引用 | | 删除，或明确作为“通用通道”文档化并有一个回归用例。 |
| G16 | 拥挤分子、膜不可拾取 / 不可命名，违背“每个粒子都有名字” | | 点拥挤分子出现名字 + PDB + 证据等级。 |
| G17 | 断链 / 缺失残基不标注（违反数据不变量） | Mol\* 用虚线标缺口 | 序列条和 3D 都标出缺口。 |
| G18 | 状态机缺失：atpSynthase、flagellarMotor、respiratoryChain、chloroplast 由动画驱动，参数只改速度 | | 每站 `observe()` 返回 `phase`；HUD 高亮当前阶段。 |

### P2：打磨

| # | 缺陷 | 验收 |
|---|---|---|
| Q1 | `kitAtomCache`（~5335）、模板缓存无上限 | LRU 40 条 |
| Q2 | 命名混用：过程 camelCase、预设中文长名、计数器键混 Unicode（`'H⁺（示意）'` 作为数据键） | 计数器 `{id, label}` 分离 |
| Q3 | skill `architecture.md` 写“约 1250 行”，严重过时；ROADMAP 回归路径错 | 文档与代码一致 |
| Q4 | 截图只能屏幕分辨率，不能出版级（Mol\*/PyMOL 可 4×） | `glow.snapshot({scale:3})` |
| Q5 | 双重转义（E9） | 见上 |

---

## 4. 开发者接口：`window.glow` + `web/dev.html`

### 4.1 结构
```
web/index.html   查看器；新增 window.glow（同页、公开、写进文档）+ postMessage 桥（仅 ?embed=1 / ?dev=1）
web/dev.html     左：JSON 编辑器 + 校验 + 命令台；右：<iframe src="index.html?embed=1">
```
- **不复制校验规则**：dev.html 调 iframe 的 `glow.validate()` = `sanitizePack` + `checkAnimation`，与 CI 的 `glow-lib.mjs loadRules` 是同一段代码。保留 `glow-lib` 依赖的两个标记（`const GLOW_FORMAT = 'glow-scene'` 和 `/* a pack -> loadScene config */`）。
- 同源部署时也可直接 `iframe.contentWindow.glow`；postMessage 用于跨源嵌入（课件）。
- 编辑器先用 `<textarea>` + 行号 + 错误跳转；可选 CodeMirror 6（jsdelivr 固定版本）。不用 Monaco。草稿存 `localStorage['glowDevDraft']`（try/catch）。
- `__viewer` 保留为内部 / 测试用；`glow` 是稳定接口，带 `api` 版本号。

### 4.2 同页 API（全部返回 Promise；失败 reject `GlowError{code, message, path?}`）

| 方法 | 参数 | 返回 / 行为 |
|---|---|---|
| `version` | — | `{ viewer, glowFormat: 1, anim: 1, api: 1 }`（属性） |
| `load(target, opts?)` | 预设 key / PDB 编号 / `{pack}` / `{scene}` / `{ws:'official/<id>'}`；`opts.seed` | 完成后 `State`；被取代 reject `code:'stale'`；失败 reject 并带 `errors[]` |
| `validate(pack)` | 对象或 JSON 文本 | `{ ok, errors:[{path,message}], warnings[], pack }`（`PackError` 增加 `path`） |
| `schema()` | — | `{ sceneKeys, processes, species, anchorKinds, categories, evidenceLevels }`，由 `SCENE_KEYS/PROCESSES/SPECIES/PACK_CATS/EVID` 生成 |
| `state()` | — | `{ scene, key, pdb, tier, parts:[{i,name,chains,beads,visible,rep,color}], ligands:[{comp,copies,visible}], process, phase, counters, camera, timeScale, paused, seed, t, selection:{expr,count}, evidence, errors }` |
| `select(expr)` | §4.5 | `{ count, parts }`；写入 `sel`；`''` 清空 |
| `color(expr, c)` | CSS 色 / `'chain'|'entity'|'rainbow'|'reset'` | `{ count }`；存 `groups[i].colorOverride` |
| `represent(expr, rep)` | `'blob'|'cartoon'|'simplified'|'surface'|'hidden'` | `{ count }`；第一版按部件 |
| `focus(target)` | 表达式或 `{ligand:'ATP', index:0}` | 部件 → `selectPart`；配体 → `focusLigand` |
| `camera(set?)` | `{az,el,dist}` | 当前相机（复用 `cameraNow/resetCamera`） |
| `animate(o)` | `{play, pause, step:dt, steps:n, timeScale, seed, process:bool}` | `{ t, counters, phase }`；`step` 走确定性推进 |
| `sim(id?, value?)` | 细胞 HUD 控件 | 读写 `cellSim.ctrl` 并同步 UI |
| `measure(a, b, c?)` | 单残基表达式 | `{distance}` 或 `{angle}`；3D 画虚线 + 数值；`measure()` 清除 |
| `snapshot(o?)` | `{scale?, format?, quality?, hideUi?}` | dataURL |
| `exportPack(meta?)` | `{title,tags,author,license,description}` | pack（含 selection、reps、ctrl、timeScale、seed、morph） |
| `probe(sec?)` | | 扩展后的 probe |
| `log()` / `replay(log)` | | 命令记录 = 简化状态树；重放 |
| `on(evt, fn)` | `'loaded'|'error'|'stale'|'select'|'phase'|'counter'` | 取消函数 |

### 4.3 postMessage 协议
- 请求 `{ glow:1, id, cmd, args:[] }` → 回复 `{ glow:1, id, ok:true, result }` / `{ glow:1, id, ok:false, error:{code,message,path} }`；事件 `{ glow:1, event, data }`。
- 安全：仅 `?embed=1|?dev=1` 时监听；`event.origin` 必须同源或在 `?origin=`（仅 https）白名单；`cmd` 白名单；参数 `structuredClone` 后进 `sanitizePack(raw,false)`；**永不 eval / new Function**；`load` 只接受预设 key、PDB 编号、包对象和工坊 `WS_BASE` 下的地址；结果只发回请求方 origin。

### 4.4 dev.html
- 工具条：新建（从当前场景 `exportPack`）· 打开 .glow · 校验 · 预览（Ctrl+Enter）· 导出 · 投稿。
- 错误列表点击跳到 `path`；校验失败时**不替换**当前预览。
- 命令台：`select chain A and resi 30-60` → `glow.select(...)`；显示 `state()` 与 `log()`；seed 输入 + 单步按钮 + 截图。
- 投稿：`exportPack` → 下载 `<id>.glow`（文件名 = id，CI 要求）→ 打开 `WS_REPO/issues/new?template=submit-scene.yml&title=<标题>`（URL 不放作者信息和包内容）→ 提示拖入文件；与 `publishHelp()`、`workshop/tools/submission.mjs` 流程一致；本地可先跑 `node workshop/tools/validate.mjs <file>`。

### 4.5 选择表达式（最小语法）
```
expr := term (('and'|'or') term)* | 'not' term | '(' expr ')'
term := 'all' | 'none' | 'part' <名|/正则/> | 'chain' <ID>[,ID] | 'resi' <n>[-m][,...] | 'resn' <ALA>
      | 'ligand' <COMP> | 'within' <Å> 'of' term | 'core' | 'hot' | 'membrane'
```
实现 `parseSel(expr) → (bead) => bool`，结果写 `sel.ids`；`within` 复用 `markHotFromLigands` 的空间网格；语法错误返回 `{code:'syntax', at}`。

---

## 5. 三个模拟器：目标与差距

共同：学专业工具的**选择语言、序列条、测量、状态记录、seed 重放、比例尺 + 时间尺度、图例、来源面板**；**不学**插件框架、体数据、命令行优先、全原子默认、几十种表示、黑底科研配色、把示意动力学包装成 MD。保留白底墨线、粒子有名、从体相来回体相、真实 PDB、证据徽章。

### 5.1 细胞（整个细胞、细胞一角）
- **教学目标**：多挤、在哪、多大、多少；µm → Å 不断档；膜两侧的含义。
- **应看到**：常驻比例尺（现在只有 wholeCell 的 `#scaleBar`）和时间尺度；区室名 + pH / 浓度；所有分子类别的图例（含数量和证据色）；点任何分子 → 名字、PDB、等级、“打开这个机器”。
- **应能做**：跳尺度（已有）；进入机器并返回；按类别隐藏；暂停 / 单步 / seed 重放。
- **差距（P 级）**：G16 拥挤分子不可拾取（P1，违反特色）；比例尺 / 时间尺度不通用（P1）；无进入 / 返回（P1）；随机摆放不可复现（P1）；细胞里大量示意内容只有一条场景级徽章（E7，P1）；S3 泄漏（P0）。
- **低于专业水平之处**：CellPACK / Mesoscope 类工具的分子摆放来自打包算法并可复现，我们是随机且不可复现。

### 5.2 局部系统（呼吸链、叶绿体、ATP 合酶、鞭毛马达、KcsA、翻译）
- **教学目标**：能量与物质怎么流、谁推动谁、改条件哪里变。
- **应看到**：带名字的粒子流（已有）；能量账本（每步 ΔG、H⁺/ATP 比实时算出且正确）；当前阶段高亮；组件摆放标“建模”。
- **应能做**：单步、seed 重放、改 pH / 抑制剂 / 底物看计数与曲线、点机器进蛋白质视图、导出含参数的包。
- **差距**：S1、S2 计数错误（P0）；G18 状态机缺失（P1）；无事件日志 / 重放（P1）；包不存控件和时间尺度（P1）。

### 5.3 蛋白质（任意 PDB、自动、拆装、构象、配体）
- **教学目标**：形状、组成、活性位点、构象变化；结构 ↔ 序列 ↔ 功能。
- **应看到**：序列条（含缺口）；来源面板；构象滑块两端写“实验结构 A / B”，中间写“线性插值”；测量线和数值；编号注明 label / author。
- **应能做**：点选 / 序列拖选 / 表达式选择；测距 / 角度；按选择集换表示；拆装（已有）；配体聚焦（已有）；操作记录与撤销。
- **差距**：G1–G6、G17（全部 P1）；S5、S7 竞态（P0）；构象插值是 Cα 线性插值，可能穿过不可能的中间态——界面上必须写“插值不是路径”（P0 若不写；当前只在证据弹窗里有）。
- **低于专业水平之处**：选择、序列、测量、会话、来源、表面质量六项都低于 Mol\*/NGL/ChimeraX，无一例外。

---

## 6. 实施清单（按顺序；每项单独可验证）

通用验收：每项完成后在 `glow_studio` 跑 `node scripts/regress.mjs` 必须“全部通过”；源头改完再 `sync.js`；完成后在 ROADMAP 打勾。

1. **[P0] 让回归脚本可信**（D1、D2、T1、T2、G14）
   `loadScene` 返回 `{ok, errors, stale}` 并记 `session.errors`；probe 增加 `overlayObjects/procRootChildren/bulkRootChildren/errors/ligandTypes/ligandCopies/beads`；`regress.mjs` 以 `errors.length` 判失败、无基线退出码 2、开头比对源头 / `app/` / `web/` 的 sha256；脚本同步到仓库 `desktop/scripts/`；跑 `--accept` 建基线。
   验收：故意弄坏一个组件 id → 失败；故意不清 procRoot → 失败；基线文件提交。

2. **[P0] 连切与残留检测**（T3、D3）
   probe 增加 `domTags/listeners/anims/pools/focus/selection`（给 `controls.addEventListener`、`window.addEventListener` 包计数）；`regress-scenes.json` 增加 `rapid` 列表（不 await 连发 5 个，含整个细胞），以及“整个细胞”连载 2 次。判定：连切结果 = 单独加载最后一个；计数不增长。
   验收：在修 S3/S4 之前此项**必须失败**。

3. **[P0] 计数器科学修正**（S1、S2）
   ATP 合酶快放也按转角累计 H⁺；呼吸链拆分“泵出（I、IV）”与“Q 循环释放（III）”，讲解文字同步；在 HUD 显示实时 H⁺/ATP。
   验收：快放 / 慢放各 10 s，H⁺/ATP = 8/3 ± 0.1；每 NADH 分项 4/4/2。

4. **[P0] 证据徽章修正**（E1–E6、E9）
   内嵌结构默认“建模”；`membranes` 归“建模”、`auto` 归“推算”并写来源；补随机大小 / 抖动 / 脂质 / 放大倍数；统一配体口径；clearScene 清徽章；`SCENE_KEYS` 加 `evidence`；去掉双重转义；构象滑块旁写“中间为线性插值”。
   验收：AlphaFold 测试包无“实验”；6ZPO“推算”里无膜；失败加载后徽章为空；含 `evidence` 的包显示条目。

5. **[P0] clearScene 补全 + 场景会话 + 竞态**（S4、S5、S7、S8）
   `session = {id, ac, disposers, errors, events}`；clearScene 补全 S4 清单；`focusLigand/kitFullAtom/showAutoCard` 比较会话 id；`finally` 恢复按钮。
   验收：第 2 项中 `focus/selection/domTags` 回到空；点配体后立刻换场景无残留。

6. **[P0] 过程生命周期**（S3、S6、G11）
   PROCESSES 可选 `dispose(ctx)`；wholeCell 监听器在 dispose 中移除；anim 带 reject，clearScene reject `Stale`；dataAnim 用局部物种表。
   验收：整个细胞加载 3 次 `listeners` 不变、堆 ±10%；同名物种不同色的两个包各自正确。

7. **[P1] seed + 确定性推进 + 事件日志**（G9、T4）
   `mulberry32(seed)` 替换过程 / 池 / 布朗路径 / Gillespie / 拥挤 / 膜 / `a.rf` 中的 `Math.random`；抽出 `simStep(dt)`，`__viewer.step(dt,n)`；`ctx.emit()` 记事件。回归改为暂停后 `step(1/60, 300)` 再比较计数器（硬比较）。
   验收：同 seed 两次 KcsA 计数完全相同；截图像素差 < 阈值。

8. **[P1] 网络取消与并行**（G10）
   `fetchText` 合并会话 signal；组件并行下载、顺序放置。
   验收：连切时旧请求状态为 canceled；7CGO 载入时间 ≤ 基线。

9. **[P1] 场景包字段补全 + 稳定 id**（G13）
   `SCENE_KEYS` 显式含 `evidence/seed/reps/ctrl/timeScale/morph/key/tier`；`packFromCurrent` 保存、`loadScene` 恢复；预设加 ascii `key` 与 `tier`，`?preset=` 和回归用 key，`presetCat` 正则删除；更新 SCHEMA.md。
   验收：导出→导入后 `glow.state()` 相同；`validate.mjs` 全过；改一个预设显示名不影响回归。

10. **[P1] 选择语言 + 按选择集表示**（G1、G4）
    `parseSel`；面板选择输入框；`groups[i].rep/colorOverride`。
    验收：§4.5 的三条样例结果正确；语法错给列号。

11. **[P1] `window.glow` 同页 API + 命令记录**（G5、G7）
    验收：`GLOW_SMOKE_JS` 依次 `load → select → color → represent → snapshot`，dataURL > 10 KB、无 page error；`replay(log())` 得到相同 `state()`。

12. **[P1] postMessage 桥 + `web/dev.html`**
    验收：粘贴官方包→校验通过→预览；把 `flows[0].rate` 改 99 → 错误定位到 `scene.animation.flows[0].rate` 且预览不变；异源消息被忽略；导出文件通过 `validate.mjs`。

13. **[P1] 序列条 + 测量 + 来源面板 + 缺口标注**（G2、G3、G6、G17）
    验收：4HHB A 链 141 个；Cα 距离误差 < 0.01 Å；6 个回归场景都显示方法 / 分辨率；缺失残基在序列条与 3D 中可见。

14. **[P1] 性能止血**（G12）
    `preserveDrawingBuffer:false`；面板矩形缓存（ResizeObserver）；标签 30 Hz；FPS 连续 4 s < 24 自动降级并提示。
    验收：各场景 FPS ≥ 基线，`worstFrameMs` 细胞一角下降；截图非黑。

15. **[P1] 通用比例尺 / 时间尺度 + 拥挤可拾取 + 三层链接 + 死代码**（G15、G16、5.1）
    `updateScaleBar()` 所有场景；过程声明 `timeScaleNote`；crowd `instanceId → {name,pdb,evidence}`；`link` 字段 + 返回栈，先打通 ATP 合酶 / KcsA / 核糖体三条；`ionChannel` 删除或补回归用例。
    验收：三条链路进入再返回后计数与直接加载一致；点拥挤分子出现名字和等级。

P2（Q1–Q5、E10、T7、D5）在以上完成后统一处理；文档（architecture.md、build_log.md、ROADMAP 路径）每项完成时同步更新。
