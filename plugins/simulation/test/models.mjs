// The two classic compartment models (src/sim/processes/respiratory-chain.js and chloroplast.js `cell`) written as data. They are the acceptance evidence of the
// kinetic-model format: tools/kinetics-parity.mjs runs the classic code and these data models side by side. (They are not shipped works; works come in 4.4.8.)
const toggle = (id, label, tip, on) => ({ id, type: 'toggle', label, tip, default: on });

export const respiratoryChain = {
  version: 1, title: '线粒体呼吸链：区室动力学',
  constants: { NADt: 3, At: 3 },
  state: { pmf: 0, nadh: 0.5, atp: 1.0 },
  controls: [
    toggle('sub', '底物（NADH）', '三羧酸循环供应 NADH', true), toggle('o2', 'O₂', '关 = 缺氧 / 氰化物抑制复合体 IV', true), toggle('demand', '高耗能（运动）', '细胞消耗 ATP 加快 3 倍', false),
    toggle('oligo', '寡霉素', '堵住 ATP 合酶的 H⁺ 通道', false), toggle('dnp', 'DNP 解偶联', '2,4-二硝基苯酚：把 H⁺ 直接带回基质', false)],
  step: [
    { let: 'nad', expr: 'NADt - nadh' }, { let: 'adp', expr: 'At - atp' }, { let: 'pmf0', expr: 'pmf' },
    { let: 'fbp', expr: '1 / (1 + exp((pmf0 - 205) / 7))' },
    { let: 'Je', expr: '1.2 * (o2 ? 1 : 0) * fbp * nadh / (nadh + 0.3)' },
    { let: 'x', expr: 'max(0, (pmf0 - 140) / 30)' },
    { let: 'Jatp', expr: 'oligo ? 0 : 1.0 * x / (1 + x) * adp / (adp + 0.15)' },
    { let: 'Jleak', expr: '0.25 * pmf0 / 180 * (dnp ? 30 : 1)' },
    { set: 'pmf', expr: 'max(0, pmf0 + h * (5 * Je - 11 / 3 * Jatp - Jleak) * 60)' },
    { set: 'nadh', expr: 'min(NADt, max(0, nadh + h * (0.8 * (sub ? 1 : 0) * nad / (nad + 0.3) - Je / 2)))' },
    { let: 'Juse', expr: '0.35 * (demand ? 3 : 1) * atp / (atp + 0.4)' },
    { set: 'atp', expr: 'min(At, max(0, atp + h * (Jatp - Juse)))' },
    { let: 'rate', expr: 'Je / 0.3' }, { let: 'rotor', expr: 'min(2.5, Jatp / 0.3)' }],
  series: [
    { label: '膜间隙 pH', range: [6.6, 7.4], color: '#ff7a3d', expr: '7.2 - 0.4 * 0.0045 * pmf', format: { digits: 2 } },
    { label: '基质 pH', range: [7.0, 8.0], color: '#4f8ff0', expr: '7.2 + 0.6 * 0.0045 * pmf', format: { digits: 2 } },
    { label: '膜电位 Δψ', range: [0, 180], color: '#c04fd0', expr: 'pmf * (1 - 59 * 0.0045)', format: { digits: 0, unit: ' mV' } },
    { label: '耗氧速率', range: [0, 4], color: '#22b8cf', expr: 'Je / 0.284', format: { digits: 0, scale: 100, unit: ' %' } },
    { label: 'ATP', range: [0, 3], color: '#e8a000', expr: 'atp', format: { digits: 2, unit: ' mM' } },
    { label: 'NADH', range: [0, 3], color: '#d9480f', expr: 'nadh', format: { digits: 2, unit: ' mM' } }],
  compartments: [{ name: '基质（matrix）', pH: '7.2 + 0.6 * 0.0045 * pmf' }, { name: '膜间隙（IMS）', pH: '7.2 - 0.4 * 0.0045 * pmf' }],
  dots: [
    { label: 'H⁺', comp: 'bot', color: '#fff27a', ink: '#f5c400', r: 2.0, max: 60, count: '1 + 38 * 10 ^ (6.82 - (7.2 - 0.0018 * pmf))' },
    { label: 'H⁺', comp: 'top', color: '#fff27a', ink: '#f5c400', r: 2.0, max: 30, count: '1 + 38 * 10 ^ (6.82 - (7.2 + 0.0027 * pmf))' },
    { label: 'ATP', comp: 'top', color: '#ff9a2e', ink: '#f07a12', r: 3.0, max: 40, count: '30 * atp / 3' },
    { label: 'NADH', comp: 'top', color: '#ff6fa8', ink: '#d9467e', r: 3.4, max: 30, count: '24 * nadh / 3' }],
  explain: [
    { when: '!o2', text: '缺氧 / 氰化物：复合体 IV 无法把电子交给 O₂，整条链堵住，NADH 无法氧化，质子动力势消失，ATP 合成停止——这就是氰化物致死的原因。' },
    { when: 'dnp', text: 'DNP 把 H⁺ 直接带回基质：质子动力势降到约 {pmf|0} mV，“反压”消失，耗氧速率飙到 {Je / 0.284 * 100|0}%，但能量变成热，ATP 几乎为零（20 世纪 30 年代曾被当减肥药，致死）。' },
    { when: 'oligo', text: '寡霉素堵住 ATP 合酶：H⁺ 回不来，膜电位升到约 {pmf * 0.73|0} mV，电子传递被“反压”压到 {Je / 0.284 * 100|0}%（呼吸控制）；细胞继续耗 ATP，ATP 越来越少。' },
    { when: '!sub', text: 'NADH 供应中断：电子来源耗尽，耗氧和质子泵停下，质子动力势逐渐消失。' },
    { when: 'demand', text: '高耗能：ATP 被快速消耗，ADP 增多，ATP 合酶加速回流 H⁺，质子动力势略降，“反压”减小，电子传递和耗氧自动加快到 {Je / 0.284 * 100|0}%——这就是呼吸控制。' },
    { text: '静息稳态：膜电位约 {pmf * 0.73|0} mV + ΔpH 约 {0.0045 * pmf|1}，质子动力势约 {pmf|0} mV。ATP 充足、ADP 少，ATP 合酶转得慢，电子传递也被“反压”压低。试试“高耗能”“寡霉素”“DNP”。' }],
};

export const chloroplast = {
  version: 1, title: '叶绿体光反应：区室动力学',
  constants: { Nt: 0.5, At: 1.5 },
  state: { L: 0, act: 0, dpH: 0, nadph: 0.05, atp: 0.5 },
  controls: [toggle('light', '☀ 光照', '关灯：电子传递停止，看 ΔpH 和 ATP 怎样消退', true), toggle('cef', '环式电子流', 'Fd → PQ → b6f → PSI：只泵 H⁺、不产 NADPH，补足 ATP', true),
    toggle('unc', '解偶联剂', '例如 NH₄Cl / 尼日利亚菌素：H⁺ 直接漏回基质', false), toggle('oligo', '抑制 ATP 合酶', '例如 tentoxin：H⁺ 出不去', false)],
  step: [
    { set: 'L', expr: 'L + ((light ? 1 : 0) - L) * min(1, h / 0.3)' }, { set: 'act', expr: 'act + ((light ? 1 : 0) - act) * min(1, h / 6)' },
    { let: 'nadp', expr: 'Nt - nadph' }, { let: 'adp', expr: 'At - atp' }, { let: 'dpH0', expr: 'dpH' },
    { let: 'fbp', expr: '1 / (1 + exp((dpH0 - 2.5) / 0.15))' },
    { let: 'Je', expr: '0.8 * L * fbp * nadp / (nadp + 0.04)' },
    { let: 'Jc', expr: 'cef ? 0.35 * L * fbp * (nadph / Nt) ^ 2 : 0' },
    { let: 'dpsi', expr: '20 * (1 - exp(-dpH0 / 0.6))' }, { let: 'pmf', expr: '59 * dpH0 + dpsi' }, { let: 'x', expr: 'max(0, (pmf - 95) / 45)' },
    { let: 'Jatp', expr: 'oligo ? 0 : 0.55 * x / (1 + x) * adp / (adp + 0.25)' },
    { let: 'Jleak', expr: '0.07 * dpH0 * (unc ? 20 : 1)' },
    { set: 'dpH', expr: 'max(0, dpH0 + h * (3 * Je + 2 * Jc - 14 / 3 * Jatp - Jleak) / 1.2)' },
    { let: 'Jcal', expr: '0.12 * act * atp / (atp + 0.3) * nadph / (nadph + 0.05)' },
    { set: 'nadph', expr: 'min(Nt, max(0, nadph + h * (Je / 2 - 2 * Jcal)))' },
    { set: 'atp', expr: 'min(At, max(0, atp + h * (Jatp - 3 * Jcal - 0.01 * atp)))' },
    { let: 'rate', expr: 'Je / 0.3' }, { let: 'rotor', expr: 'min(2.5, Jatp / 0.24)' }],
  series: [
    { label: '类囊体腔 pH', range: [5.2, 7.4], color: '#ff7a3d', expr: '7.0 - 0.55 * dpH', format: { digits: 2 } },
    { label: '基质 pH', range: [6.8, 8.4], color: '#4f8ff0', expr: '7.0 + 0.45 * dpH', format: { digits: 2 } },
    { label: '质子动力势', range: [0, 190], color: '#c04fd0', expr: 'pmf', format: { digits: 0, unit: ' mV' } },
    { label: '电子流', range: [0, 1.5], color: '#22b8cf', expr: 'Je / 0.3', format: { digits: 0, scale: 100, unit: ' %' } },
    { label: 'ATP', range: [0, 1.5], color: '#e8a000', expr: 'atp', format: { digits: 2, unit: ' mM' } },
    { label: 'NADPH', range: [0, 0.5], color: '#d9480f', expr: 'nadph', format: { digits: 2, unit: ' mM' } },
    { label: 'CO₂ 固定', range: [0, 0.1], color: '#2f9e44', expr: 'Jcal', format: { digits: 0, divide: 0.079, scale: 100, unit: ' %' } }],
  compartments: [{ name: '基质（stroma）', pH: '7.0 + 0.45 * dpH' }, { name: '类囊体腔（lumen）', pH: '7.0 - 0.55 * dpH' }],
  dots: [
    { label: 'H⁺', comp: 'bot', color: '#fff27a', ink: '#f5c400', r: 2.0, max: 60, count: '1 + 40 * 10 ^ (5.6 - (7.0 - 0.55 * dpH))' },
    { label: 'H⁺', comp: 'top', color: '#fff27a', ink: '#f5c400', r: 2.0, max: 20, count: '1 + 40 * 10 ^ (5.6 - (7.0 + 0.45 * dpH))' },
    { label: 'ATP', comp: 'top', color: '#ff9a2e', ink: '#f07a12', r: 3.0, max: 40, count: '30 * atp / 1.5' },
    { label: 'NADPH', comp: 'top', color: '#ff6fa8', ink: '#d9467e', r: 3.4, max: 30, count: '24 * nadph / 0.5' }],
  explain: [
    { when: '!light && dpH > 0.3', text: '黑暗：电子传递停止，腔内积累的 H⁺ 经 ATP 合酶和漏流回到基质，ΔpH 正在消退（腔 pH {7 - 0.55 * dpH|1}）；卡尔文循环的酶随之失活。' },
    { when: '!light', text: '黑暗：没有质子梯度，ATP 合酶停转，卡尔文循环停止。按“☀ 光照”看光照后几秒内腔内怎样酸化。' },
    { when: 'unc', text: '解偶联剂让 H⁺ 不经 ATP 合酶直接漏回基质：ΔpH 崩塌，ATP 合酶停转，ATP 耗尽，卡尔文循环停下，NADPH 堆积，电子传递也因没有 NADP⁺ 而停。' },
    { when: 'oligo', text: 'ATP 合酶被抑制：H⁺ 只进不出，腔 pH 降到约 {7 - 0.55 * dpH|1} 后 b6f 被“反压”抑制（光合控制，保护 PSII），电子流变慢；没有 ATP，卡尔文循环停下。' },
    { when: '!cef && atp < 0.6', text: '没有环式电子流：线性电子流每个 NADPH 只配约 1.29 个 ATP，卡尔文循环需要 1.5 → ATP 不够、NADPH 堆积，NADP⁺ 不足又卡住了电子传递。再打开“环式电子流”。' },
    { when: 'dpH < 2', text: '刚开灯：电子传递把 H⁺ 泵进类囊体腔，腔 pH 迅速下降（{7 - 0.55 * dpH|1}），基质变碱（{7 + 0.45 * dpH|1}）；ΔpH 超过阈值后 ATP 合酶开始转动。' },
    { when: 'cef', text: '光照稳态：腔 pH ≈ {7 - 0.55 * dpH|1}，基质 pH ≈ {7 + 0.45 * dpH|1}，ΔpH ≈ {dpH|1}（叶绿体的质子动力势主要是 ΔpH）。ATP 和 NADPH 被卡尔文循环按 3 : 2 消耗，环式电子流补足 ATP。' },
    { text: '光照稳态：腔 pH ≈ {7 - 0.55 * dpH|1}，基质 pH ≈ {7 + 0.45 * dpH|1}，ΔpH ≈ {dpH|1}（叶绿体的质子动力势主要是 ΔpH）。ATP 和 NADPH 被卡尔文循环按 3 : 2 消耗。' }],
};
