# Molecule Glow Platform 2.0：架构重组与后续实施计划

> **状态**：总体产品方向已确认；本文作为下一阶段架构与实施规划，具体 API 与格式须在对应 ADR 和原型验证后冻结。  
> **日期**：2026-11-17  
> **目标仓库**：Nimenta727/molecule-glow-viewer  
> **原则**：保留已有功能与科学内容，通过分阶段迁移完成平台化，不采取一次性推倒重写。  
> **关联文档**：[现有开发总纲](DEVELOPMENT_FRAMEWORK.md)、[源码说明](../src/README.md)、[场景包 v1](../workshop/SCHEMA.md)、[桌面端说明](../desktop/README.md)。

## 0. 执行摘要

Molecule Glow 当前已有 Web/Electron 查看器、RCSB 结构加载、多种分子表示、机制动画与简化模拟、开发者命令接口、.glow v1 场景包、GitHub 工坊和基本回归工具。下一阶段主要问题不再是“继续叠加多少功能”，而是**把现有功能重组为可维护、可替换、可扩展的产品平台**。

确定的产品方向：

1. **Glow Core / Glow Viewer**：领域无关的最小三维运行时和基础查看器，不内置蛋白预设库、科研算法或特定生物过程。
2. **Glow Studio**：优先建设**科学场景制作台**，擅长导入科学结构、组合对象、配置表现、编排动画、制作解释与发布内容；不以取代 Blender 为目标。
3. **专业插件体系**：PDB/mmCIF、RCSB、结构生物学、分子表示、分析、动力学模拟、科研互操作和高级显示由版本化插件扩展。
4. **Glow Hub / 创意工坊**：分发模型资源、场景、工程模板和可选扩展；默认内容包只包含数据，功能插件执行代码并受到单独审核与权限控制。
5. **统一协议**：Viewer、Studio、Hub、Web、Desktop 共享 Core、数据 Schema、命令机制和资源生命周期；不维护多套查看器代码。

**本项目的“功能保留”是迁移约束，不表示当前功能已经全部经过定量科学验证或生产级测试。** 动画、示意模型和科研计算必须继续区分证据与可信度。

## 1. 目标、非目标与不可破坏约束

### 1.1 目标

- 将 3D 渲染与场景生命周期从生物学业务逻辑中解耦。
- 把现在的源码片段拼接结构逐步改造成明确依赖的模块与服务。
- 不安装任何科研插件时，Viewer 仍能打开、交互、保存和播放**通用三维场景**。
- 安装结构插件后，能够导入 PDB/mmCIF 并调用结构语义、选择与分析。
- Studio 和 Viewer 操作同一种 SceneDocument；编辑能力是 Studio 的额外层，不是另一个场景引擎。
- .glow v1 作品有明确的兼容或迁移路径；已有官方场景和主要模拟保持可访问。
- 模型内容与可执行插件分别管理，建立安全、版本和依赖边界。
- 保留单文件 Web 交付作为可选构建目标；不让“单 HTML”限制内部模块结构。

### 1.2 非目标（首版不做）

- 不从零重建所有模拟，也不一次性迁移所有预设。
- 不制作完整的通用网格建模、雕刻、材质节点和骨骼动画工具来取代 Blender。
- 不要求云账号、收费系统、实时多人协作或专用后端才能使用基本查看器/Studio。
- 不把教学动画解释成原子尺度分子动力学模拟。
- 不默认允许运行社区场景包内的 JS、插件脚本或任意网络代码。
- 不在第一阶段同步切换所有旧用户文件或删除旧版查看器。

### 1.3 迁移期间的约束

- **旧版稳定运行**：旧 Web/desktop 作为回归基准，直到新版本达到相应验收门槛。
- **科学来源不丢失**：PDB、CCD、UniProt、作者/label 编号、原始坐标、来源论文及证据等级尽可能无损保留。
- **实验数据不可被表现编辑覆盖**：材质、缩放、视觉运动、教学放大只能在表现层记录。
- **渲染不决定模拟结果**：模拟状态与时钟不应由屏幕帧率直接定义。
- **逐步可回滚**：每个迁移包均有测试、旧新版对照、兼容说明和回退点。

## 2. 产品分层与责任边界

| 产品或包 | 负责 | 明确不负责 |
| --- | --- | --- |
| Glow Core | 场景树、对象身份、基础渲染、资源生命周期、选择、时间线、命令/事务、持久化基础、扩展点 | PDB 专有语义、科学分析公式、内置实验结构库 |
| Glow Viewer | 文件打开/保存、查看、交互、动画播放、错误提示、缺失插件降级 | 高级科研编辑、完整制作工作流 |
| Glow Studio | 科学场景创建、对象编排、属性、相机、灯光、时间线、标注、证据、工程保存、发布 | 从零替代专业通用 DCC 软件 |
| Plugin SDK / Host | 插件注册、服务发现、兼容性、权限、加载/卸载、隔离策略 | 直接运行未经信任的内容包代码 |
| 专业插件 | 格式导入、结构语义、领域表示、分析、模拟和专业 UI | 绕过 Core 修改全局状态或其他插件私有资源 |
| Glow Hub | 内容目录、安装/升级、依赖和校验、发布与审核 | 让下载的模型直接执行任意代码 |
| Delivery Adapters | Web、Electron、离线缓存、文件系统、对外打开链接 | 复制独立的场景/模拟业务逻辑 |

### 2.1 运行时依赖方向

~~~text
Viewer UI ──────┐
Studio UI ──────┼────> Core Public API <──── Plugin Host <──── Domain Plugins
Hub / Manager ──┘              │
                               ▼
                      Scene / Asset / Timeline
                               │
                               ▼
                  Three.js Renderer + Resource Manager

Web Adapter / Electron Adapter：向上提供文件、缓存、窗口和网络能力
~~~

**禁止反向依赖**：Core 不 import 具体的结构/模拟插件；插件不得依赖 Studio 的 DOM；Viewer 不 import Studio 的编辑模块。跨插件通信通过有版本约束的 Service Registry。

### 2.2 Core 必须内置的最小能力

| Core 子系统 | 最小公共职责 |
| --- | --- |
| Scene Graph | 稳定节点 ID、父子关系、坐标变换、可见性、元数据、场景查询 |
| Renderer | 相机、灯光、网格/线/点、基础材质、绘制循环、通用拾取 |
| Asset Manager | 内容哈希、加载/取消、缓存、资源引用、格式路由、释放 |
| Timeline | 播放/暂停/跳转、通用关键帧、固定模拟时钟接口、动画轨道 |
| Command Bus | 事务、变更校验、撤销重做、历史记录、操作事件 |
| Selection | 通用节点或实例选择，专业残基/原子选择由插件扩展 |
| Session / Lifecycle | SceneSession、AbortSignal、ResourceRegistry、插件/场景作用域 |
| Persistence | SceneDocument 序列化、版本转换入口、保存/打开协议 |
| Extension Registry | Importer、Representation、Simulation、Tool、Panel、Service 注册 |

Core 可包含最基础的几何体与渲染操作，但不包含固定 PDB 预设、RCSB 调用、特定生物膜规则或 ATP 合酶过程。

## 3. 统一数据协议：Asset、Scene、Project、Package

引入四种主要持久化对象：

1. **Asset**：原始 mmCIF/PDB、网格、纹理、轨迹、图片或派生资源；以内容哈希识别，保留类型、来源、许可证、版本、大小和单位。
2. **SceneDocument**：可发布、可运行的场景：节点、组件、资源引用、通用表示、相机、时间线、标注、依赖和证据。
3. **ProjectDocument**：Studio 的可编辑工程：一个或多个场景、资源集合、工作区与未发布配置；编辑历史可独立存储。
4. **PackageManifest**：发布/安装清单：内容包或功能插件的标识、版本、依赖、兼容性、完整性、作者与许可证。

### 3.1 SceneNode 与 Component

- 每个节点有稳定且不随显示名变化的 ID；对象类型采用少量通用类型或能力组合，而不是每个科研实体创造一种核心节点。
- Transform、Visibility、Material、Camera、Label 等是通用组件。
- 专业组件带命名空间（例如 org.glow.structure、org.glow.simulation），由对应插件提供 schema 和行为。
- 科学语义与可视化对象分离：原始结构、推导结果、表示网格有明确的映射和来源。
- 复杂数据用 Asset 引用，避免将百万级原子坐标、轨迹或纹理直接塞进场景主 JSON。

### 3.2 科学数据及证据

- **Source**：实验/作者提供的原始数据；不可因场景编辑而修改。
- **Derived**：算法推导数据；记录输入资源哈希、算法及版本、参数、单位，可重新计算。
- **Modelled**：拟合、拼接、预测、构象插值等；必须记录方法。
- **Illustrative**：教学所用粒子、路径、尺寸放大、时序与摄像机叙事；必须可识别。

至少支持显式长度和时间单位；结构插件须维护 author/label chain/residue/atom 标识映射。涉及导出 glTF/其他单位的转换必须显式完成。数据坐标与场景 Transform 不得混写。

### 3.3 .glow v2 草案

**以下仅为目标协议示例，不是当前已实现的 v2 格式。正式字段须经过 Schema/ADR 冻结。**

~~~json
{
  "format": "glow-scene",
  "schemaVersion": 2,
  "id": "official.atp-synthase",
  "title": "ATP Synthase",
  "units": { "length": "angstrom", "time": "second" },
  "dependencies": [
    { "id": "org.glow.structure", "version": "^1.0.0", "optional": true }
  ],
  "assets": [
    {
      "id": "structure-main",
      "type": "chemical/x-mmcif",
      "uri": "assets/6zpo.cif",
      "sha256": "REPLACE_WITH_ACTUAL_SHA256",
      "provenance": { "source": "RCSB PDB", "accession": "6ZPO" }
    }
  ],
  "nodes": [
    {
      "id": "protein-main",
      "name": "ATP Synthase",
      "type": "asset-instance",
      "assetId": "structure-main",
      "components": {
        "glow.transform": {
          "position": [0, 0, 0],
          "rotation": [0, 0, 0, 1],
          "scale": [1, 1, 1]
        },
        "org.glow.structure": { "representation": "cartoon" }
      }
    }
  ],
  "timeline": { "duration": 20, "tracks": [] },
  "evidence": [],
  "bookmarks": []
}
~~~

这里的 optional 插件只表示该**专业行为**可选：若要做到未安装插件也可观看，包内还需提供通用 Mesh/预览资源；Core 不负责在缺少 mmCIF 解析器时推导 Cartoon。

### 3.4 持久化与迁移策略

- Scene v2、Project、Package 分别版本化；schemaVersion、Core API 版本与插件版本不得混为一个版本号。
- 采用统一 JSON Schema 校验元数据；二进制数据单独存为资源，分发包可使用 ZIP 容器。
- 内容哈希校验必须基于约定的原始字节；目录和资源引用需要防路径穿越、防超限和防篡改检查。
- 为旧版 .glow v1 实现 **v1 → v2 单向迁移器**，原文件不覆盖；不能无损转换的字段生成警告并保留来源信息。
- v1 的 process 字段需要映射到明确的插件能力和版本；缺失插件时显示可理解的降级信息，而不是静默跳过。
- 发布包与 Studio 工程分离；普通用户获取作品时，不需要下载编辑器草稿、撤销历史或无关资源。
- 提供持久化往返测试：加载→保存→重新打开→节点/引用/相机/时间线/证据一致。

## 4. 插件架构与安全边界

### 4.1 标准扩展点

- FileImporter / FileExporter：科学文件格式、导出与转换。
- RepresentationProvider：Cartoon、球棍、表面、密度、示意等专业表示。
- AnalysisProvider：测量、接触、口袋、孔道、结构叠合和科研数据计算。
- SimulationProvider：领域模型、状态、参数、时间推进、观测、序列化。
- ToolProvider / PanelProvider：交互工具与专业参数面板。
- ServiceProvider：提供可被其他插件调用的**版本化领域服务**，例如 StructureService。
- 可扩展的命令与数据 Schema，但插件不可直接更改 Core 的私有全局变量。

建议的最小接口（TypeScript 草案）：

~~~ts
interface GlowPlugin {
  id: string;
  version: string;
  activate(context: PluginContext): Promise<void> | void;
  deactivate?(): Promise<void> | void;
}

interface PluginContext {
  readonly scene: SceneReadAPI;
  readonly commands: CommandAPI;
  readonly assets: AssetAPI;
  readonly events: EventAPI;
  readonly services: ServiceRegistry;
  readonly importers: ImporterRegistry;
  readonly representations: RepresentationRegistry;
  readonly simulations: SimulationRegistry;
  readonly panels: PanelRegistry;
  readonly lifecycle: DisposableRegistry;
}
~~~

- 修改场景一律提交 Command / Transaction，经过校验后更新 Document Store，再同步 Render State。
- 可撤销编辑与不可撤销外部动作必须区分；异步请求可取消，旧请求不能覆盖新场景。
- 插件注销时释放它创建的 GPU 资源、监听器、Worker、定时器和服务注册。
- 插件间不能通过共享的 Three.js 场景全局变量交换科学数据；使用稳定对象 ID、只读快照或领域服务。
- PluginManifest 声明 id、version、apiCompatibility、dependencies、capabilities、permissions、入口和校验信息。

### 4.2 信任分级

1. **官方可信插件（第一阶段）**：以正常 ES Module 实现，按稳定 API 约束工程依赖；明确标记其可信来源。
2. **第三方插件（第二阶段）**：引入隔离执行、权限授予、消息协议、资源配额和审核；计算可用 Worker，受限 UI 可采用隔离框架/宿主代理。
3. **创意工坊内容包（默认）**：只解释声明式数据，不执行上传者 JS、HTML 脚本或系统命令。

**API 表面受限不等于 JS 被沙箱隔离。** 对于在页面主上下文运行的第三方脚本，单纯传入受限 PluginContext 不足以建立安全边界。第三方代码开放必须在隔离与权限模型完成之后。

### 4.3 模拟 API 的分层

将现有 process 同时操作模型、Three.js、DOM 的做法拆为：

~~~text
Scientific Model / Parameters
        ↓ fixed-step simulation
Simulation State + Events + Observations
        ↓ presentation adapter
Scene Transforms / Particles / Labels / Charts
~~~

- 模拟时间独立于 FPS；固定步进与显示插值分开。
- seed 连同随机数算法/状态、模拟版本、参数和时间步进入可复现记录。
- 定义 initialize、step、observe、serialize、restore、dispose 的能力契约。
- 从模拟得到的数值与教学示意必须在 UI 和导出中区分。
- 无渲染环境可运行最小模拟测试；相同输入与 seed 应产生确定性结果（在明确的平台/精度约束内）。

## 5. Glow Studio：科学场景制作台（产品 A）

### 5.1 首版目标

工作台是专业科学场景的创作器，而不是通用 DCC 工具。首先完成“导入结构 → 配置场景 → 制作动画/说明 → 发布”的端到端闭环。

首版工作区：

| 工作区 | 必需能力 |
| --- | --- |
| 资源面板 | 导入通用 Mesh/图片及插件支持的科学结构，查看来源、许可证、哈希 |
| 场景树 | 新增/删除/分组对象，稳定 ID，显示/隐藏，层级拖动 |
| 3D 视口 | 移动、旋转、缩放、拾取、网格与轴辅助、焦点、相机书签 |
| 属性检查器 | Transform、材质、表示、可见性、组件参数、证据来源 |
| 时间线 | 关键帧、通用插值、运动路径、镜头运动、暂停/单步/跳转 |
| 科学说明 | 名称、讲解文字、引用、数据与推导/建模/示意等级 |
| 发布工具 | 项目保存/恢复、预览、检查缺失资源、导出/验证场景包 |

### 5.2 编辑体验与职责

- Viewer、Studio 共用 SceneDocument 和 Renderer；Studio 仅额外提供 EditorStore、选区操作、Gizmo、Inspector、Undo/Redo。
- Core Timeline 负责通用播放和关键帧；科学机制的锚点、事件与参数由插件提供。
- 不安装科研插件仍可编辑通用网格、灯光、相机、材质、文字和时间线。
- 安装 Structure 插件后显示链、残基、配体等专业面板；安装 Simulation 插件后增加参数和机制编辑器。
- 编辑器 UI 不直接访问专业插件私有状态；所有变更走 Command Bus。
- 原始实验坐标不能被视觉变换意外改写；如需修改科学模型，必须走明确的派生资产操作并记录 provenance。

### 5.3 首个可验证工作流

1. 用户打开 Studio 创建空项目。
2. 安装/启用 Structure Plugin，导入 PDB/mmCIF。
3. 添加膜、灯光、讲解标签、相机书签和基础运动轨道。
4. 为结构/推导/示意信息配置证据与引用。
5. 保存可编辑 Project，重新打开确认编辑状态。
6. 导出 .glow Scene Package。
7. 在独立 Viewer 打开和播放；缺失可选插件时展示预览/依赖提醒。
8. 将作品加入本地库，再经 Hub 发布到工坊。

## 6. Glow Hub：内容与插件分离

### 6.1 包类型

- **Model / Asset Pack**：模型及其原始来源、元数据、必要许可证。
- **Scene Pack**：场景组合、表示、镜头、时间线与讲解（默认纯数据）。
- **Project Template**：Studio 可编辑模板与所需资源依赖。
- **Functional Plugin**：可执行扩展程序；独立于普通场景包审核和安装。
- **Visual Preset**：在受限数据 schema 内定义主题和材质配置；若含可执行着色器或代码则进入插件审核通道。

### 6.2 演进路线

- 第一阶段沿用 GitHub 仓库、静态 index.json、.glow 文件、SHA-256 校验和 Actions 审核流程。
- 将插件清单与场景包目录分开；场景可声明插件依赖和可选的通用预览资源。
- 内容安装、订阅与更新可先本地实现，不强制登录。
- 第三方插件分发推迟至沙箱、权限审核、签名/完整性策略完成后。
- 日后确有必要再引入专用后端、账号、评论与统计；保持静态目录协议可以继续使用。

## 7. 目标仓库组织

~~~text
apps/
  viewer-web/          # 最小 Web Viewer
  studio-web/          # 科学场景制作台
  desktop/             # Electron 宿主（Viewer/Studio 的交付）
  hub-web/             # 目录与内容管理界面
packages/
  core/                # scene/render/assets/timeline/commands/session/extensions
  schema/              # 文档 schema + 格式迁移
  plugin-sdk/          # 稳定类型与开发工具
  plugin-host/         # 加载/权限/隔离/依赖
  studio-editor/       # 编辑器状态、Gizmo、Inspector、撤销重做
  package-manager/     # 内容包安装/更新/验证
  legacy-compat/       # .glow v1 与旧命令适配层
plugins/
  structure/
  rcsb/
  molecular-representations/
  molecular-analysis/
  bio-simulation/
  illustration-style/
content/
  official/
  examples/
tools/
tests/
docs/
~~~

此目录是**目标架构**，不是立即必须重命名的现有目录。优先在既有仓库中渐进建立明确边界，之后再决定 monorepo 工具和实际迁移时机。建议采用 ES Module + TypeScript 接口规范；构建工具选择应以 Web/desktop 交付和现有单文件需求为验收条件。

## 8. 旧代码迁移映射

| 当前源码 | 新归属 | 迁移处理 |
| --- | --- | --- |
| src/core/session.js | packages/core/session | 保留 SceneSession / ResourceRegistry 思想，去除对全局 loads/DOM 的耦合 |
| src/view/renderer.js | packages/core/rendering | 拆出通用渲染与可注册后处理 |
| src/view/frame-loop.js | Core Scheduler + Timeline | 渲染时钟、模拟时钟、UI 刷新分离 |
| src/data/parse.js、rcsb.js、presets.js | Structure/RCSB 插件 + official content | 解析和在线数据从 Core 移除；预设作为内容资产分发 |
| src/derived/* | Molecular Analysis 插件 | 纯算法和计算结果与 Three.js/DOM 分离 |
| src/repr/* | Core 基础表示 + 专业表示/视觉插件 | 通用 Mesh/线/点留下；Cartoon、功能简化、膜语义外置 |
| src/sim/processes/*、cell-kinetics.js | Bio Simulation 插件 | 模型/状态/显示解耦，逐过程迁移 |
| src/pack/rules.js、pack-io.js | packages/schema + legacy-compat | v1 校验保留；引入 v2 Schema 和迁移器 |
| src/api/* | Command Bus + plugin-sdk + compatibility | 旧 window.glow 作为兼容入口，内部委托新命令 |
| src/ui/*、src/dev.html | Viewer UI / Studio Editor / 专业 Panel | 拆分通用 UI 与科研工具 |
| workshop/* | Hub / 内容目录工具 | 继承校验、审核和订阅机制 |
| desktop/* | Desktop Adapter | 复用同一 Core、资源与内容数据，不复制业务代码 |

**迁移难点**：现有 src/index.html.tpl 依次 include 源片段，它们大多共享单一 module 作用域；多个 process 甚至依赖连续拼接的对象字面量。不能把文件直接搬目录后称为“插件化”。需要先抽接口、补测试、解除隐式全局依赖，再进行物理重组。

## 9. 分阶段实施路线图与完成定义

以下以**依赖关系和验收门槛**定义阶段，不承诺没有估算依据的具体工期。

| 阶段 | 实施内容 | 可验证完成条件 |
| --- | --- | --- |
| P0：冻结旧版基准 | 枚举已有功能、保留 Web/desktop、截图和资源/FPS/场景数据回归基线 | 核心官方场景回归集可重复运行；记录旧版输入、输出与已知限制 |
| P1：最小 Core/Viewer | 场景树、资源系统、基础渲染、相机、节点选择、时间线、命令和保存 | 无科研插件也能创建、保存、关闭、重开并播放通用三维场景 |
| P2：Schema v2 / SDK | Asset/Scene/Project/Package、事务接口、插件生命周期、服务注册、v1 迁移 | Schema 验证、往返测试、旧场景兼容报告可自动运行 |
| P3：结构与表示插件 | PDB/mmCIF、RCSB、结构语义、基本 Cartoon/配体表示 | 典型 PDB 的链/残基/配体/坐标、可视化与选择达到旧版功能基线 |
| P4：Studio MVP | 场景树、Inspector、Gizmo、关键帧、说明和证据、保存/发布 | 完成第 5.3 节的 Studio→Viewer 端到端工作流 |
| P5：模拟与分析迁移 | ATP 合酶、KcsA、翻译、呼吸链、叶绿体及分析模块逐一插件化 | 同种输入/seed/参数下观测与约定误差范围一致，视图不驱动模拟状态 |
| P6：Hub 与交付 | 模型/场景/插件分类、依赖、安装、离线更新、Windows 交付 | 可安装/升级/卸载内容；缺失依赖有提示；离线重开正常 |
| P7：科研与生态扩展 | 高级互操作、轨迹、插件审核、完整机制工作台、演示和 AI 适配 | 按单独 RFC/ADR 逐项验收，不能逆向破坏 Core 契约 |

P2/P3 可以与 Studio UI 原型并行，但在 SceneDocument/Command API 未稳定前，不开展大规模复杂模拟迁移。P5 中每个过程可作为独立工作包，不需要等待全部完成才发布已通过的插件。

### 9.1 第一阶段 MVP 范围

首个新平台版本必须交付：

- Glow Core（独立可复用）、最小 Viewer。
- Schema v2 与 v1 兼容导入基础。
- Plugin SDK 和一个可信 Structure Plugin。
- Studio 场景编辑、素材管理、时间线、工程保存、导出。
- 本地场景包导入/导出及可靠资源管理。
- 一条完整的“导入蛋白 → 场景编辑 → 动画/讲解 → .glow 导出 → Viewer 播放”演示与自动化测试。

**第一版不依赖全量模拟迁移、第三方插件商店或在线账号。**

## 10. 测试、质量门槛与迁移验收

沿用现有构建/副本一致性、工坊校验及 Electron 回归流程作为旧版基线（仓库原有命令见 src/README.md 与 desktop/README.md）。新架构建立以下独立测试层：

1. **Schema**：无效数据、边界值、升级、兼容、导入/导出往返、哈希一致。
2. **Core 单元测试**：场景节点事务、撤销重做、生命周期、请求取消、资源释放、插件注册/卸载。
3. **插件契约测试**：扩展点兼容、依赖冲突、缺失服务、跨插件数据接口、权限拒绝。
4. **科学正确性测试**：结构编号和坐标核对、原始数据不变、推导算法与证据来源。
5. **模拟测试**：固定时间步、seed、事件/观测、序列化恢复、与 FPS 解耦。
6. **浏览器可视回归**：蛋白/配体、膜、插画和暗色、构象、组合场景、多次切换。
7. **性能和内存**：GPU 几何体/材质/纹理及 Worker/监听器回收；重复加载稳定；不同档位 FPS/峰值内存基准。
8. **Studio 端到端**：导入、编辑、保存、重开、发布、Viewer 打开、依赖缺失降级。
9. **安全测试**：恶意内容包、路径穿越、超大输入、超时、错误权限、跨域调用、插件隔离。

初始回归参考仓库现有六个固定场景（4HHB 自动模式、6ZPO ATP 合酶、1K4C KcsA、4V6F 翻译、7CGO 鞭毛马达、细胞一角）；另覆盖当前官方工坊场景包。迁移开始前应重新核对官方场景包数量与具体版本，避免把文档中的历史数字当成永久事实。

每个阶段的 PR 必须包含：修改模块、迁移影响、兼容性说明、测试命令/结果、截图（若涉及视觉）、已知限制和回滚方式。新旧版差异应按**科学数据、功能行为、画面表现、性能**四种类别分别记录。

## 11. 主要风险与应对

| 风险 | 应对 |
| --- | --- |
| 一次性重写导致功能丢失 | 保留旧版可运行分支/构建；按插件逐项迁移、双轨对照 |
| Core 再次吸收科研特殊逻辑 | 通过依赖检查和公共 API 审核，禁止 Core 依赖 plugins |
| 全局变量与源码拼接耦合 | 先建立模块边界和适配层，再移动代码；逐步取消共享作用域 |
| v1 内容依赖特定内置过程 | 保存 legacy 映射、插件能力声明、预览资源和迁移警告 |
| 科学数据与示意动画混淆 | 原始/推导/建模/示意四层标注并保留来源、算法和参数 |
| 第三方插件突破权限 | 可信/不可信分级；未完成隔离前不执行社区插件代码 |
| 性能回退、资源泄漏 | 自动化对象/纹理/Worker 计数及重复切换回归 |
| Studio 目标过大 | MVP 专注科学场景编排；专业网格/曲面建模不进入首版 |
| 过早引入后端 | 优先静态目录、本地缓存和 GitHub CI；后端由实际需求驱动 |
| 单文件 Web 与模块化冲突 | 内部 ES Module 开发，最后阶段按需生成可独立发布的 HTML |

## 12. 技术决策与治理

推荐新建 ADR（Architecture Decision Record）逐项冻结下列决策：

- ADR-001：Core 的领域无关边界与禁止依赖规则。
- ADR-002：SceneNode/Component/Asset/Project 标识和单位。
- ADR-003：.glow v2 Schema、包容器、v1 迁移与预览降级。
- ADR-004：Plugin API、Service Registry、版本与生命周期。
- ADR-005：插件信任分级、隔离和权限策略。
- ADR-006：Command Bus、事务、撤销重做与 Document Store。
- ADR-007：Simulation clock、确定性、观测与可复现状态。
- ADR-008：Web/desktop 构建与离线资源管理。

单个 ADR 写明背景、备选方案、决定、取舍、兼容影响和验收方法。ADR 通过后作为实现依据；本文保持路线图角色。与现有 DEVELOPMENT_FRAMEWORK.md 存在差异时，先形成明确 ADR，再更新总纲与实施计划，不要悄悄覆盖历史决策。

## 13. 推荐的下一批实际任务

**第一工作包：现状映射与回归冻结（P0）**
- 建立功能清单，标记“Core / 插件 / 内容 / Studio / 适配层”目标归属。
- 执行并记录旧版构建、工坊检查和桌面回归，保留失败项与环境。
- 整理 .glow v1 当前全部字段、旧 API 命令和过程插件依赖矩阵。
- 为最具代表性的结构、表示、模拟、组合场景建立截图和数据基线。

**第二工作包：核心契约原型（P1/P2 前置）**
- 只实现 SceneNode、AssetRef、Command、ResourceScope、Timeline 的最小 API。
- 用一份纯通用 Mesh 场景完成加载/保存/重开。
- 将一个现有场景以只读适配器连接新模型，验证可以兼容旧数据。
- 制定 ADR-001/002/006，先定边界再全面迁移。

**第三工作包：打通最小科学创作链（P2–P4）**
- 建立受控的 StructureImporter + basic representation 插件。
- 将 Studio 初版接入同一 SceneDocument。
- 在新 Viewer 中完成加载科学结构、编辑镜头/材质/时间线并导出作品。
- 公开最小兼容性测试集，再逐一迁移剩余专业模块。

## 14. 最终完成标准

整个改造不能只以“新的目录已经建立”作为成功标准。达到以下条件才算实现目标架构：

- Core 在无科研插件环境中可以独立使用。
- Viewer 和 Studio 不再各自维护一套场景模型和渲染逻辑。
- 主要科研功能可以安装、禁用或升级，而不直接改动 Core。
- 场景数据、科学来源、计算结果和视觉示意具有清晰边界。
- 原有关键场景、模拟和创意工坊作品可以按明确规则迁移与回归。
- 作品可以由 Studio 创建，并在 Viewer 中稳定打开和播放。
- 场景包默认无可执行代码；第三方插件不绕过安全隔离。
- 升级和扩展不要求恢复当前依赖源码拼接顺序的架构。

---

**一句话结论：**保留 Molecule Glow 已经积累的科学内容和可视化能力，把它们从单体查看器中解放出来；以领域无关 Core 为基础，用 Glow Studio 创作、用专业插件提供科研能力、用 Glow Hub 分发可复用的科学模型与场景。下一步先做 **P0 回归冻结 + 核心契约 ADR**，再进入渐进式工程改造。
