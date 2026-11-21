/**
 * Ready-made starting configurations for the two-state conformation tool (`org.glow.tool.conformation-pair`) besides the built-in adenylate kinase one: the same
 * code, another protein, only data. Domain ranges use author residue numbers and must cover every residue of the chain (a residue in no domain has nowhere to move with).
 */
import { deepFreeze } from '../shared/work-config.mjs';

/**
 * Maltose-binding protein: ligand-free "open" 1OMP and maltose-bound "closed" 1ANF (chain A, 370 residues each). The N domain is the reference (fitted first), the C domain and the
 * hinge segments are measured against it. The domain boundaries are from the literature as the author remembers it and wait for expert confirmation; the numbers the tool shows are
 * computed from the two coordinate sets (N domain RMSD 0.72 Å over 155 residues; C domain 36.2° / 10.2 Å), and the shapes in between are an interpolation, not a path.
 */
export const MBP_1OMP_1ANF_TEMPLATE = deepFreeze({
  id: 'mbp-1OMP-1ANF',
  states: { open: '1OMP', closed: '1ANF' },
  protein: { organism: '大肠杆菌', chain: 'A', residues: 370, namePattern: 'maltodextrin|maltose' },
  domains: [
    { name: 'N', ranges: [[1, 109], [264, 309]], color: '#819fc5' },
    { name: 'C', ranges: [[114, 259], [317, 370]], color: '#dba565' },
    { name: '铰链', ranges: [[110, 113], [260, 263], [310, 316]], color: '#79b29c' },
  ],
  fitDomain: 'N',
  maxFitRmsd: 3,
  ligand: { residue: 'GLC', chain: 'B', name: '麦芽糖', color: '#bd6db6' },
  steps: [
    { title: '无配体的张开态（讲解）', caption: '1OMP 是不带配体的结构，两个结构域之间的裂缝张开。' },
    { title: '两个结构域的开合', caption: '1OMP 与 1ANF 在 N 域上叠合后，C 域整体转动约 36°，裂缝闭合。中间形状是两套坐标的教学插值，不是真实路径。' },
    { title: '麦芽糖被夹住（讲解）', caption: '1ANF 带着麦芽糖，糖位于两个结构域之间。此处的麦芽糖是 1ANF 的实测坐标，仅在闭合端显示。' },
    { title: '重新打开（讲解）', caption: '往复展示闭合态重新张开；释放过程用文字说明，时间轴单位为示意秒。' },
  ],
  navigation: { idPrefix: 'mbp', proteinTitle: '麦芽糖结合蛋白：N 域 / C 域 / 铰链', mechanismTitle: '麦芽糖结合蛋白的开合' },
  panel: {
    title: '麦芽糖结合蛋白', parametersTitle: '构象与参考配体', speedLabel: '构象往复倍率', seedLabel: '重放种子（本展示无随机事件）',
    evidence: '1OMP 张开态 ⇄ 1ANF 麦芽糖闭合态，A 链 370 残基。按 N 域叠合；N 域 1–109 与 264–309，C 域 114–259 与 317–370，其余为铰链。域配色及中间形状为教学表达；麦芽糖为 1ANF 实测坐标，仅在闭合端显示。',
  },
  functionalDescription: '蓝色 N 域、橙色 C 域、绿色铰链。各域用残基坐标生成密度叶片并向域中心收缩 1.5 Å 露出接缝；两态之间按残基位移插值。颜色和中间表面为示意。',
  metricsLegend: '（相对张开态 N 域；蓝 N 域、橙 C 域、绿铰链）',
  evidence: { citation: '麦芽糖结合蛋白两态构象（1OMP / 1ANF）', note: '域配色、中间构象和时间为示意；麦芽糖为实测坐标，无结合动力学。域的划分待专业人员确认。' },
});
