import { selectionSpace, evaluateSelection, describeSelection } from '../../plugins/structure/selection.mjs';
import { applyColor, createColorState } from '../viewer-web/color-scheme.mjs';
import { applyStyle } from '../../plugins/structure/look.mjs';
import { LOOK_PACKS, LOOK_PACK_IDS, lookPackById, colorStateOf } from '../../plugins/structure/look-packs.mjs';
import { buildSurface, SCHEMES as SURFACE_SCHEMES } from '../../plugins/structure/molecular-surface.mjs';
import { contactsBetween } from '../../plugins/structure/contacts.mjs';
import { interactionsBetween } from '../../plugins/structure/interactions.mjs';
import { compositionOf } from '../../plugins/structure/composition.mjs';
import { secondaryOf } from '../../plugins/structure/secondary.mjs';
import { superposeParts, motionOf } from '../../plugins/structure/superposition.mjs';
import { validatePanel, createPanelContext } from '../../packages/plugin-host/panels.mjs';
import { contactsPanel, interfaceRules, bondLines, summarize as contactsSummary, typedSummary, recordResult as recordContacts } from '../../plugins/structure/panels/contacts-panel.mjs';
import { compositionPanel, describe as compositionLines, recordResult as recordComposition } from '../../plugins/structure/panels/composition-panel.mjs';
import { secondaryPanel, share, recordResult as recordSecondary } from '../../plugins/structure/panels/secondary-panel.mjs';
import { superpositionPanel, summarize as superposeSummary, farResidues, FAR, FAR_COLOR, recordResult as recordSuperposition } from '../../plugins/structure/panels/superposition-panel.mjs';
import { surfacePanel, describe as surfaceDescribe, recordResult as recordSurface } from '../../plugins/structure/panels/surface-panel.mjs';
import { expressionsFor } from '../../plugins/structure/contacts.mjs';
import { computeAnnotations, validateMeasures, validateLabels } from '../../plugins/structure/annotations.mjs';

/**
 * The Studio's command interface for AI (`window.studio`): every authoring and analysis step of the Studio as one JSON command, with the same checks as the panels (the commands go through the same
 * doors of packages/plugin-host/panels.mjs) and a structured answer: numbers, what was written into the work, and the limits an honest report has to carry. Nothing here clicks the page.
 * Rules for whoever drives it: ask `help()` first; read `limits` in every analysis answer and pass them on; a result computed here is DERIVED, never "measured"; check geometry by recomputing it independently.
 */
export const STUDIO_COMMANDS = {
  help: '列出命令、参数和这个接口的使用规矩；help("命令名") 只看一条。',
  info: '当前场景：标题、结构（编号、链、残基数）、对象、已有的规则条数（颜色/样式/表面/测量/标签/连线）、证据、镜头关键帧、能否撤销。',
  structures: '列出场景里所有结构：{id,label,chains,residues,atoms}；第 1 个是外观规则、标注和表面作用的那个。',
  import: '用一个结构新建作品：{pdb:"4位编号"} 或 {name:"x.cif", text:"mmCIF/PDB 文本"} 或 {name, base64}。会替换当前场景（当前工程里新增一个场景）。',
  addStructure: '把另一个结构加入当前场景（最多共 4 个）：参数同 import。它从原点开始，和第一个结构重叠；之后用 superpose 对齐。',
  select: '用选择语言选一部分：select("chain A and resi 10-50")；select("none") 清除。返回选中的残基数和说明，并把它设为“当前选择”（分析命令的默认输入）。选择语言：all | protein | nucleic | ligands | chain A | resi 10-50 | resn HIS | within 5 of <选择> | and / or / not。',
  show: '对选择设表示（PyMOL 的 show/hide）：show("resi 1-30","hidden")；show("chain B","sticks")；样式 cartoon / backbone / blob / sticks（逐原子，叠在卡通上，一次最多 300 个残基）/ hidden；show("reset") 清除。规则，随作品保存，后面的覆盖前面的。',
  color: '上色：color("chain A","#e05a4a")；color("resi 1-60","hydrophobicity")；方案 hydrophobicity / bfactor / charge / secondary / rainbow；color("chain") 按链；color("reset") 清除。规则，随作品保存。',
  surface: '分子表面：surface("chain A","electrostatic")；配色 electrostatic（简化库仑，不是 APBS）/ hydrophobicity / plain（单色，可带第三个参数 "#rrggbb"：surface("nucleic","plain","#d92f1c")）；一个表面最多 25 万个原子（核糖体级别用 1.25 Å 以上的粗网格）；surface("clear") 清除；返回三角形数和静电势范围。最多 4 个。',
  lookPack: '光影包（整张图的光影与配色）：lookPack() 列出；lookPack("glow.cell-dark") 应用（同时把它的配色写成颜色规则，lookPack(id,{recolor:false}) 只换光影）；lookPack("none") 回到默认的墨线风格。可用：glow.cell-dark（暗场·细胞内部）、glow.membrane-cool（冷光·膜蛋白）、glow.active-site-warm（暖光·活性位点）、paper.clean-white（论文白底）。只改外观，不改坐标和任何分析结果。',
  measure: '测量并保存：measure("chain A and resi 10","chain A and resi 40") 距离（Å，Cα）；三个选择量角度（第二个是顶点）。每个选择必须正好一个残基。',
  label: '给选择加文字标签并保存：label("chain A and resi 57","催化残基")；text 留空则写残基名。',
  annotations: '读或清除已保存的标注：annotations() 返回测量/标签/连线；annotations("clear") 清空。',
  contacts: '两部分之间的接触：contacts({a,b,cutoff?,classify?,write?})。a、b 是选择；返回残基对、界面残基数，classify 默认 true（氢键/盐桥/疏水，仅距离判据、无角度）。write 可含 "paint"（界面涂色）、"draw"（氢键和盐桥画线）、"record"（记为推导证据）。',
  composition: '选中部分的残基组成、GRAVY、按个数数出的净电荷：composition({part, write?})；write 可含 "hydrophobicity"、"charge"（涂色）、"record"。',
  secondary: '序列与文件里登记的二级结构：secondary({part, write?})；write 可含 "paint"、"record"。',
  superpose: '结构叠合（Cα 的 Horn 拟合）：superpose({mobile, reference, mobileStructure?, referenceStructure?, mode?:"number"|"order", write?})。mobile 必须在同一条链里；结构用 structures() 里的 id（默认第 1 个、参考默认同一个）。write 可含 "place"（移动整条链）、"mark"（偏差 > 2 Å 的残基标红）、"record"、"reset"（还原位置）。',
  camera: '读或设镜头：camera() 读；camera({position:[x,y,z],target:[x,y,z]}) 设；camera("reset") 重置。',
  cameraKey: '在时间 t（秒）存一个镜头关键帧：cameraKey({time, position?, target?})，省略位置则用当前镜头；cameraKey({remove:"编号"}) 删除；cameraKey() 列出。',
  note: '加一条讲解：note("文字")；note("文字",{node:"对象编号"}) 挂在一个对象上。',
  title: '设置场景标题：title("…")。',
  undo: '撤销一步（返回 undone: true/false）。', redo: '重做一步（返回 redone: true/false）。',
  snapshot: '画布 PNG：snapshot({width?:64..4096}) 返回 data URL。',
  exportScene: '导出场景包（含原始坐标）：返回 {format:"glow-v3",encoding:"base64",data,bytes}。',
};
export const READ_ONLY = new Set(['help', 'info', 'structures', 'annotations', 'snapshot', 'exportScene', 'camera']);

/** Limits an honest report has to carry (short forms of the status.limits in plugins/packages/*.json). */
export const LIMITS = Object.freeze({
  contacts: ['接触是几何事实（重原子距离），不代表亲和力', '氢键、盐桥分类只用距离（氢键 2.4–3.5 Å、盐桥 ≤ 4.0 Å、疏水 ≤ 4.0 Å），没有氢原子和角度判据，不能替代 ChimeraX 的做法；His 不计入盐桥，Asn/Gln 翻转未处理'],
  composition: ['净电荷只是数 Lys/Arg（+1）和 Asp/Glu（−1），His 记 0，不含 pKa、环境、末端和配体', 'GRAVY 用 Kyte–Doolittle 经验标度'],
  secondary: ['二级结构是文件里登记的，不预测也不重新计算；没有登记的文件全部显示为“其他”'],
  superpose: ['只用 Cα（核酸 P）拟合，不迭代剔除离群点，也不做序列比对', '移动的是整条链；移动之后高亮、测量、标签、界面列表和表面仍按原始坐标，不会跟着走', '两个结构各在自己的原始坐标系里，叠合前 RMSD 没有意义；哪些残基算“核心”由使用者决定', '位置是计算出来的，不是测得的'],
  surface: ['高斯分子表面，近似溶剂排除面，不是严格 SES', '静电是简化库仑（形式电荷加通用主链部分电荷，ε = 4r，表面外 1.4 Å，kcal/(mol·e)），不是 APBS，只适合定性比较', '表面是半透明叠加层，不跟着移动过的链走'],
});

const COMMAND_PANEL = validatePanel({ id: 'org.glow.studio.api', title: 'Studio 命令', mount() {} });
const text = (value, what) => { if (typeof value !== 'string' || !value.trim()) throw new Error(`${what}应为非空文字。`); return value.trim(); };
const options = (value, allowed, what) => {
  if (value == null) return {};
  if (typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some((key) => !allowed.includes(key))) throw new Error(`${what}只接受 ${allowed.join('、')}。`);
  return value;
};
const writes = (value, allowed, what) => {
  const list = value == null ? [] : Array.isArray(value) ? value : [value];
  const bad = list.find((item) => !allowed.includes(item));
  if (bad !== undefined) throw new Error(`${what}的 write 只接受 ${allowed.join('、')}（收到 ${JSON.stringify(bad)}）。`);
  return new Set(list);
};
const top = (items, n = 12) => items.slice(0, n);
const nameOf = (r) => `${r.resn} ${r.chain}:${r.authSeq}${r.insertion || ''}`;

/**
 * `env` is what the Studio page provides (see apps/studio-web/main.mjs); the adapter holds no state of its own.
 *   scene(), structureList(), selectionBox: { get(), set(expression) }, hostFor(panel), lookState(), chainIds(), applyLook(patch, message), annotations(), applyAnnotations(patch, message),
 *   importWork(structure), addStructure(structure), loadRcsb(code), camera: { get(), set(pose), reset() }, cameraKeys: { list(), add(key, pose), remove(id) }, note(text, nodeId), title(text),
 *   ready() (resolves when the structures of the scene are parsed), undo(), redo(), snapshot(width), exportScene()
 */
export function createStudioAdapter(env) {
  const doors = (panel) => createPanelContext(panel, env.hostFor(panel));
  const entry = (id) => { const list = env.structureList(); const found = id == null ? list[0] : list.find((item) => item.id === id); if (!found) throw new Error(id == null ? '这个场景还没有结构：先 import。' : `没有结构 ${String(id)}：用 structures() 看编号。`); return found; };
  const check = (model) => (expression) => evaluateSelection(expression, selectionSpace(model)).residues.length;
  const primary = () => entry();
  const done = (data, note) => ({ ok: true, ...data, ...(note ? { note } : {}) });

  const structureInfo = ({ id, label, model }) => {
    const space = selectionSpace(model), chains = [...new Set(space.residues.map((r) => r.chain))];
    return { id, label, chains, residues: space.residues.length, ligands: space.ligands.length, atoms: model.atoms?.length ?? 0 };
  };
  async function structureFrom(args) {
    const value = options(args, ['pdb', 'name', 'text', 'base64'], '参数');
    if (value.pdb) { const code = String(value.pdb).trim(); if (!/^[0-9A-Za-z]{4}$/.test(code)) throw new Error('pdb 应为 4 位编号。'); return env.loadRcsb(code); }
    if (typeof value.text === 'string' && value.text.trim()) return { name: String(value.name ?? 'structure.cif'), bytes: new TextEncoder().encode(value.text) };
    if (typeof value.base64 === 'string' && value.base64) return { name: String(value.name ?? 'structure.cif'), bytes: Uint8Array.from(atob(value.base64), (c) => c.charCodeAt(0)) };
    throw new Error('需要 {pdb} 或 {name, text} 或 {name, base64}。');
  }

  const commands = {
    info() {
      const scene = env.scene(), state = env.lookState(), notes = env.annotations(), view = env.structureList();
      return done({
        scene: { id: scene.id, title: scene.title, duration: scene.timeline.duration, nodes: scene.nodes.length },
        structures: view.map(structureInfo), selection: env.selectionBox.get().expression,
        rules: { colors: state.colors.residues.length + Object.keys(state.colors.chains).length, styles: state.styles.length, surfaces: state.surfaces.length, measures: notes.measures.length, labels: notes.labels.length, bonds: notes.bonds.length },
        evidence: scene.evidence.length, cameraKeys: env.cameraKeys.list().length, canUndo: env.canUndo(), canRedo: env.canRedo(),
      });
    },
    structures() { return done({ structures: env.structureList().map(structureInfo) }); },
    async import(args) { const structure = await structureFrom(args); await env.importWork(structure); await env.ready(); return commands.info(); },
    async addStructure(args) { const structure = await structureFrom(args); await env.addStructure(structure); await env.ready(); return done({ structures: env.structureList().map(structureInfo) }, '新结构从原点开始，和第一个结构重叠；用 superpose 对齐。'); },
    select(expression) {
      const raw = text(expression, '选择表达式');
      if (raw.toLowerCase() === 'none') { env.selectionBox.set(''); return done({ expression: '', residues: 0, ligands: 0 }); }
      const { model } = primary(), found = evaluateSelection(raw, selectionSpace(model));
      env.selectionBox.set(raw);
      return done({ expression: raw, residues: found.residues.length, ligands: found.ligands.length, text: describeSelection(found) });
    },
    show(target, style) {
      const args = Array.isArray(target) ? target : [target, style];
      const { model } = primary(), state = env.lookState();
      if (args.length === 1 && /^(reset|default)$/i.test(String(args[0]))) { env.applyLook({ styles: [] }, '已恢复默认样式。'); return done({ rules: 0 }); }
      const [expr, kind] = args[1] === undefined ? ['all', args[0]] : args;
      const out = applyStyle(state.styles, expr, kind, { check: check(model) });
      env.applyLook({ styles: out.styles }, out.note);
      return done({ rules: out.styles.length }, out.note);
    },
    color(target, value) {
      const args = Array.isArray(target) ? target : [target, value];
      const { model } = primary(), state = env.lookState();
      if (args.length === 1 && /^reset$/i.test(String(args[0]))) { env.applyLook({ colors: createColorState() }, '已清除全部颜色设置。'); return done({ rules: 0 }); }
      const out = applyColor(state.colors, args[0], args[1], env.chainIds(), { check: check(model) });
      env.applyLook({ colors: out.state }, out.note);
      return done({ scheme: out.state.scheme, residueRules: out.state.residues.length }, out.note);
    },
    surface(target, scheme, color) {
      const args = Array.isArray(target) ? target : [target, scheme, color];
      const state = env.lookState();
      if (args[0] == null) return done({ surfaces: state.surfaces });   // an argument that was left out arrives as null
      if (/^clear$/i.test(String(args[0]))) { env.applyLook({ surfaces: [] }, '已清除表面。'); return done({ surfaces: [] }); }
      if (state.surfaces.length >= 4) throw new Error('最多 4 个表面：先 surface("clear")。');
      const expr = text(args[0], '选择表达式'), kind = args[1] ?? 'plain', paint = args[2] ? String(args[2]) : undefined;
      const built = buildSurface(primary().model, { expr, scheme: kind, color: paint });   // checked first: an empty or too big part is explained before anything is written
      doors(surfacePanel).applyLook({ surfaces: [{ expr, scheme: kind, ...(paint ? { color: paint } : {}) }] }, `分子表面：${expr} 画出表面（${SURFACE_SCHEMES[kind]}）。`);
      return done({ surface: { expr, scheme: kind, ...(paint ? { color: paint } : {}), ...built.stats }, limits: LIMITS.surface }, surfaceDescribe(built.stats, kind));
    },
    lookPack(id, extra) {
      if (id == null) return done({ current: env.lookState().lookPack ?? null, packs: LOOK_PACK_IDS.map((key) => ({ id: key, name: LOOK_PACKS[key].name, summary: LOOK_PACKS[key].summary })) });
      const o = options(extra, ['recolor'], '参数');
      if (String(id) === 'none') { env.applyLook({ lookPack: null }, '已回到默认的墨线风格。'); return done({ current: null }); }
      const pack = lookPackById(String(id));
      env.applyLook({ lookPack: pack.id, ...(o.recolor === false ? {} : { colors: colorStateOf(pack) }) }, `光影包：${pack.name}。`);
      return done({ current: pack.id, name: pack.name, recolored: o.recolor !== false }, pack.summary);
    },
    measure(a, b, c) {
      const points = (Array.isArray(a) ? a : [a, b, c]).filter((p) => p != null && p !== '');
      if (points.length === 1 && String(points[0]).toLowerCase() === 'clear') { env.applyAnnotations({ measures: [] }, '已清除测量。'); return done({}); }
      const before = env.annotations().measures.length, [checked] = validateMeasures([{ points: points.map(String) }]), probe = computeAnnotations(primary().model, { measures: [checked] });
      if (probe.problems.length) throw new Error(probe.problems[0].message);   // refuse what cannot be drawn, with the reason
      doors(COMMAND_PANEL).annotate({ measures: [checked] }, '测量已保存。');
      const state = env.annotations(), item = state.measures.at(-1);
      return done({ measures: state.measures.length, added: before < state.measures.length ? item : null }, '距离按 Cα（核酸 P）或小分子中心计算。');
    },
    label(target, content) {
      const args = Array.isArray(target) ? target : [target, content];
      const [item] = validateLabels([{ expr: text(args[0], '选择表达式'), ...(args[1] ? { text: String(args[1]) } : {}) }]), probe = computeAnnotations(primary().model, { labels: [item] });
      if (probe.problems.length) throw new Error(probe.problems[0].message);
      doors(COMMAND_PANEL).annotate({ labels: [item] }, '标签已保存。');
      return done({ labels: env.annotations().labels.length });
    },
    annotations(arg) {
      if (arg === 'clear') { env.applyAnnotations({ measures: [], labels: [], bonds: [] }, '已清除全部标注。'); return done({ measures: 0, labels: 0, bonds: 0 }); }
      const state = env.annotations();
      return done({ measures: state.measures, labels: state.labels, bonds: state.bonds.length });
    },
    contacts(args) {
      const o = options(args, ['a', 'b', 'cutoff', 'classify', 'write'], '参数'), write = writes(o.write, ['paint', 'draw', 'record'], 'contacts');
      const { model } = primary(), a = text(o.a ?? env.selectionBox.get().expression, 'a'), b = text(o.b, 'b');
      const result = contactsBetween(model, a, b, { cutoff: o.cutoff === undefined ? undefined : Number(o.cutoff) });
      const typed = o.classify === false && !write.has('draw') ? null : interactionsBetween(model, a, b);
      const api = doors(contactsPanel), wrote = [];
      if (write.has('paint') && result.pairs.length) { api.applyLook({ colors: { residues: interfaceRules(result) } }, '界面接触：已涂色界面残基。'); wrote.push('paint'); }
      if (write.has('draw') && typed) { const lines = bondLines(typed); if (lines.length) { api.annotate({ bonds: lines }, `界面接触：画出 ${lines.length} 条氢键和盐桥线。`); wrote.push(`draw(${lines.length})`); } }
      if (write.has('record') && result.pairs.length) { recordContacts(api, result, a, b, typed); wrote.push('record'); }
      return done({
        a, b, cutoff: result.cutoff, pairs: result.pairs.length, interface: { a: result.residuesA.length, b: result.residuesB.length }, sizes: { a: result.sizeA, b: result.sizeB },
        nearest: top(result.pairs, 10).map((p) => ({ a: nameOf(p.a), b: nameOf(p.b), atoms: `${p.atomA}-${p.atomB}`, distance: +p.distance.toFixed(2) })),
        ...(typed ? { counts: typed.counts, interactions: top(typed.interactions, 20).map((i) => ({ type: i.type, a: `${nameOf(i.a)} ${i.atomA}`, b: `${nameOf(i.b)} ${i.atomB}`, distance: +i.distance.toFixed(2) })) } : {}),
        wrote, limits: LIMITS.contacts,
      }, `${contactsSummary(result)}${typed ? ` ${typedSummary(typed)}` : ''}`);
    },
    composition(args) {
      const o = options(args, ['part', 'write'], '参数'), write = writes(o.write, ['hydrophobicity', 'charge', 'record'], 'composition');
      const part = text(o.part ?? env.selectionBox.get().expression, 'part'), result = compositionOf(primary().model, part), api = doors(compositionPanel), wrote = [];
      for (const scheme of ['hydrophobicity', 'charge']) if (write.has(scheme) && result.protein) { api.applyLook({ colors: { residues: [{ expr: part, scheme }] } }, `组成与性质：${part} 按${scheme}涂色。`); wrote.push(scheme); }
      if (write.has('record') && result.protein) { recordComposition(api, result, part); wrote.push('record'); }
      return done({ part, residues: result.protein, other: result.other, classes: result.classes, gravy: result.gravy === null ? null : +result.gravy.toFixed(3), netCharge: result.netCharge, wrote, limits: LIMITS.composition }, compositionLines(result).join(' '));
    },
    secondary(args) {
      const o = options(args, ['part', 'write'], '参数'), write = writes(o.write, ['paint', 'record'], 'secondary');
      const part = text(o.part ?? env.selectionBox.get().expression, 'part'), result = secondaryOf(primary().model, part), api = doors(secondaryPanel), wrote = [];
      if (write.has('paint')) { api.applyLook({ colors: { residues: [{ expr: part, scheme: 'secondary' }] } }, `序列与二级结构：${part} 按二级结构涂色。`); wrote.push('paint'); }
      if (write.has('record')) { recordSecondary(api, result, part); wrote.push('record'); }
      return done({ part, chains: result.chains.map((c) => ({ chain: c.label, residues: c.residues, helixPercent: share(c, 'helix'), sheetPercent: share(c, 'sheet'), sequence: c.sequence.length > 400 ? `${c.sequence.slice(0, 400)}…` : c.sequence, structure: c.structure.length > 400 ? `${c.structure.slice(0, 400)}…` : c.structure, segments: c.segments.slice(0, 60).map(({ type, from, to }) => `${type === 'helix' ? 'H' : 'E'} ${from}-${to}`) })), truncated: result.truncated, wrote, limits: LIMITS.secondary });
    },
    superpose(args) {
      const o = options(args, ['mobile', 'reference', 'mobileStructure', 'referenceStructure', 'mode', 'write'], '参数'), write = writes(o.write, ['place', 'mark', 'record', 'reset'], 'superpose');
      const mobileEntry = entry(o.mobileStructure), referenceEntry = entry(o.referenceStructure ?? o.mobileStructure);
      const mobile = text(o.mobile, 'mobile'), reference = text(o.reference ?? env.selectionBox.get().expression, 'reference'), mode = o.mode ?? 'number';
      const result = superposeParts(mobileEntry.model, mobile, reference, { mode, referenceModel: referenceEntry.model });
      const api = doors(superpositionPanel), cross = mobileEntry.id !== referenceEntry.id, wrote = [];
      const last = { result, mobileExpr: mobile, referenceExpr: reference, mode, cross, mobileLabel: mobileEntry.label, referenceLabel: referenceEntry.label };
      if (write.has('reset')) { api.placePart({ chain: result.chainId, reset: true, source: mobileEntry.id }, `结构叠合：链 ${result.chainId} 已还原到原来的位置。`); wrote.push('reset'); }
      if (write.has('place')) { api.placePart({ chain: result.chainId, quaternion: result.quaternion, from: result.from, to: result.to, source: mobileEntry.id, frame: referenceEntry.id }, `结构叠合：链 ${result.chainId} 已叠到参考上（RMSD ${result.rmsd.toFixed(2)} Å）。`); wrote.push('place'); }
      const far = farResidues(result);
      if (write.has('mark') && far.length) { api.applyLook({ colors: { residues: expressionsFor(far).map((expr) => ({ expr, color: FAR_COLOR })) } }, `结构叠合：${far.length} 个偏差 > ${FAR} Å 的残基标红。`); wrote.push(`mark(${far.length})`); }
      if (write.has('record')) { recordSuperposition(api, last, write.has('place')); wrote.push('record'); }
      const { angle, shift } = motionOf(result);
      return done({
        mobile, reference, mobileStructure: mobileEntry.id, referenceStructure: referenceEntry.id, chain: result.chainId, pairs: result.pairs, rmsdBefore: +result.rmsdBefore.toFixed(3), rmsd: +result.rmsd.toFixed(3),
        rotationDegrees: +angle.toFixed(2), shiftAngstrom: +shift.toFixed(2), farResidues: far.length, worst: top(result.deviations, 8).map((d) => ({ residue: nameOf(d.mobile), distance: +d.distance.toFixed(2) })), wrote, limits: LIMITS.superpose,
      }, superposeSummary(result));
    },
    camera(arg) {
      if (arg === undefined || arg === null) return done({ camera: env.camera.get() });
      if (arg === 'reset') { env.camera.reset(); return done({ camera: env.camera.get() }); }
      const o = options(arg, ['position', 'target'], '镜头');
      if (!Array.isArray(o.position) || o.position.length !== 3 || !Array.isArray(o.target) || o.target.length !== 3 || [...o.position, ...o.target].some((v) => !Number.isFinite(v))) throw new Error('镜头需要 position 和 target，各 3 个数。');
      if (o.position.every((v, i) => v === o.target[i])) throw new Error('镜头位置不能和目标重合。');
      env.camera.set({ position: o.position, target: o.target }); return done({ camera: env.camera.get() });
    },
    cameraKey(arg) {
      if (arg == null) return done({ keys: env.cameraKeys.list() });
      const o = options(arg, ['time', 'position', 'target', 'remove'], '参数');
      if (o.remove !== undefined) { env.cameraKeys.remove(String(o.remove)); return done({ keys: env.cameraKeys.list() }); }
      const time = Number(o.time); if (!Number.isFinite(time) || time < 0) throw new Error('time 应为不小于 0 的秒数。');
      const pose = o.position || o.target ? { position: o.position, target: o.target } : env.camera.get();
      env.cameraKeys.add(Math.round(time * 100) / 100, pose); return done({ keys: env.cameraKeys.list() });
    },
    note(content, extra) { const o = options(extra, ['node'], '参数'); env.note(text(content, '讲解文字'), o.node ?? null); return done({}); },
    title(value) { env.title(text(value, '标题')); return done({ title: env.scene().title }); },
    undo() { return done({ undone: env.undo(), canUndo: env.canUndo() }); },
    redo() { return done({ redone: env.redo(), canRedo: env.canRedo() }); },
    snapshot(arg) { const o = options(arg, ['width'], '参数'); const width = o.width === undefined ? 1280 : Number(o.width); if (!(width >= 64 && width <= 4096)) throw new Error('width 应在 64–4096。'); return done({ dataUrl: env.snapshot(width) }); },
    async exportScene() { const { base64, bytes } = await env.exportScene(); return done({ format: 'glow-v3', encoding: 'base64', data: base64, bytes }); },
  };
  // the structure of a scene is parsed in the background after an import: every command waits until it is ready
  return Object.fromEntries(Object.entries(commands).map(([name, fn]) => [name, async (...args) => { await env.ready(); return fn(...args); }]));
}

/** The answer of `help()`: the command table, the rules for an AI that drives the Studio, and the analyses with their limits. */
export function createStudioHelp() {
  return (api, commands) => ({
    api: api.version,
    commands: Object.entries(commands).map(([cmd, doc]) => ({ cmd, doc })),
    rules: [
      '先 info() / structures() 看场景；用 select() 把要分析的部分设成当前选择。',
      '所有“规则”（show、color、surface、measure、label、contacts 的 write 等）都写进作品，随导出保存；每一步可以 undo()。',
      '分析命令默认只算不写：要把结果画出来或记进作品，用 write 明确说；record 记为“推导”证据，写明方法。',
      '每个分析的回答里有 limits：转述结果时必须带上（静电不是 APBS，氢键/盐桥无角度判据，叠合只用 Cα，二级结构是文件登记的……）。',
      '算出来的东西不能说成实验测得的；几何类结果（叠合、放置）要用导出的场景包和原始坐标独立重算后再下结论。',
      '参数写错会得到中文报错并说明怎么改，不会静默忽略。',
    ],
    limits: LIMITS,
  });
}
