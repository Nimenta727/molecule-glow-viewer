# 桌面版（Windows exe）

Desktop 0.9.0 用 Electron 提供经典、新 Viewer、Studio 和工作台。当前能力与边界见 [文档首页](../docs/README.md)：
- **不用浏览器**：双击 exe 就能打开。
- **Three.js 打包在程序里**：不依赖 CDN。
- **结构缓存**：从 RCSB / UniProt 下载过的数据存在 Electron `userData/structure-cache`，实际目录可由 `glowDesktop.cacheInfo()` 查询。再次打开已有缓存的结构可复用数据，断网时也能看缓存中的结构。
  - 坐标文件优先读缓存；上游可能修订坐标，科学对照使用固定原始哈希，不把编号相同当作字节永远相同。
  - 名称、注释等元数据优先联网，断网时退回缓存。
- **外部链接**（DOI、UniProt 页面）用系统浏览器打开。

## 下载
从 [最新发布](https://github.com/Nimenta727/molecule-glow-viewer/releases/latest) 下载 `MoleculeGlow-0.9.0-win-x64.exe`，双击即可运行。默认打开经典 Viewer，通过「工作区」菜单切换新版 Viewer、Studio 和经典开发者工作台。[0.3.2 历史发布](https://github.com/Nimenta727/molecule-glow-viewer/releases/tag/desktop-v0.3.2)继续保留。

第一次打开某个结构仍需要联网。

0.9.0 发行与当前源码都保留经典默认入口，新平台仍为迁移预览。构建候选的文件名附带源码提交，`-worktree` 表示包含未提交改动。帮助菜单“版本与构建”可查看提交、内容哈希和候选性质。候选不会自动发布或覆盖旧版 EXE，验收流程见 [发布验证](../docs/RELEASE_VALIDATION.md)。

## 自己构建
需要 Node.js 20 或更高版本。
```bash
npm ci
npm ci --prefix desktop
npm start --prefix desktop
```
`npm start` 会先运行 `../tools/build.mjs`（从 `../src/` 生成 `../web/index.html`），再把它复制到 `app/`，然后启动程序。

自检：`GLOW_SMOKE=25` 会在 25 秒后打印页面报错和缓存命中情况、截一张图到临时目录，然后退出；`GLOW_QUERY='?pdb=1K4C'` 指定打开的结构。

## 回归测试（每次改查看器都要跑）
```bash
node scripts/regress.mjs           # 跑 6 个固定场景，和 regress/baseline.json 比较
node scripts/regress.mjs --accept  # 确认这次结果正确后，存为新基线
```
场景列表在 `scripts/regress-scenes.json`（4HHB 自动模式、6ZPO ATP 合酶、1K4C KcsA、4V6F 翻译、7CGO 鞭毛马达、细胞一角）。每个场景记录：能否载入、载入时间、实体 / 链 / 残基 / 配体数量、GPU 几何体 / 纹理 / 绘制调用、FPS、最差帧、过程计数，并截图到 `regress/latest/`。最后回到第一个场景：几何体、纹理、场景对象数量变多 = `clearScene()` 漏释放。
- **不通过**（退出码 1）：载入失败、内容数量变化、资源泄漏、几何体多 25% 以上。
- **只警告**：FPS 下降、载入变慢（和机器有关）。
- 页面里也能用：控制台 `await __viewer.probe(3)`。

在仓库根目录执行下列命令打包 Windows x64 便携版，输出在 `desktop/dist/release/`。新版打包需要 Node.js 20 或更高版本。
```bash
npm ci
npm ci --prefix desktop
npm run dist --prefix desktop
```

打包会先整体复制官方插件目录，检查入口与静态/字面量动态模块依赖、CommonJS 辅助模块及资源哈希；随后生成实际 portable EXE 和 `candidate.json`。测试代码与类型声明不打入应用。插件是否执行仍由受信 catalog 决定，不从 `.glow` 执行代码。

实际产物验收不能只运行源码服务器。流程依次为 `npm test`、下载固定哈希真实结构、暂存目录回归、EXE 内部 ASAR 检查、实际 EXE 回归；详见 [发布验证命令](../docs/RELEASE_VALIDATION.md)。

## 结构
| 文件 | 作用 |
|---|---|
| `main.js` | 窗口；`app://glow/` 协议加载查看器；拦截 jsDelivr 的 Three.js 请求改读本地；RCSB / UniProt 磁盘缓存 |
| `preload.js` | 给页面暴露 `window.glowDesktop`（版本、缓存大小、清缓存） |
| `scripts/regress.mjs`、`scripts/regress-scenes.json`、`regress/baseline.json` | 回归测试（`GLOW_REGRESS=<目录>` 模式由 main.js 执行） |
| `scripts/sync.js` | 把网页版复制进 `app/`，把 Three.js r160 复制进 `vendor/three/`（electron-builder 默认会去掉 node_modules 里的 examples 目录，所以要单独放） |

查看器本身不改：网页版和桌面版跑的是同一个文件。

## 创意工坊
程序里点“🧩 创意工坊”：浏览、订阅官方和社区的场景。工坊目录和看过的场景也会缓存，断网时“已订阅”里的场景照样能打开。把 `.glow` 文件拖进窗口就能打开别人分享的场景。说明见 [workshop/](../workshop/)。

自检还可以用 `GLOW_SMOKE_JS=<脚本>`（加载后在页面里运行一段测试脚本，结果打印出来）和 `GLOW_SHOT=<文件.jpg>`（存一张 640×360 的封面）。

## 4.1 安全边界

`response-cache.cjs` 为缓存资源设置 64 MiB 解码体上限、30 秒超时、8 个并发写入及 2 GiB 已提交载荷预算；无 Content-Length 也按实际读入字节计数。正文分块写临时文件，完成后以独立代次载荷及原子元数据提交；超限、中断和清缓存会取消读取并清理临时文件。旧版完整缓存仍可读，不把失败响应写成成功缓存。这里没有对未缓存的直通网络响应增加主进程缓冲。

外链和弹窗共用精确 app 页面/host 与 http/https 白名单；其他系统协议拒绝交给 OS。经典和新版嵌入共用窗口绑定、场景绑定的控制/敏感读取授权，见 [命令接口](../docs/VIEWER_COMMAND_API.md)。`tools/security-smoke.cjs` 已接入 Windows 暂存和实际 EXE 的 CI 作业；不等于框架、所有第三方依赖及所有业务功能已完成安全审计。

制作 Skill ZIP、SHA256SUMS 和 release-manifest 与 EXE 同版本发布。历史 0.4.0 的默认入口和内容不同，不能用当前源码评价旧下载文件。
