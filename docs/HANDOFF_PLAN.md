# 交接文档：分子光影平台的完整开发规划

> 给接手开发的 AI 智能体（或人）。这份文档把 `PLATFORM_AUDIT_REPORT.md`（方向）、`PLATFORM_ENGINEERING_SPEC.md`（工程规范）、`AUDIT_ROUND2.md`（三轮严格审计）和 `ROADMAP.md`（已完成清单）合成一份**可以直接分给多个智能体执行的工作包清单**。
> 每个工作包写明：目标、依赖、改哪些文件、交付物、验收标准。做完一个包就在第 7 节的表里打勾，并按第 8 节的格式写交付报告。维护者验收时按第 9 节逐项核对。

---

## 0. 先读这些（按顺序）

1. 本文第 1–3 节（愿景、现状、规则）。
2. `docs/PLATFORM_ENGINEERING_SPEC.md` 第 2–4 节（目标架构、数据结构、场景生命周期）。
3. `docs/AUDIT_ROUND2.md` 第 4 节（风险 R1–R16）和第 7 节（教师视角审计）——知道哪些坑已经踩过。
4. `skill/references/architecture.md` §33–§38（运动工具包、场景包、证据等级、命令接口、复审修正）。
5. `workshop/SCHEMA.md`（场景包格式）。

---

## 1. 愿景：一个平台，三种用途，四个层级

**分子光影不只是动画演示界面。** 它是一个以真实结构数据为基础的平台，同时服务三种用途：

| 用途 | 给谁 | 核心能力 |
|---|---|---|
| **教学演示**（动画） | 老师、学生 | 机制动画、每个粒子有名字、证据等级、步骤讲解、三层导航 |
| **科学研究**（结合科研软件） | 研究者、研究生 | 选择 / 测量 / 接触分析、可重现的会话、与 ChimeraX / PyMOL / Mol\* / Jupyter 互通、数据和结构导出、引用 |
| **3D 演示**（展示与传播） | 讲者、科普作者、课件制作 | 镜头书签和分镜、全屏演示模式、录屏、高清截图、嵌入网页、分享链接 |

四个层级（同一套数据模型的四种视图）：

| 层级 | 看什么 | 例子 |
|---|---|---|
| 细胞 | 环境、区室、拥挤、尺度、系统入口 | 整个大肠杆菌、细胞一角 |
| 局部系统 | 协作、方向、能量、通量 | 呼吸链、光反应、ATP 合酶、鞭毛马达 |
| 蛋白质 | 结构、配体、构象、组成 | 任意 PDB、血红蛋白、GroEL |
| 分子机理 | 一个对象在具体步骤中怎样结合、反应、转移、门控、释放 | 腺苷酸激酶磷酰基转移、KcsA 过滤器敲击、ATP 合酶催化口袋 |

**分子机理必须结合场景做**：它不是孤立的动画，而是挂在某个蛋白质或局部系统场景上的“步骤工作台”。从场景里点一个结合位点、一个辅因子或一个机器 → 打开它的机理；机理的每一步都能跳回场景里的结构证据（残基、配体、距离）。

**创意工坊是内容中心**：所有模型（内置预设、机理模板、演示分镜、科研会话）都以场景包的形式放进工坊。查看器内置的预设也从工坊目录读取（离线时用打包进去的副本）。社区作品永远只有数据，不运行代码。

---

## 2. 现状（2026-11-17）

### 2.1 仓库结构
```
web/index.html      查看器（单文件，约 7800 行）——当前唯一的源文件
web/dev.html        开发者 / AI 工作台（JSON 编辑器 + 预览 + 命令台）
desktop/            Electron 桌面版；scripts/sync.js 复制 web → app；scripts/regress.mjs 回归；regress/baseline.json 基线
skill/              教人 / AI 做场景的 skill；assets/viewer.html、assets/dev.html 是 web 的副本
workshop/           official/（15 个官方场景包 + 封面 + index.json）、community/、stats.json（评分评论）、tools/（校验、索引、导出预设、投稿、举报、讨论帖）
docs/               方向、规范、审计、路线图、本文
.github/workflows/  workshop.yml（校验 + 重建目录 + 讨论帖统计）、workshop-submission.yml、workshop-report.yml、pages.yml
```
在线版：GitHub Pages 发布 `web/` 和 `workshop/`（https://nimenta727.github.io/molecule-glow-viewer/）。桌面版：Releases 里的 `desktop-v0.3.x`。

### 2.2 已经有的（不要重做，要在上面建）
- **数据**：RCSB 下载 + 缓存、mmCIF / PDB 解析、组装体展开（固定取 1 号组装体）、CCD 键级、UniProt 特征、来源面板（方法 / 分辨率 / 物种 / 文献）。
- **表示**：团块、结构示意（螺旋 / 折叠）、简化示意 / 低分辨率表面、小分子球棍 / 价键 / 空间填充、膜、剖面、白底墨线插画风格。
- **证据等级**：`evidenceOf()` 四级徽章；每个 PROCESS 必须声明 evidence（回归检查）。
- **选择与命令**：`window.glow`（load / info / select / color / represent / camera / animate / measure / snapshot / exportPack / validatePack / sequence…），选择语言 `parseSel/evalSel`（auth 与 label 编号、拷贝 `asym C_2`、within），命令日志可重放；postMessage 嵌入桥（写死白名单 + 用户允许）。
- **模拟**：`PROCESSES`（atpSynthase、respiratoryChain、chloroplast、flagellarMotor、kcsa、translation、cellCorner、wholeCell、auto、dataAnim），运动工具包（池、布朗路径、避开蛋白、名字标签），快放粒子流，质子账本，种子 `rand()` / `randVis()`，`__viewer.step(dt,n)`，事件日志。
- **导航**：细胞 → 局部系统 → 蛋白质 “打开这个机器 / ← 返回”，返回时完整恢复状态；序列条（缺失残基虚线、UniProt 功能位点）。
- **工坊**：场景包 v1（`sanitizePack` 是唯一的校验规则，CI 从 `web/index.html` 截取同一段代码运行）、订阅、SHA-256 核对、投稿机器人（issue → PR）、举报自动暂停、讨论帖评分评论（`stats.json`）。
- **质量**：回归 9 项（6 个场景 + 连切 + 整个细胞连载两次 + 同种子可重复 + 返回导航 + 协程清理 + 桥接安全 + rRNA 长度 + 无名粒子）。

### 2.3 已知缺口（来自三轮审计和平台规范）
- 单文件太大，AI 修改上下文过大（规范 Batch G）。
- 没有独立的 `StructureModel` / `DerivedModel` / `SceneSession` / `ResourceRegistry` 类（Batch A / B）。
- 表示只能按部件切换，没有 Representation 接口、一个选择不能有多个表示（Batch C）。
- 过程仍直接操纵 Three.js 对象，没有统一 `create/step/observe/serialize/dispose` 接口（Batch D）。
- 分子机理只有分类和字段，没有步骤播放器、没有模板（Batch F）；第四个选项卡目前是空的。
- 科研功能只有选择、测距、截图、来源面板；没有接触表、导出到科研软件、会话文件、Jupyter 接口。
- 演示功能没有分镜、演示模式、录屏。
- 程序内登录 / 直接评分需要维护者创建 OAuth App 或 Supabase 项目（需要人）。
- README 第 23 行“四个平台入口”标题下其实是三种显示模式——标题和内容不符。

---

## 3. 所有工作包都要遵守的规则

1. **单一源头**：WP1 之前，`web/index.html` 是唯一源文件；WP1 之后，`src/` 是源，`web/index.html` 由构建生成，**任何人不得手改生成物**。`skill/assets/*.html`、`desktop/app/` 都是复制品。
2. **回归是门槛**：每个工作包结束前在 `desktop/` 跑 `node scripts/regress.mjs`，必须“全部通过”。只有**有意**改变内容数量时才 `--accept`，并在报告里写明原因。新功能要给回归加检查项。
3. **场景包只有数据**：社区内容永远不执行代码；新字段必须进 `sanitizePack` 的校验（带错误路径），并更新 `workshop/SCHEMA.md`；`node workshop/tools/validate.mjs` 必须全过。
4. **证据等级**：屏幕上任何非实验坐标的东西都要在 `evidenceOf()`（或机理步骤的 evidence）里有一行。
5. **教学可读性**：白底墨线风格是默认；每个粒子有名字；说明第一行是不超过约 50 字的要点；中文界面。
6. **不删除现有功能**，不复制外部项目源码（只学设计）；ChimeraX、PyMOL 只做格式互通，不嵌入代码。
7. **并行开发的文件归属**：WP1 完成前只能有一个智能体改查看器；WP1 后按第 6 节的模块归属分工，跨模块改动先在 `docs/HANDOFF_PLAN.md` 第 7 节登记。
8. **提交**：提交前 `git fetch` 并 rebase；不在仓库里写任何人的邮箱；提交信息结尾按项目惯例写协作者署名。
9. **同步**：改了查看器 → 同步 skill 副本、桌面版 `app/`，需要时出新的桌面版 Release；改了格式 → 同步 `skill/references/scene_packs.md`。
10. **开发机注意**：没有独立显卡的机器上 FPS 只作参考（回归里 FPS 只警告）。

---

## 4. 工作包（Work Packages）

> 大小：S ≈ 半天，M ≈ 1–2 天，L ≈ 3–5 天（以一个智能体连续工作估算）。

### WP0 收尾和准备（S，最先做，单人）
- 修 README：恢复“三种显示模式”小节；另加“四个层级 / 三种用途”小节，指向本文。
- `ROADMAP.md` 改为指向本文第 7 节的进度表（避免两份清单）。
- 给 CI 加一步：`skill/assets/viewer.html`、`desktop` 同步检查（与 `web/index.html` 的 sha256 一致，否则失败）。
- **验收**：README 结构正确；CI 在副本不一致时失败（故意改一个字节试一次）。

### WP1 源码拆分与构建（L，依赖 WP0，单人，**完成前其他人不能改查看器**）
- 把 `web/index.html` 按规范第 2 节拆进 `src/`（建议目录：`src/data/`、`src/derived/`、`src/sim/`、`src/repr/`、`src/view/`、`src/pack/`、`src/ui/`、`src/styles/`、`src/index.html.tpl`）。第一步只**搬移不改逻辑**。
- `tools/build.mjs`（零依赖或只用 esbuild）：打包成单文件 `web/index.html`，保留现在的 importmap / CDN 方式；`--check` 模式比较生成结果与仓库里的文件。
- `workshop/tools/glow-lib.mjs` 改为直接 import `src/pack/` 的校验代码（不再从 HTML 截取文本）。
- `desktop/scripts/sync.js`、skill 同步脚本改为调用构建。
- **验收**：构建产物与拆分前功能一致——回归全部通过且内容数量与基线完全相同；`validate.mjs` 全过；双击生成的 `web/index.html` 能用；`build.mjs --check` 在 CI 里运行。

### WP2 场景会话与资源（M，依赖 WP1）
- 实现 `SceneSession`、`ResourceRegistry`、`LoadCoordinator`（规范 §4）：几何、材质、纹理、Worker、定时器、DOM 监听、Blob URL、fetch 统一登记和释放；替换现在散落的 clearScene 逻辑（保留 clearScene 作为对 session.dispose 的包装）。
- “新场景显示出来之前旧场景不销毁”（失败时画面不消失）；低内存模式可选。
- 把全局可变状态（AUDIT R16 列出的那些）挂到 session 上。
- **验收**：回归里加“载入失败后旧场景仍在”；连切、整个细胞连载两次的资源计数不变；`probe()` 报 session 资源数。

### WP3 结构模型与统一选择（L，依赖 WP2）
- `StructureModel`（规范 §3.1：auth / label 分开、组装体拷贝保留 sourceAsym / operatorId / copyId、不引用 Mesh）和 `DerivedModel`（§3.2：每个推导结果记录算法、参数、置信度、用途）。
- 选择集成为唯一入口（规范 §6）：高亮、隐藏、换表示、拾取、口袋、接触、能量步骤、模拟锚点、教学卡全部走 Selection；补 `interface chain A with chain B`、`part "功能核心"`、命名选择集（`selectionSets`）。
- 推导结果在信息卡里显示“方法 + 阈值”（功能核心、口袋、孔道、接触、膜法线、结构域、构象角度）。
- **验收**：同一个选择集能高亮 / 隐藏 / 聚焦 / 计算接触；结构模型可以在 Node 里单独加载并通过单元测试（新建 `tests/`，`node --test`）。

### WP4 统一模拟引擎（L，依赖 WP2，可与 WP3 并行但要协调 `src/sim/`）
- `SimulationEngine` + Process 接口（规范 §8：`create/step/observe/mapEventToView/serialize/dispose`），固定步长或事件时间，渲染帧率不影响结果；`play/pause/step/reset/seek`。
- 先迁移 ATP 合酶、KcsA、翻译三个过程；其余用适配器（规范 §5.4 的 adapter）包起来。
- HUD、能量条、计数器只订阅 `observe()` 的结果。
- **验收**：三个过程在 Node 里无渲染运行并通过单元测试（同种子同结果、守恒：质子账本、8 H⁺ : 3 ATP）；浏览器里 `seek` 到第 N 个事件画面正确。

### WP5 表示系统（L，依赖 WP3）
- Representation 接口（规范 §7）：blob、cartoon、surface、molecule、sticks、membrane、particle、annotation；一个选择可以有多个表示；按链（不只按部件）。
- 统一 LOD（high / medium / low，由层级、镜头距离、实时 FPS 共同决定）和自适应降级顺序（规范 §10.2，墨线风格下像素比 ≥ 1，见 `inkPR`）。
- B 因子 / pLDDT / 疏水性 / 静电（近似）着色方案。
- **验收**：不改场景数据即可给同一选择叠加 cartoon + 半透明 surface；切换表示前后资源计数平衡；截图不黑不白。

### WP6 分子机理工作台（L，依赖 WP3 + WP4；**必须结合场景**）
- `MechanismRuntime`（规范 §5.4）：步骤条、播放 / 暂停 / 单步 / 重置 / 跳到任意步、每步证据卡（结构、残基、距离、论文）和限制说明、关键测量（距离 / 角度 / 接触 / 反应式）、可选干预（底物、抑制剂、突变、pH）、事件日志和种子。
- **入口结合场景**：蛋白质 / 局部系统场景里，点结合位点、辅因子或机器 → “查看机理”；机理里每一步 → “在结构中查看”（回到场景并选中）。第四个选项卡“分子机理”列出所有机理模板。
- 三个官方模板：
  1. 腺苷酸激酶（4AKE ⇄ 1AKE，Ap5A）：底物定位 → LID / NMP 闭合（结构域转角测量）→ 磷酰基转移（反应式）→ 打开释放。
  2. KcsA 过滤器（1K4C）：K⁺ 脱水 → 羰基氧配位（S1–S4 位点距离）→ 敲击 → 出口重新水合；对照 Na⁺ 被排斥。
  3. ATP 合酶催化口袋（6ZPO β 亚基）：开放 → 松弛（ADP + Pi）→ 紧密（合成）→ 开放（释放），挂在 ATP 合酶场景的 β 亚基上。
- `scene.mechanism` 的完整校验（带路径）和 SCHEMA 文档；dev.html 加机理模板。
- **验收**：三个模板都能从对应场景进入、逐步播放、每步跳回结构证据；社区格式的机理包能通过校验并播放；回归加一个机理场景（步骤数、每步高亮的残基数）。

### WP7 内容全部进创意工坊 + 场景包 v2（M–L，依赖 WP1；格式部分可在 WP3 期间做）
- **所有模型进工坊**：内置预设、机理模板、演示分镜、科研会话示例都是官方场景包；查看器的预设列表从工坊目录生成，离线用打包进构建产物的目录副本（`export-presets.mjs` 反过来：工坊是源）。
- 场景包 v2（规范 §9，向后兼容 v1）：`compatibility`、`provenance`、`entryPoints`、`observables`、`controls`、`camera.bookmarks`、`selectionSets`、`representations`、`mechanism`、`presentation`（见 WP9）、`session`（见 WP8）。v1 → v2 自动迁移；不支持的版本明确报错。
- 工坊界面：按四个层级 + 三种用途（教学 / 科研 / 演示）筛选；卡片显示用途和证据等级；“在机理工作台打开”“在演示模式打开”。
- 工坊目录分页 / 搜索在社区内容变多后仍然快（索引分片）。
- **验收**：删掉代码里的硬编码预设后，所有原预设仍能从工坊打开且回归不变；v1 包全部自动迁移通过；新增至少 3 个机理包、2 个演示包、1 个科研会话包。

### WP8 科研平台（L，依赖 WP3；导出部分依赖 WP5）
- **分析**：距离 / 角度 / 二面角测量；接触与氢键 / 盐桥表格（可排序、点击高亮、导出 CSV）；两个构象之间的 RMSD 和逐残基位移图；界面面积（近似 SASA，标明方法）；Ramachandran 简图（可选）。重计算放 Worker（规范 §10.3）。
- **数据源**：AlphaFold DB（按 UniProt 编号加载，pLDDT 着色、PAE 图）；本地 mmCIF / PDB；PDB-Dev / 整合模型标为“建模”。
- **与科研软件互通**（只做格式，不嵌代码）：
  - 导出当前选择 / 场景为 mmCIF、PDB；
  - 导出 ChimeraX `.cxc` 和 PyMOL `.pml` 命令脚本（复现当前结构、选择、颜色、视角）；
  - 导出 MolViewSpec（Mol\* 的场景描述格式）并提供“在 Mol\* 中打开”链接；
  - 导入 ChimeraX / PyMOL 选择表达式的常用子集（转换为我们的选择语言）。
- **可重现会话**：会话文件 = 场景包 + 命令日志 + 种子 + 结构版本（PDB 修订号 / 下载时间）+ 推导参数；“导出方法说明”自动生成一段可放进论文方法部分的文字和 BibTeX 引用（PDB 条目、原始论文、本软件）。
- **Jupyter / Python**：`python/glow_viewer/`（pip 包），在 notebook 里嵌入查看器（postMessage 桥），Python 调用 `glow.load/select/measure/snapshot`，结果回到 Python（测量值、接触表、图片）。
- **模拟数据导出**：计数器、事件日志、HUD 曲线导出 CSV / JSON。
- **验收**：在 4HHB 上导出 .cxc / .pml，在 ChimeraX / PyMOL 中打开得到相同选择和颜色（维护者手动核对一次即可）；Python 示例 notebook 能跑通 load → select → measure → snapshot；会话文件导出再导入后 `glow.info()` 完全一致。

### WP9 3D 演示平台（M–L，依赖 WP4；分镜依赖 WP7 格式）
- **镜头书签与分镜**：把“镜头 + 选择 + 表示 + 模拟时间 / 机理步骤 + 说明文字”存成一张“幻灯片”；分镜 = 幻灯片序列，平滑过渡（复用 `zoomTo` / 相机飞行）。存进场景包 `presentation` 字段。
- **演示模式**：全屏、隐藏面板、大字号说明、翻页键 / 翻页笔、演讲者备注（第二个窗口，桌面版用第二块屏幕）、激光笔高亮。
- **录制**：MediaRecorder 录 WebM（桌面版可转 MP4）；按分镜自动录制；高清截图（2×–4×，透明背景可选）。
- **分享与嵌入**：分享链接（`?ws=…&slide=3`）、嵌入代码（`?embed=1`，只读安全子集）、二维码。
- **课堂（可选，后做）**：老师端翻页、学生端同步（需要后端，见 WP10）。
- **验收**：用 ATP 合酶做一份 6 页分镜，能演示、录成视频、导出为场景包并从工坊打开播放；嵌入到一个外部测试页面只读运行。

### WP10 后端第三阶段（M，**需要维护者先创建账号**，可最后做）
- 维护者创建 GitHub OAuth App（或 Supabase 项目）并提供 client id。
- 程序内 GitHub 登录（Device Flow，桌面版和网页版）；直接点赞、评论、投稿（不必跳到 GitHub 页面）；目录仍由 CI 生成。
- 课堂同步（WP9 可选部分）的实时通道。
- **验收**：登录 → 点赞 → 6 小时内 `stats.json` 反映；没有 client id 时界面自动退回现在的“打开讨论帖”方式。

### WP11 性能（M，贯穿；集中做在 WP5 之后）
- Worker：空间索引 / 邻域、接触、孔道、大结构低分辨率表面、mmCIF 解析（规范 §10.3，任务 ID、可取消、Transferable、绑定 session）。
- 帧预算监控（模拟 ≤ 2 ms、标签 ≤ 2 ms），`probe()` 输出分项耗时；标签池、粒子池。
- 在**有独立显卡的机器**上建立第二套 FPS 基线（`regress/baseline.gpu.json`），作为硬性门槛；无显卡机器继续只警告。
- **验收**：规范 §10.1 的帧率目标在有显卡的机器上达到；7CGO、整个细胞的最差帧下降。

### WP12 文档、教学材料与测试完善（S–M，贯穿）
- 每个工作包更新 `skill/references/architecture.md`（新一节）和 `build_log.md`；`SCHEMA.md`；用户手册（`docs/USER_GUIDE.md`：教学 / 科研 / 演示三种用法各一页）。
- 回归补充：导出再导入一致、截图非黑非白、模式切换、画质切换、一个官方数据动画包、一个故意失败的社区包（规范 §11.3）。
- `node --test` 单元测试覆盖：选择语言、场景包校验、模拟守恒、v1 → v2 迁移。

---

## 5. 依赖关系与推荐顺序

```text
WP0 ─► WP1 ─► WP2 ─┬─► WP3 ─┬─► WP5 ─► WP11
                   │        ├─► WP6 (还需要 WP4)
                   │        └─► WP8
                   └─► WP4 ─┬─► WP6
                            └─► WP9
WP1 ─► WP7（格式部分可在 WP3 期间做；“预设从工坊读取”在 WP3 之后）
WP10 独立（需要维护者账号），任何时候都可以做
WP12 贯穿
```

**里程碑**
- **M1 平台地基**：WP0 + WP1 + WP2（之后才能多人并行）。
- **M2 模型与模拟**：WP3 + WP4。
- **M3 四个层级完整**：WP6 + WP5 + WP7。
- **M4 三种用途完整**：WP8 + WP9（+ WP10）。
- **M5 性能与发布**：WP11 + WP12，出桌面版 1.0。

---

## 6. 多个智能体怎么分工（WP1 之后）

| 智能体 | 负责 | 拥有的目录（只有它能改） |
|---|---|---|
| 核心 | WP2 → WP3 → WP5 → WP11 | `src/data/`、`src/derived/`、`src/repr/`、`src/view/` |
| 模拟与机理 | WP4 → WP6 | `src/sim/`、`src/mechanism/` |
| 工坊与格式 | WP7（+ WP10） | `src/pack/`、`workshop/`、`.github/workflows/workshop*.yml` |
| 科研 | WP8 | `src/research/`、`python/` |
| 演示 | WP9 | `src/present/` |
| 文档与测试 | WP12 | `docs/`、`tests/`、`skill/references/` |

- `src/ui/`、`src/index.html.tpl`、`tools/build.mjs` 是共享文件：改之前在第 7 节登记，改完立刻提交，其他人 rebase。
- 每个智能体完成一个工作包就提交一次（小步提交），不要攒大改动。
- 审计：每个里程碑结束时，另开一个**只读的审计智能体**（严格，按 P0 / P1 / P2 + 验收标准），结果追加到 `docs/AUDIT_ROUND2.md` 新的一节，再由执行智能体修。

---

## 7. 进度表（做完打勾，写上日期和提交号）

| 工作包 | 状态 | 负责 | 提交 / 日期 | 备注 |
|---|---|---|---|---|
| WP0 收尾和准备 | ☐ | | | |
| WP1 源码拆分与构建 | ☐ | | | |
| WP2 场景会话与资源 | ☐ | | | |
| WP3 结构模型与统一选择 | ☐ | | | |
| WP4 统一模拟引擎 | ☐ | | | |
| WP5 表示系统 | ☐ | | | |
| WP6 分子机理工作台 | ☐ | | | |
| WP7 内容进工坊 + 场景包 v2 | ☐ | | | |
| WP8 科研平台 | ☐ | | | |
| WP9 3D 演示平台 | ☐ | | | |
| WP10 后端第三阶段 | ☐ | | | 需要维护者创建 OAuth App / Supabase |
| WP11 性能 | ☐ | | | 需要有显卡的机器建 GPU 基线 |
| WP12 文档与测试 | ☐ | | | |

共享文件登记：

| 日期 | 智能体 | 文件 | 改动 |
|---|---|---|---|
| | | | |

---

## 8. 每个工作包的交付报告格式

写在提交说明或 PR 描述里，同时追加到 `skill/references/build_log.md`：

```text
工作包：WPx 名称
层级：cell | system | single | mechanism | 平台基础
用途：教学 | 科研 | 演示 | 基础设施
改了哪一层：data | derived | simulation | representation | view | pack | ui | performance
新增状态 / 资源，是否登记到 session 并在 dispose 里释放：
哪些数值来自结构，哪些是示意（证据等级）：
场景包格式是否变化（SCHEMA.md 是否更新）：
回归结果（粘贴最后的汇总；是否 --accept，为什么）：
validate.mjs 结果：
单元测试结果：
截图（至少一张，放 docs/images/ 或 Release 附件）：
已知限制 / 没做完的：
```

---

## 9. 维护者验收清单（做完后由我逐项核对）

**通用（每个工作包）**
- [ ] 回归全部通过；基线变更有理由。
- [ ] `validate.mjs` 全过；CI 绿色（workshop、pages）。
- [ ] 副本一致（skill、desktop、构建产物 `--check`）。
- [ ] 新的可视化都有证据等级；新粒子都有名字。
- [ ] 仓库里没有任何人的邮箱；提交信息规范。

**按工作包的重点核对**
- WP1：拆分前后同一组场景的截图逐张对比；双击 `web/index.html` 能用；CI 不再截取 HTML 文本。
- WP2：故意让一个场景载入失败，旧场景仍在；快速连切 20 次后资源计数不涨。
- WP3：在 Node 里加载 4HHB 结构模型，链 / 残基 / 配体数与查看器一致；`interface chain A with chain B` 的结果与接触分析一致。
- WP4：同种子两次运行事件日志逐条相同；质子账本守恒；Node 里无渲染跑通。
- WP5：同一选择叠加两种表示；按链换表示；低帧率降级顺序符合规范 §10.2。
- WP6：三个机理模板从场景进入、逐步播放、每步回到结构；一个社区机理包通过校验并播放。
- WP7：所有原预设从工坊打开且回归不变；v1 包自动迁移；工坊按层级和用途筛选。
- WP8：.cxc / .pml 在 ChimeraX / PyMOL 中复现（我手动核对一次）；Python notebook 跑通；会话导出再导入一致；方法说明和 BibTeX 正确。
- WP9：6 页分镜演示、录屏、嵌入只读运行。
- WP10：登录点赞流程；无 client id 时自动退回。
- WP11：有显卡机器上达到帧率目标。
- WP12：用户手册三种用法各一页；单元测试覆盖四类。

---

## 10. 给新智能体的开场提示词（可直接复制）

```text
你接手“分子光影”项目（仓库 Nimenta727/molecule-glow-viewer，本地路径 <填写>）。
先读 docs/HANDOFF_PLAN.md 第 0–3 节，再读你负责的工作包：WP<编号>。
你只拥有第 6 节表里你那一行的目录；共享文件改动先在第 7 节登记。
完成标准是该工作包的“验收”条目全部满足，并且 desktop/scripts/regress.mjs 全部通过、workshop/tools/validate.mjs 全过。
不删除现有功能；场景包只有数据；所有非实验内容要有证据等级；界面中文、白底墨线风格。
完成后按第 8 节格式写交付报告，在第 7 节进度表打勾，提交并推送（先 git fetch + rebase）。
遇到需要维护者做的事（建账号、手动核对科研软件）就写进报告，不要跳过也不要假装完成。
```
