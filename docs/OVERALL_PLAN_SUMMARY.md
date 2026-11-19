# Molecule Glow 整体规划摘要

> 本文归纳仓库早期的 `DEVELOPMENT_FRAMEWORK`、Platform 2.0 重构计划、四模式交接/实施记录、旧版审计与兼容清单。详细原文已归档在 `docs/history/`，供追溯设计背景；本摘要用来快速理解项目方向和阶段变化。当前功能状态以源码与 [审计报告](AUDIT_REPORT_2026-11-18.md) 为准。

## 产品目标

Molecule Glow 是以真实结构数据为锚点、面向教学、研究辅助和 3D 演示的分子可视化平台。内容从细胞、局部系统、蛋白质/复合体延伸到分子机理。实验数据、结构推导、模型和教学示意应明确区分；教学动画不能被误认为定量分子动力学。

## 原规划的架构方向

旧总体规划提出把已有单体 Viewer 平台化，同时保留功能和科学内容：

1. **Core 与共享场景模型**：管理场景节点、资源、单位、生命周期和时间线。
2. **Viewer**：通用三维场景的浏览、选择、播放和保存。
3. **Studio**：导入结构、组织场景、编辑视图/关键帧、编排解释并发布。
4. **领域插件**：结构导入、分子表示、分析、教学过程/模拟和外部工具互通。
5. **场景包与分发**：`.glow` v2 采用版本化场景与资源清单；`.glow` v1 需有兼容路径。场景包是数据，不执行其中的任意代码；可执行插件由宿主单独信任和加载。
6. **多端复用**：Web、桌面、Studio 与 Viewer 共用场景格式、Core 和插件协议，尽量避免多份独立渲染实现。

这是“底座共享、领域能力扩展”的技术方向。它没有意味着已有 Claude Viewer 的用户界面和教学功能已经自动成为新版 Viewer 的一部分。

## 四种呈现模式规划

四模式工作包把 Viewer 的信息组织为：

- **细胞**：区室、膜、细胞环境和系统入口；
- **局部系统**：多个结构的空间协作、方向、通量与能量；
- **蛋白质**：结构、链/亚基、配体、构象和功能部件；
- **分子机理**：结合、门控、催化、转移和释放的步骤。

这些模式应共用同一个场景、时间线和视口。机理可从系统或蛋白质进入；返回时恢复选择和镜头。模式数据表达内容组织，不应在 Core 中硬编码某个生物过程。

M0–M2 已在新版 Viewer 实现示意数据、导航/返回、镜头过渡、模式面板、步骤同步和通用连接覆盖层。当前四模式 demo 用通用几何验证交互；它不代表真实结构插件或 Claude 的科研/教学过程已迁入。

## 规划阶段与目前对应物

| 阶段 | 规划目标 | 当前仓库对应物 / 状态 |
|---|---|---|
| 经典 Viewer 稳定 | PDB/mmCIF、RCSB、分子表示、机制动画、教学 UI、`.glow` v1 | 保留在 `src/` 与 `web/`，也是功能参照；未整体迁入新版 Viewer |
| Glow Core / Schema | 场景文档、单位、资产、时间线、版本化 `.glow` v2、兼容转换 | 已有 `packages/core/`、`packages/schema/`、`packages/legacy-compat/` |
| 插件原型 | 受信模块注册导入器、表示和服务，管理依赖与资源释放 | `packages/plugin-host/` 与结构/RCSB 插件已建立原型；扩展点尚不足以承载旧 UI 和过程运行时 |
| 新 Viewer | 独立查看 v2 场景、结构插件入口、共享时间线与四模式导航 | `apps/viewer-web/` 已实现基础场景/几何浏览和 M0–M2 导航；与经典分子 Viewer 的功能有明显差距 |
| Studio | 场景树编辑、变换、关键帧、工程保存、Viewer 发布 | `apps/studio-web/` 与 `packages/studio-editor/` 有 MVP；领域作者工具尚需扩展 |
| 分子领域能力迁移 | 结构表现、分析、场景与机制由插件提供，经典前端体验保留 | 尚待实施；按 [插件迁移建议](PLUGIN_MIGRATION_PROPOSAL.md) 推进 |

当前实施清单和经典 Viewer 的宽窄屏实测记录见 [基线与结构工作流](BASELINE_AND_STRUCTURE_WORKFLOW.md)。

## 当前实施顺序

以新版 Viewer 为产品入口，以经典 Viewer 为功能与视觉验收基线。Studio 延续 M3 的四模式作者流程，后续复用新版 Viewer 的分子能力。

| 阶段 | 当前状态与验收 |
|---|---|
| 1. 真实结构闭环 | 已验证 RCSB 4HHB、PDB/mmCIF 导入、残基与配体点击、表示切换、保存重开，以及失败和插件停用时的行为 |
| 2. 经典结构体验和 v1 兼容 | 已有白底墨线团块、配体邻近残基、PDB/mmCIF 生物组装体、含指定核心的功能分区示意及官方 v1 静态组件布局。旧简化部件使用主链预览，经典分区形状与部件表面仍待迁移 |
| 3. 真实机制与四模式 | 以 ATP 合酶验证官方播放器、固定步长和种子、参数、证据、字幕、步骤与真实结构之间的联动 |
| 4. 功能继承 | 迁移其他机制和复合系统，接回拆装、分析、工坊、`window.glow` 和嵌入兼容接口 |
| 5. Studio 制作与交付 | 用 Studio 编排真实领域场景，验证工程重开、导出及 Viewer 播放，再推进扩展插件生态 |

每阶段的完成依据是当前代码的验收结果。历史 WP、P 和 M 编号保留作设计和交付参考。

## 重要设计约束

- 迁移不得静默丢弃旧包中的场景字段、相机、配色、组成、证据或字幕；暂不支持的播放能力要明确说明。
- 插件精确声明 ID、版本、API 版本、依赖和能力；由宿主加载可信代码，场景包不能绕过安全边界。
- 资源和异步操作必须可取消、可释放；结构重载/插件卸载不能留下监听器、Worker 或 GPU 资源。
- 前端必须提供清晰选择反馈、可返回的导航、稳定的镜头、可访问的控件和低性能设备降级。
- 实验、推导、建模、示意证据要贯穿数据和界面，不能只在文档中声明。

## 产品方向更新

当前实施记录一度选择先做与领域内容无关的四模式导航；这让导航原型可以独立验收，但也造成默认 Viewer 与 Claude 的分子前端体验分离。后续决策应以用户明确提出的目标为准：**Claude 经典 Viewer 的前端和教学体验作为产品主体，Codex Core、场景包、Studio 与插件作为底座和扩展方式。**

因此，四模式导航应融合进原有科学视图，而不是替换其表示、动画和交互；迁移的完成标准是新版主体能通过插件提供 Claude 原有能力。旧的宏观计划和已完成工作包仍保存在 `docs/history/`，而非当前任务清单。

## 归档资料索引

- [`DEVELOPMENT_FRAMEWORK.md`](history/DEVELOPMENT_FRAMEWORK.md)：旧总体开发总纲。
- [`PLATFORM_2_0_REFACTOR_PLAN.md`](history/PLATFORM_2_0_REFACTOR_PLAN.md)：平台化目标与阶段计划。
- [`HANDOFF_PLAN.md`](history/HANDOFF_PLAN.md)、[`HANDOFF_CORE_PLUGINS.md`](history/HANDOFF_CORE_PLUGINS.md)：旧工作包和 Core/插件交接。
- [`HANDOFF_FOUR_PRESENTATION_MODES.md`](history/HANDOFF_FOUR_PRESENTATION_MODES.md)、[`FOUR_PRESENTATION_MODES_M0.md`](history/FOUR_PRESENTATION_MODES_M0.md)–[`M2.md`](history/FOUR_PRESENTATION_MODES_M2.md)：四模式已完成工作记录。
- [`PLATFORM_2_0_BASELINE.md`](history/PLATFORM_2_0_BASELINE.md)、[`PLATFORM_AUDIT_REPORT.md`](history/PLATFORM_AUDIT_REPORT.md)、[`PLATFORM_ENGINEERING_SPEC.md`](history/PLATFORM_ENGINEERING_SPEC.md)、[`AI_AUDIT_AND_STABILIZATION.md`](history/AI_AUDIT_AND_STABILIZATION.md)、[`AUDIT_ROUND2.md`](history/AUDIT_ROUND2.md)、[`ROADMAP.md`](history/ROADMAP.md)：历史基线、审计、工程建议及早期路线。
- [`PLATFORM_2_0_COMPATIBILITY.md`](history/PLATFORM_2_0_COMPATIBILITY.md)、[`PLATFORM_2_0_CORE_CONTRACT.md`](history/PLATFORM_2_0_CORE_CONTRACT.md)、[`PLATFORM_2_0_PACKAGE_AND_PLUGINS.md`](history/PLATFORM_2_0_PACKAGE_AND_PLUGINS.md)：旧版兼容、Core 和插件/包契约参考。

旧场景和插件契约、兼容检查清单现已统一归档在 `docs/history/PLATFORM_2_0_*.md`，可作为迁移时的技术参考。当前迁移目标和优先级以本目录中的审计报告与插件建议为准。
