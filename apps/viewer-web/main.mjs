import { createDocumentStore, createLoadCoordinator, createTimeline } from '../../packages/core/index.mjs';
import { exampleScene } from './example-scene.mjs';
import { createViewport } from './viewport.mjs';

const elements = Object.fromEntries(
  [...document.querySelectorAll('[id]')].map((element) => [element.id, element]),
);

let active;
let frame;

function setStatus(message) {
  elements.status.textContent = message;
}

function syncControls() {
  const timeline = active?.timeline;
  const duration = timeline?.duration ?? 0;
  const time = timeline?.time ?? 0;
  elements.save.disabled = !active;
  elements.close.disabled = !active;
  elements['reset-camera'].disabled = !active;
  elements.play.disabled = !duration;
  elements.playhead.disabled = !duration;
  elements.playhead.max = String(duration);
  elements.playhead.value = String(time);
  elements.time.value = `${time.toFixed(2)} / ${duration.toFixed(2)} s`;
  elements.play.textContent = timeline?.playing ? '暂停' : '播放';
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
      const source = input.file ? JSON.parse(await input.file.text()) : exampleScene;
      if (signal.aborted) return;
      const document = createDocumentStore(source).getSnapshot();
      const timeline = createTimeline(document.timeline);
      const prepared = viewport.prepare(document);
      scope.add(() => prepared.dispose());
      return { document, timeline, prepared, name: input.file?.name ?? '基础几何示例' };
    },
    commit(scene) {
      viewport.commit(scene.prepared);
      stopFrame();
      active = scene;
      showPose();
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
  elements.save.addEventListener('click', () => {
    if (!active) return;
    const blob = new Blob([JSON.stringify(active.document, null, 2) + '\n'], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = active.name.endsWith('.json') ? active.name : 'glow-scene.json';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  elements.close.addEventListener('click', () => {
    stopFrame();
    scenes.close();
    viewport.clear();
    active = undefined;
    syncControls();
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
