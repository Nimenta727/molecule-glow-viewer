# 参数大全

## 1. 面板控件

| 分区 | 控件 | 默认 | 范围 | 作用 / 调法 |
|---|---|---|---|---|
| 顶部 | PDB 编号 + 加载 | 6ZPO | 4 位 | 若编号等于某预设的 id，自动用该预设 |
| | 导入本地文件 / 拖入 | — | .cif .mmcif .pdb .ent | 本地结构（AlphaFold、自建模型），见 paper_to_animation.md |
| 过程动画 | 显示相互作用过程 | 开 | — | 关掉 = 隐藏质子/离子/ATP 动画与说明文字 |
| | 转子转速 | 0.6 rad/s | 0–3 | 旋转部件的角速度；过程动画（质子数、ATP 合成）都跟这个角度同步 |
| | 构象变化 | 0 | 0–1 | 预设有 `states` 时：0 = 构象 1，1 = 构象 2；拖动后自动播放关闭 |
| | 自动往返播放构象变化 | 开 | — | 两端各停一会儿的往返 |
| | 热运动 | 0.25 | 0–1 | 团块随机抖动 |
| | 暂停（空格）/ 相机自动环绕 | 关 | — | |
| 小分子 | 显示小分子 | 开 | — | 结构里的配体、核苷酸、离子、脂质 |
| | 小分子大小 | 2.6 | 0.8–4 | 1 = 真实比例；>1 放大（形状不变）。团块是 4–5 Å 的球，真实比例的 ATP 会被淹没，所以默认放大 |
| | 结合位点闪光 | 0.6 | 0–1.5 | 配体 8 Å 内的残基 / 过程动画标记的位点脉动发光 |
| 外观 | 显示模式 | 团块（写实） | 团块 / 结构示意 | 结构示意 = 螺旋、折叠箭头、卷曲细管（二级结构来自 PDB 沉积注释），适合看结构 |
| | 结构示意模式显示外形轮廓 | 开 | — | 蛋白外形的发光轮廓（只画最外层） |
| | 画风 | 视频光影 | 视频光影 / 插画 | 插画 = 白底、平涂、描边（Mol* / PDB-101 / 期刊风格），对所有表示生效 |
| | 配色 | 按蛋白种类 | 种类 / 链 / 彩虹 | 彩虹（N→C）适合看结构域运动 |
| | 色板 | 霓虹 | 霓虹 / 粉彩 / 古德塞尔 | 预设 `colors` 只在霓虹下生效 |
| | 团块大小 | 4.6 Å | 1.5–8 | 4.4–5.0 最像参考图 |
| | 团块起伏 | 0.5 | 0–1 | |
| | 辉光 | 0.35 | 0–2 | >0.6 容易发白 |
| | 边缘光 | 0.55 | 0–1.5 | 只在朝上的面强（顶光） |
| | 自发光 | 0.05 | 0–0.5 | >0.1 画面变平 |
| | 曝光 | 0.88 | 0.3–2 | |
| | 饱和度 / 对比度 | 1.3 / 1.12 | | 最终调色 |
| | 画质 | 自动 | 高/中/低 | |
| | 环境光遮蔽 / 景深 / 景深强度 | 开 / 开 / 0.35 | | 景深近看自动减弱 |
| 膜 | 显示、位置 1/2、半径 | 预设决定 | | 位置 = 场景半径的比例 |
| 剖切 | 位置、对象 | 1.05（不切）/ 只切膜 | | |
| 组成 | 简 | 按“默认简化方式” | — | 勾选 = 该部件用简化表示 |
| | 默认简化方式 | 推荐 | 推荐 / 全部简化 / 全部不简化 | 推荐 = 机制相关部件（预设 `keepDetail`）保留细节 |
| | 简化样式 | 示意图 | 示意图 / 低分辨率表面（插画）/ 低分辨率表面（光泽） | 示意图 = 叶片、鼓、弯管（期刊机制图画法） |
| | 简化分辨率 | 12 Å | 8 / 12 / 16 / 20 | 只影响低分辨率表面 |
| | 显示标注与讲解 | 预设有 notes 时开 | — | 部件标签，点击看讲解卡片 |
| 组成 | 显 / 转 / 剖 | — | — | “剖”= 去掉朝向镜头的楔形（±62°），看内部。**楔形固定在模型上**，转动不会让结构闪烁消失；按“剖面对准当前视角”重新对准 |
| | ◆ 小分子行 | — | — | 每种配体一行，可单独隐藏 |
| 其他 | 主轴 | long | long / sym / short / native | |
| | 生物学组装体 | 开 | | |

快捷键：H 面板，空格 暂停。

## 2. 网址参数
`?pdb=1AON`、`?preset=鞭毛马达`（与 PRESETS 键完全一致）、`&q=low|medium|high`。无参数默认“ATP 合酶（合成 ATP）”。

## 3. 预设字段（`const PRESETS = { '名称': {...} }`）

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | 字符串，必填 | 主结构 PDB 编号 |
| `axis` | `'long'｜'short'｜'sym'｜'native'` | PCA 定向方式 |
| `axisFrom` | `['部件A','部件B']` | 转轴 = A 质心 → B 质心（旋转机器必用，优先于 axis/up） |
| `up` | 关键词 | 该部件翻到 +Y |
| `horizontal` | 布尔 | 主轴横放 |
| `blob` | 数字 | 团块大小 |
| `assembly` | 布尔 | 是否展开组装体 |
| `chains` | `['A',...]` | 只保留这些链（label_asym_id）及其附近配体 |
| `colorMode` | `'entity'｜'chain'｜'rainbow'` | 不写时自动：≤2 部件且 >6 条链 → chain |
| `colors` | `{关键词:'#RRGGBB'}` | 关键词是“名称包含”，**先写的先匹配**；也可以写正则字符串 `'/subunit a$/'` |
| `spin` | 关键词数组 | 默认旋转的部件 |
| `ghost` | 关键词数组 | 默认“剖开”的部件（遮住活性位点的外壳，如 α3β3） |
| `membranes` | `[{at, offset}]` | 最多 2 层 |
| `memR`、`cut`、`cutWhat` | | 膜半径、剖切 |
| `camera` | `{az, el, dist}` | 初始视角 |
| `components` | 数组 | 拼接其他 PDB（字段见下） |
| `states` | `['ID1','ID2']` | 两个构象之间变形；ID1 就是 `id`；两者链名需一致 |
| `process` | 字符串 | `PROCESSES` 里的键，启用过程动画 |
| `caption` | 字符串 | 底部说明文字（不写则用过程的 caption） |

`components` 每项：`id`、`label`、`axis`（long/short/native）、`flip`、`anchor`、`side`（below/above/at）、`gap`、`dy`、`arrange`（`{kind:'single'}` / `{kind:'ring',n,radius}` / `{kind:'helix',n,rise,twist}`）、`spin:false`。

### 关键词匹配的坑
- `'subunit a'` 也会匹配 “subunit alpha”。精确匹配用正则：`'/subunit a$/'`。
- 部件名来自 RCSB 实体描述（如 “ATP synthase subunit gamma, mitochondrial”），先用 structures.md 的命令查。

### 完整例子：ATP 合酶
```js
'ATP 合酶（合成 ATP）': {
  id: '6ZPO', axisFrom: ['subunit C1', 'subunit beta'], blob: 4.4,
  spin: ['subunit gamma', 'subunit delta', 'subunit epsilon', 'subunit C1'],   // 转子 = 中心柄 + c 环
  ghost: ['subunit alpha', 'subunit beta'],                                    // 剖开 α3β3 看催化位点
  membranes: [{ at: 'subunit C1', offset: 0 }], memR: 1.2, cut: 0.0, cutWhat: 'mem',
  process: 'atpSynthase',
  colors: { 'subunit alpha': '#e64fc8', 'subunit beta': '#5b9dff', 'subunit gamma': '#e3e7f2', 'subunit delta': '#e3e7f2',
            'subunit epsilon': '#e3e7f2', 'subunit C1': '#3fc864', '/subunit a$/': '#2448e8', 'subunit O': '#ff9a50',
            'B1': '#ff9a50', '/subunit d,/': '#ff9a50', 'factor 6': '#ff9a50', 'inhibitor': '#f5e07a' },
  camera: { az: -0.55, el: 0.12, dist: 1.05 },
},
```
### 例子：两构象变形
```js
'腺苷酸激酶（开合）': { id: '4AKE', states: ['4AKE', '1AKE'], chains: ['A'], colorMode: 'rainbow', axis: 'long', blob: 4.4, assembly: false,
  caption: '腺苷酸激酶：底物结合后 LID 与 NMP 结构域向核心闭合（4AKE 张开 ⇄ 1AKE 闭合，抑制剂 Ap5A 占据活性位点）' },
```
构象 2 的配体（Ap5A）只在变形值 > 0.6 时显示，构象 1 的配体只在 < 0.4 时显示。

### 例子：鞭毛马达（多 PDB 拼接）
见 viewer.html 中 `'鞭毛马达'`：7CGO + 8YJT（C 环，axis short）+ 6YKM（定子，ring n=11 r=215）+ 1UCU（鞭毛丝，helix n=130 rise 4.7 twist 65.8），`process: 'flagellarMotor'`。
组件拼接是示意性的，不代表精确的原位构象。

### 讲解字段 `notes`（教学）
```js
notes: { '关键词或/正则/': ['标签名', '一句话作用', '点击后显示的详细讲解'] }
```
预设字段 `keepDetail: ['关键词', ...]`：“推荐”简化方式下保留细节的部件。
预设字段 `core: [{ near: { part: '/subunit a$/', seq: 159 }, r: 13, with: ['subunit C1'] }, { part: 'subunit C1', seqs: [[56, 60]] }]`：额外的功能核心残基（某残基周围 r Å 内、或指定序号范围），画成原子团块。
预设字段 `siteNotes: { ADP: '…', ATP: '…' }`：小分子聚焦时信息卡里的位点讲解（按配体三字码）。
预设 / 过程字段 `energy: [['标签', '解释'], ...]` 与 `energyStage: 'morph'`：底部能量转化条（见 architecture §18）。
预设字段 `down`（与 `up` 相反）、`coreLigands`、`ligOff`、`rowFlip`，组件字段 `beside: { dir: 'row' }`、`at: { part, dy, along }`：见 architecture §22.2。
预设字段 `axisFit`、`groupParts`、`frameAll`、`camera.broadside`，组件字段 `axisFrom` / `alignTo` / `beside` / `split` / `pivot`：多机器协同场景用，见 architecture §21.2。
预设 / 过程字段 `energyHL: [[部件关键词 | { part?, aseqs: [[起, 止]] }], ...]`：每一步涉及的结构，点步骤或“◎ 跟随”时高亮（残基用**作者编号**，见 architecture §19）。
预设字段 `domains: [['CORE', [[1, 29], [60, 121], [160, 214]]], ...]`：示意图里单个蛋白的结构域（文献残基范围，label_seq_id）。
预设字段 `lobes: ['histone']`：这些部件在示意图里强制画成球状叶片（去掉柔性尾巴）。
匹配规则同 `colors`（第一个匹配的键生效；`''` 匹配所有部件，适合单一蛋白）。讲解要写机制、化学计量、方向，**只写有文献依据的内容**；不确定的不写。已写好：ATP 合酶、鞭毛马达、钾通道、腺苷酸激酶。

