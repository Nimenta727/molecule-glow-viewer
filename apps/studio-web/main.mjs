import { Euler, MathUtils, Quaternion } from 'three';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { createTimeline } from '../../packages/core/index.mjs';
import { createPluginHost } from '../../packages/plugin-host/index.mjs';
import { createViewport } from '../../packages/render-three/viewport.mjs';
import { writeScenePackage } from '../../packages/schema/archive.mjs';
import { planEmbedding } from '../../packages/schema/export-policy.mjs';
import { decodeGeometry, GEOMETRY_MEDIA_TYPE } from '../../packages/schema/geometry.mjs';
import { createStudioSession } from '../../packages/studio-editor/session.mjs';
import { decodeProject, encodeProject } from '../../packages/studio-editor/project-io.mjs';
import { createRecovery, indexedDbStore } from '../../packages/studio-editor/recovery.mjs';
import { createNavigationEditor } from './navigation-editor.mjs';
import { createToolConfigPanel } from './tool-config.mjs';
import { initTabs } from './panel-tabs.mjs';
import { autoBindings } from '../../packages/plugin-host/tool-model.mjs';
import { buildStructureLayers, structureSources } from '../../plugins/structure/view-layers.mjs';
import { loadCatalog, workshopBase, fetchResource } from '../../plugins/workshop/catalog.mjs';
import { createWorkshopDialog } from '../../plugins/workshop/dialog.mjs';
import { createParticlePreview } from './particle-preview.mjs';
import { defaultStyleFor } from '../../plugins/default-style.mjs';
import { readScenePackage } from '../../packages/schema/archive.mjs';
import { upgradeSceneToV3 } from '../../packages/schema/migrate.mjs';
import { toolEntriesForScene, toolTitle, isKnownTool } from '../../plugins/mechanism-catalog.mjs';
import { checkPublication, nextRevision } from '../../plugins/workshop/publish.mjs';
import { TOPICS } from '../../plugins/workshop/catalog.mjs';
import { clickSelection, reparentPlan, groupPlan, removePlan } from './outline-edit.mjs';
import { readForm, fillForm, licenseChoices, revisionHint, FormError } from './publish-form.mjs';
import { LICENSES } from '../../plugins/workshop/diagnose.mjs';

const ui = Object.fromEntries([...document.querySelectorAll('[id]')].map((element) => [element.id, element]));
const AXES = ['x', 'y', 'z'];
const TYPES = { source: '来源', derived: '推导', modelled: '建模', illustrative: '示意' };
const identity = () => ({ position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] });
const makeId = (prefix) => `${prefix}-${crypto.randomUUID()}`;
const status = (message) => { ui.status.textContent = message; };

let project;
let sessions;
let selection = null;   // the node the inspector shows (the one clicked last)
let multi = [];         // every selected outline row, in row order (Ctrl/Cmd-click toggles, Shift-click selects a range)
let rowAnchor = null;
let rowOrder = [];      // the outline's row order, for range selection
let timeline;
let frame;
let loading = 0;
let structureReady;
let viewport;
let editingPose = false;
const previews = new WeakMap();
const navigationEditor = createNavigationEditor(ui['navigation-editor'], {
  getSelection: () => selection,
  getTime: () => timeline.time,
  save: (navigation) => edit({ type: 'setNavigation', navigation }, '已保存展示导航。'),
});

function session() { return sessions.get(project.activeSceneId); }

// The structure importer and the mechanism plugins are activated on demand; the latter register the tools whose
// authoring configuration the "工具配置" section edits.
function ensureStructurePlugin() {
  structureReady ??= import('../../plugins/structure/index.mjs').then(({ structurePlugin, STRUCTURE_IMPORTER_ID }) =>
    host.activate(structurePlugin).then(() => STRUCTURE_IMPORTER_ID)).catch((error) => {
    structureReady = undefined;
    throw error;
  });
  return structureReady;
}
let toolPluginsReady;
function ensureToolPlugins() {
  toolPluginsReady ??= (async () => {
    await ensureStructurePlugin();
    const { mechanismPlugins, toolPlugins } = await import('../../plugins/mechanism-catalog.mjs');
    const active = new Set(host.listActive().map(({ id }) => id));
    for (const plugin of [...toolPlugins, ...mechanismPlugins]) if (!active.has(plugin.manifest.id)) await host.activate(plugin);
  })().catch((error) => { toolPluginsReady = undefined; throw error; });
  return toolPluginsReady;
}
const toolConfigPanel = createToolConfigPanel(ui['tool-config'], {
  getTool: (id) => host.getTool(id),
  getScene: () => session().getScene(),
  apply: (id, config) => edit({ type: 'setToolConfig', id, config }, '已更新工具配置。'),
  report: (message) => status(message),
  listTools: () => host.listTools({ audience: 'author' }),
  addTool: (toolId) => {
    const tool = host.getTool(toolId), entry = { tool: { id: toolId, version: tool.version }, config: JSON.parse(JSON.stringify(tool.author.template)) };
    const bindings = autoBindings(tool, session().getScene(), entry);   // the tool proposes the objects it works on in this scene
    edit({ type: 'addToolEntry', entry: Object.keys(bindings).length ? { ...entry, bindings } : entry, dependencies: tool.dependencies ?? [] }, Object.keys(bindings).length ? '已添加工具，并按建议绑定对象。' : '已添加工具（场景里没有可绑定的对象）。');
  },
  removeTool: (id) => edit({ type: 'removeToolEntry', id }, '已移除工具条目。'),
  setBindings: (id, bindings) => edit({ type: 'setToolBindings', id, bindings }, '已更新对象绑定。'),
});
// Tabs: properties / tools / story. Opening the tools tab activates the tool plugins so the tool list is complete.
initTabs(document.querySelector('.tabs'), {
  storageKey: 'glow.studio.tab',
  onSelect: (tab) => {
    if (tab.id !== 'tab-tools' || !project) return;
    ensureToolPlugins().then(() => toolConfigPanel.render(session().getScene())).catch((error) => status(`无法启用工具插件。 ${error.message}`));
  },
});

// ---- Publish tab: the scene's `publication` block (author, licence, topic, revision, derivation) and the publish check the workshop validators also run ---------------------------------
let publishCatalog = null;   // loaded on demand; the check works without it (it then cannot see existing versions or parents)
const FIELDS = { license: 'pub-license', authorName: 'pub-author', authorUrl: 'pub-author-url', topic: 'pub-topic', description: 'pub-description', tags: 'pub-tags', revision: 'pub-revision', updated: 'pub-updated' };
function publishValues() {
  const [derivedId = '', derivedRevision = ''] = ui['pub-derived'].value.split('@');
  return { ...Object.fromEntries(Object.entries(FIELDS).map(([key, id]) => [key, ui[id].value])), derivedId, derivedRevision };
}
function parentOf(id) { return publishCatalog ? [...publishCatalog.templates, ...publishCatalog.works].find((entry) => entry.id === id) : undefined; }
function syncLicenseOptions() {
  const [parentId] = ui['pub-derived'].value.split('@'), parent = parentId ? parentOf(parentId) : null, current = ui['pub-license'].value;
  const choices = licenseChoices(parent);
  ui['pub-license'].replaceChildren(...choices.map((choice) => Object.assign(new Option(choice.allowed ? choice.name : `${choice.name}（不可用）`, choice.id), { disabled: !choice.allowed, title: choice.reason ?? '' })));
  ui['pub-license'].value = choices.find((choice) => choice.id === current && choice.allowed)?.id ?? choices.find((choice) => choice.allowed)?.id ?? current;
  ui['pub-derived-note'].textContent = parent ? `派生自「${parent.title}」第 ${parent.revision ?? 1} 版（${parent.license}）。` : '';
}
function syncRevisionHint() {
  const scene = project ? session().getScene() : null;
  ui['pub-revision-hint'].textContent = scene && publishCatalog ? revisionHint(publishCatalog, scene.id, ui['pub-author'].value.trim()).text : (publishCatalog ? '' : '读取工坊目录后会提示已有的版本。');
}
function fillDerivedOptions() {
  const entries = publishCatalog ? [...publishCatalog.templates, ...publishCatalog.works].sort((a, b) => a.title.localeCompare(b.title, 'zh')) : [];
  const current = ui['pub-derived'].value;
  ui['pub-derived'].replaceChildren(new Option('（无）', ''), ...entries.map((entry) => new Option(`${entry.title}（第 ${entry.revision ?? 1} 版 · ${entry.license}）`, `${entry.id}@${entry.revision ?? 1}`)));
  if (current && ![...ui['pub-derived'].options].some((option) => option.value === current)) ui['pub-derived'].append(new Option(current.split('@')[0], current));
  ui['pub-derived'].value = current;
}
let publishSynced = '';
function syncPublish(scene) {
  const stamp = JSON.stringify([scene.id, scene.publication ?? null]);   // the form is rewritten only when the scene or its saved publication changed, never over what is being typed
  if (stamp === publishSynced) return;
  publishSynced = stamp;
  const form = fillForm(scene.publication);
  for (const [key, id] of Object.entries(FIELDS)) ui[id].value = form[key];
  if (!ui['pub-topic'].options.length || ui['pub-topic'].options.length === 1) for (const [id, name] of Object.entries(TOPICS)) ui['pub-topic'].append(new Option(name, id));
  ui['pub-topic'].value = form.topic;
  ui['pub-derived'].value = form.derivedId ? `${form.derivedId}@${form.derivedRevision}` : '';
  if (form.derivedId && ui['pub-derived'].value !== `${form.derivedId}@${form.derivedRevision}`) { ui['pub-derived'].append(new Option(form.derivedId, `${form.derivedId}@${form.derivedRevision}`)); ui['pub-derived'].value = `${form.derivedId}@${form.derivedRevision}`; }
  syncLicenseOptions(); ui['pub-license'].value = form.license; syncRevisionHint();
}
function renderCheck(result) {
  const LEVELS = { error: '问题', warning: '注意', info: '说明' };
  ui['pub-results'].replaceChildren(...result.problems.map((item) => Object.assign(document.createElement('li'), { textContent: `${LEVELS[item.level]}：${item.message}`, className: `pub-${item.level}` })));
  ui['pub-note'].textContent = result.ok ? '检查通过：可以用“导出场景”得到场景包并投稿。' : '检查没有通过：先处理标为“问题”的项目。';
}
function savePublication() {
  let publication;
  try { publication = readForm(publishValues()); } catch (error) { if (error instanceof FormError) { ui['pub-note'].textContent = error.message; return null; } throw error; }
  edit({ type: 'setPublication', publication }, '已保存发布信息。');
  return publication;
}
ui['pub-license'].replaceChildren(...licenseChoices(null).map((choice) => new Option(choice.name, choice.id)));
for (const [id, name] of Object.entries(TOPICS)) ui['pub-topic'].append(new Option(name, id));
ui['pub-derived'].addEventListener('change', () => { syncLicenseOptions(); syncRevisionHint(); });
ui['pub-author'].addEventListener('input', syncRevisionHint);
onClick('pub-today', () => { ui['pub-updated'].value = new Date().toISOString().slice(0, 10); });
onClick('pub-catalog', async () => {
  ui['pub-note'].textContent = '正在读取工坊目录…';
  publishCatalog = await loadCatalog({ base: workshopBase({ href: location.href, hostname: location.hostname }) });
  fillDerivedOptions(); syncLicenseOptions(); syncRevisionHint();
  const scene = session().getScene(), mine = [...publishCatalog.templates, ...publishCatalog.works].find((entry) => entry.id === scene.id);
  if (mine?.author?.name === ui['pub-author'].value.trim() && !ui['pub-revision'].value) ui['pub-revision'].value = String(nextRevision(mine).revision);
  ui['pub-note'].textContent = `已读取工坊目录（${publishCatalog.templates.length + publishCatalog.works.length} 个作品、${publishCatalog.resources.length} 个资源）。`;
});
onClick('pub-save', () => { savePublication(); });
onClick('pub-check', () => {
  if (!savePublication()) return;
  const result = checkPublication(session().getScene(), publishCatalog ?? { templates: [], works: [], resources: [], errors: [] }, { toolAvailable: isKnownTool });
  if (!publishCatalog) result.problems.push({ level: 'info', code: 'catalog-not-read', message: '还没有读取工坊目录：已有版本、派生来源和资源是否登记没有被检查。' });
  renderCheck(result);
});

// A package to hand to others: structures whose licence forbids embedding travel as hash-checked references (packages/schema/export-policy.mjs); the check runs on that result.
onClick('pub-export', async () => {
  navigationEditor.assertSaved();
  if (!savePublication()) return;
  const current = session(), plan = planEmbedding(current.getScene(), current.getResources(), { mode: 'publish' });
  const result = checkPublication(plan.scene, publishCatalog ?? { templates: [], works: [], resources: [], errors: [] }, { toolAvailable: isKnownTool });
  for (const { assetId, reason } of plan.blocked) result.problems.push({ level: 'error', code: 'embed-blocked', message: `${assetId}：${reason}` });
  if (plan.referenced.length) result.problems.push({ level: 'info', code: 'references', message: `${plan.referenced.length} 个结构不随包嵌入，改为按来源取回并核对哈希。` });
  result.ok = !result.problems.some(({ level }) => level === 'error');
  renderCheck(result);
  if (!result.ok) { status('发布检查有错误，没有生成发布包。'); return; }
  offerDownload(`${plan.scene.id}.glow`, await writeScenePackage(plan.scene, plan.resources), 'application/zip');
  status('发布包已生成。');
});

const host = createPluginHost({
  getScene: () => session().getCoreDocument(),
  dispatch: (command) => session().dispatch(command),
});

function run(action) {
  return (...args) => {
    Promise.resolve().then(() => action(...args)).catch((error) => status(error.message));
  };
}

function listItem(text, action) {
  const item = document.createElement('li');
  if (action) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = text;
    item.append(button);
    button.addEventListener('click', run(action));
  } else item.textContent = text;
  return item;
}

function snapshotProject() {
  return {
    ...project,
    title: ui['project-title'].value.trim() || '未命名工程',
    scenes: [...sessions.values()].map((entry) => entry.getScene()),
  };
}

function installProject(next, resources = new Map()) {
  navigationEditor.assertSaved();
  const nextSessions = new Map(next.scenes.map((scene) => [scene.id, createStudioSession(scene, resources.get(scene.id))]));
  for (const entry of nextSessions.values()) geometryFor(entry);
  project = next;
  sessions = nextSessions;
  ui['project-title'].value = project.title;
  selection = null;
  editingPose = false;
  refresh({ resetCamera: true, resetTime: true });
}

// ---- Draft recovery: while the project is edited it is kept in a small local store, so a closed tab or a failed export does not lose the work -------------------------------------------
const recovery = (() => { try { return createRecovery({ store: indexedDbStore() }); } catch { return null; } })();   // no IndexedDB (a private window): no recovery, nothing else changes
let draftDirty = false, draftTimer;
function scheduleDraft() {
  if (!recovery || !project) return;
  clearTimeout(draftTimer);
  draftTimer = setTimeout(async () => {
    try {
      const resources = new Map([...sessions.entries()].map(([id, entry]) => [id, entry.getResources()]));
      await recovery.save({ name: project.id, bytes: await encodeProject(snapshotProject(), resources) });
    } catch { /* a draft that cannot be made is not worth interrupting the work for */ }
  }, 3000);
}
const markDirty = () => { draftDirty = true; scheduleDraft(); };
async function offerRecovery() {
  const draft = await recovery?.latest().catch(() => null);
  if (!draft) return;
  const when = new Date(draft.savedAt).toLocaleString('zh-CN', { hour12: false });
  ui['recovery-text'].textContent = `发现 ${when} 自动保存的草稿（${(draft.bytes.byteLength / 1048576).toFixed(1)} MB）。`;
  ui['recovery-banner'].hidden = false;
  ui['recovery-restore'].onclick = run(async () => {
    ui['recovery-banner'].hidden = true;
    await openProjectBytes(draft.bytes, ++loading);
    markDirty();
    status('已恢复草稿。别忘了“保存项目”。');
  });
  ui['recovery-discard'].onclick = run(async () => { ui['recovery-banner'].hidden = true; await recovery.clear(); status('已丢弃草稿。'); });
}

function previewLayers(current) {
  if (previews.has(current)) return previews.get(current);
  const layers = new Map();
  const resources = current.getResources();
  for (const { id, mediaType, path } of current.getScene().assets) {
    if (mediaType === GEOMETRY_MEDIA_TYPE) layers.set(id, decodeGeometry(resources.get(path)));
  }
  previews.set(current, layers);
  return layers;
}

// What the viewport draws: the structure in the same representation the Viewer shows (ink blobs, functional domains, ...), built
// from the parsed structure model; until that model is ready, or when it cannot be built, the preview geometry stored in the scene.
const structureViews = new WeakMap();   // session -> { models, built: Map(style -> layers), failed }
const viewStyle = { value: '' };         // '' = follow the work (stored style, then the default for this kind of work)

function geometryFor(current) {
  const view = structureViews.get(current);
  const style = viewStyle.value || '';
  return view?.built.get(style) ?? previewLayers(current);
}

// The particle preview: the engines of the solution-particles and data-animation tools run on the primary structure while the author edits them (see particle-preview.mjs).
let particlePreview;
const previewer = () => particlePreview ??= createParticlePreview({
  viewport, getScene: () => session().getScene(), resolveToolId: (id) => host.resolveToolId(id) ?? id,
  getModel: () => { const models = structureViews.get(session())?.models; return models ? [...models.values()][0] : undefined; },
  note: (text) => { ui['particle-preview-note'].textContent = text; },
});
function syncParticlePreview() {
  const can = previewer().available().length > 0;
  ui['particle-preview-block'].hidden = !can;
  if (!can && ui['particle-preview'].checked) ui['particle-preview'].checked = false;
  if (!can) previewer().stop(); else previewer().sync();
}
ui['particle-preview'].addEventListener('change', () => { if (ui['particle-preview'].checked) previewer().start(); else previewer().stop(); });

async function ensureStructureView(current) {
  const scene = current.getScene();
  if (!structureSources(scene).length) return false;
  const view = structureViews.get(current) ?? { models: undefined, built: new Map(), failed: false };
  structureViews.set(current, view);
  const style = viewStyle.value || '';
  if (view.failed || view.built.has(style)) return false;
  await ensureStructurePlugin();
  const service = host.getService('org.glow.structure.model', '1.0.0'), representation = host.getRepresentation('org.glow.structure.preview');
  if (!service || !representation) { view.failed = true; return false; }
  if (!view.models) {
    view.models = new Map();
    const resources = current.getResources();
    for (const source of structureSources(scene)) {
      try {
        view.models.set(source.id, service.parse({ bytes: resources.get(source.path), name: source.path, mediaType: source.mediaType },
          { assemblyId: source.provenance?.assemblyId, chains: source.provenance?.chains }));
      } catch { /* a structure that cannot be parsed keeps its preview geometry */ }
    }
  }
  const { layers } = buildStructureLayers({ scene, models: view.models, layers: new Map(previewLayers(current)), build: representation.build,
    style: style || undefined, defaultStyle: defaultStyleFor(scene) });
  view.built.set(style, layers);
  return true;
}

let representationTicket = 0;
function upgradeRepresentation() {
  const current = session(), ticket = ++representationTicket;
  const style = viewStyle.value || '';
  if (!structureSources(current.getScene()).length || structureViews.get(current)?.built.has(style) || structureViews.get(current)?.failed) return;
  // Progress goes to its own note next to the selector, never to the status line the author's last action reports on.
  ui['representation-note'].textContent = '正在构建结构表示…';
  ensureStructureView(current).then((built) => {
    if (ticket !== representationTicket || session() !== current) return;
    ui['representation-note'].textContent = '';
    if (built) refresh();
  }).catch((error) => {
    const view = structureViews.get(current);
    if (view) view.failed = true;
    if (ticket === representationTicket) ui['representation-note'].textContent = `结构表示不可用，保留预览几何：${error.message}`;
  });
}

function newProject() {
  navigationEditor.assertSaved();
  loading++;
  const scene = {
    format: 'glow-scene', schemaVersion: 3, id: makeId('scene'), title: '空白场景',
    units: { length: 'meter', time: 'second' },
    assets: [], nodes: [], timeline: { duration: 4, tracks: [] }, dependencies: [], evidence: [], tools: [], resources: [],
  };
  installProject({
    format: 'glow-project', schemaVersion: 1, id: makeId('project'), title: '未命名工程',
    scenes: [scene], activeSceneId: scene.id,
  });
  status('新工程已建立。');
}

function stopPlayback() {
  if (frame !== undefined) cancelAnimationFrame(frame);
  frame = undefined;
  timeline?.pause();
}

function refresh({ resetCamera = false, resetTime = false } = {}) {
  const previousTime = resetTime ? 0 : timeline?.time ?? 0;
  stopPlayback();
  const current = session();
  const scene = current.getScene();
  const document = current.getCoreDocument();
  const camera = resetCamera ? null : viewport.getCamera();
  viewport.commit(viewport.prepare(document, geometryFor(current)));
  if (camera) viewport.setCamera(camera);
  timeline = createTimeline(document.timeline);
  timeline.seek(previousTime);
  if (!document.nodes.some(({ id }) => id === selection)) selection = null;
  multi = multi.filter((id) => document.nodes.some((node) => node.id === id));
  if (selection && !multi.length) multi = [selection];
  renderPanels(scene, document);
  showPose();
  syncParticlePreview();
  const hasStructure = structureSources(scene).length > 0;
  for (const id of ['representation-style', 'representation-label']) ui[id].hidden = !hasStructure;
  if (!hasStructure) ui['representation-note'].textContent = '';
  upgradeRepresentation();
  if (draftDirty) scheduleDraft();
}

function select(id, event) {
  selection = id;
  const result = clickSelection({ order: rowOrder, selected: multi, anchor: rowAnchor }, id, { shift: Boolean(event?.shiftKey), toggle: Boolean(event?.ctrlKey || event?.metaKey) });
  multi = result.selected.length ? result.selected : [id]; rowAnchor = result.anchor;
  if (!multi.includes(id)) selection = multi.at(-1);   // ctrl-click that unselects the clicked row: the inspector follows a row that is still selected
  editingPose = false;
  const current = session();
  renderPanels(current.getScene(), current.getCoreDocument());
  showPose();
}

function renderPanels(scene, document) {
  syncPublish(scene);
  const tree = new Map(document.nodes.map((node) => [node.id, node]));
  const children = new Map();
  for (const node of document.nodes) {
    const siblings = children.get(node.parentId) ?? [];
    siblings.push(node);
    children.set(node.parentId, siblings);
  }
  const pending = (children.get(null) ?? []).map((node) => [node, 0]).reverse();
  const ordered = [];
  while (pending.length) {
    const [node, depth] = pending.pop();
    ordered.push([node, depth]);
    const nested = children.get(node.id) ?? [];
    for (let index = nested.length - 1; index >= 0; index--) pending.push([nested[index], depth + 1]);
  }
  rowOrder = ordered.map(([node]) => node.id);
  ui['scene-picker'].replaceChildren(...[...sessions.values()].map((entry) => {
    const item = entry.getScene();
    return new Option(item.title, item.id, false, item.id === scene.id);
  }));
  ui['scene-title'].value = scene.title;
  ui['asset-list'].replaceChildren(...scene.assets.map((asset) =>
    listItem(asset.path || (asset.kind === 'primitive' ? `${asset.shape} ${asset.color}` : asset.id))));
  ui['scene-tree'].replaceChildren(...ordered.map(([node, depth]) => {
    const item = listItem(node.name || node.id, (event) => select(node.id, event));
    item.style.paddingInlineStart = `${Math.min(depth, 10) * 0.85}rem`;
    item.querySelector('button').setAttribute('aria-pressed', String(multi.includes(node.id) || node.id === selection));
    item.dataset.nodeId = node.id; item.draggable = true;   // drag the selection onto a row to make it that row's children
    // Outliner row: visibility toggle (a checkbox, so the selection button stays the only button in the row), then the name.
    const eye = globalThis.document.createElement('input');   // `document` is the scene document in this function
    eye.type = 'checkbox'; eye.className = 'eye'; eye.checked = node.visible; eye.title = '显示 / 隐藏';
    eye.setAttribute('aria-label', `显示 ${node.name || node.id}`);
    eye.addEventListener('change', run(() => edit({ type: 'updateNode', id: node.id, patch: { visible: eye.checked } }, eye.checked ? '已显示对象。' : '已隐藏对象。')));
    item.classList.add('outline-row');
    if (!node.visible) item.classList.add('hidden-node');
    item.prepend(eye);
    return item;
  }));
  const node = tree.get(selection);
  const asset = document.assets.find(({ id }) => id === node?.assetId);
  const color = asset?.kind === 'primitive' ? asset.color : null;
  for (const control of ui.inspector.elements) control.disabled = !node;
  ui['node-color'].disabled = !color;
  ui['node-name'].value = node?.name ?? '';
  const outsideSelection = (candidate) => {
    for (let current = candidate; current; current = tree.get(current.parentId)) {
      if (current.id === selection) return false;
    }
    return true;
  };
  ui['node-parent'].replaceChildren(new Option('场景根层', ''), ...ordered
    .filter(([candidate]) => outsideSelection(candidate))
    .map(([candidate, depth]) => new Option(`${'　'.repeat(Math.min(depth, 8))}${candidate.name || candidate.id}`, candidate.id)));
  ui['node-parent'].value = node?.parentId ?? '';
  ui['node-visible'].checked = node?.visible ?? false;
  ui['node-color'].value = color ?? '#4d9b83';
  const transform = node?.transform ?? identity();
  const euler = new Euler().setFromQuaternion(new Quaternion().fromArray(transform.rotation));
  AXES.forEach((axis, index) => {
    ui[`position-${axis}`].value = transform.position[index];
    ui[`scale-${axis}`].value = transform.scale[index];
    ui[`rotation-${axis}`].value = Number(MathUtils.radToDeg(euler[axis]).toFixed(4));
  });
  ui['group-node'].disabled = !node;
  ui['remove-node'].disabled = !node;
  ui.undo.disabled = !session().canUndo();
  ui.redo.disabled = !session().canRedo();
  ui.duration.value = scene.timeline.duration;
  ui['annotation-list'].replaceChildren(...(scene.presentation?.notes ?? []).map(({ text, nodeId }) =>
    listItem(text, nodeId ? () => select(nodeId) : null)));
  ui['bookmark-list'].replaceChildren(...(scene.presentation?.bookmarks ?? []).map((bookmark) =>
    listItem(bookmark.name, () => viewport.setCamera(bookmark))));
  ui['evidence-list'].replaceChildren(...scene.evidence.map(({ type, citation, assetId }) =>
    listItem([TYPES[type] || type, citation || assetId].filter(Boolean).join(' · '))));
  navigationEditor.render(scene);
  toolConfigPanel.render(scene);
  if (scene.tools?.length && !toolPluginsReady) {
    ensureToolPlugins().then(() => { if (session().getScene().id === scene.id) toolConfigPanel.render(session().getScene()); })
      .catch((error) => status(`无法启用工具插件。 ${error.message}`));
  }
}

function showPose() {
  const pose = timeline.sample();
  if (editingPose && !timeline.playing && selection) pose.delete(selection);
  viewport.applyPose(pose);
  viewport.setSelection(timeline.playing ? null : selection);
  ui['studio-playhead'].max = timeline.duration;
  ui['studio-playhead'].value = timeline.time;
  ui['studio-playhead'].disabled = timeline.duration === 0;
  ui['studio-play'].disabled = timeline.duration === 0;
  ui['studio-play'].textContent = timeline.playing ? '暂停' : '播放';
  ui['studio-time'].value = `${timeline.time.toFixed(2)} / ${timeline.duration.toFixed(2)} 秒`;
  ui['add-keyframe'].disabled = !selection || timeline.playing;
}

function edit(command, message, { transform = false } = {}) {
  const changed = session().dispatch(command);
  editingPose = transform;
  if (changed) { markDirty(); refresh(); }
  status(message);
}

function addPrimitive(shape) {
  const name = shape === 'box' ? '方盒' : '球体';
  const asset = { id: makeId('asset'), kind: 'primitive', shape, color: shape === 'box' ? '#31846b' : '#bd7542' };
  const node = { id: makeId('node'), name, assetId: asset.id, parentId: null, visible: true, transform: identity() };
  selection = node.id;
  edit({ type: 'batch', commands: [{ type: 'addAsset', asset }, { type: 'addNode', node }] }, `已添加${name}。`);
}

function offerDownload(name, bytes, type) {
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function onClick(id, action) { ui[id].addEventListener('click', run(action)); }
function watchFile(id, action) {
  ui[id].addEventListener('change', run(async () => {
    const [file] = ui[id].files;
    ui[id].value = '';
    if (file) await action(file);
  }));
}

viewport = createViewport(ui.viewport, {
  TransformControls,
  onSelect: select,
  onTransform: run((id, transform) => {
    try {
      edit({ type: 'updateNode', id, patch: { transform } }, '已更新变换。', { transform: true });
    } catch (error) {
      refresh();
      throw error;
    }
  }),
});

onClick('new-project', newProject);
onClick('import-structure', () => { navigationEditor.assertSaved(); ui['structure-file'].click(); });
onClick('import-package', () => { navigationEditor.assertSaved(); ui['package-file'].click(); });
onClick('open-project', () => { navigationEditor.assertSaved(); ui['project-file'].click(); });
onClick('reset-camera', () => viewport.resetCamera());
ui['gizmo-mode'].addEventListener('change', () => viewport.setGizmoMode(ui['gizmo-mode'].value));
onClick('add-box', () => addPrimitive('box'));
onClick('add-sphere', () => addPrimitive('sphere'));
onClick('group-node', () => {
  const plan = groupPlan(session().getCoreDocument().nodes, multi.length ? multi : [selection], { id: makeId('group'), name: '组', assetId: null, visible: true, transform: identity() });
  if (plan.error) { status(plan.error); return; }
  selection = plan.commands[0].node.id; multi = [selection]; rowAnchor = selection;
  edit({ type: 'batch', commands: plan.commands }, multi.length > 1 ? '已将所选对象加入组。' : '已将对象加入组。');
});
onClick('remove-node', () => {
  const commands = removePlan(session().getCoreDocument().nodes, multi.length ? multi : [selection]);
  if (!commands.length) return;
  edit(commands.length === 1 ? commands[0] : { type: 'batch', commands }, commands.length > 1 ? `已删除 ${commands.length} 个对象。` : '已删除对象。');
});
// Outline drag and drop: the selected rows (or the dragged row) become children of the row they are dropped on; dropped on the empty part of the list they go to the scene root. One drop is one undo step.
const tree = ui['scene-tree'], rowOf = (event) => event.target.closest?.('li[data-node-id]');
const clearDropMarks = () => { for (const row of tree.querySelectorAll('.drop-target')) row.classList.remove('drop-target'); tree.classList.remove('drop-root'); };
tree.addEventListener('dragstart', (event) => {
  const row = rowOf(event); if (!row) return;
  const id = row.dataset.nodeId;
  if (!multi.includes(id)) { multi = [id]; rowAnchor = id; selection = id; }
  event.dataTransfer.setData('text/plain', JSON.stringify(multi)); event.dataTransfer.effectAllowed = 'move';
});
tree.addEventListener('dragover', (event) => {
  event.preventDefault(); clearDropMarks();
  const row = rowOf(event); (row ?? tree)?.classList.add(row ? 'drop-target' : 'drop-root');
});
tree.addEventListener('dragleave', (event) => { if (!tree.contains(event.relatedTarget)) clearDropMarks(); });
tree.addEventListener('dragend', clearDropMarks);
tree.addEventListener('drop', (event) => {
  event.preventDefault(); clearDropMarks();
  const target = rowOf(event)?.dataset.nodeId ?? null, plan = reparentPlan(session().getCoreDocument().nodes, multi, target);
  if (plan.error) { status(plan.error); return; }
  if (!plan.commands.length) { status('这些对象已经在那里了。'); return; }
  edit(plan.commands.length === 1 ? plan.commands[0] : { type: 'batch', commands: plan.commands }, `已移动 ${plan.moved.length} 个对象。`);
});
onClick('undo', () => { navigationEditor.assertSaved(); if (session().undo()) { editingPose = false; refresh(); status('已撤销。'); } });
onClick('redo', () => { navigationEditor.assertSaved(); if (session().redo()) { editingPose = false; refresh(); status('已重做。'); } });
onClick('save-project', async () => {
  navigationEditor.assertSaved();
  const current = snapshotProject();
  const resources = new Map([...sessions.entries()].map(([id, entry]) => [id, entry.getResources()]));
  const bytes = await encodeProject(current, resources);
  offerDownload(`${current.id}.glow-project`, bytes, 'application/json');
  draftDirty = false; clearTimeout(draftTimer); recovery?.clear();   // the work is in a file now
  status('工程已生成。');
});
onClick('export-scene', async () => {
  navigationEditor.assertSaved();
  const current = session();
  const scene = current.getScene();
  const bytes = await writeScenePackage(scene, current.getResources());
  offerDownload(`${scene.id}.glow`, bytes, 'application/zip');
  status('场景包已生成。');
});

// A structure (a file, or bytes fetched from a resource) becomes a new work: the structure is its first resource.
async function importStructureAsWork(structure, { title, message }) {
  const ticket = ++loading;
  status('正在导入结构…');
  const importer = host.getImporter(await ensureStructurePlugin());
  const imported = await importer.importScene(structure);
  if (ticket !== loading) return;
  navigationEditor.assertSaved();
  const id = makeId(imported.scene.id);
  // Scenes in Studio are always the current format: the imported structure becomes a resource of a v3 work.
  const { scene } = await upgradeSceneToV3({ ...imported.scene, id, ...(title ? { title } : {}), timeline: { duration: 4, tracks: [] } }, imported.resources);
  const next = createStudioSession(scene, imported.resources);
  geometryFor(next);
  sessions.set(id, next);
  project = { ...project, activeSceneId: id };
  selection = scene.nodes[0]?.id ?? null;
  editingPose = false;
  markDirty();
  refresh({ resetCamera: true, resetTime: true });
  status(message);
}

watchFile('structure-file', async (file) => {
  if (file.size > 64 * 1024 * 1024) throw new Error('结构文件超过 64 MiB。');
  await importStructureAsWork({ name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) }, { message: `已导入 ${file.name}。` });
});

// ---- workshop: works open in the Viewer; a resource becomes a new work here ------------------------------------------------
let rcsbSource;
function openInViewer(entry) {
  const url = new URL('../viewer-web/index.html', location.href);
  url.searchParams.set('work', entry.id);
  const override = new URLSearchParams(location.search).get('workshop');
  if (override) url.searchParams.set('workshop', override);
  window.open(url, '_blank', 'noopener');
  return false;   // the dialog stays open
}
const workshop = createWorkshopDialog(document, {
  load: () => loadCatalog({ base: workshopBase({ href: location.href, hostname: location.hostname }) }),
  toolTitle, toolAvailable: isKnownTool,
  actions: {
    templates: [{ label: '在 Viewer 中查看', title: '模板是静态的：在 Viewer 里看结构、读解说', run: (entry) => openInViewer(entry) }],
    works: [{ label: '在 Viewer 中打开', title: '作品的播放与展示在 Viewer 里', run: (entry) => openInViewer(entry) }],
    resources: [{ label: '用此资源新建作品', title: '从来源取回、核对哈希，成为新作品的第一个资源', run: async (entry) => {
      navigationEditor.assertSaved();
      const { createRcsbSource } = await import('../../plugins/rcsb/index.mjs');
      rcsbSource ??= createRcsbSource();
      const structure = await fetchResource(entry, { load: (accession, options) => rcsbSource.load(accession, options) });
      await importStructureAsWork(structure, { title: entry.title, message: `已用资源 ${entry.record.id} 新建作品。` });
    } }],
  },
});
onClick('workshop', () => workshop.open().catch((error) => status(`无法打开工坊。 ${error.message}`)));

watchFile('package-file', async (file) => {
  const ticket = ++loading;
  if (file.size > 128 * 1024 * 1024) throw new Error('场景包超过 128 MiB。');
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) throw new Error('请选择 .glow 场景包（Viewer 的“保存”导出）。旧版 v1 文本包请先在 Viewer 中打开并保存。');
  status('正在导入场景包…');
  const { scene: read, resources } = await readScenePackage(bytes);
  // A v2 package is brought to v3 with the default tool configuration of its declared mechanism; a v3 work keeps its own.
  const { scene: work } = await upgradeSceneToV3(read, resources, { tools: toolEntriesForScene(read) });
  if (ticket !== loading) return;
  navigationEditor.assertSaved();
  const id = sessions.has(work.id) ? makeId(work.id) : work.id;
  const next = createStudioSession({ ...work, id }, resources);
  geometryFor(next);
  sessions.set(id, next);
  project = { ...project, activeSceneId: id };
  selection = work.nodes[0]?.id ?? null;
  editingPose = false;
  markDirty();
  refresh({ resetCamera: true, resetTime: true });
  status(`已导入场景包 ${file.name}。`);
});

async function openProjectBytes(bytes, ticket) {
  const decoded = await decodeProject(bytes);
  if (ticket !== loading) return;
  const scenes = [];
  for (const scene of decoded.project.scenes) {
    scenes.push((await upgradeSceneToV3(scene, decoded.resourcesByScene.get(scene.id) ?? new Map(), { tools: toolEntriesForScene(scene) })).scene);
  }
  if (ticket !== loading) return;
  installProject({ ...decoded.project, scenes }, decoded.resourcesByScene);
}
watchFile('project-file', async (file) => {
  const ticket = ++loading;
  if (file.size > 128 * 1024 * 1024) throw new Error('工程文件超过 128 MiB。');
  status('正在打开工程…');
  await openProjectBytes(new Uint8Array(await file.arrayBuffer()), ticket);
  status('工程已打开。');
});

ui['representation-style'].addEventListener('change', () => {
  viewStyle.value = ui['representation-style'].value;
  refresh();   // shows what is already built; builds the missing representation in the background
});

ui['scene-picker'].addEventListener('change', run(() => {
  try { navigationEditor.assertSaved(); }
  catch (error) { ui['scene-picker'].value = project.activeSceneId; throw error; }
  project = { ...project, activeSceneId: ui['scene-picker'].value };
  selection = null;
  editingPose = false;
  refresh({ resetCamera: true, resetTime: true });
}));

ui['scene-title-form'].addEventListener('submit', (event) => {
  event.preventDefault();
  run(() => edit({ type: 'setSceneTitle', title: ui['scene-title'].value }, '已重命名场景。'))();
});

ui.inspector.addEventListener('submit', (event) => {
  event.preventDefault();
  run(() => {
    const current = session().getCoreDocument();
    const node = current.nodes.find(({ id }) => id === selection);
    if (!node) return;
    const values = (field) => AXES.map((axis) => ui[`${field}-${axis}`].valueAsNumber);
    const rotation = new Quaternion().setFromEuler(new Euler(...values('rotation').map(MathUtils.degToRad))).toArray();
    const patch = {
      name: ui['node-name'].value, visible: ui['node-visible'].checked,
      parentId: ui['node-parent'].value || null,
      transform: { position: values('position'), rotation, scale: values('scale') },
    };
    const commands = [{ type: 'updateNode', id: node.id, patch }];
    const asset = current.assets.find(({ id }) => id === node.assetId);
    if (asset?.kind === 'primitive' && asset.color !== ui['node-color'].value) {
      commands.push({ type: 'updateAsset', id: asset.id, patch: { color: ui['node-color'].value } });
    }
    edit({ type: 'batch', commands }, '已应用属性。', { transform: true });
  })();
});

onClick('add-annotation', () => {
  const text = ui.annotation.value.trim();
  if (!text) throw new Error('请输入标注。');
  edit({ type: 'addNote', note: { id: makeId('note'), text, nodeId: selection } }, '已保存标注。');
  ui.annotation.value = '';
});
onClick('add-evidence', () => {
  const citation = ui.citation.value.trim();
  if (!citation) throw new Error('请输入引用或证据说明。');
  edit({ type: 'addEvidence', entry: { type: ui['evidence-kind'].value, citation } }, '已保存证据。');
  ui.citation.value = '';
});
onClick('add-bookmark', () => {
  const name = ui['bookmark-name'].value.trim();
  if (!name) throw new Error('请输入视角书签名称。');
  edit({ type: 'addBookmark', bookmark: { id: makeId('camera'), name, ...viewport.getCamera() } }, '已保存视角书签。');
  ui['bookmark-name'].value = '';
});

ui.duration.addEventListener('change', run(() => {
  const { timeline: data } = session().getCoreDocument();
  edit({ type: 'setTimeline', timeline: { ...data, duration: ui.duration.valueAsNumber } }, '已更新时长。');
}));
onClick('add-keyframe', () => {
  const current = session().getCoreDocument();
  const node = current.nodes.find(({ id }) => id === selection);
  if (!node) return;
  const time = timeline.time;
  const tracks = current.timeline.tracks.filter(({ nodeId }) => nodeId !== node.id);
  const frames = current.timeline.tracks.find(({ nodeId }) => nodeId === node.id)?.keyframes ?? [];
  const keyframes = [...frames.filter((entry) => entry.time !== time), { time, transform: node.transform }]
    .sort((left, right) => left.time - right.time);
  tracks.push({ nodeId: node.id, keyframes });
  edit({ type: 'setTimeline', timeline: { ...current.timeline, tracks } }, '已保存关键帧。');
});
ui['studio-playhead'].addEventListener('input', () => {
  editingPose = false;
  timeline.seek(ui['studio-playhead'].valueAsNumber);
  showPose();
});
onClick('studio-play', () => {
  if (timeline.playing) { stopPlayback(); showPose(); return; }
  editingPose = false;
  if (timeline.time === timeline.duration) timeline.seek(0);
  timeline.play();
  let previous = performance.now();
  const tick = (now) => {
    timeline.advance(Math.max(0, (now - previous) / 1000));
    previous = now;
    showPose();
    frame = timeline.playing ? requestAnimationFrame(tick) : undefined;
  };
  frame = requestAnimationFrame(tick);
  showPose();
});
window.addEventListener('pagehide', (event) => { if (!event.persisted) { stopPlayback(); viewport.dispose(); } });
newProject();
offerRecovery();
