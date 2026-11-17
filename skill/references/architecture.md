# 查看器内部结构（改代码前必读）

单文件 `assets/viewer.html`（约 1250 行）：HTML 面板 + CSS + 一个 ES module 脚本。
依赖：Three.js 0.160.0（importmap → jsDelivr）：`OrbitControls`、`EffectComposer`、`RenderPass`、`GTAOPass`（动态 import）、`BokehPass`、`UnrealBloomPass`、`OutputPass`、`ShaderPass`、`Pass`、`RoomEnvironment`。

脚本按编号分段（搜 `====` 定位）：
1. `PRESETS`、`PALETTES`、`ELEMENTS`（元素颜色 / 球半径 / 共价半径）
2. 工具、mmCIF/PDB 解析、RCSB 下载、几何（PCA、Horn 叠合）、渲染器/灯光/后期、材质、场景状态、小分子、动画运行器，然后是 `PROCESSES`（过程动画）
3. 组件放置、`loadScene`、膜、剖切、图例、相机、UI 绑定、帧循环、启动

## 1. 数据流

```
PDB 编号 / 本地文件
 └ loadEntry(id, useAssembly)                         entryFromFile(name, text)
    ├ fetchMeta(GraphQL)：标题、聚合物实体名称、非聚合物实体（配体）、组装体算符
    ├ ModelServer：label_atom_id=CA、label_atom_id=P、每个非水配体实体 label_entity_id=N（最多 12 个）
    ├ parseAtomSite()：按 _atom_site 表头定位列，支持带引号的值，只取第一个 model
    ├ rowsToEntry()：ATOM 的 CA/P → 残基点 atoms[]；HETATM（非水、非氢）→ 配体分子 ligands[]（按 asym|comp|残基号分组）
    │               链内修饰残基（MSE、M3L…，label_seq_id>0）当作残基，不当配体
    └ 组装体：parseOperExpr + operMatrix，残基和配体一起复制/变换
 └ keepChains（预设 chains）；states 第二构象：Horn 叠合到第一构象，残基按 asym|seq 配对 → a.p2
 └ 定向：axisFrom（两部件质心连线 = 转轴）或 orientTransform('long'|'short'|'sym'|'native')；up 翻转
 └ 按实体名称分部件 → model.entityStats；components 拼接（placeComponent）
 └ groups[]（每部件一个 InstancedMesh）+ ligGroups[]（每种配体 × 构象一个球棍组）
 └ process.setup(ctx)（异步，完成后才激活）→ markHotFromLigands() → rebuildMeshes/Ligands/Membranes → 图例 → 相机
每帧 frame()：theta += 转速·dt → 旋转部件 rotation.y = theta → 构象自动往返 → proc.update + tickAnims
           → procRoot 跟随 world → 剖开平面 → 景深 → composer.render()
```

`loadScene` 带加载令牌（`loadSeq` + `live()`）：新加载开始后，旧加载在下一个 await 处抛出 `Stale` 自动放弃，避免连点预设时两份场景混在一起。

## 2. RCSB 接口（均允许跨域）

| 用途 | 地址 |
|---|---|
| Cα 坐标 | `https://models.rcsb.org/v1/{id小写}/atoms?label_atom_id=CA&encoding=cif&copy_all_categories=false` |
| 核酸 P | 同上，`label_atom_id=P` |
| 某个配体实体的全部原子 | 同上，`label_entity_id={实体号}` |
| 名称 / 配体实体 / 组装体 | `POST https://data.rcsb.org/graphql`（见 `fetchMeta`） |
| 小分子理想构型（含键） | `https://files.rcsb.org/ligands/view/{代码}_ideal.sdf`（V2000，见 `getTemplate`） |

## 3. 定向
- `pca()`：协方差矩阵 → `jacobi()`（通用 n×n 对称矩阵，也用于 4×4 Horn 叠合 `superpose()`）。
- `long` 最长轴竖直；`short` 最短轴竖直；`sym` 选与另两个特征值差别最大的轴；`native` 不旋转。
  注意：`sym` 对 8YJT（C 环）选错了轴，C 环组件用 `short`。
- **`axisFrom: ['部件A', '部件B']`**：A 质心 → B 质心作为 +Y，转轴穿过 A 的质心。旋转机器一定用它（ATP 合酶：c 环 → β），否则 PCA 轴偏一点，转子就会摆。
- `horizontal: true`：`world` 绕 Z 转 −90°。

## 4. 团块材质 `blobMaterial(opts)`
`MeshPhysicalMaterial`（粗糙度 0.3，clearcoat 1.0/0.12，sheen 0.08），`onBeforeCompile` 注入：
- 顶点：`uLumpy` 椭球形变 + 起伏；`uJitter` 热运动；`aDelta × uMorph` 构象变形；`opts.cutaway` 时中心在镜头一侧的整颗团块塌缩为 0（“剖开”）。
- 片元：`up = 法线·视空间上方向`；`自发光 += 颜色 × (uGlow·up + uRim·菲涅尔·(0.25+1.1·up))` —— **边缘光只在朝上的面强**，下方自然沉入黑暗（参考图的顶光感）；`aHot × uHot × 脉动` 结合位点闪光；背面压暗。
- 共享 uniform 对象 `U`：uTime、uJitter、uRim、uGlow、uLumpy、uHot、uMorph、uUpView、uCutA、uCutB（剖开楔形的两个平面）。
- 每个团块几何体必须带 `aHot`、`aDelta` 两个实例属性（`withAttrs()`），膜也一样。

## 5. 小分子
- `buildMolecules(mols, scale, carbon)`：所有原子一个 InstancedMesh（球），所有键一个 InstancedMesh（每根键两半，各取所连原子的颜色）。
  结构里的配体按共价半径判断成键（`bondsOf`：d < r1 + r2 + 0.45 Å）；理想模板用 SDF 键表（双键加粗 1.3×）。
  `scale` = 面板“小分子大小”（相对分子中心放大，形状和键角不变）。
- `ligandMaterial(boost)`：自发光随时间轻微脉动 + 菲涅尔边缘；`customProgramCacheKey` 区分不同 boost（否则 three 复用同一个着色器程序）。
- `getTemplate(comp)`：下载并缓存 CCD 理想构型（去氢、居中）。`makeMol(tpl)`：生成一个可移动的分子（过程动画用），ATP 碳金色、ADP 碳青色（`MOL_CARBON`）。

## 6. 灯光与后期（光影核心，见 style_guide.md）
- 主场景：半球光 0x9fb7ff/黑 0.12；顶部白色主光 3.2 @(0.35,1,0.45)；冷蓝背轮廓 2.4 @(−0.6,0.5,−1)；品红侧补 1.2 @(1,0.1,−0.6)；**没有从下往上的补光**。环境贴图 0.12。
- 管线：`RenderPass(scene)` → `GTAOPass` → `BokehPass` → `ClearDepthPass` → `RenderPass(overlay)` → `UnrealBloomPass(0.35, 0.45, 0.75)` → `OutputPass`（ACES）→ 调色 `ShaderPass`（饱和度 1.3、对比 1.12、暗角 0.45、颗粒 0.018）。
- **叠加层 `overlay`**：过程动画的物体（`procRoot`：ATP/ADP/Pi、H⁺、K⁺、闪光）放在单独场景，在 AO 和景深**之后**画在蛋白上面（有自己的灯）。原因：配体埋在蛋白口袋里，和蛋白一起渲染时 AO 会把它压成黑色、前面的团块会挡住它。`procRoot` 每帧复制 `world` 的变换。
- `ClearDepthPass`：three r160 的 `RenderPass.clearDepth` 在绑定目标之前清深度（清的是上一个目标），所以自己写一个：先 `setRenderTarget(readBuffer)` 再 `clearDepth()`。
- 画质 `applyQuality()`：高 = 像素比≤2 + AO + 景深；中 = 1 + AO + 景深；低 = 0.6，关 AO/景深，团块 20 面。
- 景深强度随距离减弱（近看不糊）：`aperture = 强度 × 0.00003 × min(1, 距离/600)`。

## 7. 剖开 / 剖切
- **剖开（每部件“剖”复选框，预设 `ghost`）**：`aimCut(半角=62°, 余量=4 Å)` 在加载时按当前视线方向算一个**固定在模型上的楔形**（两个过主轴的平面 `U.uCutA/uCutB`）；带 `cutaway` 的材质去掉中心落在楔形里的整颗团块。
  **不再每帧跟随相机**：v2 每帧重算平面，转动时平面附近的团块在“剖/不剖”之间来回跳 → 用户看到“转动时结构消失”。现在楔形固定，按钮“剖面对准当前视角”才重新对准。
  结构示意模式的飘带用同样两个平面做 `clippingPlanes` + `clipIntersection = true`（两个平面都切到才去掉）。
  试过半透明（多层叠成奶白雾）和逐片元裁剪（团块变空心泡泡），都放弃。
- **剖切（全局）**：固定平面法线 (0,0,−1)，“只切膜”/“全部”。

## 8. 膜 `rebuildMembranes()`
六角网格间距 9.5 Å 两层叶；头基球半径 2.5–2.9（粉）、每个脂质两根 15 Å 尾巴（白）；膜高度 ±26 Å 内的蛋白投影到 6 Å 网格挖洞；边缘 18% 稀疏；>12 万脂质自动加大间距。半径 = 滑块 × `model.mainR`。

## 9. 组件 `placeComponent(comp, atoms, ligands)`
定向后按 `anchor` + `side`/`gap`/`dy` 定高度；`single` / `ring{n,radius}` / `helix{n,rise,twist}` 复制（配体一起复制）。

## 10. 过程动画
见 `processes.md`。`PROCESSES[name] = { caption, async setup(ctx), update(ctx, dt) }`，预设里写 `process: 'name'` 启用。
`anim(obj, dur, step, next)` / `tickAnims(dt)` 是极小的补间运行器：`dur = null` 表示由 `step` 返回 true 结束；没有 `next` 时结束后自动移除物体。

## 11. 相机
`resetCamera()` 只按主结构（不含组件）取景；`camera: {az, el, dist}`。

## 12. 修改注意
- 改默认参数要同时改：HTML 滑块 `value`、对应 uniform / pass 构造参数、`style_guide.md`。
- 新控件：HTML 加 `.row`，在 “UI wiring” 段绑定；`<output>` 由 `syncOut` 自动更新。
- 不要下载整份 mmCIF（大结构几十 MB）。
- 新的着色器实例属性要在 `withAttrs()` 里给所有团块几何体加上，否则 WebGL 报 attribute 缺失。
- 同一个 `onBeforeCompile` 生成不同着色器代码时，必须设 `customProgramCacheKey`。

## 13. 两种显示模式（面板“显示模式”）
- **团块（写实）**`buildGroup(g)`：每残基一颗团块（`blobInstances`）。每个残基的随机大小存在 `a.rf`，重建后不变。
- **结构示意（螺旋 / 折叠）**`buildCartoon(g)`：每条链一个网格，沿 Cα（核酸用 P）扫掠截面：
  无规卷曲 = 细圆管 0.7 Å；α 螺旋 = 粗圆柱 2.1 Å（沿螺旋轴，取 ±2 个残基平均）；β 折叠 = 扁带 1.7 × 0.45 Å，末端箭头 2.7 → 0.25；核酸 1.5 Å。
  CatmullRom 插值，每残基 S 个截面（低/中/高 = 2/3/4），每圈 M = 6/8/10 点；β 带宽方向取褶皱向量（相邻残基保持同号），其余用平行移动标架。
  **二级结构来源（科学性）**：优先用作者沉积的注释 `applyDepositedSS()`（`files.rcsb.org/header/XXXX.cif` 的 `_struct_conf` HELX_* 与 `_struct_sheet_range`，按 label_asym_id + label_seq_id 写到 `a.ss`）；没有注释的链才用 Cα 几何规则 `assignSS()`（螺旋 d(i,i+3)≈5.1、d(i,i+4)≈6.2；折叠 = 伸展 + 非局部 5.6 Å 内有伸展伙伴）。
  链在 Cα 间距 > 4.4 Å（P 8.5 Å）处断开（缺失残基不连假线）。
- **外形轮廓**（复选“结构示意模式显示外形轮廓”）：同样的团块放大 1.45 倍画两遍：先只写深度（`shell:'depth'`），再用 `LessEqual` 只画最外层颜色（`shell:'color'`，alpha = 0.025 + 0.42·菲涅尔）→ 只有发光的外轮廓，不会叠成雾。AO 和景深渲染时暂时隐藏外壳（`hideShellsDuring`）。
- 大结构**不降级**：鞭毛马达（15 万残基）、HK97（11.5 万）在结构示意模式下照样逐链画出所有螺旋 / 折叠（约 5–7 M 三角形），画质档只改变平滑度。

## 14. 逐链构象变化（过程动画驱动的真实构象）
- 过程在 setup 里给残基写 `a.alts = {键: Vector3}`，然后 `ctx.setConformations(g, 键数组)`；update 里每帧 `ctx.setChainBlend(g, 链, 从键, 到键, w)`。
- 帧循环 `applyBlends(g)`：团块模式在 CPU 上改实例矩阵（位置插值，大小 `scaleOf(a)` 不变）；结构示意模式用 morph target（每个键一个，`morphTargetsRelative`，法线也作为 morph）。
- 两构象预设（`states`）的 `a.p2` 在结构示意模式里也是一个 morph target，跟 `uMorph` 同步。

## 15. 简化表示（每个部件可选，“组成”里的“简”复选框）
**参考了什么**（v3 调研，不要凭空发明画法）：
- 期刊机制图（如 Frontiers Microbiol. 2022 冷冻电镜 ATP 合酶综述 Fig.1）：α/β = 交替的长叶片，γ = 带“脚”的粗棒，ε/δ = 小椭圆，c 环 = **一个**灰色鼓，a = 豆形块，b/d/F6/e/f/g = 沿真实走向的细弯管，OSCP = 帽；平涂 + 黑描边 + 引线标注，白底。
- Mol* / PDB-101（Goodsell Illustrate 风格）：平涂、按链或实体着色、暗描边、柔和遮蔽，浅色背景；相关亚基同一色系。
- ChimeraX molmap / Mol* 高斯表面：低分辨率分子表面。
**不要**用“每条链一个 PCA 椭球”替代一切（v3 第一版被用户否定：长弯螺旋变成巨大椭球、c 环碎成 8 个、DNA 成团）。

### 15.1 选择哪些部件简化
- 每部件 `g.simple`；面板“默认简化方式”：推荐 / 全部 / 全部不简化。
- 推荐 `defaultSimple(g)`：预设 `keepDetail: [...]` 列出的部件保留细节（机制发生的地方），其余简化；没有 keepDetail 时，会转的、有构象变化的、接触配体的部件保留细节；单一蛋白不简化。
- ATP 合酶 keepDetail：β、γ、δ、ε、c 环、a（质子通道与催化位点）；α、外周柄、膜内附属亚基、IF1 简化。

### 15.2 示意图 `buildSchematic(g)`（默认简化样式）
- **环** `ringOf(g)`：≥5 条链，链质心在绕主轴的闭合圆上（半径偏差 < 20%，最大角间隙 < 3 个平均间隔）→ 一个鼓 `drumGeo`（LatheGeometry 圆角截面；内孔 > 40 Å 画成环形）。径向 10–90 百分位、高度 5–95 百分位。
- **管** `isTube(P)`：Cα 路径平滑（±6 残基 ≈ 螺旋轴）后，<35% 的点在 11 Å 内碰到序列上相隔 >25 的点（不折返），且路径 > 45 Å → 4.5 Å 粗的弯管（核酸 9 Å），控制点每 4 个取一个、向心 CatmullRom（避免自交描边条纹）。
- **判定顺序**：先 `isTube`（在整条链上判断；先做核心过滤会把茎这样的长螺旋判成大叶片）；不是管才做叶片。
- **叶片** `fitLobe`：只用**球状核心**拟合（与序列相隔 >12 的残基在 10 Å 内有 ≥3 个邻居；柔性尾巴、孤立螺旋没有）；PCA 轴，半轴 = √5·SD + 1.5 Å（均匀椭球的 SD = 半轴/√5）；三阶矩决定锥度。
- **结构域**：预设 `domains: [['名称', [[起, 止], ...]], ...]`（按 label_seq_id，文献残基范围，用整条链不经核心过滤）优先；否则 k-means：场景只有 1–2 个部件时约 50 残基一个、>100 残基才分（单个蛋白要看到结构域，例如腺苷酸激酶 CORE/NMP/LID），多部件场景约 330 残基一个、>660 才分。
- **强制叶片** 预设 `lobes: ['关键词']`：跳过管判定，核心按与**任何链**的接触取（组蛋白折叠靠和配对组蛋白交握，链内接触少，会被误判成管；尾巴被去掉）。核小体用它画出 8 个组蛋白球。
- 构象变化（过程 blend、两态 morph）时叶片实时重新拟合（`refitLobes`/`applyBlends` 的 lobe 分支）。
- “剖”对简化部件按整条链去掉（质心落在楔形里）。

### 15.3 低分辨率表面 `buildSurfaces(g)`（简化样式二）
molmap 做法：每残基一个高斯（σ = 0.225 × 分辨率），网格 = 分辨率/4，**等值面按体积取**（残基数 × 136 Å³，核苷酸 ×3），surface nets 抽取。顶点颜色取最近残基（彩虹/按链着色也成立）。构象变化时按权重分档重算（`resurface`）。

### 15.4 画风（外观 → 画风）
- 视频光影：黑底、辉光、彩色边缘光、景深。
- 插画（Mol* / PDB-101）：`applyBg()` 设浅灰底、关辉光/暗角/颗粒/景深，`U.uIllus = 1` → 团块、飘带、表面在 `opaque_fragment` 之后直接输出平涂色（不受高光冲淡）；所有表示加**倒置外壳描边** `outlineOf()`（背面 + 视空间沿法线外推 0.26% × 距离 ≈ 恒定线宽；实例化团块共享 instanceMatrix 并做同样的楔形剖开与形变）。很浅的部件色（L > 0.78）自动压到 0.66，避免白底上看不见。
- 重要 bug（v3 修）：片元着色器里 `USE_INSTANCING_COLOR` 不存在（只在顶点着色器定义），原来的 `#ifdef USE_INSTANCING_COLOR` 永远取 `diffuse`=白 → 边缘光一直是白的、团块发“奶白”。改为 `#if defined(USE_COLOR) || defined(USE_INSTANCING_COLOR)`。

### 15.5 标注与讲解
`rebuildLabels()/updateLabels()`：预设有 `notes` 时只标注有讲解的部件；否则按大小取前 16 个。点击弹出讲解卡片。

## 16. v4：按功能分区的简化（用户要求：简化是为了表达功能，外形只用于辨认）
**三层**（一条链可以跨层）：
| 层 | 判定 | 画法 |
|---|---|---|
| ① 功能核心 | `computeCore(g)`：Cα 在小分子/离子 8 Å 内的残基（两态 p/p2 都算；脂类 `LIPIDS` 不算；单原子离子 >20 个时不算），加预设 `core` 条目 | 原子团块（×1.12），按化学性质着色 `RES_CHEM`（酸红、碱蓝、极性青绿、芳香紫、含硫黄、Gly/Pro 白、其余疏水沙色；黑底整体 ×0.62 防辉光过曝）；从简化形状里挖掉，保证露出来 |
| ② 功能部件 | 简化且会转/有构象/有核心的部件 | 每个结构域一个低分辨率**密度团** `domainBlobGeo`（res = clamp(10+0.025N, 12, 18) Å，136 Å³/残基，向内收 1.5 Å 留缝），刚体 Kabsch 放置 `placeLobe`（随构象动）；环 = 每亚基一节 `ringSegGeo`（内孔 ≥6 Å 时保留），有核心的环改为逐链密度团；对称副本用模板缓存 |
| ③ 支架 | `g.faded`：简化、≥3 个部件、不转、无构象、无核心、**不是核酸**（核小体 DNA、rRNA 本身就是功能） | 半透明 0.42、无描边、颜色向 `FADE_TO` 插值 |

- **孔道**：≥3 条链且核心靠近对称轴（rCore < 0.5·rC）→ `updatePore` 每帧把朝向镜头的那个亚基淡到 0.13（核心细节也按链分开淡化），KcsA 能直接看到过滤器。
- 默认（推荐）：预设 `keepDetail` 部件保留细节；否则有小分子 / 两态 / 过程 / ≥2 个部件就简化，单个无配体蛋白（如 HK97）保留细节。
- 示意图明暗：`baseC·(0.66 + 0.30·lam + 0.08·up)·edge`（主光 + 边缘压暗），描边恒开（③ 除外）。
- DNA 双链：按螺旋周期平均磷酸（`smoothPath(P,5)`）得到轴，取与配对链（>50% 的 P 在 22 Å 内）中点，只由 asym 排序靠前的链画一根 10 Å 管；核酸用暖色（浅 #e3a35a / 深 #ffb347）。

## 17. 小分子聚焦 `focusLigand(L, idx, n)`
1. 图例里小分子行的 ⌖ 按钮（多拷贝时循环 1/n）；被过程动画藏起来的小分子以虚线 ◇ 行列出，仍可聚焦。
2. 下载位点全原子：`models.rcsb.org/v1/{L.src}/residueSurroundings?label_asym_id=&label_comp_id=&radius=5`；只留 altloc '.', '?', 'A'（否则 A/B 重复原子造成 0.5 Å 假盐桥）。
3. 坐标对齐：用匹配的 CA（离配体最近的拷贝；L.state 为 1 时用 p2）+ 配体原子名做 Kabsch，把文件坐标映射到场景。
4. 相互作用（按（类型, 配体原子, 残基）去重）：氢键 N/O…N/O ≤ 3.5 Å；盐桥 阴离子 O（连 P 或羧基）…Lys NZ / Arg NE,NH1,NH2 / His ≤ 4.0 Å；金属配位 ≤ 2.8 Å（K/Na ≤ 3.2 Å）；疏水 C…C ≤ 4 Å。虚线圆柱 `dashes()`，只把有接触的残基画成棍棒并加 `.rlab` 标签。
5. 聚焦期间：其他小分子、过程对象 procRoot、核心团块、所有描边隐藏；所有简化形状半透明 ≤0.18；相机飞到配体（保持视线方向）。退出（信息卡 ×）恢复材质并**回到聚焦前的镜头**。
6. 信息卡：相互作用列表、构象变化 `domainTurns`（p→p2 或过程 alts 开放→紧密，各结构域相对第一个结构域的刚体转角与位移，DynDom 式，数值全部来自坐标）、预设 `siteNotes`。

## 18. 能量转化条 `#energy`
- 过程或预设字段 `energy: [['标签', '解释'], ...]`；当前步由过程的 `stage(ctx)` 给出，或预设 `energyStage: 'morph'`（按两态变形值，AdK）。点击标签在信息卡显示解释。
- 已写：ATP 合酶（Δp → c 环扭矩 → γ 转 120° → β 构象 → 释放紧结合 ATP；Boyer：能量主要用于释放 ATP）、鞭毛马达、KcsA（电化学梯度 + 羰基氧补偿脱水）、AdK（近平衡磷酰转移，LID 闭合排水）。

## 19. v5：选择集驱动的交互（借鉴 iCn3D / NGL，按本项目的单文件结构实现）
**原则**：所有“选中”途径——3D 点击、图例名称、部件标签、能量条步骤——都只往**一个选择集** `sel.ids` 里写 id，再由 `applySelection()` 统一执行：其余部件淡化（不透明度 0.14，跟随模式 0.32，隐藏描边）、选中的残基加金色透视标记球（`depthTest:false`，埋在里面的残基如通道过滤器也看得见）、标签高亮；调用方再决定镜头和信息卡。
- id：`part:<部件序号>`、`residue:<asym>:<label_seq>`。小分子不进选择集：点击即 `focusLigand`。
- **拾取** `pickAt()`：不对网格做三角形求交（实例化团块 × 15 万残基太慢），而是射线对每个残基球（半径 3.6 Å，两态按 uMorph 插值）求交：所有表示（团块、结构示意、简化形状、表面）都由同一组残基生成，一个测试通用；先用部件包围球剔除。鞭毛马达 15 万残基一次点击约 30 ms。③支架加 30 Å 惩罚（射线上有别的东西时不选它）；剖开楔形里的残基跳过；小分子减 6 Å（优先于周围蛋白）。
- 点击与拖动区分：按下到抬起移动 < 6 px 且 < 600 ms 才算点击。点空白取消；Esc 取消选择 / 退出聚焦；聚焦期间点击不触发（防止旋转时误退出）。
- **镜头** `flyTo/flyView`：0.65 s 三次缓出；用户一拖动就取消（OrbitControls 'start'）。聚焦飞入、退出飞回原视角、选部件飞到部件包围球。
- **信息卡** `showSelInfo(g, a)`：残基 = 名称（作者编号 `a.aseq`，与文献一致）、链、化学性质、离最近小分子的距离、属于哪一层（①②③）+ 部件讲解。
- **能量条联动**：过程 / 预设字段 `energyHL[i]` = 第 i 步涉及的结构：部件关键词，或 `{ part?, aseqs: [[起, 止]] }`（**作者编号**；KcsA 1BL8 的 label_seq 比作者编号小 22，用 label 会标错）。点步骤 = 高亮 + 解释；“◎ 跟随”开启后播放到哪一步自动高亮哪一步（不覆盖用户自己的点选）。
- 坑：`mesh.userData.outline` 在主网格上存的是**描边对象的引用**，描边网格自己是 `userData.outline === true`。判断“是不是描边”必须用 `=== true`，否则会把主形状当描边隐藏（v4 聚焦里就有这个 bug）。

## 20. 口袋表面（Web Worker）
- 聚焦小分子时，用位点残基（5 Å 内，全原子，不含小分子）算**高斯分子表面**（Mol* / NGL 的 gaussian surface 思路）：每个原子贡献 exp(−2d²/R²)，R = 范德华半径，等值面 exp(−2) 使孤立原子的表面正好在范德华半径处；0.5 Å 网格，surface nets 抽取；离小分子中心超过（小分子半径 + 5 Å）的面片丢掉 → 只留口袋。颜色 = 最近原子所属残基的化学性质（与功能核心团块同一色表）。
- `pocketSurfaceJob` 是纯函数，`runPocketJob` 用 `Function.toString()` 拼成 Blob Worker 运行；Worker 不可用时同一函数在主线程用 setTimeout 跑。按需计算，只在聚焦时算，不在启动时算。信息卡有“口袋表面：开/关”。
- 极性接触 < 2.4 Å 的 N/O 原子对不计入（沉积模型的交替构象或几何冲突；例如 1AKE 的 Ap5A D-磷酸 altloc A 距 Arg156 NH1 2.0 Å），信息卡单独注明个数。

## 不照搬的部分（决定与理由）
- **Cartoon**：已有“结构示意”（螺旋圆柱、折叠箭头、卷曲细管，Cα 样条），即 NGL cartoon 的同一路线，不重复实现；期刊机制图更常用圆柱螺旋。
- **整体分子表面**：已有按体积的低分辨率表面（molmap）作为简化样式；高分辨率全分子表面对 15 万残基的场景代价大、教学价值低，只在口袋这个局部用。
- **拆 src/ 多文件**：保持单 HTML 文件（skill 分发、双击打开、data: URL 预览都依赖它）；在文件内按“选择集 / 拾取 / 镜头 / Worker”分节。

## 21. v6：价键模型 + 多机器协同场景
### 21.1 小分子画法（面板“小分子画法”，聚焦信息卡里也能切换）
- 球棍：原画法。**价键**：键级来自 RCSB 化学组分字典（CCD）的 `_chem_comp_bond`（`value_order` + `pdbx_aromatic_flag`，芳香键记为 4），按**原子名**对应到结构里的原子（`bondsFromTemplate`）：单键一根、双键两根平行细棒、三键三根、芳香键 = 实线 + 环内侧虚线；平行偏移方向取相邻键所在平面（芳香键偏向环内）。原子只画成键的关节；离子仍画成球。**空间填充**：范德华半径。
- 静态小分子先用距离猜键立即显示，再异步取 CCD 模板换成真实键级（`upgradeLigandBonds`，每种化合物一次）。聚焦时位点残基也用标准残基的 CCD 模板（主链 C=O、Arg 胍基、芳香环都画对），相邻残基补肽键。
- 口袋表面默认关闭（会挡住小分子），信息卡按钮打开。
### 21.2 场景参数（多 PDB 拼成一个协同场景）
- `axisFit: [跨膜亚基关键词]`：这些亚基原子的 PCA 最扁方向 = 膜法线 → +Y（宽而薄的膜复合体用；`up` 再定朝向）。
- `groupParts: [['复合体 I', 关键词...], ...]`：把几十个亚基合并成按功能命名的部件（按顺序匹配，先写更具体的）；原始亚基名仍保留在 `a.entName` 和 `entityStats` 里（膜定位、对齐用）。**部件名互为子串时，colors / notes / energyHL 的键要用正则 `'/^复合体 I$/'`**，否则 '复合体 I' 会匹配 '复合体 III'。
- 组件新字段：`axisFrom`（同主结构，如 c 环 → β 定转子轴）、`alignTo: { own, anchor }`（组件某亚基与主结构某亚基同高 = 同一层膜）、`beside: { part, gap }`（放在主结构某部件那一侧、不重叠）、`split: true`（每个亚基一个部件，转子 / 定子可分开）、`pivot`（转动部件绕这个亚基的竖直轴转，`spinPose(g)`）。没有 `anchor` 时不再对齐到第一个实体（旧 bug）。
- `frameAll: true`：镜头框住所有组件；`camera.broadside: true`：自动从整排机器的侧面看（水平 PCA 长轴的垂直方向）。
### 21.3 线粒体呼吸链 `respiratoryChain`
- 5GUP（猪呼吸链超复合物 I₁III₂IV₁，Wu 等 2016 *Cell* 167:1598）+ 1HRC（马细胞色素 c）+ 6ZPO（牛 ATP 合酶，放在复合体 IV 一侧、c 环与细胞色素 b 同高）。
- 电子沿**沉积结构里真实的辅因子位置**跳：复合体 I = 铁硫簇图上从基质端到 N2 的最短路径（边 < 20 Å，代价 d²，自然跳过不在主链上的 N1a）；III = 离复合体 IV 的 CuA 最近的 c1 所在单体，bL = 离 c1 最近的血红素 b，bH = bL 基质侧最近的血红素 b（两个 bL 跨二聚体只隔约 14 Å，比 bL–bH 还近，不能只按距离配对），Rieske FeS = 离 bL–c1 中点最近；IV：成对的 Cu = CuA，单个 Cu = CuB，离 CuB 最近的血红素 a = a3。
- 动画循环（每个 NADH）：NADH → FeS 链（复合体 I 同时泵 4 H⁺）→ QH₂ 经膜到 Qo → 电子分道（Rieske → c1 / bL → bH → Qi），释放 4 H⁺、摄取 2 H⁺ → 细胞色素 c 带着发光的血红素从 III 移到 IV（它自己的 HEC 配体隐藏，由动画画）→ CuA → a → a3/CuB → O₂ → H₂O，泵 2 H⁺、消耗 2 个化学 H⁺。ATP 合酶按转角：每 1/8 圈一个 H⁺ 回流，每 1/3 圈一个 ATP。
- 能量条 7 步（ΔE°′ ≈ 1.14 V，ΔG°′ ≈ −220 kJ/mol，10 H⁺/NADH，c8 环 8 H⁺/3 ATP，约 2.5 ATP/NADH），`energyHL` 联动高亮。

## 22. v7：叶绿体光反应 `chloroplast`
### 22.1 场景
- 主结构 3JCU（菠菜 PSII-LHCII C2S2，Wei 等 2016 *Nature* 534:69），组件 6RQF（菠菜 b6f，Malone 等 2019 *Nature* 575:535）、5L8R（豌豆 PSI-LHCI，Mazor 等 2017 *Nat Plants* 3:17014）、6FKF（菠菜 CF1Fo，Hahn 等 2018 *Science* 360:eaat4318）、1PLC（杨树质体蓝素，Guss 等 1992）、1A70（菠菜铁氧还蛋白，Binda 等 1998）、1FNB（菠菜 FNR，Bruns & Karplus 1995 *JMB* 247:125）。
- 朝向：上 = 基质，下 = 类囊体腔（`down: 'Oxygen-evolving enhancer protein 1'`，新增的 `down` 与 `up` 相反）。b6f 用 `axisFrom [b6, f]` + `flip`（f 在腔侧）。
### 22.2 新参数
- `beside: { dir: 'row', gap }`：沿主结构水平 PCA 长轴（`model.rowDir`，`rowFlip` 反向）排成一排，每个组件接在**已放置的全部结构**之后。
- `at: { part, dy, along }`：组件质心放在某部件 / 亚基（含组件的 `entName`）质心 + dy（向上）+ along（沿排方向）。组件原子现在也带 `entName`。
- `coreLigands: [...]`：只有这些小分子定义功能核心和位点闪光（否则几百个叶绿素会让天线全部变成原子级，且计算量 O(配体原子 × 残基)）。
- `ligOff: [...]`：这些小分子组默认不勾选（色素、脂），图例里可勾上。
- 下载时每个结构最多 24 种小分子（原 12），`coreLigands` 优先、`ligOff` / 脂类最后（3JCU 有 22 种，原来锰簇、去镁叶绿素、叶绿素都被截掉了）。
- **膜条带**：`frameAll` 场景的膜沿排方向铺成矩形条带（覆盖所有机器），剖切面竖直穿过场景中心、朝向镜头（`resetCamera` 后重新瞄准），前半膜切掉，机器全露出来。呼吸链场景同样受益（细胞色素 c 不再被膜挡住）。
### 22.3 过程
- 辅因子定位（都取自沉积结构）：PSII 选靠近 b6f 的单体的 OEX；两个 PHO 的中点附近、腔侧、Mg 环中心距离最近的一对 CLA = P680；D1 Tyr161（作者编号）= TyrZ；D1 一侧的 PHO 是活性分支；FE2 旁结合在 D2 的 PL9 = QA、D1 的 = QB。b6f：腔侧、离 PSI 最近的 HEC = 细胞色素 f，bL / bH / Rieske 同呼吸链规则，基质侧 HEC = 血红素 cn。PSI：CL0 + 最近的 CLA = P700，PQN = A1，SF4 按离 P700 距离 = FX、FA、FB。
- 每轮 = 2 个电子 = 1 NADPH（`async cycle()`，Promise 串起各步）：2 个光子 → 天线叶绿素 → 激子 → P680 闪光 → 电子 Pheo → QA → Fe → QB，同时水 → Mn 簇 → TyrZ → P680，放 2 H⁺ 入腔，QB 从基质取 2 H⁺；每两轮放 1 个 O₂ → PQH₂ 经膜到 Qo → Q 循环（4 H⁺ 入腔，低电位链 bL → bH → cn → Qi）→ 质体蓝素带着发光的 Cu 移到 PSI → 2 个光子激发 P700 → A1 → FX → FA → FB → 铁氧还蛋白带着 FeS 移到 FNR → FAD → NADP⁺ → NADPH。CF1Fo 按转角：每 1/14 圈一个 H⁺，每 1/3 圈一个 ATP。
- 能量条 7 步：光能捕获、PSII 电荷分离 + 水裂解、Q 循环、质体蓝素穿梭、PSI 再次激发（Z 方案）、Fd → FNR → NADPH（ΔE°′ ≈ 1.14 V，+220 kJ/mol，4 个光子约 690 kJ/mol）、质子动力势 → ATP（c14：约 4.7 H⁺/ATP，约 1.3 ATP/NADPH < 卡尔文循环所需 1.5，由环式电子流补足）。

## 23. v8：插画画风的“质感”（屏幕空间墨线 + 宏观明暗 + 远处淡出）
用户反馈：白底描边方向是对的，但不够清晰、没有质感。原因：纯平涂没有体积；描边只有每个网格的外轮廓（反转外壳），同一形状内部的亚基 / 结构域没有分界；远近一样深；ACES 色调映射把粉彩压灰。
- **InkPass**（紧跟场景 RenderPass，在 AO 之前；composer 两个渲染目标都挂 `DepthTexture`）：只读深度缓冲，所以对团块、结构示意、简化表面、小分子、所有自定义顶点着色器（形变、剖切、团块抖动）一律有效。
  - 轮廓线：当前像素比邻居（1 px 十字 + 半径 `uLW` 的 8 点环，`uLW ≈ 2.2 px × 分辨率/900`）远出一个阈值（`uT1 + uT2 × 像素大小`，单位 Å）→ 画在远侧，线宽恒定像素。
  - 沟槽细线：深度拉普拉斯 > 0（凹处），阈值随像素大小缩放，强度 0.5 → 残基 / 结构域之间的细纹理（Goodsell 风格）。
  - 宏观明暗：用半径 `uMacro ≈ 8 px` 的深度梯度重建法线（跨轮廓的样本不用），左上方光源 → 整个结构域呈圆润体积，单个残基仍是平涂（逐残基明暗会变成“泡泡”，已否决）。
  - 远处淡出：`smoothstep(镜头距离 − 0.25R, 镜头距离 + 1.3R)` 向纸色混合，线也随之变淡；滑块“插画线条”“远处淡出”。
  - 标记：膜脂材质（`blobMaterial({ tag: true })`）在插画模式输出 alpha 0.5，InkPass 见到就只画浅线；半透明支架用 `CustomBlending`（`blendSrcAlpha = Zero, blendDstAlpha = One`）保留后面物体的标记。
- 插画模式去掉反转外壳描边（`outlineOf` 返回空组）：外壳的深度被推后，会被“远处淡出”染成灰色光晕。
- 插画模式 `renderer.toneMapping = NoToneMapping`（颜色按设定输出），调色板 s ≤ 0.66、l 0.46–0.64，调色 pass 饱和度 1.0 / 对比度 1.03，纸张轻微暗角 + 颗粒。
- 预设字段 `solid: [...]`：这些部件永不画成半透明支架（被动画移动的穿梭蛋白：质体蓝素、铁氧还蛋白、细胞色素 c）。

- 默认画风改为插画（白底墨线），用户选择；黑底辉光仍可在“画风”里切换。

## 24. v9：细胞区室实时模拟（浓度、pH、膜电位随时间变化）
用户要求：不只看一个蛋白，要看整个过程里细胞各区域的变化（浓度等）和多蛋白协同。
- 过程定义可带 `cell: { init(), step(s, h, ctrl) → flux, controls, series, comps(s, f), dots, explain(s, f, ctrl) }`。`loadScene` 在 `resetCamera` 之后 `startCellSim(P.cell)`；`clearScene` 调 `stopCellSim`。
- 积分：每帧把 dt 切成 ≤ 0.02 s 的步长调用 `step`；`step` 返回 `flux`，其中 `rate`（电子流相对值）决定动画节奏：`ctx.pace() = max(0.3, 转速/0.6) × clamp(rate, 0.5, 1.8)`，过程的循环只在 `rate > 0.08` 时开始新一轮（关灯 / 缺氧时动画停下）；`rotor`（ATP 合成速率相对值）乘到转子角速度上。
- 动力学模型（离线用 Python 调参，结果对上教材数值）：
  - 线粒体：pmf、NADH、ATP 三个状态；呼吸控制（pmf → 205 mV 时电子传递变慢）、ATP 合酶阈值 140 mV、漏、TCA 供 NADH、细胞耗 ATP。开关：底物 / O₂ / 高耗能 / 寡霉素 / DNP。寡霉素 → 耗氧降到 ~20 %；DNP → 耗氧 ~380 %、ATP≈0；缺氧 → 全部塌陷。
  - 叶绿体：光强、卡尔文酶激活（τ≈6 s）、ΔpH、NADPH、ATP；b6f 在腔 pH < ~5.8 时减速（光合控制）、环式电子流（只泵 H⁺ 不产 NADPH）、卡尔文循环 3 ATP + 2 NADPH / CO₂。见光稳态：腔 pH ≈ 5.6，基质 ≈ 8.1。开关：光照 / 环式电子流 / 解偶联剂 / 抑制 ATP 合酶。
- 3D：每个区室（膜上方 `top` / 下方 `bot`，高度 ≥ 106 Å）一块面向镜头的背景板，放在所有原子后面，颜色按 pH（酸红 → 中性黄绿 → 碱蓝），两端和远离膜的一侧淡出；**必须 `DoubleSide`**（按 `atan2` 转向后正面朝向判断不可靠，单面时整块被剔除）。旁边 HTML 标签显示区室名 + 实时 pH，不与左侧面板重叠。
- 游离分子：每种一个 `InstancedMesh`，数量 = `count(s)`（H⁺ 按 10^(−pH) 换算），在区室盒内布朗漂移。插画模式用 `MeshBasicMaterial` 平涂（墨线由 InkPass 画），视频模式用自发光材质；切换画风时自动换材质。`label` 字段生成图例。
- HUD（右上）：每个量一行数值 + 迷你曲线（每 0.25 s 一点，保留 240 点），开关按钮，图例，以及按当前状态生成的中文讲解。点标题折叠。信息卡打开时隐藏。
- 隐藏的浏览器页 / 零尺寸画布：`camera.aspect` 会成 NaN → 相机、剖切平面全部 NaN，three.js 报 “toArray is not a function”。`safeAspect()`、`applyCut` 与 resize 都加了有限值检查。

## 25. v10：拆装模式（亚基取下来、看它们怎么连在一起）
用户要求：亚基可以像拼装模型一样拿下来，看不同亚基怎么连接。
- 入口：面板“拆装 → 🧩 拆装亚基”。只拆当前**可见**的部件（先在“组成”里隐藏不需要的）。进入时隐藏正常场景（部件网格、小分子组、膜、过程动画、区室模拟的背景和标签），退出时恢复；`clearScene` 自动退出。
- 零件 = 一条聚合物链（key = 部件序号 | 来源条目 `a.src` | asym，所以组件条目里同名链不会混）。每条链一个 `blobInstances` 网格；颜色按亚基种类（实体），同种的几份明暗略不同。小分子挂在最近的链上（≤ 7 Å），跟着它一起被取下；膜脂 / `ligOff` 不带。
- **残基级界面（即时）**：Cα 网格哈希，不同链 Cα 间距 < 8 Å（核酸 P < 10 Å）＝界面残基；每个残基记最近的伙伴链 → 伙伴列表、界面残基数。**界面印记**：间距 < 6.5 Å 的残基染成伙伴链的颜色（像拼图的榫口），可关。
- **拆开**：每块沿（自身质心 − 整体质心）方向移动 `v·1.25e + dir·e·(24 + 0.6r)`；“取下来”只把选中的一块再往外拉 `0.9r + 30`；位置每帧指数平滑。选中一块时，和它不接触的链变成 22% 透明。
- **按顺序组装**：预设字段 `assembly: [关键词...]` 给出文献里的组装顺序；没有时用贪心估计（最大的先放，之后每次放和已装部分界面残基最多的那块），界面上写明“按界面大小推测，仅示意”。
- **全原子界面（点按钮）**：从 RCSB ModelServer 下载选中链和最多 8 条伙伴链的全部原子（`atoms?label_asym_id=`，按条目 + asym 缓存；> 2500 个残基的链跳过），每条链用**它自己的** Cα（核酸用 P）与场景坐标做 Kabsch 叠合 → 对装配体对称拷贝（`_1`、`_2` 后缀）也正确。判定：二硫键 SG–SG ≤ 2.5 Å；盐桥 Lys NZ / Arg NE NH1 NH2 对 Asp OD / Glu OE / 磷酸 OP ≤ 4 Å；氢键 N/O–N/O 2.5–3.5 Å；疏水 两边都是疏水残基的侧链 C–C ≤ 4 Å；N/O 距离 < 2.5 Å 算模型几何误差，单独计数不画。每对残基每种类型留最短一个；同一对残基既是盐桥又是氢键时只算盐桥。
- **连接带**：一个 `InstancedMesh(CYL)`（≤ 800 根），两端是两块链上的真实原子位置，每帧加上各自的偏移 → 拆开 / 取下时被拉长，颜色＝类型（KTYPE）。没算全原子时画灰色的最近界面残基对。
- 测试接口：`__viewer.kit()`、`__viewer.updateKit(dt)`（浏览器面板隐藏时 rAF 不跑，可手动步进）。

## 26. v11：翻译站 `translation`（核糖体实时模拟，可加抗生素）
用户要求：不是“放视频”，而是直接模拟细胞内部；两个分子结合后构象怎么变，加各种抑制剂会怎样；转运必须走真实路径。
- **场景**：4V6F（大肠杆菌 70S + mRNA + E/P/A 三个 tRNA），`keepDetail: ['']`（每个残基一个团块）、`frameAll`（剖面朝镜头）、`cutWhat: 'all'`。场景里的 tRNA / mRNA 网格隐藏，由过程自己画成可动的 body。
- **其他状态的真实坐标**：`alignEntry(id, {ref: '23S'/'16S', chains, ligands})` 只下载参考链的 P 原子 + 需要的链和小分子，按 23S / 16S P 原子叠合到场景：4V5L（EF-Tu·tRNA 弯曲的 A/T 态）、4V9H / 4V5F（EF-G 前 / 后转位）、4V7P（RF1）、4V9A（四环素）、4V51（巴龙霉素）、6ND5（氯霉素）、6XHX（红霉素）、4V5P（黄色霉素）、1TUI（EF-Tu·GDP 张开态，按残基 > 212 叠合）。**选拟合**：label_seq 与 author 编号两种配对都试，取保留 ≥ 30 % 配对里 RMSD 最小的（原先“配对多的优先”使 4V7P 叠成 41 Å 的错位）。全部 0.6–1.0 Å。
- **tRNA 位姿**：模板 = 4V6F 的 P 位 tRNA；位姿 `{q, t}` 把模板点 x 放到 q(x − c) + t。E / P / A 三个位姿由场景 tRNA 拟合，A/T 的弯曲形状从 4V5L 存成模板坐标系下的逐残基形状；杂合态（A/P、P/E）= 每个残基按“受体臂权重”在两个位姿之间 slerp，受体端先动、反密码子端后动。
- **携带体**（EF-Tu、EF-G、RF1、抗生素、游离 TC）：`crNew / crEval / crApply / crFrom / randQ`，刚体位姿 (q0, t0) → (q1, t1) 按 w 插值并加小摆动，从胞质随机点飞入结合位点、再飞走。
- **出口隧道**：`findChannel(全部原子点, PTC, …)` —— **必须把 tRNA、mRNA 也当障碍**，否则会走进亚基间空隙（73 Å 的错误路径）；正确结果 104 Å，经过 L4 / L22 收缩处（7.6 / 8.6 Å）。新生肽沿这条路径排珠，出口外松弛成卷曲。
- **Gillespie 引擎**：状态 = 核糖体所处步骤 + 各位点占据；每步列出所有可能事件和速率（TL_K，单位 s⁻¹，浓度 µM），抽下一个事件和等待时间；分子时间 = `speed` × 真实时间。事件动画**阻塞**引擎（动画结束前不抽下一事件）；速度 ≥ 1 时动画瞬间完成。控件改动 → 丢弃已抽的事件重新抽（无记忆性保证这是精确的）。非同源 TC 的碰撞只计数不阻塞。
- **动力学**（离线 Monte Carlo 校准，tlcal.py）：同源 TC 结合 k1 = 110 µM⁻¹s⁻¹ × [TC]，GTP 水解 1500 / 1.5（同源 / 近同源），校对 k7 等；结果约 13 aa/s、错误率约 5e-4；巴龙霉素使近同源 k3、k5 增大、k7 减小 → 约 1e-2。
- **抗生素**（每种都是真实结合位点的真实坐标，结合 / 解离也是随机事件）：四环素占 A 位 → TC 进不来；巴龙霉素翻出 A1492/1493 → 错读；氯霉素在 PTC，倒数第二位是 Ala/Ser/Thr 时强抑制（上下文特异）；红霉素在隧道，ErmCL 前导肽停在 Ile9，其他序列约 7 aa 掉链；黄色霉素把 EF-Tu·GDP 锁在核糖体上；夫西地酸把 EF-G·GDP 锁住。
- **HUD**：浓度滑块（TC、EF-G、RF1、各抗生素）、mRNA 选择（泛素、ErmCL 前导肽、自定义序列）、速度、暂停 / 单步 / 重来；曲线 = 延伸速率、累计错误率；讲解按当前状态生成。
- **坑**：行中 `//` 注释会吞掉同一行后面的语句（两次：`__viewer` 未定义、tRNA 变白）→ 行内注释一律用 `/* */`，改完用 `node --check` 检查抽出的模块。

## 27. v11：KcsA 钾通道站 `kcsa`（膜中，pH 门控，C 型失活，阻断剂）
- **结构**：1K4C（关，过滤器里 K⁺ 的真实位置 → S1–S4、中央腔），5VK6（开，E71A），5VKE（开 + 失活），2HVK（TBA 在腔里），2ITD（Ba²⁺ 在过滤器，最近 S2）。`loadEntry(id, true)` 取装配体（四聚体），按残基 60–80（孔螺旋 + 过滤器）四条链一起叠合，链对应关系取 24 种排列里 RMSD 最小的（0.08–0.67 Å）。每个残基 `a.alts = {closed, open, inact}`，`setChainBlend` 每帧插值。
- **方向**：过滤器在上（胞外）。若晶体 K⁺ 在质心下方就把场景绕 x 翻转（y、z 取负），同时翻 `model.focus`、`entityStats`、膜位置 `mem1` 和 `ctx.membraneY`。
- **孔道路径**：在**开放态**坐标上 `findChannel` 两次：中央腔 → 胞内（36 Å，只允许 y < 腔），S0 → 胞外（13 Å）。路径 = 胞内段（反向）+ 腔 + S4…S1 + 胞外段；按弧长给站点 `inFar / cav / S4 … S0 / outFar`，离子位置 = `alongPath(path, s)`。
- **两个时钟**：门控 / 阻断剂（毫秒–秒，默认慢放 20 倍）和渗透（纳秒，1 秒 = 2 / 10 / 50 ns）。同一个 `gillespie(budget, rates, fire, slot)` 循环，返回实际用掉的分子时间（被事件动画阻塞的时间不计 → 计时器和期望通量对得上；原先多算了 ~2.5 倍）。
- **渗透模型**：Bernèche–Roux 敲击循环 A[S1,S3] → B[S1,S3,腔] → C[S0,S2,S4] → D[S2,S4] → A；Eyring 电压依赖（电学距离 0.15 / 0.35 / 0.15 / 0.35）；km3 由细致平衡定出 → 电流正好在 E_K 反转（−85.6 mV，140 / 5 mM）。对称 150 mM 时约 100 pS。HUD 的单通道电流用 4 状态稳态解析解（高斯消元）。Na⁺：在 A / D 态以 f₀·[Na]ᵢ/[K]ᵢ·0.5 的速率进腔后被 S4 弹回。
- **门控**：h = 1 / (1 + 10^(2(pH − 4.2)))；C→O 50h，O→C 50(1−h)+2；野生型 O→I 1.2 s⁻¹，I→C 0.3(1−h)+0.03，I→O 0.05；E71A 不失活。失活时 S2、S3 的离子离开，只留 S1、S4（塌陷过滤器）。
- **阻断剂**：TBA（门开且腔空时 kon = 1·c·e^{0.15u}，koff = 3·e^{−0.15u}，门关时被困在腔里）；Ba²⁺（kon = 0.02·c·e^{0.6u}，koff = 0.3·e^{−0.6u}，停留以秒计）。都从胞内沿真实孔道飞进晶体位置。
- **验证**（1500 帧离线步进）：+50 mV 净外流 50 个（期望 46），−140 mV 净内流 22（期望 21），E_K 处 −3（期望 0）；TBA 5 µM 开放概率 36 %，Ba²⁺ 50 µM 17 %；野生型稳态 2 %；pH 7 门不开。

## 28. 怎样做一个“模拟站”（给后来的 AI）
1. **先写清楚要回答的问题**：结合后构象怎么变、抑制剂作用在哪一步、物质沿哪条路走。每个问题对应一个可调控件和一条曲线。
2. **每个构象 / 结合态都用真实结构**：找 PDB 条目（RCSB 搜索，按物种、配体、突变体），用保守区叠合到场景（`alignEntry` 或按残基号的 `superpose`），打印 RMSD，> 2 Å 就查配对。
3. **路径用 `findChannel` 在真实坐标上算**（障碍要包括所有占位分子），站点用晶体里的离子 / 配体位置。
4. **动力学 = 离散状态 + 速率**：先离线（Python，无 numpy 也行）解稳态 / Monte Carlo，对上文献数值（速率、电导、错误率、反转电位），再搬进 JS。速率依赖控件（浓度、电压、pH），控件变了就重抽下一事件。
5. **动画只是状态转移的显示**：事件触发 tween；阻塞型 tween 暂停分子时钟；快进时 tween 瞬间完成。计数器只计实际模拟的时间。
6. **HUD**：`cell: { title, wide, noWarmup, timeLabel, controls, series, comps, dots, explain }`，讲解按当前状态生成，写出数字的来源（公式、条目号）。
7. **验收**：在页面里关掉渲染、手动步进 `proc.update(ctx, dt)` 上千次，把统计量和解析解比；再截图看路径、构象和标签。

## 29. v12：组合场景 `cellCorner`（细胞一角：核糖体 + 钾通道同时模拟）
- **预设**：主条目 4V6F（核糖体，`frameAll`、`cutWhat: 'all'`），组件 1K4C（`chains: ['C']` 去掉 Fab；组件现在支持 `chains` 过滤）。
- **子站**：`Object.create(PROCESSES.translation / kcsa)`，共享同一个 `ctx`（计数器、膜位置、`ctx.cell.ctrl`），各自的引擎和时钟不变；`update` 依次调用。
- **顺序很重要**：组件在加载时放在原点，和核糖体重叠 → 翻译站 setup 时临时把 `model.allAtoms` 换成只有核糖体（否则隧道搜索和 `Rr` 会被通道污染）；之后把通道平移到“核糖体顶 + 60 Å”的膜高度、沿屏幕右方向（E→A 轴）偏移，**保证通道轴在剖面里**（剖面是过焦点、朝镜头的竖直面）；再重算 `model.radius / focus`、`mem1`、`ctx.membraneY`，最后跑钾通道站 setup。
- **钾通道站通用化**：孔道轴 = 通道质心的竖直线（不再假定在原点）；“过滤器朝上”的翻转只转通道和它自己的小分子（绕质心转 180°），不动场景其余部分和膜。2ITD 里轴上有几个 Ba²⁺：取最靠胞内的一个（S4）。
- **翻译站**：新增可选 `yMax`（膜下 30 Å），游离的三元复合物、EF-G、RF1 和抗生素分子不会漂进膜里。
- **HUD 组合**：两站的 `cell` 控件 / 曲线 / 区室 / 小球拼在一起；子站回调里引用的是全局 `proc`，用 `wrapSub(fn, i)` 在调用期间把 `proc` 指向子站。胞内 pH 默认 7.2（生理）；讲解里写明 KcsA 只在酸性（实验条件）下打开、本模型不含 pH 对翻译的影响。
- **镜头按钮**：全景 / 看核糖体 / 看钾通道（`flyTo`）；能量条随所看的站切换（`energy`、`energyHL` 写成 getter，钾通道的高亮加 `part: 'KcsA'`，否则会选中核糖体蛋白里同号的残基）。
- **教训**：全景里通道只有 ~30 px，墨线和后面的膜脂把它淹没（不是遮挡 bug：膜上确实有洞，已用实例矩阵核对）→ 加标签、收紧取景，并提供“看钾通道”按钮。

## 30. v13：让场景占据屏幕 + 细胞质拥挤
审查结论：普通尺寸窗口（约 830×620）里，左侧面板、模拟面板、能量条和说明合计挡住了 3D 场景的大部分；细胞场景里机器漂在空白里，不像细胞内部。
- **视图偏移**：每帧算左侧面板右边缘和模拟面板左边缘之间的空白区，`camera.setViewOffset` 把画面中心移到空白区中心；`safeAspect()` 乘上空白宽度比例，自动取景按空白区适配。拾取、标签投影用同一个投影矩阵，所以仍然对齐。
- **小窗口**：带实时模拟的场景在宽度 < 1600 px 时加载完自动收起左侧面板（☰ / H 打开）。
- **模拟面板**：控件分节可折叠（控件 > 12 个时只展开第一节）；讲解默认收起成两行，点击展开。
- **说明条**：默认两行，点击展开全文；能量条改成单行横向滚动，当前步骤自动滚到中间。
- **过程标签去重叠**：高亮 / 警告标签优先，其次普通，再次小标签；与已放置标签或面板重叠的淡出（零件标签原来就有去重叠）。
- **细胞质拥挤 `buildCrowd(spec)`**：用真实结构（CA / P，每分子 ≤ 300 个粗粒小球、半径按体积放大）生成浅色背景分子，只放在剖面后方，避开场景原子和已放的分子（8 Å 网格）。数量 = 每个大肠杆菌细胞的拷贝数 × 盒子体积 / 细胞质体积（约 7×10¹¹ Å³），其余用几种代谢酶补到目标蛋白体积分数（默认 0.16，真实约 0.2–0.3，略稀以便看清）。平涂浅色 + 墨线，像 Goodsell 的细胞剖面图；20 面小球保持帧率（软件渲染 24 fps）。
- 细胞一角的背景：EF-Tu（1EFT）、70S 核糖体（4V6F）、RNA 聚合酶（6ALH）、GroEL/GroES（1AON），补充 GAPDH（1GD1）、丙酮酸激酶（1PKN）、TIM（1TIM）、腺苷酸激酶（4AKE）；讲解里列出实际放了多少个。

## 31. v14：自动模式（任意 PDB 编号，没有预设也能讲清楚）
输入框里输入不是预设的编号 → `loadScene({ id, auto: true })`。
- **`fetchAutoInfo(id)`**（与坐标下载并行）：RCSB GraphQL 取方法、分辨率、物种、关键词、主要文献、实体注释（mpstruc / OPM / PDBTM / InterPro / GO）、实体与 UniProt 的序列对应（`rcsb_polymer_entity_align`），以及每个链实例的 `MEMBRANE_SEGMENT` 特征（OPM > PDBTM > MemProtMD，label_seq 区间）。再从 UniProt REST 取功能注释和拓扑结构域（`ft_topo_dom`：Cytoplasmic / Extracellular / Periplasmic / Lumenal ...），经序列对应映射到实体残基号。
- **`autoMembrane(main, info)`**：膜法线 = 各跨膜片段（末 4 个 CA 均值 − 前 4 个）的无符号张量主方向（螺旋和倾斜的 β 链都适用）→ +Y；膜中心 = 跨膜残基的中位高度。胞质侧朝下，证据按优先级：UniProt 拓扑（胞质 / 胞外残基的平均高度符号）> 跨膜片段两端 6 个残基内的 Lys/Arg（正电在内规则）> 膜外 15 Å 内的 Lys/Arg。没有片段注释但有膜相关注释 → `hydroSlab`：600 个方向 × 30 Å 板，只看表面残基（10 Å 内邻居 < 16），得分 = 疏水 − 2×带电，疏水比例 ≥ 0.5 才接受。还返回每个亚基自己的跨膜中心（候选孔道轴）。
- **`PROCESSES.auto`**：先沿中央轴，找不到再沿各亚基的跨膜中心（孔蛋白、水通道）搜孔道。起点 = 轴上膜内净空最大处（≥ 4 Å）；`findChannel` 新增 `opts.goal(point, clearance)`，要求越过膜面 6 Å 且净空 ≥ 9 Å 才算出口；膜内的路径必须留在蛋白自己的“包围半径”里（每 2 Å 高度、12 个扇区里最远残基的最小值 − 3 Å），不能绕进脂质。孔道画成按净空着色的点（红 < 5、橙 < 7、黄 < 10、蓝），一个亮脉冲向上走（不声称是什么在通过）；最窄处衬里残基进入功能核心（`current.corePts` → `computeCore`，原子细节 + 发光）。
- **说明**：`autoCaption` 一句话说清找到了什么、依据是什么；右上「简介」按钮 → `showAutoCard`：方法 / 物种 / 文献 DOI、组成、膜（数据来源和侧向依据）、孔道（长度、最窄净空、衬里残基）、小分子按钮（点一下进结合位点聚焦，再点轮换）、注释、UniProt 功能原文（融合标签 T4L / BRIL / MBP 排后）。小窗口里左面板自动收起，简介卡和模拟面板一样参与视图偏移。
- 诚实的边界：净空是到 CA 的距离（真实孔径还要减侧链约 2–4 Å）；很窄的孔（水通道）在 CA 粗粒点上测不出；侧向证据弱时标签带问号。
- 测试：4HFI GLIC（ECD 朝上，最窄处 Glu222 环 = E-2′）、2OMF OmpF（每个单体一条孔，L3 环收窄）、3SN6 β2AR-Gs（G 蛋白在胞质侧）、2OAR MscL（关闭态，无孔）、1J4N AQP1（CA 测不出）、1EMA / 1LYZ（可溶，不加膜）。

## 32. v15：整个细胞（一个场景从 2 µm 缩放到原子）+ 三种显示模式
- **三个选项卡**（左面板“预设”）：细胞 / 局部系统 / 单个蛋白；`presetCat(name)` 按名字分类，`setMode` 过滤预设按钮，选择记在 localStorage；加载场景时选项卡跟着切换；任意编号（自动模式）属于“单个蛋白”。
- **`PROCESSES.wholeCell`**（`__proto__: PROCESSES.cellCorner`）：先跑细胞一角的 setup，再把它嵌进一个大肠杆菌细胞。坐标统一用 Å；细胞轴 = 细胞一角的 `right` 方向，内膜顶点 = 细胞一角的膜面（`ym`），角落在轴向 +300 nm 处。
  - 细胞级：胶囊形包膜（`capsuleGeo`，内膜、外膜各两层叶面，`shellMaterial` 平涂 + 剖面裁剪；内膜在原子脂质条带处用片元着色器挖一个矩形洞）；拟核（椭球内的随机游走管，标出只画了约 3%、粗细放大）；2.5 万个核糖体（每个一对小球，90% 被拟核排斥，只在细胞级显示）；5 根鞭毛（左手螺旋，截到 3 µm，马达圆柱穿过包膜）。
  - 区域级（角落 ±150 nm）：肽聚糖网（环向糖链 + 轴向肽交联，LineSegments）、脂多糖短线；膜蛋白用 `membraneShape`（loadEntry + fetchAutoInfo + autoMembrane 定向）放到弯曲的膜上（法线 = 局部径向，二维占位网格防重叠，避开原子条带）：ATP 合酶 6OQR、AcrB 1IWG（按每细胞拷贝数）、LacY 1PV6、AqpZ 1RC2、AmtB 1U7G（补到约 20% 面积）、OmpF 2OMF（外膜，3.3 万/细胞）；胞质用 `buildCrowd` 的新选项（`keepFn` 任意体积 + 蒙特卡洛估体积、`cell`、`ptsPer/maxPts` 更粗的形状、`occPts` 避开膜蛋白、数字键网格更快），排除细胞一角自己的拥挤盒子。
  - 缩放：`look('cell'|'region'|'all'|'rib'|'k')`；`zoomTo` 在对数距离上插值并把视线转回正对剖面；层级按镜头距离（> 14000 Å 细胞，> 2600 Å 区域，否则分子机器）切换标签（全局 `tagFilter`）、细胞核糖体点、隔室背板；帧循环里 `current.multiscale` 让近/远裁剪面和墨线雾随距离走，墨线随距离变淡；左上角比例尺。

## 33. v16：运动工具包（不闪现、不闪光、不穿模、都有名字）+ 时间尺度 + 核糖体原子近景
- **原则**：粒子不会凭空出现、闪光或缩小消失。游离分子在自己隔室的溶液里游荡（**池**），反应时从池里**取**最近的一个，沿避开蛋白的布朗路径扩散到位点；产物扩散回溶液、**交还**给所在隔室的池。每个运动的粒子带名字标签（`labelObj`，粒子移除时标签自动消失）；化学事件用会浮起再淡出的**事件标签**（`eventTag`，CSS `.ptag.ev`）说明，不再用 `makeFlash`。
- **避开蛋白**：`occOf()` 给当前模型的原子建 5 Å 空间哈希（模型只存 CA / P，所以默认间隙 8.5 Å 才能让开残基团块）；`atomClear` / `occBusy` / `pushClear`。`brownPath(A, B, {clear, free0, free1, keep, wander, n})` = 两端固定的随机游走（布朗桥），平滑后把点推离原子（两端 free0 / free1 范围内允许贴近，用于结合 / 离开位点），`keep(p)` 把点限制在某个隔室或膜面内。`travel(obj, P, dur, {fadeIn, fadeOut, ease, remove, tumble})` 沿 Catmull-Rom 曲线移动并返回 Promise。
- **池**：`MolPool`（`take(near)` / `give(obj)` / 目标数 `n`：多出的从溶液边缘漂走淡出，缺的从边缘漂入淡入），区域 `boxRegion(B, y0, y1)`（细胞模拟隔室）或 `shellRegion(c, r0, r1, ok)`；`scenePool(key, spec)`、`spPool(name, comp, region, n)`、标准物种表 `SPECIES` + `mkSp(name)`。池里的粒子在主场景（`bulkRoot`，会被蛋白挡住，白底风格用平涂材质让墨线描边），被取走做事时移到叠加层（在通道里也看得见）。
- **细胞模拟**：原来的 InstancedMesh 小点改成池（键 `label@comp`），数量跟浓度走，进程可以直接从里面取 H⁺ / ATP / NADH / K⁺；pH 不再是两张跟着镜头转的背板，而是充满隔室的**体积**（BackSide 立方体 + 片元着色器光线步进，`uCam` 是镜头在立方体单位坐标里的位置；颜色 = pH，密度随 [H⁺] 增大，从任何角度看都一样），标签贴在体积最左侧的竖边上。
- **各场景**：ATP 合酶 —— Mg·ADP（Mg 跟着核苷酸走）和 Pi 从基质池扩散进开放位点，紧密位点里 `synth` 命名事件“ADP + Pi → ATP”，打开时 `release` 让 ATP 扩散出去；H⁺ 从膜间隙池 → a 亚基半通道 → c 环 → 出口半通道 → 基质池（`spawnProton`）。呼吸链 / 叶绿体 —— `protonAcross(pIn, pOut, chan)` 统一跨膜 H⁺；Qo、水裂解放出的 H⁺ 在位点生成后扩散到腔 / 膜间隙；Qi、QB、FNR、O₂ 还原消耗的 H⁺ 从基质取；NADH / NADP⁺ / O₂ / H₂O 从池里来、产物回到池；O₂ 在 a3–CuB 等第二对电子（每 2 个 NADH 还原 1 个 O₂）；穿梭蛋白（细胞色素 c、质体蓝素、铁氧还蛋白）沿避开蛋白的路径扩散；光子直线射入（光不扩散），天线吸收后“激发能”在叶绿素间共振转移到 P680 / P700；ATP 合酶 `atpFromPools`。鞭毛马达 H⁺ 走周质池 → 定子 → 胞质池。KcsA —— 每个离子有自己的进 / 出布朗路径（`ends` / `posOf`），进来的离子就是胞内池里的一个 K⁺，出去后交还给胞外池（`retire`）；标签显示“水合 / 脱水，羰基氧配位”。
- **时间尺度**（左面板“过程动画”）：慢放 = 单个事件（上面这些）；快放（转速 ≥ 1.5 自动切换）= `FlowLayer` 粒子流：每条通路一个 InstancedMesh，粒子沿预先算好的布朗路径从溶液经蛋白到溶液，速率 = 每轮化学计量 × 轮次 / 秒，每条流一个名字标签（光子、e⁻ 流、H⁺ 泵出 / 回流、O₂、NADH / NADPH、ATP）。快放时不再启动详细循环、不再弹事件标签。
- **核糖体原子近景**（翻译预设 → 右上“镜头（原子细节）”）：解码中心 = 4V6F 中 A 位反密码子 6 Å 内的全部残基，肽基转移中心 = A 位 tRNA 3′ 端 7 Å 内的全部残基，取自 RCSB ModelServer `residueSurroundings`；用 4V6F 自己的 16S（解码中心 45 Å 内的 P 原子）叠合进场景（`alignEntry` 现在返回 `f` 和 `refAsym`）。A1492 / A1493 在 1J5E（空 A 位的 30S，收在 h44 里）和 4V6F（翻出）之间按原子名插值：密码子识别时翻出（同源到底，近同源只到一半）。密码子–反密码子氢键 = 真实原子 N/O 距离 2.5–3.35 Å（绿虚线），A1492 / A1493 / G530 与小沟的接触（橙虚线）。近景时背景压暗、mRNA 大球隐藏，状态与事件用标签说明。

## 34. v17：场景包（.glow）、纯数据动画、创意工坊
- **场景包** = 一个 JSON 文件（`format: "glow-scene"`, `version: 1`）：元数据 + `scene`（与预设相同的键）+ 可选 `animation`。规格见 `scene_packs.md`。`packFromCurrent()` 把当前场景（含 `cameraNow()` 算出的视角、剖面、`coverNow()` 截的封面）导出；`importPackText()` / 拖入 `.glow` / `?ws=official/<id>` 打开。本地结构文件现在保留原文（`cfg.structure`），所以 AlphaFold 等自建模型也能导出。
- **安全**：`sanitizePack(raw, trusted)` —— `cleanData` 只留纯数据、限制数量 / 深度、去掉 `__proto__`；非官方字符串把 `<` `>` 转义（很多地方用 innerHTML）；`/正则/` 键必须能编译且 ≤ 200 字，否则当普通文字；`scene` 只保留 `SCENE_KEYS`（= 所有预设用过的键 + 少数新增）；`process` 只能是 `PROCESSES` 里已有的；`checkAnimation` 限制隔室 / 池 / 通路 / 反应数量和速率。工坊的 Node 检查脚本（`workshop/tools/glow-lib.mjs`）直接从 `web/index.html` 截取这段代码在 vm 里运行，所以程序和 CI 的规则永远一致——**改这段代码时保持标记 `const GLOW_FORMAT = 'glow-scene'` 到 `/* a pack -> loadScene config */` 之间自包含**（只依赖 PRESETS、PROCESSES、presetCat）。
- **纯数据动画引擎** `PROCESSES.dataAnim`：`anchor()` 把锚点（坐标 / 小分子 / 残基 / 部件 / 膜 / 中心）解析成模型坐标；`orient.up` 在网格生成前把模型绕水平轴转 180°（同 KcsA 过程的做法）；隔室 = `shellRegion` 限制在膜上 / 下方；`runFlow` = 池里取一个 → `brownPath` 到第一个锚点 → 沿锚点 `travel` → 扩散进目标池（`give`）；`runReaction` = 各反应物从池扩散到位点 → 事件标签 → 产物扩散回池；快放时 `buildLayer()` 生成 `FlowLayer`。全部复用 v16 运动工具包，所以社区动画自动满足质量标准（从溶液来、不穿模、都有名字）。
- **工坊**：两个源（`WS_SRC`：GitHub 仓库 `workshop/official/`、`workshop/community/` 的 raw 地址），各有 `index.json`（`format: "glow-index"`，每项带 `sha256`、`revision`、封面路径）。打开前核对 SHA-256；订阅存在 localStorage（`glowSubs`），以 ★ 按钮出现在对应分类的预设里，启动 4 秒后 `checkSubUpdates()` 比较 `revision`。内容版本是 `revision`，`version` 是格式版本，别混。
- **后端（第一阶段，GitHub）**：`workshop/tools/` 有 `validate.mjs`、`build-index.mjs`（确定性输出，封面写到 `covers/`）、`export-presets.mjs`（内置预设 → 官方包，只在预设变了时升 revision）、`submission.mjs`（投稿 issue → 下载附件 → 检查 → 放进 community/packs）。Actions：`workshop.yml`（PR 检查；main 上重建目录并提交）、`workshop-submission.yml`（issue 模板 `submit-scene.yml` 带标签 `scene-submission` → 自动开 PR 并评论结果）。
- **桌面版**：`raw.githubusercontent.com` 走“优先联网、断网读缓存”，工坊目录和看过的场景离线也能打开。`GLOW_SMOKE_JS`（在页面里跑测试脚本）和 `GLOW_SHOT`（存 640×360 封面）用于测试和生成封面。

## 35. v18：专业化第一步——证据等级、诊断、回归基线
- **证据等级**（第一轮审计的不变量“示意部分必须标出”）：`EVID` 四级 = experimental 实验 / derived 推算 / modelled 建模 / illustrative 示意。`evidenceOf(cfg, main)` 从场景配置推出每一级包含什么（PDB 坐标和配体 → 实验；简化外形、功能核心、膜位置、非原始朝向 → 推算；`states` 插值、`components` 摆放 → 建模；`process` / `animation` 的粒子和计数、细胞里的分子摆放、说明里写了“示意”的部分 → 示意），预设或场景包可用 `evidence: {experimental:[], derived:[], modelled:[], illustrative:[]}` 补充。`renderEvidence` 在标题下画徽章（`#evid`，绿 / 蓝 / 琥珀 / 紫），点击展开 `#evidPop` 列表；结果也放在 `__viewer.evidence`。**新加的可视化，只要不是实验坐标，就要在 evidenceOf 里有一行。**
- **诊断**：`__viewer.probe(sec)` 跑 sec 秒，返回实体 / 链 / 残基 / 配体数、过程名和计数、FPS、最差帧、`renderer.info`（几何体、纹理、绘制调用、三角形）、场景对象数、JS 堆；`__viewer.loadAndProbe(cfg | 预设名, settle, sec)` 先载入（180 秒超时）再测。rAF 在隐藏窗口里停，所以 probe 另有定时器兜底。
- **回归基线**（`desktop/scripts/regress.mjs`）：Electron `GLOW_REGRESS=<目录>` 模式按 `scripts/regress-scenes.json` 依次载入 6 个固定场景（4HHB、6ZPO、1K4C、4V6F 翻译、7CGO、细胞一角），截图，最后回到第一个场景检查几何体 / 纹理 / 对象数是否增长（= clearScene 漏释放）。内容数量变化、泄漏、载入失败 → 不通过；FPS 和载入时间只警告。测试模式关闭 `backgroundThrottling`。首个基线：没有泄漏；FPS 偏低（4HHB 13、鞭毛马达 1.7、细胞一角 2.7，1426×863 窗口）——性能是下一步重点。
- 路线图：仓库 `docs/history/ROADMAP.md`（三个模拟器各自的教学目标和效果、工程不变量、任务清单），审计：`docs/history/AI_AUDIT_AND_STABILIZATION.md`、`docs/history/AUDIT_ROUND2.md`。

## 36. v18：命令接口 `window.glow`、开发者工作台 `dev.html`、审计 P0 修正
- **`window.glow`**（`GLOW_API = 1`，`GLOW_CMDS` 表驱动）：help、load（`{pdb}` / `{preset}` / `{pack}` / `{packText}` / `{scene}` / `{url}` / `{ws}`，字符串自动判断）、info、select、color、represent、style、camera、animate、measure、snapshot、exportPack、validatePack。全部经一个串行队列 `glowRun`，每条记进 `glow.log`（最近 200 条 `{t, cmd, args, ok}`），`glow.replay(log)` 跳过只读和失败的条目重放。`help()` 返回命令、参数类型、例子和选择语法——开发者页的 API 参考就是它生成的，**新增命令只要在 GLOW_CMDS 里加一项，文档自动更新**。
- **选择语言**（`selTokens` → `parseSel` → `evalSel`，PyMOL / NGL 风格）：`all | none | protein | nucleic | ligands | sele | chain A,B | resi 10-50,60 | resn HIS | entity "名字" | ligand HEM | within 5 of <选择>`，`and / or / not / ( )`。基于 Cα / P 团块；`chain` 是 label_asym_id；`resi` 用作者编号（`aseq`），没有时用 label_seq。错误是 `CmdError`，信息里带语法提示。结果存在 `glowSel`（`sele` 指上一次选择），`color` / `camera focus` 默认作用于它；颜色覆盖 `g.userColor` / `g.resColors` 由 `colourFn` 读取。
- **postMessage 桥**：`{glow:'cmd', id, cmd, args}` → `{glow:'reply', id, ok, result|error}`；只接受父窗口（嵌入时）或同源且 origin 不为 `null` 的发送者；场景从外部进来一律走 `sanitizePack`；没有 eval。`?embed=1` 收起面板，并向父窗口发 `{glow:'ready', api}`。
- **`dev.html`**（与 index.html 同目录）：左边 `.glow` JSON 编辑器（行号、草稿存 localStorage）+ 新建模板 / 从当前场景导出 / 校验 / 预览 / 下载 / 投稿到工坊（打开 submit-scene issue 模板）；右边 iframe 嵌入查看器；下面命令台（历史、示例按钮）、校验结果（错误红 / 提醒黄）、由 `help()` 生成的 API 参考、“给 AI 的说明”（可复制的提示词）。校验规则就是查看器自己的 `sanitizePack`，所以与 CI 一致。桌面版：`GLOW_PAGE=dev.html` 打开它，`sync.js` 一并复制。
- **可重放**：`rand()`（`mulberry32`，`?seed=` 或场景 `seed`；不给种子时就是 Math.random）替换了全部随机数；`__viewer.step(dt, n)` 在暂停时定步推进，`__viewer.events()` 是事件日志；同一种子两次运行计数和事件完全一致。
- **生命周期**：`clearScene` 还清焦点、选择、标签、镜头飞行、能量条状态、测量、事件；过程可选 `dispose()`（整个细胞的 controls 监听器在这里移除）；场景包的物种表按场景保存，不再写全局 `SPECIES`；`fetchText` 接 session 的 `AbortController`，新载入取消旧请求；`loadScene` 把内部错误记进 `errors[]` / `__viewer.lastError`，`finally` 恢复按钮。4V6F 等多组装体条目固定取 1 号组装体（RCSB 返回顺序不稳定，曾导致实体数 56 / 53 交替）。
- **科学修正**：ATP 合酶快放时 H⁺ 按转子角度计数，始终 8 H⁺ : 3 ATP（牛 c8 环）；呼吸链分开计数“H⁺ 泵出（复合体 I / IV）”和“H⁺ 释放到膜间隙（Q 循环，复合体 III）”——Q 循环不是泵，说明、能量条、b6f 注释一并改。
- **证据等级修正**：用户文件 / 内嵌结构算“建模”（除非包里写明 `structure.source.pdb`）；预设手放的膜算“建模”，只有自动模式的膜是“推算”（写明来源）；示意里列出团块大小抖动、热抖动、随机脂质、配体放大；配体数统一为“N 种 / M 个”；切换或载入失败时徽章清空；`evidence`、`seed` 进 `SCENE_KEYS`，文字只转义一次。
- **性能**：`preserveDrawingBuffer: false`（截图在 render 后同步读）；面板布局读取降到 4 Hz，标签 30 Hz；FPS 连续 4 秒 < 24 自动降一级画质并提示。每个场景都有比例尺和时间尺度说明；“来源”面板列出主结构和每个组件的方法、分辨率、物种、文献 DOI。
- 注意：开发机是 Hyper-V 虚拟机，Electron 走 SwiftShader 软件渲染，回归里的 FPS（4HHB 约 10）只代表这台机器；真实显卡上要高一个数量级。

## 37. v18.1：第二次复审后的修正（审计 → 执行 → 我独立复核）
- **postMessage 桥只在 `?embed=1` / `?dev=1` 时监听**；父窗口必须同源或在 `?origin=https://…` 白名单里，永不接受 `null`；`load({url})` 只接受工坊、files.rcsb.org、alphafold.ebi.ac.uk 或同源；回复只发给请求方 origin。所以 dev.html 要通过 http(s) 打开（file:// 下 origin 是 null，桥不通——用 GitHub Pages 在线版或 `python -m http.server`）。
- **动画协程**：clearScene 时挂起的 anim 以 `Stale` reject，协程捕获后退出；probe 报 `pendingAnims`。
- **呼吸链守恒**：每个 QH₂ 在 Qo 给 2 e⁻ 并释放 2 H⁺（一轮 Q 循环 2 个 QH₂ → 4 H⁺，Qi 还原 1 个 Q 吸收 2 H⁺），细胞色素 c 每趟 1 e⁻，复合体 IV 按电子计；每个 NADH：泵出 6（I 4 + IV 2）、Q 循环释放 4；ATP = 回流 H⁺ × 3/8（牛 c8），说明文字写明；快放也计数。
- **随机数**：`rand()`（模拟）和 `randVis()`（布景）两条流，`randDir()` 取代 randomDirection；`glow.animate({seed, step, steps})`；`load({seed})` 后暂停；回归里同一种子跑两次必须完全一致（kcsa、atp-synthase、translation）。
- **编号约定**：`chain` / `resi` = 作者编号（auth_asym / auth_seq，支持插入码 52A、0 和负数）；`label_asym` / `label_seq` = mmCIF 内部编号。4V6F 的作者链名是两个字母（如 “AA”）。
- **预设键**：`PRESET_META` 给每个预设一个稳定的英文键和层级（cell / system / single）；`presetName(q)` 把键或中文名解析成中文名；`?preset=`、回归、`glow.load` 用键。工坊脚本 `glow-lib.mjs` 一并截取这段（`PRESET_META` 到 `presetName`），`export-presets.mjs` 去掉运行时加的 `key` / `tier`。
- **序列条**（Q 键 / “序列条”链接 / `glow.sequence`）：每链一行，按二级结构着色，缺失残基虚线；点击 / 拖选 = 选择，其他地方的选择同步高亮。**按选择集换表示**：`represent('chain A','cartoon')`（目前按部件生效），存为 `scene.reps`。
- **三层导航**：部件和拥挤分子的信息卡有“打开这个机器：…→”，标题旁“← 返回”回到上一场景和视角；拥挤分子可点选（名字、PDB、“位置为示意”）。
- **证据**：每个 PROCESS 必须声明 evidence（回归检查）；包里声明 `structure.source.pdb` 的显示“未核对”；信息卡有证据行。
- **画质**：墨线风格下像素比 ≥ 1；只有已经是“低”且持续 < 8 fps（没有独立显卡的机器）才降到 0.75，> 30 fps 恢复；每个场景恢复用户选的画质。回归检查 app 副本和源文件 sha256 一致、页面控制台无报错。

## 38. v18.2：第三次审计（教师视角）后的修正
- **物种与代用结构**：信息卡第一行“物种：…”；用别的物种的结构代表时写明（细胞场景里 4V6F 是嗜热栖热菌核糖体，1K4C 是链霉菌 KcsA——大肠杆菌没有 KcsA），图例“· 代用：…”、证据徽章也列出。ATP 合酶链接写明化学计量差别：牛 6ZPO c8 = 8 H⁺ : 3 ATP，大肠杆菌 6OQR c10 = 10 H⁺ : 3 ATP。
- **嵌入桥**：完全权限只给写死的 `EMBED_ORIGINS`（官方 Pages）或同源且 `?dev=1`（dev.html 的 iframe）；其他 https 页面只有安全子集，且要用户在查看器里点“允许此网页控制查看器”后才回应；snapshot / exportPack / log / 场景包载入、打开本地文件时的 info 永不发给它们；null 和 http 忽略。回归 `bridgeTest`。
- **质子账本**（呼吸链）：泵出 / Q 循环释放 / 回流 / 膜间隙池 / ATP / ATP 每 NADH；ATP = floor(回流 H⁺ × 3/8)，池里没有 H⁺ 转子就停；`ATP_PER_NADH` 一处定义（理论 ≈ 2.7，实测约 2.5），说明、能量条、HUD 共用。叶绿体质体蓝素每循环真的走两趟。
- **每个粒子都有名字**：包括实例化的珠子（肽链、mRNA、粒子流）和事件，悬停有提示、点击出卡片；回归 `unnamedParticles > 0` 即失败。
- **时间尺度**：每个运行中的模拟一行（翻译 ×1/N、K⁺“1 s = 10 ns（慢约 10⁸ 倍）”、门控、转子每秒转数对比真实值）；细胞一角同时显示两套。
- **返回导航**恢复场景来源、模拟控件、计数、种子、选择、模式选项卡、暂停、时间尺度和视角；回归 `backTest` 差异为 0。
- **序列条**：对称拷贝标 A·1 / A·2，点击只选那一份（`asym C_2`）；“功能位点”按钮经 RCSB 对齐读 UniProt 特征（活性位点、结合、位点、跨膜、膜内、基序、二硫键），变成可点的标签，点一下选中并在 3D 高亮（1K4C：跨膜段 2、膜内片段 2、基序 1、二硫键 1，选中 4 × 47 = 188 个残基）。
- **说明分层**：第一行是不超过约 50 字的要点，其余在“展开说明 ▾”；构象变形过程中显示“线性插值（示意）”；拥挤分子卡片与证据用同一条 `CROWD_RULE`，并有“真实数量 vs 画出数量”对比条。
- `pendingAnims` 是真计数（回归：运行中 1，清场后 0）；删除未用的 `ionChannel`；拥挤分子颜色转义。

## 39. WP1：源码拆分与构建（src/ → web/index.html）

- `src/` 是唯一的源：`index.html.tpl` 是页面骨架，每行 `<!-- @include 路径 -->` 换成 `src/路径`；`tools/build.mjs` 拼出单文件 `web/index.html`（保留 importmap / CDN），`--check` 比较生成结果与仓库文件。`web/dev.html` 由 `src/dev.html` 原样生成。
- 片段在页面里共用一个 module 作用域（和拆分前完全一样），模板顺序 = 代码顺序。目录：`core/`（启动、状态、loadScene / clearScene）、`data/`、`derived/`、`repr/`、`view/`、`sim/`（`processes/*.js` 是 `PROCESSES` 字面量的连续几段）、`pack/`、`ui/`、`api/`（`window.glow`）、`styles/`。完整表见 `src/README.md`。
- 真模块：`data/presets.js`、`pack/rules.js` 带 `import` / `export`，构建删掉相对 import 行和行首 `export `；`workshop/tools/glow-lib.mjs` 直接 import 它们（不再从 HTML 截取文本）。`pack/rules.js` 里的 `PROCESSES` 是自由名字：页面里是真正的过程表，Node 里由 glow-lib 放一个只有名字的表（名字从构建拼出的脚本里读）。
- 第一步只搬移：构建结果与拆分前逐字节相同，唯一差别是 `presetCat` 一行移进 `data/presets.js`。
- 同步：`desktop/scripts/sync.js` 和 `tools/sync-copies.mjs` 都先构建；`tools/check-copies.mjs` 检查 skill / desktop 副本的 sha256；CI `copies.yml` 跑 `build.mjs --check` + 副本检查。
