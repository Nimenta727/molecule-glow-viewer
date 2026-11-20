import { ADK_4AKE_TEMPLATE, normalizeAdkConfig } from './config.mjs';
import { PARAMETERS } from './playback.mjs';

export function adkAuthorFields(config) {
  const text = (path, label, group, maxLength = 120) => ({ path, type: 'text', label, group, maxLength });
  return [
    text('states.open', '张开态结构编号', '结构态', 12), text('states.closed', '闭合态结构编号', '结构态', 12),
    text('protein.chain', '蛋白链', '蛋白', 8),
    { path: 'protein.residues', type: 'number', integer: true, nullable: true, min: 10, max: 5000, step: 1, label: 'Cα 残基数（留空 = 不限）', group: '蛋白' },
    { path: 'maxFitRmsd', type: 'number', min: 0.01, max: 20, step: 0.1, unit: 'Å', label: '叠合 RMSD 上限', group: '蛋白' },
    ...config.domains.map((domain, i) => ({ path: `domains.${i}.color`, type: 'color', label: `${domain.name} 域颜色`, group: '域' })),
    text('ligand.name', '参考配体名称', '配体', 24), { path: 'ligand.color', type: 'color', label: '参考配体颜色', group: '配体' },
    text('navigation.proteinTitle', '蛋白质视图标题', '讲解', 80), text('navigation.mechanismTitle', '机理视图标题', '讲解', 80),
    text('functionalDescription', '功能分区说明', '讲解', 1000), text('evidence.note', '证据说明', '讲解', 500),
    ...config.steps.flatMap((_, i) => [text(`steps.${i}.title`, `第 ${i + 1} 步标题`, '讲解步骤', 80), text(`steps.${i}.caption`, `第 ${i + 1} 步说明`, '讲解步骤', 500)]),
  ];
}

export function adkToolDescriptor(version) {
  const parameters = Object.fromEntries(Object.entries(PARAMETERS).map(([key, field]) => [key, {
    type: 'number', label: field.label, min: field.min, max: field.max, step: field.step, default: field.value,
    ...(key !== 'morph' ? { integer: true } : {}), ...(field.control ? { control: field.control } : {}),
  }]));
  return {
    version, title: ADK_4AKE_TEMPLATE.panel.title, audience: ['view', 'author'], runtime: 'player-v1', parameters,
    author: { template: ADK_4AKE_TEMPLATE, fields: adkAuthorFields, validate: normalizeAdkConfig },
    model: { kind: '两态构象播放器（域拟合 + 按残基位移插值）', assumptions: [
      '中间构象是两套实测坐标的教学插值，不是动力学轨迹。', '不计算反应速率或产物计数；两态开合不等于催化动力学。', '域配色与时间为示意。'] },
  };
}
