/**
 * The energy-conversion strips of the classic works that run as data animations (classic: `energy` / `energyHL` of the processes `flagellarMotor`, `respiratoryChain`, `chloroplast`;
 * the step texts are the classic's own). The structures a step involves are selection expressions (`entity "/^复合体 I$/"` = the part with exactly that name, like the classic's
 * regular-expression keys). The lit step follows the animation clock in turn (an illustration of the order); the classic lit the step where its electron path was.
 */
export const MECHANISM_ENERGY = Object.freeze(Object.fromEntries(Object.entries({
 "flagellarMotor": {
  "steps": [
   {
    "label": "质子动力势",
    "text": "细菌质膜内外的 H⁺ 电化学梯度（Δp 约 −150 mV 量级）。鞭毛马达直接用这个梯度，不用 ATP。",
    "select": "entity \"定子\""
   },
   {
    "label": "H⁺ 经定子",
    "text": "H⁺ 从周质经 MotA/MotB 定子的通道流入胞质，途中结合并离开 MotB 跨膜段上一个保守的天冬氨酸。",
    "select": "entity \"定子\""
   },
   {
    "label": "定子转动",
    "text": "2020 年的 MotA₅B₂ 结构提出：H⁺ 的结合 / 释放驱动 MotA 五聚体绕中心的 MotB 二聚体转动，像一个小齿轮。",
    "select": "entity \"定子\""
   },
   {
    "label": "推动 C 环（FliG）",
    "text": "MotA 胞质部分与 C 环上 FliG 的 C 端结构域接触，把定子的转动变成作用在转子上的扭矩。",
    "select": "entity \"定子\" or entity \"C 环\""
   },
   {
    "label": "转子与鞭毛丝转动",
    "text": "转子、杆、钩和鞭毛丝一起转动，每秒约上百转，推动细菌游动；CheY-P 结合 C 环可让转向在逆时针 / 顺时针间切换。",
    "select": "entity \"C 环\" or entity \"M-ring\" or entity \"MS ring\" or entity \"rod\" or entity \"hook protein\" or entity \"鞭毛丝\""
   }
  ],
  "stage": {
   "mode": "cycle",
   "period": 20
  }
 },
 "respiratoryChain": {
  "steps": [
   {
    "label": "NADH 交出电子",
    "text": "NADH 把 2 个电子（以氢负离子 H⁻ 形式）交给复合体 I 顶端的 FMN。NAD⁺/NADH 的标准还原电位 E°′ ≈ −0.32 V，是整条链的“高能”起点。",
    "select": "entity \"/^复合体 I$/\""
   },
   {
    "label": "复合体 I：电子下坡，泵 4 H⁺",
    "text": "电子经一串铁硫簇（N3 → N1b → N4 → N5 → N6a → N6b → N2，间距都 < 14 Å，靠量子隧穿跳跃）到达膜旁的 N2，再还原泛醌（Q → QH₂）。还原放出的能量通过膜臂的构象 / 静电耦合，把 4 个 H⁺ 从基质泵到膜间隙（耦合的具体机制仍有争论）。",
    "select": "entity \"/^复合体 I$/\""
   },
   {
    "label": "泛醌池",
    "text": "QH₂ 是脂溶性的，在膜内扩散，把 2 个电子带到复合体 III。",
    "select": "entity \"/^复合体 I$/\" or entity \"/^复合体 III$/\""
   },
   {
    "label": "复合体 III：Q 循环",
    "text": "QH₂ 在 Qo 位点被氧化，两个电子分道：一个经 Rieske 铁硫蛋白 → 细胞色素 c1 → 细胞色素 c（高电位链）；另一个经血红素 bL → bH 到 Qi 位点还原另一个醌（低电位链）。Q 循环的净效果：每 2 个电子向膜间隙释放 4 个 H⁺，并从基质侧摄取 2 个。",
    "select": "entity \"/^复合体 III$/\""
   },
   {
    "label": "细胞色素 c 穿梭",
    "text": "水溶性的细胞色素 c 在膜间隙一侧穿梭，一次只携带 1 个电子（血红素铁 Fe³⁺ ⇌ Fe²⁺），从复合体 III 的 c1 送到复合体 IV 的 CuA；每个 NADH 往返 2 次（动画画出两趟）。",
    "select": "entity \"细胞色素 c\" or entity \"/^复合体 III$/\" or entity \"/^复合体 IV$/\""
   },
   {
    "label": "复合体 IV：O₂ → H₂O",
    "text": "电子 CuA → 血红素 a → 血红素 a3–CuB 双核中心，在这里把 O₂ 还原成水（O₂/H₂O 的 E°′ ≈ +0.82 V）。每 2 个电子消耗基质侧 2 个“化学”H⁺（生成水），同时再泵出 2 个 H⁺。",
    "select": "entity \"/^复合体 IV$/\""
   },
   {
    "label": "质子动力势 → ATP",
    "text": "NADH → O₂：ΔE°′ ≈ 1.14 V，ΔG°′ = −nFΔE°′ ≈ −220 kJ/mol。约 10 个 H⁺ 进入膜间隙（复合体 I 泵出 4 个、IV 泵出 2 个；复合体 III 的 Q 循环不是泵：在 Qo 位点释放 4 个、在 Qi 位点从基质摄取 2 个），能量储存在跨内膜的质子动力势里（约 200 mV，线粒体中以膜电位为主）。H⁺ 经 ATP 合酶回流驱动转子：牛的 c8 环每转 8 个 H⁺ 合成 3 个 ATP。每个 ATP 另需约 1 个 H⁺ 把 ADP 和 Pi 运进基质，所以理论上 10 ÷ (8/3 + 1) ≈ 2.7 个 ATP / NADH；测得的 P/O 约 2.5（膜有质子漏）。",
    "select": "entity \"ATP 合酶\""
   }
  ],
  "stage": {
   "mode": "relay"
  }
 },
 "chloroplast": {
  "steps": [
   {
    "label": "光能捕获",
    "text": "天线叶绿素吸收光子（680 nm 红光约 1.82 eV，每摩尔光子约 176 kJ），激发能经共振能量转移在几十皮秒内汇集到反应中心 P680。每轮动画 = 2 个电子 = 1 个 NADPH，PSII 和 PSI 各需 2 个光子。",
    "select": "entity \"LHCII 天线\" or entity \"PSII 核心\""
   },
   {
    "label": "PSII：电荷分离 + 水裂解",
    "text": "P680* 把电子交给去镁叶绿素（约 3 ps）→ QA → 非血红素铁 → QB；留下的 P680⁺（约 +1.2 V，生物界最强氧化剂）经 D1 的 Tyr161（TyrZ）从 Mn₄CaO₅ 簇夺回电子。锰簇攒够 4 个氧化当量，把 2 H₂O 氧化成 O₂（O₂/H₂O E°′ = +0.82 V），4 个 H⁺ 留在类囊体腔。QB 接 2 个电子并从基质摄取 2 个 H⁺ 成为 PQH₂。",
    "select": "entity \"PSII 核心\" or entity \"放氧复合体蛋白\""
   },
   {
    "label": "质体醌 → b6f：Q 循环",
    "text": "PQH₂ 在膜内扩散到 b6f 的 Qo 位点被氧化：一个电子经 Rieske 铁硫簇 → 细胞色素 f（高电位链，约 +0.37 V）；另一个经血红素 bL → bH → cn 回到 Qi 位点还原质体醌（低电位链，需基质 H⁺）。每 2 个电子向腔里释放 4 个 H⁺。",
    "select": "entity \"PSII 核心\" or entity \"Cyt b6f\""
   },
   {
    "label": "质体蓝素穿梭",
    "text": "质体蓝素（Cu）在类囊体腔里一次运 1 个电子，从细胞色素 f 送到 PSI 的 P700⁺（每轮往返 2 次，动画画出两趟）。",
    "select": "entity \"质体蓝素\" or entity \"Cyt b6f\" or entity \"PSI-LHCI\""
   },
   {
    "label": "PSI：第二次光激发",
    "text": "P700（约 +0.45 V）吸收 700 nm 光子（约 1.77 eV）变成 P700*（约 −1.3 V），电子经 A0（叶绿素）→ A1（叶绿醌）→ FX → FA → FB 铁硫簇到达基质表面。两个光系统串联、能量“两次爬坡”，画成电位图就是 Z 形，所以叫 Z 方案。",
    "select": "entity \"PSI-LHCI\""
   },
   {
    "label": "Fd → FNR → NADPH",
    "text": "铁氧还蛋白（−0.42 V）把电子带给 FNR；FNR 的 FAD 攒够 2 个电子，以 H⁻ 形式交给 NADP⁺（E°′ = −0.32 V），从基质再取 1 个 H⁺ → NADPH。总账：H₂O → NADP⁺，ΔE°′ ≈ 1.14 V，2 个电子 ΔG°′ ≈ +220 kJ/mol（上坡），由 4 个光子（约 690 kJ/mol）推动，光能约 1/3 存进 NADPH。",
    "select": "entity \"PSI-LHCI\" or entity \"铁氧还蛋白\" or entity \"FNR\""
   },
   {
    "label": "质子动力势 → ATP",
    "text": "每 2 个电子约 6 个 H⁺ 进入类囊体腔（水裂解 2 + Q 循环 4），腔 pH 可降到约 5。H⁺ 经 CF1Fo ATP 合酶流回基质：c14 环每转 14 个 H⁺ 合成 3 个 ATP（约 4.7 H⁺/ATP）→ 线性电子流约 1.3 ATP/NADPH，而卡尔文循环需要 1.5；不足的 ATP 由环式电子流（Fd → PQ → b6f → PSI，只泵 H⁺、不产 NADPH）补上。",
    "select": "entity \"ATP 合酶\""
   }
  ],
  "stage": {
   "mode": "relay"
  }
 }
}).map(([k, v]) => [k, Object.freeze(v)])));
