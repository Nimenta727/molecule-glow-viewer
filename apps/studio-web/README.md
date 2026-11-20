# Glow Studio MVP

在仓库根目录安装依赖并启动本地服务器。

```sh
npm ci
python -m http.server --bind 127.0.0.1 8000
```

打开 `http://localhost:8000/apps/studio-web/`。可从空白场景添加方盒、球体和组，也可将 PDB 或 mmCIF 导入为新场景。使用场景树选择对象，在视口或属性面板修改变换，并通过时间线为对象保存关键帧。一次视口拖动作为一个可撤销编辑。

「保存项目」生成 `.glow-project`，包含工程里的所有场景、活动场景和所需资源。「导出场景」将当前场景生成 `.glow` v3 包（作品配置与资源记录随场景保存；旧版软件打不开 v3）。用独立 [Glow Viewer](../viewer-web/) 打开场景包，可以查看通用预览、播放时间线、读标注和证据、应用视角书签。

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

## 界面结构

- **左侧“对象”**：场景选择与重命名；对象列表（大纲）一部件一行，行首的复选框显示/隐藏对象（可撤销），点击名称选中；下方是资源列表。
- **右侧三个标签页**（方向键 / Home / End 可切换，选择会被记住）：**属性**（所选对象的名称、父对象、颜色、位置/缩放/旋转）、**工具**、**讲解**（四模式导航、标注、证据、视角书签）。撤销/重做固定在标签页上方。
- **工具标签页**：“添加工具”列出宿主里所有提供制作配置的工具（新增一个制作类插件后会自动出现在这里，不需要改 Studio）；每个已添加的工具按分组生成配置编辑器，改动先经工具自己的校验，非法值被拒绝并还原；“移除”删除该工具条目。缺少对应插件时，配置原样保留并提示。
- 所有场景在 Studio 里都是当前格式（v3）：新建的空白场景、导入的结构（成为一个资源）、打开的工程里的旧场景（自动升级）。**导入场景包** 读取 Viewer 导出的 `.glow`。
