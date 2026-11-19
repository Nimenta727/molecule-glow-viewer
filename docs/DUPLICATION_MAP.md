# 经典与新版重复实现清单

更新：2026-11-19，基于 `4e4b620`。本表是静态定位和已知差异清单，不表示已完成合并或等价验证。执行顺序见 [迁移计划](history/MIGRATION_EXECUTION_PLAN.md)。

Codex 迁移时优先复用新平台已有服务，记录必须暂存的经典/新版两套实现与差异，避免第三份实现；必要的模块拆分随功能交付。全面合并两套前端的状态/渲染及最终去重按交接由 Claude 收尾，安全缺陷和发布阻断立即修复。

| 功能 | 经典位置 | 新位置 | 是否等价 / 后续动作 |
|---|---|---|---|
| RCSB 下载、缓存、错误处理 | `src/data/rcsb.js`、`desktop/main.js` | `plugins/rcsb/index.mjs` | 不等价；插件有限流/容量保护，4.1 Shell 已改为 30 MiB 限量流式缓存和原子提交；浏览器插件与 Shell 各承担请求/缓存层，统一策略仍需按环境对照 |
| PDB/mmCIF 解析与身份 | `src/data/parse.js` | `plugins/structure/parser.mjs` | 部分覆盖；当前有 auth/label、插入码、模型及 altLoc 测试，需经典同文件对照 |
| 生物组装体展开 | `src/data/rcsb.js` | `plugins/structure/assembly.mjs` | 部分覆盖；操作符、链与副本已有测试，需完整经典样例对照 |
| 构象叠合 | `src/derived/geometry.js` | `plugins/structure/alignment.mjs` | 同类 Horn 方法；已用于 ATP/KcsA/AdK，不意味着所有拟合策略相同；AdK 改以 CORE 作显示参考 |
| 布局、方向、镜头 | `src/view/placement.js`、`src/view/camera.js`、`src/core/load-scene.js` | `apps/viewer-web/legacy-layout.mjs`、`packages/render-three/viewport.mjs` | 旧布局与镜头部分移植；完整跨尺度/导航/选择状态对照待补 |
| cartoon | `src/repr/cartoon.js` | `plugins/structure/representation.mjs` | 部分接入；用同一坐标比二级结构、缺失残基与构象变形 |
| 密度表面 / 功能表示 | `src/repr/illustration.js`、`src/repr/simplified.js`、`src/derived/partition.js` | `plugins/structure/density-surface.mjs`、`plugins/structure/functional-preview.mjs`、AdK `structure.mjs` | 已移植密度方法和部分功能规则；整套视觉/剖切与通用域划分未等价 |
| 渲染和生命周期 | `src/view/renderer.js`、`src/view/frame-loop.js`、`src/repr/rebuild.js` | `packages/render-three/viewport.mjs`、`packages/core/lifecycle.mjs` | 两套视口仍独立；当前通过适配层迁移，不再新增会话状态源 |
| 选择与选择语言 | `src/derived/selection.js`、`src/derived/selection-language.js` | `plugins/structure/representation.mjs`、`apps/viewer-web/viewer-commands.mjs` | 不等价；新版基础查询/首个高亮已接入，完整集合、表达式及淡化待迁移 |
| 配体、域运动与相互作用 | `src/ui/ligand-focus.js`、`src/repr/molecules.js` | `plugins/structure/representation.mjs`、`plugins/adenylate-kinase/structure.mjs` | 部分接入；基础接触和 AdK 特定域测量，不替代 CCD/键级/口袋/通用分析 |
| ATP 合酶 | `src/sim/processes/atp-synthase.js` | `plugins/atp-synthase/index.mjs` | 主要教学机制接入；计量、坐标和确定性有实测，完整经典参数/事件/交互对照仍待补 |
| KcsA 模型、孔道与显示 | `src/sim/processes/kcsa.js`、`src/derived/tunnel.js` | `plugins/kcsa/{index,kinetics,structure}.mjs` | 不完全等价；速率移植，但新版粒子插值不阻塞时钟；补经典数值表、区室、水合与曲线 |
| AdK 两态开合与域角度 | `src/core/load-scene.js`、`src/view/frame-loop.js`、`src/ui/ligand-focus.js`、`src/data/presets.js` | `plugins/adenylate-kinase/{index,playback,structure}.mjs` | 部分接入；CORE 对齐、三域表示和两态控制已做；纯数据催化反应与通用分析未迁移 |
| 纯数据动画、区室动力学 | `src/sim/data-anim.js`、`src/sim/cell-kinetics.js` | 尚无等价通用插件 | 待迁移；复用共享时钟/场景/资源接口，避免给每个包再写独立播放器 |
| 场景包与状态持久化 | `src/pack/`、`src/api/run.js` | `packages/legacy-compat/`、`packages/schema/`、`packages/core/` | 格式及状态模型不同；v1 保留＋v2 ZIP 校验已实现，完整行为及状态恢复逐项对照 |
| 命令和嵌入桥 | `src/api/` | `apps/viewer-web/command-api.mjs`、`apps/viewer-web/viewer-commands.mjs` | 部分兼容；4.1 两代共用分级授权且控制回包脱敏，完整命令参数/回包及工作台适配仍待做 |

后续新增迁移必须补本表与 [功能对照清单](feature-parity.json)。仅规划的新位置要写“待迁移”，不能列成已存在实现；“是否等价”必须能链接到对照证据后再改为通过。

## P0 模块调整（384cdcf）

桌面开发入口与打包入口共用 `desktop/platform-shell.cjs` 的路由、默认经典入口、菜单和版本信息；打包脚本不再通过字符串替换制造第二份 Shell 业务逻辑。可选验收逻辑拆到 `desktop/smoke-runner.cjs`，普通运行不启用测试注入。科学与渲染双实现仍按上表待对照。[P0 实测记录](history/RELEASE_VALIDATION_2026-11-19.md)记录真实产物结果。

## 4.1 安全模块调整（01c8dae）

经典与新版共同使用 `src/api/embed-permissions.js` 的许可控制；经典将它内联进单文件，新版按模块导入，桌面复制相同源文件。两代命令队列只增加执行/返回前授权钩子，不复制另一套许可决策。Shell 缓存统一在 `desktop/response-cache.cjs` 流式限量处理，`desktop/network-policy.cjs` 统一导航/重定向/弹窗规则；前端解析器和科学模型仍按既有清单待对照。见 [4.1 安全验收](history/SECURITY_REMEDIATION_2026-11-19.md)。

## 4.2 对照与适配边界

- `apps/viewer-web/mechanism-runtime.mjs` 从入口拆出机制解析、prepare/create 和预览降级适配，直接使用原 loaded、资源映射与播放器句柄，不建立另一份时钟或场景状态。新增取消后准备结果禁止提交的检查。
- [数值基线](parity/README.md)直接执行经典函数和现有插件，不拷贝第三套动力学公式。KcsA 解析速率/电流、AdK CORE 相对端点及 ATP 质子账本已有比较；完整事件、时钟/随机和视觉差异保持待验收。
- [科学卡](science/README.md)的唯一正文位于各官方机制插件内，结构查询摘要集中保存；打包目录缺卡也会失败。全面状态/渲染合并仍由后续交接处理。
