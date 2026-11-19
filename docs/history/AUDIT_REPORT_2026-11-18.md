# Codex 当前版本功能继承审计

**审计日期：** 2026-11-18  
**审计对象：** `desktop-v0.4.0` 与当前 `main` 的 Codex Viewer、Studio、Core、插件宿主；对照 Claude `desktop-v0.3.2` / Viewer v18.2。  
**范围：** 代码与文档静态审阅。未运行测试、未做 Electron/浏览器视觉回归，也未验证外部 RCSB 服务。  
**目标产品方向：** Claude 的前端和科学展示能力作为主体，Codex 的 Core、场景格式、Studio 和插件机制作为平台底座。

## 执行摘要

**结论：当前仓库没有删除 Claude 经典 Viewer，但 Codex 新 Viewer 尚未继承它的主要分子前端能力。** 经典实现仍位于 `src/` 并构建到 `web/`，桌面包中也保留经典入口；然而桌面默认页已切换到独立的 `apps/viewer-web/`。新版 Viewer 的四模式导航和通用时间线是有效新增，但示例使用通用几何，不能替代原有分子表示、结构解释和机制模拟。

Codex 已建立可继续扩展的技术底座：Core/Schema、Studio MVP、v2 包、v1 只读迁移器和受信插件宿主。当前插件接口仅提供 importer/representation/service 三类注册点；即使插件可以注册 representation，新 Viewer 的渲染流程也尚未消费该注册点。旧版 `process` 过程在 v1 迁移时只作为声明/可选依赖保留，未映射到播放运行时。

**上线判断：** 如果把 0.4.0 新 Viewer 当作 Claude 功能的直接替代，属于明显的产品能力回退；如果把它当作平台原型并继续从经典 Viewer 迁入，则 Core 和 Studio 有复用价值。建议先完成一条真实结构端到端链和一个真实机制插件，再逐步迁移其他过程。

## 主要审计发现

### P0 — 默认桌面入口切到功能较少的新 Viewer，经典前端未成为插件化主体

打包脚本将普通桌面启动重定向到 `apps/viewer-web/index.html`；经典单文件页面仍被复制为另一个工作区。新版 Viewer 的界面包含场景文件操作、四模式导航、基本节点选择、插件开关和通用播放条。Claude Viewer 原有的分子工具栏、预设/工坊、表示模式、选择/信息卡、结构分析、机制控制等没有接入此界面。

**影响：** 用户从默认入口体验到的不是“Claude Viewer 加插件”，而是通用 Viewer 原型；经典页面虽可回退，但不满足主体继承要求。

**证据：** `desktop/scripts/package-platform.cjs` 的 `MODE_PAGES` 和启动重定向；`apps/viewer-web/index.html`；经典实现 `src/ui/`、`src/sim/`、`src/repr/` 仍存在。

**建议：** 将经典 UI/分子视口定为新主体，渐进接入 Core 与插件；桌面默认入口在核心功能完成前不应让用户误认为通用 Viewer 已替代经典产品。

### P0 — v1 迁移保留声明不等于可显示或可播放；仅 PDB 编号场景存在无几何风险

`packages/legacy-compat/index.mjs` 能生成外部 PDB 资源引用和普通节点，并把旧业务字段放到 `scene.legacy`；专用 `process` 只被保存为元数据及可选依赖，迁移警告明确表示不会运行旧过程。`apps/viewer-web/scene-io.mjs` 的 v1 打开流程调用迁移器，但没有在迁移结果上自动解析外部 accession。随后 `restoreStructureModel()` 只在场景依赖存在时查找包内 `kind: file` 且为 PDB/mmCIF 的原始资产。迁移器生成的 accession 是 `kind: external`，因此单靠外部 PDB 编号的旧包不能沿这条路径建立结构模型/预览。

**影响：** 15 个旧官方包的结构和过程不能仅凭“字段已保留”推定在新版 Viewer 可见。包内嵌坐标和仅引用 PDB 的情况还应分别验证。

**证据：** `packages/legacy-compat/index.mjs` 中 accession→external 资产逻辑；`apps/viewer-web/scene-io.mjs` 的 `openSceneFile()`；`apps/viewer-web/main.mjs` 的 `restoreStructureModel()`；兼容清单 `docs/history/PLATFORM_2_0_COMPATIBILITY.md`。

**建议：** 加载迁移后的 external asset 时调用 RCSB 适配器并记录来源/缓存；无网络时提示并保留兼容 Viewer 入口。按 15 个官方包逐个记录可见结构、静态状态、播放支持与降级提示。

### P0 — 插件宿主 API 不能承载原 Viewer 的前端和过程运行时

`packages/plugin-host/index.mjs` 限定三种能力：`importers`、`representations`、`services`。没有播放器、仿真时钟、视图/场景贡献、选择语义、面板控件、标签/图例/证据、命令或分析工具扩展点。Claude 的功能不是只导入一种文件；机制动画会驱动粒子、字幕、结构 pose、实验参数、步骤/能量面板和证据说明。

**影响：** 将旧过程简单包装成 service 并不能提供可组合、可暂停、可复现、可从场景配置的 Viewer 能力。

**证据：** `packages/plugin-host/index.mjs` 的能力白名单和 context；`packages/plugin-host/README.md`；原业务模块 `src/sim/`、`src/ui/`。

**建议：** 为版本化插件契约增加受控 UI 插槽、领域对象/选择、表示层生命周期、播放器/时钟与仿真状态、证据/讲解贡献；保留旧 API façade。

### P1 — representation 插件注册已实现，但新版 Viewer 没有使用该注册接口

结构插件激活时注册 `org.glow.structure.preview` 表示；Viewer 构建场景的路径调用 `geometryLayers(loaded)` 读取包内通用几何，没有通过 `host.getRepresentation()` 解析插件表示。结构导入器自身会直接调用 `buildRepresentations()` 生成初始 cartoon 文件，因此当前表现主要由导入阶段静态烘焙，而不是运行时插件可切换/可释放的 representation。

**影响：** API 看起来支持可插拔表示，但实际 Viewer 尚未形成表示插件闭环；不同表示、原子级重建、渲染层切换和插件卸载释放没有统一接线。

**证据：** `plugins/structure/index.mjs` 的注册；`apps/viewer-web/main.mjs` 的 `geometryLayers`/`viewport.prepare` 路径；`apps/viewer-web/scene-io.mjs`。

**建议：** 定义并调用表示工厂契约；Viewer 负责选择能力、绑定数据/视口和释放资源，插件提供领域图层和拾取对象。

### P1 — 新旧时间线表达不等价，旧的实时过程没有映射到 v2 播放器

新版 Core timeline 处理节点 transform 关键帧；v1 数据动画含 compartments/species/pools/flows/reactions，专用过程还依赖参数、seed 和离散事件。迁移器会保留 `animation` 到 `legacy`，但新版 Viewer 当前显示的是通用几何关键帧时间线，不能据此推断旧粒子和化学步骤已迁移。

**影响：** 原先的呼吸链、光反应、翻译和 KcsA 交互可能只剩静态节点，或场景打开但没有同语义的播放。

**建议：** 定义 playback capability 和 data-animation v1 adapter；将时间单位、固定步进、seed、播放/暂停/单步、步骤同步和参与对象统一纳入契约。

### P1 — 结构选取和分析数据尚未与经典 UI 的拾取/信息链路打通

结构解析服务支持作者/标签编号筛选，但 Viewer 当前表单只把匹配原子数写入状态文本；初始导入生成的是链级预览节点。它没有把被选原子映射成可点选残基网格，再驱动序列条、配体聚焦、相互作用、标签、分析卡和镜头联动。

**影响：** “结构已导入”不等于继承原 Viewer 的残基/配体工作流。

**建议：** 统一 selection model（链、auth/label residue、插入码、atom/ligand、part），提供拾取→命令→面板→视口的单向状态流；把选择语言/API 作为兼容验收。

### P1 — 经典 `window.glow` 和嵌入消息协议未接入新版 Viewer

经典 API 的命令队列、命令日志/重放、`postMessage` 来源校验和授权逻辑保留在旧源码；新版 Viewer 未发现兼容 façade。迁移到新版主体后，开发者工作台和外部嵌入调用会失去稳定入口。

**建议：** 在 Viewer/Core 命令层加 facade；保持命令名、参数和 JSON 回包，bridge 维持来源 allow-list、HTTPS 授权、本地文件限制、串行队列和取消语义。

### P2 — Studio 已有 MVP，但不是可替代经典 Viewer 的产品前端

Studio 支持几何场景编辑、结构导入、变换、关键帧、工程保存和 `.glow` v2 导出，具有平台化价值；目前 README 描述的制作流程仍以方盒/球体/组和通用 Viewer 预览为主。没有证据表明它已提供原 Viewer 的机制作者控件、证据编辑、配体/结构分析或各领域模拟编辑器。

**建议：** 保持 Studio 是创作工作区，按已启用的领域插件提供作者工具；由主体 Viewer 负责教学/展示体验。

## 已继承、应继续复用的能力

- Core 的 scene/document store、事务、取消加载、资源释放和通用时间线。
- v2 scene/package/schema、资源哈希与结构资产溯源。
- `.glow` v1 的只读解析/字段保留起点，以及不在场景包中运行任意代码的原则。
- 受信插件激活/停用、精确版本依赖、注册冲突检查和 disposer 生命周期。
- RCSB/PDB/mmCIF 导入原型与结构数据解析基础。
- Studio 独立工作区和 Studio→Viewer v2 流程。
- 新 Viewer 四层导航、镜头过渡、返回恢复、响应式取景、注释/证据/书签和时间线同步。

这些是平台增量，不应为了恢复旧前端而丢弃；要解决的是把它们放在 Claude 用户体验下面并补齐领域 API。

## 建议整改顺序

1. 先确定 Claude 经典 Viewer 的视口、工具栏、命令 API 和展示流程为用户体验基线，做宽/窄窗口截图和交互清单。
2. 打通结构插件闭环：RCSB/本地数据→结构模型→多种表示→残基/配体拾取→信息/镜头联动→保存再打开。
3. 修复 v1 accession 解析与缓存；逐个核对 15 个官方包，分别记录静态可见与机制可播状态。
4. 扩展插件契约并先迁移一个机制（ATP 合酶或 KcsA），核验 seed、播放、参数、字幕、证据和步骤高亮。
5. 再迁移复合系统、翻译、全细胞、相互作用分析、工坊/开发者 API，逐步让新主体成为桌面默认。

## 限制

本报告是代码与文档静态审计。未安装依赖、未运行 Node/Electron 测试、未看应用实际截图；涉及外部网络的 PDB 获取、打包产物和性能结论尚未实测。提交前应按整改顺序进行动态验收，不能把文档中原有测试记录视为本次审计复跑结果。
