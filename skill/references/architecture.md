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
