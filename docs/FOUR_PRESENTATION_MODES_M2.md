# 四种展示模式 M2

在新版 Viewer 点「四模式示例」，或打开 [four-modes-demo.glow](../apps/viewer-web/four-modes-demo.glow)。四种模式共用场景、文件操作和底部时间线。

| 模式 | 操作 |
| --- | --- |
| 细胞 | 查看边界、场景方位和传递区。点视口中的传递区或按区域按钮，再进入局部系统。 |
| 局部系统 | 选择对象聚焦，查看带箭头的示意方向。可以进入蛋白质或反应机理。 |
| 蛋白质 | 单独查看对象及可见部件。选择部件聚焦，也可拖动视口或使用旋转按钮。 |
| 反应机理 | 查看步骤与参与对象。播放或拖动时间线会更新当前步骤和高亮。点有时间的步骤会暂停并跳到对应时间点。 |

反应机理可从局部系统或蛋白质进入，返回恢复原镜头和选择。时间线在不同模式之间共享。没有时间锚点的步骤可以手动切换。带时间锚点的机理在第一步之前不高亮参与对象。

## 改动

- `apps/viewer-web/mode-panel.mjs` 根据当前视图生成面板。对象列表沿用场景节点和可见性，步骤沿用导航数据。缺少导航数据的场景沿用普通 Viewer。
- `packages/render-three/viewport.mjs` 与 `presentation-overlay.mjs` 控制视图可见范围、旋转、连接与高亮。覆盖层随当前场景释放。隐藏对象不绘制覆盖。机理和系统的默认镜头可纳入视图根节点之外的参与对象。
- v2 的系统视图可选填 `connections`，格式为 `{ from, to, label }`。两端引用不同的有效节点。这些连接用于教学示意。旧场景可以省略该字段。早期使用严格 schema 的 Viewer 需要更新后才能打开含连接字段的场景。
- 示例沿用通用几何。未来的真实结构仍可通过现有 Viewer 的结构插件和几何渲染入口提供。Studio 的模式作者界面留给 M3。

## 验收

- `node --test packages/*/test/*.test.mjs plugins/*/test/*.test.mjs` 通过 74 项检查。
- `node tools/build.mjs --check` 与 `node tools/check-copies.mjs` 通过。
- 在 `tools/studio-smoke.cjs` 的 Electron 验收中设置 `GLOW_M1_SCREENSHOTS`，可复验导航和四模式面板。脚本检查系统箭头、蛋白质聚焦与旋转、机理选择与播放同步，并保存普通窗口和 560 像素窄窗口截图。设置 `GLOW_M0_SCREENSHOTS` 可同时复验保存重开、旧版兼容及关闭结构插件的表现。
