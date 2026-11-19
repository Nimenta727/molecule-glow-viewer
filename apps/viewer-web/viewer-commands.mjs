import { openSceneFile } from './scene-io.mjs';

const STYLES = new Set(['cartoon', 'backbone', 'blob', 'functional', 'surface']);
const object = (value) => value && typeof value === 'object' && !Array.isArray(value);
const finite = (value, min, max, label) => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new Error(`${label} 超出范围。`);
  return value;
};
function base64(bytes) {
  let text = '';
  for (let i = 0; i < bytes.length; i += 16384) text += String.fromCharCode(...bytes.subarray(i, i + 16384));
  return btoa(text);
}
function packFile(value) {
  if (value?.format === 'glow-v2' && value.encoding === 'base64' && typeof value.data === 'string') {
    if (value.data.length > 180 * 1024 * 1024) throw new Error('场景包超过容量限制。');
    const raw = atob(value.data);
    return new File([Uint8Array.from(raw, (c) => c.charCodeAt(0))], 'api.glow');
  }
  if (typeof value === 'string') return new File([value], 'api.glow');
  throw new Error('需要 v1 JSON 文本或 exportPack 返回的 v2 包。');
}

export function createViewerCommands(host) {
  const needScene = () => {
    const scene = host.current();
    if (!scene) throw new Error('请先打开场景。');
    return scene;
  };
  const info = () => {
    const current = host.current();
    const snapshot = current?.player?.snapshot();
    return {
      title: current?.name ?? null, sceneId: current?.scene.id ?? null,
      plugins: host.plugins(), camera: host.camera(),
      sources: current?.scene.assets.filter((asset) => asset.provenance?.parserVersion).map(({ id, provenance }) => ({ id, source: provenance.source })) ?? [],
      parts: current?.scene.nodes.filter((node) => node.extensions?.['org.glow.structure']).map(({ id, name, visible }) => ({ id, name, visible })) ?? [],
      selection: host.selection(), representation: current?.representationSource?.provenance?.viewerStyle ?? 'blob',
      paused: snapshot ? !snapshot.playing : !current?.timeline.playing,
      time: snapshot?.time ?? current?.timeline.time ?? 0,
      counters: snapshot?.counters ?? {}, seed: snapshot?.seed ?? null,
      ...(snapshot?.domainMeasurements ? { domainMeasurements: snapshot.domainMeasurements, morph: snapshot.fraction } : {}),
      parameters: snapshot?.parameters ?? {}, metrics: snapshot?.metrics ?? null,
      ...(snapshot?.parameters ? { gate: snapshot.gate, current: snapshot.current, openCurrent: snapshot.openCurrent,
        reversalPotential: snapshot.reversalPotential, gateSeconds: snapshot.gateSeconds,
        permeationNs: snapshot.permeationNs, openProbability: snapshot.openProbability } : {}),
      evidence: current?.scene.evidence ?? [], warnings: current?.warnings ?? [],
    };
  };
  return {
    info,
    async load(spec) {
      if (typeof spec === 'string') spec = /^[0-9][a-z0-9]{3}$/i.test(spec) ? { pdb: spec } : { url: spec };
      if (!object(spec)) throw new Error('load 需要 {pdb}、{url}、{packText} 或 v2 包。');
      if (Object.keys(spec).some((key) => !['pdb', 'url', 'pack', 'packText', 'assembly', 'format', 'encoding', 'data'].includes(key)) ||
          ['pdb', 'url', 'pack', 'packText', 'format'].filter((key) => spec[key] != null).length !== 1 ||
          spec.assembly != null && typeof spec.assembly !== 'boolean') throw new Error('load 参数无效或尚未迁移。');
      let input;
      if (spec.pdb != null) {
        if (typeof spec.pdb !== 'string' || !/^[0-9][a-z0-9]{3}$/i.test(spec.pdb)) throw new Error('PDB 编号无效。');
        input = { accession: spec.pdb.toUpperCase(), assembly: spec.assembly === true };
      } else if (spec.url != null) {
        const url = new URL(spec.url, location.href);
        if (!['http:', 'https:'].includes(url.protocol) ||
            url.origin !== location.origin && !(url.protocol === 'https:' && url.hostname === 'files.rcsb.org')) throw new Error('只允许同源文件或 files.rcsb.org HTTPS 坐标链接。');
        if (url.username || url.password || !/\.(glow|json|cif|mmcif|pdb|ent)$/i.test(url.pathname)) throw new Error('文件链接无效。');
        const signal = host.signal ? AbortSignal.any([host.signal, AbortSignal.timeout(30000)]) : AbortSignal.timeout(30000);
        const response = await fetch(url, { signal, redirect: 'error' });
        if (!response.ok) throw new Error(`下载失败 HTTP ${response.status}。`);
        // Consume a bounded stream, including responses without Content-Length.
        const reader = response.body.getReader(), chunks = []; let size = 0;
        try {
          while (true) {
            const { done, value } = await reader.read(); if (done) break;
            size += value.length;
            if (size > 30 * 1024 * 1024) throw new Error('远程文件超过 30 MiB。');
            chunks.push(value);
          }
        } finally { await reader.cancel(); reader.releaseLock(); }
        input = { file: new File(chunks, url.pathname.split('/').pop()), assembly: spec.assembly === true };
      } else input = { file: packFile(spec.pack ?? spec.packText ?? spec) };
      host.signal?.throwIfAborted();
      await host.enableStructure();
      host.signal?.throwIfAborted();
      await host.open(input);
      return info();
    },
    select(value) {
      const current = needScene();
      if (value === 'none') { host.select(); return { atoms: 0, highlighted: null }; }
      if (typeof value === 'string') {
        const match = /^(chain|resid)\s+(\S+)$/.exec(value.trim());
        if (!match) throw new Error('当前支持 chain A、resid 8、none 或选择对象。');
        value = { [match[1] === 'chain' ? 'chainId' : 'residueId']: match[2] };
      }
      if (!object(value) || Object.keys(value).some((key) => !['chainId', 'residueId', 'sourceAssetId'].includes(key))) throw new Error('选择参数无效。');
      if (['chainId', 'sourceAssetId'].some((key) => value[key] != null && typeof value[key] !== 'string')) throw new Error('链号和来源 ID 应为字符串。');
      const model = value.sourceAssetId ? current.models?.get(value.sourceAssetId) : current.model;
      if (!model) throw new Error('相应结构插件或坐标不可用。');
      const atoms = host.selectAtoms(model, value);
      const selected = new Set(atoms.map((atom) => JSON.stringify([atom.modelId, atom.authChainId, atom.labelChainId, atom.authSeqId, atom.labelSeqId, atom.insertionCode, atom.assemblyCopy])));
      const sourceId = value.sourceAssetId ?? current.representationSource?.id;
      const target = [...(current.structureTargets?.values() ?? [])].find((target) => target.sourceAssetId === sourceId && selected.has(JSON.stringify([target.atom.modelId, target.atom.authChainId, target.atom.labelChainId, target.atom.authSeqId, target.atom.labelSeqId, target.atom.insertionCode, target.atom.assemblyCopy])));
      host.select(target);
      return { atoms: atoms.length, highlighted: host.selection(), note: '高亮首个具有可视化标记的匹配残基或配体。' };
    },
    represent(value) {
      needScene();
      if (object(value) && Object.keys(value).some((key) => key !== 'mode')) throw new Error('当前表示命令只接受 mode；按选择换表示尚待迁移。');
      const style = object(value) ? value.mode : value;
      if (!STYLES.has(style)) throw new Error('表示应为 cartoon、backbone、blob、functional 或 surface。');
      if (!host.current().model) throw new Error('结构插件或坐标不可用。');
      host.represent(style); return { representation: style };
    },
    camera(value) {
      needScene();
      if (value == null) return host.camera();
      if (value === 'reset') host.resetCamera();
      else {
        if (!object(value) || !['position', 'target'].every((key) => Array.isArray(value[key]) && value[key].length === 3 && value[key].every((n) => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= 1e6)) || Math.hypot(...value.position.map((v, i) => v - value.target[i])) < 0.001) throw new Error('镜头需要有效的 position 和 target 三维坐标。');
        host.setCamera(value);
      }
      return host.camera();
    },
    animate(value = {}) {
      const current = needScene(); const player = current.player;
      if (!object(value) || Object.keys(value).some((key) => !['pause', 'time', 'speed', 'seed', 'step', 'steps', 'parameters', 'morph'].includes(key))) throw new Error('动画参数无效或尚未迁移。');
      if (value.morph != null) {
        if (!player?.setMorph) throw new Error('当前机制不支持两态构象控制。');
        if (value.morph !== 'auto') finite(value.morph, 0, 1, 'morph');
      }
      if (value.parameters != null) {
        if (!player?.validateParameters) throw new Error('当前机制不支持领域参数。');
        player.validateParameters(value.parameters);
      }
      if (value.pause != null && typeof value.pause !== 'boolean') throw new Error('pause 应为布尔值。');
      if (value.time != null) finite(value.time, 0, player?.duration ?? current.timeline.duration, 'time');
      if (value.speed != null) { if (!player) throw new Error('当前场景没有机制播放器。'); finite(value.speed, 0.05, 3, 'speed'); }
      if (value.seed != null && (!player || !Number.isSafeInteger(value.seed) || value.seed < 0 || value.seed > 4294967295)) throw new Error('seed 需要机制播放器及 32 位无符号整数。');
      if (value.step != null) finite(value.step, 0.000001, 1, 'step');
      if (value.steps != null && (!Number.isInteger(value.steps) || value.steps < 1 || value.steps > 20000)) throw new Error('steps 应为 1–20000 的整数。');
      host.animate(value);
      return info();
    },
    snapshot(value) {
      needScene();
      const width = object(value) ? value.width : value;
      if (width != null && (!Number.isInteger(width) || width < 64 || width > 4096)) throw new Error('截图宽度应为 64–4096 的整数。');
      return host.snapshot(width);
    },
    async exportPack() { needScene(); return { format: 'glow-v2', encoding: 'base64', data: base64(await host.exportPack()) }; },
    async validatePack(value) {
      try { const { scene, warnings } = await openSceneFile(packFile(value)); return { ok: true, sceneId: scene.id, warnings }; }
      catch (error) { return { ok: false, errors: [error.message] }; }
    },
  };
}
