# src/ —— 查看器源码

从 WP1 起（总体规划摘要见 [当前项目结构](../docs/ARCHITECTURE.md)；历史工作包见 [docs/history/HANDOFF_PLAN.md](../docs/history/HANDOFF_PLAN.md)），**`src/` 是经典查看器唯一的源**。`web/index.html` 和 `web/dev.html` 由构建生成，**不要手改**；`skill/assets/*.html`、`desktop/app/` 是 `web/` 的副本。

```bash
node tools/build.mjs            # src/ → web/index.html + web/dev.html
node tools/build.mjs --check    # CI：web/ 必须等于构建结果
node tools/sync-copies.mjs      # 构建 + 复制到 skill/assets/
node tools/check-copies.mjs     # 所有副本的 sha256 一致
cd desktop && node scripts/regress.mjs   # 回归（sync.js 会先构建）
```

## 怎样拼起来

- `index.html.tpl` 是页面骨架。每行 `<!-- @include 路径 -->` 换成 `src/路径` 的内容，**顺序就是代码顺序**。
- 所有脚本片段在生成的页面里**共用同一个 module 作用域**（和拆分前一样）：一个片段里声明的 `const` / `function` 其他片段直接可见，不需要 import。所以**大部分片段不是能单独运行的模块**，只是一段按顺序拼接的代码；`sim/processes/*.js` 甚至是同一个 `const PROCESSES = { … }` 对象字面量的连续几段（第一个文件开头 `const PROCESSES = {`，`cell-corner.js` 结尾 `};`）。
- 两个片段同时是**真正的 ES 模块**，Node 可以直接 import（工坊工具和以后的单元测试用）：
  - `data/presets.js`：内置预设（纯数据）、`PRESET_META`、`presetName`、`presetCat`；
  - `pack/rules.js`：场景包格式和校验（`sanitizePack`、`checkAnimation`、`PackError`…），`workshop/tools/glow-lib.mjs` 直接 import 它。
- 构建对 `.js` 片段只做三件事：删掉相对路径的 `import … from './x.js'` 行、删掉行首的 `export `、删掉 `//!` 开头的注释行（只写给读源码的人）。不允许 `export default` / `export { … }`。
- `src/` 里每个 `.js` / `.css` 都必须被模板引用，否则构建报错（防止漏掉代码）。
- 生成物保留 importmap / CDN 方式加载 Three.js，双击 `web/index.html` 照样能用。

WP1 第一步只**搬移**、不改逻辑：构建结果与拆分前的 `web/index.html` 逐字节相同，唯一的差别是 `presetCat` 一行从界面接线移到了 `data/presets.js`（让 Node 能 import）。后续工作包（WP2 起）再把片段逐步变成真正的模块（`SceneSession`、`StructureModel`、`SimulationEngine`…）。

## 目录（按模板顺序）

| 目录 | 内容 | 片段 |
|---|---|---|
| `styles/` | 全部 CSS | `viewer.css` |
| `ui/body.html` | 面板、标题、按钮等 DOM | |
| `core/` | 启动和场景生命周期 | `boot.js`（Three.js import、随机种子）、`utils.js`、`session.js`（WP2：`ResourceRegistry` / `SceneSession` / `LoadCoordinator`，全局 `loads`）、`state.js`（场景全局状态）、`load-guard.js`（`loadSeq` / `Stale`）、`load-scene.js`（`loadScene`：先下载、再 `loads.commit` 换场景、再构建）、`clear-scene.js`（`clearScene` = `loads.clear()`，内容由 `clearSceneContent` 释放）、`start.js`（URL 参数、首个场景、`__viewer` 诊断）、`open-ws.js`（`?ws=`） |
| `data/` | 数据：预设、解析、下载 | `presets.js`、`parse.js`（mmCIF / PDB）、`rcsb.js`（下载、缓存、CCD、UniProt）、`extra-entries.js`（场景里的其他 PDB 条目） |
| `derived/` | 由坐标推导的结果 | `geometry.js`、`partition.js`（功能分区）、`selection.js`（选择集）、`tunnel.js`（孔道）、`pocket.js`（口袋表面 Worker）、`selection-language.js`（`parseSel` / `evalSel`） |
| `repr/` | 表示 | `palettes.js`、`materials.js`、`cartoon.js`、`simplified.js`、`illustration.js`（白底墨线示意图）、`molecules.js`（小分子）、`crowding.js`（拥挤背景）、`rebuild.js`（重建网格 / 配体、上色）、`membrane.js` |
| `view/` | 渲染和镜头 | `renderer.js`（渲染器、灯光、后处理）、`tags.js`（3D 文字标签）、`placement.js`、`camera.js`、`frame-loop.js` |
| `sim/` | 模拟 | `anim-runner.js`、`motion-kit.js`（池、布朗路径、粒子流）、`translation-constants.js`、`processes/*.js`（ATP 合酶、鞭毛马达、呼吸链、叶绿体、翻译、KcsA、细胞一角、自动模式、整个细胞）、`cell-kinetics.js`（区室动力学）、`context.js`（`makeCtx`、时间尺度）、`data-anim.js`（场景包纯数据动画） |
| `pack/` | 场景包与工坊 | `rules.js`（格式与校验）、`pack-io.js`（包 ↔ 场景、快照、导入导出）、`workshop.js`（工坊目录、订阅） |
| `ui/` | 界面 | `labels.js`、`sequence-bar.js`、`take-apart.js`（拆装）、`evidence.js`（证据等级）、`legend.js`、`ligand-focus.js`（小分子聚焦）、`energy-strip.js`、`controls.js`（面板接线、模式选项卡） |
| `api/` | 命令接口 `window.glow` | `head.js`、`helpers.js`、`commands.js`（`GLOW_CMDS`）、`measure.js`、`run.js`（队列、日志）、`bridge.js`（postMessage 桥） |
| `dev.html` | 开发者 / AI 工作台（独立页面，原样复制到 `web/dev.html`） | |

## 改代码的规则

1. 只改 `src/`，然后 `node tools/build.mjs`，把 `src/` 和 `web/` 一起提交。
2. 新片段：放进对应目录，在 `index.html.tpl` 里按依赖顺序加一行 `<!-- @include … -->`。
3. 片段之间靠共享作用域互相引用，**顶层代码的执行顺序就是模板顺序**；挪动片段前确认它的顶层语句不依赖后面才声明的 `const` / `let`。
4. 多人开发时的目录归属见 HANDOFF_PLAN 第 6 节；`index.html.tpl`、`tools/build.mjs`、`ui/` 是共享文件，改之前在第 7 节登记。
