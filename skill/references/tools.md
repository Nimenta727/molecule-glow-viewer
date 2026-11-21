# 功能工具：配置格式、写法与验收（新平台，4.4.6b 状态）

给 AI/作者用。原则：**作品 = 资源（结构）＋工具配置（纯数据）**。不为一个蛋白写专用插件；新算法才新增工具。下面五个通用工具都在 `plugins/mechanism-catalog.mjs` 注册，运行时 `layer-v1`（画在结构上的图层，无自带播放时钟），受众 `view` 与 `author`。

## 0. 模板是静态的，作品才用工具

目录项有 `zone`（`template` 静态 / `work` 动态）和 `topic`（`mechanism` 机理 / `protein` 蛋白质 / `local-system` 局部系统 / `cell` 细胞）。**模板不挂任何工具**（打开时 `makeStaticTemplate` 会去掉 `process`、`animation`、`states`），本文件讲的工具配置只属于作品。目录由 `node workshop/tools/build-index.mjs` 生成，不要手改 `index.json`。

## 1. 配置放哪里

- 配置：`scene.tools[].config`（场景 v3）；运行状态（已跑到的时间、干预）：`entry.state`。
- Studio 的编辑面板由描述符 `author.fields / validate` 自动生成；校验失败要给“指出哪一处”的中文报错，不要静默丢弃。
- 同一个工具可以带**预设**（`author.presets: [{ id, label, config }]`，注册时就用 `validate` 检查）：例如两态构象工具 `org.glow.tool.conformation-pair` 除 AdK 外有“麦芽糖结合蛋白（1OMP 开 / 1ANF 闭）”，在 Studio“添加工具”下拉里选。新蛋白先看有没有预设，没有就用默认模板改字段：状态编号、链、名称正则、参考域、各域残基范围（写作 `1-109, 264-309`）、参考配体。各域必须覆盖整条链的每个残基；没写进任何域的残基按参考域上色。
- 描述符还可声明 `outputs`（产出什么：计数/曲线/状态/事件/文件）与 `dependencies`（需要哪个插件及精确版本）。
- 停用插件只隐藏图层、不删配置；社区包只含数据，**包内没有也不允许有脚本**。

## 2. 五个工具

| id | config 形状（摘要） | 要点 |
|---|---|---|
| `org.glow.tool.solution-particles` | `{ seed, scale: 'slow'\|'fast', pools:[{species,n}], flows:[{species,from,to,cps}] }` | `from/to` 是用选择语言写的残基组；每个粒子都有名称（H⁺、K⁺、ATP…），不能有无名粒子；`slow`=可看清的示意速度，`fast`=更接近真实尺度 |
| `org.glow.tool.data-animation` | `{ animation:{version:1,compartments,pools,flows,reactions,conserved?}, axis, membranes, seed, scale, kinetics?, energy? }` | 读取时检查每个引用（写了不存在的区室就报错）；`conserved` 声明守恒量，违反会记入 `violations`；台账 `ledger` 要平衡；`kinetics` 可加 pH/浓度/膜电位；`energy` 是能量转化条（见下） |
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

## 能量转化条（`energy`，数据动画工具的可选字段）

作品顶部的一排步骤：动画播放时按顺序轮流点亮，点一步看讲解并标出这一步涉及的结构，“◎ 跟随”可在播放时自动标出。

```json
"energy": {
  "steps": [
    { "label": "NADH 交出电子", "text": "点开后显示的讲解（纯文字，最多 1600 字）", "select": "entity \"/^复合体 I$/\"" },
    { "label": "泛醌池", "text": "没有 select 的步骤只显示讲解" }
  ],
  "stage": { "mode": "cycle", "period": 28 }
}
```

- `steps`：1–12 步；`label` ≤ 40 字；`select` 是选择表达式（与选择面板、`glow.select` 用同一种语言），写错只在点击时报告，不影响其它步骤。
- `entity "名字片段"` 是包含匹配（会同时命中“复合体 I / II / III”）；要精确匹配写成正则：`entity "/^复合体 I$/"`（不分大小写，≤ 198 字符）。
- `stage.mode`：`manual`（读者点哪步看哪步）或 `cycle`（按动画时钟轮流，`period` 为轮流一圈的动画秒数，2–120）。轮流只是顺序示意，不表示分子真的走到了哪一步。
- Studio 的工具页签会为每一步生成名称、讲解、涉及结构三个编辑框。

## 回退与干预（数据动画工具的 `state`）

数据动画按固定 1/30 秒步长、由种子决定，所以能回到过去：面板里的“时间”滑块和“后退/前进 5 秒”会用同一个种子从头重放到那一刻。

- **干预**＝在当前时刻改一个开关、滑块、“快慢”或“时间尺度”。改动立即生效，并记入干预记录（滑块在松手时记一条，拖动过程不记）。
- **回退后再干预**会结束原来的未来：这一刻之后的记录作废。只回退、不改动，再往前播放，会在同样的步数重现同样的改动，得到同样的画面。
- 保存作品时，只要有干预记录，就把它和当时的步数写进该工具条目的 `state`：
  `{ "version": 1, "step": 90, "interventions": [ { "step": 30, "kind": "control", "id": "oligo", "value": true }, { "step": 60, "kind": "pace", "value": 2 }, { "step": 75, "kind": "scale", "value": "fast" } ] }`
- `kind` 只能是 `control`（`id` 是动力学控件名，`value` 是数字或开关）、`pace`（0.3–3）、`scale`（`slow`/`fast`）；最多 200 条，可回退到 30 分钟内。读取时无效的条目被丢弃，指向已不存在的控件的条目被跳过并在说明里提示。
- 没有干预的纯播放不保存任何东西，打开后总是从种子重新开始。起点固定为快慢 1×、作品声明的时间尺度。

## 命名锚点、新锚点与接力（数据动画工具，`animation` 里的扩展）

经典只有“流”和“反应”。呼吸链这类“一个循环里电子、质子按顺序走”的编排，用 `anchors`（命名位置）和 `relays`（接力）写成数据：

```json
"anchors": {
  "feI": { "ligands": "SF4", "part": "/NADH|Acyl carrier/", "chain": "down" },
  "N2":  { "ligands": "SF4", "part": "/NADH|Acyl carrier/", "chain": "down", "take": "last" },
  "qI":  { "ref": "N2", "onMembrane": { "index": 0, "dy": 0, "blend": 0.6 } }
},
"relays": [{ "name": "一个 NADH", "rate": 0.12, "gate": "flux", "phases": [
  [ { "species": "NADH", "from": "top", "via": [ { "ref": "nadh" } ], "counter": "NADH", "stage": 0 } ],
  [ { "species": "e⁻", "via": [ { "ref": "nadh" }, { "ref": "feI" }, { "ref": "qI" } ], "hop": 0.45, "stage": 1 },
    { "species": "H⁺", "from": "top", "to": "bot", "via": [ ], "wait": false, "delay": 0.5 } ]
] }]
```

- **锚点**：`{ "ref": 名字 }` 引用 `anchors` 里的命名锚点（互相引用可以，引用自己会报错）。`ligands` 可写多个组分代码（`"SF4,FES"`），用 `part`（它所在的部件，名称片段或 `/正则/`）筛选，再用 `pick`（`top` / `bottom` / `nearest`（配 `to`）/ `paired` / `unpaired`（成对的铜，CuA）、`rank`）或 `chain`（`down`/`up`：经所有这些辅因子的电子传递最短路径，跳距≤20 Å，平方和最小）选出；`above` / `below`（配 `margin`）按高度筛；`take: first|last` 取链的首尾。`{ "between": [A, B], "t": 0.45 }` 取两点之间；`{ "arm": 部件, "fractions": [0.2] }` 取部件在膜附近的长轴上的点；任何锚点都可加 `onMembrane: { index, dy, blend }`，把高度往那层膜移（blend 0–1）再加 dy。
- **接力 `relays`**：一个循环由若干**阶段**组成；一个阶段里的**动作**同时开始，下一阶段在所有 `wait` 不为 false 的动作结束后开始。动作的写法和“流”一样（`species`、`from`、`to`、`via`、`labelVia`、`counter`……），另有：`hop`（电子每跳 20 Å 的秒数）、`brown`（用绕开蛋白的随机路径连接各点，配 `inside`、`clear`、`free`）、`delay`、`every`（每 n 个循环才做一次）、`stage`（开始时把能量条的“当前步骤”设为它）、`text`（开始时显示的事件文字）、`then`（本动作结束后接着做的动作，最多 2 层）、`{ "pause": 秒 }`（只停顿）。`rate` 是每秒启动的循环数，`max` 同时进行的循环数，`gate: "flux"` 表示动力学通量接近 0 时不再启动。快速时间尺度下不画粒子，计数器仍按同样的计量增长。
- **能量条跟随接力**：`energy.stage.mode: "relay"` 时亮的是接力动作最近设置的 `stage`。
- 一个“流”可加 `by: "rotor"` 或 `"rate"`，速率再乘上动力学模型的对应通量。
- **转子 `rotor` 与“每转 n 个”**：`"rotor": { "parts": ["subunit gamma", "subunit C1"], "mode": "sym", "turnsPerSecond": 0.25, "by": "rotor", "stock": "H⁺ 膜间隙存量" }` 让这些部件（按部件名片段或 `/正则/`）随动画时钟转动，轴由它们的残基求出（`sym` / `long` / `short` / `x` / `y` / `z`）。角度只由引擎时钟决定，所以回退重放得到同样的角度。`by` 让速度乘上动力学模型的通量；`stock` 指一个计数器，它小于 1 时转子停下（没有可回流的质子）。一条流写 `"perTurn": 8, "phase": 0` 表示不按速率、而是转子每转 1/8 圈发出一个粒子（`phase` 以圈为单位，用来让几条流轮流）。
- **派生计数器 `derived`**：`[{ "name": "ATP（合酶产出）", "terms": { "H⁺ 回流（ATP 合酶）": 1 }, "scale": 0.375, "floor": true }]`，由其它计数器的加权和算出；`per` 再除以另一个计数器，`round` 保留小数位。
- **更多锚点能力**（叶绿体用）：`ring: true`（取叶绿素/血红素环原子的中心；此时 `part` 按环中心最近的残基判断所属蛋白，与经典一致）、`near: { to, min, max }`（或数组：到某锚点的距离范围）、`pick: "cycle"`（第 n 轮取第 n 个，代替经典的随机）、`{ "pairMid": 配体锚点, "maxGap": 12, "else": 锚点 }`（最近一对的中点，如 P680）、`{ "along": { "from", "to", "distance" } }`（从 from 朝 to 走固定距离）、`{ "mirror": { "point", "about" } }`（点关于另一点的对称点）、残基锚点的 `nearest`（同一编号的多个残基取离参考点最近的）、`else`（找不到时改用别的锚点）与 `optional: true`（找不到就不出点，路径跳过它）。动作的 `{ "pause": 秒, "text": ..., "at": 锚点 }` 可以只在某处显示一条事件文字。

## 构象状态机（旋转 ATP 酶、AdK 两态播放器的 `machine`）

这两个播放器的时间轴与状态由“构象状态机”声明：相位时钟 + 日程（可回放的速度/参数变更）+ 剖面。作品配置里写 `machine`：

- 旋转 ATP 酶（`rotary`）：`{ "speed": { "min": 0.05, "max": 3, "default": 0.25 }, "stageAt": [0.1, 0.25, 0.8, 0.93], "morph": { "start": 0.25, "span": 0.6 }, "stepPhases": [0, 0.17, 0.5, 0.86, 0.96] }`。`stageAt` 把 1/3 圈的位点周期切成 5 个阶段（4 个递增的分界）；`morph` 是结构在位点周期的哪一段里变形；`stepPhases` 是 5 个机制步骤各自跳到的位点周期相位。
- AdK（`oscillating`）：`{ "rate": 0.35, "lo": 0.1, "span": 0.8, "stages": { "low": 0.15, "high": 0.85 } }`：`rate` 是摆动的相位速度（弧度/秒/倍率），`lo` 与 `span` 决定两端保持多久（闭合量 = 缓动(((sin φ + 1)/2 − lo)/span)），`stages` 是“打开/闭合”阶段的分界。

写错（分界不递增、`lo + span > 1` 等）按名称拒绝。完整说明与怎么接新机理见 docs/CONFORMATION_MACHINE.md（仓库里，不在 Skill 包内）。

