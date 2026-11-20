import { ATP_6ZPO_TEMPLATE, normalizeAtpConfig } from './config.mjs';

/** Editable fields of the ATP work configuration, for the author front end (paths into scene.tools[].config). */
export function atpAuthorFields(config) {
  const text = (path, label, group, maxLength = 120) => ({ path, type: 'text', label, group, maxLength });
  return [
    text('parts.ring', 'c 环部件名', '部件选择'),
    text('parts.catalytic', '催化亚基（β）部件名', '部件选择'),
    { path: 'counts.ringSubunits', type: 'number', integer: true, nullable: true, min: 3, max: 64, step: 1, label: 'c 亚基数（留空 = 按结构检测）', group: '部件选择' },
    text('particles.proton.name', '质子名称', '粒子', 40), { path: 'particles.proton.color', type: 'color', label: '质子颜色', group: '粒子' },
    { path: 'particles.adp.color', type: 'color', label: 'ADP 颜色', group: '粒子' },
    { path: 'particles.atp.color', type: 'color', label: 'ATP 颜色', group: '粒子' },
    { path: 'particles.phosphate.color', type: 'color', label: 'Pi 颜色', group: '粒子' },
    text('eventLabel', '事件名称', '讲解', 80),
    text('navigation.systemTitle', '系统视图标题', '讲解', 80), text('navigation.proteinTitle', '蛋白质视图标题', '讲解', 80),
    text('navigation.mechanismTitle', '机理视图标题', '讲解', 80),
    ...config.steps.flatMap((_, i) => [text(`steps.${i}.title`, `第 ${i + 1} 步标题`, '讲解步骤', 80), text(`steps.${i}.caption`, `第 ${i + 1} 步说明`, '讲解步骤', 500)]),
  ];
}

export function atpToolDescriptor(version) {
  return {
    version, title: ATP_6ZPO_TEMPLATE.panel.title, audience: ['view', 'author'], runtime: 'player-v1',
    parameters: {},   // rotation speed and seed are the clock controls the Viewer shows itself
    author: { template: ATP_6ZPO_TEMPLATE, fields: atpAuthorFields, validate: normalizeAtpConfig },
    model: { kind: '旋转 ATP 酶几何播放器（环旋转 + 三位点构象插值）', assumptions: [
      '结构来自沉积坐标；β 位点在三个实测构象之间插值。', '粒子、膜和路径为教学示意，时间为示意秒。', '导入任意结构不意味着自动得到正确的生物机制。'] },
  };
}
