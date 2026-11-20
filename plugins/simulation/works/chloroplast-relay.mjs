/**
 * The choreography of the light reactions (classic: `setup`, `cycle` of src/sim/processes/chloroplast.js) as a data-animation relay. One cycle = 2 electrons = 1 NADPH: two photons at PSII
 * (antenna chlorophyll → excitation hops → P680), charge separation, water splitting (2 H⁺ into the lumen; O₂ every second cycle), PQ taking 2 stroma H⁺, the Q cycle at b6f (4 H⁺ into the
 * lumen, 2 stroma H⁺ taken at Qi, one electron down bL → bH → cn → Qi, two up Rieske → cytochrome f), plastocyanin carrying each electron from cytochrome f to P700 (two trips), two photons at
 * PSI, the electrons down A0 → A1 → FX → FA → FB to ferredoxin, ferredoxin → FNR, NADP⁺ + 2 e⁻ + H⁺ → NADPH: 6 H⁺ into the lumen and 4 photons per NADPH. The cofactors are found in the structures by
 * what they are (component code, the protein they sit in, their relation to each other), as the classic setup did, using the ring-atom centre it used.
 *
 * The parts are told apart by the entity names the structures carry (the classic told them apart by the component each came from). Not the classic: plastocyanin and ferredoxin are markers that carry the
 * electron (the proteins do not move); the antenna chlorophyll a photon is absorbed by changes from cycle to cycle in turn (the classic drew it at random); the PSII monomer, the cytochrome f and
 * everything else are chosen the same way as the classic (nearest to cytochrome b6f, facing photosystem I, …).
 */
const PS2 = '/photosystem ii|cytochrome b559|oxygen-evolving|\\(cp2[69]\\)|^chlorophyll a-b binding protein, chloroplastic$/', D1 = '/photosystem ii protein d1/', D2 = '/photosystem ii d2 protein/';
const B6F = '/cytochrome b6|cytochrome f/', PS1 = '/photosystem i (p700|iron|reaction)|lhca1|chlorophyll a-b binding protein (3|p4)|^psa|putative uncharacterized/';
const FNR = '/^ferredoxin-nadp\\+ reductase$/', PC = '/^plastocyanin$/', FD = '/^ferredoxin$/';
const ref = (name, extra = {}) => ({ ref: name, ...extra });
const mem = (dy, blend = 1) => ({ index: 0, dy, blend });
const e = (label, via, extra = {}) => ({ species: 'e⁻', via, labelVia: label, hop: 0.5, ...extra });
const lig = (ligands, part, extra = {}) => ({ ligands, part, ring: true, ...extra });

export const CHLOROPLAST_ANCHORS = Object.freeze({
  b6C: { part: B6F }, psiC: { part: PS1 },
  // PSII: the monomer facing cytochrome b6f
  oex: lig('OEX', PS2, { pick: 'nearest', to: ref('b6C') }),
  pheo1: lig('PHO', PS2, { pick: 'nearest', to: ref('oex'), rank: 0 }), pheo2: lig('PHO', PS2, { pick: 'nearest', to: ref('oex'), rank: 1 }),
  pm: { between: [ref('pheo1'), ref('pheo2')], t: 0.5 },
  pheo: lig('PHO', D1, { pick: 'nearest', to: ref('oex') }),
  P680: { pairMid: lig('CLA', PS2, { near: { to: ref('pm'), max: 18 }, below: ref('pm'), margin: -2 }), maxGap: 12, else: { between: [ref('oex'), ref('pm')], t: 0.55 } },
  tyrZ: { residue: '161', part: D1, nearest: ref('oex') },
  fe2: lig('FE2', PS2, { pick: 'nearest', to: ref('pm') }),
  QA: lig('PL9', D2, { near: { to: ref('fe2'), max: 22 }, pick: 'nearest', to: ref('fe2'), else: { ref: 'fe2', offset: [-7, 0, 0] } }),
  QB: lig('PL9', D1, { near: { to: ref('fe2'), max: 22 }, pick: 'nearest', to: ref('fe2'), else: { mirror: { point: ref('QA'), about: ref('fe2') } } }),   // no quinone in the D1 site: across the iron from QA, as the classic
  // cytochrome b6f: cytochrome f facing PSI; bL nearest it; bH on the stroma side of bL; the heme cn next to bH; the Rieske cluster between
  f: lig('HEC', B6F, { below: { membrane: 0 }, margin: 10, pick: 'nearest', to: ref('psiC') }),
  bL: lig('HEM', B6F, { pick: 'nearest', to: ref('f') }),
  bH: lig('HEM', B6F, { above: ref('bL'), margin: 6, pick: 'nearest', to: ref('bL') }),
  cn: lig('HEC', B6F, { above: { membrane: 0 }, margin: 0, pick: 'nearest', to: ref('bH') }),
  isp: lig('FES', B6F, { pick: 'nearest', to: { between: [ref('bL'), ref('f')], t: 0.5 } }),
  Qo: { between: [ref('bL'), ref('isp')], t: 0.45 }, Qi: { between: [ref('cn'), ref('bH')], t: 0.3 },
  // PSI: P700 = chlorophyll a' and its partner; A1 = phylloquinone; A0; FX, FA, FB in order of distance
  cl0: lig('CL0', PS1), partner: lig('CLA', PS1, { pick: 'nearest', to: ref('cl0') }), P700: { between: [ref('cl0'), ref('partner')], t: 0.5 },
  A1: lig('PQN', PS1, { pick: 'nearest', to: ref('P700') }),
  A0: lig('CLA', PS1, { near: [{ to: ref('P700'), max: 16 }, { to: ref('A1'), max: 14 }], pick: 'nearest', to: ref('A1'), optional: true }),   // not every structure shows it: then the path skips it
  FX: lig('SF4', PS1, { pick: 'nearest', to: ref('P700'), rank: 0 }), FA: lig('SF4', PS1, { pick: 'nearest', to: ref('P700'), rank: 1 }), FB: lig('SF4', PS1, { pick: 'nearest', to: ref('P700'), rank: 2 }),
  ant2: lig('CLA,CHL', PS2, { near: { to: ref('P680'), min: 25, max: 70 }, pick: 'cycle' }),
  ant1: lig('CLA', PS1, { near: { to: ref('P700'), min: 25 }, pick: 'cycle' }),
  // the shuttles: plastocyanin (lumen) and ferredoxin (stroma) dock where they hand over
  pcDock1: { ref: 'f', offset: [0, -20, 0] }, pcDock2: { ref: 'P700', offset: [0, -26, 0] },
  fnrC: { part: FNR }, fad: lig('FAD', FNR), fdDock1: { ref: 'FB', offset: [0, 20, 0] }, fdDock2: { along: { from: ref('fnrC'), to: ref('fdDock1'), distance: 30 } },
  nadp: { ref: 'fad', offset: [10, 26, 0] },
  // ATP synthase (CF1Fo): the proton path at the a-subunit / c-ring interface, ATP leaves the CF1 head
  atpH0: { part: '/subunit a,/', onMembrane: mem(-34) }, atpH1: { part: '/subunit a,/', onMembrane: mem(-6) }, atpH2: { part: '/subunit a,/', onMembrane: mem(6) }, atpH3: { part: '/subunit a,/', onMembrane: mem(34) },
  atpOut: { part: '/subunit beta/', offset: [0, 18, 0] },
});

const takeH = (site, label, extra = {}) => ({ species: 'H⁺', from: 'top', via: [ref(site, { onMembrane: mem(26) }), ref(site, extra)], labelVia: label, tIn: 1.8, tVia: 0.6 });
const releaseH = (anchor, delay, off = [0, 0, 0]) => ({ species: 'H⁺', to: 'bot', via: [ref(anchor, { offset: off }), ref(anchor, { offset: off, onMembrane: mem(-26, 0.5) }), ref(anchor, { offset: off, onMembrane: mem(-26) })],
  labelVia: 'H⁺（释放到腔）', counter: 'H⁺ 入腔', tVia: 0.8, delay });
/** A photon absorbed by an antenna chlorophyll, the excitation hopping to the reaction centre; `n` is 0 or 1 (the second follows 0.35 s later). */
const photon = (antenna, target, name, n) => ({ species: '光子 hν', via: [ref(antenna, { offset: [20, 130, 20] }), ref(antenna)], tVia: 0.9, labelVia: `光子 hν（${name === 'P680' ? 680 : 700} nm）`, counter: '光子', delay: n * 0.35, text: undefined,
  then: [{ species: '激发能', via: [ref(antenna), ref(target)], hop: 0.25, labelVia: '激发能（共振转移）', text: '天线叶绿素吸收光子 → 激发态',
    then: [{ pause: 1.0, text: `${name} → ${name}*（激发态，电荷分离）`, at: ref(target, { offset: [0, -8, 0] }) }] }] });
const twice = (make) => [make(0), make(1)];

export const CHLOROPLAST_RELAY = Object.freeze({
  name: '一个 NADPH（2 e⁻）', rate: 5, max: 1, gate: 'flux',
  phases: [
    // 0: two photons at PSII; a water molecule goes to the manganese cluster
    [{ species: 'H₂O', from: 'bot', via: [ref('oex')], tIn: 2.4, tVia: 0.5, labelVia: 'H₂O', stage: 0, wait: false }, ...twice((n) => photon('ant2', 'P680', 'P680', n))],
    // 1: charge separation, water splitting, PQ takes two stroma H⁺
    [...twice((n) => e('e⁻', [ref('P680'), ref('pheo'), ref('QA'), ref('fe2'), ref('QB')], { hop: 0.45, delay: n * 0.35, stage: 1 })),
     ...twice((n) => e('e⁻（来自水，经 TyrZ）', [ref('oex'), ref('tyrZ'), ref('P680')], { hop: 0.6, delay: n * 0.35 })),
     { pause: 0.2, text: '锰簇：H₂O 被氧化（每 4 个电子放出 1 个 O₂）', at: ref('oex', { offset: [0, -8, 0] }) },
     releaseH('oex', 0.3), releaseH('oex', 0.7, [3, 0, 0]),
     takeH('QB', 'H⁺ → QB', { offset: [-2, 0, 0] }), { ...takeH('QB', 'H⁺ → QB', { offset: [2, 0, 0] }), delay: 0.4 },
     { species: 'O₂', to: 'bot', via: [ref('oex')], every: 2, delay: 1.0, text: '2 H₂O → O₂ + 4H⁺ + 4e⁻', counter: 'O₂', tOut: 3.0 }],
    // 2: PQH₂ through the membrane to Qo, the Q cycle
    [{ species: 'PQH₂', via: [ref('QB'), ref('Qo')], brown: true, clear: 6, free: 6, tVia: 3.2, labelVia: 'PQH₂（质体醌醇，在膜内扩散）', stage: 2, text: 'PQ + 2e⁻ + 2H⁺ → PQH₂' }],
    [{ pause: 0.01, text: 'PQH₂ → PQ + 2H⁺ + 2e⁻（Qo 位点，Q 循环）', at: ref('Qo', { offset: [0, -6, 0] }), wait: false },
     ...[0, 1, 2, 3].map((i) => releaseH('Qo', i * 0.3, [(i - 1.5) * 3, 0, 0])),
     e('e⁻（低电位链 bL → bH → cn）', [ref('Qo'), ref('bL'), ref('bH'), ref('cn'), ref('Qi')], { hop: 0.6 }),
     takeH('Qi', 'H⁺ → Qi', { offset: [-2, 0, 0] }), { ...takeH('Qi', 'H⁺ → Qi', { offset: [2, 0, 0] }), delay: 0.4 },
     ...twice((n) => e('e⁻（Rieske → 细胞色素 f）', [ref('Qo'), ref('isp'), ref('f')], { hop: 0.6, delay: n * 0.35 }))],
    // 3-4: plastocyanin carries one electron per trip from cytochrome f to P700, two trips
    ...[1, 2].flatMap((trip) => [
      [e('e⁻', [ref('f'), ref('pcDock1')], { hop: 0.6, stage: 3 })],
      [{ species: 'PC', via: [ref('pcDock1'), ref('pcDock2')], brown: true, inside: 'bot', tVia: 2.6, labelVia: '质体蓝素 · Cu⁺（带 1 个 e⁻）', free: 14 }],
      [e(`e⁻（质体蓝素第 ${trip} 趟）`, [ref('pcDock2'), ref('P700')], { hop: 0.5, stage: 4 }),
       { species: 'PC', via: [ref('pcDock2'), ref('pcDock1')], brown: true, inside: 'bot', tVia: 2.6, labelVia: '质体蓝素 · Cu²⁺', free: 14, ...(trip === 2 ? { wait: false } : {}) }],
    ]),
    // second photon pair at PSI, the electrons down the PSI chain to ferredoxin
    [...twice((n) => photon('ant1', 'P700', 'P700', n))],
    [...twice((n) => e('e⁻（A0 → A1 → FX → FA → FB）', [ref('P700'), ref('A0'), ref('A1'), ref('FX'), ref('FA'), ref('FB'), ref('fdDock1')], { hop: 0.4, delay: n * 0.35 }))],
    // 5: ferredoxin → FNR → NADPH
    [{ species: 'Fd', via: [ref('fdDock1'), ref('fdDock2')], brown: true, inside: 'top', tVia: 2.4, labelVia: '铁氧还蛋白 · 还原态（带 1 个 e⁻）', stage: 5, free: 14 }],
    [e('e⁻', [ref('fdDock2'), ref('fad')], { hop: 0.5 }), { pause: 1.0, text: 'FAD 攒够 2 个电子 → FADH⁻', at: ref('fad', { offset: [0, 8, 0] }), wait: false },
     { species: 'Fd', via: [ref('fdDock2'), ref('fdDock1')], brown: true, inside: 'top', tVia: 2.4, labelVia: '铁氧还蛋白 · 氧化态', free: 14, wait: false, delay: 1.0 }],
    [{ species: 'NADP⁺', from: 'top', via: [ref('fad')], tIn: 2.4, tVia: 0.5, labelVia: 'NADP⁺' }, takeH('fad', 'H⁺ → FNR', { offset: [4, 4, 0] })],
    [{ species: 'NADPH', to: 'top', via: [ref('fad')], counter: 'NADPH', text: 'NADP⁺ + 2e⁻ + H⁺ → NADPH', tOut: 2.8, wait: false }, { pause: 0.01 }],
    [{ pause: 2.6, stage: 6 }],
  ],
});

/** CF1Fo: 14 H⁺ per turn of the c14 ring return to the stroma, 3 ATP leave the CF1 head per turn. The rotor is the parts the scene spins. */
export const CHLOROPLAST_ATP_FLOWS = Object.freeze([
  { name: 'H⁺ 经 ATP 合酶回流', species: 'H⁺', from: 'bot', to: 'top', via: ['atpH0', 'atpH1', 'atpH2', 'atpH3'].map((n) => ref(n)), perTurn: 14, labelVia: 'H⁺（ATP 合酶 a 亚基 / c 环）', counter: 'H⁺ 回流（ATP 合酶）' },
  { name: 'ATP 离开 CF1', species: 'ATP', to: 'top', via: [ref('atpOut')], perTurn: 3, labelVia: 'ATP（从 CF1 头部离开）', counter: 'ATP', tOut: 2.4 },
]);
export const chloroplastRotor = (parts) => ({ parts, mode: 'sym', turnsPerSecond: 0.25, by: 'rotor' });
