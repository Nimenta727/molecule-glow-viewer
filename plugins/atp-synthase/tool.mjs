import { ATP_6ZPO_TEMPLATE, normalizeAtpConfig } from './config.mjs';
import { matchesPart } from '../structure/functional-preview.mjs';
import { nodesOfSource, partNameOf } from '../shared/bindings.mjs';

export const ATP_TOOL = 'org.glow.tool.rotary-atpase';

/** The structure file this tool works on, and the scene nodes that came from it. */
export const atpSourceId = (scene) => scene.assets.find((asset) => asset.kind === 'file' && asset.mediaType === 'chemical/x-mmcif')?.id;
export const atpRotorTest = (cfg) => (node) => cfg.parts.rotor.some((name) => matchesPart(partNameOf(node), name));

/** Applicability: does this scene hold a rotary ATPase of the configured shape? Candidates are what the part names select. */
export function atpCheck(scene, config) {
  const cfg = normalizeAtpConfig(config), nodes = nodesOfSource(scene, atpSourceId(scene));
  const ids = (name) => nodes.filter((node) => matchesPart(partNameOf(node), name)).map(({ id }) => id);
  const ring = ids(cfg.parts.ring), catalytic = ids(cfg.parts.catalytic), rotor = nodes.filter(atpRotorTest(cfg)).map(({ id }) => id);
  const problems = [];
  if (!nodes.length) problems.push('场景里没有结构部件：先导入结构。');
  else {
    if (!ring.length) problems.push(`没有名称含“${cfg.parts.ring}”的 c 环部件。`);
    else if (cfg.counts.ringSubunits !== null && ring.length !== cfg.counts.ringSubunits) problems.push(`c 环有 ${ring.length} 个亚基，配置要求 ${cfg.counts.ringSubunits} 个。`);
    if (catalytic.length !== 3) problems.push(`催化亚基（${cfg.parts.catalytic}）有 ${catalytic.length} 个，需要 3 个。`);
  }
  return { problems, candidates: { rotor } };
}

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
    ...[0, 1, 2, 3].map((i) => ({ path: `machine.stageAt.${i}`, type: 'number', min: 0.01, max: 0.99, step: 0.01, label: `阶段分界 ${i + 1}（占 1/3 圈位点周期的比例）`, group: '状态机' })),
    { path: 'machine.morph.start', type: 'number', min: 0, max: 0.99, step: 0.01, label: 'β 变形开始（位点周期比例）', group: '状态机' },
    { path: 'machine.morph.span', type: 'number', min: 0.01, max: 1, step: 0.01, label: 'β 变形持续（位点周期比例）', group: '状态机' },
    { path: 'machine.speed.default', type: 'number', min: 0.05, max: 3, step: 0.05, label: '默认转速（转 / 示意秒）', group: '状态机' },
    text('eventLabel', '事件名称', '讲解', 80),
    text('navigation.systemTitle', '系统视图标题', '讲解', 80), text('navigation.proteinTitle', '蛋白质视图标题', '讲解', 80),
    text('navigation.mechanismTitle', '机理视图标题', '讲解', 80),
    ...config.steps.flatMap((_, i) => [text(`steps.${i}.title`, `第 ${i + 1} 步标题`, '讲解步骤', 80), text(`steps.${i}.caption`, `第 ${i + 1} 步说明`, '讲解步骤', 500)]),
  ];
}

export function atpToolDescriptor(version, playerId) {
  return {
    version, title: ATP_6ZPO_TEMPLATE.panel.title, audience: ['view', 'author'], runtime: 'player-v1',
    aliases: [playerId], player: playerId,   // works saved before the rename name the tool by its player id
    inputs: { roles: { rotor: { label: '转子部件（随转轴旋转的亚基）', min: 1 } }, check: atpCheck },
    parameters: {},   // rotation speed and seed are the clock controls the Viewer shows itself
    author: { template: ATP_6ZPO_TEMPLATE, fields: atpAuthorFields, validate: normalizeAtpConfig },
    outputs: [{ key: 'rotation', label: '转子角度', kind: 'state', unit: '°' }, { key: 'protons', label: '穿过的质子数', kind: 'count' }, { key: 'atp', label: '合成的 ATP 数', kind: 'count' }, { key: 'events', label: '质子 / ATP 事件', kind: 'event' }],
    dependencies: [{ id: 'org.glow.structure', version: '1.0.0' }],
    model: { kind: '旋转 ATP 酶几何播放器（环旋转 + 三位点构象插值）', assumptions: [
      '结构来自沉积坐标；β 位点在三个实测构象之间插值。', '粒子、膜和路径为教学示意，时间为示意秒。', '导入任意结构不意味着自动得到正确的生物机制。'] },
  };
}
