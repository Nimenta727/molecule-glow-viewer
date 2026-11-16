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

## 5A. 初版实施清单（按顺序；每项单独可验证；执行者已完成一部分，见第 6 节复审）

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

---

## 6. 复审（执行后）

> 对象：`glow_viewer/index.html` 快照 7275 行、`glow_viewer/dev.html` 237 行、`glow_studio/main.js`、`scripts/regress.mjs`、`regress-scenes.json`、`regress/baseline.json`（09:11）。只读审计，按函数名定位。
> **已核实成立**：`preserveDrawingBuffer:false`；`clearScene` 补全（焦点、选择、标签、证据、测量、`proc.dispose`）；wholeCell 监听器在 `dispose` 中移除；`netAC` 中断 RCSB / UniProt 下载；ATP 合酶快放按转角计 H⁺；呼吸链拆成“泵出（I/IV）”与“Q 循环释放”两个计数；证据徽章 E1–E6、E9 已修；`probe` 统计 overlay / DOM / 监听器 / errors；回归按 `errors[]` 判失败、无基线时退出码 2、有连切用例；`parseSel/evalSel`、`measure`；比例尺 + 时间说明 + 来源行；FPS 自动降级。
> **仍有问题**：
> - 桥接安全与代码注释相反：注释说只接受嵌入时的父窗口，实际任何父窗口都接受。
> - 呼吸链画面上的物质不守恒。
> - seed 没覆盖全部随机源，`step()` 的确定性从未被测试。
> - 回归基线接受了“翻译 8 秒 0 个肽键”。
> - dev.html 的 AI 说明与证据制度矛盾。
> - 选择语言混用了 label 链名和作者残基号。

### 6.1 安全（postMessage 桥、`glow.load`）

| # | 级别 | 位置 | 问题 | 修法 | 验收 |
|---|---|---|---|---|---|
| X1 | **P0** | 文件末尾 `addEventListener('message', …)` | 注释写“只接受 ?embed=1 时的父窗口或同源”，实际**监听器永远开启**，`fromParent` 也不检查父窗口的 origin。任何网站都能把 GitHub Pages 上的查看器嵌进 iframe，然后调用 `load({url})`（让用户的浏览器去拉任意 https 地址）、`snapshot`、`exportPack`。 | 只在 `embed=1` 或 `dev=1` 时注册监听；父窗口的 origin 必须等于 `location.origin`，或在 `?origin=` 白名单里（只收 https，精确匹配）；其余一律忽略。 | 异源页面嵌入（不带 embed）后发 `help`：无回复。带 embed 但 origin 不在白名单：无回复。同源 dev.html：正常。 |
| X2 | P1 | `GLOW_CMDS.load` 的 `url` 分支 | 接受任意 `https://`；非 RCSB 地址的请求不挂 `netAC`，无法取消；内容进入 `cache` Map 后永不释放。 | 只允许 `WS_BASE`、`files.rcsb.org`、`alphafold.ebi.ac.uk`；嵌入模式下其他地址直接拒绝；请求挂会话的 signal；`url` 下载的内容不进缓存。 | `load({url:'https://example.com/x.cif'})` 返回 `url-not-allowed`。 |
| X3 | P1 | `load` 的 `ws` 分支 → `shopAction('open')` | `shopAction` 吞掉异常，所以下载失败时 `load` 返回 `{cancelled:true, reason:'被新的加载取代'}`，失败被报成了“被取代”。 | `shopAction` 在 API 路径下抛出异常；`load` 区分 `cancelled` 和 `failed`。 | 断网时 `load({ws:…})` reject，消息含“下载失败”。 |
| X4 | P2 | `load('xx')` | 走 `presetKey` 的模糊包含匹配，`load('a')` 会打开某个随机预设。 | API 只接受精确 key，不匹配就报错并列出可用 key。 | `load('a')` reject。 |
| X5 | P2 | `glowQueue` | 没有超时，一条挂住的命令会堵死后面所有命令。 | 每条命令 180 s 超时，超时后队列继续。 | 人为挂起一条命令后，下一条在超时后照常执行。 |
| X6 | ✅ | — | 全文没有 eval / new Function；包都经过 `sanitizePack(raw,false)`；`pvLine` 用 `escT`；dev.html 全部 `esc`，并核对 `e.source`。 | — | — |

### 6.2 科学正确性

| # | 级别 | 位置 | 问题 | 修法 | 验收 |
|---|---|---|---|---|---|
| C1 | **P0** | `respiratoryChain.cycle` | 一个循环 = 1 NADH = 2 e⁻。画面上**只有 1 个 QH₂ 到 Qo，却放出 4 个 H⁺**（一个 QH₂ 只带 2 个 H）；**细胞色素 c 只跑 1 趟**（标签写“带 1 个 e⁻”），复合体 IV 却按 2 e⁻ 泵 2 个 H⁺、消耗半个 O₂。计数器的数字（4 + 4 + 2 = 10）是对的，但画面和计数对不上，学生数粒子会得到错的化学计量。 | 每个 NADH：Qo 依次氧化 2 个 QH₂；Qi 处 1 个 Q 拿 2 e⁻ 和 2 个基质 H⁺ 变成 QH₂；细胞色素 c 跑 2 趟，每趟 1 e⁻；复合体 IV 每收 1 e⁻ 泵 1 个 H⁺、消耗 1 个基质 H⁺。 | 用 `step` 推进 1 个循环后，`events` 里：Qo 氧化 = 2，Qi 还原 = 1，cyt c 运送 = 2，泵出 = 6，Q 循环释放 = 4，基质 H⁺ 消耗 = 4。 |
| C2 | **P0** | `respiratoryChain.update`（`kH/kA` 由 `theta` 决定） | ATP 产量只跟转速滑块走，和 NADH 没有耦合。HUD 把两个数并排显示，学生会把它读成 P/O 比，而这个比值可以是任意数。 | 让转子由“返回的 H⁺”驱动（每 8 个 H⁺ 转一圈）；或者在 HUD 写明“理论 ATP/NADH ≈ 2.7（10 ÷ (8/3 + 1)）；当前转速由滑块决定，属示意”。 | 默认参数下模拟 120 s，ATP/NADH 在 2.4–3.0 之间；或 HUD 出现上述说明。 |
| C3 | **P0** | 呼吸链快放 | 快放时不调用 `cycle()`，`lastH/lastA` 直接追平。结果 NADH、H⁺、ATP 三个计数全部冻结，而粒子流还在跑。 | 快放时按流量累计计数（与 dataAnim 的 `x.acc` 做法相同）。 | 快放 10 s，三个计数都在增长，比例与慢放相差不超过 10 %。 |
| C4 | P1 | `atpSynthase` 快放 | H⁺ 按转角计，ATP 按位点状态计，两者有相位差，短时间读数偏低（基线：ATP 2、H⁺ 5，比值 2.5）。 | HUD 写明“整圈比 8 H⁺ : 3 ATP（牛 c8 环）”。 | 跑满 10 圈后比值为 2.67 ± 0.1。 |
| C5 | P1 | `evidenceOf` | 包里只要写了 `structure.source.pdb` 就归入“实验”，但这只是作者的声明，查看器没核对。 | 写成“包里声明来源，查看器未核对”；可选：下载该条目的 Cα 做比对，RMSD < 0.5 Å 才去掉“未核对”。 | 声明了错误 PDB 的测试包显示“未核对”。 |
| C6 | P1 | `evidenceOf` | KcsA、翻译的速率常数来自文献，却只写“计数器只是示意”，把建模内容说低了；自动模式的孔道（推算）没有列出；`/示意/.test(caption)` 这个启发式还在。 | 每个 PROCESSES 必须自带 `evidence`，缺了回归就失败；删掉 caption 启发式。 | 翻译场景的“建模”里出现文献速率；auto 场景的“推算”里出现孔道。 |
| C7 | P1 | `SEL_HELP`、`evalSel`、`resLabel`、动画 `residue` 锚点 | `chain` 用的是 label_asym_id，`resi` 用的是作者编号，**两套编号混在一个表达式里**，违反不变量 2.1。4V6F、7CGO 这类条目的 label 链名和论文里的作者链名不同，同一表达式会选错或选空。 | 默认 `chain` = auth_asym_id，`resi` = auth_seq_id；另外提供 `label_asym` / `label_seq`；显示一律用作者编号并注明。 | 在 label 和 auth 链名不同的条目上，`chain <作者链名>` 能正确选中；有测试覆盖。 |
| C8 | P2 | `evalSel` 的 `num` | 作者号为 0 的残基会退回 label 号；插入码（如 52A）被并到 52。 | 用 `Number.isFinite` 判断；支持 `resi 52A`。 | 含 0 号残基或插入码的条目选择正确。 |
| C9 | P1 | `regress/baseline.json` | 基线把“4V6F 翻译和细胞一角 8 秒内肽键 0”当正常，无法区分“慢”和“坏了”。4V6F 改用 1 号组装体后直接重新 accept（53 实体 / 55 链 / 10600 残基），没有独立核对。 | 用 seed + `step` 推进到固定模拟时间，断言肽键 ≥ 1、K⁺ 外流 ≥ 1、ATP ≥ 3；另外单独断言 16S ≈ 1500 nt、23S ≈ 2900 nt、5S ≈ 120 nt。 | 让翻译站 `update` 提前返回，回归失败。 |

### 6.3 随机种子与确定性

| # | 级别 | 位置 | 问题 | 修法 | 验收 |
|---|---|---|---|---|---|
| R1 | P1 | `wholeCell.setup`（拟核 DNA，`randomDirection()`） | `randomDirection()` 内部用的是 `Math.random`，不受 seed 控制。`grep Math.random` 搜不到，不等于全部覆盖了。 | 写 `randDir()` 基于 `rand()`，替换所有 `randomDirection()`。 | 同 seed 加载两次，DNA 折线的顶点完全一致。 |
| R2 | P1 | 全局只有一个 `rand` | 视觉代码（脂质排布、团块大小）和模拟共用同一个随机流：用户中途切一次画风，后面的模拟序列就整体错开。 | 拆成 `randSim` 和 `randVis` 两个流，都由 seed 派生。 | 同 seed 下，中途切画风与不切，`step` 300 步后的计数相同。 |
| R3 | P1 | `__viewer.step` | 只挂在 `__viewer` 上，`glow` API 和 postMessage 调不到；加载后的 settle 阶段在 step 之前已经消耗了随机数；回归从未调用 step。 | 提供 `glow.animate({seed, step, steps})`；带 seed 时场景以暂停状态开始；回归增加“同 seed 跑两次”的比较。 | KcsA、ATP 合酶各跑两次，`counters` 和 `events` 完全相等。 |
| R4 | P2 | `glow.log` | 日志不记录 seed，重放不可复现。 | `load` 时记录实际用的 `randSeed`。 | `replay` 后 step 的结果与原会话一致。 |

### 6.4 泄漏与竞态

| # | 级别 | 位置 | 问题 | 修法 | 验收 |
|---|---|---|---|---|---|
| L1 | **P0** | `clearScene` 的 `anims = []` | 原计划的 S6 没有做：被丢弃的动画 Promise 永远不 resolve，协程挂起并持有旧场景的对象，每切一次场景积累一批。 | 每个 anim 保存 `reject`；`clearScene` 里统一 `reject(new Stale())`；协程吞掉 Stale。 | `rapid` 之后 `pendingAnims = 0`；连切 20 次后 JS 堆变化在 ±10 % 内。 |
| L2 | P1 | `cache` Map、`kitAtomCache` | 都没有上限，内存只增不减。 | 按字节做 LRU，上限 200 MB。 | 6 个场景轮流加载 3 轮，第 3 轮的堆不超过第 1 轮 + 15 %。 |
| L3 | P1 | `listenerCount` | `removeEventListener` 不管有没有加过都减一，可能掩盖泄漏；只统计 `controls` 和 `window`。 | 用 WeakMap 记录真正加上的监听器，只在命中时减；把 `document` 和画布也算进来。 | 移除一个从未添加的监听器，计数不变。 |
| L4 | P1 | `showAutoCard` 里的 setTimeout | 回调不检查场景是否已经换了，旧场景的配体按钮可能加到新卡片上。 | 回调里先比较 `current === cfg`。 | 两个 auto 场景快速切换后，配体按钮只属于第二个。 |
| L5 | P1 | `for (const comp of cfg.components)` | 组件仍然串行下载（原计划的并行没做）。 | `Promise.allSettled` 并行下载，再按原顺序放置。 | 呼吸链载入时间比基线短；`rapid` 结果不变。 |
| L6 | P2 | 桌面版 `handleHttps` | 中断信号能否传到 `net.fetch` 没验证；磁盘缓存没有上限。 | 透传 `req.signal`；缓存上限 2 GB。 | 连切时旧请求显示为 canceled。 |

### 6.5 dev.html

| # | 级别 | 问题 | 修法 | 验收 |
|---|---|---|---|---|
| V1 | **P0** | “给 AI 的说明”写“粒子数量和速度是示意，请在 caption 里说明”，和证据制度相反；也完全没提 `evidence` 字段和 `structure.source.pdb`。AI 照做写出来的示意内容进不了徽章。 | 在说明里加入 `evidence` 并给示例；删掉“在 caption 里说明”；模板里也加上 `evidence.illustrative`。 | 新会话按说明写一个包，打开后徽章“示意”里有作者写的条目。 |
| V2 | P1 | 血红蛋白模板写“每个血红素结合一个 O₂”，但动画只有 `{ligand:'HEM', index:0}`，**只有一个血红素在结合**；4HHB 是脱氧态，模板没说明。 | 改成 `{ligands:'HEM'}` 覆盖全部 4 个位点；caption 写明“脱氧态，结合过程为示意”。 | 预览中 4 个血红素都有 O₂ 进出。 |
| V3 | P1 | 说明缺了这些：内置过程名、`seed`、`orient.up`、flows 的 `stoich/tIn/tVia/tOut/free/max`、`hold`、各字段上限、编号约定（见 C7），以及“先 validatePack → load → info”的自检流程。 | 说明的字段部分由 `glow.help()` 的 schema 自动生成，手写部分只保留风格和证据规则。 | 用脚本比对：说明里的字段与 `sanitizePack`、`checkAnimation` 一一对应。 |
| V4 | P1 | 校验错误不带 `path`，不能跳到对应行（这一项未做）。 | `PackError` 带 `path`；dev.html 把 path 映射到行号，点击跳行。 | 把 `flows[0].rate` 改成 99，错误显示该 path 并跳到那一行。 |
| V5 | P2 | iframe 默认加载 `pdb=1K4C`，和左边编辑器里的血红蛋白模板对不上，新用户会困惑。 | 默认预览编辑器里的草稿。 | 首次打开时，左右两边是同一个场景。 |
| V6 | P2 | 页面上看不到当前选择、seed、是否暂停，也没有单步按钮。 | 加一个状态条，加“单步”按钮和 seed 输入框。 | — |

### 6.6 白底墨线风格与可读性

| # | 级别 | 问题 | 修法 | 验收 |
|---|---|---|---|---|
| W1 | P1 | FPS 自动降级会把画质降到 low（像素比 0.6），**插画模式的墨线变粗变糊**；降级后不会回升，还会带到后面的场景。 | 插画模式下像素比不低于 1，先关掉抖动等效果；每加载一个场景恢复用户原来的画质；FPS 持续 > 50 时升回一级。 | 降级后的截图墨线和正常时一致；切到 4HHB 后画质恢复。 |
| W2 | P2 | 比例尺说明文字透明度 0.85、字号 11 px，对比度只是刚好够；也没说明长度是按“旋转中心处”算的。 | 不透明度改为 1；文案加“（旋转中心处）”。 | 对比度 ≥ 4.5:1。 |
| W3 | P2 | 选中配体时的橙色半透明球不做深度测试，会盖住配体本身。 | 改成墨色描边环。 | 选中 `ligand HEM` 后仍能看清血红素。 |
| W4 | ✅ | 测量虚线在插画模式用墨色。 | — | — |

### 6.7 回归脚本

| # | 级别 | 问题 | 修法 | 验收 |
|---|---|---|---|---|
| T8 | P1 | 还没有 sha256 源头一致性检查；`regress.mjs` 仍不在仓库的 `desktop/scripts/` 里。 | 按初版清单第 1 项做。 | 改 `web/index.html` 一个字节，回归失败。 |
| T9 | P1 | `rapid` 列表里没有“整个细胞”，也没有“整个细胞加载两次”的用例，wholeCell 监听器的修复没有回归保护。 | 加入这两个用例。 | 注释掉 `wholeCell.dispose` 后，回归失败。 |
| T10 | P2 | 页面控制台报错只算警告。 | 改为失败（允许白名单）。 | 人为 `console.error` 一次，回归失败。 |

### 6.8 下一轮执行清单（按顺序；每项完成后 `node scripts/regress.mjs` 全过）

1. **[P0] 桥接安全**：X1，加上 X2、X3。
2. **[P0] 挂起的 anim 以 Stale 拒绝**：L1；`probe` 增加 `pendingAnims`。
3. **[P0] 呼吸链物质守恒、快放计数、ATP/NADH 耦合或明示**：C1–C3，用 `step` 和 `events` 断言验收。
4. **[P0] AI 说明与模板**：V1、V2。
5. **[P1] 随机覆盖与确定性测试**：R1–R4、C9（含翻译“活动性”断言和 4V6F 组装体核对）、T9。
6. **[P1] 校验错误路径**：V4，`PackError.path` 从校验一路传到 dev.html 跳行。
7. **[P1] 编号约定**：C7、C8。
8. **[P1] 稳定 ASCII 预设 key**：每个预设加 `key` 和 `tier`；`?preset=`、`regress-scenes.json`、`glow.load` 改用 key（旧中文名保留一版作别名）；删掉 `presetCat` 的正则。验收：改一个预设的显示名，回归和外链都不受影响。
9. **[P1] 组件并行下载**：L5；同时做 L2、L3、L4。
10. **[P1] 证据补全**：C5、C6；信息卡逐个对象显示证据等级。
11. **[P1] 序列条（含缺口标记）**：每条链一行，按二级结构着色；缺失残基画虚线，3D 中对应断点也用虚线相连；点击 / 拖选与 `glow.select` 双向联动。验收：4HHB 的 A 链为 141 个；一个有缺口的条目，缺口位置与 RCSB 序列视图一致。
12. **[P1] 按选择集设置表示**：`glow.represent(expr, 'blob'|'cartoon'|'simplified'|'surface'|'hidden')`，按链生效。验收：`represent('chain A','cartoon')` 只改 A 链；导出再导入后保持不变。
13. **[P1] 细胞 → 局部系统 → 蛋白质链接 + 返回按钮**：预设和拥挤分子加 `link:<key>`；信息卡上有“打开这个机器”；标题栏有“← 返回”，返回时恢复相机和时间尺度。先打通 ATP 合酶、KcsA、核糖体三条。验收：每条链路进入再返回后，计数与直接加载一致。
14. **[P1] 拥挤分子可点选、有名字**：记录 `instanceId → {name, pdb, evidence}`，`pickAt` 支持拾取。验收：在细胞一角点任意一个背景分子，都能看到名字、PDB 编号和“位置为示意”。
15. **[P1] 插画模式的降级策略**（W1）+ **回归补强**（T8、T10）。
16. **[P2]** X4、X5、L6、V5、V6、W2、W3、C4 的文案、C8。
