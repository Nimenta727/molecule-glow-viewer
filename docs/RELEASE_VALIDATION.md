# 桌面候选与发布验证

本流程实现迁移计划 4.0 的发布底座，区分源码测试、暂存目录与实际 EXE。它不宣称经典功能已全部追平，也不处理计划 4.1 的安全整改。

## 构建与身份

仓库根目录使用 Node >=20，运行 `npm ci` 和 `npm ci --prefix desktop`。`npm test` 跨平台发现全部 Node 测试，避免 Windows shell 通配符差异。

`node desktop/scripts/package-platform.cjs --stage-only` 输出独立暂存目录。脚本复制官方 `plugins/` 整体以及共享工作区/Shell 辅助模块，不再通过字符串替换注入入口。临时默认经典 Viewer；`GLOW_PAGE=viewer.html`、`studio.html`、`dev.html` 和菜单仍选择对应入口，`GLOW_QUERY` 保留。原工程没有声明 OS 文件关联，本轮不宣称新增文件关联；导入文件通过实际 UI 验证。

每个候选包含 `build-info.json`：源码提交、是否有工作区改动、时间、Electron 版本、逐文件 SHA-256 和内容集合哈希。帮助菜单可查看摘要；预加载器只提供只读构建信息。`node desktop/scripts/package-platform.cjs` 生成 `desktop/dist/release/candidate.json` 和带提交短号的 portable EXE；不会发布 GitHub Release。版本号仍沿用当前元数据 `0.4.0`，文件名/构建类型明确是迁移候选，不能和旧的正式 EXE 混淆。

`check-platform-stage.cjs` 使用 V8 编译但不执行模块，检查本地静态依赖、字面量动态 import、import map、外部模块、本地 CommonJS require 和入口资源均在暂存根内，并核对清单哈希。负例包括缺失机制模块、越界、远程模块与内容篡改。计算式动态路径、运行时生成的 Worker 等仍需浏览器回归覆盖，静态扫描不被称为完整运行证明。

## 真实结构与离线测试

```powershell
node tools/fetch-smoke-structures.mjs --dir desktop/dist/smoke-structures --refresh
node desktop/scripts/package-platform.cjs --stage-only
node tools/platform-release-smoke.cjs --stage <上一步输出目录> --fixtures desktop/dist/smoke-structures --output desktop/dist/gate-stage
node desktop/scripts/package-platform.cjs
$candidate = Get-Content desktop/dist/release/candidate.json | ConvertFrom-Json
node tools/platform-release-smoke.cjs --exe (Join-Path 'desktop/dist/release' $candidate.file) --fixtures desktop/dist/smoke-structures --output desktop/dist/gate-exe
```

`tools/fixtures/structures.json` 固定 6ZPO、1K4C、5VK6、5VKE、2HVK、2ITD、4AKE、1AKE 的原始 RCSB 地址、字节数与哈希。`--refresh` 实时下载并核验；默认可重用已验证缓存。RCSB 若改变文件，检查失败并要求审查数据，不能静默更新哈希。

结构文件不随 EXE 分发。驱动器为每个案例建立隔离 userData 缓存，校验字节后预置数据；应用测试期间禁止外网补数据。没有本地 HTTP 服务，不提供仓库根目录的模块作为回退。注入脚本来自测试工具，只含动作和固定输入数据，不给应用补缺失运行模块。日常启动不启用这些 `GLOW_SMOKE*` 测试环境变量。

## 六个实际运行案例

| 案例 | 核对内容 |
|---|---|
| 经典默认入口 | 未设置 GLOW_PAGE 时确实进入经典页面；本地 PDB 的四个残基、v1 保存/重开和可见分子 |
| Studio | 新建对象、修改属性、实际保存工程文件、改动后重开原工程、实际导出 v2 场景 |
| 新 Viewer | 显式入口、本地 PDB 文件、表示与残基选择、实际保存按钮下载、原字节 ZIP 重开及选择/镜头恢复 |
| ATP | 真实 6ZPO，4 示意秒计数 3 ATP / 8 H⁺；播放前进、暂停、保存重开和插件切换 |
| KcsA | 真实五套结构、外流/平衡电位、播放和状态保存重开、插件切换 |
| AdK | 真实两态、域转角、自动/手动、播放与状态保存重开、插件切换 |

普通桌面隔离选项保持 `contextIsolation=true`、`nodeIntegration=false`、`sandbox=true`。每例输出 JSON、请求日志、实际下载文件以及 1440/560 px 截图。分子截图另做颜色像素检查，仍须人工查看截图。Studio 导出的 ZIP 由父测试进程验证格式和哈希；该验证只读下载结果，不为应用补模块。

EXE 测试还提取构建生成的 `win-unpacked/resources/app.asar` 执行闭包/内容哈希校验。实际 portable 运行时报告自己的 ASAR 哈希，必须与检查对象一致；因此检查不是只启动 `electron.exe` 或只测试 `win-unpacked`。提供独立 EXE 时，可用 `--asar <相同候选的app.asar>` 指定待核对归档。

## CI 与验收边界

`.github/workflows/platform.yml` 对平台源码、插件、桌面、测试和依赖变更运行：完整 Node/包安全测试、经典构建/副本、15 个官方包校验；Windows 作业执行实时结构下载、暂存目录六例、Studio M3、portable 打包、实际 EXE 六例，并上传候选和日志/截图。所有测试都必须通过作业才为绿；维护者还需在仓库分支保护中把对应检查设为 required，不能把工作流文件存在说成分支保护已配置。

15 包校验是数据合法性检查，不是 15 包科学模拟全部迁移完成。三个机制的发布冒烟也不替代各插件的完整科学对照。低画质/软件渲染用于 CI 可重复启动，不代表真实 GPU 性能。具体本次运行结果与产物哈希见 [P0 实测记录](RELEASE_VALIDATION_2026-11-19.md)；GitHub 作业是否通过需以对应提交的实际运行状态为准。
