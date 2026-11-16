---
name: molecule-glow-viewer
description: Real-time, rotate-from-any-angle 3D viewer for proteins, molecular machines AND their small molecules, in the glossy "blob + glow" style of YouTube/Bilibili molecular animations (black background, saturated colours, soft glow, lumpy residue blobs, cut-away lipid membranes, turning rotors). A single HTML file (Three.js) that downloads ANY PDB entry live from RCSB (or opens a local .cif/.pdb), draws ligands (ATP, ADP, ions, lipids, drugs) as true ball-and-stick, and plays interaction animations - ATP synthase making ATP from ADP+Pi while protons turn the c-ring, protons driving the flagellar motor, K+ ions hopping through a channel, open/closed conformational morphs between two PDB states. Use this whenever the user wants to see/show/animate a protein, complex, ligand binding, enzyme mechanism, membrane protein or molecular machine in 3D "like the videos", wants to turn a structure or a paper's mechanism into an interactive animation, wants to add a structure/preset/process to this viewer, or wants a pretty interactive molecule viewer - even if they don't say "Three.js" or "viewer". Not for video rendering/editing and not for atom-level analysis.
---

# 分子光影查看器（molecule-glow-viewer）

做出“视频里那种”分子画面：黑背景、饱和配色、柔和辉光、圆润团块、剖开的脂双层膜、转子转动；
**并且能看到相互作用**：ATP / ADP / 磷酸 / 离子 / 质子等小分子以真实的球棍形态出现，跟着机制一步步运动。
一切**实时**、能用鼠标**从任意角度**看。不渲染视频，不用 Blender。
两种细节表示：**团块（写实）**、**结构示意**（α 螺旋圆柱、β 折叠箭头、卷曲细管；二级结构取自 PDB 沉积注释）。每个部件还可勾选**简化**：期刊机制图画法（叶片 / 环→鼓 / 长螺旋→弯管，由真实坐标拟合）或低分辨率分子表面（molmap）；默认“推荐”= **按功能分区**：功能核心（结合口袋、孔道内壁、力传递界面）保留原子细节并按化学性质着色，会动的部件画成随构象运动的密度形状，支架淡化（architecture §16）。**小分子聚焦**：点图例 ⌖ 下载位点全原子，画氢键 / 盐桥 / 金属配位 / 疏水虚线，算结构域转角，并配**能量转化条**（§17–18）。**点选**：在 3D 里点任意残基 / 部件 / 小分子，统一选择集负责高亮、淡化其余、飞镜头、讲解；能量条步骤可高亮相关结构（“◎ 跟随”随播放自动高亮）；聚焦时在 Web Worker 里算口袋表面（§19–20）。两种画风：**视频光影**（黑底辉光）和**插画**（白底平涂描边，Mol* / PDB-101 风格）。部件标注 + 点击讲解（预设 `notes`）。大结构不降级。

成品是一个文件：`assets/viewer.html`。浏览器打开即可；任何 PDB 编号直接从 RCSB 下载，也能拖入本地 .cif/.pdb 文件。
效果示例：`assets/example_atp_synthase.jpg`（v2，无显卡电脑“中”画质）、`assets/example_flagellar_motor.jpg`（v1）。

## 执行规则（给执行本 skill 的 AI，必须遵守）

1. **不要重写查看器**。在 `assets/viewer.html` 上改：加预设、加过程动画、调参数、修 bug。动手前读 `references/architecture.md`。
   只有用户明确要求“从零重做”时才按 `references/rebuild_from_scratch.md` 走。
2. **数据只从 RCSB 实时下载**（ModelServer 取 Cα/P 和配体坐标，GraphQL 取名称/组装体，CCD 取小分子理想构型），或用用户给的本地文件。不内嵌大数据。
3. **PDB 编号、配体代码、实体名称不要凭记忆写**。先用 `references/structures.md` 开头的命令确认（标题、实体名称、非聚合物实体），再写进预设。
4. **每次改完都在浏览器里验证并截图亲眼看**（步骤 6 清单）。“没报错”不算验证——本项目多次出现无报错但画面全白、分子被挡住或发黑、部件方向错的情况。
5. 用户要“像某张参考图”时，按 `references/style_guide.md` 对照表逐项调，不要只调辉光。
6. 用户给的是**论文 / 机制描述**时，按 `references/paper_to_animation.md`：找结构 → 找状态 → 写预设 → 写过程动画。化学计量、方向、顺序写进说明文字；回复里说清哪些是示意。

## 工作流程

### 步骤 1：确认运行环境
读 `references/setup.md`。要点：Chrome / Edge 最新版；独显笔记本把浏览器设为“高性能”显卡；能访问 models.rcsb.org、data.rcsb.org、files.rcsb.org、cdn.jsdelivr.net。
页面自动识别显卡并选画质（软件渲染→低，核显→中，独显→高），面板显示实时帧率。

### 步骤 2：放置查看器
```bash
cp "<本skill目录>/assets/viewer.html" "<目标目录>/分子光影查看器.html"
```
双击打开（`file://` 可用）。若本地文件的网络请求被拦截：在目标目录运行 `python -m http.server 8765`，再开 `http://localhost:8765/分子光影查看器.html`。

### 步骤 3：查看任意结构 / 本地文件
- 面板输入 4 位 PDB 编号 → 加载；或点预设；或“导入本地文件”/直接拖入 .cif/.pdb（AlphaFold、自己建的模型、论文补充材料里的结构）。
- 网址参数：`?pdb=4HHB`、`?preset=鞭毛马达`、`&q=low|medium|high`。无参数时默认打开“ATP 合酶（合成 ATP）”。
- 小分子（配体、核苷酸、离子、脂质）自动下载并画成球棍；结合位点附近的残基会闪光。

### 步骤 4：加一个预设（固定某个结构的样子）
在 `const PRESETS = {...}` 加一项。字段见 `references/parameters.md` §3。最小例子：
```js
'血红蛋白': { id: '4HHB', axis: 'long', blob: 4.0 },
```
完整例子：`'ATP 合酶（合成 ATP）'`（转子轴、剖开、膜、过程动画）、`'鞭毛马达'`（4 个 PDB 拼接）、`'腺苷酸激酶（开合）'`（两个构象之间变形）。

### 步骤 5：做“相互作用”动画（小分子怎么动）
- 小分子形态与做法：`references/small_molecules.md`。
- 过程动画接口（`PROCESSES` 注册表、ctx 工具函数、写新过程的模板）：`references/processes.md`。
- 两种构象之间变形（开/合、前/后）：预设写 `states: ['构象1', '构象2']`，见 parameters.md。
- 从论文出发：`references/paper_to_animation.md`。

### 步骤 6：验证（每次改动后必做）
在浏览器打开页面（Claude 用内置浏览器时**浏览器面板必须显示出来**，否则动画帧不跑），等状态栏出现“完成：N 个残基团块，M 个小分子”，逐项检查：

| 检查 | 方法 | 通过标准 |
|---|---|---|
| 下载成功 | 状态栏 / 控制台 | “完成：…”，无红色错误 |
| 部件齐全 | 面板“组成” | 每个部件残基数 > 0；小分子行（◆）出现 |
| 不过曝 | 截图 | 团块颗粒清楚，无大片纯白或奶白雾 |
| 构图 | 截图 | 主体占 50–80%；方向对（ATP 合酶 F1 头朝上、c 环在膜里） |
| 小分子可见 | 拉近截图 | ATP（金色碳）/ADP（青色碳）/磷酸（橙）清楚，不发黑、不被挡 |
| 过程在跑 | 等 5 秒读计数器 | 说明文字下方的计数（ATP、H⁺、K⁺）在增加 |
| 旋转 / 变形 | 间隔截图 | 转子转、定子和膜不动；构象滑块 0→1 结构有变化；ATP 合酶的 β 口袋随转子开合 |
| 稳定性 | 绕模型转一圈连续截图 | 剖开部分不闪烁、不突然消失 |
| 结构示意 | 显示模式切到“结构示意” | 螺旋、折叠箭头清楚；外形轮廓不发雾 |
| 性能 | 面板帧率 | 独显 ≥ 30 fps |

调试接口：`window.__viewer`（`loadScene(cfg)`、`groups()`、`ligands()`、`model()`、`proc()`、`PRESETS`、`PROCESSES`、`camera`、`controls`、`entryFromFile(name,text)`），`window.__fps`，`window.__gpu`。自动化测试脚本见 troubleshooting.md 末尾。

### 步骤 7：出问题
按症状查 `references/troubleshooting.md`。

## 参考文件
- `references/setup.md`：硬件分档、浏览器与显卡设置、离线使用、性能预期
- `references/architecture.md`：代码结构（下载 → 解析 → 组装体 → 定向 → 团块 → 小分子 → 着色器 → 后期/叠加层 → 膜 → 组件 → 过程动画），按函数名定位
- `references/parameters.md`：面板控件、预设字段（含 `axisFrom`、`ghost`、`states`、`chains`、`process`）、网址参数
- `references/style_guide.md`：怎么调出参考图的光影（逐项对照表 + 数值）
- `references/small_molecules.md`：小分子从哪来、怎么画成球棍、配色、大小、怎么让它动
- `references/processes.md`：过程动画 API 与模板（ATP 合酶、鞭毛马达、钾通道三个实例逐段解释）
- `references/paper_to_animation.md`：从“已有结构 + 最新论文”做成动画的完整流程与检查表
- `references/structures.md`：已实测结构清单、查询命令
- `references/troubleshooting.md`：症状 → 原因 → 解决；自动化测试脚本
- `references/rebuild_from_scratch.md`：在别的环境从零重做时，按什么顺序实现、每步怎么验收
- `references/build_log.md`：开发和调试记录（每轮看到什么、为什么那样改）
