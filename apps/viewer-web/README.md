# Glow Viewer P1

运行仓库根目录的静态服务器。

```sh
python -m http.server 8000
```

打开 `http://localhost:8000/apps/viewer-web/`。此入口通过 HTTPS 加载与旧版相同版本的 Three.js。启动后会打开内置的基础几何示例，可以旋转视角、选中对象、播放和拖动时间线。

用「保存」下载场景 JSON，再用「关闭」和「打开」验证本地往返。P1 的 JSON 是内部原型格式，字段见 [Core 契约](../../docs/PLATFORM_2_0_CORE_CONTRACT.md)。可发布的 .glow v2 格式和旧版导入在 P2 接入。

在仓库根目录运行 Core 测试与旧版构建检查。

```sh
node --test packages/core/test
node tools/build.mjs --check
```

P1 已通过 Electron 33.4.11 浏览器验收，覆盖播放、暂停、跳转、下载、关闭、重新打开、无效文件保留当前场景，以及换成空场景后旧几何体消失。验收使用本地的同版本 Three.js 文件。
