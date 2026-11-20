# 分子光影查看器 · Molecule Glow Viewer

从真实分子结构到教学机制与细胞场景的 Three.js 查看器。项目正在把 Claude 经典 Viewer 的科学功能迁入 **Core 主体＋官方插件**；经典入口保留，新平台尚未达到完整功能和视觉等价。

目标流程：**导入蛋白质等原始资源 → 使用动画/模拟/科研功能插件 → 制作并分享作品**。创意工坊将分资源区与作品区；线粒体、呼吸链等属于作品。执行顺序为**制作基底 → Claude 经典已有功能按功能插件化 → 新增科研插件**。现有专用播放器尚需按此边界拆分，详见 [架构与当前差距](docs/ARCHITECTURE.md)。

**最新进度**：见 [项目现状](docs/STATUS.md)——4.4.0–4.4.7 的功能工具已在新 Viewer/Studio 中接入，测试 390/390，经典对照逐位一致；经典作品回归（4.4.8）尚未做，桌面/GPU 尚未验证。

**Desktop v0.5.0（已发布的旧构建，不含 4.4 之后的功能）**：[Windows 便携 EXE](https://github.com/Nimenta727/molecule-glow-viewer/releases/download/desktop-v0.5.0/MoleculeGlow-0.5.0-win-x64.exe) · [发行说明与校验文件](https://github.com/Nimenta727/molecule-glow-viewer/releases/tag/desktop-v0.5.0) · [制作 Skill ZIP](https://github.com/Nimenta727/molecule-glow-viewer/releases/download/desktop-v0.5.0/molecule-glow-viewer-skill-0.5.0.zip)

![经典 ATP 合酶](docs/images/example_atp_synthase.jpg)

## 使用入口

| 入口 | 当前用途 |
|---|---|
| [经典在线版](https://nimenta727.github.io/molecule-glow-viewer/) / [web/index.html](web/index.html) | 完整经典科学体验：结构、配体、机制、翻译、区室、全细胞及工坊；也是迁移对照与回退入口 |
| Windows EXE | 默认经典 Viewer；菜单进入新 Viewer、Studio 和经典工作台。Three.js 随包，缓存或包内的结构可离线使用 |
| [新版 Viewer](apps/viewer-web/) | 主体＋插件的迁移目标：PDB/mmCIF、RCSB/组装体、五种表示、选择语言/序列条/拆装/全原子界面、v2 保存重开、ATP/KcsA/AdK 播放器，以及通用工具：溶液粒子、数据动画、随机过程、翻译、多过程 |
| [Studio](apps/studio-web/) | 多场景工程、对象编辑、关键帧、讲解/证据、镜头书签及 v2 导出；工具面板按描述符自动生成；完整科研制作区仍待整合 |
| [制作 Skill](skill/README.md) / [工坊](workshop/) | 为 AI/作者制作结构、教学场景和插件；社区包只含数据，不执行包内脚本 |

Pages 目前主要部署经典版与工坊；新版/Studio 使用桌面菜单或源码服务器。源码运行：`npm ci`，在根目录执行 `python -m http.server 8765`，打开 `http://localhost:8765/apps/viewer-web/`；桌面构建见 [desktop/README.md](desktop/README.md)。

## 当前能力与边界

经典版保留小分子 CCD/价键、结合位点/相互作用、选择与序列、拆装/界面、自动简介/定膜、呼吸链、光反应、翻译、细胞一角、全细胞和区室模拟。这里列的是经典能力，不等于已迁入新版。

新版已接入结构工作流、三个官方机制、五个通用工具（`org.glow.tool.*`，见 [现状](docs/STATUS.md)）及基础命令接口；ATP 生产/释放计数、KcsA 时钟/随机流、AdK 叠合/相位存在已记录差异。复杂过程仍以结构兼容为主。15 个旧包的数据校验和结构恢复不能当作 15 个机制全部可播放。

中间构象、粒子、膜及时间区分实验、推导、建模和示意；确定性不等于实验有效性。官方机制附科学验证卡，状态由 [feature-parity.json](docs/feature-parity.json)和可复验记录约束。

## 文档与开发

[文档首页](docs/README.md) · [项目现状](docs/STATUS.md) · [现有功能](docs/CURRENT_FEATURES.md) · [项目结构](docs/ARCHITECTURE.md) · [当前审计](docs/AUDIT.md) · [后续计划](docs/ROADMAP.md) · [Claude 交接](docs/CODEX_MIGRATION_HANDOFF.md)

旧阶段规划、审计和实测叙述统一进入 [history](docs/history/README.md)。机器契约、来源、图片和验收 JSON 保留稳定路径；routine 不纳入此次整理。

检查：`npm test`、`node tools/check-feature-parity.mjs`、`node tools/build.mjs --check`、`node tools/check-copies.mjs`、`node workshop/tools/validate.mjs`。实际 EXE 验收见 [发布验证](docs/RELEASE_VALIDATION.md)。

经典 `src/` 构建到 web、桌面与 Skill；新功能迁移使用 `apps/`、`packages/`、`plugins/`。保留经典基线，不以静态预览、孤立关键帧或代码行数宣布迁移完成。
