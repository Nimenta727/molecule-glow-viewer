# 2026-11-19 — KcsA 样板：内容与算法分离

## 做了什么
- 先锁行为：新造合成“四聚体钾通道”夹具（`test/fixture.mjs`：四条链、过滤器 K⁺ 位点与中央腔离子、开放/失活/阻断剂状态，可重新编号命名），用**未改动**代码生成黄金输出（`test/golden-default.json`：5 个叠合 RMSD/顺序、位点、两条孔道路径、阻断剂、轴线、装饰层摘要、步骤/导航/证据、6 个时间点快照、改参后快照、保存/恢复、准备阶段资产）。
- 新增 `plugins/kcsa/config.mjs`：`KCSA_1K4C_TEMPLATE` + `normalizeKcsaConfig`。内容入配置：五个状态编号与角色、通道名称模式与链数、孔区叠合范围/最小配对数/RMSD 上限、过滤器残基与离子、阻断剂残基/名称/颜色、粒子与计数标签、膜半径、**初始实验条件**（经 `validateParameters` 校验）、6 步文案、导航、面板与证据文字。
- `structure.mjs`、`index.mjs`：`fitState/buildKcsaStructure/prepareKcsa/createKcsaPlayer` 增加可选 `config`，缺省 = 模板；`kinetics.mjs`（门控动力学模型）**未改动**，仍按契约留在算法层。缺少构象结构时新增明确报错（原来是难懂的空值错误）。
- 数值基线：把 `plugins/kcsa/config.mjs` 纳入受监控来源并重新生成——只有源码哈希变化，数值不变。

## 验证
- 171 项 Node 测试通过（KcsA 新增 6 项：黄金对照、另一通道仅改配置复用、初始条件、准备阶段按配置取结构、配置校验、叠合上限）。
- **真实数据新旧对照**：取改动前代码与新代码，对真实 1K4C/5VK6/5VKE/2HVK/2ITD 跑同样的计算，孔区 RMSD（0.428/0.666/0.080/0.247 Å）、离子位点、两条孔道路径（16/10 点）、阻断剂、轴线、中心逐项一致。
- 浏览器（软件渲染 Chromium）载入官方 KcsA 包，t=60 s、种子 7：`K⁺ 外流 37 · K⁺ 内流 8 · Na⁺ 排斥 1`，E_K −85.6 mV，五个结构自动登记为资源；截图 `docs/images/showcase-kcsa-1440.png`。
- `check-feature-parity`、`check-docs` 通过。未重跑 Electron 冒烟/安全用例，未在真实 GPU/EXE 验证。

## 边界
- 合成钾通道只验证软件行为，不代表任何真实通道的科学结论；另一通道的残基编号、过滤器位置、阻断剂是否适用，需要专业确认。
- 配置仍通过函数参数传入，尚未进入 `scene.tools[]`（待 schemaVersion 3）；算法仍在各自目录。
- 算法层保留的常量：S0–S4 位点命名与四态敲击表、孔道搜索网格参数、状态 C/O/I 与构象权重的对应。

## 下一步
1. 合并共用算法：把“残基对应 → 叠合 → 按残基位移插值”从 ATP/AdK/KcsA 抽成 `plugins/motion` 的同一工具，三个样板改为调用它（黄金输出与真实数据对照继续把关）。
2. schemaVersion 3：`resource` 一等引用 + `tools[]`，配置随场景保存重开；旧 `legacy.scene.process` 映射到各模板。
3. 机理镜头与粒子标签白框的前端打磨；Studio 面板结构（依赖工具协议）。
