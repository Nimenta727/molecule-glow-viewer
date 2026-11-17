# Glow Viewer

运行仓库根目录的静态服务器。

```sh
npm ci
python -m http.server --bind 127.0.0.1 8000
```

打开 `http://localhost:8000/apps/viewer-web/`。此入口通过 HTTPS 加载与旧版相同版本的 Three.js。启动后会打开内置的基础几何示例，可以旋转视角、选中对象、播放和拖动时间线。

用「保存」下载 `.glow` v2 场景包，再用「关闭」和「打开」验证本地往返。也可以打开 P1 的原型 JSON。旧版 `.glow` v1 支持读入并迁移为 v2，必要时提供旧版查看器链接。文件格式和依赖行为见 [包与插件契约](../../docs/PLATFORM_2_0_PACKAGE_AND_PLUGINS.md)。

在仓库根目录运行 Core 测试与旧版构建检查。

```sh
node --test packages/core/test packages/schema/test packages/plugin-host/test packages/legacy-compat/test
node tools/build.mjs --check
```

Electron 33.4.11 实测覆盖播放、暂停、跳转、v2 下载和重开、无效文件保留当前场景，以及换成空场景后旧几何体消失。另测了旧 v1 导入提示，以及缺少插件时仍能显示 v2 包中的通用几何。验收使用本地的同版本 Three.js 文件。
