# 2026-11-20 — 4.4.0g 自动介绍（PDB 条目简介卡）

## 做了什么
- **数据与来源** `plugins/structure/entry-intro.mjs`：只用权威记录回答“这是什么结构”——RCSB PDB（标题、实验方法、分辨率、发布日期、关键词、来源物种、**替换/突变**（RCSB 的 `pdbx_mutation`，如 KcsA 的 `P2A, L90C`）、主要文献（含 DOI、PubMed）、每个实体的描述/份数/UniProt 编号、注释）和 UniProt（功能原文）。**每一项都带来源**；记录里没有的字段（例如 NMR 条目没有分辨率、没有文献）写成“不可用”，并列在 `missing` 里，**不推断、不凭印象补写**。注释里的 HTML 标签会被去掉；全大写的标题只在显示时转成句首大写，原值不改。条目号先校验是 PDB 编号格式再拼进查询。联网函数是注入的，所以可离线测试。
- **功能原文挑选**沿用经典规则：最大的实体优先，T4 溶菌酶/BRIL/MBP 这类结晶融合伙伴排最后，最多读 2 个；UniProt 读取失败只给警告，RCSB 部分照常显示。
- **Viewer**：面板里“自动简介”按钮（只对来自 RCSB 的 PDB 条目；本地文件明确提示“只有 PDB 条目才能读取自动简介”；20 秒超时）。卡片全部用 DOM 文本构造（没有拼 HTML 字符串），链接只指向 doi.org、PubMed、UniProt。小分子/离子做成按钮，点击在 3D 中选中该小分子（走选择语言，其余部件淡化）。换场景/关闭会清空卡片。

## 怎么验证的
- 单元测试 6 项，用**真实录制的响应**做离线夹具（4AKE、1K4C 的 RCSB 条目信息和 P69441、P0A334 的 UniProt 功能）：来源/物种/突变/文献、字段缺失时的“不可用”、功能原文挑选顺序、证据标记清理、读取失败的降级、非法条目号。
- **与经典卡片对照**（`tools/intro-parity.mjs`，报告 `docs/parity/intro-parity-report.txt`）：把同样的响应喂给**原样运行的经典 `showAutoCard`**（用桩页面接住它的输出），比较标题、来源行（编号·方法·分辨率·物种）、关键词、文献（标题/期刊年份/DOI）、注释（家族与 GO）、UniProt 功能（名称、基因、登录号、原文、520 字截断）和被选中的实体，**14/14 一致**。
- 联网浏览器实测（软件渲染，无页面错误）：1K4C → 物种“Streptomyces lividans、Mus musculus”、突变“potassium channel KcsA：P2A, L90C”、文献 DOI/PubMed 链接、三个实体各带 UniProt 链接、小分子 F09/K/DGA 按钮（点 F09 在 3D 选中）、两段 UniProt 功能原文（轻链 P01837 UniProt 没有功能注释，如实显示）；4AKE → 对应内容；本地文件被拒绝。截图 `docs/images/entry-introduction.png`。

## 需要你知道的
- 经典的“自动模式”还包括**自动找膜并放上脂双层、找贯穿膜的孔道**；那是验收清单里单独的一项（`structure.auto-membrane`），这次没做。所以 `structure.auto-introduction` 只覆盖简介卡，仍标 partial。
- 只支持有 RCSB 记录的 PDB 条目；AlphaFold、只有 UniProt 的结构、本地文件暂不支持。“替换/突变”目前只取 RCSB 的 `pdbx_mutation` 字段，没有对照序列自己去算。
- 联网读取在桌面版依赖网络策略（经典版已在用同样的两个主机）；没在真实 GPU/EXE 上验证。

## 下一步
1. 4.4.0 余下：CCD/键级、剖切（`structure.representations-clipping` / `structure.ligand-analysis`）。
2. 选择集驱动“按选择换表示/着色”。
3. 之后进入 4.4.1 构象与对象动画；`structure.auto-membrane` 并入 4.4.6 环境与多尺度。
