# 当前主体＋插件平台（Desktop/Skill 0.11.0）

## 入口与能力

> 状态补记（2026-11-20）：下文写于 4.4 之前。呼吸链外的通用能力——溶液粒子、数据反应/区室、随机门控、翻译、多过程——已作为五个 `org.glow.tool.*` 工具接入新 Viewer/Studio（见 [tools.md](tools.md) 与仓库 docs/STATUS.md）；“通用数据反应仍待迁”一句已过时。

经典资产保留完整原有科学工作流；新 Viewer 已接入结构、基础 API 与 ATP/KcsA/AdK，Studio 已有多场景/关键帧/证据/书签与导出。呼吸链、光反应、鞭毛和经典作品的集中回归（4.4.8）仍待做，不把结构预览称为机制完成。

仓库文档以 docs/README.md 为入口；当前功能、架构、审计、ROADMAP、CODEX_MIGRATION_HANDOFF 分工明确。旧阶段文件在 docs/history，不作为当前计划。4.3.0 契约与 4.3.1–4.3.4 制作基底第一版已完成；4.4 经典功能按功能插件化已做到 4.4.6，下一项 4.4.7、4.5 作者/工坊闭环、4.6 新增科研插件、4.7 全量验收。经典已有分析优先恢复，新增科研才后置；Claude 最终处理全面前端/结构收尾。维护者本次单独授权的文档、EXE 和 Skill 更新不表示全迁移完成。

## 产品边界与作者流程

- 原始资源：蛋白质、复合体、配体及构象；保留来源、确切字节哈希、授权和署名，在工坊资源区复用。
- 功能插件：构象、路径/旋转、粒子流、反应/区室、测量/分析等工具；声明适用输入、参数、单位、输出及方法限制。
- 作品：使用资源与工具制作的动画、机制演示或分析成果；保存布局、规则/参数、时间轴、镜头、讲解、结果与能力版本，在工坊作品区分享。线粒体/呼吸链不是插件类别。
- 作者导入结构并调用工具，不必为每个作品写插件源码。需新增算法时才扩充功能插件；资源/作品不执行包内脚本。
- 现有 ATP/KcsA/AdK 专用实现混合了能力与内容，需逐项提取并兼容旧 ID；目标尚未实施，不能把文档约定当作新 UI/Schema 已完成。

### 从制作到发布（4.5）

1. Studio 导入结构或从工坊资源新建作品，添加工具，保存**工程**（`.glow-project`）继续编辑；编辑时本地每 3 秒自动留一份草稿，意外关闭后下次打开 Studio 会提示“恢复草稿”，用“保存项目”存成文件后草稿即清除。
2. 右侧“发布”标签：作者、授权（CC0 / CC BY / CC BY-SA）、主题、简介、标签、版本、更新日期、派生自。保存进场景的 `publication` 块；“读取工坊目录”后会提示已有的版本、可选的授权。
3. “发布检查”给出**问题 / 注意 / 说明**。问题会挡住发布：编号不合法、授权不认识、编号已被别人占用、新版没有升版本、放宽了 CC BY-SA、派生来源不存在或授权不兼容、用到的工具这个应用没有、资源不许嵌入。工坊的校验脚本跑的是同一套规则。
4. 通过后“导出场景”得到 v3 场景包（含原始坐标，即离线副本），放进工坊 `community/packs/<编号>.glow` 投稿；`node workshop/tools/validate.mjs` 与 `build-index.mjs` 同时认经典 v1 `.glow` 和这种 v2/v3 场景包。
5. 升级一个已发布作品：同作者、同编号、版本加 1（检查会提示下一个版本号）；从别人的作品派生：在“派生自”里选它，可选授权会按来源自动收窄（来源含 BY-SA 则只能 BY-SA）。
6. 打开别人的作品时，缺少的工具/插件不会让场景打不开：该部分不运行，其余照常显示，原因写在场景诊断里；旧工具编号按现行编号运行并提示。

## Studio 的作图与分析（0.9.0）

- 选择语言（`chain A and resi 10-50`、`within 5 of ligands`、`resn HIS`…）是所有作图与分析的输入。外观页对选择设表示/颜色/表面，规则写进结构文件 `provenance.viewerState`（`colors`、`styles`、`surfaces`、`measures`、`labels`、`bonds`、`plugins[面板编号]`、`camera` …），Viewer 读同一处；不要手造这些字段，用 Studio 的命令 `setViewerState` 与各模块的 `validate*`（`plugins/structure/look.mjs`、`annotations.mjs`、`molecular-surface.mjs`）。
- 镜头关键帧是 `presentation.cameraKeys`（时间 + 视角书签），`packages/schema/camera-track.mjs` 的 `cameraAt` 在 Studio 与 Viewer 里共用。
- 插件面板规矩见 `packages/plugin-host/panels.mjs`：面板只读结构（`api.model()/models()`）和选择，只能通过 `applyLook`、`annotate`、`addEvidence`（只能记“推导/建模”，必须写明方法）、`placePart`（整条链的刚性移动，不碰坐标文件）、`setData`（自己的命名空间，≤ 64 KB）写回。新增分析一律做成面板，不要各搞一套界面。
- AI 怎么直接操作这些功能：`window.studio` 命令接口和制作规范见 [studio_authoring.md](studio_authoring.md)（实现 `apps/studio-web/studio-commands.mjs`）；Studio 的“过程”页签实时显示每一步，可回到某一步之前。光影包（`plugins/structure/look-packs.mjs`，渲染 `packages/render-three/glow-style.mjs`）只改外观。
- 现有五个面板：界面接触（含氢键/盐桥/疏水分类，距离判据、无角度）、组成与性质、序列与二级结构、结构叠合（Cα 的 Horn 拟合，可跨结构）、分子表面与静电（高斯表面 + 简化库仑，不是 APBS）。每个面板的限制写在 `plugins/packages/*.json` 的 `status.limits` 里；对外说明时要如实引用。
- 验证叠合/放置一类几何功能时，要用导出文件里的变换和原始坐标**独立重算**一遍（见 `tools/superposition-check.cjs`、`tools/cross-superposition-check.cjs`），不要只看数字合理——跨结构的坐标系错误就是这样抓到的。

## 在仓库里实现

- apps/viewer-web 协调加载/UI，mechanism-runtime 只适配原场景/player；packages 提供 Core、Schema、宿主、渲染、兼容和编辑器。
- plugins/structure、rcsb 提供结构与来源；mechanism-catalog 是应用受信目录，当前三个机制有各自版本和 scientific-card.json。
- 插件使用同一场景、时钟、选择、镜头与资源生命周期。不要复制第三套解析/动力学/会话。
- 社区 .glow 只提供数据；v1 声明只匹配已安装播放器；v2 是带原始资源与哈希的 ZIP。用仓库 Schema/导出器，不手造二进制格式。

## 科学与对照

新机制加入官方目录时要有匹配 ID/版本的科学卡：结构来源与原始哈希、物种/代用构象、实验/推导/建模/示意、方程、参数/单位、时钟、假设、限制与文献。

feature-parity.json 和 docs/parity/cases.json 绑定经典/新版案例、数据和预期。planned/manual/partial 不能计通过；改模型或比较器后数值报告源码哈希失效，须重跑并审查。已有报告只证明选定不变量：ATP 生产/释放语义、KcsA 动画阻塞/随机时钟、AdK 初始相位/叠合仍有差异；AdK 两态不是催化反应。

## 命令与嵌入

window.glow 是页面内接口，先 help() 了解当前入口：它列出命令，也列出已注册的工具及其运行参数。新版现已支持选择语言、measure、sequence、按整条链的 color、clip 和经典写法的 camera（orbit / az,el,dist / focus）；`show(选择, cartoon|backbone|blob|sticks|hidden)`（对选择换表示，PyMOL 的 show/hide）、`color(选择, 颜色|hydrophobicity|bfactor|charge|secondary)` 按残基上色也已支持；经典的 style（画风）尚未迁移，被明确拒绝而不是静默忽略。导出新版返回 glow-v2 的 base64 包装，不能假装是 v1 对象。

embed=1/dev=1 只启用桥。固定可信 origin 也需要用户明确授权；请求绑定父窗口/opener、origin 和当前场景。控制只回确认，info/snapshot/exportPack/log/sequence/measure 为单独敏感权限；撤销/换场景使权限失效。URL origin 参数不能自授权。同源页面仍有原有 DOM 权限；完整插件沙箱待收尾。

## 检查和交付

按任务执行 npm test、node tools/check-feature-parity.mjs、构建/副本与 15 包数据校验；数值脚本使用固定原始坐标，不能用重新生成的假数据代替真实结构。

源码、暂存、真正 Windows EXE 分开验证三个入口和所有已安装机制，记录保存重开、取消/失败、停插件和资源释放。人工查看宽/窄截图，不凭窗口存在或退出码验收。只有所有契约与完整行为关闭，才写最终迁移报告和 migration-complete 标签。

仓库与最新文档：[GitHub](https://github.com/Nimenta727/molecule-glow-viewer)。独立 Skill 资产是经典实现；要修改新平台，先取得仓库源码。
