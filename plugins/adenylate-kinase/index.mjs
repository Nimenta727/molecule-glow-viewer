import { adkToolDescriptor, ADK_TOOL, adkSourceId, adkProteinTest } from './tool.mjs';
import { nodesOfSource, boundOrMatched } from '../shared/bindings.mjs';
import { PARAMETERS, createAdkPlayback } from './playback.mjs';
import { buildAdkStructure } from './structure.mjs';
import { ADK_4AKE_TEMPLATE, normalizeAdkConfig } from './config.mjs';
export const ADK_PLAYER = 'org.glow.legacy-process.adenylate-kinase';
export const adenylateKinasePlugin = {
  manifest: { id: ADK_PLAYER, version: '1.0.0', apiVersion: 1,
    dependencies: [{ id: 'org.glow.structure', version: '1.0.0' }], capabilities: ['players', 'panels', 'tools'] },
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
    context.registerTool(ADK_TOOL, adkToolDescriptor(this.manifest.version, ADK_PLAYER));
    const { panel } = ADK_4AKE_TEMPLATE;
    context.registerPanel(ADK_PLAYER, {
      title: panel.title, parametersTitle: panel.parametersTitle, speed: { label: panel.speedLabel, min: 0.05, max: 3, step: 0.05 },
      seed: { label: panel.seedLabel, min: 0, max: 4294967295, step: 1 }, parameters: PARAMETERS,
      evidence: panel.evidence,
    });
  },
};
/** `config` is the work configuration (see config.mjs); omitted = the built-in 4AKE/1AKE template. */
export async function prepareAdk({ loaded, parse, loadAccession, signal, config }) {
  const cfg = normalizeAdkConfig(config), closed = cfg.states.closed;
  signal.throwIfAborted();
  const primary = loaded.scene.assets.find((a) => a.provenance?.parserVersion);
  if (!primary) throw new Error('AdK 缺少主结构。');
  const stored = loaded.scene.assets.find((a) => a.provenance?.mechanismState?.player === ADK_PLAYER && a.provenance.mechanismState.accession === closed);
  const input = stored ? { bytes: loaded.resources.get(stored.path), name: stored.path, mediaType: stored.mediaType } : await loadAccession(closed, signal);
  const model = parse(input);
  // Validate residue matching, the inhibitor and CORE fit before changing the package.
  const structure = buildAdkStructure(loaded.model, model, cfg);
  signal.throwIfAborted();
  if (!stored) {
    const digest = await crypto.subtle.digest('SHA-256', input.bytes);
    signal.throwIfAborted();
    const asset = { id: `adk-state-${closed}`, kind: 'file', path: `assets/adk/${closed}.cif`, mediaType: 'chemical/x-mmcif',
      sha256: [...new Uint8Array(digest)].map((n) => n.toString(16).padStart(2, '0')).join(''),
      provenance: { source: input.source, mechanismState: { player: ADK_PLAYER, accession: closed } } };
    if (loaded.scene.assets.some((a) => a.id === asset.id || a.path === asset.path)) throw new Error('AdK 构象资源 ID 或路径冲突。');
    loaded.scene.assets.push(asset); loaded.resources.set(asset.path, input.bytes);
  }
  return { closed: model, structure };
}
/** `config` must be the same configuration that was given to prepareAdk. */
export function createAdkPlayer({ model, scene, states, state, config, bindings }) {
  const cfg = normalizeAdkConfig(config);
  if (!states?.structure) throw new Error('AdK 闭合态尚未准备。');
  const structure = states.structure, playback = createAdkPlayback(state, cfg.machine);
  const sourceId = scene.assets.find((a) => a.provenance?.parserVersion)?.id;
  const nodes = boundOrMatched(nodesOfSource(scene, sourceId), bindings, 'protein', adkProteinTest(cfg));   // the saved binding, else the configured chain name
  if (nodes.length !== 1) { playback.dispose(); throw new Error(`AdK 预览需要单个 ${cfg.protein.chain} 链节点。`); }
  const steps = cfg.steps.map(({ title, caption }) => ({ title, caption, nodeIds: [nodes[0].id] }));
  const base = { nodeId: nodes[0].parentId ?? nodes[0].id, bookmarkId: null, labelIds: [] };
  const prefix = cfg.navigation.idPrefix;
  const navigation = { version: 1, entryId: `${prefix}-protein`, views: [
    { ...base, id: `${prefix}-protein`, mode: 'protein', title: cfg.navigation.proteinTitle, parentIds: [] },
    { ...base, id: `${prefix}-mechanism`, mode: 'mechanism', title: cfg.navigation.mechanismTitle, parentIds: [`${prefix}-protein`],
      steps: steps.map(({ title, nodeIds }, i) => ({ id: `${prefix}-step-${i}`, title, nodeIds })) },
  ] };
  let cachedFraction, measurements;
  const endpoint = structure.measurements(1);
  const originalSnapshot = playback.snapshot;
  return Object.assign(playback, {
    steps, navigation, particleParentId: nodes[0].parentId,
    panel: cfg.panel,   // the work's own panel wording (title, evidence, labels): another protein run by this tool must not show the adenylate kinase text
    functionalDescription: cfg.functionalDescription,
    evidence: { type: 'derived', citation: cfg.evidence.citation, details: `${cfg.states.open} / ${cfg.states.closed} ${cfg.protein.chain} 链 ${structure.matched} 个 Cα；${cfg.fitDomain} 叠合 RMSD ${structure.rmsd.toFixed(3)} Å。相对 ${cfg.fitDomain} 的闭合端运动：${endpoint.map((d) => `${d.name} ${d.angle.toFixed(2)}° / ${d.shift.toFixed(2)} Å`).join('；')}。${cfg.evidence.note}` },
    decorate(layers) { originalSnapshot(); return structure.decorate(layers, nodes); },
    snapshot() {
      const result = originalSnapshot();
      if (cachedFraction !== result.fraction) { cachedFraction = result.fraction; measurements = structure.measurements(result.fraction); }
      return { ...result, domainMeasurements: measurements.map((item) => ({ ...item })),
        metrics: `${cfg.fitDomain} 叠合 RMSD ${structure.rmsd.toFixed(3)} Å · ${measurements.map((d) => `${d.name} ${d.angle.toFixed(1)}° / ${d.shift.toFixed(1)} Å`).join(' · ')}${cfg.metricsLegend}`,
        particles: [{ ...structure.inhibitor, visible: Boolean(result.parameters.ap5) && result.fraction >= 0.99 }] };
    },
  });
}
