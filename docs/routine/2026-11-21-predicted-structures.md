# 2026-11-21 · A1 预测结构资源（含逐残基着色）

## 做了什么

- **解析器读 B 因子**（PDB 第 61–66 列；mmCIF `B_iso_or_equiv`），原子多了 `bFactor`（数字或 null）。预测结构（AlphaFold 式）把每个残基的置信度 pLDDT 存在这一列。解析器还读 `_ma_qa_metric`：文件声明了 pLDDT 就标 `confidenceMetric`——**按文件内容识别，不按文件名猜**。
- **资源类型 `predicted-structure`**（`packages/schema/resource.mjs`）：必须带 `prediction`（方法、可选模型、置信度度量 pLDDT 存在 B 因子里），别的类型不许带；`describePredictedStructure`、`predictionEvidence`（一条“建模”类证据，写明“预测的结构，不是实验测定的”）。导入时文件声明了 pLDDT，资源就登记为预测结构；授权没人声明时为 `unknown` 且不许嵌入。
- **发布检查**：作品里有预测结构资源，就必须有一条 `type: modelled`、`resourceId` 指向它的证据，否则报错 `prediction-unlabelled`（预测不能被当成实验）。
- **置信度逻辑**（`plugins/structure/confidence.mjs`）：AlphaFold 数据库的四档（>90、>70、>50、其余）和颜色；`residueConfidence`（取 Cα 的值，只认 0–100）、`confidenceSummary`。
- **逐残基着色**（这也补上了 API 里原先搁置的“按残基范围上色”）：`color("chain A and resi 10-50", "#e05a4a")` 用选择语言按残基上色（最多 64 条，后面的覆盖前面的，随作品保存与重开）；`color("confidence")` 按置信度上色，只对登记为预测结构的资源有效，对实验结构会明确拒绝；看不懂或选不到残基的表达式拒绝并说明。画法：视图层把“团块”的球层按颜色拆开（一个残基一个球）。
- 测试 +17 项；真实浏览器 `node tools/confidence-check.cjs`。

## 验证（含合成数据的声明）

- AlphaFold 数据库（alphafold.ebi.ac.uk）在本环境被代理拦截（403），**拿不到真实的 AlphaFold 条目**。所以浏览器检查用的是**合成**的预测文件：4AKE A 链真实的 214 个 Cα 坐标，写成声明了 pLDDT 的 mmCIF，置信度是我编的（1–20 很低、21–60 较高、61–150 非常高、151–190 较低、其后较高）。这只验证软件行为，对任何真实预测都不说明什么。
- 结果：文件被识别为 `predicted-structure`；`color('confidence')` 画出四档（深蓝/浅蓝/黄/橙，截图 `docs/images/confidence-coloring.png`）；`color('chain A and resi 30-59', 红)` 恰好 30 个残基、层数增加，`reset` 还原；实验结构（4AKE）拒绝 `confidence` 并说明原因；保存并重开后方案仍在；无脚本错误。

## 如实说明

- 逐残基颜色**只有“团块”表示能画出**；卡通、骨架、表面仍显示链的颜色（命令回包里会说明）；
- 带构象插值（两态形变）的球层不拆分；
- 实例化（B1）复制出的副本取的是当时画面上的颜色，之后改颜色不会同步；
- AlphaFold 数据库的授权（我理解为 CC BY 4.0）没有核对过，`describePredictedStructure` 要求调用者写明授权，不替人默认；
- 预测结构的置信度只有 pLDDT 一种，没有 PAE（预测对齐误差）。

## 下一步

A4 外部数据源客户端会用 `describePredictedStructure` 登记取回的 AlphaFold 条目（在线取回在这里验证不了，只能用注入的取回函数做单测）。
