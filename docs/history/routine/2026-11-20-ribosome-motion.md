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

## 第二部分（同日）：因子体与抗生素
- `plugins/simulation/entry-alignment.mjs`（新）：经典 `alignEntry`——只从 RCSB ModelServer 取需要的链/配体，按参考链（核糖体 23S/16S rRNA）迭代剔除地叠合到场景（6 Å、3 Å 两轮剔除，标号按 label 与 author 取更合的一个，只用组装体 1 的链），抓取函数由调用方传入（便于测试）。`tools/entry-alignment-parity.mjs`（联网）：经典拟合块原样在 vm 里跑，对真实的 4V5L、4V9H、4V7P 与 4V6F 的 23S：保留的残基数、标号方式、RMSD、变换结果全部一致（6/6，`docs/parity/entry-alignment-parity-report.txt`）。
- `ribosome-motion.mjs`：A/T 弯曲 tRNA（`bentShape`，`trnaCoords` 的 `sAT`/`shape`/`shift`）、EF-Tu（4V5L 的 GTP 形式→1TUI 的 GDP 形式，三元复合物飞入、GTP 水解后变构并离开，tRNA 随后伸直容纳）、EF-G（4V9H→4V5F，移位时变构）、RF1（终止时出现）、抗生素位点标记；没有因子结构时回退到原来的做法。
- `apps/viewer-web/ribosome-view.mjs`：启动时并行下载这些结构（4V5L、1TUI、4V9H、4V5F、4V7P、4V9A、4V51、6ND5），任何一个失败只是少那一项；因子画成珠，药物画成带名字的红色标记。
- 真实数据联网实测（4V6F）：A/T tRNA 残基 76，EF-Tu 405（GDP 形式 405）、EF-G 622、RF1 354，四个药物位点（四环素、巴龙霉素、氯霉素、夫西地酸）都找到；三元复合物里 EF-Tu 质心与 tRNA 质心相距约 41 Å。
- 单测：`entry-alignment.test.mjs`（2）、`ribosome-motion.test.mjs` 新增 2（EF-Tu/EF-G/RF1 全程、药物标记、无因子回退）。

### 仍没有做
新生肽链与出口通道、红霉素与黄色霉素的位点（需要出口通道和 CCD 模板）、原子级特写；浏览器里没有看，下载 9 个条目的耗时没有计入界面反馈。

## 第三部分（同日）：出口通道、新生肽链、红霉素/黄色霉素位点
- 出口通道：沿用已迁移的 `findChannel`（与经典对照过），在真实 4V6F 上得到 28 点、72 Å 的通道（耗时数秒，只把 PTC 周围 110 Å 内的残基交给搜索：结果与用全部残基逐点相同，耗时没有明显缩短——时间在网格 Dijkstra 上；界面给出"正在计算出口通道"的状态提示）。
- 新生肽链（`ribosome-motion.mjs`）：每个残基一颗珠，从携带肽链的 tRNA 3′ 端沿通道排开（3.5 Å 间距，最老的在最里面），出口之外松散螺旋；每个肽键使整条链前移一个残基（0.8 s 补间）；终止时从出口方向离开并淡出，红霉素造成的"掉落"沿远离 PTC 的方向带着 tRNA 走。珠按氨基酸类别着色，序列来自翻译配置，长度取过程状态 `nums.L`（因此**错误掺入的残基在这里按同源序列画**，不像经典标红）。
- 位点：红霉素（6XHX，近通道 14 Å 处）、黄色霉素（4V5P）也按 23S 叠合取得并标记；加上之前的四环素、巴龙霉素、氯霉素、夫西地酸共六种；联网实测六个都找到。
- 单测 +1（珠间距、最老在最远、前移、螺旋、释放、掉落、无通道则不画）。

### 仍没有做
原子级特写；药物只用一个球标记（没有逐原子的 CCD 模板）；错误掺入的残基不标红；浏览器里没有看。
