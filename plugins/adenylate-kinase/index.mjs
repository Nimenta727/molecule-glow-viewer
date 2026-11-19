import { PARAMETERS, createAdkPlayback } from './playback.mjs';
import { buildAdkStructure } from './structure.mjs';
export const ADK_PLAYER = 'org.glow.legacy-process.adenylate-kinase';
export const adenylateKinasePlugin = {
  manifest: { id: ADK_PLAYER, version: '1.0.0', apiVersion: 1,
    dependencies: [{ id: 'org.glow.structure', version: '1.0.0' }], capabilities: ['players', 'panels'] },
  activate(context) {
    const instances = new Set();
    context.lifecycle.add(() => { for (const player of instances) player.dispose(); instances.clear(); });
    context.registerPlayer(ADK_PLAYER, {
      async prepare(input) {
        context.signal.throwIfAborted();
        const prepared = await prepareAdk({ ...input, signal: AbortSignal.any([context.signal, input.signal]) });
        return { states: prepared };
      },
      create(input) {
        if (context.signal.aborted) throw new Error('AdK 插件已停用。');
        const player = createAdkPlayer(input), dispose = player.dispose;
        player.dispose = () => { dispose(); instances.delete(player); };
        instances.add(player); return player;
      },
    });
    context.registerPanel(ADK_PLAYER, {
      title: 'AdK 腺苷酸激酶', parametersTitle: '构象与参考配体', speed: { label: '构象往复倍率', min: 0.05, max: 3, step: 0.05 },
      seed: { label: '重放种子（本展示无随机事件）', min: 0, max: 4294967295, step: 1 }, parameters: PARAMETERS,
      evidence: '4AKE 张开态 ⇄ 1AKE 抑制剂闭合态，A 链 214 残基。按 CORE 叠合，NMP 30–59、LID 122–159；域配色及中间形状为教学表达。Ap5A 为抑制剂参考，仅在闭合端显示。本播放器展示构象和反应讲解，不计算反应速率或 ADP 产量。',
    });
  },
};
export async function prepareAdk({ loaded, parse, loadAccession, signal }) {
  signal.throwIfAborted();
  const primary = loaded.scene.assets.find((a) => a.provenance?.parserVersion);
  if (!primary) throw new Error('AdK 缺少主结构。');
  const stored = loaded.scene.assets.find((a) => a.provenance?.mechanismState?.player === ADK_PLAYER && a.provenance.mechanismState.accession === '1AKE');
  const input = stored ? { bytes: loaded.resources.get(stored.path), name: stored.path, mediaType: stored.mediaType } : await loadAccession('1AKE', signal);
  const model = parse(input);
  // Validate residue matching, the inhibitor and CORE fit before changing the package.
  const structure = buildAdkStructure(loaded.model, model);
  signal.throwIfAborted();
  if (!stored) {
    const digest = await crypto.subtle.digest('SHA-256', input.bytes);
    signal.throwIfAborted();
    const asset = { id: 'adk-state-1AKE', kind: 'file', path: 'assets/adk/1AKE.cif', mediaType: 'chemical/x-mmcif',
      sha256: [...new Uint8Array(digest)].map((n) => n.toString(16).padStart(2, '0')).join(''),
      provenance: { source: input.source, mechanismState: { player: ADK_PLAYER, accession: '1AKE' } } };
    if (loaded.scene.assets.some((a) => a.id === asset.id || a.path === asset.path)) throw new Error('AdK 构象资源 ID 或路径冲突。');
    loaded.scene.assets.push(asset); loaded.resources.set(asset.path, input.bytes);
  }
  return { closed: model, structure };
}
const STEPS = [
  ['底物结合（讲解）', 'ATP 与 AMP 的结合位点位于 CORE / LID 和 NMP 域。本展示中的 Ap5A 是 1AKE 抑制剂参考，不是正在反应的底物。'],
  ['LID / NMP 闭合', '4AKE 与 1AKE 在 CORE 上叠合后，LID 和 NMP 域向活性位点关闭。中间形状是两套坐标的教学插值。'],
  ['磷酰基转移（讲解）', 'AdK 催化 ATP + AMP ⇌ 2 ADP。1AKE 的 Ap5A 跨越两个核苷酸位点；此构象展示不执行化学反应或累计产物。'],
  ['打开与释放（讲解）', '构象往复展示 LID / NMP 重新打开；产物释放通过文字说明，时间轴单位为示意秒。'],
];
export function createAdkPlayer({ model, scene, states, state }) {
  if (!states?.structure) throw new Error('AdK 闭合态尚未准备。');
  const structure = states.structure, playback = createAdkPlayback(state);
  const sourceId = scene.assets.find((a) => a.provenance?.parserVersion)?.id;
  const nodes = scene.nodes.filter((n) => n.extensions?.['org.glow.structure']?.sourceAssetId === sourceId && /adenylate kinase/i.test(n.extensions['org.glow.structure'].partName));
  if (nodes.length !== 1) { playback.dispose(); throw new Error('AdK 预览需要单个 A 链节点。'); }
  const steps = STEPS.map(([title, caption]) => ({ title, caption, nodeIds: [nodes[0].id] }));
  const base = { nodeId: nodes[0].parentId ?? nodes[0].id, bookmarkId: null, labelIds: [] };
  const navigation = { version: 1, entryId: 'adk-protein', views: [
    { ...base, id: 'adk-protein', mode: 'protein', title: 'AdK：CORE / NMP / LID', parentIds: [] },
    { ...base, id: 'adk-mechanism', mode: 'mechanism', title: 'AdK 构象与催化讲解', parentIds: ['adk-protein'],
      steps: steps.map(({ title, nodeIds }, i) => ({ id: `adk-step-${i}`, title, nodeIds })) },
  ] };
  let cachedFraction, measurements;
  const endpoint = structure.measurements(1);
  const originalSnapshot = playback.snapshot;
  return Object.assign(playback, {
    steps, navigation, particleParentId: nodes[0].parentId,
    functionalDescription: '蓝色 CORE、绿色 NMP（30–59）、橙色 LID（122–159）。各域使用残基坐标生成密度叶片，并向域中心收缩 1.5 Å 露出接缝；两态之间按残基位移插值。颜色和中间表面为教学表达。',
    evidence: { type: 'derived', citation: 'AdK 两态构象播放器', details: `4AKE / 1AKE A 链 ${structure.matched} 个 Cα；CORE 叠合 RMSD ${structure.rmsd.toFixed(3)} Å。相对 CORE 的闭合端运动：${endpoint.map((d) => `${d.name} ${d.angle.toFixed(2)}° / ${d.shift.toFixed(2)} Å`).join('；')}。域配色、中间构象和时间为示意；Ap5A 为实测抑制剂坐标，无催化动力学或产物计数。` },
    decorate(layers) { originalSnapshot(); return structure.decorate(layers, nodes); },
    snapshot() {
      const result = originalSnapshot();
      if (cachedFraction !== result.fraction) { cachedFraction = result.fraction; measurements = structure.measurements(result.fraction); }
      return { ...result, domainMeasurements: measurements.map((item) => ({ ...item })),
        metrics: `CORE 叠合 RMSD ${structure.rmsd.toFixed(3)} Å · ${measurements.map((d) => `${d.name} ${d.angle.toFixed(1)}° / ${d.shift.toFixed(1)} Å`).join(' · ')}（相对张开态 CORE；蓝 CORE、绿 NMP、橙 LID）`,
        particles: [{ ...structure.inhibitor, visible: Boolean(result.parameters.ap5) && result.fraction >= 0.99 }] };
    },
  });
}
