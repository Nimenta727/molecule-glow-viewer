/* ----------------------------------------------------------------------------- translation constants
   Standard genetic code (NCBI table 1, base order UCAG). */
const GENCODE = (() => { const b = 'UCAG', aa = 'FFLLSSSSYY**CC*WLLLLPPPPHHQQRRRRIIIMTTTTNNKKSSRRVVVVAAAADDEEGGGG', m = {}; let i = 0; for (const x of b) for (const y of b) for (const z of b) m[x + y + z] = aa[i++]; return m; })();
const AA3 = { A: 'ALA', R: 'ARG', N: 'ASN', D: 'ASP', C: 'CYS', Q: 'GLN', E: 'GLU', G: 'GLY', H: 'HIS', I: 'ILE', L: 'LEU', K: 'LYS', M: 'MET', F: 'PHE', P: 'PRO', S: 'SER', T: 'THR', W: 'TRP', Y: 'TYR', V: 'VAL' };
const AANAME = (c) => c === 'fM' ? 'fMet' : (AA1[AA3[c]] || c);
const PREF_CODON = { A: 'GCG', R: 'CGU', N: 'AAC', D: 'GAU', C: 'UGC', Q: 'CAG', E: 'GAA', G: 'GGC', H: 'CAU', I: 'AUU', L: 'CUG', K: 'AAA', M: 'AUG', F: 'UUU', P: 'CCG', S: 'AGC', T: 'ACC', W: 'UGG', Y: 'UAU', V: 'GUU' };   // most used E. coli codons
const ANTI = (cod) => cod.split('').reverse().map(b => ({ A: 'U', U: 'A', G: 'C', C: 'G' })[b]).join('');   // anticodon 5'->3'
/* near-cognate tRNAs for a codon: one mismatch; the amino acids they carry (misincorporation candidates) */
function nearAA(cod) { const s = new Set(), cog = GENCODE[cod]; for (let i = 0; i < 3; i++) for (const b of 'UCAG') { if (b === cod[i]) continue; const c2 = cod.slice(0, i) + b + cod.slice(i + 1), a = GENCODE[c2]; if (a !== '*' && a !== cog) s.add(a); } return [...s]; }
const TL_ORF = {
  ubq: ['泛素（76 aa）', 'MQIFVKTLTGKTITLEVEPSDTIENVKAKIQDKEGIPPDQQRLIFAGKQLEDGRTLSDYNISKESTLHLVLRLRGG'],
  ermcl: ['ErmCL 前导肽（19 aa；红霉素存在时停在 Ile9，是红霉素诱导耐药的开关）', 'MGIFSIFVISTVHYQPNKK'],
  polyu: ['poly(U) → 多聚苯丙氨酸（结构里的 mRNA 就是 poly(U)）', 'MFFFFFFFFFFFFFFFFFFFFFFFF'],
};
/* Elongation kinetics, s^-1 (concentration terms per uM), E. coli, 37 C-like fast kinetics: initial binding k1, codon recognition
   k2 / dissociation k-2 (cognate vs near-cognate), GTPase activation + hydrolysis k3 (the first selection, ~650x), EF-Tu
   release k4, accommodation k5 vs proofreading rejection k7 (second selection) -- Rodnina & Wintermeyer, Pape 1998, Gromadski &
   Rodnina 2004, Wohlgemuth 2010; peptidyl transfer, EF-G binding / translocation / release (Savelsbergh 2003, Wintermeyer 2004);
   RF1 recognition and hydrolysis (Freistroffer 2000, Indrisiunaite 2015). The 20 C values are scaled to effective 37 C in vivo
   rates and calibrated offline (Monte Carlo of this exact scheme): ~13 aa/s, missense error ~5e-4, with paromomycin ~1e-2.
   Non-cognate ternary complexes (~90 %) touch the L7/L12 stalk and leave without occupying the A site: counted, not blocking. */
const TL_K = { k1: 110, km1: 150, k2: 500, km2c: 1, km2n: 600, k3c: 1500, k3n: 1.5, k3nPar: 10, k4: 300, kirOff: 0.002,
  k5c: 150, k7c: 0.5, k5n: 1, k7n: 30, k5nPar: 3, k7nPar: 15, pep: 200, dropOff: 0.5, dropErm: 0.01, gOn: 15, trans: 100, gOff: 100, faOff: 0.2, eOff: 30,
  rf: 20, hyd: 15, recycle: 2, init: 1, fc: 0.04, fn: 0.06 };
/* antibiotics: real site from a drug-bound T. thermophilus 70S structure, superposed by its rRNA; kon (per uM per s) / koff (s^-1)
   approximate (Kd: tetracycline ~1-2 uM, paromomycin ~0.2 uM, chloramphenicol ~2 uM, erythromycin ~10-20 nM); kirromycin and
   fusidic acid act on the factor (fraction bound = c / (c + Kd)). */
const TL_DRUG = {
  TAC: { name: '四环素', id: '4V9A', ref: '16S', at: 'Asite', kon: 1, koff: 2, col: '#d4a000',
    eff: '结合在 30S 的 h34 / h31 口袋，正好压在 A 位 tRNA 反密码子臂要去的地方：三元复合物还能碰上来，但不能完成密码子识别，只能离开 → 延伸停住（可逆，抑菌）。' },
  PAR: { name: '巴龙霉素', id: '4V51', ref: '16S', at: 'Asite', kon: 1, koff: 0.2, col: '#d9467e',
    eff: '氨基糖苷，结合在 16S 的 h44 解码中心，把 A1492 / A1493 固定在“翻出”状态——就像总有同源配对一样。近同源 tRNA 的 GTP 水解（×20）和容纳都加快、校对减弱 → 错误掺入大增（读错）。' },
  CLM: { name: '氯霉素', id: '6ND5', ref: '23S', at: 'ptc', kon: 1, koff: 2, col: '#2fb39c',
    eff: '结合在 23S 肽基转移中心的 A 位裂隙，挡住 A 位氨酰末端：肽键形成变慢；倒数第二个氨基酸是 Ala / Ser / Thr 时抑制最强（Marks 等 2016，背景依赖）。' },
  ERY: { name: '红霉素', id: '6XHX', ref: '23S', at: 'tunnel', kon: 0.5, koff: 0.01, col: '#7a5ae0',
    eff: '大环内酯，结合在出口通道入口（A2058 / A2059 附近），不挡肽键形成，但长到 ~8 个氨基酸（ErmCL：Ile9 在 P 位）时肽链被堵住 → 停滞，肽酰-tRNA 会掉落（drop-off）。肽链已经很长时它进不去。' },
  KIR: { name: '黄色霉素', id: '4V5P', ref: '23S', at: 'eftu', kd: 0.25, col: '#ff8c00',
    eff: 'kirromycin，结合在 EF-Tu 结构域 1 和 3 之间。GTP 照常水解，但 EF-Tu 不能变成 GDP 构象、不能离开 → 带着 tRNA 卡在核糖体上（4V5P 就是这个状态）。' },
  FUA: { name: '夫西地酸', id: '4V5F', ref: '23S', at: 'efg', kd: 1, col: '#3b6fe0',
    eff: '结合在 EF-G 的 GTP 酶结构域与核糖体之间。移位照常完成、GTP 已水解，但 EF-G·GDP 不能离开 → 下一个三元复合物进不了 A 位（4V5F 就是这个被卡住的状态）。' },
};
const TL_EV = { init: '起始（fMet-tRNA 进 P 位）', tcC: '同源三元复合物结合', tcN: '近同源三元复合物结合', tcOff: '三元复合物离开', codon: '密码子识别',
  codonOff: '反密码子松开', gtp: 'GTP 水解', tuOff: 'EF-Tu·GDP 变构离开', kirStuck: 'EF-Tu 被黄色霉素卡住', accom: 'tRNA 容纳进 A 位', reject: '校对：tRNA 被甩掉',
  pep: '肽键形成', drop: '肽酰-tRNA 掉落', gOn: 'EF-G·GTP 结合', trans: '移位（tRNA + mRNA 前移 3 nt）', gOff: 'EF-G·GDP 离开', eOff: 'E 位 tRNA 离开',
  rfOn: 'RF1 识别终止密码子', hyd: '肽链水解释放', recycle: '核糖体回收',
  'TAC+': '四环素结合', 'TAC-': '四环素解离', 'PAR+': '巴龙霉素结合', 'PAR-': '巴龙霉素解离', 'CLM+': '氯霉素结合', 'CLM-': '氯霉素解离', 'ERY+': '红霉素结合', 'ERY-': '红霉素解离' };
const TL_STATE = { post: 'A 位空着，等三元复合物扩散过来', tc: '三元复合物与 L7/L12 柄初始结合（与密码子无关）', cr: '密码子识别：反密码子与 A 位密码子配对，解码中心检查配对几何',
  gtp: 'GTP 已水解，EF-Tu 正在变成 GDP 构象', kir: '黄色霉素把 EF-Tu·GDP 卡在核糖体上，翻译停住', rel: 'EF-Tu 已离开，tRNA 正在容纳 / 被校对',
  acc: 'tRNA 已容纳到 A 位，等肽键形成', pre: '肽键已形成（前移位态：tRNA 受体端进入杂合态 A/P、P/E），等 EF-G', g: 'EF-G·GTP 已结合，正在移位',
  gpost: '移位完成，EF-G·GDP 待离开', rf: 'RF1 已识别终止密码子，GGQ 伸进肽基转移中心', term: '肽链已释放，等核糖体回收', drop: '肽酰-tRNA 掉落（红霉素造成的流产翻译），等回收',
  init: '核糖体已回收，等待新一轮起始' };
const aaCol = (aa) => aa === 'fM' ? '#e6c84a' : RES_CHEM[AA3[aa]] || '#c9bf99';
/* rigid "carrier" pose of a molecule that flies: world = q (p - c) + t, interpolated from (q0, t0) to (q1, t1) by w, with a Brownian-like wiggle */
const _cw = new THREE.Vector3(), _tp = new THREE.Vector3(), _tm4 = new THREE.Matrix4(), _tsv = new THREE.Vector3(), _tq0 = new THREE.Quaternion(), _pq = new THREE.Quaternion(), _pt = new THREE.Vector3();
function crNew(c) { return { c: c.clone(), q0: new THREE.Quaternion(), t0: c.clone(), q1: new THREE.Quaternion(), t1: c.clone(), w: 1, wig: randVis() * 10, amp: 10, q: new THREE.Quaternion(), t: c.clone() }; }
function crEval(cr) { cr.q.copy(cr.q0).slerp(cr.q1, cr.w); cr.t.copy(cr.t0).lerp(cr.t1, cr.w); const h = 4 * cr.w * (1 - cr.w) * cr.amp;
  if (h > 0.01) cr.t.add(_cw.set(Math.sin(cr.wig + cr.w * 7), Math.cos(cr.wig * 1.3 + cr.w * 9), Math.sin(cr.wig * 0.7 + cr.w * 11)).multiplyScalar(h)); return cr; }
function crApply(cr, p) { return p.sub(cr.c).applyQuaternion(cr.q).add(cr.t); }
function crFrom(cr) { crEval(cr); cr.q0.copy(cr.q); cr.t0.copy(cr.t); cr.q1.copy(cr.q); cr.t1.copy(cr.t); cr.w = 0; return cr; }
const randQ = () => new THREE.Quaternion().setFromEuler(new THREE.Euler(randVis() * 6.283, randVis() * 6.283, randVis() * 6.283));
let procWorld = [];   // process objects that live in the main scene (macromolecules: depth + ink like the structure itself)

