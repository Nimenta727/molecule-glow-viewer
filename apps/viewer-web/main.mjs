import { createDocumentStore, createLoadCoordinator, createTimeline } from '../../packages/core/index.mjs';
import { writeScenePackage } from '../../packages/schema/archive.mjs';
import { toCoreDocument } from '../../packages/schema/documents.mjs';
import { GEOMETRY_MEDIA_TYPE } from '../../packages/schema/geometry.mjs';
import { createPluginHost } from '../../packages/plugin-host/index.mjs';
import { exampleScene } from './example-scene.mjs';
import { fromPrototype, geometryLayers, isStructureFile, openSceneFile } from './scene-io.mjs';
import { createSceneNavigation } from './scene-navigation.mjs';
import { createModePanel } from './mode-panel.mjs';
import { createViewport } from '../../packages/render-three/viewport.mjs';

const elements = Object.fromEntries(
  [...document.querySelectorAll('[id]')].map((element) => [element.id, element]),
);

let active;
let frame;
let saving = false;
const STRUCTURE = 'org.glow.structure';
const IMPORTER = `${STRUCTURE}.coordinates`;
const MODEL_SERVICE = `${STRUCTURE}.model`;
const EVIDENCE_LABELS = { source: '来源', derived: '推导', modelled: '建模', illustrative: '示意' };
const MODE_LABELS = { cell: '细胞', system: '局部系统', protein: '蛋白质', mechanism: '反应机理' };
const host = createPluginHost({
  getScene: () => active?.store.getSnapshot() ?? null,
  dispatch: () => { throw new Error('这个入口用于查看。请在制作台编辑场景。'); },
});

function setStatus(message) {
  elements.status.textContent = message;
}

function syncControls() {
  const timeline = active?.timeline;
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
  elements['selection-form'].hidden = !structureEnabled || !active?.model;
}

function showDiagnostics() {
  const scene = active?.scene;
  const diagnostics = new Set(active?.warnings);
  const installed = new Map(host.listActive().map(({ id, version }) => [id, version]));
  const missing = scene?.dependencies.filter(({ id, version }) => installed.get(id) !== version) ?? [];
  if (missing.length) {
    diagnostics.add(`部分内容依赖插件 ${missing.map(({ id }) => id).join('、')}。`);
  }
  if (!active?.model && scene?.assets.some(({ kind, mediaType }) => kind !== 'primitive' && mediaType !== GEOMETRY_MEDIA_TYPE)) {
    diagnostics.add('需要相应插件才能查看专业资源。包内通用几何仍可查看。');
  }
  elements.warning.textContent = [...diagnostics].join(' ');
  elements.diagnostic.hidden = diagnostics.size === 0;
  elements['legacy-viewer'].hidden = !scene?.legacy || diagnostics.size === 0;
}

function stopFrame() {
  if (frame !== undefined) cancelAnimationFrame(frame);
  frame = undefined;
}

function boot() {
  let structureLifetime;
  let rcsb;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const cameraDuration = () => reducedMotion.matches ? 0 : 280;
  const viewport = createViewport(elements.viewport, {
    selectOnTap: true,
    onSelect(id) {
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
      if (step.time !== undefined) {
        active.timeline.pause();
        stopFrame();
        active.timeline.seek(step.time);
      }
      showPose();
    },
    onRotate(direction) { viewport.orbitBy(direction * Math.PI / 8, { duration: cameraDuration() }); },
  });
  const scenes = createLoadCoordinator({
    async prepare(input, { signal, scope }) {
      let loaded;
      if (input.accession || (input.file && isStructureFile(input.file.name))) {
        const importer = host.getImporter(IMPORTER);
        if (!importer || !structureLifetime) throw new Error('请先启用官方结构插件。');
        const combined = AbortSignal.any([signal, structureLifetime.signal]);
        let structure;
        if (input.accession) {
          if (!rcsb) {
            const { createRcsbSource } = await import('../../plugins/rcsb/index.mjs');
            rcsb = createRcsbSource();
          }
          structure = await rcsb.load(input.accession, { signal: combined });
        } else {
          if (input.file.size > 30 * 1024 * 1024) throw new Error('结构文件超过 30 MiB。');
          structure = { name: input.file.name, bytes: new Uint8Array(await input.file.arrayBuffer()) };
        }
        loaded = await importer.importScene(structure, { signal: combined });
      } else {
        if (input.demo) {
          const { fourModesDemo } = await import('./four-modes-demo.mjs');
          loaded = { scene: fourModesDemo, resources: new Map(), warnings: [] };
        } else loaded = input.file ? await openSceneFile(input.file) : fromPrototype(exampleScene);
        restoreStructureModel(loaded);
      }
      if (signal.aborted) return;
      const layers = geometryLayers(loaded);
      const store = createDocumentStore(toCoreDocument(loaded.scene, new Set(layers.keys())));
      const document = store.getSnapshot();
      const timeline = createTimeline(document.timeline);
      const views = loaded.scene.presentation?.navigation?.views ?? [];
      const overlayCapacity = views.reduce((capacity, { steps, connections }) => {
        const highlights = (steps ?? []).reduce((max, { nodeIds }) => Math.max(max, nodeIds.length), 1);
        return Math.max(capacity, (connections?.length ?? 0) * 6 + highlights * 24);
      }, 0);
      const prepared = viewport.prepare(document, layers, { overlayCapacity });
      scope.add(() => prepared.dispose());
      const navigation = createSceneNavigation(loaded.scene.presentation?.navigation, document.nodes);
      const nodes = new Map(loaded.scene.nodes.map((node) => [node.id, node]));
      const name = input.file?.name ?? input.accession ?? (input.demo ? '四模式示例' : '基础几何示例');
      return { ...loaded, store, nodes, timeline, prepared, navigation, name };
    },
    commit(scene) {
      const restoreFocus = elements['scene-navigation'].contains(document.activeElement);
      viewport.commit(scene.prepared);
      stopFrame();
      active = scene;
      elements['chain-id'].value = '';
      elements['residue-id'].value = '';
      showNavigation();
      showPose();
      showDiagnostics();
      focusCurrentView(0);
      showPresentation();
      if (restoreFocus) (scene.navigation ? elements['navigation-heading'] : elements.open).focus();
      setStatus(scene.name);
    },
  });

  function restoreStructureModel(loaded) {
    const service = host.getService(MODEL_SERVICE, '1.0.0');
    if (!service || !loaded.scene.dependencies.some(({ id, version }) => id === STRUCTURE && version === '1.0.0')) return;
    const source = loaded.scene.assets.find((asset) => asset.kind === 'file' &&
      ['chemical/x-mmcif', 'chemical/x-pdb'].includes(asset.mediaType));
    if (!source) return;
    try {
      loaded.model = service.parse({ bytes: loaded.resources.get(source.path), name: source.path, mediaType: source.mediaType });
    } catch (error) {
      loaded.warnings = [...loaded.warnings, `无法载入结构语义。 ${error.message}`];
    }
  }

  function showPose() {
    if (active) viewport.applyPose(active.timeline.sample());
    syncMode();
    syncControls();
  }

  function syncMode() {
    const navigation = active?.navigation;
    if (!navigation) return;
    const view = navigation.current();
    const selected = navigation.selection();
    const step = modePanel.syncStep(active.timeline.time);
    const previous = active.modeState;
    if (previous?.view === view && previous.selected === selected && previous.step === step) return;
    active.modeState = { view, selected, step };
    const hotspot = navigation.hotspotFor(selected);
    const highlightedIds = view.mode === 'mechanism' ? (step?.nodeIds ?? [])
      : selected !== view.nodeId ? [hotspot?.hotspotNodeId ?? selected] : [];
    viewport.setPresentation({ rootId: view.nodeId, highlightedIds, connections: view.connections });
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
    return true;
  }

  function showPresentation() {
    const { presentation, evidence = [] } = active?.scene ?? {};
    const view = active?.navigation?.current();
    const notes = presentation?.notes.filter(({ id }) => !view || view.labelIds.includes(id)) ?? [];
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
    const entries = evidence.filter(({ type, citation }) => typeof type === 'string' || typeof citation === 'string');
    renderList('viewer-evidence', entries, (item, { type, citation, assetId }) => {
      item.textContent = [EVIDENCE_LABELS[type] ?? type, typeof citation === 'string' ? citation : assetId]
        .filter((value) => typeof value === 'string').join(' · ');
    });
    renderList('viewer-bookmarks', bookmarks, (item, bookmark) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = bookmark.name;
      button.dataset.bookmarkId = bookmark.id;
      item.append(button);
    });
  }

  async function openScene(input = {}) {
    setStatus('正在打开场景…');
    try {
      await scenes.load(input);
    } catch (error) {
      setStatus(`无法打开场景。 ${error.message}`);
    }
  }

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
    if (returnToParent()) event.preventDefault();
  });
  elements['structure-enabled'].addEventListener('change', async (event) => {
    const checkbox = event.currentTarget;
    checkbox.disabled = true;
    try {
      if (checkbox.checked) {
        const { structurePlugin } = await import('../../plugins/structure/index.mjs');
        await host.activate(structurePlugin);
        structureLifetime = new AbortController();
        if (active) restoreStructureModel(active);
        setStatus('结构插件已启用。可打开本地 PDB 或 mmCIF 文件。');
      } else {
        structureLifetime?.abort();
        structureLifetime = undefined;
        await host.deactivate(STRUCTURE);
        if (active) active.model = undefined;
        setStatus('结构插件已关闭。');
      }
    } catch (error) {
      checkbox.checked = Boolean(host.getImporter(IMPORTER));
      setStatus(`无法切换结构插件。 ${error.message}`);
    } finally {
      checkbox.disabled = false;
      syncControls();
      showDiagnostics();
    }
  });
  elements['rcsb-form'].addEventListener('submit', (event) => {
    event.preventDefault();
    openScene({ accession: elements.accession.value });
  });
  elements['selection-form'].addEventListener('submit', (event) => {
    event.preventDefault();
    const service = host.getService(MODEL_SERVICE, '1.0.0');
    if (!service || !active?.model) return;
    const chainId = elements['chain-id'].value.trim();
    const residueId = elements['residue-id'].value.trim();
    const atoms = service.select(active.model, { chainId: chainId || undefined, residueId: residueId || undefined });
    setStatus(atoms.length ? `选中 ${atoms.length} 个原子。` : '未找到匹配的链或残基。');
  });
  elements.open.addEventListener('click', () => elements.file.click());
  elements.file.addEventListener('change', () => {
    const [file] = elements.file.files;
    elements.file.value = '';
    if (file) openScene({ file });
  });
  elements.save.addEventListener('click', async () => {
    if (!active || saving) return;
    const { scene, resources } = active;
    saving = true;
    syncControls();
    try {
      const bytes = await writeScenePackage(scene, resources);
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
    syncControls();
    showDiagnostics();
    showNavigation();
    showPresentation();
    setStatus('场景已关闭');
  });
  elements['reset-camera'].addEventListener('click', () => {
    if (active?.navigation) focusCurrentView(cameraDuration());
    else viewport.resetCamera();
  });

  elements.playhead.addEventListener('input', () => {
    active.timeline.seek(Number(elements.playhead.value));
    showPose();
  });
  elements.play.addEventListener('click', () => {
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

  window.addEventListener('pagehide', (event) => {
    if (event.persisted) return;
    stopFrame();
    structureLifetime?.abort();
    scenes.close();
    viewport.dispose();
  });
  openScene();
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
