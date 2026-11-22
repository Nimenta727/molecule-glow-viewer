# 2026-11-19 — 前端恢复：白底墨线画风 + Viewer 面板重构

## 做了什么
- **确认 4.3.0 三点**：§9 改为已确认；并按维护者要求把候选工具合并为 4 个功能族包（structure / motion / simulation / teaching），不再拆散（`docs/CONTRACT_4.3.0.md` §3、§9）。
- **画风**：新增 `packages/render-three/ink-style.mjs`，把经典 `src/view/renderer.js` 的 InkPass（深度缓冲描边、沟槽线、宏观明暗、远景向纸色淡出）移植为主体内置默认画风 `core.ink`；深度按"相机距离/150"归一，与场景尺度无关；GPU 不支持深度纹理时自动退回普通渲染。`viewport.mjs` 默认启用，`style:'plain'` 可关闭。
- **Viewer 布局**：`apps/viewer-web/index.html` + `viewer.css` 重写为"画布铺满、浮动卡片"：顶部品牌+文件按钮；左侧可折叠面板（手风琴）；底部传输条；窄屏面板变为底部抽屉。全部元素 ID 不变，`main.mjs` 仅去掉一行写死的白色背景参数。
- **Studio**：`studio.css` 只换配色/字体，与 Viewer 统一（绿 → 靛蓝，纸色底）；布局保持三栏编辑器。
- 证据截图：`docs/images/fe-viewer-*.png`（改前/改后 1440、560 窄屏、四模式场景）。

## 验证
- 145 项 Node 测试通过（改动后重跑）。
- 在 Chromium（软件渲染）中手动截图检查 4HHB 团块、四模式示例、1440/560 宽度；**未**在真实 GPU 和真实 Windows EXE 上验证，也**未**重跑 Electron 冒烟/安全用例。

## 与经典版仍有差距（需后续）
- 团块目前是新版"球团块"，经典是平滑的域表面；这属于 4.4.0（表示功能）而不是画风。
- 未做：标题/证据徽章 HUD、简介卡、选择淡化、字幕样式、开场画面（经典的 `#title`、`#infoCard`、`#caption`）；Viewer 中画布居中未避开左侧面板；Studio 未做排版重构。
- 画风切换（光影包）尚无界面，仅有 `style` 参数。

## 下一步
1. 维护者在真实 Windows 上看一眼 Viewer/Studio，指出不满意的排版或颜色。
2. 前端第二批：经典 HUD（标题+证据徽章、简介卡、字幕、选择淡化），并让镜头framing避开面板。
3. 开始 4.3.1：resource 记录与 schema 的 `resource` 引用，先写失败用例。
