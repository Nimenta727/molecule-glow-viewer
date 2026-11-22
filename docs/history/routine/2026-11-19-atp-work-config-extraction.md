# 2026-11-19 — ATP 样板第 1 步：内容与算法分离

## 做了什么
- 先锁行为：用**未改动**的代码生成黄金输出（`plugins/atp-synthase/test/golden-default.json`：9 个时间点的快照、步骤、导航、保存状态），测试夹具抽成 `test/fixture.mjs`（可配置环亚基数与命名）。
- 新增 `plugins/atp-synthase/config.mjs`：带校验的作品配置 + 冻结的 `ATP_6ZPO_TEMPLATE`。内容（部件选择器、环亚基数、核苷酸残基名、5 步文案、导航标题、粒子名/颜色、计数/事件标签、面板与场景证据文字）全部来自配置。
- `index.mjs`：算法只读配置；H⁺ 数 = 检测到的环亚基数；`createAtpPlayer({config})` 缺省 = 6ZPO 模板，旧包不受影响。`main.mjs` 的场景证据文字改读模板。
- 数值基线：`tools/parity-numerics.mjs` 把 `config.mjs` 纳入受监控来源，用真实 6ZPO 夹具重新生成 `docs/parity/numerical-baseline.json`——**只有源码哈希变化，所有数值不变**。

## 验证
- 160 项 Node 测试通过（新增 5 项：黄金对照、c10 环复用、改名复用、文案由配置驱动、配置校验）；`check-feature-parity`、`check-docs`、`build --check` 通过。
- 浏览器（软件渲染 Chromium）载入官方 ATP 包，t=4 s：`ATP 3 · H⁺ 8`，与改动前一致。
- 未重跑 Electron 冒烟/安全用例，未在真实 GPU/EXE 验证。

## 边界
- 配置仍通过函数参数传入，尚未进入 `scene.tools[]`（需 schemaVersion 3）。
- 算法仍在 `plugins/atp-synthase`，尚未合并到 `plugins/motion`；催化位点数（3）和 5 阶段循环仍是算法常量。
- c10 环只用合成夹具验证了软件行为，**没有**验证其生物学正确性（不同物种的环对称性、每圈 H⁺/ATP 比需要专业确认）。

## 下一步
1. 对 KcsA、AdK 做同样的“黄金输出 + 配置抽取”（先 AdK：域范围/1AKE/Ap5A 抽到配置）。
2. schemaVersion 3：`resource` 一等引用 + `tools[]`，配置写进场景并随工程保存重开；旧 `legacy.scene.process` 映射到模板。
3. 机理镜头与粒子标签的前端打磨。
