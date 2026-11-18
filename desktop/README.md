# 桌面版（Windows exe）

同一个查看器（[`web/index.html`](../web/index.html)），用 Electron 包成桌面程序：
- **不用浏览器**：双击 exe 就能打开。
- **Three.js 打包在程序里**：不依赖 CDN。
- **结构缓存**：从 RCSB / UniProt 下载过的数据存在本地（`%APPDATA%\分子光影\structure-cache`）。第二次打开同一个结构不用下载，断网时也能看已经看过的结构。
  - 坐标文件优先读缓存，因为一个条目的坐标不会变。
  - 名称、注释等元数据优先联网，断网时退回缓存。
- **外部链接**（DOI、UniProt 页面）用系统浏览器打开。

## 下载
从 [最新发布](https://github.com/Nimenta727/molecule-glow-viewer/releases/latest) 下载 `MoleculeGlow-0.4.0-win-x64.exe`，双击即可运行。默认打开新版 Viewer，通过「工作区」菜单切换 Studio、经典 Viewer 和开发者工作台。[0.3.2 历史发布](https://github.com/Nimenta727/molecule-glow-viewer/releases/tag/desktop-v0.3.2)继续保留。

第一次打开某个结构仍需要联网。

## 自己构建
需要 Node.js 18 或更高版本。
```bash
cd desktop
npm install
npm start
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
