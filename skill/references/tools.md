# 功能工具：配置格式、写法与验收（新平台，4.4.6b 状态）

给 AI/作者用。原则：**作品 = 资源（结构）＋工具配置（纯数据）**。不为一个蛋白写专用插件；新算法才新增工具。下面五个通用工具都在 `plugins/mechanism-catalog.mjs` 注册，运行时 `layer-v1`（画在结构上的图层，无自带播放时钟），受众 `view` 与 `author`。

## 0. 模板是静态的，作品才用工具

目录项有 `zone`（`template` 静态 / `work` 动态）和 `topic`（`mechanism` 机理 / `protein` 蛋白质 / `local-system` 局部系统 / `cell` 细胞）。**模板不挂任何工具**（打开时 `makeStaticTemplate` 会去掉 `process`、`animation`、`states`），本文件讲的工具配置只属于作品。目录由 `node workshop/tools/build-index.mjs` 生成，不要手改 `index.json`。

## 1. 配置放哪里

- 配置：`scene.tools[].config`（场景 v3）；运行状态（已跑到的时间、干预）：`entry.state`。
- Studio 的编辑面板由描述符 `author.fields / validate` 自动生成；校验失败要给“指出哪一处”的中文报错，不要静默丢弃。
- 停用插件只隐藏图层、不删配置；社区包只含数据，**包内没有也不允许有脚本**。

## 2. 五个工具

| id | config 形状（摘要） | 要点 |
|---|---|---|
| `org.glow.tool.solution-particles` | `{ seed, scale: 'slow'\|'fast', pools:[{species,n}], flows:[{species,from,to,cps}] }` | `from/to` 是用选择语言写的残基组；每个粒子都有名称（H⁺、K⁺、ATP…），不能有无名粒子；`slow`=可看清的示意速度，`fast`=更接近真实尺度 |
| `org.glow.tool.data-animation` | `{ animation:{version:1,compartments,pools,flows,reactions,conserved?}, axis, membranes, seed, scale, kinetics? }` | 读取时检查每个引用（写了不存在的区室就报错）；`conserved` 声明守恒量，违反会记入 `violations`；台账 `ledger` 要平衡；`kinetics` 可加 pH/浓度/膜电位 |
| `org.glow.tool.stochastic-process` | `{ process:<Markov 声明>, schedule:[{time,...参数}], seed, display:[曲线] }` | 精确 Gillespie 抽样；滑块改参数＝用同一种子从头重放；`display` 的 kind：计数/时钟/电流等 |
| `org.glow.tool.translation` | `{ template:'ubq'\|'ermcl'\|'polyu'\|'custom', sequence, schedule:[{time,...浓度µM}], seed }` | 序列→密码子→核糖体速率表；药物（四环素等）和因子浓度可随时间变 |
| `org.glow.tool.multi-process` | `{ members:[{id,label?,kind:'translation'\|'process',timeScale?,...成员配置}], controls }` | 成员各有引擎/种子/时钟/计数；共享控件只作用到被指定的成员 |

## 3. 两个小语言

**安全表达式**（`plugins/simulation/expression.mjs`，没有 eval）：数字、名称、`+ - * / ^`、比较、`&& || !`、三元 `a ? b : c`、`exp log log10 sqrt abs min max pow floor ceil round clamp sign`；真值是数字（非 0 为真）；数据表以 `table(index)` 调用。写错会指出位置。

**Markov 声明**（`markov-model.mjs`）：`constants / parameters / variables / numbers / tables / derived / transitions / counters / clocks`；转移 `{id, when?, rate, set?, inc?, assign?, count?, outcomes?}`。速率公式要从经典代码原样搬来（同样的运算顺序，才能逐位相同）。

**选择语言**：残基组、配体、部件都用 `plugins/structure/selection.mjs` 的同一套写法。

## 4. 新增一个功能的工作流（对照优先）

1. 在经典 `src/` 找到原实现，**先写纯逻辑模块**（不碰渲染/下载/DOM）。
2. 写 `tools/<名>-parity.mjs`：经典代码在 Node `vm` 里原样运行（仅替换渲染辅助），同种子、同真实结构坐标，逐位比较；报告写入 `docs/parity/<名>-parity-report.txt`，登记 `docs/parity/cases.json` 与 `docs/feature-parity.json`。
3. 有意的差别要写进模块 README（例：两点路径画直线、事件在 t=0 也触发）。
4. 注册工具描述符（`runtime:'layer-v1'`、`audience`、`author.fields/validate`），Viewer 接面板（`syncControls` 可用性回调、`restoreStructureView` 加载、提交/关闭时重置、`sceneForExport` 保存）。
5. 固定步长（1/30 s）保证确定性；干预 = 在当前时间加一条时间表项并从同一种子重放。
6. 浏览器端到端：保存→关闭→重开后数值/像素一致；Studio 编辑往返。
7. `docs/routine/<日期>-<主题>.md` 写：做了什么、改了什么、下一步。

## 4b. 结构分析函数（纯函数，写进作品或 API 时直接用）

`plugins/structure/site-analysis.mjs`（相互作用、口袋表面、通道）、`measure.mjs`（距离/角度）、`membrane-placement.mjs`（自动定膜）。都是纯函数、都与经典逐位对照（`tools/site-parity.mjs`、`tools/membrane-parity.mjs`）；Viewer 里的面板只是接线。工具的证据行由 `toolEvidence(scene, host)` 生成（建模一行 + 每条假设一行示意），不要在作品里手写重复。

## 5. 哪些是证据、哪些是作品

- `plugins/simulation/test/kcsa-markov.mjs`（以及转发用的 `models.mjs`）：**验收用例**，证明引擎能表达 KcsA/ATP 等，不是随包发布的作品。
- 官方三件（ATP/KcsA/AdK）仍是过渡的专用播放器（`player-v1`）；新作品应写成工具配置。已随包发布的作品：`plugins/simulation/works/`（呼吸链、叶绿体：数据动画工具＋区室动力学，配置由 `mechanismWorkConfig` 从经典场景生成，科学卡 `*.card.json`）。
- 实验坐标、推导、建模、示意要在说明里分开；确定性重放不等于实验有效。

## 6. 现在做不到（别承诺给用户）

Studio 内粒子预览、细胞一角空间布局/拥挤绘制、70S 核糖体结构动画与原子特写、pH 体积着色、回退/干预界面、GPU 与桌面 EXE 实测。遇到这些，婉转告知“目前还在计划中”，并指向 `docs/STATUS.md`。
