# 分子光影查看器 · Molecule Glow Viewer

实时、可从任意角度旋转的蛋白质 / 分子机器 3D 查看器，风格类似科普视频里的分子动画：黑背景、饱和配色、柔和辉光、剖开的脂双层膜、转动的转子，以及能看到的小分子相互作用。
**一个 HTML 文件**，不需要安装，任何 PDB 编号都直接从 [RCSB PDB](https://www.rcsb.org) 实时下载。

A single-file, real-time Three.js viewer for proteins, molecular machines and their small molecules, with interaction animations and a teaching mode. Structures are downloaded live from the RCSB PDB.

![ATP 合酶](docs/images/example_atp_synthase.jpg)

## 功能
- **三种显示模式**
  - 团块（写实）：每个残基一颗发光团块。
  - 结构示意：α 螺旋、β 折叠箭头、卷曲细管。二级结构取自作者沉积的 PDB 注释（`_struct_conf` / `_struct_sheet_range`）。
  - 简化示意（每个部件可单独勾选）：**按功能分区**——功能核心（小分子 8 Å 内的结合口袋、离子通道过滤器、质子传递界面）保留原子细节并按化学性质着色；会转动或变构的部件画成由真实坐标算出的低分辨率密度形状，随构象一起动，环状寡聚体每个亚基一节；支架和辅助亚基淡化成半透明。离子通道会自动淡化朝向镜头的亚基，露出孔道。DNA 画成沿双螺旋轴的管。另有插画画风（浅底平涂 + 描边），带部件标注和点击讲解。
- **小分子聚焦**：点击图例里小分子旁的 ⌖，镜头飞到结合位点，下载位点全原子坐标，画出氢键、盐桥、金属配位、疏水接触（虚线 + 距离），列出接触残基，并从两种构象算出各结构域的转角（例如腺苷酸激酶 LID 闭合约 52°）。
- **点哪里讲哪里**：在 3D 场景里点任意残基或部件，它会高亮、其余淡化、镜头平滑飞过去，信息卡说明它是什么（残基用文献编号，附化学性质、离小分子的距离、属于功能核心还是支架）；点小分子直接进入结合位点。按 Esc 取消。
- **口袋表面**：聚焦小分子时，在后台线程（Web Worker）计算结合口袋的分子表面，按残基化学性质着色。
- **能量转化条**：点某一步会高亮这一步涉及的结构；打开“◎ 跟随”后，播放到哪一步就自动高亮哪一步。随动画高亮当前步骤（例如 ATP 合酶：质子动力势 → c 环扭矩 → γ 旋转 → β 构象变化 → 释放 ATP），点击看解释。
- **相互作用动画**
  - ATP 合酶（6ZPO）：H⁺ 驱动 c 环转动；三条 β 链按真实构象依次经历开放 → 松弛 → 紧密；ATP/ADP/Pi/Mg²⁺ 的位置取自晶体结构，并随口袋开合移动（Boyer 结合变构机制）。
  - 鞭毛马达：H⁺ 经定子驱动转子。
  - KcsA 钾通道：K⁺ 通过选择性过滤器。
  - 腺苷酸激酶：在两个构象之间开合。
- **小分子**：用化学组分字典（CCD）的理想构型画成真实的球棍模型。
- **剖开与膜**：剖开的楔形固定在模型上，旋转时结构不会闪烁或消失；脂双层可剖开。
- **本地文件**：可拖入 .cif/.pdb（AlphaFold、自建模型）。
- **自动画质**：按显卡自动选择画质，没有独立显卡也能运行。

## 使用
双击 `index.html`（Chrome / Edge 最新版）。若浏览器拦截本地文件的网络请求：
```bash
python -m http.server 8765
```
然后打开 `http://localhost:8765/index.html`。网址参数：`?pdb=4HHB`、`?preset=鞭毛马达`、`&q=low|medium|high`。

需要能访问 `models.rcsb.org`、`data.rcsb.org`、`files.rcsb.org`、`cdn.jsdelivr.net`。

## 给 AI 的 skill
`skill/` 是一个 Claude Code skill（`SKILL.md` + `references/`），说明如何添加预设、编写过程动画、从论文做动画、从零重建，以及如何调试。
复制到 `~/.claude/skills/molecule-glow-viewer/` 即可使用。

## 数据来源与引用
所有结构数据来自 RCSB PDB，使用时请引用 PDB 以及各结构的原始论文：
- Berman, H. M. et al. (2000) The Protein Data Bank. *Nucleic Acids Res.* 28, 235–242.
- Burley, S. K. et al. (2023) RCSB Protein Data Bank (RCSB.org). *Nucleic Acids Res.* 51, D488–D508.

预设中使用的条目（原始论文以各条目 RCSB 页面上的 Primary Citation 为准）：

| 预设 | PDB | 原始论文 |
|---|---|---|
| ATP 合酶 | 6ZPO | Spikes, Montgomery & Walker (2020) *PNAS* 117, 23519 |
| 鞭毛马达 | 7CGO | Tan et al. (2021) *Cell* 184, 2665 |
| 鞭毛马达 C 环 | 8YJT | Tan, Zhang, Zhou et al. (2024) *Cell Res.* 34, 788 |
| 鞭毛马达定子 | 6YKM | Santiveri et al. (2020) *Cell* 183, 244 |
| 鞭毛丝 | 1UCU | Yonekura, Maki-Yonekura & Namba (2003) *Nature* 424, 643 |
| 钾通道 KcsA | 1BL8 | Doyle et al. (1998) *Science* 280, 69 |
| 腺苷酸激酶 | 4AKE / 1AKE | Müller et al. (1996) *Structure* 4, 147；Müller & Schulz (1992) *J. Mol. Biol.* 224, 159 |
| GroEL–GroES | 1AON | Xu, Horwich & Sigler (1997) *Nature* 388, 741 |
| 核糖体 | 4YBB | Noeske et al. (2015) *Nat. Struct. Mol. Biol.* 22, 336 |
| 核小体 | 1KX5 | Davey et al. (2002) *J. Mol. Biol.* 319, 1097 |
| 20S 蛋白酶体 | 5LE5 | Schrader et al. (2016) *Science* 353, 594 |
| HK97 衣壳 | 2FT1 | Gan et al. (2006) *Structure* 14, 1655 |

机制参考：
- Boyer, P. D. (1997) The ATP synthase — a splendid molecular machine. *Annu. Rev. Biochem.* 66, 717.
- Abrahams, J. P. et al. (1994) Structure at 2.8 Å resolution of F1-ATPase from bovine heart mitochondria. *Nature* 370, 621.

动画中的时序、粒子路径和小分子放大比例是**示意**，用于教学，不代表定量动力学。

## 技术
[Three.js](https://threejs.org) r160（MIT），通过 jsDelivr 加载。所有几何体都在浏览器中实时生成，仓库内不含结构数据。

## 许可证
MIT，见 [LICENSE](LICENSE)。PDB 数据本身属于公共领域（CC0），但仍请按上文引用。
