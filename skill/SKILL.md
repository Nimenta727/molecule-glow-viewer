---
name: molecule-glow-viewer
description: Create and edit molecular teaching scenes and trusted plugins in Molecule Glow Viewer, or use its bundled classic viewer for protein and mechanism demonstrations. Distinguish classic capabilities from the migrating Core-plus-plugin platform.
---

# 分子光影制作 Skill

为现有 Molecule Glow Viewer 制作结构场景、机制、教学讲解和可分享的纯数据包。经典 Viewer 与新主体＋插件并存；先选择实际入口，不把经典能力当作已迁入新版。

## 资源、功能插件和作品

插件提供可复用动画、模拟与科研分析功能；蛋白结构是资源，线粒体/呼吸链等演示是作品。工坊目标为资源区＋作品区，制作流程为导入结构→配置工具→预览→保存/分享作品。现有 ATP/KcsA/AdK 专用模块是待拆分的过渡实现，不能照此为每个作品新增插件。优先把内容存为数据；仅在缺少可复用算法时新增有适用输入/参数/输出契约的功能工具。科研结果保留方法、单位、限制及来源。

## 当前进度（一句话）

4.3 制作基底第一版已闭环；4.4.0–4.4.7 已做：功能工具（溶液粒子、数据动画、随机过程、翻译、多过程）已注册，结构分析（结合位点/口袋/通道/测量/自动定膜）也与经典逐位对照；4.4.8 经典作品回归未做；尚无真实 GPU/桌面验证。详见仓库 docs/STATUS.md。

## 开发优先级

先实现软件制作基底，再把 Claude 经典已有的制作、动画、模拟、表示/操作、讲解及分析能力按功能拆成专用工具，之后扩展新增科研插件。经典已有测量/口袋/序列等不延后。先接通导入资源、实例编辑、工具配置、预览和可编辑保存；不要直接按作品名新增播放器。当前执行编号见仓库 ROADMAP，旧编号不能覆盖最新顺序。

## 选择工作路径

- **独立演示/经典场景**：使用 [assets/index.html](assets/index.html)（viewer.html 是同一构建别名）和 [assets/dev.html](assets/dev.html)。配套文件保持相邻。打开后可输入 PDB、导入本地 PDB/mmCIF、使用已有经典机制；需要 http 时在该目录启动本地服务器。
- **仓库内迁移/新插件**：先读 [references/platform.md](references/platform.md)，再读仓库 docs/CODEX_MIGRATION_HANDOFF.md、ROADMAP.md、feature-parity.json。新功能放 packages/plugins，保留经典基线，不在经典资产里重写平台。
- **分享/工坊**：经典 v1 场景格式见 [references/scene_packs.md](references/scene_packs.md)；新平台 v2 用 Viewer/Studio 导出和 Schema 校验。新版通用数据动画已作为 `org.glow.tool.data-animation` 接入（配置见 tools.md）；旧 v1 包静态可见不代表其反应已按作品配置播放。

## 制作原则

1. 在现有实现上扩展。仓库经典改 src 片段后构建/同步；不要手改 web 或 Skill 的生成副本。新平台使用受信目录的官方插件，社区包不执行代码。
2. 结构来自 RCSB 或用户文件；固定编号、实体、配体前按 [structures.md](references/structures.md)核对。测试可使用带来源/原始哈希的真实缓存文件，不内嵌大坐标数据。
3. 每个机制区分实验坐标、推导、建模、示意。参数有单位、时间有语义、粒子有名称；不能用孤立模型运动代替反应/通量。软件重放一致不等于实验有效。
4. 迁移按经典同结构/参数比较（写纯逻辑→经典原样跑→逐位对照→再接 UI，步骤见 [tools.md](references/tools.md)）；RNG、时钟、叠合或计数不同就记录。ATP/KcsA/AdK 已有科学卡，但完整科学/视觉等价未完成。
5. 沿用现有样式。最终画风、布局、全面前端合并与制作区整合遵循 handoff；功能/安全所需的局部控件和适配可随任务处理。

## 参考路由

| 任务 | 阅读 |
|---|---|
| 主体＋插件迁移、当前功能、发行/验收 | [platform.md](references/platform.md) |
| 写/改功能工具配置、新增工具、对照流程、表达式与 Markov 声明 | [tools.md](references/tools.md) |
| 经典源码定位、已有模拟站 | [architecture.md](references/architecture.md)（经典实现参考） |
| 写经典过程动画 | [processes.md](references/processes.md) |
| 论文转演示 | [paper_to_animation.md](references/paper_to_animation.md) |
| 画风与小分子 | [style_guide.md](references/style_guide.md)、[small_molecules.md](references/small_molecules.md) |
| 参数/预设、环境、排错 | [parameters.md](references/parameters.md)、[setup.md](references/setup.md)、[troubleshooting.md](references/troubleshooting.md) |

## 验证与交付

浏览器实际打开并人工查看 1440/560 截图；确认分子可见、计数/状态在运行、选择/参数可操作。验证保存重开和插件停用/资源释放，失败或取消不能污染当前场景。无报错或静态预览不能作为动态机制验收。

仓库按当前任务运行 `npm test`（当前 390 项）、Node、构建/副本、场景包、功能契约及对应浏览器回归。桌面交付必须从实际 EXE 验证，不借仓库补模块；版本与源码提交、哈希随产物记录。发布/投稿/推送只在用户授权范围内执行。

独立 Skill 包提供经典运行资产和制作指南；新平台源码开发需要仓库。不要把 ZIP 的经典 HTML 说成完整新平台或离线结构全集。包内 skill-manifest.json 说明版本、构建提交及文件哈希。
