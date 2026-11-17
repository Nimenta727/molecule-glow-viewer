# Glow Studio MVP

在仓库根目录安装依赖并启动本地服务器。

```sh
npm ci
python -m http.server --bind 127.0.0.1 8000
```

打开 `http://localhost:8000/apps/studio-web/`。可从空白场景添加方盒、球体和组，也可将 PDB 或 mmCIF 导入为新场景。使用场景树选择对象，在视口或属性面板修改变换，并通过时间线为对象保存关键帧。一次视口拖动作为一个可撤销编辑。

「保存项目」生成 `.glow-project`，包含工程里的所有场景、活动场景和所需资源。「导出场景」将当前场景生成 `.glow` v2 包。用独立 [Glow Viewer](../viewer-web/) 打开场景包，可以查看通用预览、播放时间线、读标注和证据、应用视角书签。

工程文件采用版本化的 UTF-8 JSON 容器并内嵌资源字节。打开和保存时核验资源 SHA-256。工程的编辑历史保留在当前会话中。

```sh
node --test packages/core/test packages/schema/test packages/studio-editor/test
```

Windows 上可以复跑 Studio 到 Viewer 的浏览器验收。先安装桌面依赖并同步本地 Three.js，然后运行测试。

```powershell
npm ci --prefix desktop
node desktop/scripts/sync.js
& ./desktop/node_modules/electron/dist/electron.exe tools/studio-smoke.cjs
```
