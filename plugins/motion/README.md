# plugins/motion — 对象与构象运动的共用算法

本目录是目标包 `plugins/motion`（见 [CONTRACT_4.3.0](../../docs/CONTRACT_4.3.0.md) §3）的**第一步**：先把 ATP 合酶、AdK、KcsA 三个播放器里各写一遍的运动算法合并成唯一来源。现在是库模块；等 4.3.3 的工具协议落地后，再把这里的能力注册为 `tools`（`audience: view/author`）。

| 模块 | 内容 | 使用者 |
|---|---|---|
| `vectors.mjs` | 3 维向量小工具（sub、dot、cross、normalize、distance、lerp） | 三个播放器 |
| `conformation.mjs` | `displaceVertices`（按最近锚点原子的反距离加权位移，把显示顶点移到另一构象）、`nearestAnchors`、`rotationAngle`；叠合 `superpose` 沿用 `plugins/structure/alignment.mjs` | ATP（β 位点三构象）、AdK（两态域运动）、KcsA（开放/失活构象） |
| `path.mjs` | `walkPath`：按弧长沿折线取位置 | KcsA 离子沿孔道移动（后续粒子/路径工具的起点） |

## 说明
- 三份旧实现有两种略有不同的距离平方写法（`sumOfSquares` 与 `hypotSquared`），为保持输出逐位一致而同时保留；统一为一种需要同时更新黄金输出并说明数值差异，另行决定。
- 仍留在各插件内的内容：ATP 的转轴检测与旋转、AdK 的域定义与密度叶片、KcsA 的位点/孔道推导与门控动力学。这些要么是专用几何、要么属于 `plugins/simulation`。
- 等价性：三个播放器各自的黄金输出（合成数据）与真实结构（6ZPO、4AKE/1AKE、五个 KcsA 态）上的新旧对照均逐位一致。
