# 网页版

这里是经典 Viewer：index.html 为单文件经典运行入口。新平台 Viewer/Studio 的结构、能力和迁移状态见 [当前文档](../docs/README.md)。

> 这个目录里的 `index.html`、`dev.html` 是**构建生成**的（`node tools/build.mjs`，源码在 [`../src/`](../src/)）。改查看器请改 `src/`，不要手改这里。

## 打开
双击 `index.html`（Chrome / Edge 最新版）。如果浏览器拦截本地文件的网络请求，在本目录运行：
```bash
python -m http.server 8765
```
然后打开 `http://localhost:8765/index.html`。

网址参数：`?pdb=4HHB`、`?preset=鞭毛马达`、`&q=low|medium|high`。

## 需要联网
- `models.rcsb.org`、`data.rcsb.org`、`files.rcsb.org`：结构和注释（每次打开时实时下载）
- `cdn.jsdelivr.net`：Three.js r160
- `rest.uniprot.org`：蛋白功能说明

想离线用、或者想让下载过的结构存在本地，用 [桌面版](../desktop/)。

## 和其他两部分的关系
- 桌面版包含这个经典工作区，并另外提供新 Viewer/Studio 菜单；不同入口的功能不能混为一谈。
- [skill](../skill/) 里的 assets/index.html 和 viewer.html 是它的构建副本，dev.html 是配套工作台；仓库经典修改 src，新功能迁移按主体＋插件流程。
