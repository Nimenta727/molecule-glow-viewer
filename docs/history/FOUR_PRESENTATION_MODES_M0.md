# 四种展示模式 M0

基线为 `main` 的 `9de64cd`，其父提交 `0aaf472` 对应 `desktop-v0.4.0`。经典 Viewer 和独立的 P5 检查点均未纳入本工作包。

## 示例和操作路径

在新版 Viewer 中选择「打开」，载入 [four-modes-demo.glow](../../apps/viewer-web/four-modes-demo.glow)。保持结构插件关闭即可看到几何、示意说明和镜头书签。点「播放」可观察橙色颗粒从起点经过接触点到达终点。「保存」下载场景，再用「打开」重开。示例使用通用几何和关键帧描述虚构颗粒传递，坐标和时间只用于布景。

| 模式 | 目标 | 返回 | 默认镜头和信息 |
| --- | --- | --- | --- |
| `cell` | 示意细胞，包含传递区 | 根入口 | 细胞总览和传递区标签 |
| `system` | 传递区中的颗粒传递系统 | 细胞 | 起点、终点和示意蛋白质 |
| `protein` | 由三块几何组成的示意蛋白质 | 局部系统 | 蛋白质与接触点 |
| `mechanism` | 示意颗粒传递 | 实际调用者，局部系统或蛋白质 | 局部系统镜头和 0、2、4 秒的三个步骤 |

M0 冻结数据并使用现有 Viewer 验收文件。实际进入、返回和镜头过渡由 M1 接入，模式专用界面由 M2 接入。

## 数据约定

- 可选的 `presentation.navigation` 使用 `version: 1`。外层场景沿用 `schemaVersion: 2`。没有导航字段的旧 v2 文档及从 v1 迁移的文档继续按普通场景打开。较旧的 0.4.0 构建使用严格 schema，读取含导航字段的场景需要新版。
- `entryId` 指向唯一的细胞根视图。每个视图有稳定 ID、模式、标题、目标节点、父视图列表、镜头书签和可见讲解 ID。进入关系由目标视图的 `parentIds` 导出。节点 ID 引用原有场景树。机理从系统或蛋白质进入，返回恢复调用者的选择和镜头。
- 可选的 `hotspotNodeId` 标记父视图中的入口。拾取命中热点节点或其子节点时，可选中相应入口。示例中点击传递区底座命中「传递区」，进入后聚焦「颗粒传递系统」。没有热点的入口可通过按钮提供。
- 所有视图共享场景时间线。机理步骤引用参与节点，同一机理的步骤全部填写时间或全部省略。时间戳须在时间线范围内严格递增。播放时显示已到达的最新步骤，第一步之前没有当前步骤。省略时间的机理通过手动选步浏览，空时间线也适用。
- 校验拒绝不存在的目标、热点、标签或书签。父级规则使路径无环。无效镜头数值同样会被拒绝。校验失败时现有加载流程保留当前场景。`bookmarkId: null` 表示后续导航应使用目标节点的默认取景。
- Core 仍读取几何树和时间线，导航与书签留在场景文档。Studio 保存保留扩展数据，涉及删除被引用节点的编辑由现有事务校验拒绝。

## 复验

- `node --test packages/schema/test/*.test.mjs packages/legacy-compat/test/*.test.mjs packages/core/test/*.test.mjs packages/studio-editor/test/*.test.mjs` 覆盖 v2 示例与旧文件往返、引用错误和缺省行为。
- 设置 `GLOW_M0_SCREENSHOTS` 为截图输出目录，用 Electron 启动 `tools/studio-smoke.cjs`。脚本保存普通和 560 像素宽的 Studio、Viewer 基线及示例截图，并检查渲染、播放、保存重开、损坏包保留场景和旧 v1 导入。普通 v2 基线由 Studio 导出。
- 本轮 52 项 Node 检查和 Electron 验收通过。经典构建、副本一致性与 15 个工坊包校验通过。Viewer 在 560 像素宽时文件与播放操作可见，调整窗口后细胞底座边缘有裁切，交由 M1 的相机取景处理。
- 修改示例源码后，在仓库根目录重新打包：

  ```sh
  node --input-type=module -e "import {writeFile} from 'node:fs/promises'; import {writeScenePackage} from './packages/schema/archive.mjs'; import {fourModesDemo} from './apps/viewer-web/four-modes-demo.mjs'; await writeFile('apps/viewer-web/four-modes-demo.glow', await writeScenePackage(fourModesDemo));"
  ```
