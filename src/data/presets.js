//! ES module AND build fragment (see src/README.md). The built-in presets: pure data, no Three.js, no DOM,
//! so the workshop tools in Node import it directly. The build strips `export ` and joins it into the page's module scope.
/* =============================================================================
   1. PRESETS  (every structure is downloaded live from RCSB)
   Fields are documented in references/parameters.md. Keyword matching is a
   case-insensitive "name contains"; when several keys match, the FIRST key wins,
   so list longer / more specific keys first. A key may also be a regex string "/.../".
   ============================================================================= */
/* one explanation of ATP per NADH everywhere (caption, energy steps, counters) */
const ATP_PER_NADH = '每个 ATP 另需约 1 个 H⁺ 把 ADP 和 Pi 运进基质，所以理论上 10 ÷ (8/3 + 1) ≈ 2.7 个 ATP / NADH；测得的 P/O 约 2.5（膜有质子漏）';
export const PRESETS = {
  'ATP 合酶（合成 ATP）': {
    id: '6ZPO', axisFrom: ['subunit C1', 'subunit beta'], blob: 4.4,
    spin: ['subunit gamma', 'subunit delta', 'subunit epsilon', 'subunit C1'],
    ghost: ['subunit alpha', 'subunit beta'],
    membranes: [{ at: 'subunit C1', offset: 0 }], memR: 1.2, cut: 0.0, cutWhat: 'mem',
    process: 'atpSynthase',
    /* "推荐" simplification: keep atomic detail where the mechanism happens, simplify the scaffold */
    /* functional cores drawn with atomic detail on top of the simplified shapes (ligand pockets are found automatically):
       the a/c interface around aArg159 (proton half-channels) and the proton-carrying cGlu58 of every c subunit */
    core: [{ near: { part: '/subunit a$/', seq: 159 }, r: 13, with: ['subunit C1'] }, { part: 'subunit C1', seqs: [[56, 60]] }],
    siteNotes: {
      ADP: '催化位点主要在 β 亚基上：P-loop（Walker A 基序 GxxxxGKT）环绕磷酸，Mg²⁺ 由磷酸氧和 P-loop 的 Thr 配位；相邻 α 亚基伸入一个精氨酸（“精氨酸手指”）稳定过渡态。三个 β 位点的结合紧密程度随 γ 的位置而变——这正是 Boyer 结合变构机制。上面的残基和距离由 6ZPO 坐标直接计算。',
      ATP: '6ZPO 中的 ATP 结合在 α 亚基的非催化位点（α–β 界面，主要由 α 构成）：这类位点结合核苷酸但不参与催化循环，被认为起结构 / 调节作用。催化用的 ATP 在动画里按 β 位点建模。' },
    colors: { 'subunit alpha': '#e64fc8', 'subunit beta': '#5b9dff', 'subunit gamma': '#e3e7f2', 'subunit delta': '#e3e7f2', 'subunit epsilon': '#e3e7f2',
              'subunit C1': '#3fc864', '/subunit a$/': '#2448e8', 'subunit O': '#ff9a50', 'B1': '#ff9a50', '/subunit d,/': '#ff9a50', 'factor 6': '#ff9a50', 'inhibitor': '#f5e07a' },
    camera: { az: -0.55, el: 0.12, dist: 1.05 },
    /* teaching notes: key (same matching rules as colors) -> [label, one-line role, longer explanation] */
    notes: {
      'subunit alpha': ['α 亚基 ×3', 'F1 头部，非催化', '与 β 交替排成 α3β3 六聚体（F1 头部）。α 也结合核苷酸，但它的位点不催化，主要起结构和调节作用。催化位点位于 α/β 交界、以 β 为主。'],
      'subunit beta': ['β 亚基 ×3', '催化位点：合成 ATP', '三个 β 同一时刻处在三种不同构象：开放（空）、松弛（结合 ADP + Pi）、紧密（ADP + Pi 合成 ATP）。γ 每转 120°，三个 β 依次换一种构象——这就是 Boyer 的“结合变构机制”。本动画中 β 的形状来自 6ZPO（冷冻电镜结构）三条 β 链的真实构象（βE 开放、βDP、βTP）。注意：在 6ZPO 中三个 β 位点其实都结合了 ADP（βE 没有 Mg²⁺），“开放＝空”是 Boyer 模型中的状态，动画按模型画。'],
      'subunit gamma': ['γ 亚基', '中心柄（转子）', '细长的 γ 插在 α3β3 中央，形状不对称。它转动时依次顶住不同的 β，迫使 β 改变构象，把转动的机械能变成化学能。'],
      'subunit delta': ['δ 亚基', '中心柄', '与 γ、ε 一起组成中心柄，把 c 环的转动传到 F1 头部。注意命名：线粒体的 δ 相当于细菌的 ε。'],
      'subunit epsilon': ['ε 亚基', '中心柄（线粒体特有）', '线粒体特有的小亚基（细菌没有对应亚基），与 γ、δ 一起构成中心柄底部，与 c 环接触。'],
      'subunit C1': ['c 环（c8）', '膜内转子，运 H⁺', '8 个 c 亚基围成的环嵌在线粒体内膜里。每个 c 亚基中部有一个谷氨酸（Glu58）可接受一个 H⁺。H⁺ 顺电化学梯度（质子动力势，线粒体中主要是膜电位）流过时推动 c 环转动：转一圈运 8 个 H⁺、产生 3 个 ATP（约 2.7 H⁺/ATP）。'],
      '/subunit a$/': ['a 亚基', '定子：H⁺ 半通道', 'a 亚基紧贴 c 环，提供两个错开的半通道：H⁺ 从膜间隙一侧进入、结合到 c 亚基上，随 c 环转近一圈后从另一个半通道释放到基质。a 亚基上保守的精氨酸防止 H⁺ 直接“短路”。'],
      'subunit O': ['OSCP', '外周柄顶端', 'OSCP（相当于细菌的 δ 亚基）像帽子扣在 α3β3 顶部，把头部固定在外周柄上，使它不跟着 γ 一起转——否则无法产生相对转动。'],
      'B1': ['b 亚基', '外周柄（定子臂）', '长螺旋从膜内一直伸到 F1 头部，与 d、F6 组成外周柄，像定子臂一样把 α3β3 固定住。'],
      '/subunit d,/': ['d 亚基', '外周柄', '外周柄组成部分。'],
      'factor 6': ['F6', '外周柄', '外周柄组成部分。'],
      'inhibitor': ['IF1', '抑制蛋白', 'IF1 抑制 ATP 合酶反向水解 ATP（例如缺氧时防止浪费 ATP）。6ZPO 中 IF1 的 N 端插在 αDP/βDP 界面，所以这个结构其实处于被抑制状态；动画中的合成循环是基于该结构的模型演示。'],
    },
  },
  '线粒体呼吸链（电子传递 → ATP）': {
    id: '5GUP', blob: 5.0,
    axisFit: ['NADH-ubiquinone oxidoreductase chain', '/^Cytochrome b$/', 'Cytochrome c oxidase subunit 1', 'Cytochrome c oxidase subunit 3'], up: 'flavoprotein 1',
    groupParts: [['复合体 IV', 'oxidase'], ['复合体 III', 'b-c1', '/^Cytochrome b$/', 'Cytochrome c1'], ['复合体 I', 'NADH', 'Acyl carrier']],
    membranes: [{ at: '/^Cytochrome b$/', offset: 0 }], memR: 0.95, cut: 0.0, cutWhat: 'mem',
    spin: ['subunit gamma', 'subunit delta', 'subunit epsilon', 'subunit C1'],
    components: [
      { id: '6ZPO', label: 'ATP 合酶', axisFrom: ['subunit C1', 'subunit beta'], alignTo: { own: 'subunit C1', anchor: '/^Cytochrome b$/' }, beside: { part: 'oxidase', gap: 45 }, split: true, pivot: 'subunit C1' },
      { id: '1HRC', label: '细胞色素 c', axis: 'long' },
    ],
    process: 'respiratoryChain', frameAll: true, solid: ['细胞色素 c'],
    core: [{ near: { part: '/subunit a$/', seq: 159 }, r: 13, with: ['subunit C1'] }],
    colors: { '/^复合体 I$/': '#5b9dff', '/^复合体 III$/': '#e64fc8', '/^复合体 IV$/': '#3fc864', '细胞色素 c': '#ff6b4a',
              'subunit alpha': '#f0b0e0', 'subunit beta': '#b6d4ff', 'subunit gamma': '#e3e7f2', 'subunit delta': '#e3e7f2', 'subunit epsilon': '#e3e7f2', 'subunit C1': '#9be6a8', '/subunit a$/': '#2448e8' },
    notes: {
      '/^复合体 I$/': ['复合体 I', 'NADH 脱氢酶：泵 4 H⁺', '约 45 个亚基、近 1 MDa，L 形：伸进基质的外周臂（NADH 结合位点 FMN 和 8 个铁硫簇）+ 埋在膜里的膜臂（3 个类反向转运体亚基 ND2/ND4/ND5 等，质子通道）。每氧化 1 个 NADH 泵出 4 个 H⁺。'],
      '/^复合体 III$/': ['复合体 III（二聚体）', '细胞色素 bc1：Q 循环', '同二聚体。每个单体有细胞色素 b（血红素 bL、bH）、细胞色素 c1 和 Rieske 铁硫蛋白；Rieske 的头部在 Qo 位点和 c1 之间摆动传电子。'],
      '/^复合体 IV$/': ['复合体 IV', '细胞色素 c 氧化酶：O₂ → H₂O', '电子从细胞色素 c 进入 CuA（双铜中心），经血红素 a 到 a3–CuB 双核中心还原 O₂。每 4 个电子还原 1 个 O₂ 成 2 个 H₂O，同时泵出 4 个 H⁺（即每 2 个电子泵 2 个）。'],
      '细胞色素 c': ['细胞色素 c', '膜间隙里的电子穿梭体', '约 104 个残基的小蛋白，共价连着一个血红素 c；在复合体 III 和 IV 之间一次运 1 个电子。它从线粒体释放到胞质也是细胞凋亡的信号。'],
      'subunit C1': ['c 环（c8）', 'ATP 合酶膜内转子', 'H⁺ 经 a 亚基半通道结合、离开 c 亚基的 Glu58，推动 c 环转动；8 个 H⁺ 转一圈。'],
      'subunit beta': ['β 亚基 ×3', 'ATP 合酶催化位点', 'γ 转动依次改变三个 β 的构象（开放 / 松弛 / 紧密），每转一圈合成 3 个 ATP。'],
      'subunit gamma': ['γ 亚基', 'ATP 合酶中心柄', '与 c 环一起转动，偏心轴驱动 β 构象变化。'],
    },
    siteNotes: {
      SF4: '[4Fe-4S] 铁硫簇：由 4 个半胱氨酸的硫配位，一次只接受 / 给出 1 个电子。复合体 I 的簇沿外周臂排成一条“电线”，相邻簇边到边 < 14 Å，电子靠量子隧穿在毫秒内传过。',
      FES: '[2Fe-2S] 铁硫簇。在复合体 III 中是 Rieske 蛋白的簇：一个 Fe 由两个组氨酸配位（不是半胱氨酸），所以电位较高（约 +0.28 V），能从 Qo 位点的 QH₂ 接受电子。',
      HEM: '血红素 b（复合体 III 的细胞色素 b 上有 bL 和 bH 两个）：Q 循环的低电位链，把第二个电子从 Qo 跨膜送到 Qi。',
      HEC: '血红素 c：通过两个硫醚键共价连在蛋白上（CXXCH 基序）。复合体 III 的 c1 把电子交给细胞色素 c。',
      HEA: '血红素 a：复合体 IV 的两个血红素 a 中，a 负责传电子，a3 与 CuB 组成还原 O₂ 的双核中心。',
      CU: '铜中心：复合体 IV 的 CuA（双铜，接受细胞色素 c 的电子）和 CuB（与血红素 a3 一起结合并还原 O₂）。' },
    camera: { broadside: true, el: 0.1, dist: 0.95 },
  },
  '叶绿体光反应（光 → NADPH + ATP）': {
    id: '3JCU', blob: 5.0,
    axisFit: ['Photosystem II protein D1', 'D2 protein', 'CP47', 'CP43'], down: 'Oxygen-evolving enhancer protein 1',
    groupParts: [['放氧复合体蛋白', 'Oxygen-evolving'], ['LHCII 天线', 'Chlorophyll a-b binding'], ['PSII 核心', '/./']],
    membranes: [{ at: 'Photosystem II protein D1', offset: 0 }], memR: 0.95, cut: 0.0, cutWhat: 'mem',
    spin: ['gamma chain', 'epsilon chain', 'subunit c,'],
    components: [
      { id: '6RQF', label: 'Cyt b6f', axisFrom: ['/^Cytochrome b6$/', '/^Cytochrome f$/'], flip: true, alignTo: { own: '/^Cytochrome b6$/', anchor: 'Photosystem II protein D1' }, beside: { dir: 'row', gap: 30 } },
      { id: '5L8R', label: 'PSI-LHCI', axisFrom: ['P700 chlorophyll a apoprotein', 'iron-sulfur center'], alignTo: { own: 'P700 chlorophyll a apoprotein', anchor: 'Photosystem II protein D1' }, beside: { dir: 'row', gap: 45 } },
      { id: '6FKF', label: 'ATP 合酶', axisFrom: ['subunit c,', 'subunit beta'], alignTo: { own: 'subunit c,', anchor: 'Photosystem II protein D1' }, beside: { dir: 'row', gap: 45 }, split: true, pivot: 'subunit c,' },
      { id: '1PLC', label: '质体蓝素', axis: 'long', at: { part: '/^Cytochrome f$/', dy: -30 } },
      { id: '1A70', label: '铁氧还蛋白', axis: 'long', at: { part: 'Photosystem I iron-sulfur center', dy: 24 } },
      { id: '1FNB', label: 'FNR', axis: 'long', at: { part: 'Photosystem I iron-sulfur center', dy: 52, along: 42 } },
    ],
    process: 'chloroplast', frameAll: true, solid: ['质体蓝素', '铁氧还蛋白', 'FNR'],
    coreLigands: ['OEX', 'PHO', 'PL9', 'FE2', 'BCT', 'CL', 'HEM', 'HEC', 'FES', 'SF4', 'CU', 'PQN', 'CL0', 'FAD', 'ATP', 'ADP', 'MG'],
    ligOff: ['CLA', 'CHL', 'BCR', 'LUT', 'XAT', 'NEX', 'ZEX', 'A86', 'HTG', '6PL', 'LMT', 'LMG', 'DGD', 'SQD', 'LHG', 'PGV', 'CA', 'UNL'],
    colors: { 'PSII 核心': '#3fc864', 'LHCII 天线': '#a8e05a', '放氧复合体蛋白': '#ffb84a', 'Cyt b6f': '#e64fc8', 'PSI-LHCI': '#5b9dff',
              '质体蓝素': '#4ad6ff', '铁氧还蛋白': '#ff6b4a', 'FNR': '#ffd34a',
              'subunit alpha': '#f0b0e0', 'subunit beta': '#b6d4ff', 'gamma chain': '#e3e7f2', 'epsilon chain': '#e3e7f2', 'subunit c,': '#9be6a8', '/subunit a,/': '#2448e8' },
    notes: {
      'PSII 核心': ['光系统 II（PSII）', '用光把水里的电子“拔”出来', '二聚体，每个单体的反应中心是 D1/D2 异二聚体，结合 P680（一对叶绿素 a）、去镁叶绿素、质体醌 QA/QB 和非血红素铁；CP47、CP43 是内周天线。P680 被激发后失去电子变成 P680⁺（约 +1.2 V），是生物界最强的氧化剂，强到能从水里夺电子。'],
      '放氧复合体蛋白': ['放氧增强蛋白 PsbO/P/Q', '保护锰簇，固定 Ca²⁺/Cl⁻', '位于类囊体腔一侧，像盖子一样罩住 Mn₄CaO₅ 簇，稳定放氧所需的 Ca²⁺ 和 Cl⁻。'],
      'LHCII 天线': ['LHCII / CP29 / CP26 天线', '收集光能', '每个天线蛋白结合十几个叶绿素 a/b 和类胡萝卜素（面板“小分子”里默认未勾选，勾上可见），吸收光子后通过共振能量转移（不是电子）在几十皮秒内把激发能传到反应中心。'],
      'Cyt b6f': ['细胞色素 b6f（二聚体）', '质体醌氧化：Q 循环，向腔内释放 H⁺', '相当于线粒体复合体 III：Rieske 铁硫蛋白 + 细胞色素 f（高电位链），血红素 bL、bH、cn（低电位链）。氧化 PQH₂、还原质体蓝素，同时把 H⁺ 送进类囊体腔。'],
      'PSI-LHCI': ['光系统 I + LHCI', '第二次光激发，把电子推到 −1.3 V', '反应中心 PsaA/PsaB 结合 P700（叶绿素 a/a′ 对）、A0、A1（叶绿醌）和铁硫簇 FX；基质侧的 PsaC 带 FA、FB。外面一圈 4 个 LHCI 天线（Lhca1–4）。'],
      '质体蓝素': ['质体蓝素', '类囊体腔里的电子穿梭体（Cu）', '约 99 个残基的小蓝铜蛋白，铜离子 Cu²⁺ ⇌ Cu⁺，一次运 1 个电子，从 b6f 的细胞色素 f 送到 PSI 的 P700⁺。'],
      '铁氧还蛋白': ['铁氧还蛋白 Fd', '基质里的电子穿梭体（2Fe-2S）', '约 97 个残基，[2Fe-2S] 簇（−0.42 V），一次运 1 个电子，从 PSI 的 FB 交给 FNR；也能把电子送回 PQ（环式电子流）或给其他代谢途径。'],
      'FNR': ['铁氧还蛋白–NADP⁺ 还原酶', '2 个 Fd 电子 → NADPH', '含 FAD：FAD 依次接收两个 Fd 送来的单电子（经半醌），再以氢负离子（H⁻）形式一次交给 NADP⁺，得到 NADPH。'],
      'subunit c,': ['c 环（c14）', 'ATP 合酶膜内转子', '叶绿体 ATP 合酶的 c 环有 14 个 c 亚基：转一圈要 14 个 H⁺ 从腔流回基质，合成 3 个 ATP（约 4.7 H⁺/ATP，比线粒体 c8 多）。'],
      'subunit beta': ['β 亚基 ×3', 'CF1 催化位点', 'γ 转动依次改变三个 β 的构象（开放 / 松弛 / 紧密），每转一圈合成 3 个 ATP。'],
      'gamma chain': ['γ 亚基', '中心柄（带氧化还原开关）', '叶绿体 γ 有一段特有的二硫键环：光照下经硫氧还蛋白还原后酶才被激活，黑暗中关闭，避免夜里水解 ATP。'],
    },
    siteNotes: {
      OEX: 'Mn₄CaO₅ 簇（放氧中心）：4 个 Mn、1 个 Ca 和 5 个氧桥组成的“歪椅子”。每吸收 1 个光子前进一个 S 态（S0 → S4），攒够 4 个氧化当量后把 2 个 H₂O 变成 1 个 O₂，同时放出 4 个 H⁺ 到类囊体腔。',
      PHO: '去镁叶绿素 a（Pheo）：P680* 的电子在约 3 皮秒内先跳到这里（D1 一侧的分支才有活性）。',
      PL9: '质体醌：QA 固定在 D2 上，一次只接 1 个电子；QB 在 D1 上，接满 2 个电子并从基质摄取 2 个 H⁺ 后变成 PQH₂，离开进入膜里的醌池。b6f 里也结合着一个质体醌。',
      FE2: '非血红素铁：位于 QA 和 QB 之间，由 4 个组氨酸和一个碳酸氢根（BCT）配位，调节两个醌之间的电子传递。',
      HEM: '血红素 b：b6f 的 bL（腔侧）和 bH（基质侧）组成 Q 循环的低电位链，把第二个电子跨膜送回 Qi 位点。',
      HEC: '血红素 c：细胞色素 f 的血红素（腔侧，把电子交给质体蓝素）；b6f 还有一个特有的血红素 cn（基质侧 Qi 位点旁）。',
      FES: '[2Fe-2S] 铁硫簇：b6f 里是 Rieske 蛋白的簇（两个 His 配位，电位高），铁氧还蛋白里是 4 个 Cys 配位的簇（−0.42 V）。',
      SF4: '[4Fe-4S] 铁硫簇：PSI 的 FX（PsaA/B 之间）、FA 和 FB（PsaC 上），把电子从 A1 一路送到基质表面。',
      CU: '质体蓝素的铜离子：由 2 个 His、1 个 Cys、1 个 Met 配位成扭曲四面体，这种“张力态”几何让 Cu²⁺/Cu⁺ 转换几乎不需要重排，电子转移很快。',
      PQN: '叶绿醌（维生素 K1，A1）：PSI 里两条对称分支上各一个，接收 A0 的电子再交给 FX。',
      CL0: '叶绿素 a′（P700 的一半）：P700 是叶绿素 a / a′ 的异二聚体，吸收 700 nm 光子后变成 −1.3 V 的强还原剂。',
      FAD: 'FAD（FNR 的辅基）：接收铁氧还蛋白的两个单电子，再以 H⁻ 形式交给 NADP⁺。',
      ATP: 'ATP：CF1 的催化位点（β 亚基）上的核苷酸。' },
    camera: { broadside: true, el: 0.12, dist: 0.92 },
  },
  '鞭毛马达': {
    id: '7CGO', axis: 'long', up: 'hook protein', blob: 5.0, horizontal: true,
    spin: ['rod', 'hook', 'M-ring', 'MS ring', 'FliE', 'FliP', 'FliQ', 'FliR', 'C 环', 'flagellin', '鞭毛丝', 'Dc loop'],
    membranes: [{ at: 'M-ring', offset: 18 }, { at: 'L-ring', offset: 0 }],
    memR: 1.3, cut: 0.0, cutWhat: 'mem', process: 'flagellarMotor',
    keepDetail: ['定子'],   // the stator (torque generator) stays atomic; rings / rod / hook / filament are simplified but still turn
    components: [
      { id: '8YJT', label: 'C 环（FliG/FliM/FliN）', axis: 'short', anchor: 'M-ring', side: 'below', gap: -40 },
      { id: '6YKM', label: '定子 MotA/MotB', axis: 'long', anchor: 'M-ring', side: 'at', dy: 10, arrange: { kind: 'ring', n: 11, radius: 215 }, spin: false },
      { id: '1UCU', label: '鞭毛丝（鞭毛蛋白）', axis: 'native', anchor: 'hook protein', side: 'above', gap: 0, arrange: { kind: 'helix', n: 130, rise: 4.7, twist: 65.8 } },
    ],
    colors: { 'C 环': '#d93fbf', '定子': '#3fc864', '鞭毛丝': '#e9ecf5', 'hook protein': '#e64fc8', 'M-ring': '#6aa8ff', 'MS ring': '#6aa8ff',
              'L-ring': '#2448e8', 'P-ring': '#3a64ff', 'rod': '#b8c8ff', 'FliE': '#b8c8ff', 'Dc loop': '#b8c8ff', 'FliP': '#ff9a50', 'FliQ': '#ff9a50', 'FliR': '#ff9a50' },
    camera: { az: -0.75, el: 0.22, dist: 1.3 },
    notes: {
      '定子': ['定子 MotA/MotB ×11', '利用 H⁺ 流产生力矩', '每个定子是 MotA5B2 复合物，MotB 锚定在细胞壁（肽聚糖）上。H⁺ 经 MotA/MotB 通道流入细胞，使 MotA 五聚体转动，像齿轮一样拨动 C 环。（本模型的定子结构 6YKM 来自空肠弯曲菌，转子部分来自沙门氏菌，为拼接示意。）'],
      'C 环': ['C 环（FliG/FliM/FliN）', '转子 + 换向开关', '位于胞质侧的大环。FliG 与定子接触接受力矩；CheY-P 结合 FliM 后 C 环构象改变，使电机由逆时针（前进）切换为顺时针（翻滚）。'],
      'M-ring': ['MS 环', '膜内转子基座', 'FliF 组成的环嵌在内膜中，与 C 环相连，一起转动。'],
      'MS ring': ['MS 环', '膜内转子基座', 'FliF 组成的环嵌在内膜中，与 C 环相连，一起转动。'],
      'L-ring': ['L 环', '外膜轴承', '嵌在外膜（LPS 层）中，像轴承一样让杆在其中转动。'],
      'P-ring': ['P 环', '肽聚糖层轴承', '位于细胞壁肽聚糖层，与 L 环一起组成轴承。'],
      'rod': ['杆', '传动轴', '把转子的转动穿过细胞壁传到外面的钩。'],
      'hook protein': ['钩', '柔性万向节', '弯曲的短管，把转动传给鞭毛丝，同时允许方向改变。'],
      '鞭毛丝': ['鞭毛丝', '螺旋桨', '由上万个鞭毛蛋白组装成的长螺旋管，转动时推动细菌前进。'],
      'FliP': ['输出装置', '组装鞭毛的输出通道', 'FliP/FliQ/FliR 组成输出门，把鞭毛蛋白从中央通道送到顶端组装。动画里它随转子一起转，但输出门是否随转子转动在文献中尚有争议。'],
    } },
  '钾离子通道 KcsA（膜中，pH 门控，可加阻断剂）': { id: '1K4C', chains: ['C'], axis: 'sym', blob: 3.6, keepDetail: [''], colorMode: 'chain', membranes: [{ at: '', offset: 0 }], memR: 2.6, cut: 0.0, cutWhat: 'all',
    process: 'kcsa', coreLigands: [], ligOff: ['F09', 'DGA', 'K', 'TBA', 'BA'], camera: { az: 0.4, el: 0.08, dist: 1.6 } },
  '细胞一角：核糖体 + 钾通道（同时模拟）': { id: '4V6F', axis: 'native', axisFrom: ['16S', '23S'], frameAll: true, cut: 0.0, cutWhat: 'all', process: 'cellCorner', blob: 3.4,
    keepDetail: [''], membranes: [{ at: '', offset: 0 }], memR: 2.6,   /* the membrane height is set by the process (above the ribosome) */
    components: [{ id: '1K4C', chains: ['C'], axis: 'sym', label: 'KcsA 钾通道' }],
    coreLigands: [], ligOff: ['MG', 'ZN', 'K', 'NA', 'CL', 'SF4', 'MIA', 'PAR', 'SPD', 'F09', 'DGA', 'TBA', 'BA'],
    colors: { '16S': '#efd3a0', '23S': '#e3c08e', '5S': '#e3c08e', '/30S/': '#b8c8dc', '/50S/': '#c6d3b6', 'KcsA': '#9d86e6' } },
  '整个细胞：大肠杆菌（从 2 µm 缩放到原子）': { id: '4V6F', axis: 'native', axisFrom: ['16S', '23S'], frameAll: true, multiscale: true, cut: 0.0, cutWhat: 'all', process: 'wholeCell', blob: 3.4,
    keepDetail: [''], membranes: [{ at: '', offset: 0 }], memR: 2.6,
    components: [{ id: '1K4C', chains: ['C'], axis: 'sym', label: 'KcsA 钾通道' }],
    coreLigands: [], ligOff: ['MG', 'ZN', 'K', 'NA', 'CL', 'SF4', 'MIA', 'PAR', 'SPD', 'F09', 'DGA', 'TBA', 'BA'],
    colors: { '16S': '#efd3a0', '23S': '#e3c08e', '5S': '#e3c08e', '/30S/': '#b8c8dc', '/50S/': '#c6d3b6', 'KcsA': '#9d86e6' } },
  '腺苷酸激酶（开合）': { id: '4AKE', states: ['4AKE', '1AKE'], chains: ['A'], colorMode: 'rainbow', axis: 'long', blob: 4.4, assembly: false,
    /* E. coli AdK domains (Müller et al. 1996): CORE 1-29/60-121/160-214, NMP-binding 30-59, LID 122-159 */
    domains: [['CORE', [[1, 29], [60, 121], [160, 214]]], ['NMP', [[30, 59]]], ['LID', [[122, 159]]]],
    energyStage: 'morph',
    energyHL: [[{ aseqs: [[7, 15]] }], [{ aseqs: [[30, 59], [122, 159]] }], [{ aseqs: [[13, 13], [123, 123], [156, 156], [167, 167]] }], [{ aseqs: [[122, 159]] }]],
    energy: [
      ['底物结合', 'ATP（带 Mg²⁺）结合在 CORE 的 P-loop 上、被 LID 覆盖；AMP 结合在 NMP 结合域。结合能使构象平衡偏向闭合态（没有底物时酶也会短暂闭合；Henzler-Wildman 等 2007）。'],
      ['LID / NMP 闭合', '两个结构域向 CORE 关闭，把水挤出活性位点、把两个底物的磷酸对准，LID 与 P-loop 上带正电的残基稳定过渡态。转动角度由 4AKE 与 1AKE 两套坐标计算（聚焦 Ap5A 可看到）。'],
      ['磷酰基转移', 'ATP 的 γ-磷酸转移到 AMP 上，生成 2 个 ADP。该反应接近平衡（标准自由能变化约为 0），所以腺苷酸激酶是细胞里缓冲 ATP / ADP / AMP 比例的“换算器”。'],
      ['打开释放产物（限速）', 'LID 重新打开才能释放 ADP，这是整个催化循环的限速步骤（Wolf-Watz 等 2004）。'] ],
    siteNotes: { AP5: 'Ap5A（P¹,P⁵-二腺苷五磷酸）是双底物类似物：一端的腺苷占 ATP 位点（LID 之下），另一端占 AMP 位点（NMP 结合域），中间的五个磷酸跨越两个位点，模拟磷酰基转移时两个底物靠在一起的状态，所以能把酶“锁”在闭合构象（1AKE）。' },
    caption: '腺苷酸激酶：底物结合使平衡偏向闭合态，LID 与 NMP 结构域向核心闭合（4AKE 张开 ⇄ 1AKE 闭合，抑制剂 Ap5A 占据活性位点）',
    notes: { '': ['腺苷酸激酶', 'ATP + AMP ⇌ 2 ADP', '由 CORE、LID（盖住 ATP）和 NMP 结合域三部分组成。LID 与 NMP 域像两扇门一样向核心关闭（没有底物时也会短暂闭合，底物结合使平衡偏向闭合态；Henzler-Wildman 等 2007），排除水并把两个底物对准，完成磷酸基团转移；产物释放时再打开。勾选“简”后三个结构域分别画成三个叶片（大肠杆菌编号：NMP 结合域约 30–59，LID 约 122–159，其余为 CORE）。'] },
    camera: { az: -0.6, el: 0.2, dist: 1.3 } },
  'GroEL 伴侣蛋白': { id: '1AON', axis: 'sym', blob: 4.0,   // not a rotary machine: GroES binds and leaves, nothing spins
    notes: { 'GROEL/GROES': ['GroES 盖子', '共伴侣（七聚体）', 'GroES 七聚体像盖子一样盖在 GroEL 的一个环（cis 环）上，与它围成一个封闭的折叠腔。GroES 结合需要该环先结合 ATP；ATP 水解后，下一轮 ATP 结合到对侧环（trans 环）触发 GroES 和折叠好的蛋白离开。GroES 不转动。'],
             'GROEL': ['GroEL', '伴侣蛋白（14 聚体）', '两个七聚体环背靠背叠成空心圆柱。每个亚基分三个结构域：赤道域（结合并水解 ATP、连接两环）、中间域（铰链）、顶端域（开口处，用疏水面抓住未折叠蛋白）。在 cis 环里，ATP 与 GroES 结合使顶端域大幅抬起并扭转（约 60° 抬升、90° 扭转；Xu, Horwich & Sigler 1997），疏水面翻向外，底物被释放进亲水的腔里折叠（约 10 秒）。'] } },
  '核糖体翻译（mRNA → 蛋白质，可加抗生素）': { id: '4V6F', axis: 'native', axisFrom: ['16S', '23S'], frameAll: true, cut: 0.0, cutWhat: 'all', process: 'translation', blob: 3.4,
    keepDetail: [''],   // every residue as a blob (Goodsell-style cross-section), no simplified shapes
    coreLigands: [], ligOff: ['MG', 'ZN', 'K', 'NA', 'CL', 'SF4', 'MIA', 'PAR', 'SPD'],
    colors: { '16S': '#efd3a0', '23S': '#e3c08e', '5S': '#e3c08e', '/30S/': '#b8c8dc', '/50S/': '#c6d3b6' },   // scaffold muted; factors and tRNAs saturated
  },
  '核小体': { id: '1KX5', axis: 'native', blob: 3.6,
    lobes: ['histone'],
    notes: {
      'DNA': ['DNA（147 bp）', '缠绕在八聚体外', '147 个碱基对的 DNA 以约 1.65 圈左手超螺旋缠绕在组蛋白八聚体外（Davey 等 2002，1.9 Å）。DNA 的小沟每次朝向八聚体时，组蛋白就用一个精氨酸插进小沟，共 14 个接触区——这些接触不认序列，所以几乎任何 DNA 都能包成核小体。'],
      'H3': ['H3 ×2', '组蛋白（四聚体中心）', '两个 H3–H4 二聚体组成 (H3–H4)₂ 四聚体，占据八聚体中心，包住中间约 60 bp 的 DNA（含对称轴处）。组蛋白折叠＝三段螺旋，两个组蛋白像“握手”一样交叉配对。H3 的 N 端尾巴伸出核小体外，其上的乙酰化、甲基化修饰调控染色质开放程度（示意图里尾巴省略）。'],
      'H4': ['H4 ×2', '组蛋白（四聚体）', '与 H3 握手配对成 H3–H4 二聚体。H4 尾巴（如 K16 乙酰化）影响相邻核小体之间的堆积，从而影响染色质压缩。'],
      'H2A': ['H2A ×2', '组蛋白（二聚体）', '与 H2B 组成 H2A–H2B 二聚体，两个二聚体分别结合在四聚体两侧，包住靠外的 DNA。核小体组装时先装 (H3–H4)₂，再加两个 H2A–H2B。'],
      'H2B': ['H2B ×2', '组蛋白（二聚体）', '与 H2A 配对。H2A–H2B 二聚体比四聚体更容易离开，转录时常被部分移去，让聚合酶通过。'] } },   // schematic: each histone = one globular unit of the octamer (tails dropped), as in textbook figures
  '20S 蛋白酶体（核心颗粒）': { id: '5LE5', axis: 'long', blob: 3.8 },
  /* SARS-CoV-2 刺突蛋白：6VXX 闭合态三聚体，冷冻电镜 2.8 Å。组装体展开后是三条受体结合域朝上的链。 */
  'SARS-CoV-2 刺突蛋白（三聚体）': { id: '6VXX', axis: 'long', assembly: true, blob: 3.6, colorMode: 'chain' },
};
/* stable ASCII key + explicit tier for every preset (audit G13): URLs (?preset=), regression and glow.load use the key;
   the Chinese display name stays an alias for one version. tier = the tab it belongs to: cell | system | single. */
export const PRESET_META = {
  'ATP 合酶（合成 ATP）': ['atp-synthase', 'single'],
  '线粒体呼吸链（电子传递 → ATP）': ['respiratory-chain', 'system'],
  '叶绿体光反应（光 → NADPH + ATP）': ['chloroplast-light', 'system'],
  '鞭毛马达': ['flagellar-motor', 'system'],
  '钾离子通道 KcsA（膜中，pH 门控，可加阻断剂）': ['kcsa', 'single'],
  '细胞一角：核糖体 + 钾通道（同时模拟）': ['cell-corner', 'system'],
  '整个细胞：大肠杆菌（从 2 µm 缩放到原子）': ['whole-cell', 'cell'],
  '腺苷酸激酶（开合）': ['adenylate-kinase', 'single'],
  'GroEL 伴侣蛋白': ['groel', 'single'],
  '核糖体翻译（mRNA → 蛋白质，可加抗生素）': ['translation', 'system'],
  '核小体': ['nucleosome', 'single'],
  '20S 蛋白酶体（核心颗粒）': ['proteasome-20s', 'single'],
  'SARS-CoV-2 刺突蛋白（三聚体）': ['spike', 'single'],
};
export const PRESET_BY_KEY = {};
for (const [name, P] of Object.entries(PRESETS)) { const [key, tier] = PRESET_META[name] || [name.normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'preset', 'single'];
  P.key = key; P.tier = tier; PRESET_BY_KEY[key] = name; }
export const presetName = (q) => q == null ? null : PRESET_BY_KEY[q] ? PRESET_BY_KEY[q] : PRESETS[q] ? q : null;   /* key or exact display name -> display name */
export const presetCat = (name) => PRESETS[presetName(name)]?.tier || 'single';

