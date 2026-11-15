# 小分子：从哪来、怎么画、怎么动

小分子 = 配体、辅因子、核苷酸（ATP/ADP/GTP）、离子（Mg²⁺、K⁺、Na⁺、Ca²⁺、Zn²⁺）、脂质、药物、底物类似物。
查看器里它们有两种来源、两种用途：

| | 静态配体（结构里本来就有的） | 动画分子（过程动画里移动的） |
|---|---|---|
| 坐标来源 | PDB 条目里的 HETATM（实验坐标，就在结合位置） | RCSB 化学组分字典（CCD）的**理想构型** SDF |
| 键 | 按共价半径距离推断 | SDF 自带键表（含双键） |
| 代码位置 | `loadEntry` → `rowsToEntry` → `rebuildLigands` | `getTemplate(comp)` → `makeMol(tpl)` |
| 渲染位置 | 主场景（会被蛋白遮挡，真实） | 叠加层（画在蛋白上面，不会发黑） |

## 1. 找到小分子的代码（不要猜）
```bash
# 某条目里有哪些小分子（化学组分代码 + 名称 + 实体号 + 链）
curl -s -X POST https://data.rcsb.org/graphql -H "Content-Type: application/json" \
  -d "{\"query\":\"{entry(entry_id:\\\"6ZPO\\\"){nonpolymer_entities{nonpolymer_comp{chem_comp{id name formula}}rcsb_nonpolymer_entity_container_identifiers{entity_id asym_ids}}}}\"}"
# 某个代码的理想构型（确认能下载、看原子数）
curl -s https://files.rcsb.org/ligands/view/ATP_ideal.sdf | head -4
```
常用代码：ATP、ADP、AMP、ANP（不水解 ATP 类似物）、GTP、GDP、PO4（磷酸）、MG、K、NA、CA、ZN、HEM（血红素）、FAD、NAD、NAP、CLA（叶绿素 a）、CDL（心磷脂）、POPC 类脂质（PCW/POV 等，以条目实际为准）。

## 2. 画法（球棍）
- 原子 = 球；颜色和半径在 `ELEMENTS`：C #d9dee9、N #4f7dff、O #ff3b4e、P #ff9a1f、S #ffe14d、Mg #6dff9a、K #b98cff…；球半径 0.5–0.75 Å（金属离子 0.8–1.2）× 小分子大小。
- 键 = 两段半截圆柱，各用所连原子的颜色（经典球棍着色）；半径 0.24 × 大小；双键 ×1.3。
- 去掉氢（团块尺度下氢只会添乱）。
- **大小**：真实比例（1.0）下 ATP 约 18 Å 长，而每个残基团块直径 9 Å，ATP 会被淹没。默认 2.6 倍：形状、键角、相对大小都保留，只整体放大。说明文字里不必写比例，但用户问到时要说明“小分子放大显示”。
- **故事色**：同一机制里需要区分的分子，用碳原子颜色区分（`MOL_CARBON`：ATP 金 #ffb300、ADP 青 #00c8ff），其他元素保持标准色。新增：在 `MOL_CARBON` 加一项，例如 `NADH: '#7dff7d'`。
- 离子只画一个发光球（`makeParticle(color, radius)`），比球棍更醒目。质子同理（黄色 #fff27a）。

## 3. 让小分子“互动”的四种基本动作
全部用 `ctx.anim(obj, 时长, step, next)` 组合（见 processes.md）：

| 动作 | 写法要点 | 例子 |
|---|---|---|
| 进入结合位点 | 从口袋外沿法线方向一点 lerp 到位点，同时 scale 0→1 | ADP、Pi 进入 β 亚基 |
| 停留 / 被夹紧 | 位置固定，`rotation.y` 慢转或轻微抖动；位点残基 `markHot` 闪光 | 松弛态、紧密态 |
| 化学反应 | 两个分子靠拢 → 在某一时刻隐藏反应物、显示产物 → 加一个 `makeFlash` 闪光 | ADP + Pi → ATP |
| 离开 | 沿外法线 lerp 出去并上浮，scale 1→0 | ATP 释放 |
| 穿过通道 | 沿轴分段 hop，每个结合位点停一下 | K⁺ 通过选择性过滤器 |

**把动作和蛋白的运动绑定**：用 `ctx.theta`（转子角度）而不是时间来决定状态，这样转速滑块一变，化学计量自动保持（ATP 合酶：每 120° 一个 ATP、每 45° 一个 H⁺）。

## 4. 位点从哪来
- 最好：结构里的配体就在位点上（6ZPO 的 ADP/ATP）。setup 里用 `ctx.ligands` 找到它，取 `L.centre`，然后 `ctx.hideLigand(L)` 隐藏静态那份，用动画分子替代。
- 只有一个位点有配体：按对称性复制（ATP 合酶的三个 β 位点：绕轴每 120° 一个）。
- 没有配体：用论文给的残基号，`ctx.atomsOf(/部件名/)` 筛出这些残基，取质心。

## 5. 检查
- 拉近截图：三种分子颜色能分清；没有被团块挡住；没有发黑。
- 计数器和动画一致（每出现一次闪光，ATP +1）。
- 小分子大小滑块改变后过程动画会重建（预期行为）。
