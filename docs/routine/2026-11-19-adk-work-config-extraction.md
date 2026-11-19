# 2026-11-19 — AdK 样板：内容与算法分离

## 做了什么
- 先锁行为：测试夹具抽成 `test/fixture.mjs`，用**未改动**的代码生成黄金输出（`plugins/adenylate-kinase/test/golden-default.json`：RMSD、域测量、团块/功能分区装饰层摘要、1AKE 资产与字节、步骤/导航/证据、5 个时间点快照、闭合态与隐藏配体快照、保存状态）。
- 新增 `plugins/adenylate-kinase/config.mjs`：`ADK_4AKE_TEMPLATE` + `normalizeAdkConfig`。内容全部入配置：两端结构编号、链/物种/残基数/名称模式、域（名称、残基范围、颜色）、拟合域与 RMSD 上限、参考配体、4 步文案、导航标题、面板与证据文字。
- `structure.mjs`、`index.mjs`：`buildAdkStructure/prepareAdk/createAdkPlayer` 增加可选 `config`，缺省 = 模板（旧包不受影响）；“只测量非拟合域”“资产 id/路径随闭合态编号生成”等改为由配置推出。
- 共享校验 `plugins/shared/work-config.mjs`，ATP 配置改用它；`mechanism-catalog` 的 AdK 识别读模板里的结构编号。
- Viewer：默认表示按场景选择（`default-style.mjs`）：被识别为 AdK 两态构象或带 `core` 规则的场景默认“功能分区”（域叶片+墨线），其余“团块+墨线”。
- 数值基线：把 AdK 配置和共享校验纳入受监控来源，用真实 4AKE/1AKE/6ZPO 重新生成——**只有源码哈希变化，数值不变**。

## 验证
- 165 项 Node 测试通过（AdK 新增 4 项：黄金对照、合成铰链蛋白复用、配置校验、拟合上限；Viewer 新增默认样式测试）；`check-feature-parity`、`check-docs` 通过。
- 浏览器（软件渲染 Chromium）载入官方 AdK 包：CORE RMSD 1.975 Å，闭合端 NMP 44.8° / 9.8 Å、LID 52.2° / 14.4 Å；4AKE 与 1AKE 自动登记为资源；截图 `docs/images/showcase-adk-functional-1440.png`。
- 未重跑 Electron 冒烟/安全用例，未在真实 GPU/EXE 验证。黄金输出按浮点逐位比较，在不同 Node/平台上若出现极小浮点差异需改为容差比较。

## 边界
- 铰链蛋白只是软件行为验证，不代表任何真实蛋白的科学结论。
- 配置仍通过函数参数传入，尚未进入 `scene.tools[]`（待 schemaVersion 3）；算法仍在原目录，未合并到 `plugins/motion`。
- 仍保留的算法常量：4 步循环、振荡波形（0.35、保持端点 0.1/0.8）、域叶片收缩 1.5 Å。

## 下一步
1. KcsA 同样处理（结构态编号、通道链选择、位点、门控参数的内容/算法拆分；动力学模型留在算法里）。
2. 之后合并“叠合/对应/插值”为 `plugins/motion` 的共用工具，并评估 ATP/AdK 共用部分。
3. schemaVersion 3：`resource` 一等引用 + `tools[]`。
