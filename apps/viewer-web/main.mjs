import { createDocumentStore, createLoadCoordinator, createTimeline } from '../../packages/core/index.mjs';
import { writeScenePackage } from '../../packages/schema/archive.mjs';
import { toCoreDocument } from '../../packages/schema/documents.mjs';
import { GEOMETRY_MEDIA_TYPE } from '../../packages/schema/geometry.mjs';
import { createPluginHost } from '../../packages/plugin-host/index.mjs';
import { exampleScene } from './example-scene.mjs';
import { fromPrototype, geometryLayers, isStructureFile, openSceneFile } from './scene-io.mjs';
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
  const viewport = createViewport(elements.viewport, {
    onSelect(id) {
      const node = active?.document.nodes.find((candidate) => candidate.id === id);
      const metadata = active?.scene.nodes.find((candidate) => candidate.id === id)?.extensions?.[STRUCTURE];
      if (typeof metadata?.chainId === 'string' && active.model) elements['chain-id'].value = metadata.chainId;
      setStatus(node ? `已选择 ${node.name}` : (active?.name ?? '场景已关闭'));
    },
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
        loaded = input.file ? await openSceneFile(input.file) : fromPrototype(exampleScene);
        restoreStructureModel(loaded);
      }
      if (signal.aborted) return;
      const layers = geometryLayers(loaded);
      const store = createDocumentStore(toCoreDocument(loaded.scene, new Set(layers.keys())));
      const document = store.getSnapshot();
      const timeline = createTimeline(document.timeline);
      const prepared = viewport.prepare(document, layers);
      scope.add(() => prepared.dispose());
      return { ...loaded, store, document, timeline, prepared, name: input.file?.name ?? input.accession ?? '基础几何示例' };
    },
    commit(scene) {
      viewport.commit(scene.prepared);
      stopFrame();
      active = scene;
      elements['chain-id'].value = '';
      elements['residue-id'].value = '';
      showPose();
      showDiagnostics();
      showPresentation();
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
    syncControls();
  }

  function showPresentation() {
    const { presentation, evidence = [] } = active?.scene ?? {};
    const notes = presentation?.notes ?? [];
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
      button.addEventListener('click', () => viewport.setCamera(bookmark));
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
    showPresentation();
    setStatus('场景已关闭');
  });
  elements['reset-camera'].addEventListener('click', () => viewport.resetCamera());

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
  setStatus(`无法启动三维视口。 ${error.message}`);
  elements.example.disabled = true;
  elements.open.disabled = true;
}
