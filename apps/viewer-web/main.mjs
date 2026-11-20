import { createDocumentStore, createLoadCoordinator, createTimeline } from '../../packages/core/index.mjs';
import { writeScenePackage } from '../../packages/schema/archive.mjs';
import { toCoreDocument } from '../../packages/schema/documents.mjs';
import { GEOMETRY_MEDIA_TYPE } from '../../packages/schema/geometry.mjs';
import { createPluginHost } from '../../packages/plugin-host/index.mjs';
import { exampleScene } from './example-scene.mjs';
import { fromPrototype, geometryLayers, isStructureFile, loadLegacyStructures, openSceneFile } from './scene-io.mjs';
import { createSceneNavigation } from './scene-navigation.mjs';
import { createModePanel } from './mode-panel.mjs';
import { createViewport } from '../../packages/render-three/viewport.mjs';
import { createCommandApi, attachCommandBridge } from './command-api.mjs';
import { createViewerCommands } from './viewer-commands.mjs';
import { mechanismPlugins, toolTitle, toolPlugins, SOLUTION_TOOL, DATA_TOOL, PROCESS_TOOL } from '../../plugins/mechanism-catalog.mjs';
import { createMechanismRuntime } from './mechanism-runtime.mjs';
import { ATP_6ZPO_TEMPLATE } from '../../plugins/atp-synthase/config.mjs';
import { defaultStyleFor } from '../../plugins/default-style.mjs';
import { loadFunctionalSites, siteExpression, SITE_CATEGORIES, FunctionalSiteError } from '../../plugins/structure/functional-sites.mjs';
import { PRESENTATION_METERS_PER_ANGSTROM, chainGroupKey } from '../../plugins/structure/representation.mjs';
import { slabPlane, wedgePlanes, normalizeClipping } from '../../packages/render-three/clipping.mjs';
import { createObjectSpin } from './object-spin.mjs';
import { createParticleFlow } from './particle-flow.mjs';
import { createDataAnimation } from './data-animation.mjs';
import { createProcessPanel } from './process-panel.mjs';
import { createStateMorph } from './state-morph.mjs';
import { createLigandView } from './ligand-view.mjs';
import { loadChemComp } from '../../plugins/structure/chemical-component.mjs';
import { createEntryIntro } from './entry-intro.mjs';
import { createTakeApart } from './take-apart.mjs';
import { createSequenceBar } from './sequence-bar.mjs';
import { SELECTION_HELP, describeSelection, selectionSpace } from '../../plugins/structure/selection.mjs';
import { buildStructureLayers, structureSources, STRUCTURE_STYLES } from '../../plugins/structure/view-layers.mjs';
import { createResourceStore } from '../../packages/schema/resource.mjs';
import { registerSceneResources, summarizeResource } from './resource-registry.mjs';
import { prepareWorkScene, storePlayerState, toolEntryFor } from './work-scene.mjs';
import { normalizeSolutionConfig } from '../../plugins/motion/solution-tool.mjs';
import { normalizeDataConfig } from '../../plugins/simulation/data-tool.mjs';
import { normalizeProcessConfig } from '../../plugins/simulation/process-tool.mjs';
import { loadCatalog, workshopBase, fetchWorkBytes, fetchResource } from '../../plugins/workshop/catalog.mjs';
import { createWorkshopDialog } from '../../plugins/workshop/dialog.mjs';
import { toolControls } from '../../packages/plugin-host/tool-model.mjs';
import { renderControls, readControl, writeControl } from '../../packages/plugin-host/tool-panel.mjs';

const elements = Object.fromEntries(
  [...document.querySelectorAll('[id]')].map((element) => [element.id, element]),
);

let active;
let frame;
let saving = false;
const STRUCTURE = 'org.glow.structure';
const IMPORTER = `${STRUCTURE}.coordinates`;
const MODEL_SERVICE = `${STRUCTURE}.model`;
const REPRESENTATION = `${STRUCTURE}.preview`;
const STYLES = new Set(STRUCTURE_STYLES);
// Mechanism cameras frame the step's participants but never closer than this fraction of the whole structure's radius.
const MECHANISM_CONTEXT = 0.5;
const STRUCTURE_LABELS = { residue: '残基', ligand: '配体' };
const EVIDENCE_LABELS = { source: '来源', experimental: '实验', derived: '推导', modelled: '建模', illustrative: '示意' };
const MODE_LABELS = { cell: '细胞', system: '局部系统', protein: '蛋白质', mechanism: '反应机理' };
const functionalDescription = (scene, player) => player?.functionalDescription ?? (Array.isArray(scene?.legacy?.scene?.core) && scene.legacy.scene.core.length
  ? '橙色标记显示配体邻域及场景指定的核心残基。其余形状由残基坐标生成低分辨率密度表面。'
  : '橙色标记显示配体重原子 8 Å 内的残基代表点。其余形状由残基坐标生成低分辨率密度表面。');
const resourceStore = createResourceStore();   // session-wide: every raw structure file seen in this window, deduplicated by hash
const host = createPluginHost({
  getScene: () => active?.store.getSnapshot() ?? null,
  dispatch: () => { throw new Error('这个入口用于查看。请在制作台编辑场景。'); },
});

function setStatus(message) {
  elements.status.textContent = message;
}

let setParticlesAvailable = () => {}, setDataAnimationAvailable = () => {}, setProcessAvailable = () => {};   // set once the particle panel exists (it lives in the inner scope)
function syncControls() {
  const playback = active?.player?.snapshot();
  const timeline = playback ? { ...playback, duration: active.player.duration } : active?.timeline;
  const duration = timeline?.duration ?? 0;
  const time = timeline?.time ?? 0;
  elements.save.disabled = !active || saving;
  elements.close.disabled = !active;
  elements['reset-camera'].disabled = !active;
  elements.play.disabled = !duration;
  elements.playhead.disabled = !duration;
  elements.playhead.max = String(duration);
  elements.playhead.value = String(time);
  elements.time.value = `${time.toFixed(2)} / ${duration.toFixed(2)} s`;
  elements.play.textContent = timeline?.playing ? '暂停' : '播放';
  const structureEnabled = Boolean(host.getImporter(IMPORTER));
  elements.accession.disabled = !structureEnabled;
  elements['rcsb-load'].disabled = !structureEnabled;
  elements['structure-assembly'].disabled = !structureEnabled;
  elements['atp-enabled'].disabled = !structureEnabled;
  elements['mechanism-controls'].hidden = !active?.player;
  elements['selection-form'].hidden = !structureEnabled || !active?.model;
  elements['selection-expression-form'].hidden = !structureEnabled || !active?.model;
  const particlesTool = Boolean(host.getTool(SOLUTION_TOOL));   // the layer is the motion plugin's tool: without the plugin nothing is drawn and the config is kept
  setParticlesAvailable(particlesTool);
  const dataTool = Boolean(host.getTool(DATA_TOOL)) && Boolean(active?.scene.tools?.some((entry) => host.resolveToolId(entry.tool.id) === DATA_TOOL));
  setDataAnimationAvailable(dataTool);
  elements['data-controls'].hidden = !structureEnabled || !active?.model || !dataTool;
  const processTool = Boolean(host.getTool(PROCESS_TOOL)) && Boolean(active?.scene.tools?.some((entry) => host.resolveToolId(entry.tool.id) === PROCESS_TOOL));
  setProcessAvailable(processTool);
  elements['process-controls'].hidden = !structureEnabled || !active?.model || !processTool;
  elements['particle-controls'].hidden = !structureEnabled || !active?.model || !particlesTool;
  elements['spin-controls'].hidden = !structureEnabled || !active?.model || !active?.representationSource;
  elements['morph-controls'].hidden = !structureEnabled || !active?.model || !active?.representationSource;
  elements['clip-controls'].hidden = !structureEnabled || !active?.model || !active?.representationSource;
  elements['entry-intro-controls'].hidden = !structureEnabled || !active?.model;
  elements['take-apart-controls'].hidden = !structureEnabled || !active?.model || !active?.representationSource;
  elements['representation-controls'].hidden = !structureEnabled || !active?.representationSource;
  elements['representation-style'].value = active?.representationSource?.provenance?.viewerStyle ?? defaultStyleFor(active?.scene);
  elements['functional-evidence'].hidden = elements['representation-style'].value !== 'functional';
  if (!elements['functional-evidence'].hidden) elements['functional-evidence'].textContent = functionalDescription(active?.scene, active?.player);
}

function showDiagnostics() {
  const scene = active?.scene;
  const diagnostics = new Set(active?.warnings);
  if (active?.player) for (const diagnostic of diagnostics) {
    if (diagnostic.includes(`已保留过程“${scene.legacy?.scene?.process}”的声明`) || diagnostic.startsWith('已生成旧包的静态结构预览')) diagnostics.delete(diagnostic);
  }
  const installed = new Map(host.listActive().map(({ id, version }) => [id, version]));
  const missing = scene?.dependencies.filter(({ id, version }) => installed.get(id) !== version) ?? [];
  if (missing.length) {
    diagnostics.add(`部分内容依赖插件 ${missing.map(({ id }) => id).join('、')}。`);
  }
  if (!active?.model && scene?.assets.some(({ kind, mediaType }) => kind !== 'primitive' && mediaType !== GEOMETRY_MEDIA_TYPE)) {
    diagnostics.add('需要相应插件才能查看专业资源。包内通用几何仍可查看。');
  }
  for (const asset of scene?.assets ?? []) {
    const { omittedPreviewGroups, source, assemblyDiagnostic } = asset.provenance ?? {};
    if (typeof assemblyDiagnostic === 'string') diagnostics.add(assemblyDiagnostic);
    if (Number.isSafeInteger(omittedPreviewGroups) && omittedPreviewGroups > 0) {
      diagnostics.add(`受场景包资源数量限制，预览省略 ${omittedPreviewGroups} 个结构分组，包内保存了导入的坐标。`);
    }
    if (source?.coordinateSet === 'backbone') diagnostics.add('主结构使用 RCSB ModelServer 的 Cα/P 坐标预览，配体与全原子接触需完整结构。');
  }
  elements.warning.textContent = [...diagnostics].join(' ');
  elements.diagnostic.hidden = diagnostics.size === 0;
  elements['diagnostic-summary'].textContent = `${scene?.legacy && !active?.player ? '旧包静态预览' : '加载说明'} · ${diagnostics.size} 条说明`;
  elements['legacy-viewer'].hidden = !scene?.legacy || diagnostics.size === 0;
}

function stopFrame() {
  if (frame !== undefined) cancelAnimationFrame(frame);
  frame = undefined;
}

function structureObjectId(kind, atom, sourceAssetId) {
  return JSON.stringify([kind, atom.modelId, atom.authChainId, atom.labelChainId,
    atom.authSeqId, atom.labelSeqId, atom.insertionCode, atom.residueName,
    ...(atom.assemblyCopy ? [atom.assemblyCopy] : []), ...(sourceAssetId ? [sourceAssetId] : [])]);
}

function isViewCamera(camera) {
  const { position, target } = camera ?? {};
  if (![position, target].every((vector) => Array.isArray(vector) &&
    vector.length === 3 && vector.every(Number.isFinite))) return false;
  const distance = Math.hypot(...position.map((value, axis) => value - target[axis]));
  return Number.isFinite(distance) && distance > 0.001;
}

function boot() {
  let structureLifetime;
  let rcsb;
  const oversizedAccessions = new Set();
  async function loadAccession(accession, signal, { legacyPreview = false } = {}) {
    const { createRcsbSource, RcsbCoordinateLimitError } = await import('../../plugins/rcsb/index.mjs');
    rcsb ??= createRcsbSource();
    const key = accession.toUpperCase();
    if (legacyPreview && oversizedAccessions.has(key)) return rcsb.loadBackbone(accession, { signal });
    try {
      return await rcsb.load(accession, { signal });
    } catch (error) {
      if (!legacyPreview || !(error instanceof RcsbCoordinateLimitError)) throw error;
      oversizedAccessions.add(key);
      return rcsb.loadBackbone(accession, { signal });
    }
  }
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const cameraDuration = () => reducedMotion.matches ? 0 : 280;
  const viewport = createViewport(elements.viewport, {
    selectOnTap: true,
    onSelect(id, target, point) {
      if (target && active?.model) {
        showStructurePick(target);
        const camera = viewport.getCamera();
        const offset = camera.position.map((value, axis) => value - camera.target[axis]);
        const scale = Math.min(1, 1.5 / Math.hypot(...offset));
        viewport.setCamera({ target: point, position: point.map((value, axis) => value + offset[axis] * scale) }, { duration: cameraDuration() });
        return;
      }
      showStructurePick();
      if (active?.navigation) {
        active.navigation.select(id);
        showNavigationSelection();
        return;
      }
      const node = active?.nodes.get(id);
      const metadata = node?.extensions?.[STRUCTURE];
      if (typeof metadata?.chainId === 'string' && active.model) elements['chain-id'].value = metadata.chainId;
      setStatus(node ? `已选择 ${node.name}` : (active?.name ?? '场景已关闭'));
    },
  });
  const modePanel = createModePanel(elements['mode-panel'], {
    onObject(id) {
      active.navigation.select(id);
      showNavigationSelection();
      viewport.focusNode(id, { duration: cameraDuration() });
    },
    onStep(step) {
      if (active?.player) {
        const index = active.player.steps.findIndex(({ title }) => title === step.title);
        if (index >= 0) seekMechanismStep(index);
        return;
      }
      if (step.time !== undefined) {
        active.timeline.pause();
        stopFrame();
        active.timeline.seek(step.time);
      }
      showPose();
    },
    onRotate(direction) { viewport.orbitBy(direction * Math.PI / 8, { duration: cameraDuration() }); },
  });
  const { createPlayer, preparePlayer } = createMechanismRuntime(host, { loadAccession, onProgress: setStatus });

  const scenes = createLoadCoordinator({
    async prepare(input, { signal, scope }) {
      let loaded;
      const importer = host.getImporter(IMPORTER);
      if (input.accession || input.structure || (input.file && isStructureFile(input.file.name))) {
        if (!importer || !structureLifetime) throw new Error('请先启用官方结构插件。');
        const combined = AbortSignal.any([signal, structureLifetime.signal]);
        let structure;
        if (input.structure) {
          structure = input.structure;   // bytes already fetched and checked against the workshop's record
        } else if (input.accession) {
          structure = await loadAccession(input.accession, combined);
        } else {
          if (input.file.size > 30 * 1024 * 1024) throw new Error('结构文件超过 30 MiB。');
          structure = {
            name: input.file.name,
            bytes: new Uint8Array(await input.file.arrayBuffer()),
            source: { provider: 'local file', name: input.file.name },
          };
        }
        loaded = await importer.importScene(structure, { signal: combined, assembly: input.assembly });
      } else {
        if (input.demo) {
          const { fourModesDemo } = await import('./four-modes-demo.mjs');
          loaded = { scene: fourModesDemo, resources: new Map(), warnings: [] };
        } else loaded = input.file ? await openSceneFile(input.file) : fromPrototype(exampleScene);
        if (importer && structureLifetime) {
          const combined = AbortSignal.any([signal, structureLifetime.signal]);
          await loadLegacyStructures(loaded, {
            importer, representation: host.getRepresentation(REPRESENTATION), signal: combined, onProgress: setStatus,
            loadAccession: (accession, cancel) => loadAccession(accession, cancel, { legacyPreview: true }),
          });
        }
        if (!loaded.model) restoreStructureModel(loaded);
      }
      if (signal.aborted) return;
      await prepareWorkScene(loaded);   // current scene format + the tool configuration of the declared mechanism
      await preparePlayer(loaded, signal);
      signal.throwIfAborted();
      const layers = structureLayers(loaded);
      const player = createPlayer(loaded);
      const handles = { player, current: undefined };
      scope.add(() => handles.player?.dispose());
      scope.add(() => handles.current?.dispose());
      if (player) player.decorate(layers);
      if (player && !loaded.scene.presentation?.navigation) {
        loaded.scene.presentation ??= { notes: [], bookmarks: [] };
        loaded.scene.presentation.navigation = player.navigation;
      }
      // Raw structure files become immutable resources; a problem with one file is reported, it does not stop the scene.
      const { diagnostics: resourceDiagnostics } = await registerSceneResources(resourceStore, loaded.scene, loaded.resources);
      for (const { message } of resourceDiagnostics) loaded.warnings = [...(loaded.warnings ?? []), message];
      const store = createDocumentStore(toCoreDocument(loaded.scene, new Set(layers.keys())));
      const document = store.getSnapshot();
      const timeline = createTimeline(document.timeline);
      const views = loaded.scene.presentation?.navigation?.views ?? [];
      const overlayCapacity = views.reduce((capacity, { steps, connections }) => {
        const highlights = (steps ?? []).reduce((max, { nodeIds }) => Math.max(max, nodeIds.length), 1);
        return Math.max(capacity, (connections?.length ?? 0) * 6 + highlights * 24);
      }, 0);
      const prepared = viewport.prepare(document, layers, { overlayCapacity, ...playerViewportOptions(player) });
      handles.current = prepared;
      const navigation = createSceneNavigation(loaded.scene.presentation?.navigation, document.nodes);
      const nodes = new Map(loaded.scene.nodes.map((node) => [node.id, node]));
      const name = input.file?.name ?? input.accession ?? input.structure?.name ?? (input.demo ? '四模式示例' : '基础几何示例');
      return { ...loaded, store, nodes, timeline, prepared, handles, overlayCapacity, navigation, name, player };
    },
    commit(scene) {
      const restoreFocus = elements['scene-navigation'].contains(document.activeElement);
      viewport.commit(scene.prepared);
      stopFrame();
      active = scene;
      showStructurePick();
      objectSpin.reset();
      particleFlow.reset();
      dataAnimation.reset();
      processPanel.reset();
      stateMorph.reset();
      entryIntro.reset();
      leaveTakeApart();
      sequenceBar.setModel(active.model);
      resetSiteChips();
      elements['chain-id'].value = '';
      elements['residue-id'].value = '';
      showNavigation();
      showPose();
      showDiagnostics();
      focusCurrentView(0);
      restoreStructureView();
      showPresentation();
      showResources();
      if (restoreFocus) (scene.navigation ? elements['navigation-heading'] : elements.open).focus();
      setStatus(scene.name);
      showStructureSummary();
      showMechanism();
    },
  });

  function playerViewportOptions(player) {
    return player ? { particles: player.snapshot().particles, particleParentId: player.particleParentId, membrane: player.membrane } : {};
  }

  function showMechanism() {
    const player = active?.player;
    elements['mechanism-controls'].hidden = !player;
    if (!player) return;
    const snapshot = player.snapshot();
    const stage = active.inspectionStep ?? snapshot.stage;
    elements['mechanism-steps'].hidden = active.navigation?.current().mode === 'mechanism';
    if (active.mechanismUiPlayer !== player) {
      active.mechanismUiPlayer = player;
      const panel = host.getPanel(active.playerId);
      elements['mechanism-title'].textContent = panel?.title ?? '机制';
      elements['mechanism-evidence'].textContent = panel?.evidence ?? '';
      for (const key of ['speed', 'seed']) {
        const parameter = panel?.[key];
        elements[`mechanism-${key}-label`].textContent = parameter?.label ?? key;
        for (const attribute of ['min', 'max', 'step']) if (Number.isFinite(parameter?.[attribute])) {
          elements[`mechanism-${key}`].setAttribute(attribute, String(parameter[attribute]));
        }
      }
      elements['mechanism-speed'].value = String(snapshot.speed);
      elements['mechanism-seed'].value = String(snapshot.seed);
      elements['mechanism-rate'].value = String(snapshot.playbackRate);
      // Runtime controls come from the tool's descriptor, filtered to what a viewing front end may show; a player without
      // a descriptor falls back to the numeric table of its panel definition.
      const tool = host.getTool(active.playerId);
      const controls = tool ? toolControls(tool, 'view') : Object.entries(panel?.parameters ?? {}).map(([key, parameter]) => ({
        key, type: 'number', label: parameter.label, min: parameter.min, max: parameter.max, step: parameter.step, control: parameter.control, default: parameter.value }));
      active.mechanismControls = new Map(controls.map((control) => [control.key, control]));
      elements['mechanism-parameters'].replaceChildren(...renderControls(document, controls, snapshot.parameters ?? {}));
      elements['mechanism-parameter-panel'].hidden = !controls.length;
      elements['mechanism-parameter-title'].textContent = panel?.parametersTitle ?? '机制参数';
      elements['mechanism-back'].disabled = true;
      elements['mechanism-steps'].replaceChildren(...player.steps.map(({ title }, index) => {
        const li = document.createElement('li');
        const button = document.createElement('button');
        button.textContent = title;
        button.dataset.mechanismStep = String(index);
        li.append(button);
        return li;
      }));
    }
    for (const button of elements['mechanism-steps'].querySelectorAll('button')) {
      if (Number(button.dataset.mechanismStep) === stage) button.setAttribute('aria-current', 'step');
      else button.removeAttribute('aria-current');
    }
    elements['mechanism-caption'].textContent = player.steps[stage].caption;
    for (const input of elements['mechanism-parameters'].querySelectorAll('input, select')) if (input !== document.activeElement) writeControl(input, snapshot.parameters?.[input.dataset.parameter]);
    elements['mechanism-metrics'].textContent = snapshot.metrics ?? '';
    elements['mechanism-counters'].textContent = `${Object.entries(snapshot.counters).map(([name, value]) => `${name} ${value}`).join(' · ')} · ${snapshot.time.toFixed(2)} 示意秒`;
    const eventKey = JSON.stringify(snapshot.events);
    if (active.mechanismEventCount !== eventKey) {
      active.mechanismEventCount = eventKey;
      elements['mechanism-events'].replaceChildren(...snapshot.events.map(({ time, label, ATP }) => {
        const li = document.createElement('li');
        li.textContent = `${time.toFixed(2)} s · ${label}${ATP == null ? '' : ` · ATP ${ATP}`}`;
        return li;
      }));
    }
  }

  function showStructurePick(selection) {
    if (active) active.structureSelection = selection;
    viewport.setPointSelection(selection);
    if (selection && active) active.selectionSet = undefined;
    syncSequence();
    ligandView.onSelection(selection);
    const card = elements['structure-pick'];
    card.hidden = !selection;
    const contacts = elements['structure-contacts'];
    contacts.open = false;
    contacts.hidden = selection?.kind !== 'ligand';
    if (!selection) return;
    const { kind, atom } = selection;
    const copy = atom.assemblyCopy ? ` · 组装副本 ${atom.assemblyCopy}` : '';
    card.textContent = `${STRUCTURE_LABELS[kind]} ${atom.residueName} · 作者编号 ${atom.authChainId || '—'}:${atom.authSeqId || '—'}${atom.insertionCode || ''} · 标签编号 ${atom.labelChainId || '—'}:${atom.labelSeqId || '—'}${copy}`;
    elements['structure-tools'].open = true;
  }

  const sequenceBar = createSequenceBar({
    root: elements['sequence-bar'], rowsBox: elements['sequence-rows'], info: elements['sequence-info'],
    onSelect(expression) {
      try {
        const result = selectSet(expression);
        elements['selection-expression'].value = expression;
        if (result) sequenceBar.setInfo(`已选 ${result.summary}（glow.select('${expression}')）`);
      } catch (error) { sequenceBar.setInfo(error.message); }
    },
  });
  /** Lights up what is selected: the whole expression set if there is one, otherwise the single picked residue. */
  function syncSequence() {
    if (!sequenceBar.visible) return;
    const set = active?.selectionSet;
    const picked = active?.structureSelection?.kind === 'residue' ? structureObjectId('residue', active.structureSelection.atom) : null;
    const chosen = set ? new Set(set.residues) : null;
    sequenceBar.highlight((residue) => chosen ? chosen.has(residue) : picked != null && structureObjectId('residue', residue.atom) === picked);
  }
  elements['sequence-toggle'].addEventListener('click', () => {
    const on = sequenceBar.setVisible();
    elements['sequence-toggle'].setAttribute('aria-pressed', String(on));
    if (on) { sequenceBar.setModel(active?.model); syncSequence(); }
  });
  let siteLoad = 0;
  function resetSiteChips() { siteLoad++; elements['sequence-chips'].replaceChildren(); elements['sequence-chips'].hidden = true; }
  elements['sequence-sites'].addEventListener('click', async () => {
    const token = ++siteLoad, chips = elements['sequence-chips'];
    const source = active?.scene.assets.find((asset) => asset.kind === 'file' && asset.provenance?.source)?.provenance.source;
    try {
      if (source?.provider !== 'RCSB PDB') throw new FunctionalSiteError('只有 PDB 条目才能读取 UniProt 注释');
      sequenceBar.setInfo('正在读取 UniProt 注释…');
      const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 20000);
      let result;
      try {
        result = await loadFunctionalSites(source.accession, {
          signal: controller.signal,
          async fetchJson(url, init) {
            const response = await fetch(url, init);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            return response.json();
          },
        });
      } finally { clearTimeout(timer); }
      if (token !== siteLoad) return;
      sequenceBar.setSites(result.sites);
      chips.replaceChildren();
      const entries = Object.entries(result.sites);
      for (const [type, list] of entries) {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.textContent = `${SITE_CATEGORIES[type].label} ${list.length}`;
        chip.style.cssText = `border-color:${SITE_CATEGORIES[type].color};color:${SITE_CATEGORIES[type].color}`;
        chip.addEventListener('click', () => {
          const r = selectSet(siteExpression(list));
          elements['selection-expression'].value = siteExpression(list);
          const notes = [...new Set(list.map((site) => site.text).filter(Boolean))].slice(0, 3).join('；');
          sequenceBar.setInfo(`${SITE_CATEGORIES[type].label}：已选 ${r?.summary ?? ''}（UniProt ${result.accessions.join('、')}）${notes ? ` ${notes}` : ''}`);
        });
        chips.append(chip);
      }
      const note = document.createElement('span');
      note.className = 'source';
      note.textContent = entries.length ? `来源 UniProt ${result.accessions.join('、')}（按 RCSB 序列比对换算）` : `这个条目在 UniProt（${result.accessions.join('、') || '无比对'}）里没有这些类别的注释`;
      chips.append(note);
      chips.hidden = false;
      sequenceBar.setInfo(result.warnings.length ? result.warnings.join(' ') : '点一个类别：在 3D 中选中这些残基');
    } catch (error) {
      if (token === siteLoad) sequenceBar.setInfo(error.name === 'AbortError' ? '读取 UniProt 超时，请稍后再试。' : error.message);
    }
  });
  elements['sequence-close'].addEventListener('click', () => { sequenceBar.setVisible(false); elements['sequence-toggle'].setAttribute('aria-pressed', 'false'); });

  /** The scene node that draws a chain group (`chainKey` metadata), of the main structure. */
  function nodeOfChain(key) {
    const source = active?.representationSource?.id;
    return active?.scene.nodes.find((node) => node.extensions?.[STRUCTURE]?.chainKey === key && node.extensions[STRUCTURE].sourceAssetId === source)?.id;
  }
  const loadChemicalComponent = (comp) => loadChemComp(comp, {
    async fetchText(url, init) {
      const response = await fetch(url, init);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.text();
    },
  });
  const takeApart = createTakeApart({
    viewport,
    elements: {
      panel: elements['take-apart-panel'], explode: elements['take-apart-explode'], all: elements['take-apart-all'], restore: elements['take-apart-restore'],
      play: elements['take-apart-play'], step: elements['take-apart-step'], pieces: elements['take-apart-pieces'], info: elements['take-apart-info'],
    },
    context: {
      model: () => active?.representationSource ? active.model : null,
      nodeForChain: nodeOfChain,
      targetFor: (residue) => active.structureTargets.get(structureObjectId('residue', residue.atom)),
      showResidues: (result, options) => showSelection(result, options),
      clearSelection: () => clearSet(),
      assemblyKeywords: () => ({}),
      setStatus,
    },
  });
  elements['take-apart-toggle'].addEventListener('click', () => {
    const on = takeApart.toggle();
    elements['take-apart-toggle'].setAttribute('aria-pressed', String(on));
  });
  function leaveTakeApart() { takeApart.exit(); elements['take-apart-toggle'].setAttribute('aria-pressed', 'false'); }
  const entryIntro = createEntryIntro({
    box: elements['entry-intro'], button: elements['entry-intro-load'],
    context: {
      entryId() {
        const source = active?.scene.assets.find((asset) => asset.kind === 'file' && asset.provenance?.source)?.provenance.source;
        return source?.provider === 'RCSB PDB' ? source.accession : null;
      },
      sizeOf(entity) {
        const counts = new Map();
        for (const residue of selectionSpace(active.model).residues) counts.set(residue.labelAsym, (counts.get(residue.labelAsym) ?? 0) + 1);
        return Math.max(0, ...entity.asyms.map((asym) => counts.get(asym) ?? 0));
      },
      ligands: () => [...new Set(selectionSpace(active.model).ligands.map((ligand) => ligand.comp))],
      select: (expression) => { elements['selection-expression'].value = expression; selectSet(expression); },
    },
  });
  /** Clipping: a slab through the model, or a wedge on marked parts (classic 剖面 / 剖开). State lives in active.clipping and is saved with the work. */
  function applyClipping() {
    const state = active?.clipping, frame = viewport.clipFrame();
    if (!frame || !state?.enabled) { viewport.setClipping({}); return; }
    if (state.scope === 'parts') {
      const planes = wedgePlanes({ toViewer: state.direction, center: frame.center, margin: 4 * PRESENTATION_METERS_PER_ANGSTROM });
      const parts = computeStructureParts(), nodeIds = new Set(state.wedgeParts.flatMap((key) => (parts.get(key) ?? []).map(({ id }) => id)));
      viewport.setClipping(planes && nodeIds.size ? { wedge: { planes, nodeIds } } : {});
    } else viewport.setClipping({ slab: slabPlane({ toViewer: state.direction, center: frame.center, radius: frame.radius, depth: state.depth }) });
  }
  function clipState() {
    if (!active) return null;
    active.clipping ??= normalizeClipping({ direction: viewport.clipFrame()?.toViewer ?? [0, 0, 1], depth: 0 });
    return active.clipping;
  }
  function syncClipControls() {
    const state = active?.clipping;
    elements['clip-enabled'].checked = Boolean(state?.enabled);
    elements['clip-depth'].value = String(state?.depth ?? 0);
    elements['clip-scope'].value = state?.scope ?? 'all';
    elements['clip-depth'].disabled = state?.scope === 'parts';
  }
  elements['clip-enabled'].addEventListener('change', () => {
    const state = clipState();
    if (!state) return;
    state.enabled = elements['clip-enabled'].checked;
    if (state.enabled) state.direction = normalizeClipping({ direction: viewport.clipFrame().toViewer }).direction;   // aim at the current view when switched on
    applyClipping();
  });
  elements['clip-depth'].addEventListener('input', () => { const state = clipState(); if (state) { state.depth = +elements['clip-depth'].value; applyClipping(); } });
  elements['clip-scope'].addEventListener('change', () => { const state = clipState(); if (state) { state.scope = elements['clip-scope'].value; syncClipControls(); applyClipping(); } });
  elements['clip-aim'].addEventListener('click', () => {
    const state = clipState();
    if (!state) return;
    state.direction = normalizeClipping({ direction: viewport.clipFrame().toViewer }).direction;
    applyClipping();
  });
  elements['structure-part-list'].addEventListener('change', (event) => {
    const key = event.target.dataset?.clipPart, state = key && clipState();
    if (!state) return;
    state.wedgeParts = event.target.checked ? [...new Set([...state.wedgeParts, key])] : state.wedgeParts.filter((value) => value !== key);
    applyClipping();
  });

  const ligandView = createLigandView({
    viewport, button: elements['ligand-view-toggle'], note: elements['ligand-view-note'], wrapper: elements['ligand-view-controls'],
    context: {
      selection: () => active?.structureSelection,
      ligandOf: (selection) => selectionSpace(active.models?.get(selection.sourceAssetId) ?? active.model).ligands.find((ligand) => ligand.atom === selection.atom),
      template: loadChemicalComponent,
    },
  });
  const stateMorph = createStateMorph({
    viewport,
    elements: {
      panel: elements['morph-panel'], core: elements['morph-core'], domains: elements['morph-domains'], apply: elements['morph-apply'], fraction: elements['morph-fraction'], auto: elements['morph-auto'], remove: elements['morph-remove'], info: elements['morph-info'],
    },
    context: {
      model: () => active?.model,
      canMorph: () => Boolean(active?.model) && !active.player,
      rebuild: () => refreshStructureView(),
      setStatus,
      template: loadChemicalComponent,
      nodeForResidue: (residue) => nodeOfChain(chainGroupKey(residue.atom)),
      async loadModel(input) {
        const service = host.getService(MODEL_SERVICE, '1.0.0');
        const source = active.representationSource, options = { assemblyId: source?.provenance?.assemblyId, chains: source?.provenance?.chains };
        let bytes, name, mediaType, origin;
        if (input.file) {
          if (input.file.size > 30 * 1024 * 1024) throw new Error('结构文件超过 30 MiB。');
          bytes = new Uint8Array(await input.file.arrayBuffer());
          name = input.file.name;
          mediaType = /\.m?cif$/i.test(name) ? 'chemical/x-mmcif' : 'chemical/x-pdb';
          origin = { provider: 'local file', name };
        } else {
          const loaded = await loadAccession(input.accession, undefined);
          ({ bytes, name } = loaded);
          mediaType = loaded.mediaType ?? 'chemical/x-mmcif';
          origin = loaded.source ?? { provider: 'RCSB PDB', accession: input.accession.toUpperCase() };
        }
        return { model: service.parse({ bytes, name, mediaType }, options), bytes, name, mediaType, source: origin };
      },
    },
  });
  elements['morph-load'].addEventListener('click', () => {
    const accession = elements['morph-accession'].value.trim();
    if (/^[0-9][A-Za-z0-9]{3}$/.test(accession)) stateMorph.load({ accession }, accession.toUpperCase());
    else elements['morph-info'].textContent = '请输入第二个构象的 4 位 RCSB 编号（首位是数字），或选择文件。';
  });
  elements['morph-file-button'].addEventListener('click', () => elements['morph-file'].click());
  elements['morph-file'].addEventListener('change', () => {
    const [file] = elements['morph-file'].files;
    elements['morph-file'].value = '';
    if (file) stateMorph.load({ file }, file.name);
  });
  const objectSpin = createObjectSpin({
    viewport,
    elements: {
      mode: elements['spin-mode'], from: elements['spin-from'], to: elements['spin-to'], pair: elements['spin-pair'], speed: elements['spin-speed'],
      play: elements['spin-play'], reset: elements['spin-reset'], info: elements['spin-info'], partList: elements['structure-part-list'],
    },
    context: { model: () => active?.model, parts: computeStructureParts },
  });
  const particleFlow = createParticleFlow({
    viewport,
    elements: {
      species: elements['particle-species'], count: elements['particle-count'], add: elements['particle-add'], from: elements['particle-from'], to: elements['particle-to'],
      flowAdd: elements['particle-flow-add'], rate: elements['particle-rate'], scale: elements['particle-scale'], play: elements['particle-play'],
      reset: elements['particle-reset'], clear: elements['particle-clear'], list: elements['particle-list'], info: elements['particle-info'],
      card: elements['particle-card'], stage: elements.viewport,
    },
    context: { model: () => active?.model },
  });
  const dataAnimation = createDataAnimation({
    viewport,
    elements: { scale: elements['data-scale'], pace: elements['data-pace'], play: elements['data-play'], reset: elements['data-reset'], counters: elements['data-counters'], events: elements['data-events'], info: elements['data-info'], kinetics: elements['data-kinetics'] },
    context: { model: () => active?.model },
  });
  const processPanel = createProcessPanel({
    elements: { title: elements['process-title'], speed: elements['process-speed'], speedOut: elements['process-speed-out'], play: elements['process-play'], reset: elements['process-reset'], jump: elements['process-jump'], jumpGo: elements['process-jump-go'],
      csv: elements['process-csv'], params: elements['process-params'], readout: elements['process-readout'], state: elements['process-state'], events: elements['process-events'], info: elements['process-info'] },
  });
  setProcessAvailable = (on) => processPanel.setAvailable(on);
  setParticlesAvailable = (on) => particleFlow.setAvailable(on);
  setDataAnimationAvailable = (on) => dataAnimation.setAvailable(on);
  function selectSet(expression) {
    const model = active?.model;
    if (!model) return null;
    const result = host.getService(MODEL_SERVICE, '1.0.0').selectExpression(model, expression, { previous: active.selectionSet });
    const shown = showSelection(result);
    // exactly one small molecule selected: it is the picked ligand (contacts, valence view), as if it had been tapped
    if (!result.residues.length && result.ligands.length === 1) {
      const key = structureObjectId('ligand', result.ligands[0].atom), target = [...active.structureTargets.values()].find((t) => t.kind === 'ligand' && structureObjectId('ligand', t.atom) === key);
      if (target) { showStructurePick(target); active.selectionSet = { ...result, summary: shown.summary }; syncSequence(); }
    } else if (active.structureSelection?.kind === 'ligand') showStructurePick();   // a different selection replaces the picked ligand
    return shown;
  }
  /** Marks, dims around and reports a selection result ({ residues, ligands }); the one place that turns a selection into what the viewport shows. */
  function showSelection(result, { markers = true } = {}) {
    if (!active?.model) return null;
    const summary = result.summary ?? describeSelection(result);
    active.selectionSet = { ...result, summary };
    const keys = new Set(result.residues.map(({ atom }) => structureObjectId('residue', atom)));
    const ligandKeys = new Set(result.ligands.map((ligand) => structureObjectId('ligand', ligand.atom)));
    const targets = new Set([...active.structureTargets.values()].filter((target) =>
      (target.kind === 'ligand' ? ligandKeys : keys).has(structureObjectId(target.kind, target.atom))));
    const marked = viewport.setPointSelections(targets, { dim: true, markers });
    syncSequence();
    return { residues: result.residues.length, ligands: result.ligands.length, marked, summary };
  }
  function clearSet() {
    if (active) active.selectionSet = undefined;
    viewport.setPointSelections();
    viewport.setLinks([]);
    syncSequence();
    sequenceBar.setInfo('拖动选择一段；灰块是结构里缺失的残基');
  }

  elements['structure-contacts'].addEventListener('toggle', (event) => {
    const ligand = active?.structureSelection;
    if (!event.currentTarget.open || ligand?.kind !== 'ligand') return;
    const service = host.getService(MODEL_SERVICE, '1.0.0');
    const contacts = service.contacts(active.models?.get(ligand.sourceAssetId) ?? active.model, ligand.atom);
    const rows = contacts.slice(0, 12).map(({ atom, distance }) =>
      `${atom.residueName} ${atom.authChainId || atom.labelChainId}:${atom.authSeqId || atom.labelSeqId}${atom.insertionCode} · ${distance.toFixed(2)} Å`);
    elements['structure-contact-list'].textContent = rows.length
      ? `按最近重原子距离排序（共 ${contacts.length} 个残基）。 ${rows.join('；')}`
      : '此结构的现有坐标中没有 4 Å 内的聚合物重原子。';
  });

  function restoreStructureView() {
    const view = active.representationSource?.provenance?.viewerState ?? active.scene.assets.find((asset) =>
      asset.kind === 'file' && ['chemical/x-mmcif', 'chemical/x-pdb'].includes(asset.mediaType) && asset.provenance?.viewerState)
      ?.provenance.viewerState;
    if (isViewCamera(view?.camera)) viewport.setCamera(view.camera);
    else if (active.scene.legacy && !active.navigation) resetPreviewCamera();
    if (typeof view?.selection === 'string') {
      showStructurePick(active.structureTargets?.get(view.selection));
    }
    const saved = view?.morph, second = saved && active.scene.assets.find(({ id }) => id === saved.assetId);
    if (second && active.models?.get(second.id) && active.resources.get(second.path)) {
      const loaded = { model: active.models.get(second.id), bytes: active.resources.get(second.path), name: second.path, mediaType: second.mediaType, source: second.provenance?.source };
      Promise.resolve().then(() => stateMorph.restore(loaded, typeof saved.label === 'string' ? saved.label : second.path, Number(saved.fraction) || 0, saved.config));
    }
    active.clipping = normalizeClipping(view?.clipping) ?? undefined;
    if (view?.spin) Promise.resolve().then(() => objectSpin.restore(view.spin));
    const particles = toolEntryFor(active.scene, SOLUTION_TOOL, (id) => host.resolveToolId(id) ?? id)?.config ?? view?.particles;   // the tool entry is the place; earlier files kept it in the view state
    if (particles) Promise.resolve().then(() => particleFlow.restore(particles));
    const data = toolEntryFor(active.scene, DATA_TOOL, (id) => host.resolveToolId(id) ?? id);
    const process = toolEntryFor(active.scene, PROCESS_TOOL, (id) => host.resolveToolId(id) ?? id);
    if (process && host.getTool(PROCESS_TOOL)) Promise.resolve().then(() => { try { processPanel.load(normalizeProcessConfig(process.config)); } catch (error) { setStatus(`无法运行随机过程。 ${error.message}`); } });
    if (data && host.getTool(DATA_TOOL)) Promise.resolve().then(() => { try { dataAnimation.load(normalizeDataConfig(data.config)); } catch (error) { setStatus(`无法运行数据动画。 ${error.message}`); } });
    syncClipControls();
    applyClipping();
  }

  function resetPreviewCamera() {
    const source = active?.scene.assets.find(({ provenance }) => provenance?.legacyCamera);
    const pose = source?.provenance.legacyCamera;
    const direction = pose?.direction;
    viewport.resetCamera(Array.isArray(direction) && direction.length === 3 && direction.every(Number.isFinite) ? pose : undefined);
  }

  function restoreStructureModel(loaded) {
    const service = host.getService(MODEL_SERVICE, '1.0.0');
    if (!service || !loaded.scene.dependencies.some(({ id, version }) => id === STRUCTURE && version === '1.0.0')) return;
    const sources = loaded.scene.assets.filter((asset) => asset.kind === 'file' &&
      ['chemical/x-mmcif', 'chemical/x-pdb'].includes(asset.mediaType));
    loaded.models = new Map();
    for (const source of sources) {
      try {
        const model = service.parse({ bytes: loaded.resources.get(source.path), name: source.path, mediaType: source.mediaType },
          { assemblyId: source.provenance?.assemblyId, chains: source.provenance?.chains });
        loaded.models.set(source.id, model);
        if (source === sources[0]) loaded.model = model;
      } catch (error) {
        loaded.warnings = [...loaded.warnings, `无法载入结构语义 ${source.id}。 ${error.message}`];
      }
    }
  }

  function structureLayers(loaded, requestedStyle) {
    const layers = geometryLayers(loaded);
    loaded.representationSource = undefined;
    loaded.structureTargets = new Map();
    const representation = host.getRepresentation(REPRESENTATION);
    if (!representation || !loaded.model) return layers;
    const [first] = structureSources(loaded.scene);
    if (!first) return layers;
    loaded.models ??= new Map([[first.id, loaded.model]]);
    const result = buildStructureLayers({
      scene: loaded.scene, models: loaded.models, layers, build: representation.build, style: requestedStyle, defaultStyle: defaultStyleFor(loaded.scene),
      onTarget(target, source, primary) {
        target.sourceAssetId = source.id;
        loaded.structureTargets.set(structureObjectId(target.kind, target.atom, source.id), target);
        if (primary) loaded.structureTargets.set(structureObjectId(target.kind, target.atom), target);
      },
    });
    loaded.representationSource = result.representationSource;
    return result.layers;
  }

  /** Ids of the assets of the structure part nodes of one source (the layers a conformation morph has to move). */
  function structureAssetIds(source) {
    return new Set((active?.scene.nodes ?? []).filter((node) => node.assetId && node.extensions?.[STRUCTURE]?.sourceAssetId === source?.id).map((node) => node.assetId));
  }
  function refreshStructureView(style) {
    if (!active?.model && !active?.representationSource) return;
    const camera = viewport.getCamera({ destination: true });
    const next = { ...active };
    const layers = structureLayers(next, style);
    active.player?.decorate(layers);
    stateMorph.decorate(layers, structureAssetIds(next.representationSource));
    const prepared = viewport.prepare(active.store.getSnapshot(), layers,
      { overlayCapacity: active.overlayCapacity, ...playerViewportOptions(active.player) });
    viewport.commit(prepared);
    active.handles.current = prepared;
    applyClipping();
    stateMorph.reapply();
    objectSpin.reapply();
    particleFlow.reapply();
    dataAnimation.reapply();
    active.representationSource = next.representationSource;
    active.structureTargets = next.structureTargets;
    if (style && active.representationSource) active.representationSource.provenance.viewerStyle = style;
    active.modeState = undefined;
    viewport.setCamera(camera);
    showPose();
    if (active.structureSelection) {
      const { kind, atom } = active.structureSelection;
      showStructurePick(active.structureTargets.get(structureObjectId(kind, atom, active.structureSelection.sourceAssetId)));
    }
  }

  function showStructureSummary() {
    const model = active?.model;
    const summary = elements['structure-summary'];
    const components = new Map();
    for (const node of active?.scene.nodes ?? []) {
      const info = node.extensions?.[STRUCTURE]?.legacyComponent;
      if (!info || typeof info.label !== 'string' || typeof info.accession !== 'string') continue;
      const item = components.get(info.index) ?? { ...info, count: 0 };
      item.count++;
      components.set(info.index, item);
    }
    elements['representation-label'].textContent = components.size ? '主结构表示' : '结构表示';
    elements['legacy-components'].hidden = components.size === 0;
    elements['legacy-component-list'].replaceChildren(...[...components.values()].map(({ label, accession, count }) => {
      const line = document.createElement('li');
      line.textContent = `${label} · ${accession}${count > 1 ? ` ×${count}` : ''}`;
      return line;
    }));
    showStructureParts();
    if (!summary) return;
    if (!model) { summary.textContent = ''; summary.hidden = true; return; }
    const atoms = model.atoms ?? [];
    const polymers = atoms.filter((atom) => atom.record === 'ATOM' || (model.format === 'mmcif' && atom.labelSeqId));
    const chains = new Set(polymers.map((atom) => JSON.stringify([atom.labelChainId || atom.authChainId, atom.assemblyCopy])));
    const residues = new Set(polymers.map((atom) => structureObjectId('residue', atom)));
    const source = active.scene.assets.find((asset) => asset.provenance?.source)?.provenance.source;
    const sourceText = source?.provider === 'RCSB PDB'
      ? `RCSB PDB ${source.accession}`
      : source?.name || source?.accession ? `本地文件 ${source.name ?? source.accession}` : '来源未记录';
    const assembly = model.assemblyId ? ` · 生物组装体 ${model.assemblyId}` : '';
    summary.textContent = `${sourceText} · ${model.format.toUpperCase()}${assembly} · ${atoms.length.toLocaleString()} 个原子 · ${chains.size} 条链 · ${residues.size.toLocaleString()} 个残基`;
    summary.hidden = false;
  }

  /** The scene's structure parts, grouped by (source, part name): Map(key -> nodes). */
  function computeStructureParts() {
    const parts = new Map();
    for (const node of active?.scene.nodes ?? []) {
      const part = node.extensions?.[STRUCTURE];
      if (typeof part?.sourceAssetId !== 'string' || typeof part.chainId !== 'string') continue;
      const key = JSON.stringify([part.sourceAssetId, node.name]);
      if (!parts.has(key)) parts.set(key, []);
      parts.get(key).push(node);
    }
    return parts;
  }

  function showStructureParts() {
    const parts = computeStructureParts();
    elements['structure-parts'].hidden = !parts.size;
    const list = elements['structure-part-list'];
    list.replaceChildren();
    if (active) active.structureParts = parts;
    for (const [key, nodes] of parts) {
      const item = document.createElement('li');
      const label = document.createElement('label');
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.dataset.structurePart = key;
      input.checked = nodes.every(({ visible }) => visible);
      input.indeterminate = !input.checked && nodes.some(({ visible }) => visible);
      label.append(input, ` ${nodes[0].name}`);
      item.append(label);
      const clipLabel = document.createElement('label');
      clipLabel.className = 'clip-part';
      const clipInput = document.createElement('input');
      clipInput.type = 'checkbox';
      clipInput.dataset.clipPart = key;
      clipInput.checked = Boolean(active.clipping?.wedgeParts.includes(key));
      const spinLabel = document.createElement('label');
      spinLabel.className = 'clip-part';
      const spinInput = document.createElement('input');
      spinInput.type = 'checkbox';
      spinInput.dataset.spinPart = key;
      spinInput.checked = objectSpin.marked.includes(key);
      spinLabel.append(spinInput, ' 旋转');
      spinLabel.title = '按“部件旋转”里选的轴转动这个部件（只是画面上的动作）';
      clipLabel.append(clipInput, ' 剖开');
      clipLabel.title = '“剖切范围”选“仅标为剖开的部件”时，从这个部件上切掉一个楔形';
      item.append(clipLabel, spinLabel);
      if (active.models?.has(nodes[0].extensions[STRUCTURE].sourceAssetId)) {
        const select = document.createElement('select');
        select.dataset.structurePartStyle = key;
        select.setAttribute('aria-label', `${nodes[0].name} 的表示`);
        for (const [value, text] of [['', '跟随结构'], ['cartoon', '结构示意'], ['blob', '团块'],
          ['functional', '功能分区'], ['surface', '低分辨率表面'], ['backbone', '主链']]) {
          select.add(new Option(text, value));
        }
        const asset = active.scene.assets.find(({ id }) => id === nodes[0].assetId);
        select.value = asset?.provenance?.legacyStyle ?? '';
        item.append(select);
      }
      list.append(item);
    }
  }

  elements['structure-part-list'].addEventListener('change', (event) => {
    const input = event.target;
    const selectedPart = active?.structureParts?.get(input.dataset.structurePartStyle);
    if (selectedPart?.length && (input.value === '' || STYLES.has(input.value))) {
      const ids = new Set(selectedPart.map(({ assetId }) => assetId));
      const assets = active.scene.assets.filter(({ id }) => ids.has(id));
      const previous = assets.map((asset) => asset.provenance.legacyStyle);
      for (const asset of assets) {
        if (input.value) asset.provenance.legacyStyle = input.value;
        else delete asset.provenance.legacyStyle;
      }
      try { refreshStructureView(); }
      catch (error) {
        assets.forEach((asset, index) => {
          if (previous[index]) asset.provenance.legacyStyle = previous[index];
          else delete asset.provenance.legacyStyle;
        });
        setStatus(`无法切换部件表示。 ${error.message}`);
        showStructureParts();
      }
      return;
    }
    const nodes = active?.structureParts?.get(input.dataset.structurePart);
    if (!nodes?.length) return;
    const visible = input.checked;
    const result = active.store.dispatch({ type: 'batch', commands: nodes.map(({ id }) =>
      ({ type: 'updateNode', id, patch: { visible } })) });
    if (!result.ok) {
      showStructureParts();
      setStatus(`无法更新部件显隐。 ${result.error.message}`);
      return;
    }
    for (const node of nodes) node.visible = visible;
    viewport.setNodeVisibility(nodes.map(({ id }) => id), visible);
    if (active.structureSelection && !viewport.setPointSelection(active.structureSelection)) showStructurePick();
  });

  function showPose() {
    if (active?.player) {
      const snapshot = active.player.snapshot();
      viewport.setMechanism({ ...snapshot, highlightedIds: active.player.steps[active.inspectionStep ?? snapshot.stage].nodeIds });
      showMechanism();
    } else if (active) viewport.applyPose(active.timeline.sample());
    syncMode();
    syncControls();
  }

  function syncMode() {
    const navigation = active?.navigation;
    if (!navigation) return;
    const view = navigation.current();
    // The mode panel lists the steps in mechanism mode, so the plain step list of the player controls steps aside.
    elements['mechanism-steps'].hidden = view.mode === 'mechanism';
    const selected = navigation.selection();
    const step = modePanel.syncStep(active.timeline.time, active.inspectionStep ?? active.player?.snapshot().stage);
    const previous = active.modeState;
    if (previous?.view === view && previous.selected === selected && previous.step === step) return;
    active.modeState = { view, selected, step };
    const hotspot = navigation.hotspotFor(selected);
    const highlightedIds = view.mode === 'mechanism' ? (step?.nodeIds ?? [])
      : selected !== view.nodeId ? [hotspot?.hotspotNodeId ?? selected] : [];
    viewport.setPresentation({ rootId: view.nodeId, highlightedIds: active.player ? [] : highlightedIds, connections: view.connections });
  }

  function focusCurrentView(duration) {
    const view = active?.navigation?.current();
    if (!view) return;
    const bookmark = active.scene.presentation.bookmarks.find(({ id }) => id === view.bookmarkId);
    const includeIds = new Set([
      ...(view.connections ?? []).flatMap(({ from, to }) => [from, to]),
      ...(view.steps ?? []).flatMap(({ nodeIds }) => nodeIds),
    ]);
    includeIds.delete(view.nodeId);
    viewport.focusNode(view.nodeId, { bookmark, duration, includeIds });
  }

  function showNavigationSelection() {
    const navigation = active?.navigation;
    if (!navigation) return;
    const selected = navigation.selection();
    const hotspot = navigation.hotspotFor(selected);
    const node = active.nodes.get(hotspot?.hotspotNodeId ?? selected);
    modePanel.syncSelection(node.id);
    elements['navigation-selection'].textContent = `当前选择：${node.name || node.id}`;
    for (const button of elements['navigation-entries'].children) {
      const isHotspot = button.dataset.viewId === hotspot?.id;
      button.classList.toggle('is-hotspot', isHotspot);
      if (isHotspot) button.setAttribute('aria-describedby', 'navigation-selection');
      else button.removeAttribute('aria-describedby');
    }
    syncMode();
  }

  function showNavigation() {
    const navigation = active?.navigation;
    const panel = elements['scene-navigation'];
    panel.hidden = !navigation;
    modePanel.show(navigation?.current(), active?.nodes, navigation?.children());
    elements['navigation-path'].replaceChildren();
    elements['navigation-entries'].replaceChildren();
    if (!navigation) {
      elements['navigation-back'].hidden = true;
      delete elements['navigation-heading'].dataset.mode;
      for (const id of ['navigation-scene', 'navigation-heading', 'navigation-selection']) elements[id].textContent = '';
      return;
    }
    const view = navigation.current();
    const path = navigation.path();
    elements['navigation-scene'].textContent = active.scene.title;
    elements['navigation-heading'].textContent = view.title;
    elements['navigation-heading'].dataset.mode = view.mode;
    for (const item of path) {
      const crumb = document.createElement('li');
      crumb.textContent = MODE_LABELS[item.mode];
      if (item === view) crumb.setAttribute('aria-current', 'location');
      elements['navigation-path'].append(crumb);
    }
    elements['navigation-back'].hidden = path.length === 1;
    for (const child of navigation.children()) {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.viewId = child.id;
      button.textContent = `进入${MODE_LABELS[child.mode]}：${child.title}`;
      elements['navigation-entries'].append(button);
    }
    showNavigationSelection();
  }

  function finishNavigation() {
    showNavigation();
    showPresentation();
    elements['navigation-heading'].focus();
  }

  function returnToParent() {
    const camera = active?.navigation?.back();
    if (!camera) return false;
    viewport.setCamera(camera, { duration: cameraDuration(), responsive: true });
    finishNavigation();
    if (active?.mechanismReturn) {
      showStructurePick(active.mechanismReturn.selection);
      active.mechanismReturn = undefined;
      elements['mechanism-back'].disabled = true;
    }
    return true;
  }

  function showPresentation() {
    const { presentation, evidence = [], legacy } = active?.scene ?? {};
    const view = active?.navigation?.current();
    const notes = presentation?.notes.filter(({ id }) => !view || view.labelIds.includes(id)) ?? [];
    const caption = legacy?.scene?.caption ?? legacy?.description;
    if (typeof caption === 'string' && caption) notes.push({ text: caption });
    for (const [part, note] of Object.entries(legacy?.scene?.notes ?? {})) {
      const lines = (Array.isArray(note) ? note : [note]).filter((line) => typeof line === 'string' && line);
      if (lines.length) notes.push({ text: [part, ...lines].join(' · ') });
    }
    const bookmarks = presentation?.bookmarks ?? [];
    elements.presentation.hidden = !notes.length && !bookmarks.length && !evidence.length;
    function renderList(id, entries, populate) {
      const list = elements[id];
      list.replaceChildren();
      list.hidden = entries.length === 0;
      for (const entry of entries) {
        const item = document.createElement('li');
        populate(item, entry);
        list.append(item);
      }
    }
    renderList('viewer-notes', notes, (item, { text }) => { item.textContent = text; });
    const entries = evidence.flatMap((entry) => {
      if (typeof entry.type === 'string' || typeof entry.citation === 'string') return [entry];
      return Object.entries(EVIDENCE_LABELS).flatMap(([type]) => {
        const fields = entry[type];
        return (Array.isArray(fields) ? fields : [fields]).filter((detail) => typeof detail === 'string')
          .map((citation) => ({ type, citation }));
      });
    });
    renderList('viewer-evidence', entries, (item, { type, citation, assetId }) => {
      item.textContent = [EVIDENCE_LABELS[type] ?? type, typeof citation === 'string' ? citation : assetId]
        .filter((value) => typeof value === 'string').join(' · ');
    });
    showHud(active?.scene?.title, entries);
    renderList('viewer-bookmarks', bookmarks, (item, bookmark) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = bookmark.name;
      button.dataset.bookmarkId = bookmark.id;
      item.append(button);
    });
  }

  // Which immutable resources this scene is built from, with their source and licence.
  function showResources() {
    const used = new Map();
    for (const asset of active?.scene.assets ?? []) {
      const ref = asset.provenance?.resource;
      if (ref) used.set(`${ref.id}@${ref.version}`, ref);
    }
    const summaries = resourceStore.list().filter((record) => used.has(`${record.id}@${record.version}`)).map(summarizeResource);
    elements.resources.hidden = summaries.length === 0;
    elements['resource-list'].replaceChildren(...summaries.map((item) => {
      const li = document.createElement('li');
      const size = item.files.reduce((total, file) => total + file.bytes, 0);
      const source = item.source.provider === 'rcsb' ? `RCSB ${item.source.accession}` : `本地文件 ${item.source.accession}`;
      li.textContent = `${source} · ${item.license === 'unknown' ? '授权未知（不随导出包嵌入）' : item.license} · ${(size / 1048576).toFixed(1)} MB · ${item.id}@${item.version}`;
      return li;
    }));
  }

  // Title and evidence badges, as in the classic viewer: how much of what is shown is measured, derived, modelled or schematic.
  function showHud(title, entries) {
    const counts = new Map();
    for (const { type } of entries) if (EVIDENCE_LABELS[type] && type !== 'source') counts.set(type, (counts.get(type) ?? 0) + 1);
    elements.hud.hidden = !title;
    elements['hud-title'].textContent = title ?? '';
    elements['hud-badges'].replaceChildren(...[...counts].map(([type, count]) => {
      const badge = document.createElement('li');
      badge.className = `badge badge-${type}`;
      badge.textContent = `${EVIDENCE_LABELS[type]} ${count}`;
      return badge;
    }));
  }

  async function openScene(input = {}, { propagate = false } = {}) {
    window.dispatchEvent(new Event('glow:scene-changing'));
    setStatus('正在打开场景…');
    try {
      const committed = await scenes.load(input);
      if (!committed && propagate) throw new Error('加载已被后续操作取消。');
    } catch (error) {
      setStatus(`无法打开场景。 ${error.message}`);
      if (propagate) throw error;
    }
  }

  // ---- workshop: works and resources of the official/community catalogues -------------------------------------------------
  // Opening a work or a resource downloads it, checks it against the hash the catalogue records, and only then loads it.
  const workshop = createWorkshopDialog(document, {
    load: () => loadCatalog({ base: workshopBase({ href: location.href, hostname: location.hostname }) }),
    toolTitle,
    actions: {
      works: [{ label: '打开', title: '下载、核对哈希后在 Viewer 中打开', run: (entry, catalog) => openWorkshopWork(entry, catalog) }],
      resources: [{ label: '打开结构', title: '从来源取回、核对哈希后作为结构打开', run: (entry) => openWorkshopResource(entry) }],
    },
  });
  async function openWorkshopWork(entry, catalog) {
    const bytes = await fetchWorkBytes(catalog, entry);
    await setStructureEnabled(true);   // official works restore their structures and mechanisms through the structure plugin
    await openScene({ file: new File([bytes], entry.file.split('/').pop()) }, { propagate: true });
  }
  async function openWorkshopResource(entry) {
    await setStructureEnabled(true);
    const structure = await fetchResource(entry, { load: (accession, { signal } = {}) => loadAccession(accession, signal ?? new AbortController().signal) });
    await openScene({ structure, assembly: elements['structure-assembly'].checked }, { propagate: true });
  }
  elements.workshop.addEventListener('click', () => workshop.open().catch((error) => setStatus(`无法打开工坊。 ${error.message}`)));
  elements.example.addEventListener('click', () => openScene());
  elements['four-modes-example'].addEventListener('click', () => openScene({ demo: true }));
  elements['navigation-entries'].addEventListener('click', (event) => {
    const id = event.target.closest('button[data-view-id]')?.dataset.viewId;
    if (!id || !active?.navigation?.enter(id, viewport.getCamera({ destination: true }))) return;
    focusCurrentView(cameraDuration());
    finishNavigation();
  });
  elements['navigation-back'].addEventListener('click', returnToParent);
  elements['viewer-bookmarks'].addEventListener('click', (event) => {
    const id = event.target.closest('button[data-bookmark-id]')?.dataset.bookmarkId;
    const bookmark = active?.scene.presentation?.bookmarks.find((item) => item.id === id);
    if (bookmark) viewport.setCamera(bookmark, {
      duration: active.navigation ? cameraDuration() : 0,
      responsive: Boolean(active.navigation),
    });
  });
  window.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing || event.repeat ||
        event.altKey || event.ctrlKey || event.metaKey || event.shiftKey ||
        event.target instanceof Element && event.target.closest('input, textarea, select, [contenteditable="true"]')) return;
    if (!elements['structure-pick'].hidden) {
      showStructurePick();
      event.preventDefault();
    } else if (returnToParent()) event.preventDefault();
  });
  async function setStructureEnabled(enabled, { propagate = false } = {}) {
    if (Boolean(host.getImporter(IMPORTER)) === enabled) return;
    const checkbox = elements['structure-enabled'];
    checkbox.checked = enabled;
    checkbox.disabled = true;
    try {
      if (checkbox.checked) {
        const { structurePlugin } = await import('../../plugins/structure/index.mjs');
        await host.activate(structurePlugin);
        for (const plugin of toolPlugins) await host.activate(plugin);
        for (const plugin of mechanismPlugins) await host.activate(plugin);
        elements['atp-enabled'].checked = true;
        structureLifetime = new AbortController();
        if (active) {
          const target = active;
          restoreStructureModel(target);
          await preparePlayer(target, structureLifetime.signal);
          if (active === target) {
            target.player = createPlayer(target);
            target.handles.player = target.player;
          }
        }
        setStatus('结构插件已启用。可打开本地 PDB 或 mmCIF 文件。');
      } else {
        structureLifetime?.abort();
        structureLifetime = undefined;
        active?.player?.dispose();
        if (active) { active.player = undefined; active.handles.player = undefined; }
        for (const plugin of mechanismPlugins) await host.deactivate(plugin.manifest.id);
        elements['atp-enabled'].checked = false;
        for (const plugin of toolPlugins) await host.deactivate(plugin.manifest.id);
        await host.deactivate(STRUCTURE);
        if (active) {
          active.model = undefined;
          active.models = undefined;
          showStructurePick();
        }
        setStatus('结构插件已关闭。');
      }
    } catch (error) {
      checkbox.checked = Boolean(host.getImporter(IMPORTER));
      setStatus(`无法切换结构插件。 ${error.message}`);
      if (propagate) throw error;
    } finally {
      checkbox.disabled = false;
      try { refreshStructureView(); }
      catch (error) { setStatus(`无法更新结构表示。 ${error.message}`); }
      syncControls();
      showDiagnostics();
      showStructureSummary();
      showMechanism();
    }
  }
  elements['structure-enabled'].addEventListener('change', (event) => setStructureEnabled(event.currentTarget.checked));

  elements['atp-enabled'].addEventListener('change', async (event) => {
    stopFrame();
    const checkbox = event.currentTarget;
    checkbox.disabled = true;
    try {
      if (checkbox.checked) {
        for (const plugin of mechanismPlugins) await host.activate(plugin);
        if (active) {
          const target = active;
          await preparePlayer(target, structureLifetime.signal);
          if (active === target) target.player = createPlayer(target);
        }
      } else {
        if (active?.player) {
          storePlayerState(active.scene, active.playerId, active.player.save(), (id) => host.resolveToolId(id) ?? id);
          active.player.dispose();
          active.player = undefined;
        }
        for (const plugin of mechanismPlugins) await host.deactivate(plugin.manifest.id);
      }
      if (active) active.handles.player = active.player;
      refreshStructureView();
      setStatus(checkbox.checked ? '官方机制插件已启用。' : '官方机制插件已停用。');
    } catch (error) {
      setStatus(`无法切换机制播放器。 ${error.message}`);
    } finally {
      checkbox.checked = mechanismPlugins.every((plugin) => Boolean(host.getPlayer(plugin.manifest.id)));
      syncControls(); showDiagnostics(); showMechanism();
    }
  });
  elements['representation-style'].addEventListener('change', (event) => {
    try { refreshStructureView(event.currentTarget.value); }
    catch (error) {
      syncControls();
      setStatus(`无法切换结构表示。 ${error.message}`);
    }
  });
  elements['rcsb-form'].addEventListener('submit', (event) => {
    event.preventDefault();
    openScene({ accession: elements.accession.value, assembly: elements['structure-assembly'].checked });
  });
  elements['selection-form'].addEventListener('submit', (event) => {
    event.preventDefault();
    const service = host.getService(MODEL_SERVICE, '1.0.0');
    if (!service || !active?.model) return;
    const chainId = elements['chain-id'].value.trim();
    const residueId = elements['residue-id'].value.trim();
    const atoms = service.select(active.model, { chainId: chainId || undefined, residueId: residueId || undefined });
    if (!atoms.length) { setStatus('未找到匹配的链或残基。'); return; }
    const residues = new Map();
    for (const atom of atoms) {
      const chain = atom.authChainId || atom.labelChainId || '(无链号)';
      const number = atom.authSeqId || atom.labelSeqId || '(无编号)';
      const insertion = atom.insertionCode ? `^${atom.insertionCode}` : '';
      const copy = atom.assemblyCopy ? ` · 副本 ${atom.assemblyCopy}` : '';
      residues.set(structureObjectId('residue', atom), `${atom.residueName} ${chain}:${number}${insertion}${copy}`);
    }
    const examples = [...residues.values()].slice(0, 8);
    setStatus(`匹配 ${atoms.length} 个原子、${residues.size} 个残基：${examples.join('；')}${residues.size > examples.length ? '；…' : ''}`);
  });
  elements['selection-help-text'].textContent = SELECTION_HELP;
  elements['selection-expression-form'].addEventListener('submit', (event) => {
    event.preventDefault();
    try {
      const result = selectSet(elements['selection-expression'].value);
      if (result) setStatus(`选中 ${result.summary}${result.marked < result.residues + result.ligands ? '（部分对象在当前表示中没有标记点）' : ''}`);
    } catch (error) { setStatus(error.message); }
  });
  elements['selection-clear'].addEventListener('click', () => { clearSet(); elements['selection-expression'].value = ''; setStatus('已清除选择。'); });
  elements.open.addEventListener('click', () => elements.file.click());
  for (const type of ['dragover', 'drop']) {
    elements.viewport.addEventListener(type, (event) => {
      if (!event.dataTransfer?.types.includes('Files')) return;
      event.preventDefault();
      if (type !== 'drop') return;
      const [file] = event.dataTransfer.files;
      if (file && isStructureFile(file.name)) openScene({ file, assembly: elements['structure-assembly'].checked });
      else setStatus('请拖入 PDB 或 mmCIF 结构文件。');
    });
  }
  elements.file.addEventListener('change', () => {
    const [file] = elements.file.files;
    elements.file.value = '';
    if (file) openScene({ file, assembly: elements['structure-assembly'].checked });
  });
  /** The particle set goes into the work as the tool's entry (config), replacing the configuration it was opened with; a set nobody touched leaves the work alone. */
  function storeParticles(scene) {
    const spec = particleFlow.save(), tool = host.getTool(SOLUTION_TOOL);
    if (!spec || !tool) return;
    const resolve = (id) => host.resolveToolId(id) ?? id, entry = toolEntryFor(scene, SOLUTION_TOOL, resolve);
    const config = normalizeSolutionConfig(spec);
    if (entry) entry.config = config;
    else if (config.pools.length || config.flows.length) {
      let id = 'solution-particles', n = 1;
      while (scene.tools.some((item) => item.id === id)) id = `solution-particles-${++n}`;
      scene.tools.push({ id, tool: { id: SOLUTION_TOOL, version: tool.version }, config });
    }
  }
  function sceneForExport() {
    const { representationSource, structureSelection } = active;
    const scene = structuredClone(active.scene);
    if (active.player) {
      storePlayerState(scene, active.playerId, active.player.save(), (id) => host.resolveToolId(id) ?? id);
      if (active.player.evidence) {
        if (!scene.evidence.some(({ citation }) => citation === active.player.evidence.citation)) scene.evidence.push(active.player.evidence);
      } else if (!scene.evidence.some(({ citation }) => citation === ATP_6ZPO_TEMPLATE.sceneEvidence.citation)) {
        scene.evidence.push({ type: 'modelled', ...ATP_6ZPO_TEMPLATE.sceneEvidence });   // wording lives in the work configuration
      }
    }
    storeParticles(scene);
    if (representationSource) {
      const source = scene.assets.find(({ id }) => id === representationSource.id);
      const camera = viewport.getCamera({ destination: true });
      source.provenance = { ...source.provenance, viewerState: {
        camera,
        ...(active.clipping?.enabled || active.clipping?.wedgeParts.length ? { clipping: active.clipping } : {}),
        ...(objectSpin.save() ? { spin: objectSpin.save() } : {}),
        selection: structureSelection ? structureObjectId(structureSelection.kind, structureSelection.atom, structureSelection.sourceAssetId) : null,
      } };
      if (source.provenance.viewerStyle === 'functional') {
        const citation = `功能分区为示意。${functionalDescription(scene, active.player)}`;
        if (!scene.evidence.some((item) => item.assetId === source.id && item.citation === citation)) {
          scene.evidence.push({ type: 'illustrative', assetId: source.id, citation });
        }
      }
    }
    return scene;
  }
  /** The scene and its files for saving: the loaded second conformation (if any) goes in as an ordinary structure file asset. */
  async function exportBundle() {
    const scene = sceneForExport(), state = stateMorph.save();
    let resources = active.resources;
    const source = scene.assets.find(({ id }) => id === active.representationSource?.id);
    if (state && source) {
      const path = `assets/conformation-b.${/\.m?cif$/i.test(state.name) ? 'cif' : 'pdb'}`;
      const digest = await crypto.subtle.digest('SHA-256', state.bytes);
      scene.assets.push({
        id: 'conformation-b', kind: 'file', path, mediaType: state.mediaType, sha256: [...new Uint8Array(digest)].map((v) => v.toString(16).padStart(2, '0')).join(''),
        provenance: { source: state.source, conformationOf: source.id },
      });
      source.provenance.viewerState = { ...source.provenance.viewerState, morph: { assetId: 'conformation-b', label: state.label, fraction: state.fraction, config: state.config } };
      resources = new Map(resources).set(path, state.bytes);
    }
    return { scene, resources };
  }
  elements.save.addEventListener('click', async () => {
    if (!active || saving) return;
    const { scene, resources: files } = await exportBundle();
    saving = true;
    syncControls();
    try {
      const bytes = await writeScenePackage(scene, files);
      const url = URL.createObjectURL(new Blob([bytes], { type: 'application/zip' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = `${scene.id}.glow`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      setStatus(`无法保存场景。 ${error.message}`);
    } finally {
      saving = false;
      syncControls();
    }
  });
  elements.close.addEventListener('click', () => {
    stopFrame();
    scenes.close();
    viewport.clear();
    active = undefined;
    showStructurePick();
    objectSpin.reset();
    particleFlow.reset();
    dataAnimation.reset();
    processPanel.reset();
    stateMorph.reset();
    entryIntro.reset();
    leaveTakeApart();
    sequenceBar.setModel(null);
    resetSiteChips();
    syncControls();
    showDiagnostics();
    showNavigation();
    showPresentation(); showResources();
    showStructureSummary();
    setStatus('场景已关闭');
  });
  elements['reset-camera'].addEventListener('click', () => {
    if (active?.navigation) focusCurrentView(cameraDuration());
    else resetPreviewCamera();
  });

  elements.playhead.addEventListener('input', () => {
    active.inspectionStep = undefined;
    if (active?.player) active.player.seek(Number(elements.playhead.value));
    else active.timeline.seek(Number(elements.playhead.value));
    showPose();
  });
  elements.play.addEventListener('click', () => {
    active.inspectionStep = undefined;
    if (active?.player) {
      const player = active.player;
      if (player.snapshot().playing) { player.pause(); stopFrame(); showPose(); return; }
      if (player.snapshot().time === player.duration) player.seek(0);
      player.play();
      let previous = performance.now();
      function tick(now) {
        if (active?.player !== player) return;
        player.advance(Math.min(0.1, Math.max(0, (now - previous) / 1000)));
        previous = now;
        showPose();
        frame = player.snapshot().playing ? requestAnimationFrame(tick) : undefined;
      }
      frame = requestAnimationFrame(tick);
      syncControls();
      return;
    }
    const { timeline } = active;
    if (timeline.playing) {
      timeline.pause();
      stopFrame();
      syncControls();
      return;
    }
    if (timeline.time === timeline.duration) timeline.seek(0);
    timeline.play();
    let previous = performance.now();
    function tick(now) {
      timeline.advance(Math.max(0, (now - previous) / 1000));
      previous = now;
      showPose();
      frame = timeline.playing ? requestAnimationFrame(tick) : undefined;
    }
    frame = requestAnimationFrame(tick);
    syncControls();
  });

  elements['mechanism-step'].addEventListener('click', () => {
    if (!active?.player) return;
    active.inspectionStep = undefined;
    stopFrame(); active.player.pause();
    active.player.seek(active.player.snapshot().time + 1 / 30);
    showPose();
  });
  elements['mechanism-speed'].addEventListener('change', (event) => {
    if (!active?.player) return;
    try { active.player.setSpeed(Number(event.target.value)); showPose(); }
    catch (error) { setStatus(error.message); showMechanism(); }
  });
  elements['mechanism-rate'].addEventListener('change', (event) => {
    active?.player?.setPlaybackRate(Number(event.target.value));
  });
  elements['mechanism-parameters'].addEventListener('change', (event) => {
    const key = event.target.dataset.parameter;
    if (!key || !active?.player?.setParameters) return;
    const type = active.mechanismControls?.get(key)?.type ?? 'number', raw = readControl(event.target);
    try { active.player.setParameters({ [key]: type === 'number' ? Number(raw) : type === 'boolean' ? Boolean(raw) : raw }); showPose(); }
    catch (error) { setStatus(error.message); }
    writeControl(event.target, active.player.snapshot().parameters[key]);
  });
  elements['mechanism-parameters'].addEventListener('input', (event) => {
    if (event.target.type === 'range') event.target.dispatchEvent(new Event('change', { bubbles: true }));
  });
  elements['mechanism-reset'].addEventListener('click', () => {
    const seed = Number(elements['mechanism-seed'].value);
    if (!active?.player || !Number.isSafeInteger(seed) || seed < 0 || seed > 4294967295) {
      setStatus('种子应为 0–4294967295 的整数。'); return;
    }
    stopFrame();
    active.inspectionStep = undefined;
    const { speed, playbackRate } = active.player.snapshot();
    const saved = active.player.setParameters ? active.player.save() : {};
    active.player.dispose();
    active.player = createPlayer(active, { ...saved, time: 0, speed, seed, playbackRate });
    active.handles.player = active.player;
    refreshStructureView(); showPose();
  });
  elements['mechanism-steps'].addEventListener('click', (event) => {
    const step = Number(event.target.closest('[data-mechanism-step]')?.dataset.mechanismStep);
    if (!active?.player || !Number.isInteger(step)) return;
    seekMechanismStep(step);
  });
  function seekMechanismStep(step) {
    stopFrame(); active.player.pause();
    const time = active.player.stepTime(step);
    active.inspectionStep = time === undefined ? step : undefined;
    if (time !== undefined) active.player.seek(time);
    showPose();
    const participants = active.player.steps[step].nodeIds;
    if (participants.length) viewport.focusNode(participants[0],
      { duration: cameraDuration(), includeIds: participants.slice(1), minRadiusFraction: MECHANISM_CONTEXT });
  }
  elements['mechanism-enter'].addEventListener('click', () => {
    if (!active?.player) return;
    if (active.navigation?.current().mode === 'mechanism') return;
    active.mechanismReturn = { camera: viewport.getCamera({ destination: true }), selection: active.structureSelection };
    const view = active.player.navigation.views.find((view) => view.mode === 'mechanism');
    if (active.navigation?.enter(view.id, viewport.getCamera({ destination: true }))) finishNavigation();
    const step = active.player.steps[active.player.snapshot().stage];
    if (step.nodeIds.length) viewport.focusNode(step.nodeIds[0], { duration: cameraDuration(), includeIds: step.nodeIds.slice(1), minRadiusFraction: MECHANISM_CONTEXT });
    elements['mechanism-back'].disabled = false;
  });
  elements['mechanism-protein'].addEventListener('click', () => {
    if (!active?.player) return;
    const view = active.player.navigation.views.find((view) => view.mode === 'protein');
    if (active.navigation?.enter(view.id, viewport.getCamera({ destination: true }))) finishNavigation();
    resetPreviewCamera();
  });
  elements['mechanism-back'].addEventListener('click', () => {
    if (!active?.mechanismReturn) return;
    if (returnToParent()) return;
    viewport.setCamera(active.mechanismReturn.camera, { duration: cameraDuration() });
    showStructurePick(active.mechanismReturn.selection);
    active.mechanismReturn = undefined;
    elements['mechanism-back'].disabled = true;
  });

  const commandLifetime = new AbortController();
  const commands = createCommandApi(createViewerCommands({
    signal: commandLifetime.signal,
    current: () => active,
    plugins: () => host.listActive(),
    resources: () => resourceStore.list().map(summarizeResource),
    camera: () => viewport.getCamera({ destination: true }),
    setCamera: (camera) => viewport.setCamera(camera),
    resetCamera: () => {
      if (active?.navigation) focusCurrentView(0);
      else if (active?.model) resetPreviewCamera();
      else viewport.resetCamera();
    },
    selection: () => {
      const target = active?.structureSelection;
      if (!target) return null;
      const { atom, kind, sourceAssetId } = target;
      return { kind, sourceAssetId, chainId: atom.authChainId, labelChainId: atom.labelChainId,
        residueId: atom.authSeqId, labelSeqId: atom.labelSeqId, insertionCode: atom.insertionCode,
        residueName: atom.residueName, assemblyCopy: atom.assemblyCopy ?? null };
    },
    select: showStructurePick,
    selectSet,
    clearSet,
    selectAtoms: (model, spec) => host.getService(MODEL_SERVICE, '1.0.0').select(model, spec),
    represent: (style) => { refreshStructureView(style); syncControls(); showStructureParts(); },
    enableStructure: () => setStructureEnabled(true, { propagate: true }),
    open: (input) => openScene(input, { propagate: true }),
    snapshot: (width) => viewport.snapshot(width),
    exportPack: async () => { const { scene, resources: files } = await exportBundle(); return writeScenePackage(scene, files); },
    animate(value) {
      active.inspectionStep = undefined;
      const playing = active.player ? active.player.snapshot().playing : active.timeline.playing;
      const changesTime = value.time != null || value.seed != null || value.step != null || value.steps != null || typeof value.morph === 'number';
      const paused = changesTime || (value.pause ?? !playing);
      if (playing) elements.play.click();
      if (value.seed != null) {
        const state = { ...active.player.save(), time: 0, seed: value.seed };
        active.player.dispose();
        active.player = createPlayer(active, state);
        active.handles.player = active.player;
        refreshStructureView();
      }
      const player = active.player ?? active.timeline;
      if (value.time != null) player.seek(value.time);
      if (value.speed != null) active.player.setSpeed(value.speed);
      if (value.parameters != null) active.player.setParameters(value.parameters);
      if (value.morph != null) active.player.setMorph(value.morph);
      if (value.step != null || value.steps != null) {
        const time = active.player?.snapshot().time ?? active.timeline.time;
        // seek uses the player's deterministic event schedule and preserves intervention history.
        player.seek(time + (value.step ?? 1 / 60) * (value.steps ?? 1));
      }
      showPose();
      if (!paused) elements.play.click();
    },
  }));
  window.glow = commands.api;
  const detachBridge = attachCommandBridge(window, commands.api, { getSceneToken: () => active });
  window.addEventListener('pagehide', (event) => {
    if (event.persisted) return;
    stopFrame();
    detachBridge();
    commandLifetime.abort();
    commands.dispose();
    structureLifetime?.abort();
    scenes.close();
    viewport.dispose();
  });
  // `?work=<id>` opens that workshop work at start (Studio's "在 Viewer 中打开" uses it); otherwise the basic example.
  const workId = new URLSearchParams(location.search).get('work');
  if (workId) {
    workshop.catalog().then((catalog) => {
      const entry = catalog.works.find(({ id }) => id === workId);
      if (!entry) throw new Error(`工坊里没有作品 ${workId}。`);
      return openWorkshopWork(entry, catalog);
    }).catch((error) => setStatus(`无法打开工坊作品。 ${error.message}`));
  } else openScene();
}

try {
  boot();
} catch (error) {
  window.__glowStartup?.hide();
  setStatus(`无法启动三维视口。 ${error.message}`);
  elements.example.disabled = true;
  elements['four-modes-example'].disabled = true;
  elements.open.disabled = true;
}
