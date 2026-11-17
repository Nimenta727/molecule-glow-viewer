import { createDocumentStore, createLoadCoordinator, createTimeline } from '../../packages/core/index.mjs';
import { writeScenePackage } from '../../packages/schema/archive.mjs';
import { toCoreDocument } from '../../packages/schema/documents.mjs';
import { exampleScene } from './example-scene.mjs';
import { fromPrototype, openSceneFile } from './scene-io.mjs';
import { createViewport } from './viewport.mjs';

const elements = Object.fromEntries(
  [...document.querySelectorAll('[id]')].map((element) => [element.id, element]),
);

let active;
let frame;
let saving = false;

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
}

function showDiagnostics() {
  const scene = active?.scene;
  const diagnostics = new Set(active?.warnings);
  if (scene?.dependencies.length) {
    diagnostics.add(`部分内容依赖插件 ${scene.dependencies.map(({ id }) => id).join('、')}。`);
  }
  if (scene?.assets.some(({ kind }) => kind !== 'primitive')) {
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
  const viewport = createViewport(elements.viewport, {
    onSelect(id) {
      const node = active?.document.nodes.find((candidate) => candidate.id === id);
      setStatus(node ? `已选择 ${node.name}` : (active?.name ?? '场景已关闭'));
    },
  });
  const scenes = createLoadCoordinator({
    async prepare(input, { signal, scope }) {
      const loaded = input.file ? await openSceneFile(input.file) : fromPrototype(exampleScene);
      if (signal.aborted) return;
      const document = createDocumentStore(toCoreDocument(loaded.scene)).getSnapshot();
      const timeline = createTimeline(document.timeline);
      const prepared = viewport.prepare(document);
      scope.add(() => prepared.dispose());
      return { ...loaded, document, timeline, prepared, name: input.file?.name ?? '基础几何示例' };
    },
    commit(scene) {
      viewport.commit(scene.prepared);
      stopFrame();
      active = scene;
      showPose();
      showDiagnostics();
      setStatus(scene.name);
    },
  });

  function showPose() {
    if (active) viewport.applyPose(active.timeline.sample());
    syncControls();
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
