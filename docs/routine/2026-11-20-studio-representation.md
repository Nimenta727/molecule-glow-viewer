# 2026-11-20 — Studio 视口与 Viewer 的表示对齐

## 做了什么
- 抽出共用函数 `plugins/structure/view-layers.mjs`（`buildStructureLayers`、`structureSources`、`STRUCTURE_STYLES`）：把 Viewer 里构建结构显示层的约 50 行逻辑搬出来，Viewer 改为调用它（拾取目标通过回调保留）。默认样式规则 `default-style.mjs` 挪到 `plugins/`，两个前端共用。
- Studio：为每个场景持有结构模型（按保存的组装体/链解析，与 Viewer 一致），后台构建表示；构建完成前或失败时用预览几何；工具栏新增“结构表示”选择（只影响视图）；进度写在选择器旁的 `#representation-note`，不碰状态栏（冒烟脚本按状态栏文字等待，避免异步覆盖造成偶发失败）。

## 验证
- **Viewer 重构零回归**：重构前后各取 15 张视口截图（ATP / AdK / KcsA 官方包 × 团块/示意/功能分区/表面/主链，固定镜头、时间 0），哈希逐一相同。
- 225 项 Node 测试通过（新增 4 项：各样式替换预览、样式优先级（请求 > 已存 > 默认，未知样式被忽略）、对不上的预览保留且无模型的结构不动、拾取目标回调与旧包的样式/颜色优先）。
- 浏览器（软件渲染 Chromium，无页面错误）：Studio 导入 Viewer 导出的 ATP 包 → 自动构建并显示功能分区叶片（与 Viewer 相同）；导入本地 4AKE.cif → 两条链以墨线表示显示；切换表示、添加方盒后表示保持，状态栏保留“已添加方盒。”。截图 `docs/images/studio-representation-*.png`。
- 未重跑 Electron 冒烟脚本（无法在本环境运行）；未在真实 GPU/EXE 验证。

## 需要你知道的
- Studio 里选的表示不保存进作品；Viewer 的会保存为 `viewerStyle`。
- Studio 点选仍是整链节点，没有 Viewer 的残基级拾取。
- 大结构首次构建要数秒（ATP 81k 原子），期间显示预览几何。
