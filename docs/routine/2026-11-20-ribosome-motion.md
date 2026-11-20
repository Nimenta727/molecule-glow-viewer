# 2026-11-20 4.4.8 翻译作品里 tRNA/mRNA 在 70S 里的运动（第一部分）

## 做了什么
翻译作品此前只有随机过程的状态、曲线和肽链条；结构里的 tRNA/mRNA 是静止的。现在 4V6F 核糖体里的 tRNA 和 mRNA 随翻译过程的状态移动：tRNA 进 A 位、被容纳、肽键形成后进入杂合态（受体臂先动）、移位（P→E、A→P，mRNA 前移 3 nt）、E 位 tRNA 离开、终止与回收时清空；每个残基画成一颗珠，静态的 tRNA/mRNA 部件在运行期间隐藏。

## 改动
- `plugins/simulation/ribosome-motion.mjs`（新，纯逻辑）：`ribosomeFrame`（经典 `setup` 的算法：mRNA 按序号排序，tRNA 链按反密码子在 mRNA 上的位置排成 E/P/A，P 位 tRNA 为模板，用 Horn 叠合求三个位点的刚体位姿）、`trnaCoords`（两位姿之间的插值，受体臂权重）、`mrnaCoords`、`RibosomeMotion`（按离散状态变化启动对应的运动与补间；高速时直接到位）。
- `plugins/structure/alignment.mjs`：新增 `superposeFit`（暴露旋转四元数与两个质心），`superpose` 行为不变；因此重跑了数值基线（只有该源文件的哈希变了，结果不变）。
- `apps/viewer-web/ribosome-view.mjs`（新）与 `main.mjs`：读翻译过程的状态（`st`、E 位是否占据），用粒子云画 tRNA/mRNA 珠，隐藏结构里原有的 tRNA/mRNA 部件，工具停用/重置/换作品时恢复。
- 文档：`feature-parity.json`。

## 验证
- **真实 4V6F 对经典**（`tools/ribosome-parity.mjs`，经典 `setup` 的位姿段原样在 vm 里运行）：mRNA 点数与 P 位密码子位置（第 32 点）、模板 tRNA（74 个残基）的中心与受体臂权重、E/P/A 三个位点的旋转与平移（1e-9 内）、受体端落点——8/8。报告 `docs/parity/ribosome-parity-report.txt`。注意 4V6F 有两个核糖体（6 条 tRNA）；两边按同一规则取反密码子在 mRNA 上位置最靠前的三条。
- 单测（4 个，合成核糖体）：位点恢复、受体臂先动、slerp、mRNA 前移、一个完整延伸循环（进 A→容纳→杂合→移位后 P/E 各就位）、被甩出、终止清空、高速直接到位。
- 过程中发现并修复：`switch (true)` 里写 `… && 对象` 永远不会匹配（严格相等），已改成布尔值。

## 没有做（经典里仍是它自己的实体）
- A/T 弯曲 tRNA 的形状（需要 4V5L）、EF-Tu 及其 GTP→GDP 的域转动、EF-G（中间态 4V9H、移位后 4V5F）、RF1（4V7P）、各抗生素在晶体位点（4V9A、4V51、6ND5、6XHX、4V5P）：它们要从其它 PDB 下载并按 rRNA 叠合。
- 新生肽链与出口通道、原子级特写。
- 运动用真实时间（补间），不是经典的"分子时间冻结"；过程里事件很快时，中间状态会被跳过。
- 浏览器里没有看。
