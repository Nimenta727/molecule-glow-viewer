# 2026-11-20 4.4.8 构象状态机（ATP 合酶、AdK 播放器的时间与状态侧并入通用引擎）

## 做了什么
新增一类通用能力：**构象状态机**（`plugins/motion/conformation-machine.mjs`，设计说明 `docs/CONFORMATION_MACHINE.md`）。它是一个相位时钟（控制量按可回放的日程保存）加一个剖面，把相位变成：阶段、"结构在哪两个状态之间"、周期事件、计数器、机制步骤的跳转时刻。ATP 合酶播放器（旋转剖面）与 AdK 播放器（往复剖面）原来各写死的一份时间逻辑，现在都由数据声明驱动，由同一个引擎运行。

## 设计
- 内核：播放头、播放倍率、释放、保存/恢复校验；日程第一条在 0 秒、时间严格递增、最多 1000 条；在当前时刻改控制量会结束此后的一切（因此任何拖动/步进/重开得到同一段历史）。
- 剖面注册表（`registerProfile`）：
  - `rotary`：相位＝转子圈数；`sites`、`stageAt`（4 个分界切 5 个阶段）、`morph {start, span}`、`stepPhases`、`counters`、`eventLabel`、`speed`。
  - `oscillating`：相位＝摆动角；`rate`、`lo`/`span`（两端保持）、`stages`、`parameters`（手动闭合量/自动开关/任意 0/1 标志）、`manual`/`auto`；手动形状切回自动不跳。
- 引擎只输出时间/状态（`time, speed, seed, playbackRate, playing, stage, conformation, counters, events`，加 `turns` 或 `fraction/parameters`）；几何仍由调用方做。
- 一处保留的差别：往复剖面步进时把时间舍入到 1e-9（AdK 原来如此，用于"小步累计 = 一次拖动"的比较），旋转剖面不舍入（ATP 的"满一圈"计数落在整数边界上，舍入会让 120 步 × 1/30 少 4e-8、计数差一格）。这是剖面自己的属性，不是回退。

## 改动
- `plugins/motion/conformation-machine.mjs`（新）；`plugins/atp-synthase/{index,config,tool}.mjs`：播放器用状态机，配置新增 `machine`，Studio 工具页签生成阶段分界/变形窗口/默认转速的输入框；`plugins/adenylate-kinase/{playback,config,index,tool}.mjs`：`playback.mjs` 变成状态机的薄封装，配置新增 `machine`（`rate/lo/span/stages`）与 Studio 字段。
- `tools/parity-numerics.mjs`：数值基线登记的源文件加入状态机；基线重跑，只有源文件哈希变化，数值结果不变（19 解析行 + 5 坐标行）。
- 文档：`docs/CONFORMATION_MACHINE.md`、`docs/README.md`、`skill/references/tools.md`、`feature-parity.json`。

## 验证
- **两个播放器的黄金轨迹逐位不变**（`golden-trace.mjs` 记录全部快照、步骤时刻、保存格式）；两处播放器原有测试全部原样通过。
- 状态机自己的测试（5 个）：声明按名称校验；**四位点旋转机**（每 1/4 圈一个周期、自己的阶段窗口与计数器标签、步进=拖动=按日程重开）；**不同端点保持/速率/参数的往复机**（两端保持、手动衔接不跳、非法参数/日程按名称拒绝、释放后报错）；日程上限、播放控制；**自注册一个新剖面**。ATP/AdK 各加 1 个"改配置就改行为"的测试。
- 全套 `npm test`：见 STATUS。

## 没有做 / 边界（如实）
- **并入的是时间与状态侧，不是结构侧**：ATP 的"三个 β 亚基两两叠合得到循环交换的三个构象"、AdK 的"两态按 CORE 叠合得到各域目标位置"仍在各自的 `index.mjs`/`structure.mjs` 里（它们已由配置驱动并共用 `plugins/motion`/`plugins/structure` 的算法）。把它们也抽成通用的"构象集"（循环对称亚基的状态交换、两态域目标）是下一步，这次没有做。
- 两个播放器仍是 `player-v1` 运行时的专用播放器，没有变成 `layer-v1` 的通用工具；新机理要接入仍需写结构侧。
- 没有再交付第三个真实作品：通用性由单元测试里的第三种机器（四位点旋转机、另一组保持参数的摆动、自注册剖面）证明，没有在浏览器里看。
