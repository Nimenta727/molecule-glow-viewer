import { openSceneFile } from './scene-io.mjs';
import { defaultStyleFor } from '../../plugins/default-style.mjs';
import { applyColor } from './color-scheme.mjs';
import { applyCameraSpec } from './camera-spec.mjs';

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

function checkShape(shape, name) {
  if (!object(shape) || !['plane', 'sphere', 'capsule', 'ellipsoid'].includes(shape.kind)) throw new Error(`${name}.kind 应为 plane / sphere / capsule / ellipsoid。`);
  const sizes = { plane: ['width', 'height'], sphere: ['radius'], capsule: ['radius', 'length'], ellipsoid: ['a', 'b', 'c'] }[shape.kind];
  for (const key of sizes) finite(shape[key], key === 'length' ? 0 : 1, 1e6, `${name}.${key}`);
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
      plugins: host.plugins(), resources: host.resources?.() ?? [], camera: host.camera(),
      sources: current?.scene.assets.filter((asset) => asset.provenance?.parserVersion).map(({ id, provenance }) => ({ id, source: provenance.source })) ?? [],
      parts: current?.scene.nodes.filter((node) => node.extensions?.['org.glow.structure']).map(({ id, name, visible }) => ({ id, name, visible })) ?? [],
      selection: host.selection(), colors: host.colorState?.() ?? null, representation: current?.representationSource?.provenance?.viewerStyle ?? defaultStyleFor(current?.scene),
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
            if (size > 64 * 1024 * 1024) throw new Error('远程文件超过 64 MiB。');
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
      if (value === 'none') { host.select(); host.clearSet?.(); return { atoms: 0, highlighted: null }; }
      if (typeof value === 'string') {
        // Anything beyond the two simple forms goes through the full selection language (and/or/not, resi ranges, within ... of, sele ...).
        const match = /^(chain|resid)\s+(\S+)$/.exec(value.trim());
        if (!match || value.trim().includes(',')) {
          host.select();
          let result;
          try { result = host.selectSet(value); } catch (error) { throw new Error(error.message); }
          if (!result) throw new Error('相应结构插件或坐标不可用。');
          return { ...result, note: '按选择语言匹配全部残基与小分子，以金色线框标出。' };
        }
        host.clearSet?.();
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
      if (typeof value === 'string') {
        const text = value.trim(), match = /^(orbit|focus)\s+(.+)$/i.exec(text);
        if (text === 'reset') value = 'reset';
        else if (match) value = match[1].toLowerCase() === 'orbit' ? { orbit: Number(match[2]) } : { focus: match[2] };
        else throw new Error('镜头命令应为 reset、"orbit 90"、"focus <选择>" 或对象。');
      }
      if (value === 'reset' || object(value) && value.reset === true && Object.keys(value).length === 1) host.resetCamera();
      else if (object(value) && ['position', 'target'].some((key) => key in value)) {
        if (!object(value) || Object.keys(value).some((key) => !['position', 'target'].includes(key)) || !['position', 'target'].every((key) => Array.isArray(value[key]) && value[key].length === 3 && value[key].every((n) => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= 1e6)) || Math.hypot(...value.position.map((v, i) => v - value.target[i])) < 1e-6) throw new Error('镜头需要不同的 position 与 target（三个有限数）。');
        host.setCamera(value);
      } else {
        if (!object(value)) throw new Error('镜头参数无效。');
        const { focus, ...rest } = value;
        let spec = { ...rest };
        if (focus != null) {
          if (typeof focus !== 'string') throw new Error('focus 应为选择表达式。');
          const found = host.focusPoint?.(focus);
          if (!found) throw new Error('相应结构插件或坐标不可用。');
          spec = { ...spec, focusPoint: found.point, focusRadius: found.radius };
        }
        if (!Object.keys(spec).length) throw new Error('镜头参数无效。');
        host.setCamera(applyCameraSpec(host.camera(), spec));
      }
      return host.camera();
    },
    animate(value = {}) {
      if (value === 'play' || value === 'pause') value = { pause: value === 'pause' };
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
    measure(value) {
      needScene();
      if (value === 'clear') { host.measure(null); return { cleared: true }; }
      const list = Array.isArray(value) ? value : object(value) ? [value.a, value.b, value.c].filter((item) => item != null) : null;
      if (!list || list.length < 2 || list.length > 3 || list.some((item) => typeof item !== 'string' || !item.trim() || item.length > 400)) throw new Error('measure 需要两个或三个选择表达式（距离或角度），或 "clear"。');
      const result = host.measure(list);
      if (!result) throw new Error('相应结构插件或坐标不可用。');
      return result;
    },
    sequence(value) {
      needScene();
      if (value != null && !object(value)) throw new Error('sequence 参数应为 {show?, select?}。');
      const options = value ?? {};
      if (Object.keys(options).some((key) => !['show', 'select'].includes(key))) throw new Error('sequence 只接受 show 与 select。');
      if (options.show != null && typeof options.show !== 'boolean') throw new Error('show 应为布尔值。');
      if (options.select != null && (typeof options.select !== 'string' || !options.select.trim())) throw new Error('select 应为选择表达式。');
      let selected;
      if (options.show != null) host.showSequence(options.show);
      if (options.select != null) {
        host.select();
        selected = host.selectSet(options.select);
        if (!selected) throw new Error('相应结构插件或坐标不可用。');
      }
      const data = host.sequence();
      if (!data) throw new Error('相应结构插件或坐标不可用。');
      return { ...data, ...(selected ? { selected } : {}) };
    },
    color(value) {
      needScene();
      const args = Array.isArray(value) ? value : [value];
      if (args.length > 2 || value == null) throw new Error('color 需要 (方案) 或 (目标, 颜色)。');
      const chains = host.chainIds();
      if (!chains) throw new Error('相应结构插件或坐标不可用。');
      let outcome;
      try { outcome = applyColor(host.colorState(), args[0], args[1], chains, { check: host.colorCheck, confidence: host.hasConfidence?.() }); } catch (error) { throw new Error(error.message); }
      host.setColors(outcome.state);
      return { scheme: outcome.state.scheme, chains: { ...outcome.state.chains }, residues: outcome.state.residues.length, note: outcome.note };
    },
    clip(value) {
      needScene();
      if (value == null) return host.clip({});
      if (!object(value) || Object.keys(value).some((key) => !['enabled', 'depth', 'scope', 'aim'].includes(key))) throw new Error('clip 只接受 enabled、depth、scope、aim。');
      if (value.enabled != null && typeof value.enabled !== 'boolean') throw new Error('enabled 应为布尔值。');
      if (value.depth != null) finite(value.depth, -1, 1, 'depth');
      if (value.scope != null && !['all', 'parts'].includes(value.scope)) throw new Error('scope 应为 all 或 parts。');
      if (value.aim != null && typeof value.aim !== 'boolean') throw new Error('aim 应为布尔值。');
      return host.clip(value);
    },
    async benchmark(value) {
      needScene();
      if (value != null && (!object(value) || Object.keys(value).some((key) => !['seconds', 'targetFps'].includes(key)))) throw new Error('benchmark 只接受 seconds、targetFps。');
      if (value?.seconds != null) finite(value.seconds, 1, 30, 'seconds');
      if (value?.targetFps != null) finite(value.targetFps, 10, 144, 'targetFps');
      return host.benchmark(value ?? {});
    },
    membrane(value) {
      needScene();
      if (value == null || value === 'clear') return host.membrane(null);
      if (!object(value) || Object.keys(value).some((key) => !['shape', 'thickness', 'normal', 'offset', 'opacity', 'resolution'].includes(key))) throw new Error('membrane 只接受 shape、thickness、normal、offset、opacity、resolution。');
      const shape = value.shape; if (!object(shape) || !['plane', 'sphere', 'capsule', 'ellipsoid'].includes(shape.kind)) throw new Error('shape.kind 应为 plane / sphere / capsule / ellipsoid。');
      const sizes = { plane: ['width', 'height'], sphere: ['radius'], capsule: ['radius', 'length'], ellipsoid: ['a', 'b', 'c'] }[shape.kind];
      for (const key of sizes) finite(shape[key], key === 'length' ? 0 : 1, 1e6, `shape.${key}`);
      if (value.thickness != null) finite(value.thickness, 5, 500, 'thickness');
      const vec = (v, name) => { if (!Array.isArray(v) || v.length !== 3 || v.some((x) => typeof x !== 'number' || !Number.isFinite(x) || Math.abs(x) > 1e6)) throw new Error(`${name} 应为三个数。`); };
      if (value.normal != null) { vec(value.normal, 'normal'); if (!Math.hypot(...value.normal)) throw new Error('normal 不能是零向量。'); }
      if (value.offset != null) vec(value.offset, 'offset');
      if (value.opacity != null) finite(value.opacity, 0.05, 1, 'opacity');
      if (value.resolution != null && (!Number.isInteger(value.resolution) || value.resolution < 8 || value.resolution > 128)) throw new Error('resolution 应为 8–128 的整数。');
      return host.membrane(value);
    },
    volume(value) {
      needScene();
      if (value == null || value === 'clear') return host.volume(null);
      if (!object(value) || Object.keys(value).some((key) => !['map', 'level', 'opacity', 'slice'].includes(key))) throw new Error('volume 只接受 map、level、opacity、slice。');
      if (value.map != null && (typeof value.map !== 'string' || value.map.length > 90 * 1024 * 1024)) throw new Error('map 应为 MRC/CCP4 文件的 base64（不超过约 64 MB 的文件）。');
      if (value.level != null && value.level !== 'auto') finite(value.level, -1e12, 1e12, 'level');
      if (value.opacity != null) finite(value.opacity, 0.05, 1, 'opacity');
      if (value.slice != null && (!object(value.slice) || ![0, 1, 2].includes(value.slice.axis) || !Number.isInteger(value.slice.index))) throw new Error('slice 应为 {axis:0|1|2, index:整数}。');
      return host.volume(value);
    },
    instances(value) {
      needScene();
      if (value == null || value === 'clear') return host.instances(null);
      if (!object(value) || Object.keys(value).some((key) => !['copies', 'layout', 'spread', 'seed', 'budget'].includes(key))) throw new Error('instances 只接受 copies、layout、spread、seed、budget。');
      if (!Number.isInteger(value.copies) || value.copies < 1 || value.copies > 20000) throw new Error('copies 应为 1–20000 的整数。');
      if (value.layout != null && !['sphere', 'grid'].includes(value.layout)) throw new Error('layout 应为 sphere 或 grid。');
      if (value.spread != null) finite(value.spread, 0.5, 4, 'spread');
      if (value.seed != null && (!Number.isInteger(value.seed) || value.seed < 0 || value.seed > 4294967295)) throw new Error('seed 应为 0–4294967295 的整数。');
      if (value.budget != null && (!Number.isInteger(value.budget) || value.budget < 1000 || value.budget > 1e9)) throw new Error('budget 应为 1000–1e9 的整数（每帧三角形数）。');
      return host.instances(value);
    },
    complex(value) {
      needScene();
      if (value != null && (!object(value) || Object.keys(value).some((key) => !['id', 'title', 'record'].includes(key)))) throw new Error('complex 只接受 id、title、record。');
      if (value?.record != null && typeof value.record !== 'boolean') throw new Error('record 应为布尔值。');
      for (const key of ['id', 'title']) if (value?.[key] != null && (typeof value[key] !== 'string' || !value[key].trim() || value[key].length > 120)) throw new Error(`${key} 应为 1–120 字的文字。`);
      return host.complex(value ?? {});
    },
    async assemble(value) {
      needScene();
      if (!object(value) || Object.keys(value).some((key) => !['pdb', 'baseSelection', 'addSelection', 'carry', 'mode', 'maxRmsd', 'threshold'].includes(key))) throw new Error('assemble 只接受 pdb、baseSelection、addSelection、carry、mode、maxRmsd、threshold。');
      if (typeof value.pdb !== 'string' || !/^[0-9][A-Za-z0-9]{3}$/.test(value.pdb)) throw new Error('pdb 应为 4 位 PDB 编号。');
      for (const key of ['baseSelection', 'addSelection', 'carry']) if (typeof value[key] !== 'string' || !value[key].trim() || value[key].length > 200) throw new Error(`${key} 应为选择表达式（例如 "chain A"）。`);
      if (value.mode != null && !['number', 'sequence'].includes(value.mode)) throw new Error('mode 应为 number 或 sequence。');
      if (value.maxRmsd != null) finite(value.maxRmsd, 0.1, 50, 'maxRmsd');
      if (value.threshold != null) finite(value.threshold, 0.5, 10, 'threshold');
      return host.assemble(value);
    },
    embed(value) {
      needScene();
      if (value == null || value === 'clear') return host.embed(null);
      if (!object(value) || Object.keys(value).some((key) => !['shape', 'copies', 'seed', 'inward', 'opacity', 'budget'].includes(key))) throw new Error('embed 只接受 shape、copies、seed、inward、opacity、budget。');
      checkShape(value.shape, 'shape');
      if (!Number.isInteger(value.copies) || value.copies < 1 || value.copies > 5000) throw new Error('copies 应为 1–5000 的整数。');
      if (value.seed != null && (!Number.isInteger(value.seed) || value.seed < 0 || value.seed > 4294967295)) throw new Error('seed 应为 0–4294967295 的整数。');
      if (value.inward != null && typeof value.inward !== 'boolean') throw new Error('inward 应为布尔值。');
      if (value.opacity != null) finite(value.opacity, 0.05, 1, 'opacity');
      if (value.budget != null && (!Number.isInteger(value.budget) || value.budget < 1000 || value.budget > 1e9)) throw new Error('budget 应为 1000–1e9 的整数。');
      return host.embed(value);
    },
    compose(value) {
      needScene();
      if (value == null || value === 'clear') return host.compose(null);
      if (!object(value) || Object.keys(value).some((key) => !['region', 'components', 'membrane', 'membraneThickness', 'inset', 'seed'].includes(key))) throw new Error('compose 只接受 region、components、membrane、membraneThickness、inset、seed。');
      const region = value.region; if (!object(region) || !['box', 'sphere', 'ellipsoid', 'capsule'].includes(region.kind)) throw new Error('region.kind 应为 box / sphere / ellipsoid / capsule。');
      const sizes = { box: ['x', 'y', 'z'], sphere: ['radius'], ellipsoid: ['a', 'b', 'c'], capsule: ['radius', 'length'] }[region.kind];
      for (const key of sizes) finite(region[key], key === 'length' ? 0 : 1, 1e7, `region.${key}`);
      if (!Array.isArray(value.components) || value.components.length < 1 || value.components.length > 24) throw new Error('components 应为 1–24 项的数组。');
      const ids = new Set();
      for (const c of value.components) {
        if (!object(c) || typeof c.id !== 'string' || !c.id.trim() || c.id.length > 60 || ids.has(c.id)) throw new Error('每个组分都需要不重复的 id（≤60 字）。');
        ids.add(c.id);
        if (!Number.isInteger(c.copies) || c.copies < 1 || c.copies > 20000) throw new Error(`${c.id}：copies 应为 1–20000 的整数。`);
        finite(c.radius, 0.1, 1e5, `${c.id}.radius`);
        if (c.color != null && !/^#[0-9a-fA-F]{6}$/.test(c.color)) throw new Error(`${c.id}：color 应为 #rrggbb。`);
        if (c.useOpenStructure != null && typeof c.useOpenStructure !== 'boolean') throw new Error(`${c.id}：useOpenStructure 应为布尔值。`);
      }
      if (value.membrane != null) checkShape(value.membrane, 'membrane');
      if (value.membraneThickness != null) finite(value.membraneThickness, 5, 500, 'membraneThickness');
      if (value.inset != null) finite(value.inset, 0, 1e5, 'inset');
      if (value.seed != null && (!Number.isInteger(value.seed) || value.seed < 0 || value.seed > 4294967295)) throw new Error('seed 应为 0–4294967295 的整数。');
      return host.compose(value);
    },
    interactions(value) {
      needScene();
      if (value != null && (!object(value) || Object.keys(value).some((key) => !['cutoff', 'minContacts', 'limit'].includes(key)))) throw new Error('interactions 只接受 cutoff、minContacts、limit。');
      if (value?.cutoff != null) finite(value.cutoff, 2, 10, 'cutoff');
      if (value?.minContacts != null && (!Number.isInteger(value.minContacts) || value.minContacts < 1 || value.minContacts > 1000)) throw new Error('minContacts 应为 1–1000 的整数。');
      if (value?.limit != null && (!Number.isInteger(value.limit) || value.limit < 1 || value.limit > 500)) throw new Error('limit 应为 1–500 的整数。');
      return host.interactions(value ?? {});
    },
    binding(value) {
      if (!object(value) || Object.keys(value).some((key) => !['box', 'particles', 'D', 'radius', 'microseconds', 'dt', 'koff', 'seed', 'reinject'].includes(key))) throw new Error('binding 只接受 box、particles、D、radius、microseconds、dt、koff、seed、reinject。');
      finite(value.box, 10, 1e4, 'box'); finite(value.D, 1e-3, 1e4, 'D'); finite(value.radius, 0.1, 100, 'radius'); finite(value.microseconds, 0.1, 1e6, 'microseconds');
      if (!Number.isInteger(value.particles) || value.particles < 1 || value.particles > 20000) throw new Error('particles 应为 1–20000 的整数。');
      if (value.dt != null) finite(value.dt, 1e-5, 0.1, 'dt');
      if (value.koff != null) finite(value.koff, 0, 1e3, 'koff');
      if (value.seed != null && (!Number.isInteger(value.seed) || value.seed < 0 || value.seed > 4294967295)) throw new Error('seed 应为 0–4294967295 的整数。');
      if (value.reinject != null && typeof value.reinject !== 'boolean') throw new Error('reinject 应为布尔值。');
      return host.binding(value);
    },
    async source(value) {
      if (!object(value) || Object.keys(value).some((key) => !['source', 'accession', 'expectedSha256', 'allowUpdate'].includes(key))) throw new Error('source 只接受 source、accession、expectedSha256、allowUpdate。');
      if (typeof value.source !== 'string' || !/^[a-z][a-z0-9-]{1,30}$/.test(value.source)) throw new Error('source 应为数据源名称（如 alphafold、emdb）。');
      if (typeof value.accession !== 'string' || !/^[A-Za-z0-9_.-]{1,40}$/.test(value.accession)) throw new Error('accession 只能含字母、数字和 _ . -（≤40 字）。');
      if (value.expectedSha256 != null && !/^[0-9a-f]{64}$/.test(value.expectedSha256)) throw new Error('expectedSha256 应为 64 位小写十六进制。');
      if (value.allowUpdate != null && typeof value.allowUpdate !== 'boolean') throw new Error('allowUpdate 应为布尔值。');
      return host.source(value);
    },
    tools: () => host.tools?.() ?? [],
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
