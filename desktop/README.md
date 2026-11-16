# 桌面版（Windows exe）

同一个查看器（[`web/index.html`](../web/index.html)），用 Electron 包成桌面程序：
- **不用浏览器**：双击 exe 就能打开。
- **Three.js 打包在程序里**：不依赖 CDN。
- **结构缓存**：从 RCSB / UniProt 下载过的数据存在本地（`%APPDATA%\分子光影\structure-cache`）。第二次打开同一个结构不用下载，断网时也能看已经看过的结构。
  - 坐标文件优先读缓存，因为一个条目的坐标不会变。
  - 名称、注释等元数据优先联网，断网时退回缓存。
- **外部链接**（DOI、UniProt 页面）用系统浏览器打开。

## 下载
到 [Releases](https://github.com/Nimenta727/molecule-glow-viewer/releases) 下载 `GlowStudio-x.y.z-portable.exe`，双击即可运行，不需要安装。

第一次打开某个结构仍需要联网。

## 自己构建
需要 Node.js 18 或更高版本。
```bash
cd desktop
npm install
npm start
```
`npm start` 会先把 `../web/index.html` 复制到 `app/`，再启动程序。

自检：`GLOW_SMOKE=25` 会在 25 秒后打印页面报错和缓存命中情况、截一张图到临时目录，然后退出；`GLOW_QUERY='?pdb=1K4C'` 指定打开的结构。

打包 Windows 便携版 exe，输出在 `dist/`：
```bash
npm run dist
```

## 结构
| 文件 | 作用 |
|---|---|
| `main.js` | 窗口；`app://glow/` 协议加载查看器；拦截 jsDelivr 的 Three.js 请求改读本地；RCSB / UniProt 磁盘缓存 |
| `preload.js` | 给页面暴露 `window.glowDesktop`（版本、缓存大小、清缓存） |
| `scripts/sync.js` | 把网页版复制进 `app/`，把 Three.js r160 复制进 `vendor/three/`（electron-builder 默认会去掉 node_modules 里的 examples 目录，所以要单独放） |

查看器本身不改：网页版和桌面版跑的是同一个文件。

## 计划
1. `.glow` 场景包：把一个场景（结构、组件、配色、镜头、讲解、动画）存成一个文件，可以导入导出。
2. 创意工坊：官方源为主，社区作品也能上架；社区动画用纯数据描述，不运行别人的代码。
