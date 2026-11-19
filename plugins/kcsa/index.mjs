import { DEFAULTS, PARAMETERS, validateParameters, createKinetics, singleChannelCurrent, reversalPotential, conducting } from './kinetics.mjs';
import { buildKcsaStructure } from './structure.mjs';
export const KCSA_PLAYER = 'org.glow.legacy-process.kcsa';
const STATE_IDS = ['1K4C', '5VK6', '5VKE', '2HVK', '2ITD'];
export const kcsaPlugin = {
  manifest: { id: KCSA_PLAYER, version: '1.0.0', apiVersion: 1,
    dependencies: [{ id: 'org.glow.structure', version: '1.0.0' }], capabilities: ['players', 'panels'] },
  activate(context) {
    const instances = new Set();
    context.lifecycle.add(() => { for (const instance of instances) instance.dispose(); instances.clear(); });
    context.registerPlayer(KCSA_PLAYER, {
      async prepare(input) {
        context.signal.throwIfAborted();
        await prepareKcsa({ ...input, signal: AbortSignal.any([context.signal, input.signal]) });
      },
      create(input) {
        if (context.signal.aborted) throw new Error('KcsA 插件已停用。');
        const player = createKcsaPlayer(input), dispose = player.dispose;
        player.dispose = () => { dispose(); instances.delete(player); };
        instances.add(player); return player;
      },
    });
    context.registerPanel(KCSA_PLAYER, {
      title: 'KcsA 钾通道', speed: { label: '模拟时钟倍率', min: 0.05, max: 3, step: 0.05 },
      seed: { label: '随机种子', min: 0, max: 4294967295, step: 1 }, parameters: PARAMETERS,
      evidence: '结构：1K4C / 5VK6 / 5VKE / 2HVK / 2ITD。构象按孔区叠合，粒子和膜为教学显示。门控秒与渗透纳秒分别计时；速率模型用于教学，不是分子动力学。开放结构为 E71A；野生型选项只改变动力学。',
    });
  },
};

export async function prepareKcsa({ loaded, parse, loadAccession, signal }) {
  if (loaded.kcsaModels) return;
  const states = new Map(), additions = [];
  const primary = loaded.scene.assets.find((asset) => asset.provenance?.parserVersion);
  if (!primary || loaded.scene.legacy?.scene?.id !== '1K4C') throw new Error('KcsA 播放器需要 1K4C 主结构。');
  for (const id of STATE_IDS) {
    signal.throwIfAborted();
    const stored = id === '1K4C' ? primary : loaded.scene.assets.find((asset) => asset.provenance?.mechanismState?.player === KCSA_PLAYER && asset.provenance.mechanismState.accession === id);
    const input = stored ? { bytes: loaded.resources.get(stored.path), name: stored.path, mediaType: stored.mediaType }
      : await loadAccession(id, signal);
    const model = parse(input, { assemblyId: '1' });
    states.set(id, model);
    if (!stored) {
      const hash = await crypto.subtle.digest('SHA-256', input.bytes);
      additions.push({ asset: { id: `kcsa-state-${id}`, kind: 'file', path: `assets/kcsa/${id}.cif`, mediaType: 'chemical/x-mmcif',
        sha256: [...new Uint8Array(hash)].map((n) => n.toString(16).padStart(2, '0')).join(''),
        provenance: { source: input.source, assemblyId: '1', mechanismState: { player: KCSA_PLAYER, accession: id } } }, bytes: input.bytes });
    }
  }
  signal.throwIfAborted();
  // Commit coordinate resources only after every required state is available.
  if (additions.some(({ asset }) => loaded.scene.assets.some((old) => old.id === asset.id || old.path === asset.path))) throw new Error('KcsA 构象资源 ID 或路径与现有资源冲突。');
  for (const { asset, bytes } of additions) { loaded.scene.assets.push(asset); loaded.resources.set(asset.path, bytes); }
  loaded.kcsaModels = states;
}
export const STEPS = [
  ['pH 门控', '胞内酸化提高开门速率；中性 pH 时门大多关闭。'],
  ['K⁺ 进入中央腔', '水合 K⁺ 从胞内沿开放结构算出的孔道进入中央腔。'],
  ['选择性过滤器', 'S1–S4 位点来自 1K4C 中的 K⁺ 坐标，Na⁺ 进腔后被排斥。'],
  ['敲击与反向通量', '离子在四状态敲击循环中重排，电位与浓度决定净通量方向。'],
  ['离子释放', 'K⁺ 向胞外释放或反向进入；计数来自离散状态转移。'],
  ['C 型失活', '野生型动力学允许过滤器失活；TBA 和 Ba²⁺ 分别阻断中央腔及过滤器。'],
];
export function createKcsaPlayer({ model, scene, state = {}, states }) {
  const structure = buildKcsaStructure(model, states);
  const sourceId = scene.assets.find((asset) => asset.provenance?.parserVersion)?.id;
  const nodes = scene.nodes.filter((node) => node.extensions?.['org.glow.structure']?.sourceAssetId === sourceId && /potassium channel|kcsa/i.test(node.extensions['org.glow.structure'].partName));
  if (nodes.length !== 4) throw new Error('KcsA 预览需要四个通道链节点。');
  const steps = STEPS.map(([title, caption]) => ({ title, caption, nodeIds: nodes.map(({ id }) => id) }));
  const base = { nodeId: nodes[0].parentId ?? nodes[0].id, bookmarkId: null, labelIds: [] };
  const navigation = { version: 1, entryId: 'kcsa-system', views: [
    { ...base, id: 'kcsa-system', mode: 'system', title: 'KcsA 膜系统', parentIds: [] },
    { ...base, id: 'kcsa-protein', mode: 'protein', title: 'KcsA 四聚体', parentIds: ['kcsa-system'] },
    { ...base, id: 'kcsa-mechanism', mode: 'mechanism', title: '门控与离子渗透', parentIds: ['kcsa-system', 'kcsa-protein'],
      steps: steps.map(({ title, nodeIds }, i) => ({ id: `kcsa-step-${i}`, title, nodeIds })) },
  ] };
  const seed = Number.isSafeInteger(state.seed) && state.seed >= 0 && state.seed <= 4294967295 ? state.seed : 1;
  const initial = { ...DEFAULTS, speed: 1, time: 0 };
  function validateEntry(entry) {
    const { time, speed, ...parameters } = entry;
    validateParameters(parameters);
    if (!Number.isFinite(time) || time < 0 || time > 120 || !Number.isFinite(speed) || speed < 0.05 || speed > 3) throw new Error('KcsA 播放记录无效。');
    return { ...DEFAULTS, ...parameters, time, speed };
  }
  let schedule = [initial];
  if (state.schedule != null) {
    if (!Array.isArray(state.schedule) || !state.schedule.length || state.schedule.length > 1000) throw new Error('KcsA 播放记录超出范围。');
    schedule = state.schedule.map(validateEntry);
    if (schedule[0].time !== 0 || schedule.some((entry, i) => i && entry.time <= schedule[i - 1].time)) throw new Error('KcsA 播放记录时间顺序无效。');
  }
  let time = Number.isFinite(state.time) ? Math.max(0, Math.min(120, state.time)) : 0, playing = false, disposed = false;
  let playbackRate = [0.25, 1, 2, 5].includes(state.playbackRate) ? state.playbackRate : 1;
  let kinetics = createKinetics(seed, schedule);
  const ensureLive = () => { if (disposed) throw new Error('KcsA 播放器已释放。'); };
  const positions = { ...structure.sites, inside: structure.paths.inside[0], outside: structure.paths.outside.at(-1) };
  const occupancy = { A: ['S1', 'S3'], B: ['S1', 'S3', 'cav'], C: ['S0', 'S2', 'S4'], D: ['S2', 'S4'], X: ['S1', 'S4'] };
  const transitions = {
    AB: [['S1', 'S1'], ['S3', 'S3'], ['inside', 'cav']], BA: [['S1', 'S1'], ['S3', 'S3'], ['cav', 'inside']],
    BC: [['S1', 'S0'], ['S3', 'S2'], ['cav', 'S4']], CB: [['S0', 'S1'], ['S2', 'S3'], ['S4', 'cav']],
    CD: [['S2', 'S2'], ['S4', 'S4'], ['S0', 'outside']], DC: [['S2', 'S2'], ['S4', 'S4'], ['outside', 'S0']],
    DA: [['S2', 'S1'], ['S4', 'S3']], AD: [['S1', 'S2'], ['S3', 'S4']],
  };
  const lerp = (a, b, f) => a.map((v, i) => v + (b[i] - v) * f);
  function walk(path, fraction) {
    const lengths = path.slice(1).map((p, i) => Math.hypot(...p.map((v, k) => v - path[i][k])));
    let wanted = lengths.reduce((s, l) => s + l, 0) * fraction;
    for (let i = 0; i < lengths.length; i++) { if (wanted <= lengths[i]) return lerp(path[i], path[i + 1], wanted / (lengths[i] || 1)); wanted -= lengths[i]; }
    return path.at(-1);
  }
  function snapshot() {
    if (disposed) throw new Error('KcsA 播放器已释放。');
    const s = kinetics.at(time), f = Math.min(1, Math.max(0, (time - s.permTime) / 0.2));
    let moves = conducting(s) && f < 1 && transitions[s.lastPermId];
    moves ||= occupancy[s.perm].map((site) => [site, site]);
    const particles = [0, 1, 2].map((i) => {
      const move = moves[i]; let position = positions.S1;
      if (move) {
        const [a, b] = move;
        position = a === 'inside' && b === 'cav' ? walk(structure.paths.inside, f)
          : a === 'cav' && b === 'inside' ? walk(structure.paths.inside, 1 - f)
            : a === 'S0' && b === 'outside' ? walk(structure.paths.outside, f)
              : a === 'outside' && b === 'S0' ? walk(structure.paths.outside, 1 - f) : lerp(positions[a], positions[b], f);
      }
      return { name: 'K⁺', color: '#9361ce', position: structure.point(position), visible: Boolean(move) };
    });
    const nf = Math.min(1, Math.max(0, (time - s.naTime) / 0.4));
    particles.push({ name: 'Na⁺（被排斥）', color: '#2f9fce', position: structure.point(walk(structure.paths.inside, nf < 0.5 ? nf * 2 : 2 - nf * 2)), visible: s.naTime >= 0 && nf < 1 });
    particles.push({ name: 'TBA', color: '#ed8b31', ...structure.blockers.TBA, visible: s.tba });
    particles.push({ name: 'Ba²⁺', color: '#36aa70', ...structure.blockers.Ba, visible: s.ba });
    const pA = singleChannelCurrent(s.parameters), ek = reversalPotential(s.parameters);
    return { time, seed, speed: s.parameters.speed, playbackRate, playing, stage: s.stage,
      parameters: Object.fromEntries(Object.keys(PARAMETERS).map((key) => [key, s.parameters[key]])),
      counters: { 'K⁺ 外流': s.out, 'K⁺ 内流': s.inn, 'Na⁺ 排斥': s.na },
      metrics: `门${s.gate === 'C' ? '关闭' : s.gate === 'I' ? '失活' : '开放'}${s.tba ? ' · TBA 阻断' : ''}${s.ba ? ' · Ba²⁺ 阻断' : ''} · 瞬时导电电流 ${(conducting(s) ? pA : 0).toFixed(2)} pA · 开放未阻断模型电流 ${pA.toFixed(2)} pA · E_K ${ek.toFixed(1)} mV · 门控 ${s.gateSeconds.toFixed(2)} s · 渗透 ${s.ns.toFixed(2)} ns`,
      gate: s.gate, conducting: conducting(s), current: conducting(s) ? pA : 0, openCurrent: pA, reversalPotential: ek,
      gateSeconds: s.gateSeconds, permeationNs: s.ns, openProbability: s.gateSeconds ? s.openSeconds / s.gateSeconds : 0,
      particles, transforms: new Map(), conformation: { weights: s.weights }, events: s.events };
  }
  function setParameters(parameters) {
    const validated = validateParameters(parameters);
    change(validated);
  }
  function change(patch) {
    ensureLive();
    if (schedule.length >= 1000) throw new Error('KcsA 参数变更已达上限。');
    const current = kinetics.at(time).parameters;
    schedule = [...schedule.filter((entry) => entry.time < time), { ...current, ...patch, time }];
    kinetics = createKinetics(seed, schedule);
  }
  return {
    duration: 120, steps, navigation, snapshot, setParameters, validateParameters,
    decorate: (layers) => { ensureLive(); return structure.decorate(layers, nodes); },
    particleParentId: nodes[0].parentId,
    membrane: { center: structure.center, axis: structure.axis, radius: 2.8 },
    evidence: { type: 'modelled', citation: 'KcsA 教学播放器', details: `孔区 60–80 四链叠合 RMSD（Å）：${Object.entries(structure.fits).map(([id, fit]) => `${id} ${fit.rmsd.toFixed(3)}`).join('；')}。门控与四态敲击速率沿用经典模型；渗透和门控默认分别为 10 ns/示意秒、0.05 s/示意秒，可分别调节，均乘模拟时钟倍率。粒子插值不阻塞模拟时钟。` },
    seek(value) { ensureLive(); if (!Number.isFinite(value)) throw new Error('时间必须有限。'); time = Math.min(120, Math.max(0, value)); if (time === 120) playing = false; return snapshot(); },
    advance(dt) { ensureLive(); if (!Number.isFinite(dt) || dt < 0) throw new Error('时间增量无效。'); if (playing) time = Math.min(120, Math.round((time + dt * playbackRate) * 1e9) / 1e9); if (time === 120) playing = false; return snapshot(); },
    play() { ensureLive(); if (time < 120) playing = true; }, pause() { ensureLive(); playing = false; },
    setSpeed(speed) { if (!Number.isFinite(speed) || speed < 0.05 || speed > 3) throw new Error('模拟倍率应为 0.05–3。'); change({ speed }); },
    setPlaybackRate(value) { ensureLive(); if (![0.25, 1, 2, 5].includes(value)) throw new Error('播放倍率无效。'); playbackRate = value; },
    stepTime(index) { if (!Number.isInteger(index) || !steps[index]) throw new Error('机制步骤无效。'); return undefined; },
    save() { ensureLive(); return { time, speed: kinetics.at(time).parameters.speed, seed, playbackRate, schedule: schedule.map((entry) => ({ ...entry })) }; },
    dispose() { disposed = true; playing = false; },
  };
}
