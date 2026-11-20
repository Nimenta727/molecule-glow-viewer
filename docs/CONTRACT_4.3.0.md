# 4.3.0 资源 / 功能插件 / 作品契约与拆分设计

状态：**设计稿，§9 三点已获维护者确认；其余未实现。**核对日期 2026-11-19；代码基线 a28f6b9。本文只定义接口与迁移方式；不改任何代码，也不表示下列字段或能力已经存在。执行编号见 [ROADMAP](ROADMAP.md)，现状见 [ARCHITECTURE](ARCHITECTURE.md)。

## 0. 重点（先读这一节）

1. **不新建平行系统。** 实例 = 现有 Core 节点；资源 = 现有 Schema 的 file/external 资产加一层"身份与来源"；作品 = 现有场景文档加一个 `tools` 配置区；功能插件 = 现有 plugin-host 增加 `tools` 能力。
2. **"播放器"升级为"工具"。** 现有 player 接口（`prepare/create → advance/seek/snapshot/save/dispose`）已经是工具运行时的雏形，保留并泛化；`players` 能力作为旧名兼容。
3. **内容从代码里搬到数据里。** 现在 KcsA 里写死 `STATE_IDS`、`/potassium channel|kcsa/i`，AdK 里写死 CORE/NMP/LID 残基范围，ATP 里写死"8 个 c 亚基"。这些要变成：能力的**适用条件**（留在工具）与作品的**绑定/参数**（进数据）。
4. **旧包不能静默变静态。** 旧 process ID 通过映射表转成"工具 + 作品配置"；缺工具给出诊断并保留原文件。
5. **三个选择需要你确认**（见 §9），我已按推荐默认写入，未确认前不会据此写代码。

## 1. 复用点核对（来自真实代码）

| 契约要素 | 已有位置 | 现状 | 本设计的改动 |
|---|---|---|---|
| 资产 | `packages/schema/documents.mjs` 的 PRIMITIVE/FILE/EXTERNAL_ASSET | `additionalProperties:false`；来源只在自由 JSON 的 `provenance` | 增加可选的 `resource` 引用（§2） |
| 实例 | Core 节点 `{id,assetId,transform,extensions}` | 多个节点可引用同一 assetId；structure 插件用 `extensions['org.glow.structure']`（`sourceAssetId`,`partName`）标注 | **不新增实体**，规定其为实例 |
| 工具挂载 | `packages/plugin-host/index.mjs` | `CAPABILITIES = importers/representations/services/players/panels`；依赖需精确 x.y.z | 增加 `tools`（§3） |
| 参数声明 | 各插件 `registerPanel` 的 `PARAMETERS`（label/min/max/step/value） | 无单位、无类型、无校验函数声明 | 提升为工具参数模式（§3） |
| 作品配置 | `scene.legacy.scene`（旧包原样保留）+ `scene.presentation` | 配置与调度靠 `legacy.scene.process` 字符串 | 新增 `tools[]`（§4） |
| 调度 | `plugins/mechanism-catalog.mjs` `resolveMechanism` | 按 process 名或"AdK 两态且无 components"硬判断 | 由 legacy-compat 映射表取代（§7） |
| 状态保存 | 播放器 `save()`（KcsA 含 `schedule/seed/playbackRate`） | 保存位置依附于播放器实现 | 纳入 `tools[].state`（§5） |
| 取消/释放 | `context.signal`、`lifecycle.add`、`dispose` | 已可用，KcsA `prepare` 先暂存、全部就绪后才提交资产 | 作为所有工具的统一规则（§6） |

## 2. 资源契约（Resource）

资源是**不可变**的原始材料。同一 sha256 的字节只存一份，多个工程引用。

```jsonc
// 资源记录（resource store 中的元数据；字节在 assets/ 下，以 sha256 去重）
{
  "format": "glow-resource", "schemaVersion": 1,
  "id": "res.rcsb.6ZPO",            // 稳定 ID，与版本分开
  "version": "1",                  // 同一 ID 内容变化必须升版本；sha256 不同则必须不同 version
  "kind": "structure",             // structure | ligand | sequence | map | image
  "files": [{ "path": "assets/res/6ZPO.cif", "sha256": "…", "mediaType": "chemical/x-mmcif", "bytes": 1234567 }],
  "source": { "provider": "rcsb", "accession": "6ZPO", "retrievedAt": "2026-11-19", "assemblyId": "1" },
  "attribution": { "license": "CC0-1.0", "credit": "…", "url": "https://…" },
  "card": { "species": "…", "mutant": "…", "method": "experimental|predicted|derived", "notes": "…" }
}
```

- **场景引用方式**：file/external 资产增加可选 `resource: { id, version, sha256 }`。无该字段的旧资产继续合法，视为"未登记资源"（可在导入时补登记）。
- **不变量**：① 实例变换、分析、工具运行都不得改写资源字节；② 引用的 sha256 与实际字节不符 → 拒绝打开该资源并诊断，不"自动修复"；③ `card` 字段承接现有 `plugins/*/scientific-card.json` 与 `docs/science/structures.json` 的物种/突变体/单位信息，搬字段时不得丢失；④ 授权缺失的资源只能"引用"，不得打包离线副本。
- **离线副本策略**：作品导出时 `files` 可 `embed`（带字节，须授权允许）或 `reference`（仅 provider+accession+sha256，打开时拉取并校验哈希）。

## 3. 功能插件契约（Tool）

在 plugin-host 增加 `tools` 能力：`context.registerTool(id, descriptor)`，descriptor 由宿主校验后冻结。

```jsonc
{
  "id": "org.glow.tool.conformation", "version": "1.0.0",
  "title": "构象对应、叠合与插值",
  "inputs": {                                  // 适用条件：声明"需要什么"，不写"是哪种蛋白"
    "roles": {
      "open":   { "accepts": "structure-instance", "needs": ["residues"] },
      "closed": { "accepts": "structure-instance", "needs": ["residues"] }
    },
    "require": ["residue-correspondence>=0.8"]  // 失败即 §6 的"适用性不足"分支
  },
  "parameters": {                              // 提升自现有 PARAMETERS，补类型/单位
    "fraction": { "type": "number", "unit": "1", "min": 0, "max": 1, "step": 0.01, "default": 0 }
  },
  "outputs": { "state": ["fraction"], "observations": ["rmsd[Å]", "domainAngle[deg]", "domainShift[Å]"] },
  "model": { "kind": "geometric-interpolation", "assumptions": ["中间构象为教学插值，非动力学"], "refs": [] },
  "audience": ["view", "author"],              // 见 §10：view 工具 Viewer 与 Studio 都能挂；author 工具只挂在 Studio
  "runtime": "player-v1",                      // prepare/create/advance/seek/snapshot/save/dispose
  "dependencies": [{ "id": "org.glow.structure", "version": "1.0.0", "optional": false }]
}
```

**规则**
- 工具不得写死任何具体 accession、链名、残基范围或剧情文案；这些只来自 §4 的 `bindings` 与 `params`。
- 数学/科学模型留在工具代码里，并在 `model.assumptions` 写明适用范围（例如 KcsA 的四态门控"教学速率模型，非分子动力学"）。**工具不会退化成普通关键帧**。
- 工具通过宿主命令 `commands.dispatch` 提交可持久化数据，私有运行态只通过 `save()` 序列化（§5）。
- 现有 `players`/`panels` 注册继续有效，等价于一个没有声明 `inputs/parameters` 的"旧式工具"，用于迁移期。

**物理包划分（维护者要求：功能相近的放同一个包，不要拆散）**：一个包可以注册多个工具，包内共享算法只保留一份。按功能族只设 4 个包：

| 包（目标目录） | 包含的工具/能力 | 承接（现有代码） | 对应 ROADMAP |
|---|---|---|---|
| `plugins/structure`（扩充现有包，并入 `plugins/rcsb`） | 导入（PDB/mmCIF/RCSB）、表示、选择与序列、拆装、测量/接触/口袋/界面等分析 | 现有 structure + rcsb；经典 `selection*`、`take-apart`、`pocket/measure` | 4.4.0、4.4.7 |
| `plugins/motion` | 构象对应/叠合/插值、轴旋转、粒子/路径/流、环境（膜、拥挤） | AdK `structure.mjs`+`playback.mjs`；ATP 旋转与β插值；KcsA 的 `walk`/`transitions` 粒子代码 | 4.4.1、4.4.2、4.4.6 |
| `plugins/simulation` | 数据反应/区室网络、门控与动力学、序列/随机状态过程（共用 RNG/时钟/计量） | KcsA `kinetics.mjs`；经典 `data-anim`/`cell-kinetics`/`translation` | 4.4.3、4.4.4、4.4.5 |
| `plugins/teaching` | 字幕/步骤、证据、标签、计数/曲线/能量条、镜头书签 | 经典 `evidence`/`labels`/`energy-strip`；新版 presentation 的非核心部分 | 4.4.7 |

工具 ID 仍按能力命名（如 `org.glow.tool.conformation`），与包无关；以后包内工具增减不影响作品引用。三个旧 `org.glow.legacy-process.*` 插件在迁移期保留为薄适配层。

## 4. 作品契约（Work）

作品 = 场景文档 + `tools[]` 配置区。**不是**新文件格式。

```jsonc
// 场景文档新增的顶层字段（scene schemaVersion 3；v2 文档读取时自动无损迁移）
"tools": [{
  "id": "inst.adk.conformation",               // 作品内唯一的工具实例 ID
  "tool": { "id": "org.glow.tool.conformation", "version": "1.0.0" },   // 精确版本
  "bindings": {                                // 角色 → 场景对象，二选一表达
    "open":   { "node": "node-4ake-A" },
    "closed": { "node": "node-1ake-A" }
  },
  "selections": {                              // 域/位点：作品数据，不在工具里
    "CORE": { "ranges": [[1,29],[60,121],[160,214]], "color": "#819fc5" },
    "NMP":  { "ranges": [[30,59]], "color": "#79b29c" },
    "LID":  { "ranges": [[122,159]], "color": "#dba565" }
  },
  "params": { "fraction": 0 },
  "seed": 1,
  "state": { "schedule": [] },                // 由 save() 产生，见 §5
  "narrative": { "steps": [{ "title": "…", "caption": "…", "nodeIds": ["…"] }] }
}]
```

> **实现注记（2026-11-19，schemaVersion 3 已落地）**：上面是示意。实际的 `tools[]` 条目是 `{ id, tool: { id, version }, config, state? }`——`config` 是由**该工具自己校验**的 JSON 对象（ATP/AdK/KcsA 的配置分节见各自的 `config.mjs`），`state` 是工具 `save()` 的输出（播放时间、种子、参数历史）。`bindings/selections/params/narrative` 是 `config` 内部的分节，不是 schema 层的固定字段，这样新工具不需要改 schema。`resources[]` 在场景中携带资源记录，文件/外部资产用 `resource: { id, version, sha256 }` 引用，schema 校验引用能解析到记录且哈希一致。

- `bindings` 优先用**节点 ID**；允许"链/组件匹配规则"作为兜底（取代现在的 `/adenylate kinase/i`），解析结果必须写回 `bindings` 并产生诊断，使作品重开时不再依赖正则猜测。
- `narrative`、证据文案、能量步骤等"教学剧情"属于作品；现有 `scene.presentation.notes/navigation` 继续使用，不重复建设。
- 作品中**不允许**任何可执行内容；`tools[].tool` 只能指向宿主已注册的受信工具。

## 5. 状态归属

| 状态 | 归属者 | 持久化 | 可丢弃？ |
|---|---|---|---|
| 资源字节 | resource store | 是，不可变，按 sha256 | 否 |
| 场景/节点/变换/时间轴关键帧 | Core 文档 | 是，经事务命令，可撤销 | 否 |
| 工具配置（bindings/selections/params/seed/narrative） | 场景 `tools[]` | 是，经 Core 命令，可撤销 | 否 |
| 工具运行态（KcsA 的 `schedule/time/playbackRate`、ATP 转角…） | 工具实例 | 经 `save()` → `tools[].state` | 可重放（见下） |
| 渲染缓存/GPU 网格/粒子位置 | render-three | 否 | 是 |

**时钟规则**：演示时间（时间轴/播放头）与模拟时间（工具内部，KcsA 门控秒/渗透纳秒）分开记录；`save()` 必须带 `seed` 与参数变更历史，使同一参数序列可确定重放。不要求不同模型同种子逐事件一致。

## 6. 失败分支与统一生命周期

生命周期：`prepare(signal) → create(config) → [advance/seek/snapshot]* → save() → dispose()`。**提交前暂存，全部就绪才一次性写入场景**（沿用 KcsA `prepareKcsa` 的做法并推广）。

| 情形 | 期望行为 | 测试用例名 |
|---|---|---|
| 资源缺失/离线 | 作品可打开但该实例标缺，诊断含资源 ID 与来源，不崩溃 | `res-missing` |
| 哈希不符 | 拒绝加载该资源，诊断；原文件保留 | `res-hash-mismatch` |
| 工具未注册/版本不符 | 保留 `tools[]` 原数据不丢，面板显示"缺工具 X@v"，**不降级为静态** | `tool-missing`,`tool-version` |
| 适用性不足（如 ATP 工具遇到非 8 亚基环） | `create` 抛出带具体原因的错误；作品不被污染 | `tool-inapplicable` |
| 绑定无法解析 | 列出未解析角色；不自动猜测覆盖已存数据 | `binding-unresolved` |
| 参数越界 | 校验失败，不改状态（现有 `validateParameters` 行为） | `param-invalid` |
| 取消（signal abort） | 不留半写资产；资源/监听释放 | `prepare-abort` |
| 停用工具/换作品 | 实例全部 `dispose`；被依赖工具拒绝停用（host 已实现） | `lifecycle-release` |
| 资源/工具冲突（资产 ID 或路径冲突） | 整体回滚（KcsA/AdK 已有此检查） | `commit-atomic` |

## 7. 现有三个播放器的提取点

| 现有位置（代码事实） | 去向 | 理由 |
|---|---|---|
| KcsA `STATE_IDS=['1K4C','5VK6','5VKE','2HVK','2ITD']`；`prepareKcsa` 要求主结构为 `1K4C` | 作品 `bindings`/资源引用；"至少有 N 个构象态"成为适用条件 | 内容 |
| KcsA `/potassium channel\|kcsa/i` + "必须 4 个通道链节点" | 绑定；"n 重对称通道"为适用条件 | 内容 + 条件 |
| KcsA `kinetics.mjs`（四态、阻断、E_K、电流）及 `PARAMETERS`（pH/V/Ki/Ko/Nai/TBA/Ba/wt） | `tool.gating` 的算法与参数模式（加单位） | 有适用范围的科学模型，留在工具 |
| KcsA `occupancy`/`transitions` 表（S0–S4 位点） | 位点由结构坐标推导（`structure.mjs`）→ 工具的"位点解析器"；位点名称入 `selections` | 部分内容 |
| KcsA `STEPS`、`evidence` 文案、`membrane.radius 2.8` | `narrative`、证据卡、环境配置 | 内容 |
| AdK `DOMAINS`（CORE/NMP/LID 残基范围与颜色） | `selections` | 内容 |
| AdK `1AKE`、Ap5A 抑制剂、`partName=/adenylate kinase/i`、"RMSD>3Å 拒绝" | 资源引用 / 绑定 / 工具内的校验阈值（可由参数覆盖） | 内容 + 通用校验 |
| AdK 叠合与插值（`structure.mjs`、`playback.mjs`） | `tool.conformation` | 通用能力 |
| ATP "8 个 c 亚基"检查、β 链分组、`ATP_STEPS.parts` 正则 | 适用条件（n 重环，n 由对称检测得出，不写死 8）/ 绑定 / `narrative` | 条件 + 内容 |
| ATP 转子轴旋转与β位点插值 | `tool.rotation` + `tool.conformation` | 通用能力 |
| ATP 的 8 H⁺/3 ATP 计量 | 作品 `params`（计数语义差异保留并注明） | 内容 |
| `mechanismPlayers`/`resolveMechanism` | legacy-compat 映射表 | 见下 |

**旧 ID 兼容映射**（放在 `packages/legacy-compat`，应用持有，不由包提供）：

```
process: "atpSynthase" → { tool: rotation + conformation, work-template: atp-synthase-6ZPO }
process: "kcsa"        → { tool: gating (+particles), work-template: kcsa-1K4C }
states ["4AKE","1AKE"] 且无 components → { tool: conformation, work-template: adk-4AKE-1AKE }
```
`org.glow.legacy-process.*` 的三个现有插件 ID 在迁移期保留为薄适配层（内部转调工具），旧包与现有 145 项测试继续通过后才可移除。

## 8. 测试契约与实施顺序

**4.3.1 资源**（`packages/schema`、`plugins/rcsb`、`packages/studio-editor`）
- 导入 PDB/mmCIF/RCSB → 生成资源记录；哈希、来源、授权字段完整
- 同一资源建 ≥2 个实例，改实例变换后资源字节哈希不变
- 用例：`res-missing`、`res-hash-mismatch`、`res-dedupe`

**4.3.2 编辑/运行**（`packages/core`、`studio-editor`）
- 场景树增删/变换/撤销重做；保存重开后 `tools[]` 原样往返；v2→v3 迁移无损（以现有 v2 样例做往返）
- 固定步进/seek/重放确定性

**4.3.3 工具协议**（`packages/plugin-host`）
- `registerTool` 校验：缺字段、重复 ID、版本不符、禁止自引用依赖（沿用现有测试风格）
- 以**一个现有可复用能力**接线（建议 `tool.conformation`，源自 AdK），面板由参数声明自动生成，命令入口可调用

**4.3.4 工坊最小闭环**
- 目录条目增加 `kind: resource | work`；从资源创建作品；导出/重开；依赖诊断
- 现有 official/community 目录与投稿校验不变

**4.3 完成门槛（验证复用，不是只验证一个作品）**：同一个 `tool.conformation` 用第二个构象对重新配置，**不改插件源码**即可预览并保存重开。软件确定性可用合成夹具验证；真实第二结构对（需科学上合适）**待维护者/专业人员选定**，不能由我断言其科学有效性。

**必须保持绿的现有测试**：`packages/*/test`、`plugins/*/test` 全部（约 145 项）。

## 9. 维护者已确认的三点（2026-11-19）

1. **版本策略（已确认）**：场景 schemaVersion 升到 3，读取 v2 时自动无损迁移；v2 读取器不兼容 v3。
2. **能力命名（已确认）**：新增 `tools`，旧 `players` 保留为兼容名。
3. **物理包粒度（已确认并细化）**：功能相近的合并到同一个包，不过度拆分，按 §3 的 4 个包组织；先在现有 `plugins/` 下提取，是否再细分待 4.4 完成后看依赖。

## 10. 前端分工（维护者 2026-11-19 确认）

- **Studio（作品制作平台）**：借鉴专业分子软件（Mol\*、ChimeraX、PyMOL）的面板**结构**——场景树/对象列表 + 选中对象属性 + 按工具分块的面板。工具面板**由工具描述自动生成**（§3 的 `parameters`/`inputs`），所以新增或更新制作类工具时 Studio 无需改界面代码即可跟进。
- **Viewer（展示界面）**：只采用这类软件的**视觉风格**（紧凑密度、标题条、参数行对齐、扁平按钮）；结构保持自己的（导航/机理/步骤/播放条），不照抄。
- **工具的 `audience`**：`view` 类（表示切换、着色、选择、测量、视角、截图等）可挂在 Viewer 与 Studio，Viewer 保留这些按钮并随查看类工具更新；`author` 类（构象配置、粒子编排、反应网络编辑等）**只挂在 Studio**，Viewer 不加载、不展示。宿主按 `audience` 过滤，不靠界面代码约定。
- 画面（蛋白质）始终是主体内置的 `core.ink` 白底墨线，不随面板风格变化。
- 落地顺序：Viewer 风格改造不依赖工具协议，先做；Studio 结构改造依赖 4.3.3 的工具协议，随其落地。

## 11. 本设计**没有**做的事

不实现代码；不迁移经典 `src/`；不判断任何机制的科学正确性；不设计工坊视觉；不涉及沙箱（受信工具仍由应用内置，任意第三方插件隔离是单独验收）；不选定第二个科学结构对。

## 12. 实施进度（随实现更新）

- **ATP 样板第 1 步（2026-11-19，已完成）**：`plugins/atp-synthase/config.mjs` 把部件名选择器、环亚基数、核苷酸残基名、步骤/导航/粒子/计数标签文案、证据文字抽为带校验的作品配置，内置 `ATP_6ZPO_TEMPLATE` 复现原行为；`index.mjs` 只保留几何与计数算法。H⁺ 数量由检测到的环亚基数得出（不再写死 8）。用同一算法验证了 c10 环与另一套命名，只改配置。这是过渡形态：配置仍在插件目录内、由 `createAtpPlayer({config})` 传入；落入 `scene.tools[]`、合并进 `plugins/motion` 随 4.3.2–4.3.3 完成。
- 等价性证据：改动前代码生成的黄金输出（9 个时间点的全部快照、步骤、导航、保存状态）与默认配置逐位一致；用真实 6ZPO 重新生成的数值基线只有源码哈希变化。
- **AdK 样板（2026-11-19，已完成同样的一步）**：`plugins/adenylate-kinase/config.mjs`（`ADK_4AKE_TEMPLATE` + 校验）承接域名称/残基范围/颜色、拟合域与 RMSD 上限、链与残基数、两端结构编号、参考配体、四步文案、导航与证据文字；`structure.mjs`/`index.mjs` 只保留拟合、插值与测量。用与 AdK 无关的合成铰链蛋白（BODY/ARM、B 链、配体 LIG）只改配置就跑通，输出中不含任何 AdK 字样。
- **共享校验**：`plugins/shared/work-config.mjs` 由 ATP 与 AdK 配置共用。ATP 的“环旋转 + 位点构象插值”与 AdK 的“域拟合 + 两态插值”现在都以“配置 + 几何算法”形态存在，二者共有的“叠合/对应/插值”可在下一步合并为 `plugins/motion` 中的同一工具；合并前先对 KcsA 做同样的抽取。
- **KcsA 样板（2026-11-19，已完成同样的一步）**：`plugins/kcsa/config.mjs`（`KCSA_1K4C_TEMPLATE` + 校验）承接五个结构态的角色与编号（主结构/开放/失活/TBA/Ba）、通道链识别（名称模式、链数）、孔区叠合与轴线残基、过滤器离子、阻断剂残基名、粒子与计数标签、步骤/导航/证据文字、膜半径和**初始实验条件**（pH、电位、离子浓度等，由动力学模型的参数校验把关）。`structure.mjs`/`index.mjs` 只保留叠合、孔道搜索、位点推导和敲击循环；**门控动力学（`kinetics.mjs`）按契约保持为算法，不进配置**。缺少某个构象结构时给出明确报错。
- **三个样板的共同结论**：ATP（环旋转 + 位点构象插值）、AdK（域拟合 + 两态插值）、KcsA（多态叠合 + 孔道/位点）都已是“配置 + 几何算法”。三者共有的“结构对应 → 叠合 → 按残基位移插值构象”下一步合并为 `plugins/motion` 的同一工具；KcsA 的门控/渗透计时与阻断留给 `plugins/simulation`。
- **`plugins/motion` 第一步（2026-11-19，已完成）**：三个播放器里各写一遍的“顶点按最近锚点原子的反距离加权位移移到另一构象”合并为 `plugins/motion/conformation.mjs` 的 `displaceVertices`（连同 `nearestAnchors`、`rotationAngle`、`vectors.mjs` 的向量小工具、`path.mjs` 的 `walkPath`）；ATP（3 态 β 位点）、AdK（两态域）、KcsA（开放/失活）改为调用它。这是**纯重构**：三份黄金输出逐位一致，真实 6ZPO、4AKE/1AKE、五个 KcsA 态上的新旧位移输出逐项一致。仍是库模块，待 4.3.3 工具协议后注册为 `tools`。叠合 `superpose` 本来就在 `plugins/structure/alignment.mjs`，没有重复。
- **schemaVersion 3（2026-11-19，已完成）**：`packages/schema` 新增 v3 场景（`tools`、`resources` 必填；资产可带 `resource`）、`upgradeSceneToV3`（v2 → v3 只增不删；过渡期的 `provenance.resource` 提升为一等字段；字节缺失/哈希不符只产生诊断，不阻止打开）、`attachStructureResources`。v2 的读写与校验保持原样；v2 文档不得含 v3 字段；工程可同时包含 v2 与 v3 场景。Viewer 在载入边界升级场景，并为声明了内置机制（旧 `process` 或 AdK 两态）的场景写入完整默认配置（`plugins/mechanism-catalog.mjs` 的 `toolEntriesForScene`）；播放器从 `tools[]` 读配置和状态，导出的包携带它们。Studio 编辑 v3 场景时保留 `tools/resources/resource`（撤销/重做亦然）。
- **已知边界**：① 场景里已保存的 `presentation.navigation` 优先于配置里的导航/步骤文字（保存后的呈现归场景所有；改配置文字要同时清除或改写已保存的导航）；② 生产 v2 场景的代码（结构导入、Studio 新建、旧包迁移）仍写 v2，在 Viewer 载入时升级，尚未让它们直接写 v3；③ 工具 ID 仍是 `org.glow.legacy-process.*`，`org.glow.tool.*` 随工具协议（4.3.3）；④ `scene.dependencies` 尚未为工具条目自动登记；⑤ 导出时按 `embedAllowed` 决定是否嵌入资源字节尚未实现（授权未知的本地文件目前也会随包嵌入）。
