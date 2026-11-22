# 2026-11-20 — Studio 面板结构改造（借鉴专业分子软件的结构）

## 做了什么
- **布局**：左侧“对象”大纲（一部件一行，行首复选框显示/隐藏，变暗表示隐藏，可撤销；选择按钮仍是行内唯一的按钮，旧冒烟脚本的选择方式不受影响）；右侧“属性 / 工具 / 讲解”三个标签页（`panel-tabs.mjs`，WAI-ARIA 标签页，方向键/Home/End，选择记入 localStorage，存储不可用时照常工作），撤销/重做固定在标签页上方；密度与配色沿用 Viewer 的专业软件风格（标题条、紧凑行）。
- **工具页**：由描述符生成；新增“添加工具”（列出 `listTools({audience:'author'})`）和“移除”；会话命令 `addToolEntry`（生成唯一条目 ID、深拷贝配置）与 `removeToolEntry`，v3 专用、可撤销。打开工具页时才启用工具插件。
- **全部场景为 v3**：新建空白场景直接 v3；导入结构经 `upgradeSceneToV3`（结构成为资源，本地文件为“授权未知、不可嵌入”）；打开工程时旧场景自动升级（并给声明了内置机制的场景写入默认工具配置）。
- **Viewer**：`mechanism-runtime` 先按 `scene.tools` 决定播放器，找不到再用旧 `legacy` 声明，使 Studio 里添加的条目对 Viewer 有意义。
- 冒烟脚本最小适配：截图“讲解”页前先切换标签页。更新 `apps/studio-web/README.md`。

## 验证
- 211 项 Node 测试通过（新增：`addToolEntry/removeToolEntry` 1 项、按工具条目选播放器 1 项；既有测试未改）。
- **浏览器端到端**（软件渲染 Chromium，无页面错误）：新建工程加方盒/球体 → 大纲每行 1 个按钮 + 复选框；隐藏→变暗，撤销→恢复；方向键切换标签页；工具页自动列出 AdK/ATP/KcsA；添加 KcsA → 把初始 pH 改为 7 成功、改为 9 被模型的范围拒绝并还原为 7；导出 → 包为 v3，含 `kcsa` 条目与 `pH:7`；移除/撤销正确。导入真实 4AKE.cif → 导出 v3 包，含 `res.local.…`（授权未知、不可嵌入）并建立链接。导入 Viewer 导出的 ATP 包 → 大纲 45 个部件、工具页 22 个字段 → 编辑、非法值被拒、撤销/重做、导出、Viewer 重开，全部与改造前一致。截图 `docs/images/studio-layout-outliner-tabs-1600.png`、`studio-add-tool-1600.png`。
- 修了一个我自己引入的错误：`renderPanels` 的参数名 `document` 遮住了全局 `document`，大纲行改用 `globalThis.document`（浏览器测试发现）。
- **未做/未验证**：Electron 冒烟脚本（`tools/studio-smoke.cjs`）无法在本环境运行，只做了上述最小适配，需要你在 Windows 上跑一遍；未在真实 GPU/EXE 验证。

## 需要你知道的
- Studio 视口里的结构仍是导入时生成的管状预览（带墨线），与 Viewer 的“团块/功能分区”不同；要一致，Studio 需要持有结构模型并重建表示（工作量较大，建议单独做）。
- 在 Studio 里添加的工具条目目前没有“绑定到哪些对象”的信息（协议的 `inputs` 还没做），所以 Viewer 里只有在结构与该工具匹配时才会真正运行，否则只是带着配置待用。
- Studio 保存的工程现在含 v3 场景，旧版软件打不开（已确认的取舍）。

## 下一步
1. `motion` 能力注册为独立工具 `org.glow.tool.*`，并补 `inputs`（适用条件与角色绑定），让添加的工具能绑定到对象。
2. Studio 视口的表示与 Viewer 对齐（持有结构模型、复用表示构建）。
3. 在 Windows 上重跑 `tools/studio-smoke.cjs`，按结果修正。
