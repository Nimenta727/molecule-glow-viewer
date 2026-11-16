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
- **价键模型**：小分子可以画成球棍、价键（单键、双键、三键、芳香环，键级来自 RCSB 化学组分字典）或空间填充；聚焦时结合位点的残基也按同样的键级画。
- **线粒体呼吸链**：复合体 I、III、IV、细胞色素 c 和 ATP 合酶排在同一层膜上，电子沿真实结构里的铁硫簇、血红素、铜中心依次跳过，三个复合体泵出 H⁺，H⁺ 经 ATP 合酶回流合成 ATP，能量条讲清每一步的能量变化。
- **叶绿体光反应**：PSII、细胞色素 b6f、PSI 和 ATP 合酶排在类囊体膜上；光子激发 P680 和 P700，电子从水出发按 Z 方案经质体醌、质体蓝素、铁氧还蛋白到 FNR 生成 NADPH，水裂解放出 O₂，H⁺ 在类囊体腔累积后经 ATP 合酶回流合成 ATP。
- **核糖体翻译（实时模拟）**：大肠杆菌 70S 核糖体读 mRNA 合成蛋白质；tRNA 选择、校对、肽键形成、转位、终止都是按真实速率随机发生的事件，新生肽沿算出的出口隧道伸出去；可调 EF-Tu / EF-G / RF1 浓度，加四环素、巴龙霉素、氯霉素、红霉素、黄色霉素、夫西地酸，看翻译变慢、错读或卡住，每种抗生素都在晶体结构里的真实位置。
- **钾通道 KcsA（实时模拟）**：通道嵌在膜里，胞内 pH 打开门（关 / 开 / 失活三种真实构象之间变形），K⁺ 按敲击机制单列通过过滤器、沿真实孔道路径移动，Na⁺ 被排斥；可调膜电位和两侧浓度（电流在 E_K 反转），加 TBA 或 Ba²⁺ 看阻断。
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
- **本地文件保护**：导入会检查 `.cif` / `.mmcif` / `.pdb` / `.ent` 扩展名和 50 MB 大小上限；格式错误或没有原子坐标时会显示可操作的错误提示。
- **自动画质**：按显卡自动选择画质，没有独立显卡也能运行。

## 使用 Web 版（原有 HTML 方式）
双击 `index.html`（Chrome / Edge 最新版）。若浏览器拦截本地文件的网络请求：
```bash
python -m http.server 8765
```
然后打开 `http://localhost:8765/index.html`。网址参数：`?pdb=4HHB`、`?preset=鞭毛马达`、`&q=low|medium|high`。

需要能访问 `models.rcsb.org`、`data.rcsb.org`、`files.rcsb.org`、`cdn.jsdelivr.net`。

`index.html` 仍然是完整、可直接部署的 Web 入口；桌面版不会替换或删除它。

## Windows 桌面版（Electron）

桌面版只是对现有 `index.html` 的安全 Electron 封装，保留 Three.js、RCSB 在线结构加载、本地 `.cif` / `.mmcif` / `.pdb` / `.ent` 导入、拖拽导入和截图功能。渲染页面不启用 Node.js 集成；截图保存通过受控的 preload API 调用系统保存对话框。

安装依赖并启动开发版：

```bash
npm install
npm start
```

在 Windows x64 上生成安装版和 portable `.exe`：

```bash
npm run dist
```

只生成 portable 版本：

```bash
npm run dist:portable
```

构建产物写入 `dist/`，不会提交到仓库。推荐在 Windows x64 本机执行最终打包和安装验证；Linux/macOS 可先运行 `npm test`、`npm start`（若有 GUI）以及 `npm run dist:dir` 验证配置和入口文件。

Web 版由浏览器直接运行，适合静态服务器部署；桌面版提供独立窗口和原生截图保存，但仍需要联网访问 RCSB 和 jsDelivr CDN。两种版本都不能在无网络时下载新的结构或 Three.js 资源，本地结构文件导入不需要联网。

## 可选后端服务

在不改变原有 HTML 直连方式的前提下，仓库新增了一个零额外依赖的 Node.js API 服务。它提供健康检查和受限的 RCSB 代理，并在进程内缓存 15 分钟，适合后续接入预设保存和教学场景服务：

```bash
npm run start:server
```

服务默认监听 `http://127.0.0.1:8787`：

- `GET /api/health`
- `GET /api/rcsb?url=https%3A%2F%2Fdata.rcsb.org%2F...`
- `GET /api/scenes`
- `POST /api/scenes`，提交 `{ "name": "...", "config": { ... } }`
- `GET /api/scenes/:id`
- `PUT /api/scenes/:id`，更新场景名称和配置
- `DELETE /api/scenes/:id`，删除场景

代理只允许 `data.rcsb.org`、`models.rcsb.org` 和 `files.rcsb.org` 的 HTTPS 地址，避免把服务变成任意 URL 转发器。现有 Web 版和 Electron 版仍可不依赖该服务直接运行。

场景数据默认保存在 `data/scenes.json`（已加入 `.gitignore`），可通过 `DATA_DIR` 指定持久化目录。当前接口不包含登录和权限控制，适合本地或受保护的内网部署，不应直接暴露到公网。

前端可选择通过 URL 参数使用代理，例如：

```text
http://localhost:8765/index.html?api=http%3A%2F%2F127.0.0.1%3A8787
```

未提供 `api` 参数时，页面仍按原方式直接访问 RCSB；因此静态 Web 版和 Electron 版不会被后端服务依赖改变。

## 开发进度

当前已完成的渐进式改进：

- Electron Windows x64 安装版与 portable 打包。
- Web 与桌面版共用 `index.html`，并保留本地文件导入和截图能力。
- 本地结构文件扩展名、大小和坐标内容校验，避免无效文件让页面停在加载状态。
- RCSB/CDN 网络错误会给出更明确的访问提示；连续切换结构时，旧请求失效也不会让“加载”按钮永久禁用。
- 控制面板支持快速、教学、专家三种模式；默认快速模式保留常用操作，专家模式仍可访问全部参数。
- 教学模式提供“上一步 / 下一步”，会复用预设已有的能量转化步骤和结构高亮，不改变原有连续动画。
- 加载结构时显示下载、解析和过程初始化的阶段进度；网络或结构错误会清除进度条并保留错误提示。
- 小屏幕增加播放、标签、截图和更多操作栏，完整参数仍可通过“更多”打开，保持 Web 与桌面版操作一致。

后续改进方向包括加载阶段进度、大结构解析优化、结构点击聚焦、教学时间轴和移动端快捷操作；这些功能会继续以小步提交，避免影响现有 Web 版本。

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
[Three.js](https://threejs.org) r160（MIT），通过 jsDelivr 加载。所有几何体都在浏览器中实时生成，仓库内不含结构数据。

## 许可证
MIT，见 [LICENSE](LICENSE)。PDB 数据本身属于公共领域（CC0），但仍请按上文引用。
