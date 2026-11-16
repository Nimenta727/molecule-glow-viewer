---
name: molecule-glow-viewer
description: Single-file Three.js viewer for proteins, molecular machines and ligands, in the glossy "blob + glow" or white-background "illustration" style. Downloads any PDB entry live from RCSB and plays mechanism animations (ATP synthase, respiratory chain, chloroplast, flagellar motor, ribosome translation, KcsA), plus take-apart mode and live kinetic compartments. Use whenever the user wants a protein, complex or mechanism shown or animated in 3D "like the videos", wants to add a structure, preset, process or simulated station to this viewer, or wants a pretty interactive molecule viewer. Not for video rendering/editing and not for atom-level analysis.
---

# 分子光影查看器（molecule-glow-viewer）

单个 HTML 文件（Three.js），浏览器打开即用：任意 PDB 编号从 RCSB 实时下载，**实时**旋转、缩放、点选。
做的是"视频里那种"分子画面——圆润团块、柔和辉光、剖开的脂双层膜、转动的转子——外加小分子球棍和机制动画，以及会真正计算的模拟站。
不渲染视频，不用 Blender。

两种画风：**视频光影**（黑底辉光）/ **插画**（白底平涂描边，Mol\* / PDB-101 风格）。

## 执行规则（给执行本 skill 的 AI，必须遵守）

1. **不要重写查看器**。在 `assets/viewer.html` 上改：加预设、加过程动画、加模拟站、调参数、修 bug。动手前读 `references/architecture.md`。只有用户明确要求"从零重做"时才按 `references/rebuild_from_scratch.md` 走。
2. **数据只从 RCSB 实时下载**（ModelServer 取 Cα/P 和配体坐标，GraphQL 取名称/组装体，CCD 取小分子理想构型），或用用户给的本地文件。不内嵌大数据。
3. **PDB 编号、配体代码、实体名称不要凭记忆写**。先用 `references/structures.md` 开头的命令确认（标题、实体名称、非聚合物实体），再写进预设。
4. **每次改完都在浏览器里验证并截图亲眼看**（见「验证清单」）。**没报错不算验证**——本项目多次出现无报错但画面全白、分子被挡住或发黑、部件朝向错的情况。
5. 用户要"像某张参考图"时，按 `references/style_guide.md` 对照表逐项调，不要只调辉光。
6. 用户给的是**论文 / 机制描述**时，按 `references/paper_to_animation.md`：找结构 → 找状态 → 写预设 → 写过程动画。化学计量、方向、顺序写进说明文字；回复里说清哪些是示意。

## 工作流

**1. 确认运行环境** —— 读 `references/setup.md`。Chrome / Edge 最新版；独显笔记本把浏览器设为"高性能"；需能访问 `models.rcsb.org`、`data.rcsb.org`、`files.rcsb.org`、`cdn.jsdelivr.net`。页面自动按显卡选画质，面板显示实时帧率。

**2. 放置查看器**
```bash
cp "<本skill目录>/assets/viewer.html" "<目标目录>/分子光影查看器.html"
```
双击打开（`file://` 可用）。若浏览器拦截本地文件的网络请求：在该目录运行 `python -m http.server 8765`，再打开 `http://localhost:8765/分子光影查看器.html`。

**3. 查看结构** —— 面板输入 4 位 PDB 编号、点预设，或"导入本地文件"/直接拖入 `.cif`/`.pdb`。网址参数：`?pdb=4HHB`、`?preset=鞭毛马达`、`&q=low|medium|high`。无参数时默认"ATP 合酶（合成 ATP）"。小分子自动下载并画成球棍，结合位点附近的残基会闪光。

**4. 加预设** —— 在 `const PRESETS = {...}` 加一项，字段见 `references/parameters.md` §3。最小例子：
```js
'血红蛋白': { id: '4HHB', axis: 'long', blob: 4.0 },
```
完整例子：`'ATP 合酶（合成 ATP）'`（转子轴、剖开、膜、过程动画）、`'鞭毛马达'`（4 个 PDB 拼接）、`'腺苷酸激酶（开合）'`（两构象变形）、`'细胞一角：核糖体 + 钾通道'`（组合场景）。

**5. 加过程动画（小分子怎么动）** —— 接口与模板见 `references/processes.md`（`PROCESSES` 注册表、ctx 工具函数）。两种构象之间变形：预设写 `states: ['构象1','构象2']`。小分子形态与配色见 `references/small_molecules.md`。

**6. 加实时模拟站（Gillespie / 动力学模型）** —— 照 `references/architecture.md` **§28** 的步骤做，三个现成实例可抄：`translation`（§26 核糖体翻译 + 抗生素）、`kcsa`（§27 钾通道，pH 门控与阻断剂）、`respiratoryChain` / `chloroplast`（§21–22 场景 + §24 区室动力学）。要点：状态机挂在 `PROCESSES[名字]`，每帧推进，**HUD 里必须显示可核对的数值**（计数或浓度），不能只做视觉动画。

**7. 验证** —— 按下面的清单逐项做。

**8. 出问题** —— 按症状查 `references/troubleshooting.md`。

## 功能索引（代码在哪）

| 功能 | 章节 |
|---|---|
| 团块 / 结构示意 / 按功能分区的简化 | architecture §4、§13–16 |
| 小分子三种画法（球棍 / 价键 / 空间填充） | §5、§21.1 |
| 小分子聚焦 + 能量转化条 | §17–18 |
| 3D 点选 / 选择集 / 口袋表面 | §19–20 |
| 线粒体呼吸链 | §21.3 |
| 叶绿体光反应 | §22 |
| 插画画风的墨线与宏观明暗 | §23 |
| 细胞区室实时模拟（pH / 膜电位 / ATP / NAD(P)H） | §24 |
| 拆装模式（亚基取下、界面连接带） | §25 |
| 核糖体翻译站 | §26 |
| KcsA 钾通道站 | §27 |
| **怎么新增一个模拟站** | **§28** |
| 细胞一角（两站同时模拟） | §29 |
| 界面让位给场景（视图偏移、折叠）+ 细胞质拥挤 `buildCrowd` | §30 |
| 自动模式：任意编号自动定膜、搜孔道、生成说明与简介卡 | §31 |

## 验证清单（每次改动后必做）

在浏览器打开页面（Claude 用内置浏览器时**浏览器面板必须显示出来**，否则动画帧不跑），等状态栏出现"完成：N 个残基团块，M 个小分子"，然后逐项检查：

| 检查 | 方法 | 通过标准 |
|---|---|---|
| 下载成功 | 状态栏 / 控制台 | "完成：…"，无红色错误 |
| 部件齐全 | 面板"组成" | 每个部件残基数 > 0；小分子行（◆）出现 |
| 不过曝 | 截图 | 团块颗粒清楚，无大片纯白或奶白雾 |
| 构图 | 截图 | 主体占 50–80%；方向对（ATP 合酶 F1 头朝上、c 环在膜里） |
| 小分子可见 | 拉近截图 | ATP（金色碳）/ ADP（青色碳）/ 磷酸（橙）清楚，不发黑、不被挡 |
| 过程在跑 | 等 5 秒读计数器 | 说明文字下方的计数（ATP、H⁺、K⁺）在增加 |
| 旋转 / 变形 | 间隔截图 | 转子转、定子和膜不动；构象滑块 0→1 结构有变化；β 口袋随转子开合 |
| 稳定性 | 绕模型转一圈连续截图 | 剖开部分不闪烁、不突然消失 |
| 结构示意 | 显示模式切到"结构示意" | 螺旋、折叠箭头清楚；外形轮廓不发雾 |
| 拆装模式 | 点"拆开"前后各截一张 | 零件分开；界面连接带（盐桥 / 氢键 / 二硫键）被拉长而不是断开 |
| 模拟站 | 加抗生素 / 改 pH 后等几秒 | HUD 的计数与速率随之变化；不加药时计数单调增长 |
| 区室模拟 | 看右侧面板数值 | pH、膜电位、ATP、NAD(P)H 在 2–3 秒内变化；切"缺氧 / 寡霉素"后方向或速率改变 |
| 组合场景 | 载入"细胞一角" | 核糖体在胞质、KcsA 在膜上，两者各自在动且互不干扰 |
| 性能 | 面板帧率 | 独显 ≥ 30 fps |

调试接口：`window.__viewer`（`loadScene(cfg)`、`groups()`、`ligands()`、`model()`、`proc()`、`PRESETS`、`PROCESSES`、`camera`、`controls`、`entryFromFile(name,text)`），`window.__fps`，`window.__gpu`。自动化测试脚本见 `references/troubleshooting.md` 末尾。

## 参考文件

- `references/setup.md`：硬件分档、浏览器与显卡设置、离线使用、性能预期
- `references/architecture.md`：代码结构（下载 → 解析 → 组装体 → 定向 → 团块 → 小分子 → 着色器 → 后期 → 膜 → 组件 → 过程动画 → 模拟站），按函数名定位
- `references/parameters.md`：面板控件、预设字段（`axisFrom`、`ghost`、`states`、`chains`、`process`）、网址参数
- `references/style_guide.md`：怎么调出参考图的光影（逐项对照表 + 数值）
- `references/small_molecules.md`：小分子从哪来、怎么画成球棍、配色、大小、怎么让它动
- `references/processes.md`：过程动画 API 与模板
- `references/paper_to_animation.md`：从"已有结构 + 最新论文"做成动画的完整流程与检查表
- `references/structures.md`：已实测结构清单、查询命令
- `references/troubleshooting.md`：症状 → 原因 → 解决；自动化测试脚本
- `references/rebuild_from_scratch.md`：在别的环境从零重做时的实现顺序与验收
- `references/build_log.md`：开发和调试记录（每轮看到什么、为什么那样改）
