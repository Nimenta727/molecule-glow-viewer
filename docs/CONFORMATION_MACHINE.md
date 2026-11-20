# 构象状态机（conformation state machine）

实现：`plugins/motion/conformation-machine.mjs`；测试：`plugins/motion/test/conformation-machine.test.mjs`；使用者：ATP 合酶播放器、腺苷酸激酶（AdK）播放器。

## 为什么要有它
数据动画的"流 / 接力 / 转子"描述的是**分子在空间里怎么走**；而 ATP 合酶、AdK 这类机理的核心是**结构自己在一个循环里变形**，并且要同时回答四个问题：现在处在循环的哪一步（阶段）、结构在哪两个状态之间、变形走了多远、这一段时间里数了多少个周期。这些在两个播放器里原来各写了一份硬编码的时间逻辑（转速日程、相位、阶段阈值、事件、计数器、保存与回放）。状态机把这一部分抽成**数据声明 + 一个引擎**；结构那一半（哪些部件、怎么叠合、怎么插值坐标）仍由调用方负责，这一半本来就由配置驱动并共用 `plugins/motion` 与 `plugins/structure` 的算法。

## 它是什么
一个**相位时钟**加一个**剖面**：
- 相位时钟：控制量按**日程**保存（第一条在 0 秒，时间严格递增，最多 1000 条）。在当前时刻改变控制量，会结束此后的一切（之后的日程作废），所以同一份日程在任何拖动、步进、重新打开之后得到同一段历史。保存下来的就是这份日程。
- 剖面把相位变成要显示的东西：`stage`（第几阶段）、`conformation`（在哪两个状态之间、走了多远）、`events`（周期事件）、`counters`（计数器）、`stepTime(i)`（机制第 i 步跳到哪一刻）。

## 两种剖面（`registerProfile` 可以再加）
| 剖面 | 相位 | 声明 | 例子 |
|---|---|---|---|
| `rotary` | 转子转过的圈数；速度控制量＝圈/秒 | `sites`（相同位点数，每 1/sites 圈一个位点周期）、`stageAt`（4 个分界把一个位点周期切成 5 个阶段）、`morph {start, span}`（结构在位点周期的哪一段里变形）、`stepPhases`（5 个步骤跳到的位点周期相位）、`counters {cycles, unit}`、`eventLabel`、`speed {min, max, default, label}` | F1Fo ATP 合酶：3 个 β 位点，c 环 8/10/14 个亚基 |
| `oscillating` | 往复摆动的角度；`fraction = 缓动(((sin φ + 1)/2 − lo)/span)`，两端各保持一段 | `rate`、`lo`、`span`、`stages {low, high}`、`parameters`（手动闭合量、自动开关、任意 0/1 标志）、`manual`/`auto` 指明哪两个参数、`steps`、`counters.percent`、`speed` | AdK：LID/NMP 域在张开与闭合之间往复，手动拖到某个形状再切回自动不跳 |

引擎的输出（`snapshot()`）只含它知道的：`time, speed, seed, playbackRate, playing, stage, conformation, counters, events`，以及 `turns`（旋转）或 `fraction`、`parameters`（往复）。几何（转轴、粒子路径、域位移）由调用方用这些数算出。

## 声明例子（ATP 合酶，作品配置里的 `machine`）
```json
"machine": {
  "speed": { "min": 0.05, "max": 3, "default": 0.25, "label": "转速" },
  "stageAt": [0.1, 0.25, 0.8, 0.93],
  "morph": { "start": 0.25, "span": 0.6 },
  "stepPhases": [0, 0.17, 0.5, 0.86, 0.96]
}
```
位点数由结构决定（三个 β 亚基），计数器的标签与事件名取自配置的 `counterLabels`/`eventLabel`，转子的单元数（c 亚基数）由结构检测。AdK 的 `machine` 是 `{ rate, lo, span, stages }`。Studio 的工具页签为这些数各生成一个输入框；写错按名称拒绝（例如 `stageAt` 不递增）。

## 与"流 / 接力 / 转子"的分工
- 数据动画（接力、转子）：分子运动和事件的编排，状态在随机/反应层面。
- 构象状态机：结构形状沿一个循环变化的**时间轴与状态**；形状本身由调用方按 `conformation` 插值。
- 二者可以并用：呼吸链作品里的 ATP 合酶用的是转子（只需要"每转 n 个"），而独立的 ATP 合酶/AdK 作品需要构象变化与三位点交换，用状态机。

## 怎么接一个新机理
1. 选剖面（周期转动 or 往复），把常数写进 `machine`；
2. 写出结构侧：哪些部件、各状态的坐标从哪来、怎么按 `conformation` 插值（可直接用 `plugins/motion/conformation.mjs` 的 `displaceVertices`）；
3. 调 `createMachine(normalizeMachine(spec), state, { seed, units })`，把 `snapshot()` 与你的几何合在一起。
新的相位形式（例如非周期的单向过程）写成一个剖面注册即可，不必改引擎。

## 限制
- 一个机器只有一个相位；多个相位互相耦合的机理（两个马达共用一个膜电位）要用两个机器加外部耦合，或回到数据动画的转子。
- 剖面只描述时间/状态，不做结构叠合；`rotary` 的位点周期里"变形"是一个平滑段，不是任意的多段曲线。
- 时长固定为 120 个示意秒，日程最多 1000 条。
