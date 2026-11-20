# 2026-11-20 — 4.4.0a 完整选择语言与选择集

## 做了什么
- **新插件模块** `plugins/structure/selection.mjs`：把经典 `selection-language.js` 的语法搬到新结构模型上——`all/none/protein/nucleic/ligands/sele`、`chain`、`asym`、`label_asym`、`label_seq`、`resn`、`resi`（支持负号、插入码 `52A`、区间 `52A-60`）、`ligand`、`entity`、`within d of …`，以及 `and/or/not` 和括号。报错仍是中文，并带语法提示。结果是**整个**匹配集合（残基点 + 小分子），而不是原来 `glow.select` 的“只高亮第一个”。
- **接入 Viewer**：结构服务新增 `selectExpression`；视口新增 `setPointSelections`（一次给所有选中点画金色线框，用实例化网格，选几千个也不卡）；`glow.select("chain A and resi 10-50")` 这类字符串走新语言，返回 `{residues, ligands, marked, summary}`；旧的 `chain A`、`resid 8`、对象写法保持不变。面板里新增“选择语言”输入框（选择/清除/语法提示）。`sele` 指上一次的选择。
- 顺手把 `isPolymer` 导出供选择模块复用；重新生成了数值基线（只是 `representation.mjs` 的源码哈希变了）。

## 怎么验证的
- 单元测试 5 项（合成 PDB：残基/小分子枚举、水排除、插入码区间、布尔/括号/`sele`/`within`、错误信息）；全套 235+5 项 Node 测试通过。
- **与经典代码差分对照**（`tools/selection-parity.mjs`，报告 `docs/parity/selection-parity-report.txt`）：同一批 29 条表达式在 8 个真实结构（1AKE/1K4C/2HVK/2ITD/4AKE/5VK6/5VKE/6ZPO）上，经典与新版选出的残基、小分子**逐条一致，216/216**。唯一没比的是 `entity "…"`：经典的实体名要靠运行中的界面填充，脱离界面是空的；新版直接读结构里的链名，由单元测试覆盖。
- 浏览器实测（软件渲染 Chromium，无页面错误）：载入 4AKE，`chain A and resi 10-40` 选中 31 个残基并标出 31 个；`within 6 of resn ARG and chain A` 58 个；`sele and protein` 沿用上一次结果；非法表达式给出中文报错。截图 `docs/images/selection-language-viewer.png`。

## 需要你知道的
- 这一步只完成“语言 + 整集高亮”。**未选部分淡化**、**序列条联动**、按选择换表示/着色、以及团块表示里被球体遮住的标记（金框是画在最上层的，但比大球小）都还没做，`docs/feature-parity.json` 里该项仍是 partial / parity pending。
- 没在真实 GPU 上看过；Studio 里的选择语言入口还没有。

## 下一步
1. 4.4.0b：序列条（`structure.sequence`）——按链列出残基，点击与选择集双向联动，顺带做“未选中淡化”。
2. 把选择集作为输入，接到“按选择换表示/着色”和后面的测量、口袋工具。
3. 之后继续 4.4.0 的拆开/界面、自动介绍，再到 4.4.1 起的构象动画包。
