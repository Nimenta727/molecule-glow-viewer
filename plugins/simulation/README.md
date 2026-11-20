# plugins/simulation — 数据反应与区室模拟

目标包 `plugins/simulation`（见 [CONTRACT_4.3.0](../../docs/CONTRACT_4.3.0.md) §3）的**第一步（4.4.3a，纯逻辑）**：经典 `src/sim/data-anim.js` 的“纯数据动画 v1”引擎。4.4.3b 起已注册为工具并接进 Viewer（见下）。

| 模块 | 内容 |
|---|---|
| `data-spec.mjs` | 读取 v1 声明：只保留已知字段、数值夹在范围内、数量设上限、**检查每一处引用**（池/流/反应写了不存在的区室，经典运行时直接崩，这里读取时就报错并说明）；锚点 `[x,y,z]` 或 `{ligand / ligands / residue / label_seq / part / membrane, offset}`；新增的可选 `conserved`（守恒量）。包里没有任何代码。 |
| `data-animation.mjs` | `DataAnimation`：区室（盒/外壳 + 侧面 + 膜 + 间隙）、池、**流**（取一个分子 → 布朗路径到入口 → 经锚点 → 出口 → 放进另一个区室，带事件与计数器）、**反应**（反应物到位点 → 保持 → 消耗 → 事件 → 计数 → 产物扩散到区室或淡出）、快时间尺度的粒子流。`step(dt)` 的顺序是经典一帧的顺序，所以同一种子取随机数的顺序也一致。 |

## 与经典的差别（有意的）
- **计量与守恒**（新增）：台账 `ledger`（每个物种创建/消耗/消失/取出/归还多少）+ 池边界的漂入/漂出计数，`balance()` 对每个物种给出“应有”和“实际”，两者相等才说明计量完整（官方两个包都平衡）；`conserved` 声明的量在每个反应完成时检查，不守恒就记入 `violations` 并出一个带 ⚠ 的事件（例：腺苷酸磷酸基团 ATP 3 + AMP 1 = 2 × ADP 2）。
- **读取即校验**：有错误的声明拒绝运行（经典会在运行中崩溃）。
- **事件在第一个点（`at: 0`）也会触发**：经典里长度为 0 的等待永远不会结束，这个事件从未出现过。
- **两点路径画成直线**（同 `plugins/motion`）：对照时经典用 0.01 Å 的两点路径做淡入淡出，three.js 会把它弄弯不到 0.001 Å，肉眼不可见。
- `orient.up`（整个结构绕水平轴转半圈）是**宿主**的事：引擎只提供 `flipAboutHorizontal`，宿主翻转结构后再创建引擎。
- 结构由宿主给出：`{ points, ligands: [{comp, centre}], residue(query), part(name), membraneY }`。

## 验证
`tools/data-anim-parity.mjs`：原样运行经典引擎（只替换渲染辅助），同一种子、同一结构（4AKE / 1K4C / 6ZPO 的真实残基位置），逐步比较池里的分子、在路上的分子、计数器、事件日志和快尺度的粒子流：**6/6 一致**（AdK 反应包 900 步、KcsA 数据包 1200 步，含并发的流与反应）。

## 4.4.3b：工具、取向适配器与 Viewer
| 模块 | 内容 |
|---|---|
| `structure-frame.mjs` | **取向适配器**：经典引擎跑在“结构轴竖直、以中心为原点”的模型上，“膜的上/下”就是 y 的大/小；新 Viewer 画的是原始坐标。适配器按包里的 `axis`（`plugins/motion/rotation.mjs` 的 `chooseAxis`，已与经典 `orientTransform` 对照）把残基和小分子转到竖直坐标系给引擎，按 `membranes: [{at, offset}]`（部件平均高度 + 偏移）放膜，按 `orient.up` 决定是否整体翻转；引擎的输出用 `toNative` 精确映射回原始坐标。 |
| `data-tool.mjs` / `index.mjs` | 工具 `org.glow.tool.data-animation`（`runtime: 'layer-v1'`，view + author）：配置 `{animation, axis, membranes, seed, scale}` 存在 `scene.tools[].config`；校验器要求声明能被引擎运行（每处错误指名道姓）；作者字段（种子/时间尺度/竖直轴/膜/每个池、流、反应的关键量）由描述符生成，Studio 工具页不需要专门代码。旧包里的 `animation` 在打开时自动变成工具条目（`mechanism-catalog.mjs` 的 `dataAnimationEntry`）。 |
| `apps/viewer-web/data-animation.mjs` | Viewer 面板：播放/从头开始/快慢/时间尺度、计数器、事件记录；用视口的粒子云（池 / 路上的分子 / 流）和事件标签（`setEventTags`）绘制。动画总是从种子重新开始，配置只在作品的工具条目里。 |

**限制**：只能编辑已有的池、流、反应的关键量，不能在 Studio 里新增；没有回放/干预；经典的“结合位点闪光”（`markHot`）没做；浓度/pH/膜电位见 4.4.3c。膜的位置用部件残基的平均高度近似（经典用该部件所有原子的平均高度）。
