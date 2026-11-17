# 分子光影：总体开发框架

> 本文是当前项目的主开发总纲。它把现有代码、审计结论、历史规划和后续平台方向合并成一份可执行的说明。  
> 历史审计、路线图和交接文档保存在 [`history/`](history/)；它们用于追溯决策，不再作为新的任务清单。

## 1. 项目定位

分子光影是一个**以真实结构数据为锚点、面向教学与演示的生物分子实时 3D 平台**，不是通用分子动力学软件，也不是 ChimeraX、PyMOL 或 VMD 的替代品。

平台围绕四个层级组织内容：

1. **细胞**：区室、膜、拥挤、浓度、方向和局部系统入口；
2. **局部系统**：呼吸链、光反应、翻译、离子通道和多个分子机器的协作；
3. **蛋白质 / 复合体**：结构、配体、构象、亚基、界面和通道；
4. **分子机理**：一个对象在结合、门控、催化、转移或释放过程中的步骤链。

平台的核心原则是明确区分：

| 类别 | 含义 |
|---|---|
| 实验 | 来自 PDB、CCD、UniProt 或论文的数据 |
| 推导 | 从结构或注释计算出的膜、孔道、接触、功能核心等 |
| 建模 | 拼接、插值、AlphaFold 或作者提供的模型 |
| 示意 | 为教学而放大的路径、粒子、时间和空间关系 |

任何新功能都必须保持这种证据分层，不能把教学示意伪装成实验事实。

## 2. 当前已经完成的能力

### 2.1 查看器与结构数据

当前 Web 查看器已经支持：

- 任意 PDB 编号从 RCSB 下载；
- mmCIF / PDB 解析；
- 生物学组装体展开；
- 本地 `.cif`、`.mmcif`、`.pdb` 导入；
- 配体、核苷酸、离子和脂质加载；
- CCD 键级；
- UniProt 功能位点和跨膜信息；
- 结构来源、分辨率、实验方法、物种和论文信息；
- RCSB / UniProt 数据请求。

主要入口：`src/data/parse.js`、`src/data/rcsb.js`、`src/core/load-scene.js`。

### 2.2 表示、外观和交互

已实现：

- 团块；
- 螺旋 / 折叠结构示意；
- 低分辨率表面；
- 小分子球棍、价键、空间填充；
- 膜、双膜、剖切；
- 按实体、链、序列方向配色；
- 白底墨线和黑底发光两种画风；
- Bloom、AO、景深、边缘光、自发光；
- 比例尺、标签、讲解卡、能量条；
- 相机旋转、平移、缩放、自动环绕；
- 画质档位和低帧率降级。

主要目录：`src/repr/`、`src/view/`、`src/ui/`、`src/styles/`。

### 2.3 选择、分析和教学功能

已实现：

- 残基、链、部件和配体选择；
- author / label 编号；
- `within` 等选择表达式；
- 测距；
- 序列条、缺失残基和 UniProt 功能位点；
- 配体聚焦；
- 结合位点、热点、孔道和隧道推导；
- 亚基拆装和界面印记；
- 构象插值和自动 Morph；
- 实验 / 推导 / 建模 / 示意证据徽章；
- 细胞 → 局部系统 → 蛋白质的进入和返回导航。

主要目录：`src/derived/`、`src/ui/`、`src/api/`。

### 2.4 已实现的过程模拟

`src/sim/processes/` 已包含：

- ATP 合酶；
- KcsA 钾通道；
- 核糖体翻译；
- 呼吸链；
- 叶绿体光反应；
- 鞭毛马达；
- 细胞一角；
- 整个细胞；
- 任意 PDB 自动模式；
- `.glow` 纯数据动画。

模拟基础设施已经包含：

- 随机种子；
- 事件日志；
- 暂停、单步、快放和慢放；
- 粒子池、分子路径和避障；
- 质子账本；
- 过程 HUD 和计数器；
- 同 seed 确定性回放。

### 2.5 场景包、工坊和开发者接口

已实现 `.glow` v1 场景包：

- 场景元数据、结构、链、组件、膜、配色、相机、讲解；
- 内置过程引用；
- 纯数据动画；
- 证据说明；
- seed；
- 导入、导出、校验和 SHA-256；
- 官方 / 社区工坊；
- GitHub Issue 投稿；
- GitHub Discussions 评分与评论统计；
- 举报和自动暂存。

当前有 15 个官方场景包，校验脚本已验证通过。

开发者能力：

- `web/dev.html` JSON 编辑与实时预览；
- `window.glow` 命令接口；
- `postMessage` 嵌入桥；
- 命令日志与重放；
- `__viewer.probe()` 回归诊断。

主要目录：`src/pack/`、`workshop/`、`desktop/scripts/`、`src/api/`。

## 3. 当前源代码结构

```text
src/                         查看器唯一开发源
├── index.html.tpl           HTML 组合模板
├── ui/                      页面结构、控件、标签、讲解和工坊 UI
├── core/                    启动、状态、加载、清场、生命周期入口
├── data/                    PDB/mmCIF、RCSB、预设、外部注释
├── derived/                 选择、孔道、口袋、几何和其他推导
├── repr/                    团块、cartoon、表面、分子和膜表示
├── sim/                     过程模拟、粒子、时间、动画和细胞动力学
├── view/                    Three.js 渲染器、相机、帧循环和布局
├── api/                     window.glow、测量、命令和嵌入桥
├── pack/                    .glow 规则、导入导出和工坊
└── styles/                  查看器样式

tools/                       构建和副本检查
web/                         GitHub Pages 发布物，由 src/ 生成
desktop/                     Electron 桌面端、同步、回归和打包
workshop/                    官方/社区场景包、索引、校验和 CI 工具
skill/                       教人和 AI 制作场景的资料及查看器副本
docs/                        当前总纲
docs/history/                历史审计、路线图、工程规范和交接文档
.github/workflows/           Pages、工坊、投稿和统计自动化
```

源码关系必须保持：

```text
src/index.html.tpl + src/**/*.js/css
              │
              └── node tools/build.mjs
                    ├── web/index.html
                    └── web/dev.html

web/index.html
  ├── skill/assets/viewer.html
  └── desktop/app/index.html
```

不得直接修改生成的 `web/`、`skill/assets/` 或 `desktop/app/` 文件。

## 4. 运行与交付方式

### 4.1 HTML / Web 版

Web 版是最轻量、最容易分享的交付形态：

1. 修改 `src/`；
2. 运行 `node tools/build.mjs`；
3. 运行 `node tools/check-copies.mjs`；
4. 通过 GitHub Pages 发布 `web/` 和 `workshop/`；
5. 用户可直接打开网页或本地静态服务器运行。

Web 版的结构和注释必须保持可单文件发布，Three.js 依赖通过 import map 加载。

### 4.2 Electron / EXE 桌面版

桌面版通过 `desktop/main.js` 提供安全的 `app://glow/` 页面：

1. `desktop/scripts/sync.js` 先构建并同步 `web/`；
2. Electron 从 `desktop/app/` 启动；
3. Three.js 供应到 `desktop/vendor/`；
4. RCSB / UniProt 数据写入用户目录缓存；
5. `npm run dist` 通过 electron-builder 构建 Windows portable EXE。

桌面版必须与 Web 版使用同一份生成物。桌面专属能力只能放在 `desktop/`，不能复制一套查看器逻辑。

### 4.3 验证门槛

每次查看器改动至少运行：

```bash
node tools/build.mjs --check
node tools/check-copies.mjs
node workshop/tools/validate.mjs
cd desktop && node scripts/regress.mjs
```

桌面回归需要安装 `desktop/node_modules`。它应覆盖固定场景、快速切换、重复载入、确定性、导航恢复、桥接安全和资源清理。

## 5. 目标架构

当前代码已经完成源码拆分，但还没有完全形成平台级模型。目标运行时分为：

```text
SceneDefinition
    ↓
StructureModel
    ↓
DerivedModel
    ↓
SimulationState / SimulationEngine
    ↓
RepresentationState
    ↓
ViewState
    ↓
Renderer
```

### 5.1 StructureModel

统一保存 entry、assembly、entity、chain、residue、atom、ligand、provenance。所有选择、表示、测量和模拟锚点都通过它访问结构，不再各自维护重复索引。

### 5.2 DerivedModel

统一管理二级结构、膜方向、孔道、口袋、接触、界面、功能核心、LOD 和空间索引，并记录每个推导的算法来源和证据级别。

### 5.3 SceneSession 与 ResourceRegistry

每次加载建立独立 `SceneSession`，拥有：

- AbortController；
- 结构请求；
- Worker；
- 动画；
- 事件监听；
- Three.js 资源；
- 模拟随机源；
- 当前选择和相机状态。

所有资源登记到 `ResourceRegistry`，场景退出时统一释放。快速切换 20 次后，只允许最后一个场景继续更新。

### 5.4 统一 Representation

目标是让同一个选择集叠加多个表示，并支持按链、残基、功能部件和 LOD 切换：

```text
Representation {
  id
  selection
  style
  build()
  update()
  dispose()
}
```

### 5.5 统一 SimulationEngine

每个过程应逐步迁移到：

```text
create(context)
step(state, dt)
observe(state)
serialize(state)
dispose()
```

模拟必须能暂停、单步、重放、保存、恢复，并在无渲染环境中测试。

## 6. 总体开发路线

### 阶段 A：稳定基础

- 完成 SceneSession、ResourceRegistry 和取消加载；
- 固定回归场景和性能基线；
- 统一清场、Worker、事件监听器和动画协程；
- 保持现有视觉和过程不变。

### 阶段 B：结构与选择统一

- 建立 StructureModel；
- 建立 DerivedModel；
- 统一 author / label 编号；
- 统一选择集；
- 将配体焦点、序列条、测量、孔道和界面分析接入选择集。

### 阶段 C：表示和性能

- 建立 Representation 接口；
- 支持一个选择集叠加多种表示；
- 实现 LOD、实例化、抽样、可见性裁剪；
- 将表面、接触和空间索引放进 Worker；
- 按帧率自动降级后处理、标签和表面质量。

### 阶段 D：模拟引擎

- 迁移 ATP 合酶、KcsA、翻译、呼吸链和叶绿体；
- 统一状态、参数、事件、seed、计数器和 replay；
- 分离模拟模型与 Three.js 表示；
- 增加无渲染单元测试。

### 阶段 E：三层导航与可保存状态

- 细胞 → 局部系统 → 蛋白质；
- 保存来源场景、目标部件、选择集、相机、模拟时间和干预参数；
- 返回时恢复状态，而不是重新创建无关场景；
- 将拆装、Morph、模拟控件写入场景包。

### 阶段 F：分子机理工作台

- 增加 `MechanismDefinition`、步骤、证据、干预和时间线；
- 支持播放、暂停、单步、跳步、回到结构；
- 增加腺苷酸激酶、KcsA 过滤器、ATP 合酶催化口袋模板；
- 让第四个“分子机理”入口真正可用。

### 阶段 G：工坊 v2、科研和演示

- `.glow` v2 增加 provenance、entryPoints、observables、controls、camera bookmarks 和 compatibility；
- 支持科研导出、接触表、会话文件、方法说明、BibTeX；
- 支持 ChimeraX / PyMOL 格式互通；
- 支持分镜、演示模式、录屏和嵌入式只读运行；
- 视需要接入程序内登录和评分。

## 7. 新模型、插件和光影包

### 7.1 接入新的生物结构模型

新模型可以来自：

- PDB / mmCIF；
- AlphaFold 或其他预测模型；
- 用户自有结构；
- 多结构构象集合；
- 由多个 PDB 组件组成的教学场景。

接入步骤：

1. 核对结构来源、许可证、链和编号；
2. 确定是实验、推导、建模还是示意；
3. 在 `src/data/presets.js` 增加纯数据预设；
4. 指定组件、膜、配体、相机、证据和过程；
5. 如需过程，在 `src/sim/processes/` 注册状态机；
6. 如需工坊内容，导出 `.glow`；
7. 加入 `desktop/scripts/regress-scenes.json`；
8. 更新引用、教学说明和回归基线。

不得只凭记忆填写 PDB、链名、残基编号或机制结论。

### 7.2 接入新的 AI / 外部模型

AI 不应直接改 Three.js 场景或执行任意代码。目标方式是通过制作区的受限命令接口：

```text
AI Provider
  → Studio Adapter
  → window.glow / postMessage
  → 场景包、选择、表示、相机和校验
```

AI 适配器需要：

- provider 名称和版本；
- 模型能力声明；
- 请求和响应 schema；
- 超时、取消和错误码；
- 不把密钥写入仓库；
- 只能通过白名单命令操作主体；
- 输出可审查的 `.glow` 或变更预览。

计划支持：

- Claude；
- OpenAI-compatible；
- 本地模型；
- 后续其他兼容 JSON / tool calling 的模型。

### 7.3 插件系统

插件分为两类：

1. **纯数据插件**：场景、机理、分镜、会话和光影包；社区可以上传，查看器只解释数据；
2. **功能插件**：科研、演示、格式互通、AI 和 Python；只能通过沙箱和受限 API 访问主体。

插件描述文件应包含：

```json
{
  "id": "official.research-tools",
  "version": "1.0.0",
  "type": "functional",
  "api": "glow-plugin-v1",
  "permissions": ["readStructure", "readSelection", "exportData"]
}
```

插件必须声明权限、兼容查看器版本、依赖和许可证。社区功能插件不能默认执行；官方或审核后的插件才可安装。

### 7.4 光影包

光影包是可替换的视觉数据/配置层，不应复制主体逻辑。它可以定义：

- 背景；
- 调色板；
- 墨线；
- 材质；
- Bloom、AO、景深参数；
- 标签样式；
- 粒子颜色和半径；
- 默认表示和画质策略。

白底墨线是主体默认风格；黑底发光及未来风格应逐步迁移为光影包。光影包必须只改变表现，不改变结构事实、选择语义和模拟结果。

## 8. 教会 AI 与后续开发者制作内容

### 8.1 AI 开发协议

AI 接手任务时必须按顺序：

1. 阅读本文；
2. 阅读 `src/README.md`；
3. 阅读与任务相关的 `docs/history/` 审计和工程规范；
4. 搜索现有实现和类似功能；
5. 只修改所属目录；
6. 不修改生成物；
7. 为新视觉内容增加证据等级和粒子名称；
8. 运行构建、工坊校验和回归；
9. 记录改动、验证结果、已知限制和后续任务。

AI 不得：

- 删除现有功能换取架构整洁；
- 把示意数据标成实验；
- 静默吞掉结构或科学错误；
- 复制外部软件代码；
- 在场景包中执行代码；
- 为通过截图而伪造计数或隐藏结构。

### 8.2 人类开发者协议

每个工作包要有：

- 目标和依赖；
- 修改目录；
- 数据来源与许可证；
- 验收标准；
- 回归场景；
- 文档更新；
- 提交说明。

共享文件 `src/index.html.tpl`、`src/ui/`、`src/api/`、`tools/build.mjs` 改动前要先登记。架构里程碑结束后要进行只读审计。

### 8.3 内容作者制作场景

推荐流程：

1. 打开 `web/dev.html`；
2. 调整结构、配色、膜、相机、标签和说明；
3. 使用 `glow.validatePack()` 校验；
4. 导出 `.glow`；
5. 补充引用、证据、作者和许可证；
6. 使用工坊投稿流程提交；
7. 等待 CI 校验和维护者审核。

社区动画只使用 `flows`、`reactions`、`pools`、`compartments` 等数据字段，不上传 JavaScript。

## 9. 完成标准

项目达到平台目标时，应满足：

- Web 和 EXE 使用同一查看器源；
- 快速切换场景无串场、无资源泄漏；
- 同一结构可以在细胞、局部系统和蛋白质层级导航；
- 模拟可暂停、重放、解释和复现；
- 结构事实、推导、建模和示意清晰可见；
- 大结构在目标硬件上达到可用帧率；
- 新增过程只需注册状态机、表示映射和教学说明；
- 场景、参数、选择、相机和模拟状态可保存恢复；
- 新插件有权限和兼容性边界；
- 新光影包不会改变科学内容；
- AI 和后续开发者可以按本文独立完成扩展。

## 10. 历史文档索引

`docs/history/` 中保留：

- `AI_AUDIT_AND_STABILIZATION.md`：第一轮审计、工程不变量和 AI 修改协议；
- `AUDIT_ROUND2.md`：严格审计、缺陷分级和回归要求；
- `PLATFORM_AUDIT_REPORT.md`：产品定位和平台化方向；
- `PLATFORM_ENGINEERING_SPEC.md`：目标数据模型、生命周期、性能和实施批次；
- `HANDOFF_PLAN.md`：原始工作包、分工、验收和进度表；
- `HANDOFF_CORE_PLUGINS.md`：主体、制作区、插件和光影包方向；
- `ROADMAP.md`：阶段性已完成记录和旧路线图。

这些文件保留决策背景；新的实施状态以本文和实际代码、测试结果为准。
