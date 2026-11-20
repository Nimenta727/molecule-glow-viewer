import { KCSA_1K4C_TEMPLATE, normalizeKcsaConfig } from './config.mjs';
import { PARAMETERS } from './kinetics.mjs';
import { nodesOfSource, partNameOf } from '../shared/bindings.mjs';

export const KCSA_TOOL = 'org.glow.tool.channel-gating';

export const kcsaSourceId = (scene) => scene.assets.find((asset) => asset.provenance?.parserVersion)?.id;
export const kcsaChannelTest = (cfg) => { const pattern = new RegExp(cfg.protein.namePattern, 'i'); return (node) => pattern.test(partNameOf(node)); };

/** Applicability: as many channel chain nodes as the configuration says (a tetramer: 4); candidates are the matching nodes. */
export function kcsaCheck(scene, config) {
  const cfg = normalizeKcsaConfig(config), found = nodesOfSource(scene, kcsaSourceId(scene)).filter(kcsaChannelTest(cfg));
  const problems = [];
  if (found.length !== cfg.protein.chains) problems.push(`需要 ${cfg.protein.chains} 个通道链节点（名称含“${cfg.protein.namePattern}”），找到 ${found.length} 个。`);
  return { problems, candidates: { channel: found.map(({ id }) => id) } };
}

const UNITS = { V: 'mV', Ki: 'mM', Ko: 'mM', Nai: 'mM', TBA: 'µM', Ba: 'µM', ionSpeed: 'ns/示意秒', gateSpeed: 's/示意秒' };

export function kcsaAuthorFields(config) {
  const text = (path, label, group, maxLength = 120) => ({ path, type: 'text', label, group, maxLength });
  const residue = (path, label, group) => ({ path, type: 'number', integer: true, min: 1, max: 5000, step: 1, label, group });
  return [
    ...['primary:主结构（关闭态）', 'open:开放态', 'inactivated:失活态', 'tba:TBA 结合态', 'barium:Ba²⁺ 结合态'].map((item) => {
      const [role, label] = item.split(':');
      return text(`states.${role}`, `${label}结构编号`, '结构态', 12);
    }),
    { path: 'protein.chains', type: 'number', integer: true, min: 2, max: 6, step: 1, label: '通道链数', group: '通道' },
    residue('pore.fitRange.0', '孔区叠合起始残基', '孔区'), residue('pore.fitRange.1', '孔区叠合终止残基', '孔区'),
    residue('pore.filterResidues.0', '过滤器起始残基', '孔区'), residue('pore.filterResidues.1', '过滤器终止残基', '孔区'),
    { path: 'pore.maxFitRmsd', type: 'number', min: 0.01, max: 20, step: 0.1, unit: 'Å', label: '叠合 RMSD 上限', group: '孔区' },
    text('blockers.tba.residue', 'TBA 残基名', '阻断剂', 8), text('blockers.tba.name', 'TBA 显示名', '阻断剂', 24), { path: 'blockers.tba.color', type: 'color', label: 'TBA 颜色', group: '阻断剂' },
    text('blockers.barium.residue', 'Ba²⁺ 残基名', '阻断剂', 8), text('blockers.barium.name', 'Ba²⁺ 显示名', '阻断剂', 24), { path: 'blockers.barium.color', type: 'color', label: 'Ba²⁺ 颜色', group: '阻断剂' },
    text('particles.potassium.name', 'K⁺ 显示名', '粒子', 40), { path: 'particles.potassium.color', type: 'color', label: 'K⁺ 颜色', group: '粒子' },
    text('particles.sodium.name', 'Na⁺ 显示名', '粒子', 40), { path: 'particles.sodium.color', type: 'color', label: 'Na⁺ 颜色', group: '粒子' },
    text('counterLabels.out', '外流计数名称', '粒子', 24), text('counterLabels.in', '内流计数名称', '粒子', 24), text('counterLabels.sodium', '排斥计数名称', '粒子', 24),
    { path: 'membrane.radius', type: 'number', min: 0.1, max: 100, step: 0.1, label: '膜半径', group: '环境' },
    // Initial experimental conditions, bounded by the kinetics model's own parameter ranges.
    ...Object.entries(PARAMETERS).map(([key, field]) => ({ path: `conditions.${key}`, type: 'number', min: field.min, max: field.max, step: field.step,
      ...(key === 'wt' ? { integer: true } : {}), ...(UNITS[key] ? { unit: UNITS[key] } : {}), default: field.value, label: `初始条件：${field.label}`, group: '初始实验条件' })),
    text('navigation.systemTitle', '系统视图标题', '讲解', 80), text('navigation.proteinTitle', '蛋白质视图标题', '讲解', 80), text('navigation.mechanismTitle', '机理视图标题', '讲解', 80),
    text('evidence.note', '证据说明', '讲解', 500),
    ...config.steps.flatMap((_, i) => [text(`steps.${i}.title`, `第 ${i + 1} 步标题`, '讲解步骤', 80), text(`steps.${i}.caption`, `第 ${i + 1} 步说明`, '讲解步骤', 500)]),
  ];
}

export function kcsaToolDescriptor(version, playerId) {
  const parameters = Object.fromEntries(Object.entries(PARAMETERS).map(([key, field]) => [key, {
    type: 'number', label: field.label, min: field.min, max: field.max, step: field.step, default: field.value,
    ...(key === 'wt' ? { integer: true } : {}), ...(UNITS[key] ? { unit: UNITS[key] } : {}),
  }]));
  return {
    version, title: KCSA_1K4C_TEMPLATE.panel.title, audience: ['view', 'author'], runtime: 'player-v1', parameters,
    aliases: [playerId], player: playerId,
    inputs: { roles: { channel: { label: '通道的各条链', min: 1 } }, check: kcsaCheck },
    author: { template: KCSA_1K4C_TEMPLATE, fields: kcsaAuthorFields, validate: normalizeKcsaConfig },
    model: { kind: '四聚体钾通道门控与渗透（教学速率模型 + 孔道几何）', assumptions: [
      '速率模型用于教学，不是分子动力学。', '门控秒与渗透纳秒分别计时；粒子插值不阻塞模拟时钟。', '开放结构为 E71A；野生型选项只改变动力学。'] },
  };
}
