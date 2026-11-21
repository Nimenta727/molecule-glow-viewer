/**
 * Ready-made starting configurations for the rotary-ATPase tool (`org.glow.tool.rotary-atpase`'s descriptor lives in tool.mjs) besides the built-in bovine 6ZPO one: the same code, another
 * enzyme, only data. Part-name selectors use the structure plugin's matching (plain text = substring, /regex/ with ^ and $).
 */
import { deepFreeze } from '../shared/work-config.mjs';
import { ATP_6ZPO_TEMPLATE } from './config.mjs';

/**
 * Bacillus PS3 F1Fo ATP synthase, 6N2Y (cryo-EM, 3.0 Å): three beta subunits (D, E, F), a c10 ring (chains M-V), ATP and ADP bound. In a bacterial enzyme the rotor is the gamma and epsilon
 * subunits plus the c ring, and the delta subunit belongs to the stator's peripheral stalk (in the bovine entry the mitochondrial delta and epsilon are the rotor's foot, so the part
 * names differ and are listed here by what this entry calls them). Per turn the c10 ring passes 10 protons for 3 ATP. The beta shapes are interpolated between the three catalytic sites of
 * this one entry, as in the bovine case; particles, membrane and time are didactic.
 */
export const ATP_PS3_6N2Y_TEMPLATE = deepFreeze({
  ...ATP_6ZPO_TEMPLATE,
  id: 'atp-synthase-6N2Y',
  parts: { ring: '/subunit c$/', catalytic: 'subunit beta', rotor: ['gamma chain', 'epsilon chain', '/subunit c$/'] },
  counts: { ringSubunits: 10 },
  steps: [
    { title: '质子动力势', caption: '膜两侧的电化学梯度驱动 H⁺ 回流。', parts: ['/subunit a$/'] },
    { title: 'H⁺ 流过 → c 环转动', caption: '这一条目的 c 环有 10 个亚基，每转一圈对应 10 个 H⁺。', parts: ['/subunit a$/', '/subunit c$/'] },
    { title: 'γ 旋转 → β 变构', caption: 'γ 每转 120°，三个 β 位点交换开放、松弛、紧密状态。', parts: ['gamma chain', 'subunit beta'] },
    { title: 'ADP + Pi → ATP', caption: '紧密位点发生 ATP 形成，粒子和反应路径以示意表达。', parts: ['subunit beta'] },
    { title: '开放位点释放 ATP', caption: '转动驱动位点打开。每圈释放 3 个 ATP。', parts: ['subunit beta', 'gamma chain'] },
  ],
  navigation: { idPrefix: 'atp', systemTitle: 'ATP 合酶系统', proteinTitle: 'ATP 合酶结构（枯草芽孢杆菌 PS3）', mechanismTitle: 'ATP 合酶催化机理（c10 环）' },
  panel: {
    ...ATP_6ZPO_TEMPLATE.panel,
    title: 'ATP 合酶（细菌 PS3，c10）',
    evidence: '结构来自沉积坐标 6N2Y（枯草芽孢杆菌 PS3，冷冻电镜 3.0 Å）。β 位点在这一条目的三个催化位点之间插值。粒子、膜和路径为教学示意，时间为示意秒。',
  },
  sceneEvidence: {
    citation: 'ATP 合酶教学播放器（PS3 c10）',
    details: 'c10 环每圈 10 H⁺、3 ATP。β 形状在 6N2Y 三个位点实测坐标之间插值。粒子、路径、膜和时间为示意。',
  },
});
