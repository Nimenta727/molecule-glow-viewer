/**
 * The ribosome translation scheme (classic: src/sim/processes/translation.js rates() and fire(), constants in src/sim/translation-constants.js) as data for the Markov
 * engine, built from an amino-acid sequence: the codon of every position becomes tables (sense or stop, whether the residue is Ala / Ser / Thr, the share of
 * near-cognate residues that are), and the cycle itself is states + transitions with rate formulas. tools/translation-parity.mjs compares its rates with the classic code.
 * This is the construction the translation tool runs; the declaration it returns is plain data and the generic engine knows nothing about ribosomes.
 */
const BASES = 'UCAG', AA = 'FFLLSSSSYY**CC*WLLLLPPPPHHQQRRRRIIIMTTTTNNKKSSRRVVVVAAAADDEEGGGG';
export const GENCODE = (() => { const m = {}; let i = 0; for (const x of BASES) for (const y of BASES) for (const z of BASES) m[x + y + z] = AA[i++]; return m; })();
export const PREF_CODON = { A: 'GCG', R: 'CGU', N: 'AAC', D: 'GAU', C: 'UGC', Q: 'CAG', E: 'GAA', G: 'GGC', H: 'CAU', I: 'AUU', L: 'CUG', K: 'AAA', M: 'AUG', F: 'UUU', P: 'CCG', S: 'AGC', T: 'ACC', W: 'UGG', Y: 'UAU', V: 'GUU' };
export function nearAA(cod) { const s = new Set(), cog = GENCODE[cod]; for (let i = 0; i < 3; i++) for (const b of BASES) { if (b === cod[i]) continue; const c2 = cod.slice(0, i) + b + cod.slice(i + 1), a = GENCODE[c2]; if (a !== '*' && a !== cog) s.add(a); } return [...s]; }
export const ORFS = {
  ubq: 'MQIFVKTLTGKTITLEVEPSDTIENVKAKIQDKEGIPPDQQRLIFAGKQLEDGRTLSDYNISKESTLHLVLRLRGG',
  ermcl: 'MGIFSIFVISTVHYQPNKK',
  polyu: 'MFFFFFFFFFFFFFFFFFFFFFFFF',
};
export const TL_K = { k1: 110, km1: 150, k2: 500, km2c: 1, km2n: 600, k3c: 1500, k3n: 1.5, k3nPar: 10, k4: 300, kirOff: 0.002, k5c: 150, k7c: 0.5, k5n: 1, k7n: 30, k5nPar: 3, k7nPar: 15,
  pep: 200, dropOff: 0.5, dropErm: 0.01, gOn: 15, trans: 100, gOff: 100, faOff: 0.2, eOff: 30, rf: 20, hyd: 15, recycle: 2, init: 1, fc: 0.04, fn: 0.06 };
export const TL_DRUG = { TAC: { kon: 1, koff: 2 }, PAR: { kon: 1, koff: 0.2 }, CLM: { kon: 1, koff: 2 }, ERY: { kon: 0.5, koff: 0.01 }, KIR: { kd: 0.25 }, FUA: { kd: 1 } };
const ST = ['init', 'post', 'tc', 'cr', 'gtp', 'kir', 'rel', 'acc', 'pre', 'g', 'gpost', 'rf', 'term', 'drop'];
const onoff = { values: ['off', 'on'], init: 'off' };

/** The sequence tables the model reads: codon class per A-site index (1 sense, 2 stop), Ala/Ser/Thr per residue, share of near-cognate residues that are Ala/Ser/Thr. */
export function translationTables(aaSeq) {
  const aa = aaSeq[0] === 'M' ? aaSeq : 'M' + aaSeq, n = aa.length, codons = [PREF_CODON.M, ...[...aa.slice(1)].map((x) => PREF_CODON[x]), 'UAA'];
  const codonClass = Array(n + 1).fill(0), st = Array(n + 1).fill(0), nearST = Array(n + 1).fill(0);
  for (let k = 1; k <= n; k++) {
    if (k === n) { codonClass[k] = 2; continue; }
    codonClass[k] = 1; st[k] = +['A', 'S', 'T'].includes(aa[k]);
    const near = nearAA(codons[k]); nearST[k] = near.length ? near.filter((x) => ['A', 'S', 'T'].includes(x)).length / near.length : 0;
  }
  return { aa, n, codons, codonClass, st, nearST };
}

export function translationModel(aaSeq, { ermcl = false } = {}) {
  const t = translationTables(aaSeq), K = TL_K, D = TL_DRUG;
  const move = (id, label, when, rate, extra = {}) => ({ id, label, when, rate, ...extra });
  const kirP = 'KIR / (KIR + kdKIR)', fuaP = 'FUA / (FUA + kdFUA)';
  const drugs = ['TAC', 'PAR', 'CLM', 'ERY'].flatMap((d) => [
    move(`${d}-`, `${d} 解离`, `b${d}_on`, `koff${d}`, { set: { [`b${d}`]: 'off' } }),
    move(`${d}+`, `${d} 结合`, `b${d}_off && ${d} > 0${d === 'ERY' ? ' && !(L > 8)' : ''}`, `kon${d} * ${d}`, { set: { [`b${d}`]: 'on' } })]);
  return {
    version: 1, title: '核糖体翻译：延伸、终止与抗生素',
    constants: { ...K, ...Object.fromEntries(['TAC', 'PAR', 'CLM', 'ERY'].flatMap((d) => [[`kon${d}`, D[d].kon], [`koff${d}`, D[d].koff]])), kdKIR: D.KIR.kd, kdFUA: D.FUA.kd, ermcl: +ermcl },
    parameters: [['TC', 0, 80, 1, 25], ['EFG', 0, 40, 0.5, 20], ['RF1', 0, 10, 0.1, 2], ['TAC', 0, 50, 0.5, 0], ['PAR', 0, 20, 0.1, 0], ['CLM', 0, 50, 0.5, 0], ['ERY', 0, 5, 0.05, 0], ['KIR', 0, 5, 0.05, 0], ['FUA', 0, 20, 0.1, 0]]
      .map(([id, min, max, step, def]) => ({ id, label: id, min, max, step, default: def, unit: 'μM' })),
    variables: { st: { values: ST, init: 'post' }, inc: { values: ['none', 'c', 'n'], init: 'none' }, kir: onoff, E: onoff, fua: onoff, bTAC: onoff, bPAR: onoff, bCLM: onoff, bERY: onoff },
    numbers: { k: { init: 1, min: 0, max: t.n + 1 }, L: { init: 1, min: 0, max: 100000 }, mis: { init: 0, min: 0, max: 1e9 }, nCod: { init: 0, min: 0, max: 1e9 }, lastST: { init: 0, min: 0, max: 1 }, penST: { init: 0, min: 0, max: 1 }, incST: { init: 0, min: 0, max: 1 } },
    tables: { codonClass: { values: t.codonClass, default: 0 }, aST: { values: t.st, default: 0 }, nearST: { values: t.nearST, default: 0 } },
    derived: [{ name: 'cog', expr: 'inc_c' }, { name: 'parOn', expr: 'bPAR_on' }, { name: 'eryStall', expr: 'bERY_on && (ermcl ? L == 9 : L >= 7)' }, { name: 'clmF', expr: 'bCLM_on ? (penST ? 0.003 : 0.1) : 1' }],
    counters: ['cogOff', 'near1', 'near2', 'drop', 'kirN', 'prot', 'misAll', 'codAll'],
    transitions: [
      move('init', '起始（fMet-tRNA 进 P 位）', 'st_init', 'init', { set: { st: 'post', inc: 'none' }, assign: { k: '1', L: '1', mis: '0', nCod: '0', lastST: '0', penST: '0' } }),
      move('rfOn', 'RF1 识别终止密码子', 'st_post && codonClass(k) == 2', 'rf * RF1', { set: { st: 'rf' } }),
      move('tcC', '同源三元复合物结合', 'st_post && codonClass(k) == 1', 'k1 * TC * fc', { set: { st: 'tc', inc: 'c' }, assign: { incST: 'aST(k)' },
        outcomes: [{ weight: kirP, set: { kir: 'on' } }, { weight: `1 - ${kirP}`, set: { kir: 'off' } }] }),
      move('tcN', '近同源三元复合物结合', 'st_post && codonClass(k) == 1', 'k1 * TC * fn', { set: { st: 'tc', inc: 'n' },
        outcomes: [{ weight: `${kirP} * nearST(k)`, set: { kir: 'on' }, assign: { incST: '1' } }, { weight: `${kirP} * (1 - nearST(k))`, set: { kir: 'on' }, assign: { incST: '0' } },
          { weight: `(1 - ${kirP}) * nearST(k)`, set: { kir: 'off' }, assign: { incST: '1' } }, { weight: `(1 - ${kirP}) * (1 - nearST(k))`, set: { kir: 'off' }, assign: { incST: '0' } }] }),
      move('tcOff', '三元复合物离开', 'st_tc', 'km1', { set: { st: 'post', inc: 'none' }, outcomes: [{ weight: 'inc_c', count: { cogOff: 1 } }, { weight: 'inc_n', count: { near1: 1 } }] }),
      move('codon', '密码子识别', 'st_tc && bTAC_off', 'k2', { set: { st: 'cr' } }),
      move('codonOff', '反密码子松开', 'st_cr', 'cog ? km2c : km2n', { set: { st: 'tc' } }),
      move('gtp', 'GTP 水解', 'st_cr', 'cog ? k3c : (parOn ? k3nPar : k3n)', { set: { st: 'gtp' } }),
      move('kirStuck', 'EF-Tu 被黄色霉素卡住', 'st_gtp && kir_on', 'k4', { set: { st: 'kir' }, count: { kirN: 1 } }),
      move('tuOff', 'EF-Tu·GDP 变构离开', '(st_gtp && kir_off) || st_kir', 'st_kir ? kirOff : k4', { set: { st: 'rel' } }),
      move('accom', 'tRNA 容纳进 A 位', 'st_rel', 'cog ? k5c : (parOn ? k5nPar : k5n)', { set: { st: 'acc' } }),
      move('reject', '校对：tRNA 被甩掉', 'st_rel', 'cog ? k7c : (parOn ? k7nPar : k7n)', { set: { st: 'post', inc: 'none' }, outcomes: [{ weight: 'inc_c', count: { cogOff: 1 } }, { weight: 'inc_n', count: { near2: 1 } }] }),
      move('drop', '肽酰-tRNA 掉落', 'st_acc && eryStall', 'ermcl ? dropErm : dropOff', { set: { st: 'drop', E: 'off', inc: 'none' }, count: { drop: 1 } }),
      move('pep', '肽键形成', 'st_acc && !eryStall', 'pep * clmF', { set: { st: 'pre', inc: 'none' }, inc: { L: 1, nCod: 1 }, count: { codAll: 1 }, assign: { penST: 'lastST', lastST: 'incST' },
        outcomes: [{ weight: 'inc_n', count: { misAll: 1 }, inc: { mis: 1 } }, { weight: 'inc_c' }] }),
      move('gOn', 'EF-G·GTP 结合', 'st_pre', 'gOn * EFG', { set: { st: 'g' } }),
      move('trans', '移位', 'st_g', 'trans', { set: { st: 'gpost', E: 'on' }, inc: { k: 1 }, outcomes: [{ weight: fuaP, set: { fua: 'on' } }, { weight: `1 - ${fuaP}`, set: { fua: 'off' } }] }),
      move('gOff', 'EF-G·GDP 离开', 'st_gpost', 'fua_on ? faOff : gOff', { set: { st: 'post', fua: 'off' } }),
      move('hyd', '肽链水解释放', 'st_rf', 'hyd', { set: { st: 'term' }, count: { prot: 1 } }),
      move('recycle', '核糖体回收', 'st_term || st_drop', 'recycle', { set: { st: 'init', E: 'off' } }),
      ...drugs,
      move('eOff', 'E 位 tRNA 离开', 'E_on && !st_g', 'eOff', { set: { E: 'off' } })],
    clocks: [{ name: 'T', add: 'dt' }, { name: 'nonCognate', add: 'st_post && codonClass(k) == 1 ? k1 * TC * (1 - fc - fn) * dt : 0' }],
    observables: [{ name: 'errorRate', label: '错误率（累计）', expr: 'codAll > 0 ? misAll / codAll : 0' }, { name: 'rate', label: '延伸速率', unit: 'aa/s', expr: 'T > 0 ? codAll / T : 0' }],
  };
}
