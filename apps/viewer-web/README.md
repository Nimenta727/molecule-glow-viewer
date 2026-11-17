# Glow Viewer

运行仓库根目录的静态服务器。

```sh
npm ci
python -m http.server --bind 127.0.0.1 8000
```

打开 `http://localhost:8000/apps/viewer-web/`。此入口通过 HTTPS 加载与旧版相同版本的 Three.js。启动后会打开内置的基础几何示例，可以旋转视角、选中对象、播放和拖动时间线。

用「保存」下载 `.glow` v2 场景包，再用「关闭」和「打开」验证本地往返。也可以打开 P1 的原型 JSON。旧版 `.glow` v1 支持读入并迁移为 v2，必要时提供旧版查看器链接。文件格式和依赖行为见 [包与插件契约](../../docs/PLATFORM_2_0_PACKAGE_AND_PLUGINS.md)。

在「结构插件」面板启用官方插件后，可打开本地 PDB 或 mmCIF，也可输入 RCSB 编号。用链和残基字段核对结构选取。保存的 v2 文件包含原始字节、来源和独立几何预览，关闭插件后仍能查看预览。缎带按已有结构注释着色，渲染使用首个模型和确定性的备用位置规则。预览采用示意比例，原始坐标以 Å 保留。

在仓库根目录运行 Core 测试与旧版构建检查。

```sh
node --test packages/core/test packages/schema/test packages/plugin-host/test packages/legacy-compat/test plugins/structure/test plugins/rcsb/test
node tools/build.mjs --check
```

Electron 33.4.11 实测覆盖播放、暂停、跳转、v2 下载和重开、无效文件保留当前场景，以及换成空场景后旧几何体消失。另测了旧 v1 导入提示，以及缺少插件时仍能显示 v2 包中的通用几何。验收使用本地的同版本 Three.js 文件。

P3 以 4HHB 对照旧版解析器。PDB 和 mmCIF 的首个模型各有 4,779 条原子记录，原始坐标及作者链、残基编号一致。通过 RCSB 适配器实测下载的 mmCIF 与本地样本共 772,198 字节，内容一致。
