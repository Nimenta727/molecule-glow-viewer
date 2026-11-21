# 桌面候选与发布验证

本流程覆盖已建立的 4.0 打包、4.1 安全与 4.2 对照基础，区分源码、暂存与实际 EXE。它不宣称完整功能或科学等价。

## 构建与身份

仓库根目录使用 Node >=20，运行 `npm ci` 和 `npm ci --prefix desktop`。`npm test` 跨平台发现全部 Node 测试，避免 Windows shell 通配符差异。

`node desktop/scripts/package-platform.cjs --stage-only` 输出独立暂存目录。脚本复制官方 `plugins/` 整体以及共享工作区/Shell 辅助模块，不再通过字符串替换注入入口。临时默认经典 Viewer；`GLOW_PAGE=viewer.html`、`studio.html`、`dev.html` 和菜单仍选择对应入口，`GLOW_QUERY` 保留。原工程没有声明 OS 文件关联，本轮不宣称新增文件关联；导入文件通过实际 UI 验证。

每个候选包含 `build-info.json`：源码提交、是否有工作区改动、时间、Electron 版本、逐文件 SHA-256 和内容集合哈希。帮助菜单可查看摘要；预加载器只提供只读构建信息。`node desktop/scripts/package-platform.cjs` 生成 `desktop/dist/release/candidate.json` 和带提交短号的 portable EXE；不会发布 GitHub Release。当前发行系列为 `0.7.0`；候选文件名带源码提交。最终公共文件名、标签、原始候选和哈希由 Release 清单关联，不能把旧版本下载文件算作当前源码。

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

15 包校验是数据合法性检查，不是 15 包科学模拟全部迁移完成。三个机制的发布冒烟也不替代各插件的完整科学对照。低画质/软件渲染用于 CI 可重复启动，不代表真实 GPU 性能。具体本次运行结果与产物哈希见 [P0 实测记录](history/RELEASE_VALIDATION_2026-11-19.md)；GitHub 作业是否通过需以对应提交的实际运行状态为准。

## 4.1 增补门槛

Windows 作业在暂存和实际 EXE 六例后，分别执行 `tools/security-smoke.cjs --live` 的四例：恶意 mmCIF、两代父 iframe 授权、Electron 实时网络缓存。实际通过的代码/产物见 [4.1 安全验收](history/SECURITY_REMEDIATION_2026-11-19.md)。同一个 portable 候选的两套回归按顺序运行，避免并发启动影响解包与退出。

## v0.5.0 与制作 Skill 发行

维护者要求本次同步正式 Desktop Release 和 Skill。源码先提交并通过完整检查；同一干净提交生成 EXE 与 Skill ZIP。Skill ZIP 包含 index/viewer/dev 经典配套资产、制作指南及内部文件哈希，不能被描述为完整新平台源码或离线结构全集。

`node tools/package-skill.mjs` 要求干净提交，内部校验必需资源、引用、manifest 和字节哈希；`--allow-dirty` 仅用于本地预检，不能拿这类结果发布。`node tools/package-skill.mjs --verify <zip>` 独立复验。

按顺序执行 EXE 功能和安全回归，避免同时启动同一个 portable。发行附 release-manifest.json、SHA256SUMS.txt、测试摘要和 Skill ZIP；记录精确源码/标签、本地 EXE/ASAR/内容哈希、Skill 哈希与 CI。新版本说明保留经典默认和新平台迁移预览定位。

只有具体产物通过后才发布 draft Release；标签指向被构建和验证的源码提交，不指向后来仅补报告的提交。签名状态和未迁功能如实列出。历史 0.4.0 与本次 0.5.0 下载文件不混用。

## v0.6.0 起：标签触发的自动发行

`.github/workflows/desktop-release.yml` 在推送 `desktop-v*` 标签时运行，也可在 Actions 页面对 main 手动运行（此时标签取 `desktop-v<desktop/package.json 版本>`，由发布作业在闸门所构建的同一提交上创建）：先以可复用方式调用完整 `platform.yml` 闸门（源码测试、暂存六例、安全、Studio M3、Skill 打包、实际 portable EXE 六例与安全回归），全部通过后才由发布作业建 Release。发布作业核对标签版本等于 `desktop/package.json`、候选 `sourceCommit` 等于标签提交且 `sourceDirty=false`，再把候选改名为 `MoleculeGlow-<版本>-win-x64.exe`，附 Skill ZIP、验证证据 ZIP、`release-manifest.json` 与 `SHA256SUMS.txt`；说明取自 `docs/releases/<标签>.md`。任一闸门失败则不建 Release。签名状态仍为未签名。

0.6.0 修正：打包检查原先要求目录里每个插件都带科学卡，导致自 4.4.2d 引入 motion/simulation 两个纯工具插件后 Windows 作业在暂存步骤失败。现规则为：注册播放器（`registerPlayer`）的机理插件必须带卡，纯工具框架插件不要求。
