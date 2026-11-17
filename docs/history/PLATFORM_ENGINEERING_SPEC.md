# 分子光影查看器：平台化工程细节与实施规范

## 0. 工程目标

本规范把 `docs/PLATFORM_AUDIT_REPORT.md` 转化为可执行的工程方案。

目标不是一次性重写，而是：

1. 保留当前 `web/index.html` 的交付方式；
2. 保留现有细胞、局部系统、蛋白质和过程动画功能；
3. 逐步把单文件内部整理成稳定的模型层、模拟层、表示层和视图层；
4. 让 AI 可以在不破坏旧场景的情况下继续开发；
5. 让 `.glow` 成为可验证、可保存、可分享的场景状态格式。

---

## 1. 当前工程约束

### 1.1 交付约束

- Web 端仍需支持单个 HTML 文件；
- Electron 桌面版通过 `desktop/scripts/sync.js` 同步 Web viewer；
- `skill/assets/viewer.html` 是分发副本，不应成为第二个手工源文件；
- Three.js 版本由桌面版 vendor 和 Web importmap 共同约束；
- 外部结构数据来自 RCSB，场景包只允许数据，不允许运行社区代码。

### 1.2 不允许的重构方式

- 不直接删除旧的 `PRESETS`、`PROCESSES` 或 `.glow` 字段；
- 不把现有过程动画重写成只有视觉效果的假动画；
- 不在没有基准场景和截图回归的情况下替换整个渲染管线；
- 不把所有结构升级为原子级；
- 不把外部项目源码整段复制进本项目；
- 不在 `frame()` 里继续堆积新业务逻辑。

---

## 2. 目标运行时架构

```text
AppRuntime
├── SceneManager
│   ├── SceneSession
│   ├── LoadCoordinator
│   └── ResourceRegistry
├── DataRuntime
│   ├── StructureRepository
│   ├── RcsbClient
│   ├── CifParser
│   ├── CcdRepository
│   └── ProvenanceStore
├── DerivedRuntime
│   ├── SecondaryStructure
│   ├── SpatialIndex
│   ├── ContactAnalysis
│   ├── ChannelAnalysis
│   └── SurfaceJobs
├── SimulationRuntime
│   ├── SimulationEngine
│   ├── EventLog
│   ├── SeededRandom
│   └── ProcessRegistry
├── RepresentationRuntime
│   ├── ComponentRegistry
│   ├── BlobRepresentation
│   ├── CartoonRepresentation
│   ├── SurfaceRepresentation
│   ├── MoleculeRepresentation
│   ├── MembraneRepresentation
│   └── AnnotationRepresentation
├── ViewRuntime
│   ├── CameraController
│   ├── SelectionController
│   ├── FocusController
│   ├── HudController
│   └── QualityController
└── PackRuntime
    ├── GlowReader
    ├── GlowWriter
    ├── GlowValidator
    └── WorkshopRepository
```

另加一个面向过程的 `MechanismRuntime`，但它不应成为第四套渲染器：

```text
MechanismRuntime
├── MechanismDefinition
├── MechanismStep
├── MechanismEvidence
├── MechanismTimeline
├── MechanismIntervention
└── MechanismViewAdapter
```

第一阶段可以继续把这些对象放在 `index.html` 中，以模块前缀或对象命名空间隔离。第二阶段再移动到 `src/` 并由构建脚本生成单文件发布版。

---

## 3. 核心数据结构

### 3.1 结构模型

```js
const structure = {
  id: '6ZPO',
  title: '...',
  source: {
    kind: 'rcsb',
    urls: ['...'],
    accessedAt: '2026-11-17T00:00:00Z'
  },
  experiment: {
    method: 'EM',
    resolution: 4.0,
    organism: '...'
  },
  assemblies: [],
  entities: [],
  chains: [],
  residues: [],
  atoms: [],
  ligands: [],
  provenance: []
};
```

要求：

- 所有坐标都使用 Å；
- `auth_seq_id` 和 `label_seq_id` 分开保存；
- `auth_asym_id` 和 `label_asym_id` 分开保存；
- 组装体复制保留 `sourceAsym`、`operatorId` 和 `copyId`；
- 坐标对象不引用 Three.js Mesh；
- 结构模型可被 Worker 和测试直接使用。

### 3.2 推导模型

```js
const derived = {
  secondaryStructure: {
    source: 'deposited' | 'geometry' | 'none',
    ranges: []
  },
  membrane: {
    source: 'OPM' | 'PDBTM' | 'scan' | 'none',
    normal: [0, 1, 0],
    centre: [0, 0, 0],
    confidence: 0.0
  },
  functionalCore: [],
  pockets: [],
  channels: [],
  contacts: [],
  spatialIndex: null
};
```

每个推导结果必须记录：

- 算法名称；
- 输入结构版本；
- 参数阈值；
- 结果置信度；
- 是否用于视觉、模拟或教学说明。

### 3.3 场景模型

```js
const sceneDefinition = {
  id: 'official.atp-synthase',
  category: 'single' | 'mechanism',
  structures: [],
  components: [],
  representations: [],
  simulation: null,
  mechanism: null,
  entryPoints: [],
  teaching: {
    caption: '',
    notes: [],
    citations: [],
    caveats: []
  },
  camera: {},
  compatibility: { viewer: '>=1' }
};
```

### 3.4 视图模型

```js
const viewState = {
  representation: 'blob',
  quality: 'auto',
  illustration: false,
  cutaway: {},
  visibleComponents: new Set(),
  selection: null,
  focus: null,
  camera: {},
  labels: true,
  postprocessing: {
    ao: true,
    bloom: true,
    dof: true,
    ink: false
  }
};
```

视图状态改变不应修改结构模型。

---

## 4. 场景生命周期

### 4.1 `SceneSession`

每次加载场景创建一个 session：

```js
class SceneSession {
  constructor(id) {
    this.id = id;
    this.abort = new AbortController();
    this.resources = new ResourceRegistry();
    this.random = new SeededRandom(id);
    this.simulation = null;
    this.disposed = false;
  }

  assertLive() {
    if (this.disposed || this.abort.signal.aborted) throw new Error('stale scene session');
  }

  dispose() {
    if (this.disposed) return;
    this.abort.abort();
    this.simulation?.dispose();
    this.resources.disposeAll();
    this.disposed = true;
  }
}
```

### 4.2 资源登记

所有以下资源必须登记：

- Geometry；
- Material；
- Texture；
- RenderTarget；
- Worker；
- `setTimeout` / `setInterval`；
- DOM 事件监听；
- Three.js Object3D；
- Blob URL；
- fetch 请求。

不允许让模块私自创建无法追踪的长期资源。

### 4.3 加载流程

```text
create session
  ↓
load scene pack / preset
  ↓
fetch metadata and coordinates
  ↓
parse StructureModel
  ↓
derive membrane / SS / contacts / channels
  ↓
create SimulationState
  ↓
create representations
  ↓
create HUD and labels
  ↓
frame camera
  ↓
activate session
```

旧 session 只有在新 session 完成最小可显示阶段后才销毁，避免加载失败时画面完全消失。若内存压力过大，可采用先销毁旧 session 再加载的低内存模式。

---

## 5. 三种场景的工程实现

## 5.1 细胞场景

### 数据

```js
{
  category: 'cell',
  compartments: [
    { id: 'cytoplasm', type: 'volume', pH: 7.4 },
    { id: 'periplasm', type: 'volume', pH: 7.0 }
  ],
  membranes: [],
  anchors: [
    { id: 'ribosome', system: 'translation', position: [...] },
    { id: 'kcsa', system: 'kcsa', position: [...] }
  ],
  crowd: {
    density: 0.16,
    sources: ['4V6F', '1EQR', '1XMK']
  }
}
```

### 表示

- 细胞外壳：低面数、稳定透明度；
- 区室：体积或背景板，DoubleSide；
- 背景分子：InstancedMesh 或批量合并；
- 局部系统：可点击的系统节点；
- 气泡/粒子：按 compartment pool 管理。

### 工程底线

- 细胞背景不参与普通拾取；
- 背景分子不创建独立 DOM 标签；
- 拥挤复制必须有最大实例数；
- 距离镜头较远时切换到 billboard/低细节；
- 进入局部系统时隐藏无关背景，而不是继续渲染全部细节。

## 5.2 局部系统场景

### 数据

```js
{
  category: 'system',
  nodes: [
    { id: 'complex-I', structure: '5GUP', role: 'electron-entry' },
    { id: 'complex-III', structure: '5GUP', role: 'quinone-cycle' },
    { id: 'cyt-c', structure: '1HRC', role: 'carrier' },
    { id: 'atp-synthase', structure: '6ZPO', role: 'output' }
  ],
  edges: [
    { from: 'complex-I', to: 'complex-III', species: 'QH2' },
    { from: 'complex-III', to: 'complex-IV', species: 'cyt-c' }
  ],
  compartments: [],
  simulation: 'respiratoryChain'
}
```

### 表示

- 节点使用蛋白质表示组件；
- 边使用 process overlay；
- 系统布局与结构坐标分离；
- “真实辅因子坐标”和“系统排布位置”分别显示来源；
- 能量条和 HUD 订阅 SimulationState，而不是读取 Mesh 位置。

### 工程底线

- 节点位置不是机制数据；
- 边的方向是机制数据；
- 粒子路径必须引用节点锚点或辅因子锚点；
- 场景拼接必须保留 `modelled` / `illustrative` 证据标签。

## 5.3 蛋白质场景

### 数据

```js
{
  category: 'single',
  structure: '6ZPO',
  selections: {
    catalytic: 'within 8 of ligand ATP',
    rotor: 'entity "subunit gamma"',
    membrane: 'entity "subunit C1"'
  },
  representations: [
    { selection: 'rotor', type: 'blob', detail: 'high' },
    { selection: 'scaffold', type: 'surface', opacity: 0.42 }
  ],
  simulation: 'atpSynthase'
}
```

### 工程底线

- 选择集是唯一的高亮、隐藏、聚焦和计算入口；
- 表示组件不负责解析结构；
- 结构变换只改变 DerivedModel 或 SimulationState；
- Mesh 只是状态的渲染结果；
- 口袋、界面、孔道等重计算不可阻塞 UI。

## 5.4 分子机理平台

### 目标

分子机理平台以一个小分子、一个活性位点、一个金属/辅因子中心或一个蛋白质局部结构为主角。它复用蛋白质场景的 `StructureModel` 和 Representation，但使用独立的步骤、证据和干预模型。

### 机理定义

```js
const mechanism = {
  id: 'adenylate-kinase-transfer',
  target: {
    selection: 'within 8 of ligand AP5',
    ligand: 'AP5'
  },
  steps: [
    {
      id: 'bind',
      title: '底物定位',
      state: { conformation: 'open' },
      highlights: ['within 4 of ligand AP5'],
      events: ['ligand-enter'],
      evidence: ['4AKE', '1AKE'],
      caveats: ['进入路径为教学示意']
    },
    {
      id: 'close',
      title: 'LID 闭合',
      state: { conformation: 'closed' },
      highlights: ['part LID'],
      measurement: { type: 'domain-angle', reference: 'CORE' }
    },
    {
      id: 'transfer',
      title: '磷酰基转移',
      reaction: 'ATP + AMP -> ADP + ADP',
      highlights: ['catalytic-residues'],
      evidence: ['mechanism-paper']
    }
  ],
  controls: [
    { id: 'pH', type: 'range', min: 5, max: 10, value: 7 },
    { id: 'inhibitor', type: 'select', options: ['none', 'AP5'] }
  ],
  evidence: {
    experimental: ['结构坐标和配体来自 PDB'],
    derived: ['接触和角度由坐标计算'],
    modelled: ['状态之间使用结构叠合'],
    illustrative: ['时间和进入路径用于教学']
  }
};
```

### 必须具备的交互

- 步骤条和当前步骤；
- 播放、暂停、单步、重置；
- 从步骤跳到残基/配体/结构；
- 当前步骤的证据和限制说明；
- 关键距离、角度、接触和反应式；
- 可选的底物、抑制剂、突变或环境参数；
- 事件日志和固定 seed。

### 与现有过程的关系

现有 `PROCESSES` 不删除。迁移时采用适配器：

```js
const adapter = {
  create: (ctx, params, seed) => legacyProcess.setup(ctx, params, seed),
  step: (state, dt) => legacyProcess.update(state.ctx, dt),
  observe: (state) => state.ctx,
  mapEventToView: (event, view) => legacyView(event, view),
  dispose: (state) => state.stop?.()
};
```

新的分子机理场景优先使用数据定义；只有需要复杂内置模型时才注册受信任的内置过程。

### 机理场景与场景包

`glow-scene` v1 继续兼容。新增的 `mechanism` 类别和 `scene.mechanism` 字段只允许数据：

- `target`：目标配体、残基或局部结构；
- `steps`：步骤、状态、选择集、事件和证据；
- `controls`：环境或干预参数；
- `measurements`：距离、角度、计数和能量；
- `caveats`：示意和不确定性。

社区机理包不得上传执行代码。复杂行为必须由查看器内置的安全机制解释器支持。

---

## 6. 统一选择集

### 6.1 选择集接口

```js
const selection = select({
  chain: 'A',
  residues: [[70, 90]],
  within: { distance: 8, of: { ligand: 'ATP' } }
});

selection.indices();
selection.label();
selection.toJSON();
```

最低支持：

- `chain A`；
- `entity "subunit beta"`；
- `residue 159`；
- `residue 70-90`；
- `ligand ATP`；
- `within 8 of ligand ATP`；
- `interface chain A with chain B`；
- `part "功能核心"`。

### 6.2 选择集用途

同一个 Selection 必须可用于：

- 高亮；
- 隐藏；
- 换表示；
- 拾取；
- 口袋计算；
- 接触分析；
- 能量步骤；
- 模拟锚点；
- 教学卡片。

这会把 Mol* / NGL 的专业结构操作方式引入本项目，同时保持本项目自己的场景和画风。

---

## 7. 统一表示系统

### 7.1 Representation 接口

```js
const representation = {
  id: 'beta-detail',
  selection,
  type: 'blob',
  params: {
    color: 'chemical',
    detail: 'high',
    opacity: 1
  },
  build(model, session) {},
  update(changes) {},
  dispose() {}
};
```

### 7.2 必须支持的表示

- `blob`：当前团块；
- `cartoon`：螺旋、折叠和核酸；
- `surface`：低分辨率密度/分子表面；
- `molecule`：CCD 小分子；
- `sticks`：局部原子和界面；
- `membrane`：脂双层；
- `particle`：模拟粒子；
- `annotation`：标签、引线和说明。

### 7.3 细节级别

```text
high:
  residue/atom detail, full labels when selected
medium:
  instanced residues, reduced surface, limited labels
low:
  domain/part shape, no expensive postprocessing
```

LOD 由场景层级、镜头距离和实时 FPS 共同决定，不只由 GPU 字符串决定。

---

## 8. 统一模拟引擎

### 8.1 Process 接口

```js
const process = {
  id: 'kcsa',

  create({ model, params, seed }) {
    return {
      time: 0,
      state: 'closed',
      counters: {},
      events: [],
      rng: seed
    };
  },

  step(state, dt) {
    return {
      state,
      events: [],
      observables: {}
    };
  },

  observe(state) {
    return {
      hud: {},
      caption: '',
      energyStage: 0
    };
  },

  mapEventToView(event, view) {},
  serialize(state) {},
  dispose(state) {}
};
```

### 8.2 时间和重放

模拟引擎至少支持：

- `play`；
- `pause`；
- `step`；
- `reset`；
- `seek`（事件日志模式）；
- 固定 seed；
- 导出事件日志。

渲染帧率不能决定模拟结果。模拟使用自己的固定步长或事件时间，渲染只负责把当前状态显示出来。

### 8.3 两类模拟

#### A. 连续/近似动力学

适合：

- pH；
- 膜电位；
- ATP/NADPH；
- 区室浓度；
- 电子流相对速率。

要求：

- 固定积分步长；
- 状态上下限；
- 参数单位；
- 稳态和异常状态测试。

#### B. 离散事件模拟

适合：

- 核糖体结合、校对、转位；
- KcsA 单离子通过；
- 配体结合/解离；
- 粒子流和反应。

要求：

- 事件名称；
- 速率或概率；
- 随机 seed；
- 事件日志；
- 阻塞动画与逻辑事件的清晰关系。

---

## 9. `.glow` 场景包升级规范

当前格式继续兼容 `glow-scene v1`。后续增加字段必须向后兼容：

```json
{
  "format": "glow-scene",
  "version": 2,
  "id": "official.atp-synthase",
  "category": "single",
  "compatibility": { "viewer": ">=1.1" },
  "provenance": {
    "structures": [
      { "pdb": "6ZPO", "role": "main", "evidence": "experimental" }
    ],
    "derived": [
      { "name": "functional-core", "method": "distance", "threshold": 8, "evidence": "derived" }
    ]
  },
  "entryPoints": [
    { "id": "catalytic-site", "selection": "within 8 of ligand ATP" }
  ],
  "observables": [
    { "id": "atp", "label": "ATP 生成", "unit": "events" }
  ],
  "controls": [
    { "id": "speed", "type": "range", "min": 0, "max": 3, "unit": "display" }
  ]
}
```

### 9.1 版本策略

- 查看器支持读取旧版本；
- 新字段缺失时使用安全默认值；
- 新版本场景不能静默降级成错误结果；
- 校验器必须指出“不支持的版本”和“降级字段”；
- 导出时记录查看器版本。

### 9.2 社区安全

保持当前原则：

- 社区包只有 JSON 数据；
- 不执行社区 JavaScript；
- 限制结构文本大小；
- 限制 species、flows、reactions、via 点数；
- 所有 HTML 文字转义；
- PDB、URL、license 和 author 字段严格校验。

---

## 10. 性能工程规范

### 10.1 帧预算

目标设备上：

| 场景 | 目标 |
|---|---:|
| 单蛋白高质量 | 60 FPS |
| 复合体/局部系统 | 30 FPS |
| 整个细胞 | 24–30 FPS |
| 软件渲染 | 可交互，不要求高质量 |

单帧建议预算：

```text
simulation update       ≤ 2 ms
derived/animation apply ≤ 3 ms
labels/HUD              ≤ 2 ms
render + postprocess    ≤ remaining budget
```

### 10.2 自适应降级顺序

当 FPS 低于阈值时：

1. 降低像素比；
2. 关闭 DOF；
3. 降低 Bloom；
4. 关闭 AO；
5. 降低 Ink 采样；
6. 减少标签；
7. 降低表面分辨率；
8. 从 residue 级切到 domain/part 级；
9. 降低背景拥挤实例数。

必须保留：

- 当前被选中的结构；
- 功能核心；
- 当前过程粒子；
- 关键 HUD；
- 相机交互。

### 10.3 Worker 优先级

第一批 Worker：

1. 口袋表面；
2. 空间索引和邻域搜索；
3. 接触/界面分析；
4. 孔道搜索；
5. 大结构低分辨率表面；
6. mmCIF 解析（结构足够大时）。

Worker 任务必须：

- 有任务 ID；
- 可取消或忽略过期结果；
- 使用 Transferable；
- 返回错误而不是静默空结果；
- 与 SceneSession 绑定。

### 10.4 渲染资源

禁止：

- 每个残基一个独立 Mesh；
- 每帧重新创建 Geometry；
- 每帧重新创建材质；
- 每帧新增 DOM 标签；
- 旧场景 Worker 继续运行。

必须：

- InstancedMesh；
- Geometry/Material 缓存；
- 统一 dispose；
- 标签池；
- 粒子池；
- 资源计数器。

---

## 11. 专业性和可验证性

### 11.1 结构来源卡

每个结构场景应能查看：

- PDB ID；
- 标题；
- 实验方法；
- 分辨率；
- 物种；
- 链/实体；
- 配体；
- 原始论文；
- 下载时间；
- 当前使用的 assembly。

### 11.2 推导说明

对以下结果显示方法和阈值：

- 功能核心；
- 口袋；
- 孔道；
- 接触；
- 膜法线；
- 结构域；
- 构象角度；
- 模拟路径。

### 11.3 回归测试

固定场景：

- 4HHB：单蛋白；
- 6ZPO：ATP 合酶；
- 1K4C：KcsA；
- 4V6F：核糖体；
- 7CGO：大型多组件；
- cell-corner：双模拟；
- whole-cell：细胞尺度；
- 一个官方 `.glow` 数据动画；
- 一个社区格式校验失败的 `.glow`。

每次改动验证：

1. 能否加载；
2. 结构数是否正确；
3. 关键部件是否存在；
4. 5 秒计数是否变化；
5. 暂停/单步是否有效；
6. 画质切换是否有效；
7. 模式切换是否有效；
8. 场景切换后旧对象是否停止；
9. 导出再导入是否保持场景；
10. 截图是否没有全黑、全白、闪烁或主体消失。

---

## 12. 实施批次

### Batch A：只加基础设施，不改视觉

- `SceneSession`；
- `ResourceRegistry`；
- `AbortController`；
- GPU/FPS/对象/请求统计；
- 固定回归场景；
- 当前 `.glow` 校验增强。

验收：旧功能表现不变，快速切换不会串场。

### Batch B：抽取结构和选择

- `StructureModel`；
- `DerivedModel`；
- `Selection`；
- 把点击、功能核心、配体聚焦、界面和能量高亮改成选择集。

验收：同一个选择集可以高亮、隐藏、聚焦和计算。

### Batch C：表示层统一

- `Representation` 接口；
- blob/cartoon/surface/molecule/membrane/particle 适配；
- 统一 LOD；
- 统一 dispose。

验收：不改场景数据即可切换多个表示。

### Batch D：模拟层统一

- `SimulationEngine`；
- 固定步长/事件日志；
- seed；
- pause/step/reset；
- 过程 HUD 订阅状态。

验收：ATP 合酶、KcsA、translation 至少三个过程使用同一接口。

### Batch E：三层导航

- cell → system；
- system → protein；
- protein → binding site；
- 返回时恢复状态。

验收：细胞一角可以进入核糖体或 KcsA，蛋白质视图可以返回局部系统。

### Batch F：分子机理工作台

- 增加 `mechanism` 场景类别；
- 增加步骤条、单步、时间轴和证据卡；
- 将腺苷酸激酶、KcsA 过滤器、ATP 合酶催化口袋各做一个机理模板；
- 复用 Selection、Representation 和 SimulationEngine；
- 先实现数据驱动步骤，再适配复杂内置过程。

验收：一个小分子机理场景可以从结合到反应逐步播放，并能点击每一步回到结构证据。

### Batch G：构建拆分

- 逐步把 `index.html` 内部代码迁移到 `src/`；
- 使用构建脚本生成 Web 单文件；
- 同步桌面和 Skill 副本；
- 保留发布产物的单文件体验。

验收：开发源代码可测试，发布仍可双击打开。

---

## 13. AI 执行模板

以后给 AI 的开发任务应采用：

```text
目标层级：cell | system | single
任务类型：data | derived | simulation | representation | ui | performance
保留功能：列出不能改变的现有功能
结构依据：PDB/论文/数据库来源
证据等级：experimental | derived | modelled | illustrative
影响范围：哪些预设和场景会受影响
验收场景：至少一个小、一个大、一个模拟场景
验证方式：状态、计数、FPS、截图、资源释放
```

AI 完成后必须回答：

- 改了哪一层；
- 是否引入新状态；
- 是否引入新资源；
- 是否需要 dispose；
- 哪些数值来自结构；
- 哪些部分是示意；
- 哪些旧场景已验证；
- 是否需要更新 `.glow` schema 或说明文档。

---

## 14. 最终工程原则

1. 结构数据不依赖渲染器；
2. 模拟状态不依赖 DOM；
3. 表示组件不负责科学推导；
4. UI 只修改状态，不直接操纵底层数据；
5. Worker 结果必须可取消、可验证、可追溯；
6. 场景包只描述数据和操作，不运行代码；
7. 细胞、局部系统和蛋白质是同一模型的三个视图；
8. 所有复杂视觉效果都必须有降级路径；
9. 所有科学说明都要标记证据等级；
10. 先稳住生命周期、状态和测试，再继续增加视觉或模拟功能。

**平台的专业性来自稳定的数据模型、可重现的状态、清楚的证据和一致的呈现，而不只是功能数量。**
