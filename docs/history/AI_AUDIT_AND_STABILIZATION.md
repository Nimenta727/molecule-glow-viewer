# 分子光影查看器：面向 AI 的纠偏与稳基审计

> 本文是本项目后续开发的约束文件。任何 AI 在修改代码、增加预设、增加模拟站或调整画面之前，都应先读本文，再读 `skill/references/architecture.md`、`skill/references/parameters.md` 和 `skill/references/troubleshooting.md`。

## 0. 一句话定义

**分子光影查看器不是普通的 PDB 浏览器，也不是视频播放器；它是一个以真实结构数据为锚点、用可核对的状态机表达机制的生物分子模拟器。**

项目的核心输出不是“漂亮的分子画面”，而是：

1. 用户能看懂一个**细胞尺度**的系统如何工作；
2. 用户能进入一个**局部系统**，看到多个分子机器如何协同；
3. 用户能进入一个**蛋白质或复合体**，看到结构、配体、构象和机制之间的关系；
4. 所有画面都能区分：哪些来自结构数据，哪些是计算推导，哪些只是教学示意。

已有功能不删除。后续工作以**稳定、可验证、可解释、可扩展**为优先级，而不是继续扩大功能清单。

---

## 1. 纠偏结论

### 1.1 当前项目的问题不是功能少，而是边界不清

仓库已经包含：

- 团块、结构示意、功能分区简化；
- 小分子、结合位点、相互作用和构象变化；
- ATP 合酶、鞭毛马达、KcsA、核糖体、呼吸链、光反应；
- 细胞区室、整个细胞、局部组合场景；
- 拆装亚基、膜、孔道、标注、教学卡片和 Skill。

这些功能本身不应删除。但它们目前都依附在一个大型单文件查看器上，导致：

- 渲染、结构解析、模拟、UI 和预设相互耦合；
- 新功能容易改变旧场景的行为；
- 科学事实、坐标推导和视觉夸张混在同一套对象里；
- 性能问题只能通过继续加参数缓解；
- 没有稳定的模型层和场景状态层，AI 很容易“局部修好、整体破坏”。

### 1.2 项目的正确定位

项目应明确分成三个主要模拟场景：

| 场景 | 关注的问题 | 主要尺度 | 典型输出 |
|---|---|---:|---|
| **细胞** | 区室、拥挤、浓度、方向性、多个系统的整体关系 | μm → nm | 细胞内环境、膜、局部系统入口 |
| **局部系统** | 多个分子机器之间的协作和通量 | 100 nm → nm | 呼吸链、光反应、细胞一角 |
| **蛋白质** | 单个蛋白/复合体的结构、配体、构象和机制 | nm → Å | ATP 合酶、KcsA、核糖体、任意 PDB |

这三类不是三个独立产品，而是同一个模型的三个视图。用户应能从细胞进入局部系统，再进入蛋白质；也能从一个蛋白返回它所在的系统。

### 1.3 当前最重要的非目标

在基础稳定前，**不要**：

- 继续无边界地添加新的大型模拟站；
- 为每个新场景复制一套自定义渲染逻辑；
- 把所有分子都提升到原子级；
- 把示意路径包装成精确动力学；
- 为了“专业”直接拷贝 Mol*、NGL、ChimeraX 或 3Dmol.js 的大量代码；
- 在没有回归验证的情况下重写 `web/index.html`；
- 删除旧预设、旧过程或旧 UI 以换取架构整洁。

---

## 2. 必须保持的项目不变量

任何修改都必须满足以下不变量：

### 2.1 数据不变量

- 坐标单位统一为 Å；时间单位必须明确是模拟时间还是展示时间。
- PDB/mmCIF 的作者编号、label 编号、链 ID 不得混用。
- 结构数据、CCD 理想构型、UniProt 功能说明、膜注释必须记录来源。
- 缺失坐标、替代构象、低分辨率和推断结果不能静默伪装成实验事实。
- 所有外部结构引用都必须保留 PDB 编号和原始论文入口。

### 2.2 视觉不变量

- 视觉放大可以存在，但必须在 UI 或说明中可辨识。
- 小分子位置、电子/质子路径、组件拼接和细胞拥挤度若为示意，必须标记为“示意”。
- “简化”只能减少视觉复杂度，不得改变用户对功能部件、方向和相互作用的基本判断。
- 剖开、描边、透明度、Bloom、景深不得造成结构闪烁、消失或把配体隐藏。

### 2.3 模拟不变量

- 每个模拟站必须有显式状态机，而不是只移动物体。
- 模拟必须有可核对的 HUD 数值、计数器或状态变化。
- 参数改变必须影响状态机的速率、概率或状态转换，不得只改变标签。
- 每个模拟站要说明：输入、状态、速率/规则、输出、哪些部分是示意。
- 随机过程必须可选用固定 seed 重放，便于测试和截图回归。

### 2.4 工程不变量

- `web/index.html` 仍是网页版源头；桌面版通过同步脚本使用它。
- 不得独立修改 `skill/assets/viewer.html` 作为第二个源代码。
- 新功能必须能关闭；关闭后应恢复稳定的基础结构查看。
- 加载新场景时，旧场景不得残留对象、动画、Worker、事件监听器或定时器。
- 所有几何体、材质、纹理、Worker 和缓存都必须有生命周期。

---

## 3. 目标架构：不推倒重来，先建立边界

当前单文件可以保留作为发布入口，但内部必须逐步形成以下概念边界：

```text
SceneDefinition       预设：结构来源、部件、相机、教学说明、模拟注册名
        ↓
StructureModel        结构数据：实体、链、残基、原子、配体、组装体、来源
        ↓
DerivedModel          推导数据：二级结构、膜方向、孔道、功能核心、表面、接触
        ↓
SimulationState       状态机：状态、参数、事件、速率、计数、随机种子
        ↓
RepresentationState   表示：团块、cartoon、表面、配体、膜、粒子、标注
        ↓
ViewState             相机、选择集、焦点、面板、显示模式、画质
        ↓
Renderer               Three.js 场景、材质、后处理、帧循环
```

### 3.1 三个状态必须分开

#### A. 结构状态 `StructureModel`

只描述“这个结构是什么”：

- entry、assembly、entity、chain、residue、atom；
- 坐标和作者编号；
- 配体、键级、CCD 模板；
- 实验方法、分辨率、来源 URL；
- 结构之间的对应关系。

结构状态不能包含 DOM 元素、Three.js Mesh 或动画计数器。

#### B. 模拟状态 `SimulationState`

只描述“系统现在处于什么状态”：

- 门控、结合、转位、构象、浓度、膜电位；
- 事件队列和随机数；
- 速率、输入参数、药物/抑制剂；
- 计数器和可观测输出。

模拟状态不能直接操作 DOM。它只能产生结构变换、粒子事件和 HUD 数据。

#### C. 表示/视图状态 `ViewState`

只描述“如何显示”：

- representation：blob/cartoon/surface；
- 画质、后处理、剖开、透明度；
- 选择、焦点、标签；
- 相机和视图偏移。

这样可以让同一个模拟状态在细胞、局部系统和蛋白质三种视图中复用。

### 3.2 推荐的内部模块边界

未来可以从单文件中的代码段逐步抽离为：

```text
src/
  core/
    types.js              结构、场景、模拟的共享数据形状
    lifecycle.js          场景销毁、资源登记、AbortController
    random.js              可重放随机数
  data/
    rcsb-client.js         RCSB / CCD / UniProt 请求和缓存
    cif-parser.js          mmCIF/PDB 解析
    structure-model.js     实体、链、残基、配体、组装体
    provenance.js          来源、证据等级、免责声明
  derived/
    secondary-structure.js
    membrane.js
    pocket.js
    channel.js
    contacts.js
    surface-worker.js
  simulation/
    engine.js               时间、事件、随机种子、暂停/重放
    compartments.js
    machines.js
    processes/
      atp-synthase.js
      translation.js
      kcsa.js
  representation/
    blob.js
    cartoon.js
    surface.js
    ligand.js
    membrane.js
    particles.js
    labels.js
  renderer/
    scene.js
    passes.js
    quality.js
    picking.js
  ui/
    controls.js
    hud.js
    teaching-card.js
  scenes/
    presets.js
    scene-registry.js
```

第一阶段不要求立刻拆成多文件。可以先在 `index.html` 中按上述边界加命名空间和接口，再逐步移动实现。

---

## 4. 三层模拟场景的设计标准

### 4.1 细胞场景

细胞场景不是把很多蛋白随机塞进一个球。它必须至少定义：

- 细胞边界和区室；
- 膜的方向与两侧含义；
- 局部系统的空间锚点；
- 分子拥挤的密度参数；
- 可见的浓度、pH、膜电位或通量；
- 从全景进入局部系统的镜头关系。

细胞场景中的背景大分子允许是粗粒化或重复实例，但必须标注为背景近似，不得暗示每一个分子都处于真实原位坐标。

### 4.2 局部系统场景

局部系统场景的核心是**协作关系**，不是把多个 PDB 排成一排：

- 每个机器必须有角色和输入/输出；
- 机器之间必须有明确的电子、质子、代谢物或信息流；
- 流程必须有方向；
- 组合位置、间距、朝向若不是原位结构，必须标记为示意；
- 局部系统应能进入某个蛋白质的详细视图。

### 4.3 蛋白质场景

蛋白质场景的核心是**结构—功能映射**：

- 结构实体和部件可选择；
- 关键残基、配体和界面可查询；
- 构象变化有对应结构或明确的插值规则；
- 结合位点、通道和接触关系可以追溯到坐标；
- 简化表示与原子/残基表示可以相互切换；
- 任意 PDB 的自动分析必须显示“识别方法”和“可信度”。

---

## 5. 专业性建设：借鉴什么，不照搬什么

### 5.1 Mol*：借鉴数据模型和表示架构

Mol* 是最值得参考的结构化方向。它的价值不只是画得专业，而是把大型分子可视化拆成：

- 结构数据模型；
- 选择/查询；
- 表示层；
- 状态树和可序列化操作；
- 大数据和体数据处理；
- 可扩展插件/行为。

本项目应借鉴：

1. **结构层级**：model → chain/entity → residue → atom；
2. **选择集**：把“点选部件”“点选残基”“配体附近 8 Å”统一成选择表达式；
3. **表示层**：同一选择集可以生成 blob、cartoon、surface、sticks 等不同表示；
4. **状态序列化**：场景可以保存为结构来源 + 表示参数 + 相机 + 模拟参数；
5. **状态操作**：选择、隐藏、聚焦、换表示应是可记录操作，而不是散落的 DOM 回调。

不要直接复制 Mol* 的大型插件框架。当前项目需要的是一个面向三层模拟场景的最小状态系统。

参考：

- https://github.com/molstar/molstar
- https://molstar.org/

### 5.2 NGL：借鉴轻量表示、选择和轨迹思路

NGL 的优势是面向 Web 的轻量 API 和成熟的分子表示。它支持 mmCIF/PDB、多种 representation、选择语言、轨迹动画、拾取和图片导出。

本项目应借鉴：

1. **Selection API**：例如 `chain A`、`residue 159`、`within 8 of ligand`；
2. **Component / Representation 分离**：一个结构组件可以同时拥有多个表示；
3. **轨迹/构象接口**：构象帧和动画时间轴不能和渲染帧绑定；
4. **导出边界**：截图、场景、选择集都使用稳定 API，而不是读取 UI 当前状态。

本项目不需要照搬 NGL 的所有 representation，但应把现有 `groups[]`、`ligGroups[]`、`focus` 和 `sel` 逐步统一为组件与选择集。

参考：

- https://github.com/nglviewer/ngl
- https://nglviewer.org/ngl/

### 5.3 3Dmol.js：借鉴 Worker、SceneState 和轻量工程化

3Dmol.js 的源码结构很适合本项目借鉴，尤其是：

- `GLModel`、`GLViewer`、`SceneState` 的分工；
- `ProteinSurface4` 表面生成；
- `SurfaceWorker.js` 将重计算移出主线程；
- parser、WebGL 绘制、标签、颜色和导出分层。

本项目应优先采用类似原则：

1. 表面生成、体数据、空间邻域搜索都应可放入 Worker；
2. 场景状态必须可以保存和恢复；
3. WebGL 对象创建和结构数据处理不能互相调用；
4. 视觉表示要有统一的销毁接口。

参考：

- https://github.com/3dmol/3Dmol.js/tree/master/src

### 5.4 ChimeraX：借鉴专业工作流，不直接移植代码

ChimeraX 的专业感来自：

- 可追溯的模型和会话；
- 命令式操作；
- 可扩展 bundle；
- Python/C++ 分工；
- 对结构分析、测量、选择、保存和恢复的重视。

本项目应借鉴“每个操作都能解释、重放和保存”的思想，例如：

```text
load 6ZPO
select ligand ATP
focus binding-site
show representation cartoon
set process atp-synthase
set parameter proton-gradient 120
```

但不应在未确认许可和依赖边界前复制 ChimeraX 代码。ChimeraX 文档明确存在非商业使用许可说明，必须逐项检查许可证。

参考：

- https://www.cgl.ucsf.edu/chimerax/
- https://chimerax.readthedocs.io/en/latest/

---

## 6. 稳定地基的优先改造顺序

### P0：先建立可观测性和回归基线

在改变架构前，建立固定测试场景：

| 场景 | 目的 |
|---|---|
| 4HHB | 小型单蛋白、基础解析 |
| 6ZPO | 配体、膜、转子、构象和过程 |
| 1K4C | 通道、膜、孔道和离子 |
| 4V6F | 大型复合体、核酸、局部系统 |
| 7CGO | 多组件、复制、长丝和高负载 |
| 细胞一角 | 两个模拟站同时运行 |

每个场景记录：

- 加载成功/失败；
- 结构实体数、残基数、配体数；
- 初始和稳定 FPS；
- 内存/几何体/材质数量；
- 5 秒内模拟计数；
- 切换显示模式、暂停、重载、退出后的资源数量；
- 截图和关键 HUD 文本。

### P1：生命周期和取消加载

必须优先实现：

- `SceneSession`：每次加载拥有独立 session；
- `AbortController`：新加载真正取消旧请求；
- `ResourceRegistry`：登记并统一释放 Mesh、Geometry、Material、Texture、Worker、事件和 timer；
- `SimulationEngine.stop()`：停止状态机、粒子、动画队列和随机源；
- `clearScene()` 的资源审计。

验收：连续快速切换 20 次预设后，画面只剩最后一个场景，控制台无旧场景更新，资源数量不持续增长。

### P2：性能预算和自适应画质

建立明确预算，而不是只提供“低/中/高”：

| 项目 | 目标 |
|---|---:|
| 普通蛋白交互帧率 | ≥ 60 FPS |
| 大型复合体交互帧率 | ≥ 30 FPS |
| 无独显/软件渲染 | 能操作，不要求高画质 |
| 主线程单帧结构计算 | ≤ 8 ms |
| UI/标签更新 | ≤ 30 Hz |
| 后处理 | 可独立关闭 |
| 场景切换后旧资源 | 0 个继续更新 |

技术措施：

- 默认关闭 `preserveDrawingBuffer`，截图时采用专用路径；
- 根据实际 FPS 动态调整像素比和后处理；
- AO、景深、Bloom、Ink、颗粒分级降级；
- 标签和 HUD 不在每个渲染帧强制触发布局；
- 大型结构使用 LOD、实例化、抽样和可见性裁剪；
- 表面、接触、孔道、空间索引放进 Worker；
- 不为每个残基创建独立 Mesh。

### P3：统一结构数据和选择集

先不改变画面，建立统一对象：

```js
StructureModel {
  entry,
  assemblies,
  entities,
  chains,
  residues,
  atoms,
  ligands,
  provenance
}

Selection {
  scope: 'structure' | 'simulation',
  expression,
  indices,
  source
}
```

现有功能逐步改为使用 Selection：

- 部件点击；
- 残基点击；
- 配体附近残基；
- 功能核心；
- 拆装界面；
- 能量步骤高亮；
- 孔道过滤器；
- 过程动画涉及的结构。

### P4：统一模拟引擎

所有模拟站都使用同一个最小接口：

```js
const process = {
  id: 'kcsa',
  create(ctx, params, seed) => state,
  step(state, dt) => events,
  observe(state) => hud,
  applyEvent(state, event) => state,
  explain(state, event) => teachingText,
  dispose(state) {}
};
```

要求：

- `step` 不直接改 DOM；
- `observe` 返回可显示数据；
- `events` 可记录和重放；
- `seed` 可固定；
- 视觉动画只消费事件和状态；
- 过程说明必须区分“机制规则”和“视觉路径”。

---

## 7. 科学可信度分层

每个场景、过程和标签都应有证据等级：

| 等级 | 含义 | UI 表达 |
|---|---|---|
| `experimental` | 直接来自 PDB、CCD 或数据库注释 | 实验结构/数据库 |
| `derived` | 从坐标计算出的方向、接触、表面、孔道或构象 | 坐标推导 |
| `modelled` | 根据多个结构、对齐或规则生成 | 模型 |
| `illustrative` | 为教学而放大、拼接、加速或简化 | 示意 |

例如：

- Cα 位置：`experimental`；
- 结合位点残基：`derived`；
- ATP 位置按 ADP 位置推断：`modelled`；
- 质子沿一条发光路径移动：`illustrative`；
- 两个真实 PDB 拼成一个局部系统：可能是 `modelled + illustrative`。

说明文字不能只写“真实模拟”。更准确的模板是：

> 结构坐标来自 6ZPO；关键残基和接触由坐标计算；转子角度按预设机制规则推进；粒子路径和时间尺度为教学示意，不代表定量动力学。

---

## 8. 场景定义应该数据化

未来预设应接近以下形式，而不是把逻辑散落在 UI 和过程代码中：

```js
{
  id: 'atp-synthase',
  tier: 'protein',
  structures: [
    { id: '6ZPO', role: 'main', assembly: true }
  ],
  parts: [
    { id: 'c-ring', match: 'subunit C1', role: 'rotor', representation: 'detail' },
    { id: 'beta', match: 'subunit beta', role: 'catalytic', representation: 'detail' },
    { id: 'alpha', match: 'subunit alpha', role: 'scaffold', representation: 'simplified' }
  ],
  simulation: 'atp-synthase',
  teaching: {
    caption: '...',
    evidence: [...],
    caveats: [...]
  },
  camera: {...}
}
```

同一个 `simulation` 可以被蛋白质场景、局部系统场景或细胞场景引用，只改变观察尺度和周围环境。

---

## 9. AI 修改协议

后续 AI 每次改代码必须按以下顺序：

1. 判断任务属于：数据、推导、表示、模拟、UI、性能或发布；
2. 找到对应模块和现有先例，不重新发明接口；
3. 说明是否会影响三种场景；
4. 先写/更新最小回归测试或验证脚本；
5. 实现后验证至少一个小场景、一个大场景和一个模拟站；
6. 检查是否残留 Worker、timer、监听器、Mesh 或旧场景状态；
7. 检查说明文字是否准确标注证据等级；
8. 不因局部问题删除现有功能；
9. 不把“无控制台报错”当作视觉验证；
10. 最终记录：改了什么、验证了什么、哪些仍是示意。

禁止的 AI 行为：

- 直接把新的几百行逻辑塞进 `frame()`；
- 在 `update()` 中直接创建大量 DOM 或 Geometry；
- 用 `catch {}` 把科学数据错误变成空场景；
- 为了通过截图测试而隐藏结构、关闭模拟或伪造计数；
- 未查结构来源就凭记忆写 PDB、链名、残基编号；
- 复制外部项目代码而不检查许可证和归属。

---

## 10. 第一批实际任务

建议按以下顺序执行，不要同时开多个大重构：

### Sprint 1：稳态基线

- 增加六个固定场景的加载/截图/计数回归；
- 增加资源计数和场景 session；
- 增加加载取消；
- 记录真实 GPU、FPS、内存和请求数量；
- 保留现有视觉和功能。

### Sprint 2：性能止血

- `preserveDrawingBuffer` 改为按需；
- 标签/HUD 限频；
- 后处理按实时 FPS 降级；
- 表面和接触计算 Worker 化；
- 大结构增加 LOD/抽样预算。

### Sprint 3：结构与选择

- 引入 `StructureModel`；
- 引入 `Selection`；
- 将部件、残基、核心、配体焦点统一到选择集；
- 增加结构来源和证据等级。

### Sprint 4：模拟引擎

- 把 `PROCESSES` 迁移到统一 `create/step/observe/dispose`；
- 加 seed、事件日志和暂停/重放；
- 保留 ATP 合酶、KcsA、translation、呼吸链和叶绿体现有过程。

### Sprint 5：场景包和三层导航

- 定义可保存的场景状态；
- 细胞 → 局部系统 → 蛋白质之间建立导航；
- 先为 ATP 合酶、KcsA、核糖体做完整的三层链路；
- 再把其它预设迁移过去。

---

## 11. 完成标准

基础稳定不是“代码拆成多个文件”，而是达到以下结果：

- 旧功能仍然存在；
- 快速切换场景不会串场或泄漏；
- 同一结构可以在三种尺度下观察；
- 模拟可以暂停、重放、解释和复现实验结果；
- 结构事实、坐标推导、模型和示意明确区分；
- 大结构在目标硬件上达到可用帧率；
- 新增一个模拟站只需要注册状态机、表示映射和教学说明；
- AI 可以根据本文在不猜测隐含规则的情况下继续开发；
- 场景、参数、选择、相机和模拟状态可以保存和恢复。

**最终方向：**保留现在的视觉特色和全部已有能力，但把底层变成“结构模型 + 推导层 + 可重放模拟引擎 + 多表示渲染器 + 三层场景导航”。这比继续增加功能数量更能提高项目的专业性和生命力。

---

## 12. 外部参考

- Mol*：https://github.com/molstar/molstar
- NGL Viewer：https://github.com/nglviewer/ngl
- 3Dmol.js：https://github.com/3dmol/3Dmol.js
- ChimeraX：https://www.cgl.ucsf.edu/chimerax/
- ChimeraX Programming Manual：https://chimerax.readthedocs.io/en/latest/
- RCSB PDB： https://www.rcsb.org/

外部项目只用于学习架构和算法边界。任何代码移植前必须重新检查许可证、版权声明、依赖许可证和本项目 Apache-2.0 的兼容性。
