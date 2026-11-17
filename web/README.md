# 网页版

`index.html` 就是整个查看器：一个文件，不需要安装。

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
- 桌面版打包的就是这个文件，两边功能完全一样。
- [skill](../skill/) 里的 `assets/viewer.html` 是它的副本（单独使用 skill 时给 AI 在上面改；在本仓库里开发请改 `src/`）。
