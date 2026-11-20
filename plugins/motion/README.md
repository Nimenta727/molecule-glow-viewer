# plugins/motion — 对象与构象运动的共用算法

本目录是目标包 `plugins/motion`（见 [CONTRACT_4.3.0](../../docs/CONTRACT_4.3.0.md) §3）的**第一步**：先把 ATP 合酶、AdK、KcsA 三个播放器里各写一遍的运动算法合并成唯一来源。现在是库模块；等 4.3.3 的工具协议落地后，再把这里的能力注册为 `tools`（`audience: view/author`）。

| 模块 | 内容 | 使用者 |
|---|---|---|
| `vectors.mjs` | 3 维向量小工具（sub、dot、cross、normalize、distance、lerp） | 三个播放器 |
| `conformation.mjs` | `displaceVertices`（按最近锚点原子的反距离加权位移，把显示顶点移到另一构象）、`nearestAnchors`、`rotationAngle`；叠合 `superpose` 沿用 `plugins/structure/alignment.mjs` | ATP（β 位点三构象）、AdK（两态域运动）、KcsA（开放/失活构象） |
| `path.mjs` | `walkPath`：按弧长沿折线取位置 | KcsA 离子沿孔道移动（后续粒子/路径工具的起点） |
| `particles.mjs` | **4.4.2** 粒子、路径与流（纯逻辑，位置用 `[x,y,z]`，随机数由调用方给 `{sim, vis}` 两条流）：原子占位哈希（`createOccupancy`）、避开蛋白的布朗桥（`brownPath`）、行进曲线（`catmullRom`）、区室/机器外壳的溶液区域（`boxRegion`/`shellRegion`）、粒子池（`ParticlePool`/`PoolSet`：扩散、`take`/`give`、跟随数量变化）、粒子流（`FlowStream`）、标准分子外观表（`SPECIES`）。**每个池和流都必须有名字**，没有名字会在创建时报错 | 尚未接入界面；对照经典 `src/sim/motion-kit.js`（`tools/particles-parity.mjs`，20/20 一致） |
| `journey.mjs` | **4.4.2b** 行进与事件（纯状态机，无 Promise）：`Journey`（粒子沿一段或多段曲线走，淡入/淡出、缓动、翻滚；后一段在开始时才算路径）、`Motion`（调度所有行进，`clear()` 一次取消全部）、`EventLog`（带时间的事件日志，去掉标记，保留最近 500 条，事件标签随时间消失）、`membraneCrossing`（质子/离子过膜：入口侧池 → 通道口 → 通道 → 出口 → 出口侧池，或直接离开） | 尚未接入界面；对照经典 `travel`/`eventTag`/`protonAcross` 与 `anim-runner.js`（同一个报告，24/24 一致） |

## 说明
- 三份旧实现有两种略有不同的距离平方写法（`sumOfSquares` 与 `hypotSquared`），为保持输出逐位一致而同时保留；统一为一种需要同时更新黄金输出并说明数值差异，另行决定。
- 仍留在各插件内的内容：ATP 的转轴检测与旋转、AdK 的域定义与密度叶片、KcsA 的位点/孔道推导与门控动力学。这些要么是专用几何、要么属于 `plugins/simulation`。
- 等价性：三个播放器各自的黄金输出（合成数据）与真实结构（6ZPO、4AKE/1AKE、五个 KcsA 态）上的新旧对照均逐位一致。
- `particles.mjs` 与经典的差别只有一处，且是有意的：**两点路径画成直线**。经典用 three.js 的曲线，两点时它的“首尾外推点”共用同一个临时向量，会把直线弄成鼓出的曲线（实测最多偏 16 Å）；三点及以上与经典逐位一致。
- 经典里“拿一个粒子去做事”的 `travel`（沿路径动画、淡入淡出）、事件标签 `eventTag`、`protonAcross`/`atpFromPools` 这类机器专用流程属于渲染与具体机制，不在本模块；随 Viewer 接线与 4.4.3/4.4.4 处理。
- `journey.mjs` 有两处有意差别：翻滚按“每秒”算（经典每帧加 0.03/0.02 弧度，60 fps 时就是 1.8/1.2 弧度/秒，两者一致）；多条行进同时跑时，随机数按 tick 顺序取（经典按微任务顺序），单条行进逐位一致。
