# 分子光影查看器 · Molecule Glow Viewer

实时、可从任意角度旋转的蛋白质 / 分子机器 3D 查看器：白底墨线的插画风格，剖开的脂双层膜、转动的转子、从溶液里扩散过来的小分子和离子，从单个蛋白一直到整个细胞。任何 PDB 编号都直接从 [RCSB PDB](https://www.rcsb.org) 实时下载。

A single-file, real-time Three.js viewer for proteins, molecular machines and their small molecules, with interaction animations and a teaching mode. Structures are downloaded live from the RCSB PDB.

![ATP 合酶](docs/images/example_atp_synthase.jpg)

## 三个部分
| 目录 | 是什么 | 给谁 |
|---|---|---|
| [`web/`](web/) | **网页版**：一个 HTML 文件，双击就能用；[在线版](https://nimenta727.github.io/molecule-glow-viewer/) | 想直接看的人 |
| [`desktop/`](desktop/) | **桌面版**：Windows exe，结构缓存在本地，断网也能看已经下载过的结构；以后会接入创意工坊。下载见 [Releases](https://github.com/Nimenta727/molecule-glow-viewer/releases) | 经常用、想离线用的人 |
| [`skill/`](skill/) | **制作 skill**：教人或 AI（Claude Code、ChatGPT……）怎样在这个查看器上做新的结构、机制动画和模拟 | 想自己做场景的人 |
| [`workshop/`](workshop/) | **创意工坊**：官方源和社区源的场景包（`.glow`）、格式说明、自动检查和投稿机器人 | 想分享场景的人 |

路线图和审计：[docs/ROADMAP.md](docs/ROADMAP.md)（目标：数据、可复现性和工程质量向 Mol\*、NGL、ChimeraX 看齐，同时保留教学上的高可见性和易读性）。

三者共用同一个查看器文件：`web/index.html` 是源头，桌面版打包它，skill 里的 `assets/viewer.html` 是它的副本。

## 功能
- **开发者 / AI 工作台**（[`web/dev.html`](web/dev.html)，[在线打开](https://nimenta727.github.io/molecule-glow-viewer/dev.html)）：左边编辑 `.glow` 场景包 JSON（模板、校验、预览、下载、投稿到工坊），右边是实时查看器；下面是命令台。查看器有稳定的命令接口 `window.glow`（`load`、`info`、`select`、`color`、`represent`、`camera`、`animate`、`measure`、`snapshot`、`exportPack`、`validatePack`…），也可以从别的网页用 `postMessage` 调用（`?embed=1` 嵌入）。选择语言：`chain A and resi 10-50`、`within 5 of ligand HEM`、`ligand ATP`。每条命令都记进日志，可以重放；`?seed=` 固定随机数，同一个种子动画完全一样。
- **证据等级**：标题下四个徽章——实验（PDB 原子坐标）、推算（由坐标或注释计算：简化外形、膜位置、朝向）、建模（构象插值、组装位置）、示意（动画粒子、计数、细胞里的分子摆放）。点一下列出这个场景里每一项属于哪一级，学生一眼分清“测的”和“画的”。
- **三种显示模式**
  - 团块（写实）：每个残基一颗发光团块。
  - 结构示意：α 螺旋、β 折叠箭头、卷曲细管。二级结构取自作者沉积的 PDB 注释（`_struct_conf` / `_struct_sheet_range`）。
  - 简化示意（每个部件可单独勾选）：**按功能分区**——功能核心（小分子 8 Å 内的结合口袋、离子通道过滤器、质子传递界面）保留原子细节并按化学性质着色；会转动或变构的部件画成由真实坐标算出的低分辨率密度形状，随构象一起动，环状寡聚体每个亚基一节；支架和辅助亚基淡化成半透明。离子通道会自动淡化朝向镜头的亚基，露出孔道。DNA 画成沿双螺旋轴的管。另有插画画风（浅底平涂 + 描边），带部件标注和点击讲解。
- **小分子聚焦**：点击图例里小分子旁的 ⌖，镜头飞到结合位点，下载位点全原子坐标，画出氢键、盐桥、金属配位、疏水接触（虚线 + 距离），列出接触残基，并从两种构象算出各结构域的转角（例如腺苷酸激酶 LID 闭合约 52°）。
- **点哪里讲哪里**：在 3D 场景里点任意残基或部件，它会高亮、其余淡化、镜头平滑飞过去，信息卡说明它是什么（残基用文献编号，附化学性质、离小分子的距离、属于功能核心还是支架）；点小分子直接进入结合位点。按 Esc 取消。
- **价键模型**：小分子可以画成球棍、价键（单键、双键、三键、芳香环，键级来自 RCSB 化学组分字典）或空间填充；聚焦时结合位点的残基也按同样的键级画。
- **线粒体呼吸链**：复合体 I、III、IV、细胞色素 c 和 ATP 合酶排在同一层膜上，电子沿真实结构里的铁硫簇、血红素、铜中心依次跳过，三个复合体泵出 H⁺，H⁺ 经 ATP 合酶回流合成 ATP，能量条讲清每一步的能量变化。
- **叶绿体光反应**：PSII、细胞色素 b6f、PSI 和 ATP 合酶排在类囊体膜上；光子激发 P680 和 P700，电子从水出发按 Z 方案经质体醌、质体蓝素、铁氧还蛋白到 FNR 生成 NADPH，水裂解放出 O₂，H⁺ 在类囊体腔累积后经 ATP 合酶回流合成 ATP。
- **核糖体翻译（实时模拟）**：大肠杆菌 70S 核糖体读 mRNA 合成蛋白质；tRNA 选择、校对、肽键形成、转位、终止都是按真实速率随机发生的事件，新生肽沿算出的出口隧道伸出去；可调 EF-Tu / EF-G / RF1 浓度，加四环素、巴龙霉素、氯霉素、红霉素、黄色霉素、夫西地酸，看翻译变慢、错读或卡住，每种抗生素都在晶体结构里的真实位置。
- **钾通道 KcsA（实时模拟）**：通道嵌在膜里，胞内 pH 打开门（关 / 开 / 失活三种真实构象之间变形），K⁺ 按敲击机制单列通过过滤器、沿真实孔道路径移动，Na⁺ 被排斥；可调膜电位和两侧浓度（电流在 E_K 反转），加 TBA 或 Ba²⁺ 看阻断。
- **创意工坊**：点“🧩 创意工坊”浏览官方和社区的场景，可以按细胞 / 局部系统 / 单个蛋白筛选、搜索、订阅（订阅的场景出现在预设里，有新版本自动更新）。任何场景都能“导出场景”成一个 `.glow` 文件分享，或者投稿到社区。社区场景只有数据：动画用“粒子从哪个隔室来、经过哪些位点、到哪里去、发生什么反应”描述，由查看器画出来，不运行任何代码。格式见 [workshop/SCHEMA.md](workshop/SCHEMA.md)。
- **不闪现、有名字**：H⁺、电子、光子、ATP、K⁺ 等每个粒子都标了名字，从周围溶液扩散过来、绕开蛋白，反应用文字标出；pH 是充满隔室的彩色体积。“时间尺度”快放看大量粒子流的方向，慢放看每一步。核糖体可以放大到解码中心和肽基转移中心的真实原子（密码子–反密码子氢键、A1492 / A1493 翻出）。
- **整个细胞**：一个大肠杆菌从 2 µm 一路缩放到原子——外膜、肽聚糖、内膜、拟核 DNA、2.5 万个核糖体、鞭毛；放大到一角能看到按丰度挤满的胞质和真实定向的膜蛋白（ATP 合酶、AcrB、OmpF 等），再放大就是正在工作的核糖体和钾通道。左面板分成“细胞 / 局部系统 / 单个蛋白”三个选项卡。
- **任意结构自动讲解**：输入任何不在预设里的 PDB 编号，自动判断是不是膜蛋白（RCSB 的 OPM / PDBTM 跨膜注释），把膜法线转成竖直、放上脂双层，按 UniProt 拓扑把胞质侧放在下面；沿中央轴或每个亚基搜贯穿膜的孔道，按宽窄着色并标出最窄处的残基；自动生成一句话说明和「简介」卡（方法、物种、文献、组成、UniProt 功能、小分子结合位点按钮）。
- **细胞质拥挤**：细胞一角的胞质里填满浅色的背景大分子（EF-Tu、核糖体、RNA 聚合酶、GroEL 和几种代谢酶的真实结构），数量按大肠杆菌的丰度换算，看起来像真实的细胞内部。
- **细胞一角（组合场景）**：核糖体在细胞质里翻译，上方细胞膜里的 KcsA 按胞内 pH 开关，两套模拟同时运行、共用一个控制面板；“镜头”按钮在全景、核糖体和通道之间切换。
- **拆装亚基**：每条链是一个零件，可以整体拆开、单独取下、按顺序装回；亚基表面染出伙伴贴住的位置（界面印记），点“全原子界面”会下载坐标、算出两条链之间的盐桥、氢键、二硫键和疏水接触，画成拆开时被拉长的彩色连接带；结合的小分子跟着所在的亚基一起走。
- **细胞区室实时模拟**：线粒体和叶绿体场景里，膜两侧的 pH、膜电位、ATP 和 NAD(P)H 浓度实时变化；背景按 pH 着色，游离的 H⁺ / ATP / NAD(P)H 随浓度增减，右上角曲线 + 实验开关（关灯、环式电子流、解偶联剂、寡霉素、DNP、缺氧），动画快慢跟着模拟出的电子流走。
- **插画画风**：白底上用屏幕空间墨线勾出每个分子的轮廓和结构域之间的细沟，整块结构有柔和的体积明暗，远处的部分逐渐淡入纸色；膜脂只画浅线，不抢蛋白的视线。
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
- 网页版：双击 [`web/index.html`](web/index.html)，详见 [web/README.md](web/README.md)。
- 桌面版：从 Releases 下载 exe，或者自己构建，详见 [desktop/README.md](desktop/README.md)。
- 让 AI 帮你做新场景：见 [skill/README.md](skill/README.md)。
- 项目纠偏、稳定性和专业化路线：见 [面向 AI 的审计与稳基文档](docs/AI_AUDIT_AND_STABILIZATION.md)。
- 现状审计与平台化建议：见 [平台现状审计报告](docs/PLATFORM_AUDIT_REPORT.md)。
- 具体工程实施规范：见 [平台化工程细节规范](docs/PLATFORM_ENGINEERING_SPEC.md)。

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
| 线粒体呼吸链超复合物 I₁III₂IV₁ | 5GUP | Wu et al. (2016) *Cell* 167, 1598 |
| 细胞色素 c | 1HRC | Bushnell, Louie & Brayer (1990) *J. Mol. Biol.* 214, 585 |
| PSII-LHCII 超复合物（菠菜） | 3JCU | Wei et al. (2016) *Nature* 534, 69 |
| 细胞色素 b6f（菠菜） | 6RQF | Malone et al. (2019) *Nature* 575, 535 |
| PSI-LHCI（豌豆） | 5L8R | Mazor et al. (2017) *Nature Plants* 3, 17014 |
| 叶绿体 ATP 合酶 CF1Fo（菠菜） | 6FKF | Hahn et al. (2018) *Science* 360, eaat4318 |
| 质体蓝素（杨树） | 1PLC | Guss et al. (1992) *Acta Cryst.* B48, 790 |
| 铁氧还蛋白（菠菜） | 1A70 | Binda et al. (1998) *Acta Cryst.* D54, 1353 |
| 铁氧还蛋白–NADP⁺ 还原酶（菠菜） | 1FNB | Bruns & Karplus (1995) *J. Mol. Biol.* 247, 125 |

机制参考：
- Boyer, P. D. (1997) The ATP synthase — a splendid molecular machine. *Annu. Rev. Biochem.* 66, 717.
- Abrahams, J. P. et al. (1994) Structure at 2.8 Å resolution of F1-ATPase from bovine heart mitochondria. *Nature* 370, 621.

动画中的时序、粒子路径和小分子放大比例是**示意**，用于教学，不代表定量动力学。

## 技术
[Three.js](https://threejs.org) r160（MIT）。网页版通过 jsDelivr 加载，桌面版打包在程序里。桌面外壳用 [Electron](https://www.electronjs.org)（MIT）。所有几何体都在浏览器中实时生成，仓库内不含结构数据。

## 许可证
Apache License 2.0，见 [LICENSE](LICENSE) 和 [NOTICE](NOTICE)。PDB 数据本身属于公共领域（CC0），但仍请按上文引用。
