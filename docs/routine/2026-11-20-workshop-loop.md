# 2026-11-20 — 4.3.4 工坊最小闭环（作品区/资源区）

## 做了什么
- **资源区目录**：`workshop/official/resources/index.json`（`glow-resources`），收录 8 个结构（6ZPO、KcsA 五个状态、AdK 两态）。每项是一条不含字节的 `glow-resource` 记录（来源、CC0、大小、SHA-256、物种/方法/突变卡片）+ 标题/说明/标签 + `delivery:"reference"`。由 `workshop/tools/build-resources.mjs` 从已审阅的 `docs/science/structures.json` 离线、确定性生成；记录 ID 与版本与导入时生成的一致（`res.rcsb.6ZPO@7a992857`）。KcsA 条目的物种/E71A 取自 KcsA 科学卡（RCSB 查询里这些字段为空）。
- **作品区目录**：`build-index.mjs` 给每个作品增加 `kind:"work"`、`resources`（本目录已收录的资源 ID）和 `tools`（所需工具 ID，经旧机制声明到工具的映射）；只新增字段，经典客户端不受影响。CI 工作流增加重建资源目录一步。
- **客户端与对话框**（`plugins/workshop/`）：`catalog.mjs`（读取校验、查询、依赖关联、下载核对哈希、同源/GitHub 位置规则）、`dialog.mjs` + `workshop.css`（Viewer 与 Studio 共用）。
- **Viewer**：“工坊”按钮；作品“打开”（核对哈希→启用结构插件→载入）、资源“打开结构”（核对哈希→作为结构打开，保留 RCSB 来源，场景里的资源就是目录里的记录）；`?work=<id>` 启动即打开某作品。
- **Studio**：“工坊”按钮；资源“用此资源新建作品”（核对哈希→导入→作品标题取自目录，第一个资源即该记录）；作品“在 Viewer 中打开”。导入结构的逻辑抽成 `importStructureAsWork`，文件导入和资源导入共用。
- 修了一个体验缺口：目录完全读不到时，对话框原来把 404 一律隐藏，结果既无内容也无提示；现在只有在已有内容时才隐藏“某来源没有资源目录”这类 404。

## 验证
- 235 项 Node 测试通过（新增：客户端 8 项、目录一致性 3 项）。目录一致性测试同时要求：记录通过校验、ID/版本命名规则、与 `structures.json` 和发行夹具的哈希一致、作品的资源/工具 ID 都存在，**并且已提交的目录等于构建脚本的输出**（防止漏提交）。
- 浏览器端到端（软件渲染 Chromium，无页面错误）：
  - Viewer：作品区 15 项、资源区 8 项、搜索与标签筛选；ATP 卡片显示“使用资源：6ZPO（CC0-1.0）· 需要工具：ATP 合酶”；打开资源 4AKE → 场景里的资源是 `res.rcsb.4AKE@fcb2ff49`（与目录一致）；打开作品 AdK → 两个资源登记、AdK 播放器运行（CORE RMSD 1.975 Å）。
  - Studio：资源区“用此资源新建作品”1AKE → 新作品，导出的 v3 包含 `res.rcsb.1AKE@01f41b1b`（RCSB、CC0、可嵌入）并建立链接。
  - **拒绝路径**（临时目录里故意改坏哈希）：作品哈希不符 → 对话框保持打开、提示“已拒绝打开”、场景未变；资源哈希不符 → Viewer 与 Studio 都拒绝，说明“记录 00000000…，实际 da8a06fa…；该条目可能已在上游更新”，Studio 场景数不变；目录完全读不到 → 对话框列出每个目录的错误。截图 `docs/images/workshop-*.png`。
- 未重跑 Electron 冒烟脚本；未在真实 GPU/EXE 验证；GitHub 上的默认目录地址（`raw.githubusercontent.com`）没有在这里测试，浏览器验证用的是本地检出的同源目录。

## 需要你知道的
- 目前只有官方资源区，且只有 RCSB 来源；社区资源的投稿、审核、版本升级未做。
- Studio 不能直接导入官方的 v1 场景包，所以作品区在 Studio 里只提供“在 Viewer 中打开”。
- 工坊默认读 GitHub 上 `main` 分支的目录，所以这批改动合并进 `main` 之后，已发布的桌面版才能在线看到资源区。
- 桌面版是否允许访问 `raw.githubusercontent.com` 取决于其网络策略，经典 Viewer 已在用同一地址；新对话框用同一地址。
